package com.imgvault.app.data

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import com.imgvault.app.core.crypto.VaultCrypto
import java.io.IOException
import javax.crypto.SecretKey
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * An ExoPlayer [DataSource] that streams a DECRYPTED vault video.
 *
 * The blob on the host is encrypted (IVG1: a 16-byte header, then 8 MiB
 * chunks of iv || ciphertext || tag). The player thinks it is reading a
 * plain video file, so this source translates every plaintext read into the
 * encrypted bytes that hold it:
 *
 *   - `open` reads the 16-byte header with ONE `Range: bytes=0-15` request
 *     and learns the plaintext size, so the player can seek and show a
 *     duration before a single frame arrives
 *   - `read` works out which IVG1 chunks the requested plaintext spans,
 *     fetches exactly those encrypted bytes with ONE `Range` request,
 *     decrypts each chunk with [VaultCrypto.decryptEncryptedChunk] and
 *     hands the player only the slice it asked for
 *   - a seek is just another `open` at a new position — no download is
 *     restarted, the next read fetches the chunks that position needs
 *
 * Nothing is ever held in memory whole and nothing is written to a file: a
 * 700 MB video starts playing after a 16-byte header fetch, and the phone
 * never holds the decrypted video on disk. The host MUST support ranged
 * reads (Telegram file URLs and TeraBox direct links both do); a host that
 * answers 200 instead of 206 fails loudly instead of downloading the whole
 * blob in secret.
 *
 * A legacy single-shot blob (no IVG1 header, `iv || ciphertext || tag`) has
 * no chunk layout to stream from, so it is downloaded and decrypted once
 * into memory and served from there — a legacy blob is small, and this
 * keeps items encrypted before the chunked format playing.
 *
 * The crypto is NOT reimplemented here: the header parse, the chunk layout
 * and the per-chunk decrypt all come from [VaultCrypto] (pinned by its
 * golden-vector tests), and [ivg1EncryptedSpan] is the pure, tested
 * translation from a plaintext span to its encrypted span.
 */
class VaultBlobDataSource(
    private val http: OkHttpClient,
    private val blobUrl: String,
    private val key: SecretKey,
) : DataSource {

    private var layout: VaultCrypto.ChunkLayout? = null
    private var legacyPlain: ByteArray? = null
    private var total: Long = 0L
    private var position: Long = 0L
    private var remaining: Long = C.LENGTH_UNSET

    override fun open(dataSpec: DataSpec): Long {
        try {
            return openInternal(dataSpec)
        } catch (error: IOException) {
            throw error
        } catch (error: Exception) {
            // ExoPlayer only knows IOException from a DataSource — a plain
            // exception would escape the loader as an unexpected crash
            // instead of a playback error the screen can show
            throw IOException(error.message, error)
        }
    }

    private fun openInternal(dataSpec: DataSpec): Long {
        val first = fetchRange(0, (VaultCrypto.VAULT_HEADER_SIZE - 1).toLong())
        val parsed = VaultCrypto.parseVaultBlobHeader(first)
        if (parsed == null) {
            // legacy single-shot: no chunk layout to stream from
            legacyPlain = VaultCrypto.decryptRaw(key, fetchAll())
            total = legacyPlain!!.size.toLong()
        } else {
            layout = VaultCrypto.getVaultChunkLayout(parsed.total, parsed.chunkSize)
            total = parsed.total
        }
        position = dataSpec.position.coerceIn(0, total)
        remaining = if (dataSpec.length == C.LENGTH_UNSET) {
            total - position
        } else {
            minOf(dataSpec.length, total - position)
        }
        return remaining
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        try {
            return readInternal(buffer, offset, length)
        } catch (error: IOException) {
            throw error
        } catch (error: Exception) {
            throw IOException(error.message, error)
        }
    }

    private fun readInternal(buffer: ByteArray, offset: Int, length: Int): Int {
        if (remaining == 0L || length <= 0) return C.RESULT_END_OF_INPUT
        val toRead = minOf(length.toLong(), remaining).toInt()
        if (toRead <= 0) return C.RESULT_END_OF_INPUT

        val legacy = legacyPlain
        if (legacy != null) {
            val available = (legacy.size - position).toInt()
            if (available <= 0) return C.RESULT_END_OF_INPUT
            val count = minOf(toRead, available)
            legacy.copyInto(buffer, offset, position.toInt(), (position + count).toInt())
            position += count
            remaining -= count
            return count
        }

        val lay = layout ?: throw ImgVaultException("The vault video source is not open.")
        val lastPlain = minOf(position + toRead, total)
        val firstChunk = (position / lay.chunkSize).toInt()
        val lastChunk = ((lastPlain - 1) / lay.chunkSize).toInt()
        val span = ivg1EncryptedSpan(total, lay.chunkSize, position, lastPlain)
        val encrypted = fetchRange(span.first, span.second)

        var copied = 0
        var chunkPlainStart = firstChunk.toLong() * lay.chunkSize
        var encryptedOffset = 0
        for (chunk in firstChunk..lastChunk) {
            val encryptedLength = lay.encryptedChunkLength(chunk)
            val encryptedChunk = encrypted.copyOfRange(
                encryptedOffset,
                encryptedOffset + encryptedLength,
            )
            val plain = VaultCrypto.decryptEncryptedChunk(key, encryptedChunk)
            val sliceStart = maxOf(position, chunkPlainStart)
            val sliceEnd = minOf(lastPlain, chunkPlainStart + plain.size)
            val sliceLength = (sliceEnd - sliceStart).toInt()
            if (sliceLength > 0) {
                plain.copyInto(
                    buffer,
                    offset + copied,
                    (sliceStart - chunkPlainStart).toInt(),
                    (sliceStart - chunkPlainStart).toInt() + sliceLength,
                )
                copied += sliceLength
            }
            encryptedOffset += encryptedLength
            chunkPlainStart += lay.chunkSize
        }
        position += copied
        remaining -= copied
        return copied
    }

    override fun getUri(): Uri = Uri.parse(blobUrl)

    override fun close() {
        // every fetch closes its own response; there is nothing held open
    }

    override fun getResponseHeaders(): Map<String, List<String>> = emptyMap()

    override fun addTransferListener(transferListener: TransferListener) {
        // the player does not need progress reports from a decrypting source
    }

    /** fetch exactly bytes [start, endInclusive] — the host must answer 206 */
    private fun fetchRange(start: Long, endInclusive: Long): ByteArray {
        val request = Request.Builder()
            .url(blobUrl)
            .header("Range", "bytes=$start-$endInclusive")
            .get()
            .build()
        http.newCall(request).execute().use { response ->
            if (response.code != 206) {
                throw ImgVaultException(
                    "GET $blobUrl with Range bytes=$start-$endInclusive returned " +
                        "HTTP ${response.code} — the host must support ranged reads to stream.",
                )
            }
            val body = response.body ?: throw ImgVaultException("GET $blobUrl returned no body")
            val bytes = body.bytes()
            val expected = (endInclusive - start + 1).toInt()
            if (bytes.size != expected) {
                throw ImgVaultException(
                    "GET $blobUrl with Range bytes=$start-$endInclusive returned " +
                        "${bytes.size} bytes, expected $expected — the download is incomplete.",
                )
            }
            return bytes
        }
    }

    /** the whole blob — only for a legacy single-shot blob, which has no chunks */
    private fun fetchAll(): ByteArray {
        val request = Request.Builder().url(blobUrl).get().build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw ImgVaultException("GET $blobUrl failed (HTTP ${response.code})")
            }
            val body = response.body ?: throw ImgVaultException("GET $blobUrl returned no body")
            return body.bytes()
        }
    }
}

/**
 * The encrypted byte span (inclusive) holding plaintext [plainStart, plainEnd).
 *
 * Chunk `i` lives at blob offset `16 + i * (chunkSize + 28)` and is
 * `12 + plainChunkSize + 16` bytes long, so the span runs from the first
 * chunk's offset to the last chunk's last byte.
 */
internal fun ivg1EncryptedSpan(
    total: Long,
    chunkSize: Int,
    plainStart: Long,
    plainEndExclusive: Long,
): Pair<Long, Long> {
    require(plainStart >= 0 && plainEndExclusive > plainStart && plainEndExclusive <= total) {
        "plaintext span [$plainStart, $plainEndExclusive) is outside a $total-byte blob"
    }
    val layout = VaultCrypto.getVaultChunkLayout(total, chunkSize)
    val firstChunk = (plainStart / chunkSize).toInt()
    val lastChunk = ((plainEndExclusive - 1) / chunkSize).toInt()
    val start = layout.encryptedChunkOffset(firstChunk)
    val end = layout.encryptedChunkOffset(lastChunk) +
        layout.encryptedChunkLength(lastChunk) - 1
    return start to end
}
