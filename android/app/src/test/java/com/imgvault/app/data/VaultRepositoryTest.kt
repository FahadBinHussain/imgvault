package com.imgvault.app.data

import com.imgvault.app.core.crypto.VaultCrypto
import com.imgvault.app.data.model.MediaItem
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * The vault video path decrypts the blob from a STREAM into a file — the
 * blob is never held in memory whole, so a video does not need a video-sized
 * heap. These tests pin the stream decrypt against the byte decrypt: the
 * same encrypted bytes must come out identical either way.
 */
class VaultRepositoryTest {

    private val key = SecretKeySpec(ByteArray(32) { it.toByte() }, "AES")

    @Test
    fun `an IVG1 blob decrypts from a stream to the same plaintext`() {
        val plain = "hello vault, this is the plaintext that must survive the round trip"
            .toByteArray(Charsets.UTF_8)
        val encrypted = VaultCrypto.encryptBlob(key, plain)

        val out = ByteArrayOutputStream()
        val written = decryptVaultStreamToFile(
            key,
            ByteArrayInputStream(encrypted),
            out,
        )

        assertEquals(plain.size.toLong(), written)
        assertArrayEquals(plain, out.toByteArray())
    }

    @Test
    fun `an IVG1 blob larger than one chunk decrypts from a stream`() {
        // one full 8 MiB chunk plus a second partial one — the loop has to
        // cross a chunk boundary and size the last chunk right
        val plain = ByteArray(VaultCrypto.VAULT_CHUNK_SIZE + 100) { (it % 251).toByte() }
        val encrypted = VaultCrypto.encryptBlob(key, plain)

        val out = ByteArrayOutputStream()
        val written = decryptVaultStreamToFile(
            key,
            ByteArrayInputStream(encrypted),
            out,
        )

        assertEquals(plain.size.toLong(), written)
        assertArrayEquals(plain, out.toByteArray())
    }

    @Test
    fun `a legacy single-shot blob decrypts from a stream`() {
        val plain = "a vault item encrypted before the chunked format"
            .toByteArray(Charsets.UTF_8)
        val encrypted = VaultCrypto.encryptRaw(key, plain)

        val out = ByteArrayOutputStream()
        val written = decryptVaultStreamToFile(
            key,
            ByteArrayInputStream(encrypted),
            out,
        )

        assertEquals(plain.size.toLong(), written)
        assertArrayEquals(plain, out.toByteArray())
    }

    @Test
    fun `a truncated blob fails loudly instead of playing a half file`() {
        val plain = ByteArray(1000) { it.toByte() }
        val encrypted = VaultCrypto.encryptBlob(key, plain)
        val cut = encrypted.copyOf(encrypted.size - 10)

        assertThrows(ImgVaultException::class.java) {
            decryptVaultStreamToFile(
                key,
                ByteArrayInputStream(cut),
                ByteArrayOutputStream(),
            )
        }
    }

    @Test
    fun `without a telegram token the terabox copy is the one that plays`() {
        val bothHosts = VaultItem(
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
        assertEquals(listOf("terabox"), vaultVideoHosts(bothHosts, telegramTokenConfigured = false))
        assertEquals(
            listOf("telegram", "terabox"),
            vaultVideoHosts(bothHosts, telegramTokenConfigured = true),
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
        assertEquals(emptyList<String>(), vaultVideoHosts(noHost, telegramTokenConfigured = true))
        assertEquals(emptyList<String>(), vaultVideoHosts(noHost, telegramTokenConfigured = false))
    }

    @Test
    fun `the video extension comes from the mime type first`() {
        val item = VaultItem(
            id = "x",
            fileName = "clip.bin",
            mimeType = "video/mp4",
            sizeBytes = 0L,
            hosts = emptyList(),
            raw = MediaItem(),
        )
        assertEquals("mp4", videoFileExtension(item))
    }

    @Test
    fun `the video extension falls back to the file name, then mp4`() {
        val named = VaultItem(
            id = "x",
            fileName = "clip.mov",
            mimeType = "",
            sizeBytes = 0L,
            hosts = emptyList(),
            raw = MediaItem(),
        )
        assertEquals("mov", videoFileExtension(named))

        val unnamed = VaultItem(
            id = "x",
            fileName = "clip",
            mimeType = "",
            sizeBytes = 0L,
            hosts = emptyList(),
            raw = MediaItem(),
        )
        assertEquals("mp4", videoFileExtension(unnamed))
    }
}
