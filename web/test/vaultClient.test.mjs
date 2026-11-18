// Client-side vault helpers. sessionStorage is stubbed with a Map; the
// crypto is real WebCrypto (node 24) with a fake throwaway master key; the
// /api/vault/* fetches are mocked — no server, no real vault.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  VAULT_SESSION_KEY,
  clearVaultSession,
  decryptVaultBlob,
  exportMasterKeyB64,
  fetchVaultPreviewUrl,
  importMasterKeyFromB64,
  readVaultSession,
  writeVaultSession,
} from '../src/lib/vaultClient.js'
import {
  VAULT_HEADER_SIZE,
  encryptBlob,
  encryptPreviewBytes,
} from 'imgvault-shared/vaultCrypto.js'

const realFetch = globalThis.fetch

function stubSessionStorage() {
  const store = new Map()
  globalThis.sessionStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
  return store
}

function randomKeyB64() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

async function masterKey() {
  return importMasterKeyFromB64(randomKeyB64())
}

/** Mock fetch serving byte ranges of `encrypted` for /api/vault/blob. */
function mockBlobFetch(encrypted, { headers = {}, status = 200 } = {}) {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    if (status !== 200) {
      return new Response(JSON.stringify({ error: 'no such item' }), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    }
    const range = options?.headers?.Range || options?.headers?.range
    if (range) {
      const [, start, end] = range.match(/bytes=(\d+)-(\d+)/)
      const slice = encrypted.slice(Number(start), Number(end) + 1)
      return new Response(slice, {
        status: 206,
        headers: { 'content-length': String(slice.byteLength), ...headers },
      })
    }
    return new Response(encrypted, {
      status: 200,
      headers: { 'content-length': String(encrypted.byteLength), ...headers },
    })
  }
  return calls
}

test('vault session key is imgvault-vault-unlocked', () => {
  assert.equal(VAULT_SESSION_KEY, 'imgvault-vault-unlocked')
})

test('writeVaultSession / readVaultSession round-trip', () => {
  stubSessionStorage()
  writeVaultSession({ passHash: 'fake-hash', keyB64: 'fake-key-b64' })
  const session = readVaultSession()
  assert.equal(session.passHash, 'fake-hash')
  assert.equal(session.keyB64, 'fake-key-b64')
  assert.equal(typeof session.unlockedAt, 'number')
})

test('readVaultSession returns null when locked or corrupt', () => {
  const store = stubSessionStorage()
  assert.equal(readVaultSession(), null)
  store.set(VAULT_SESSION_KEY, 'not-json{{{')
  assert.equal(readVaultSession(), null)
})

test('clearVaultSession locks the vault in this tab', () => {
  stubSessionStorage()
  writeVaultSession({ passHash: 'fake-hash', keyB64: 'fake-key-b64' })
  assert.notEqual(readVaultSession(), null)
  clearVaultSession()
  assert.equal(readVaultSession(), null)
})

test('importMasterKeyFromB64 / exportMasterKeyB64 round-trip', async () => {
  const keyB64 = randomKeyB64()
  const key = await importMasterKeyFromB64(keyB64)
  assert.equal(await exportMasterKeyB64(key), keyB64)
})

test('decryptVaultBlob decrypts a chunked IVG1 blob served by ranges', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const key = await masterKey()
  const plain = new TextEncoder().encode('hello vault, this is a small secret file')
  const encrypted = new Uint8Array(await (await encryptBlob(key, new Blob([plain]))).arrayBuffer())
  mockBlobFetch(encrypted)
  const progress = []
  const blob = await decryptVaultBlob({
    id: 'item-1',
    mimeType: 'image/png',
    masterKey: key,
    onProgress: (p) => progress.push(p),
  })
  assert.equal(blob.type, 'image/png')
  assert.equal(await blob.text(), 'hello vault, this is a small secret file')
  assert.equal(progress.at(-1).percent, 100)
  assert.equal(progress.at(-1).total, plain.byteLength)
})

test('decryptVaultBlob reports host fallback info once via onHostInfo', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const key = await masterKey()
  const plain = new TextEncoder().encode('fallback copy served this read')
  const encrypted = new Uint8Array(await (await encryptBlob(key, new Blob([plain]))).arrayBuffer())
  mockBlobFetch(encrypted, {
    headers: {
      'x-vault-blob-host': 'telegram',
      'x-vault-blob-primary': 'udrop',
      'x-vault-blob-copy': '1',
      'x-vault-blob-fallback': '1',
      'x-vault-blob-failed': 'udrop: authorize failed',
    },
  })
  const infos = []
  const blob = await decryptVaultBlob({ id: 'item-1', masterKey: key, onHostInfo: (m) => infos.push(m) })
  assert.equal(await blob.text(), 'fallback copy served this read')
  assert.equal(infos.length, 1)
  assert.equal(infos[0].host, 'telegram')
  assert.equal(infos[0].primaryHost, 'udrop')
  assert.equal(infos[0].copyIndex, 1)
  assert.equal(infos[0].fallback, true)
  assert.match(infos[0].failures, /udrop: authorize failed/)
})

test('decryptVaultBlob still reads a legacy single-shot blob', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const key = await masterKey()
  // Legacy layout: iv(12) || AES-GCM ciphertext, no IVG1 header.
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = new TextEncoder().encode('legacy single-shot bytes')
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain)
  )
  const legacy = new Uint8Array([...iv, ...cipher])
  mockBlobFetch(legacy)
  const blob = await decryptVaultBlob({ id: 'item-legacy', masterKey: key })
  assert.equal(await blob.text(), 'legacy single-shot bytes')
})

test('decryptVaultBlob throws when a range read comes back short', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const key = await masterKey()
  globalThis.fetch = async () =>
    new Response(new Uint8Array(4), { status: 206, headers: { 'content-length': '4' } })
  await assert.rejects(decryptVaultBlob({ id: 'item-1', masterKey: key }), (err) => {
    assert.match(err.message, /vault blob range 0-15 returned 4 of 16 bytes/)
    return true
  })
})

test('decryptVaultBlob surfaces the server error text on a failed fetch', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const key = await masterKey()
  mockBlobFetch(new Uint8Array(0), { status: 404 })
  await assert.rejects(decryptVaultBlob({ id: 'item-1', masterKey: key }), /no such item/)
})

test('fetchVaultPreviewUrl decrypts the stored preview into an object URL', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const key = await masterKey()
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
  const previewEncrypted = await encryptPreviewBytes(key, jpeg)
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ previewEncrypted }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  const url = await fetchVaultPreviewUrl('item-1', key)
  assert.equal(typeof url, 'string')
  assert.ok(url.startsWith('blob:'), `expected a blob: URL, got ${url}`)
  URL.revokeObjectURL(url)
})

test('fetchVaultPreviewUrl throws when no preview is stored', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const key = await masterKey()
  globalThis.fetch = async () =>
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  await assert.rejects(fetchVaultPreviewUrl('item-1', key), /No encrypted preview stored/)
})

test('fetchVaultPreviewUrl throws the server error on a failed fetch', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const key = await masterKey()
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'preview gone' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  await assert.rejects(fetchVaultPreviewUrl('item-1', key), /preview gone/)
})

test('VAULT_HEADER_SIZE is 16 (the header range is bytes 0-15)', () => {
  assert.equal(VAULT_HEADER_SIZE, 16)
})
