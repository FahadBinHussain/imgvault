package com.imgvault.app.core.crypto

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * The ImgVault vault crypto — a direct port of `packages/shared/vaultCrypto.js`.
 *
 * MODEL: key wrapping. A random 256-bit master key encrypts all vault blobs
 * and metadata. The vault passcode derives a passcode key (PBKDF2) which only
 * encrypts the WRAPPED master key. Changing the passcode re-wraps the master
 * key only — vault blobs are never re-encrypted.
 *
 * The JS file stays the source of truth for the format (the repo's
 * `check-shared-twins` rule). This port must stay byte-compatible:
 *
 *   - passcode key: PBKDF2-HMAC-SHA256, 100_000 iterations, 16-byte salt
 *   - AES-256-GCM, 12-byte IV, 16-byte tag, tag appended to the ciphertext
 *   - blob format IVG1: "IVG1" (4) || total size u64 LE (8) || chunk size u32 LE (4),
 *     then 8 MiB chunks of iv(12) || ciphertext || tag(16)
 *   - metadata: single-shot AES-GCM, base64 in `encryptedMetadata`
 *   - the passcode is never stored
 */
object VaultCrypto {
    const val KDF_ITERATIONS = 100_000
    const val VAULT_VERSION = 2

    const val VAULT_HEADER_SIZE = 16
    const val VAULT_IV_SIZE = 12
    const val VAULT_TAG_SIZE = 16
    const val VAULT_CHUNK_SIZE = 8 * 1024 * 1024

    private val random = SecureRandom()

    // -----------------------------------------------------------------------
    // passcode gate + key wrapping
    // -----------------------------------------------------------------------

    /** the legacy gate hash: SHA-256 over "<salt>:<passcode>", hex */
    fun hashVaultPasscode(passcode: String, salt: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("$salt:$passcode".toByteArray(Charsets.UTF_8))
        return digest.toHex()
    }

    /** PBKDF2-HMAC-SHA256 -> AES-256 key */
    fun derivePasscodeKey(
        passcode: String,
        saltHex: String,
        iterations: Int = KDF_ITERATIONS,
    ): SecretKey {
        val spec = PBEKeySpec(passcode.toCharArray(), saltHex.hexToBytes(), iterations, 256)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        return SecretKeySpec(factory.generateSecret(spec).encoded, "AES")
    }

    /** AES-GCM encrypt: returns iv || ciphertext || tag */
    fun encryptRaw(key: SecretKey, bytes: ByteArray): ByteArray {
        val iv = ByteArray(VAULT_IV_SIZE).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(VAULT_TAG_SIZE * 8, iv))
        val encrypted = cipher.doFinal(bytes)
        return ByteArray(iv.size + encrypted.size).also {
            System.arraycopy(iv, 0, it, 0, iv.size)
            System.arraycopy(encrypted, 0, it, iv.size, encrypted.size)
        }
    }

    /** AES-GCM decrypt of iv || ciphertext || tag */
    fun decryptRaw(key: SecretKey, data: ByteArray): ByteArray {
        require(data.size > VAULT_IV_SIZE) { "Encrypted payload is too short to hold an IV" }
        val iv = data.copyOfRange(0, VAULT_IV_SIZE)
        val ciphertext = data.copyOfRange(VAULT_IV_SIZE, data.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(VAULT_TAG_SIZE * 8, iv))
        return cipher.doFinal(ciphertext)
    }

    /** a fresh vault config from a passcode */
    fun createVaultConfig(passcode: String): VaultConfig {
        val salt = randomBytes(16).toHex()
        val passHash = hashVaultPasscode(passcode, salt)
        val masterKeyBytes = randomBytes(32)
        val kdfSalt = randomBytes(16).toHex()
        val passcodeKey = derivePasscodeKey(passcode, kdfSalt, KDF_ITERATIONS)
        val wrapped = encryptRaw(passcodeKey, masterKeyBytes)
        return VaultConfig(
            salt = salt,
            passHash = passHash,
            kdfSalt = kdfSalt,
            kdfIterations = KDF_ITERATIONS,
            wrappedMasterKey = Base64.getEncoder().encodeToString(wrapped),
            vaultVersion = VAULT_VERSION,
        )
    }

    /** unwrap the master key with the passcode */
    fun unwrapMasterKey(config: VaultConfig, passcode: String): SecretKey {
        if (config.kdfSalt.isEmpty() || config.wrappedMasterKey.isEmpty()) {
            throw VaultCryptoException(
                "Vault config has no wrapped master key (legacy vault — re-save the passcode to enable encryption).",
            )
        }
        val passcodeKey = derivePasscodeKey(passcode, config.kdfSalt, config.kdfIterations)
        val masterKeyBytes = decryptRaw(passcodeKey, Base64.getDecoder().decode(config.wrappedMasterKey))
        return SecretKeySpec(masterKeyBytes, "AES")
    }

    /** re-wrap the master key under a new passcode (blobs untouched) */
    fun rewrapMasterKey(config: VaultConfig, oldPasscode: String, newPasscode: String): VaultConfig {
        val masterKey = unwrapMasterKey(config, oldPasscode)
        val salt = randomBytes(16).toHex()
        val kdfSalt = randomBytes(16).toHex()
        val passcodeKey = derivePasscodeKey(newPasscode, kdfSalt, KDF_ITERATIONS)
        return config.copy(
            salt = salt,
            passHash = hashVaultPasscode(newPasscode, salt),
            kdfSalt = kdfSalt,
            kdfIterations = KDF_ITERATIONS,
            wrappedMasterKey = Base64.getEncoder().encodeToString(encryptRaw(passcodeKey, masterKey.encoded)),
            vaultVersion = VAULT_VERSION,
        )
    }

    // -----------------------------------------------------------------------
    // metadata (single-shot AES-GCM, base64)
    // -----------------------------------------------------------------------

    fun encryptMetadata(key: SecretKey, payloadJson: String): String =
        Base64.getEncoder().encodeToString(encryptRaw(key, payloadJson.toByteArray(Charsets.UTF_8)))

    fun decryptMetadata(key: SecretKey, base64: String): String =
        String(decryptRaw(key, Base64.getDecoder().decode(base64)), Charsets.UTF_8)

    // -----------------------------------------------------------------------
    // blobs (IVG1)
    // -----------------------------------------------------------------------

    /** the 16-byte IVG1 header */
    data class VaultHeader(val total: Long, val chunkSize: Int)

    fun parseVaultBlobHeader(headerBytes: ByteArray): VaultHeader? {
        if (headerBytes.size < VAULT_HEADER_SIZE) return null
        val magic = String(headerBytes, 0, 4, Charsets.US_ASCII)
        if (magic != "IVG1") return null
        val buffer = ByteBuffer.wrap(headerBytes, 0, VAULT_HEADER_SIZE).order(ByteOrder.LITTLE_ENDIAN)
        return VaultHeader(
            total = buffer.getLong(4),
            chunkSize = buffer.getInt(12),
        )
    }

    /** the layout of a chunked IVG1 blob */
    data class ChunkLayout(
        val total: Long,
        val chunkSize: Int,
        val chunkCount: Int,
        val encryptedSize: Long,
    ) {
        fun encryptedChunkOffset(index: Int): Long =
            VAULT_HEADER_SIZE + index.toLong() * (VAULT_IV_SIZE + chunkSize + VAULT_TAG_SIZE)

        fun encryptedChunkLength(index: Int): Int {
            val plain = minOf(chunkSize.toLong(), total - index.toLong() * chunkSize)
            return VAULT_IV_SIZE + plain.toInt() + VAULT_TAG_SIZE
        }
    }

    fun getVaultChunkLayout(total: Long, chunkSize: Int): ChunkLayout {
        val chunkCount = maxOf(1L, (total + chunkSize - 1) / chunkSize).toInt()
        val stride = VAULT_IV_SIZE.toLong() + chunkSize + VAULT_TAG_SIZE
        val lastPlain = total - (chunkCount - 1).toLong() * chunkSize
        return ChunkLayout(
            total = total,
            chunkSize = chunkSize,
            chunkCount = chunkCount,
            encryptedSize = VAULT_HEADER_SIZE +
                (chunkCount - 1).toLong() * stride +
                (VAULT_IV_SIZE + lastPlain + VAULT_TAG_SIZE),
        )
    }

    /** decrypt one encrypted chunk (iv(12) || ciphertext || tag) */
    fun decryptEncryptedChunk(key: SecretKey, encryptedChunk: ByteArray): ByteArray =
        decryptRaw(key, encryptedChunk)

    /**
     * Decrypt a whole blob.
     *
     * Handles the chunked IVG1 format AND the legacy single-shot format
     * (`iv || ciphertext || tag`, no magic header), so items encrypted before
     * the chunked format stay readable.
     */
    fun decryptBlob(key: SecretKey, bytes: ByteArray): ByteArray {
        val header = if (bytes.size >= VAULT_HEADER_SIZE) parseVaultBlobHeader(bytes) else null
        if (header == null) return decryptRaw(key, bytes)

        val layout = getVaultChunkLayout(header.total, header.chunkSize)
        val out = java.io.ByteArrayOutputStream()
        var offset = VAULT_HEADER_SIZE
        for (index in 0 until layout.chunkCount) {
            val length = layout.encryptedChunkLength(index)
            if (offset + length > bytes.size) {
                throw VaultCryptoException(
                    "Vault blob is truncated: expected ${layout.encryptedSize} bytes, got ${bytes.size}",
                )
            }
            out.write(decryptEncryptedChunk(key, bytes.copyOfRange(offset, offset + length)))
            offset += length
        }
        return out.toByteArray()
    }

    /** encrypt a blob into the IVG1 chunked format */
    fun encryptBlob(key: SecretKey, bytes: ByteArray): ByteArray {
        val chunkSize = VAULT_CHUNK_SIZE
        val header = ByteArray(VAULT_HEADER_SIZE).also { buffer ->
            System.arraycopy("IVG1".toByteArray(Charsets.US_ASCII), 0, buffer, 0, 4)
            val view = ByteBuffer.wrap(buffer).order(ByteOrder.LITTLE_ENDIAN)
            view.putLong(4, bytes.size.toLong())
            view.putInt(12, chunkSize)
        }
        val out = java.io.ByteArrayOutputStream()
        out.write(header)
        var offset = 0
        while (offset < bytes.size || bytes.isEmpty()) {
            val end = minOf(offset + chunkSize, bytes.size)
            val plain = if (bytes.isEmpty()) ByteArray(0) else bytes.copyOfRange(offset, end)
            out.write(encryptRaw(key, plain))
            offset = end
            if (bytes.isEmpty()) break
        }
        return out.toByteArray()
    }

    // -----------------------------------------------------------------------
    // small helpers
    // -----------------------------------------------------------------------

    fun randomBytes(size: Int): ByteArray = ByteArray(size).also { random.nextBytes(it) }
}

// ---------------------------------------------------------------------------
// hex helpers (top level so both the app and the unit tests can use them)
// ---------------------------------------------------------------------------

fun ByteArray.toHex(): String {
    val out = StringBuilder(size * 2)
    for (byte in this) {
        val value = byte.toInt() and 0xFF
        out.append(HEX[value shr 4])
        out.append(HEX[value and 0x0F])
    }
    return out.toString()
}

fun String.hexToBytes(): ByteArray {
    require(length % 2 == 0) { "Hex string must have an even length" }
    return ByteArray(length / 2) { index ->
        val high = Character.digit(this[index * 2], 16)
        val low = Character.digit(this[index * 2 + 1], 16)
        if (high < 0 || low < 0) throw VaultCryptoException("Not a hex string: $this")
        ((high shl 4) or low).toByte()
    }
}

private const val HEX = "0123456789abcdef"

/** the stored vault config (the JS shape, camelCase) */
data class VaultConfig(
    val salt: String = "",
    val passHash: String = "",
    val kdfSalt: String = "",
    val kdfIterations: Int = VaultCrypto.KDF_ITERATIONS,
    val wrappedMasterKey: String = "",
    val vaultVersion: Int = VaultCrypto.VAULT_VERSION,
)

/** something went wrong in the vault crypto — always names what failed */
class VaultCryptoException(message: String, cause: Throwable? = null) : Exception(message, cause)
