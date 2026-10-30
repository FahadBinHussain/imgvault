// Client-side vault helpers for the web app. The master key only ever lives in
// this browser tab (sessionStorage) — blobs are decrypted here, never on the server.
import {
  decryptBlob,
  decryptEncryptedChunk,
  decryptPreviewBytes,
  getVaultChunkLayout,
  parseVaultBlobHeader,
  VAULT_HEADER_SIZE,
} from 'imgvault-shared/vaultCrypto.js'

export const VAULT_SESSION_KEY = 'imgvault-vault-unlocked'

const CHUNK_FETCH_CONCURRENCY = 3

export function readVaultSession() {
  try {
    const raw = sessionStorage.getItem(VAULT_SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function writeVaultSession({ passHash, keyB64 }) {
  sessionStorage.setItem(
    VAULT_SESSION_KEY,
    JSON.stringify({ passHash, keyB64, unlockedAt: Date.now() })
  )
}

export function clearVaultSession() {
  sessionStorage.removeItem(VAULT_SESSION_KEY)
}

export async function importMasterKeyFromB64(keyB64) {
  const bin = atob(keyB64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )
}

export async function exportMasterKeyB64(masterKey) {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', masterKey))
  let bin = ''
  for (let i = 0; i < raw.length; i += 1) bin += String.fromCharCode(raw[i])
  return btoa(bin)
}

async function readErrorBody(res) {
  const text = await res.text().catch(() => '')
  if (!text) return `HTTP ${res.status}`
  try {
    const json = JSON.parse(text)
    return json?.error || `HTTP ${res.status}`
  } catch {
    return text.slice(0, 200)
  }
}

async function fetchVaultRange(id, start, end) {
  const res = await fetch(`/api/vault/blob?id=${encodeURIComponent(id)}`, {
    headers: { Range: `bytes=${start}-${end}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(await readErrorBody(res))
  }
  const bytes = new Uint8Array(await res.arrayBuffer())
  const expected = end - start + 1
  if (bytes.length !== expected) {
    throw new Error(`vault blob range ${start}-${end} returned ${bytes.length} of ${expected} bytes`)
  }
  return bytes
}

/**
 * Decrypt a stored encrypted vault blob into a playable Blob.
 * IVG1 blobs are read + decrypted one 8 MiB chunk at a time, so peak memory is
 * a few chunks instead of the whole file; legacy single-shot blobs still work.
 */
export async function decryptVaultBlob({ id, mimeType = 'application/octet-stream', masterKey, onProgress }) {
  const header = await fetchVaultRange(id, 0, VAULT_HEADER_SIZE - 1)
  const parsed = parseVaultBlobHeader(header)

  if (!parsed) {
    const res = await fetch(`/api/vault/blob?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(await readErrorBody(res))
    const raw = await res.blob()
    return decryptBlob(masterKey, raw, mimeType, onProgress)
  }

  const layout = getVaultChunkLayout(parsed.total, parsed.chunkSize)
  const parts = new Array(layout.chunkCount)
  let done = 0
  let next = 0

  const worker = async () => {
    while (next < layout.chunkCount) {
      const index = next
      next += 1
      const offset = layout.encryptedChunkOffset(index)
      const length = layout.encryptedChunkLength(index)
      const ciphertext = await fetchVaultRange(id, offset, offset + length - 1)
      parts[index] = await decryptEncryptedChunk(masterKey, ciphertext)
      done += layout.plainChunkLength(index)
      onProgress?.({
        loaded: done,
        total: layout.total,
        percent: Math.round((done / layout.total) * 100),
      })
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CHUNK_FETCH_CONCURRENCY, layout.chunkCount) }, worker)
  )

  return new Blob(parts, { type: mimeType })
}

export async function fetchVaultPreviewUrl(id, masterKey) {
  const res = await fetch(`/api/vault/preview?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(await readErrorBody(res))
  const data = await res.json()
  if (!data?.previewEncrypted) throw new Error('No encrypted preview stored for this item')
  const bytes = await decryptPreviewBytes(masterKey, data.previewEncrypted)
  return URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
}
