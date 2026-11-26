package com.imgvault.app.data

import androidx.media3.common.C
import com.imgvault.app.core.crypto.VaultCrypto
import com.imgvault.app.data.model.MediaItem
import java.io.ByteArrayOutputStream
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The vault video path: the host order follows the user's default video
 * source, and the player streams the blob through a decrypting DataSource —
 * the blob is never held in memory whole and never written to a file. These
 * tests pin the host order, the encrypted-span math and the streaming
 * decrypt, all without a network: the "host" is an OkHttp interceptor
 * serving an in-memory blob with Range support.
 */
class VaultRepositoryTest {

    private val key = SecretKeySpec(ByteArray(32) { it.toByte() }, "AES")

    private fun bothHostsItem() = VaultItem(
        id = "x",
        fileName = "clip.mp4",
        mimeType = "video/mp4",
        sizeBytes = 0L,
        hosts = listOf("terabox", "telegram"),
        raw = MediaItem(
            extra = JsonObject(
                mapOf(
                    "encryptedBlobFileId" to JsonPrimitive("123"),
                    "encryptedBlobUrl" to JsonPrimitive("https://example.com/blob.bin"),
                ),
            ),
        ),
    )

    @Test
    fun `the default video source goes first and telegram is skipped without a token`() {
        val bothHosts = bothHostsItem()
        // the user picked terabox: it plays first, telegram is the fallback
        assertEquals(
            listOf("terabox"),
            vaultVideoHosts(bothHosts, "terabox", telegramTokenConfigured = false),
        )
        assertEquals(
            listOf("terabox", "telegram"),
            vaultVideoHosts(bothHosts, "terabox", telegramTokenConfigured = true),
        )
        // the user picked telegram: it plays first
        assertEquals(
            listOf("telegram", "terabox"),
            vaultVideoHosts(bothHosts, "telegram", telegramTokenConfigured = true),
        )
        // the user picked a host the vault blob does not live on (filemoon):
        // the built-in order answers instead — telegram, then terabox
        assertEquals(
            listOf("telegram", "terabox"),
            vaultVideoHosts(bothHosts, "filemoon", telegramTokenConfigured = true),
        )
        assertEquals(
            listOf("terabox"),
            vaultVideoHosts(bothHosts, "filemoon", telegramTokenConfigured = false),
        )
    }

    @Test
    fun `a blob with no host link has no video host`() {
        val noHost = VaultItem(
            id = "x",
            fileName = "clip.mp4",
            mimeType = "video/mp4",
            sizeBytes = 0L,
            hosts = emptyList(),
            raw = MediaItem(),
        )
        assertEquals(
            emptyList<String>(),
            vaultVideoHosts(noHost, "terabox", telegramTokenConfigured = true),
        )
        assertEquals(
            emptyList<String>(),
            vaultVideoHosts(noHost, "terabox", telegramTokenConfigured = false),
        )
    }

    @Test
    fun `the encrypted span covers exactly the chunks a read spans`() {
        val chunkSize = VaultCrypto.VAULT_CHUNK_SIZE
        val total = chunkSize.toLong() + 100
        // one chunk: plaintext [0, 100) lives in chunk 0 only
        assertEquals(
            16L to (16L + chunkSize + 28 - 1),
            ivg1EncryptedSpan(total, chunkSize, 0, 100),
        )
        // across the boundary: plaintext [chunkSize-10, chunkSize+10) spans
        // chunk 0 (full 8 MiB) and chunk 1 (100 bytes of plaintext)
        assertEquals(
            16L to (16L + (chunkSize + 28) + (12 + 100 + 16) - 1),
            ivg1EncryptedSpan(total, chunkSize, chunkSize - 10L, chunkSize + 10L),
        )
        // the last chunk alone: plaintext [chunkSize, total)
        assertEquals(
            (16L + chunkSize + 28) to (16L + (chunkSize + 28) + (12 + 100 + 16) - 1),
            ivg1EncryptedSpan(total, chunkSize, chunkSize.toLong(), total),
        )
    }

    @Test
    fun `a vault video streams decrypted chunks from the host`() {
        // one full 8 MiB chunk plus a second partial one — the reads have to
        // cross a chunk boundary and size the last chunk right
        val plain = ByteArray(VaultCrypto.VAULT_CHUNK_SIZE + 100) { (it % 251).toByte() }
        val encrypted = VaultCrypto.encryptBlob(key, plain)
        val source = VaultBlobDataSource(
            rangeServingClient(encrypted),
            "https://example.com/blob.bin",
            key,
        )
        val total = source.openAt(0, C.LENGTH_UNSET.toLong())
        assertEquals(plain.size.toLong(), total)

        val out = ByteArrayOutputStream()
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val read = source.read(buffer, 0, buffer.size)
            if (read < 0) break
            out.write(buffer, 0, read)
        }
        source.close()
        assertArrayEquals(plain, out.toByteArray())
    }

    @Test
    fun `a vault video can seek to the second chunk and read from there`() {
        val plain = ByteArray(VaultCrypto.VAULT_CHUNK_SIZE + 100) { (it % 251).toByte() }
        val encrypted = VaultCrypto.encryptBlob(key, plain)
        val source = VaultBlobDataSource(
            rangeServingClient(encrypted),
            "https://example.com/blob.bin",
            key,
        )
        val start = VaultCrypto.VAULT_CHUNK_SIZE.toLong()
        val total = source.openAt(start, 100)
        assertEquals(100L, total)

        val buffer = ByteArray(100)
        val read = source.read(buffer, 0, buffer.size)
        assertEquals(100, read)
        assertArrayEquals(plain.copyOfRange(start.toInt(), start.toInt() + 100), buffer)
        // the stream ends after the requested 100 bytes
        assertEquals(-1, source.read(buffer, 0, buffer.size))
        source.close()
    }

    @Test
    fun `a legacy single-shot vault video streams from memory`() {
        val plain = "a vault item encrypted before the chunked format"
            .toByteArray(Charsets.UTF_8)
        val encrypted = VaultCrypto.encryptRaw(key, plain)
        val source = VaultBlobDataSource(
            rangeServingClient(encrypted),
            "https://example.com/blob.bin",
            key,
        )
        val total = source.openAt(0, C.LENGTH_UNSET.toLong())
        assertEquals(plain.size.toLong(), total)

        val out = ByteArrayOutputStream()
        val buffer = ByteArray(64)
        while (true) {
            val read = source.read(buffer, 0, buffer.size)
            if (read < 0) break
            out.write(buffer, 0, read)
        }
        source.close()
        assertArrayEquals(plain, out.toByteArray())
    }

    /**
     * An OkHttp client that serves one in-memory blob and honours Range.
     *
     * A Range request gets 206 with exactly the requested bytes; a plain
     * GET gets 200 with the whole blob. That is the contract the streaming
     * source relies on, so the tests prove the source against it.
     */
    private fun rangeServingClient(blob: ByteArray): OkHttpClient {
        return OkHttpClient.Builder()
            .addInterceptor { chain ->
                val request = chain.request()
                val range = request.header("Range")
                val code: Int
                val body: ByteArray
                val message: String
                if (range != null && range.startsWith("bytes=")) {
                    val spec = range.removePrefix("bytes=").split("-")
                    val start = spec[0].toLong()
                    val end = spec.getOrNull(1)?.toLongOrNull() ?: (blob.size - 1).toLong()
                    val from = start.toInt()
                    val to = minOf(end + 1, blob.size.toLong()).toInt()
                    code = 206
                    body = blob.copyOfRange(from, to)
                    message = "Partial Content"
                } else {
                    code = 200
                    body = blob
                    message = "OK"
                }
                Response.Builder()
                    .request(request)
                    .protocol(Protocol.HTTP_1_1)
                    .code(code)
                    .message(message)
                    .body(body.toResponseBody("application/octet-stream".toMediaType()))
                    .build()
            }
            .build()
    }
}
