package com.imgvault.app.data

import com.imgvault.app.core.crypto.VaultCrypto
import com.imgvault.app.core.crypto.VaultConfig
import com.imgvault.app.core.crypto.VaultKeyBinding
import com.imgvault.app.core.neon.NeonClient
import com.imgvault.app.core.neon.asBooleanOrFalse
import com.imgvault.app.core.neon.asJsonObjectOrEmpty
import com.imgvault.app.core.neon.asLongOrNull
import com.imgvault.app.core.neon.asTextOrEmpty
import com.imgvault.app.core.settings.SettingsRepository
import com.imgvault.app.core.time.isoDayOf
import com.imgvault.app.data.model.MediaItem
import com.imgvault.app.data.model.durationLabelOf
import com.imgvault.app.data.model.toMediaItem
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.util.Base64
import javax.crypto.SecretKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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
    /**
     * why this item's metadata could not be read (null = it was read).
     *
     * One unreadable item must not take the whole vault down: the item keeps
     * its place in the list and says what is wrong with it.
     */
    val decryptError: String? = null,
    /** the shape of the picture, out of the decrypted metadata */
    val width: Int? = null,
    val height: Int? = null,
    val isVideo: Boolean = false,
    val durationLabel: String = "",
    /** the day the item belongs to in the feed ("2026-11-26") */
    val dayKey: String? = null,
) {
    /**
     * The tile's shape — the picture's own, never squashed into a square.
     *
     * A vaulted row keeps its plaintext columns blank, so the size comes from
     * the decrypted metadata; an item that could not be read falls back to a
     * square.
     */
    val aspectRatio: Float
        get() {
            val w = width ?: return 1f
            val h = height ?: return 1f
            if (w <= 0 || h <= 0) return 1f
            return (w.toFloat() / h.toFloat()).coerceIn(0.55f, 2.2f)
        }

    /** what the tile shows when there is no picture */
    val title: String get() = fileName.ifBlank { "unnamed file" }
}

/**
 * The preview of a vault item.
 *
 * The extension encrypts a small JPEG of every vaulted item and stores it in
 * `media_item_previews` — without it the vault grid would be a wall of empty
 * squares.
 */
sealed interface VaultPreview {
    /** the decrypted picture bytes */
    class Image(val bytes: ByteArray) : VaultPreview

    /** this item has no preview at all */
    data object Missing : VaultPreview

    /** the preview exists but could not be read with the current key */
    data class Failed(val message: String) : VaultPreview
}

/**
 * The vault rows, plus how many of them could not be read.
 *
 * The count is reported instead of thrown: a single item encrypted with a
 * different key is a fact about that item, not a reason to hide the other
 * hundred and ninety.
 */
data class VaultLoadResult(
    val items: List<VaultItem>,
    val failed: Int,
    val total: Int,
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
    suspend fun unlock(passcode: String): SecretKey {
        val config = settings.vaultConfigJson
            ?.let { parseConfig(it) }
            ?: fetchVaultConfig()
        val key = VaultCrypto.unwrapMasterKey(config, passcode)
        settings.vaultMasterKeyB64 = Base64.getEncoder().encodeToString(key.encoded)
        // the key belongs to THIS configuration - remember which one, so a
        // changed configuration can never be read with a foreign key
        settings.vaultKeyBinding = VaultKeyBinding.idOf(config)
        return key
    }

    /**
     * The vault configuration, straight from the database.
     *
     * The extension stores it in the `__imgvault_vault_config__` row
     * (`extra_metadata->'secretVaultConfig'`) — the same place the web vault
     * reads it from, so the phone does not need the config pasted in by hand.
     */
    private suspend fun fetchVaultConfig(): VaultConfig = withContext(Dispatchers.IO) {
        val row = client().query(VAULT_CONFIG_SQL).firstOrNull()
            ?: throw ImgVaultException(
                "This account has no vault configuration yet. Create the vault from the extension, then unlock it here.",
            )
        val config = row["extra_metadata"].asJsonObjectOrEmpty()["secretVaultConfig"].asJsonObjectOrEmpty()
        if (config.isEmpty()) {
            throw ImgVaultException("The stored vault configuration is empty - save the passcode in the extension once.")
        }
        VaultConfig(
            salt = config["salt"].asTextOrEmpty(),
            passHash = config["passHash"].asTextOrEmpty(),
            kdfSalt = config["kdfSalt"].asTextOrEmpty(),
            kdfIterations = config["kdfIterations"].asTextOrEmpty().toIntOrNull()
                ?: VaultCrypto.KDF_ITERATIONS,
            wrappedMasterKey = config["wrappedMasterKey"].asTextOrEmpty(),
            vaultVersion = config["vaultVersion"].asTextOrEmpty().toIntOrNull()
                ?: VaultCrypto.VAULT_VERSION,
        )
    }

    fun lock() {
        settings.vaultMasterKeyB64 = null
        settings.vaultKeyBinding = null
    }

    /**
     * The vault rows, with their metadata decrypted.
     *
     * The master key on the phone has to belong to the account's CURRENT vault
     * configuration — otherwise every item fails with `BAD_DECRYPT` and the
     * message says nothing about what is really wrong. A key from another
     * configuration is dropped here and the vault asks for the passcode again.
     *
     * An item whose metadata cannot be read keeps its place in the list and
     * says so; it does not take the whole vault down.
     */
    suspend fun loadVaultItems(): VaultLoadResult = withContext(Dispatchers.IO) {
        val config = fetchVaultConfig()
        if (VaultKeyBinding.isStale(settings.vaultKeyBinding, config)) {
            // the stored key does not belong to this configuration - drop it so
            // the next unlock stores the right one
            settings.vaultMasterKeyB64 = null
            settings.vaultKeyBinding = null
            throw ImgVaultException(
                "The vault key stored on this phone does not belong to this account's vault " +
                    "configuration (the configuration changed - a different database, account or " +
                    "passcode). Unlock the vault again to read it.",
            )
        }

        val rows = client().query(VAULT_SQL)
        val key = masterKey()
        var failed = 0
        val items = rows.map { row ->
            val item = row.toMediaItem()
            var meta: JsonObject? = null
            var decryptError: String? = null
            if (item.encryptedMetadata.isNotEmpty()) {
                if (key == null) {
                    decryptError = "The vault is locked — unlock it to read this item."
                } else {
                    try {
                        meta = decryptMetadata(key, item.encryptedMetadata)
                    } catch (error: Exception) {
                        decryptError = error.message
                            ?: "The metadata could not be decrypted with this vault key."
                    }
                }
                if (decryptError != null) failed += 1
            }
            val fileName = meta?.get("fileName").asTextOrEmpty()
                .ifEmpty { meta?.get("originalFileName").asTextOrEmpty() }
                .ifEmpty { item.encryptedFileName }
                .ifEmpty { item.fileName }
            // the day the item belongs under: the picture's own date, and the
            // day it was vaulted when the metadata could not be read
            val dayKey = isoDayOf(meta?.get("creationDate").asTextOrEmpty())
                ?: isoDayOf(item.extra["vaultedAt"].asTextOrEmpty())
                ?: isoDayOf(item.internalAddedTimestamp)
            VaultItem(
                id = item.id,
                fileName = fileName,
                mimeType = meta?.get("mimeType").asTextOrEmpty()
                    .ifEmpty { item.encryptedMimeType },
                sizeBytes = item.fileSize ?: 0L,
                hosts = item.vaultHosts,
                raw = item,
                decryptError = decryptError,
                width = meta?.get("width").asLongOrNull()?.toInt(),
                height = meta?.get("height").asLongOrNull()?.toInt(),
                isVideo = meta?.get("isVideo").asBooleanOrFalse() || item.isVideo,
                durationLabel = durationLabelOf(
                    meta?.get("duration").asTextOrEmpty().ifEmpty { item.duration },
                ),
                dayKey = dayKey,
            )
        }
        VaultLoadResult(items = items, failed = failed, total = items.size)
    }

    /**
     * The previews of a batch of vault items, decrypted with the master key.
     *
     * One query for the whole batch — the grid asks for what is on screen, so
     * a scroll reads a page of pictures instead of one request per tile.
     */
    suspend fun loadPreviews(itemIds: List<String>): Map<String, VaultPreview> =
        withContext(Dispatchers.IO) {
            if (itemIds.isEmpty()) return@withContext emptyMap()
            val key = masterKey()
                ?: throw ImgVaultException("The vault is locked — unlock it to read this file.")
            val rows = client().query(PREVIEW_SQL, listOf(JsonArray(itemIds.map { JsonPrimitive(it) })))
            val encrypted = mutableMapOf<String, String>()
            rows.forEach { row ->
                val id = row["item_id"].asTextOrEmpty()
                val value = row["preview_encrypted"].asTextOrEmpty()
                if (id.isNotEmpty() && value.isNotEmpty()) encrypted[id] = value
            }
            itemIds.associateWith { id ->
                val value = encrypted[id]
                when {
                    value == null -> VaultPreview.Missing
                    else -> try {
                        VaultPreview.Image(VaultCrypto.decryptPreviewBytes(key, value))
                    } catch (error: Exception) {
                        VaultPreview.Failed(
                            error.message ?: "The preview could not be decrypted with this vault key.",
                        )
                    }
                }
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

    /**
     * Download + decrypt a vault VIDEO to a cache file, then hand the file to
     * the player.
     *
     * The blob is never held in memory: the encrypted bytes stream straight
     * from the host through the IVG1 chunk decrypt into the file, so a
     * hundred-megabyte video does not need a hundred megabytes of heap. The
     * file is written to a `.tmp` sibling and renamed only when the whole
     * blob decrypted — a file with the final name is always complete, so a
     * second open reuses it instead of downloading again.
     *
     * The blob lives on every host the item lists. Telegram is tried first
     * when its bot token is configured; without the token the TeraBox copy
     * is the one that can play. A host that fails does not hide the others
     * — when every host fails, the error names them all.
     */
    suspend fun loadVaultVideoFile(item: VaultItem, cacheDir: File): File =
        withContext(Dispatchers.IO) {
            val key = masterKey()
                ?: throw ImgVaultException("The vault is locked — unlock it to read this file.")
            val target = File(cacheDir, "vault-video-${item.id}.${videoFileExtension(item)}")
            if (target.exists() && target.length() > 0L) return@withContext target

            val failures = mutableListOf<String>()
            if (item.raw.encryptedBlobFileId.isNotEmpty() && settings.telegramBotToken == null) {
                failures += "telegram: no bot token is configured (add it in Settings)"
            }
            val candidates = mutableListOf<Pair<String, String>>()
            for (host in vaultVideoHosts(item, settings.telegramBotToken != null)) {
                when (host) {
                    "telegram" -> runCatching { telegramFileUrl(item.raw.encryptedBlobFileId) }
                        .onSuccess { candidates += "telegram" to it }
                        .onFailure { failures += "telegram: ${it.message}" }
                    "terabox" -> candidates += "terabox" to item.raw.encryptedBlobUrl
                }
            }
            if (candidates.isEmpty()) {
                if (failures.isEmpty()) {
                    throw ImgVaultException(
                        "This vault blob has no readable host link (file id and url are both empty). " +
                            "Open it from the extension.",
                    )
                }
                throw ImgVaultException(
                    "The vault video could not be read — " + failures.joinToString("; "),
                )
            }

            for ((host, url) in candidates) {
                try {
                    downloadAndDecryptVideo(key, url, target)
                    return@withContext target
                } catch (error: Exception) {
                    failures += "$host: ${error.message ?: error::class.java.simpleName}"
                }
            }
            throw ImgVaultException(
                "The vault video could not be read from any host — " + failures.joinToString("; "),
            )
        }

    /** stream one host's encrypted blob through the IVG1 decrypt into the file */
    private fun downloadAndDecryptVideo(key: SecretKey, url: String, target: File) {
        val tmp = File(target.parentFile, "${target.name}.tmp")
        val request = Request.Builder().url(url).get().build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw ImgVaultException("GET $url failed (HTTP ${response.code})")
            }
            val body = response.body ?: throw ImgVaultException("GET $url returned no body")
            body.byteStream().use { stream ->
                FileOutputStream(tmp).use { out ->
                    val written = decryptVaultStreamToFile(key, stream, out)
                    out.flush()
                    if (written != tmp.length()) {
                        throw ImgVaultException(
                            "The vault video decrypted to ${tmp.length()} bytes, but the blob " +
                                "says $written — the download is incomplete.",
                        )
                    }
                }
            }
        }
        if (!tmp.renameTo(target)) {
            // a rename across volumes can fail; fall back to a copy
            tmp.copyTo(target, overwrite = true)
            tmp.delete()
        }
    }

    private fun downloadFromTelegram(fileId: String): ByteArray = getBytes(telegramFileUrl(fileId))

    /**
     * The download URL of a Telegram-hosted vault blob.
     *
     * The Bot API hands over a file path, and the file itself is served from
     * `api.telegram.org/file` — the same URL the byte download uses, so the
     * video can stream it instead of holding the whole blob in memory.
     */
    private fun telegramFileUrl(fileId: String): String {
        val token = settings.telegramBotToken
            ?: throw ImgVaultException(
                "This vault blob lives on Telegram, but no bot token is configured. Add it in Settings.",
            )
        val infoUrl = "https://api.telegram.org/bot$token/getFile?file_id=$fileId"
        val infoBody = getText(infoUrl)
        val root = runCatching { json.parseToJsonElement(infoBody).jsonObject }.getOrElse { error ->
            throw ImgVaultException("Telegram getFile answered with something that is not JSON", error)
        }
        val ok = root["ok"].asTextOrEmpty() == "true"
        if (!ok) {
            val description = root["description"].asTextOrEmpty().ifEmpty { "unknown error" }
            throw ImgVaultException("Telegram refused to hand over the vault file: $description")
        }
        val filePath = root["result"].asJsonObjectOrEmpty()["file_path"].asTextOrEmpty()
            .ifEmpty { throw ImgVaultException("Telegram did not return a file path for the vault blob") }
        return "https://api.telegram.org/file/bot$token/$filePath"
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
         * The system rows are not vault items.
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
              and left(id, 9) <> '__imgvault_'
              and coalesce(extra_metadata->>'systemType', '') <> 'secretVaultConfig'
              and (
                extra_metadata->>'isVaulted' = 'true'
                or extra_metadata->>'encryptedMetadata' is not null
                or extra_metadata->>'vaultHost' is not null
                or extra_metadata->>'vaultHosts' is not null
              )
            order by internal_added_timestamp desc, created_at desc
        """.trimIndent()

        /** the vault configuration the extension writes into its own row */
        val VAULT_CONFIG_SQL = """
            select extra_metadata
            from public.media_items
            where id = '__imgvault_vault_config__'
            limit 1
        """.trimIndent()

        /**
         * The encrypted previews of a batch of vault items.
         *
         * The extension encrypts a small JPEG of every vaulted item and stores
         * it here — the only picture the phone can show without downloading
         * the encrypted blob from its host.
         */
        val PREVIEW_SQL = """
            select item_id, preview_encrypted
            from public.media_item_previews
            where item_id = any($1)
        """.trimIndent()
    }
}

/**
 * Decrypt an encrypted vault blob from a stream into a file, chunk by chunk.
 *
 * This is the streaming twin of [VaultCrypto.decryptBlob]: the same IVG1
 * chunk layout and the same per-chunk decrypt, but the encrypted bytes are
 * read from the stream and the plaintext is written out as it decrypts, so
 * a video never has to sit in memory whole. A legacy single-shot blob
 * (`iv || ciphertext || tag`, no magic header) is decrypted the same way the
 * byte version does it.
 *
 * @return the number of plaintext bytes written
 */
internal fun decryptVaultStreamToFile(
    key: SecretKey,
    input: InputStream,
    output: OutputStream,
): Long {
    val headerBytes = ByteArray(VaultCrypto.VAULT_HEADER_SIZE)
    readExactly(input, headerBytes, 0, headerBytes.size)
    val header = VaultCrypto.parseVaultBlobHeader(headerBytes)
    if (header == null) {
        // legacy single-shot: the 16 bytes already read are the IV, so the
        // whole blob is those bytes plus the rest of the stream
        val rest = input.readBytes()
        val plain = VaultCrypto.decryptRaw(key, headerBytes + rest)
        output.write(plain)
        return plain.size.toLong()
    }
    val layout = VaultCrypto.getVaultChunkLayout(header.total, header.chunkSize)
    var written = 0L
    for (index in 0 until layout.chunkCount) {
        val length = layout.encryptedChunkLength(index)
        val encrypted = ByteArray(length)
        readExactly(input, encrypted, 0, length)
        val plain = VaultCrypto.decryptEncryptedChunk(key, encrypted)
        output.write(plain)
        written += plain.size
    }
    return written
}

/** read exactly `length` bytes, or fail loudly when the stream ends early */
internal fun readExactly(input: InputStream, buffer: ByteArray, offset: Int, length: Int) {
    var read = 0
    while (read < length) {
        val n = input.read(buffer, offset + read, length - read)
        if (n < 0) {
            throw ImgVaultException(
                "The vault blob ended early: expected $length bytes, got $read.",
            )
        }
        read += n
    }
}

/**
 * Which hosts can serve this vault blob, in the order to try them.
 *
 * Telegram is first when its bot token is configured; without the token it
 * is not a candidate at all, so the TeraBox copy is the one that plays.
 * A blob with no host link at all has no candidates.
 */
internal fun vaultVideoHosts(item: VaultItem, telegramTokenConfigured: Boolean): List<String> {
    val hosts = mutableListOf<String>()
    if (item.raw.encryptedBlobFileId.isNotEmpty() && telegramTokenConfigured) hosts += "telegram"
    if (item.raw.encryptedBlobUrl.startsWith("http")) hosts += "terabox"
    return hosts
}

/**
 * The extension for a cached vault video, so the player can tell the
 * container.
 *
 * The decrypted mime type names it first; the file name's own extension is
 * the fallback. The player sniffs the container anyway, so the extension is
 * a hint, not a promise.
 */
internal fun videoFileExtension(item: VaultItem): String {
    val fromMime = when (item.mimeType.lowercase()) {
        "video/mp4" -> "mp4"
        "video/webm" -> "webm"
        "video/quicktime" -> "mov"
        "video/x-matroska" -> "mkv"
        "video/x-msvideo" -> "avi"
        "video/3gpp" -> "3gp"
        else -> ""
    }
    if (fromMime.isNotEmpty()) return fromMime
    val fromName = item.fileName.substringAfterLast('.', "").lowercase()
    return fromName.ifEmpty { "mp4" }
}
