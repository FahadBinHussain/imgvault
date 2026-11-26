package com.imgvault.app.data

import com.imgvault.app.core.crypto.VaultCrypto
import com.imgvault.app.core.crypto.VaultConfig
import com.imgvault.app.core.neon.NeonClient
import com.imgvault.app.core.settings.SettingsRepository
import com.imgvault.app.data.model.MediaItem
import com.imgvault.app.data.model.toMediaItem
import java.util.Base64
import javax.crypto.SecretKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request

/** one decrypted vault item */
data class VaultItem(
    val id: String,
    val fileName: String,
    val mimeType: String,
    val sizeBytes: Long,
    val hosts: List<String>,
    val raw: MediaItem,
)

/**
 * The vault: encrypted blobs on TeraBox + Telegram, unlocked with the user's
 * passcode.
 *
 * The rows keep their plaintext columns BLANK and carry `encryptedMetadata`
 * instead — the metadata is single-shot AES-GCM with the master key, and the
 * blob itself is the IVG1 chunked format from `packages/shared/vaultCrypto.js`
 * (the Kotlin port in `core/crypto/VaultCrypto.kt`).
 */
class VaultRepository(
    private val settings: SettingsRepository,
    private val http: OkHttpClient,
) {
    private val json = Json { ignoreUnknownKeys = true }

    private fun client(): NeonClient {
        val connectionString = settings.neonUrl
            ?: throw ImgVaultException(
                "No Neon database is configured yet. Add your Neon connection string in Settings.",
            )
        return NeonClient(connectionString, http)
    }

    /** the master key, while the vault is unlocked */
    fun masterKey(): SecretKey? {
        val encoded = settings.vaultMasterKeyB64 ?: return null
        return javax.crypto.spec.SecretKeySpec(Base64.getDecoder().decode(encoded), "AES")
    }

    /** unlock the vault: the passcode unwraps the master key */
    fun unlock(passcode: String): SecretKey {
        val configJson = settings.vaultConfigJson
            ?: throw ImgVaultException(
                "This account has no vault configuration yet. Create the vault from the extension, then unlock it here.",
            )
        val config = parseConfig(configJson)
        val key = VaultCrypto.unwrapMasterKey(config, passcode)
        settings.vaultMasterKeyB64 = Base64.getEncoder().encodeToString(key.encoded)
        return key
    }

    fun lock() {
        settings.vaultMasterKeyB64 = null
    }

    /** the vault rows, with their metadata decrypted */
    suspend fun loadVaultItems(): List<VaultItem> = withContext(Dispatchers.IO) {
        val rows = client().query(VAULT_SQL)
        val key = masterKey()
        rows.map { row ->
            val item = row.toMediaItem()
            val meta = key?.let { decryptMetadata(it, item.encryptedMetadata) }
            VaultItem(
                id = item.id,
                fileName = meta?.get("fileName")?.jsonPrimitive?.content
                    ?: item.encryptedFileName
                    ?: item.fileName,
                mimeType = meta?.get("mimeType")?.jsonPrimitive?.content
                    ?: item.encryptedMimeType,
                sizeBytes = item.fileSize ?: 0L,
                hosts = item.vaultHosts,
                raw = item,
            )
        }
    }

    /**
     * Download + decrypt the encrypted blob of a vault item.
     *
     * Two hosts carry the blob in V1:
     *  - telegram: the row keeps the file id, the Bot API serves the bytes
     *  - terabox: the row keeps a direct link
     *
     * Anything else fails LOUDLY — there is no silent "preview unavailable"
     * that would look like a broken vault.
     */
    suspend fun loadVaultBytes(item: MediaItem): ByteArray = withContext(Dispatchers.IO) {
        val key = masterKey()
            ?: throw ImgVaultException("The vault is locked — unlock it to read this file.")

        val bytes = when {
            item.encryptedBlobFileId.isNotEmpty() -> downloadFromTelegram(item.encryptedBlobFileId)
            item.encryptedBlobUrl.startsWith("http") -> downloadFromUrl(item.encryptedBlobUrl)
            else -> throw ImgVaultException(
                "This vault blob has no readable host link (file id and url are both empty). " +
                    "Open it from the extension.",
            )
        }

        try {
            VaultCrypto.decryptBlob(key, bytes)
        } catch (error: Exception) {
            throw ImgVaultException(
                "The vault blob could not be decrypted: ${error.message ?: "wrong key or damaged file"}",
                error,
            )
        }
    }

    private fun downloadFromTelegram(fileId: String): ByteArray {
        val token = settings.telegramBotToken
            ?: throw ImgVaultException(
                "This vault blob lives on Telegram, but no bot token is configured. Add it in Settings.",
            )
        val infoUrl = "https://api.telegram.org/bot$token/getFile?file_id=$fileId"
        val infoBody = getText(infoUrl)
        val root = runCatching { json.parseToJsonElement(infoBody).jsonObject }.getOrElse { error ->
            throw ImgVaultException("Telegram getFile answered with something that is not JSON", error)
        }
        val ok = root["ok"]?.jsonPrimitive?.content == "true"
        if (!ok) {
            val description = root["description"]?.jsonPrimitive?.content ?: "unknown error"
            throw ImgVaultException("Telegram refused to hand over the vault file: $description")
        }
        val filePath = root["result"]?.jsonObject?.get("file_path")?.jsonPrimitive?.content
            ?: throw ImgVaultException("Telegram did not return a file path for the vault blob")
        return getBytes("https://api.telegram.org/file/bot$token/$filePath")
    }

    private fun downloadFromUrl(url: String): ByteArray = getBytes(url)

    private fun getText(url: String): String {
        val request = Request.Builder().url(url).get().build()
        http.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ImgVaultException("GET $url failed (HTTP ${response.code}): ${body.take(200)}")
            }
            return body
        }
    }

    private fun getBytes(url: String): ByteArray {
        val request = Request.Builder().url(url).get().build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw ImgVaultException("GET $url failed (HTTP ${response.code})")
            }
            val body = response.body ?: throw ImgVaultException("GET $url returned no body")
            return body.bytes()
        }
    }

    private fun decryptMetadata(key: SecretKey, encrypted: String): JsonObject? {
        if (encrypted.isEmpty()) return null
        return try {
            val plain = VaultCrypto.decryptMetadata(key, encrypted)
            json.parseToJsonElement(plain).jsonObject
        } catch (error: Exception) {
            throw ImgVaultException(
                "The vault metadata could not be decrypted: ${error.message ?: "wrong key"}",
                error,
            )
        }
    }

    private fun parseConfig(raw: String): VaultConfig {
        val root = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrElse { error ->
            throw ImgVaultException("The stored vault configuration is not valid JSON", error)
        }
        return VaultConfig(
            salt = root["salt"]?.jsonPrimitive?.content.orEmpty(),
            passHash = root["passHash"]?.jsonPrimitive?.content.orEmpty(),
            kdfSalt = root["kdfSalt"]?.jsonPrimitive?.content.orEmpty(),
            kdfIterations = root["kdfIterations"]?.jsonPrimitive?.content?.toIntOrNull()
                ?: VaultCrypto.KDF_ITERATIONS,
            wrappedMasterKey = root["wrappedMasterKey"]?.jsonPrimitive?.content.orEmpty(),
            vaultVersion = root["vaultVersion"]?.jsonPrimitive?.content?.toIntOrNull()
                ?: VaultCrypto.VAULT_VERSION,
        )
    }

    companion object {
        /**
         * The vault rows: an item is vaulted when it carries the vault flag or
         * any encrypted metadata (a vault MOVE blanks the plaintext columns).
         */
        val VAULT_SQL = """
            select
              id, kind, is_video, is_link, page_title, description, tags, collection_id,
              internal_added_timestamp, source_image_url, source_page_url, file_name, file_size,
              width, height, duration, file_type, file_type_source, creation_date, creation_date_source,
              sha256, p_hash, a_hash, d_hash,
              pixvid_url, pixvid_delete_url, imgbb_url, imgbb_delete_url, imgbb_thumb_url,
              filemoon_watch_url, filemoon_direct_url, udrop_watch_url, udrop_direct_url,
              link_url, link_url_canonical, link_preview_image_url, favicon_url, last_visited_at,
              spz_url, spz_file_size, texture_url, texture_file_size, config_json,
              deleted_at, created_at, updated_at, extra_metadata
            from public.media_items
            where deleted_at is null
              and (
                extra_metadata->>'isVaulted' = 'true'
                or extra_metadata->>'encryptedMetadata' is not null
                or extra_metadata->>'vaultHost' is not null
                or extra_metadata->>'vaultHosts' is not null
              )
            order by internal_added_timestamp desc, created_at desc
        """.trimIndent()
    }
}
