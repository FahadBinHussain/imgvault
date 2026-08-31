/**
 * @fileoverview Pure WebCrypto vault encryption for ImgVault.
 *
 * Model: key wrapping. a random 256-bit master key encrypts all vault blobs
 * and metadata. the vault passcode derives a passcode key (PBKDF2) which only
 * encrypts the wrapped master key. changing the passcode re-wraps the master
 * key only — vault blobs are never re-encrypted.
 *
 * Backward compat: the legacy config shape {salt, passHash} (SHA-256 gate) is
 * kept; new fields are added alongside it so existing vaults keep working and
 * are upgraded to encryption on first save.
 */

const KDF_ITERATIONS = 100000;
const VAULT_VERSION = 2;

const bytesToHex = (bytes) =>
  Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');

const hexToBytes = (hex) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
};

const toB64 = (bytes) => {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
};

const fromB64 = (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Legacy gate hash (kept for the existing unlock flow + config comparison).
 */
export async function hashVaultPasscode(passcode, salt) {
  const data = enc.encode(`${salt}:${passcode}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(digest);
}

/**
 * Derive the passcode key (AES-GCM 256) via PBKDF2.
 */
async function derivePasscodeKey(passcode, saltHex, iterations = KDF_ITERATIONS) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passcode),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: hexToBytes(saltHex),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * AES-GCM encrypt a raw byte payload with a CryptoKey.
 * Returns base64 `iv || ciphertext || tag`.
 */
async function gcmEncryptRaw(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    bytes
  );
  const out = new Uint8Array(iv.length + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), iv.length);
  return toB64(out);
}

/**
 * AES-GCM decrypt a base64 `iv || ciphertext || tag` payload.
 * Returns the raw bytes.
 */
async function gcmDecryptRaw(key, b64) {
  const data = fromB64(b64);
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return new Uint8Array(plain);
}

/**
 * Create a new vault config from a passcode.
 * @param {string} passcode
 * @returns {Promise<Object>} config {salt, passHash, kdfSalt, kdfIterations, wrappedMasterKey, vaultVersion}
 */
export async function createVaultConfig(passcode) {
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const passHash = await hashVaultPasscode(passcode, salt);

  // master key = random 256-bit AES key
  const masterKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const masterKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', masterKey));

  // wrap the master key with the passcode key
  const kdfSalt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const passcodeKey = await derivePasscodeKey(passcode, kdfSalt, KDF_ITERATIONS);
  const wrappedMasterKey = await gcmEncryptRaw(passcodeKey, masterKeyBytes);

  return {
    salt,
    passHash,
    kdfSalt,
    kdfIterations: KDF_ITERATIONS,
    wrappedMasterKey,
    vaultVersion: VAULT_VERSION,
  };
}

/**
 * Unwrap the master key from a vault config using the passcode.
 * @returns {Promise<CryptoKey>} AES-GCM master key
 */
export async function unwrapMasterKey(config, passcode) {
  if (!config?.kdfSalt || !config?.wrappedMasterKey) {
    throw new Error('Vault config has no wrapped master key (legacy vault — re-save the passcode to enable encryption).');
  }
  const passcodeKey = await derivePasscodeKey(passcode, config.kdfSalt, config.kdfIterations || KDF_ITERATIONS);
  const masterKeyBytes = await gcmDecryptRaw(passcodeKey, config.wrappedMasterKey);
  return crypto.subtle.importKey(
    'raw',
    masterKeyBytes,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Re-wrap the master key under a new passcode (passcode change).
 * Keeps blobs untouched; only the wrapper is re-encrypted.
 * @returns {Promise<Object>} new config (same salt/passHash replaced)
 */
export async function rewrapMasterKey(config, oldPasscode, newPasscode) {
  const masterKey = await unwrapMasterKey(config, oldPasscode);
  const masterKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', masterKey));

  const newSalt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const newPassHash = await hashVaultPasscode(newPasscode, newSalt);
  const newKdfSalt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const newPasscodeKey = await derivePasscodeKey(newPasscode, newKdfSalt, KDF_ITERATIONS);
  const wrappedMasterKey = await gcmEncryptRaw(newPasscodeKey, masterKeyBytes);

  return {
    ...config,
    salt: newSalt,
    passHash: newPassHash,
    kdfSalt: newKdfSalt,
    kdfIterations: KDF_ITERATIONS,
    wrappedMasterKey,
    vaultVersion: VAULT_VERSION,
  };
}

/**
 * Encrypt a Blob with the master key, chunked so large files stream through
 * memory instead of one giant arrayBuffer (which stalls MV3 service workers
 * for multi-GB files).
 *
 * Output format:
 *   magic "IVG1" (4) || totalSize u64 (8) || chunkSize u32 (4)
 *   then chunks: each = 12-byte IV || AES-GCM ciphertext (chunkSize or
 *   remainder, tag appended by WebCrypto).
 *
 * @param {CryptoKey} masterKey
 * @param {Blob} blob
 * @param {(progress:{loaded:number,total:number,percent:number,stage:string})=>void} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function encryptBlob(masterKey, blob, onProgress) {
  const CHUNK = 8 * 1024 * 1024; // 8 MiB
  const total = blob.size;
  const chunkCount = Math.max(1, Math.ceil(total / CHUNK));

  const header = new ArrayBuffer(16);
  const headerView = new DataView(header);
  const headerBytes = new Uint8Array(header);
  headerBytes.set(enc.encode('IVG1'), 0);
  headerView.setBigUint64(4, BigInt(total), true);
  headerView.setUint32(12, CHUNK, true);

  const parts = [headerBytes];
  let done = 0;

  for (let i = 0; i < chunkCount; i++) {
    const start = i * CHUNK;
    const end = Math.min(start + CHUNK, total);
    const slice = await blob.slice(start, end).arrayBuffer();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, masterKey, slice);
    const chunkOut = new Uint8Array(iv.length + ciphertext.byteLength);
    chunkOut.set(iv, 0);
    chunkOut.set(new Uint8Array(ciphertext), iv.length);
    parts.push(chunkOut);

    done += (end - start);
    if (typeof onProgress === 'function') {
      onProgress({
        loaded: done,
        total,
        percent: Math.round((done / total) * 100),
        stage: 'encrypt',
      });
    }
  }

  return new Blob(parts, { type: 'application/octet-stream' });
}

/**
 * Decrypt a chunked blob created by encryptBlob. Detects the legacy
 * single-shot format (`iv || ciphertext || tag`, no magic header) and handles
 * it too, so items encrypted before the chunked format stay readable.
 * @returns {Promise<Blob>}
 */
export async function decryptBlob(masterKey, blob, mimeType = 'application/octet-stream', onProgress) {
  const first = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const isChunked = dec.decode(first) === 'IVG1';

  if (!isChunked) {
    const data = new Uint8Array(await blob.arrayBuffer());
    const iv = data.slice(0, 12);
    const ciphertext = data.slice(12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, masterKey, ciphertext);
    return new Blob([plain], { type: mimeType });
  }

  const headerBuf = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const header = new DataView(headerBuf.buffer);
  const total = Number(header.getBigUint64(4, true));
  const CHUNK = header.getUint32(12, true);

  const parts = [];
  let offset = 16;
  let done = 0;

  while (offset < blob.size) {
    const remaining = blob.size - offset;
    // each chunk = 12 (iv) + (chunkSize | remainder) + 16 (tag)
    const thisChunk = Math.min(CHUNK, total - done);
    const chunkLen = 12 + thisChunk + 16;
    const chunkBytes = new Uint8Array(await blob.slice(offset, offset + chunkLen).arrayBuffer());
    const iv = chunkBytes.slice(0, 12);
    const ciphertext = chunkBytes.slice(12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, masterKey, ciphertext);
    parts.push(plain);
    offset += chunkLen;
    done += thisChunk;

    if (typeof onProgress === 'function') {
      onProgress({
        loaded: done,
        total,
        percent: Math.round((done / total) * 100),
        stage: 'decrypt',
      });
    }
  }

  return new Blob(parts, { type: mimeType });
}

/**
 * Encrypt a JSON metadata payload with the master key.
 * @returns {Promise<string>} base64 `iv || ciphertext || tag`
 */
export async function encryptMetadata(masterKey, payload) {
  return gcmEncryptRaw(masterKey, enc.encode(JSON.stringify(payload)));
}

/**
 * Decrypt a base64 metadata payload with the master key.
 * @returns {Promise<Object>}
 */
export async function decryptMetadata(masterKey, b64) {
  const bytes = await gcmDecryptRaw(masterKey, b64);
  return JSON.parse(dec.decode(bytes));
}

// ---------------------------------------------------------------------------
// Streaming / random-access decrypt support
//
// The encrypted blob layout (see encryptBlob):
//   [16-byte header]  "IVG1" + uint64le(totalPlaintext) + uint32le(chunkSize)
//   [chunk 0]  iv(12) || aes-gcm(plain0)            ; plain0 = min(chunkSize, total)
//   [chunk 1]  iv(12) || aes-gcm(plain1)
//   ...
// Every chunk is independently encrypted with its own random IV, so a plaintext
// byte range can be served by decrypting only the chunks that cover it — same
// seek model as rclone crypt. This powers the vault-stream HTTP endpoint.
// ---------------------------------------------------------------------------

export const VAULT_HEADER_SIZE = 16;
export const VAULT_IV_SIZE = 12;
export const VAULT_TAG_SIZE = 16;

/**
 * Parse the 16-byte IVG1 header.
 * @param {Uint8Array} headerBytes - at least 16 bytes
 * @returns {{total:number, chunkSize:number}|null} null when not an IVG1 blob
 */
export function parseVaultBlobHeader(headerBytes) {
  const view = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
  let magic = '';
  for (let i = 0; i < 4; i++) magic += String.fromCharCode(headerBytes[i]);
  if (magic !== 'IVG1') return null;
  const total = Number(view.getBigUint64(4, true));
  const chunkSize = view.getUint32(12, true);
  return { total, chunkSize };
}

/**
 * Layout helpers for a chunked IVG1 blob. Encrypted chunk i lives at
 * `16 + i*(ivSize + chunkSize + tagSize)` and holds `ivSize + plainLen(i) + tagSize`
 * bytes, where plainLen(i) = min(chunkSize, total - i*chunkSize).
 * @param {number} total - plaintext size
 * @param {number} chunkSize
 */
export function getVaultChunkLayout(total, chunkSize) {
  const chunkCount = Math.max(1, Math.ceil(total / chunkSize));
  const stride = VAULT_IV_SIZE + chunkSize + VAULT_TAG_SIZE; // bytes per full chunk
  return {
    total,
    chunkSize,
    chunkCount,
    encryptedSize: VAULT_HEADER_SIZE + (chunkCount - 1) * stride + (VAULT_IV_SIZE + (total - (chunkCount - 1) * chunkSize) + VAULT_TAG_SIZE),
    encryptedChunkOffset: (i) => VAULT_HEADER_SIZE + i * stride,
    encryptedChunkLength: (i) => {
      const plainLen = Math.min(chunkSize, total - i * chunkSize);
      return VAULT_IV_SIZE + plainLen + VAULT_TAG_SIZE;
    },
    plainChunkStart: (i) => i * chunkSize,
    plainChunkLength: (i) => Math.min(chunkSize, total - i * chunkSize),
  };
}

/**
 * Decrypt a single encrypted chunk (`iv(12) || ciphertext`).
 * @param {CryptoKey} masterKey
 * @param {Uint8Array} encryptedChunk
 * @returns {Promise<Uint8Array>} plaintext
 */
export async function decryptEncryptedChunk(masterKey, encryptedChunk) {
  const iv = encryptedChunk.slice(0, VAULT_IV_SIZE);
  const ciphertext = encryptedChunk.slice(VAULT_IV_SIZE);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, masterKey, ciphertext);
  return new Uint8Array(plain);
}

/**
 * Generate an opaque udrop filename for an encrypted blob.
 */
export function generateOpaqueName() {
  return `${bytesToHex(crypto.getRandomValues(new Uint8Array(16)))}.bin`;
}

export const vaultCrypto = {
  createVaultConfig,
  unwrapMasterKey,
  rewrapMasterKey,
  encryptBlob,
  decryptBlob,
  decryptEncryptedChunk,
  parseVaultBlobHeader,
  getVaultChunkLayout,
  encryptMetadata,
  decryptMetadata,
  hashVaultPasscode,
  generateOpaqueName,
};
