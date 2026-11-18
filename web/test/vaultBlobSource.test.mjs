// Server-side resolution of encrypted vault blobs. The lib uses an
// extensionless relative import (`./telegramServerApi`), which plain node
// cannot resolve — the resolve hook below teaches node the same resolution
// (no package.json / config change). The lib is imported dynamically AFTER
// the hook is registered. All network is mocked; tokens/keys are fake.
import { register } from 'node:module'
import { fileURLToPath } from 'node:url'

const WEB_DIR = fileURLToPath(new URL('..', import.meta.url))
const SHARED_DIR = fileURLToPath(new URL('../../packages/shared', import.meta.url))

register(
  'data:text/javascript,' +
    encodeURIComponent(`
import { pathToFileURL, fileURLToPath } from 'node:url'
import fs from 'node:fs'
const WEB = ${JSON.stringify(WEB_DIR)}
const SHARED = ${JSON.stringify(SHARED_DIR)}
function hit(p) {
  if (fs.existsSync(p)) return { url: pathToFileURL(p).href, shortCircuit: true }
  if (fs.existsSync(p + '.js')) return { url: pathToFileURL(p + '.js').href, shortCircuit: true }
  return null
}
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const found = hit(WEB + '/src/' + specifier.slice(2))
    if (found) return found
  }
  if (specifier.startsWith('@shared/')) {
    const found = hit(SHARED + '/' + specifier.slice(8))
    if (found) return found
  }
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
      const found = hit(fileURLToPath(new URL(specifier, context.parentURL)))
      if (found) return found
    }
    throw err
  }
}
`)
)

import test from 'node:test'
import assert from 'node:assert/strict'

const { WEB_READABLE_VAULT_HOSTS, openVaultCiphertext, vaultBlobCopies } = await import(
  '../src/lib/vaultBlobSource.js'
)

const realFetch = globalThis.fetch
const FAKE_TOKEN = 'FAKE_TELEGRAM_BOT_TOKEN_12345'
const BLOB_BYTES = new TextEncoder().encode('0123456789ABCDEF')

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function readStream(stream) {
  const reader = stream.getReader()
  const chunks = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function mockFetch(handler) {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    return handler(String(url), options)
  }
  return calls
}

/** UDrop authorize + download-url handshake, then the bytes at the CDN URL. */
function udropHandshake({ bytesResponse }) {
  return async (url) => {
    if (url === 'https://www.udrop.com/api/v2/authorize') {
      return jsonResponse({
        _status: 'success',
        data: { access_token: 'fake-access-token', account_id: 'fake-account' },
      })
    }
    if (url === 'https://www.udrop.com/api/v2/file/download') {
      return jsonResponse({ _status: 'success', data: { download_url: 'https://cdn.example/blob' } })
    }
    if (url === 'https://cdn.example/blob') return bytesResponse()
    throw new Error(`unexpected fetch: ${url}`)
  }
}

test('WEB_READABLE_VAULT_HOSTS is exactly udrop + telegram', () => {
  assert.deepEqual(WEB_READABLE_VAULT_HOSTS, ['udrop', 'telegram'])
})

test('vaultBlobCopies reads the multi-copy list, lowercasing hosts', () => {
  const copies = vaultBlobCopies({
    encryptedBlobHosts: [
      { host: 'Udrop', encryptedBlobUrl: 'https://u.example/1', encryptedBlobFileId: 'f1' },
      { host: 'Telegram', encryptedBlobUrl: '/telegram-media/x', encryptedBlobFileId: 'f2' },
    ],
  })
  assert.deepEqual(copies, [
    { host: 'udrop', url: 'https://u.example/1', fileId: 'f1' },
    { host: 'telegram', url: '/telegram-media/x', fileId: 'f2' },
  ])
})

test('vaultBlobCopies falls back to the legacy single-url shape, defaulting to udrop', () => {
  assert.deepEqual(
    vaultBlobCopies({
      encryptedBlobUrl: 'https://u.example/legacy',
      encryptedBlobFileId: 'f9',
    }),
    [{ host: 'udrop', url: 'https://u.example/legacy', fileId: 'f9' }]
  )
  assert.deepEqual(
    vaultBlobCopies({
      encryptedBlobUrl: '/telegram-media/x',
      vaultHost: 'telegram',
      encryptedBlobFileId: 'f9',
    }),
    [{ host: 'telegram', url: '/telegram-media/x', fileId: 'f9' }]
  )
})

test('vaultBlobCopies returns [] when the item has no blob at all', () => {
  assert.deepEqual(vaultBlobCopies({}), [])
  assert.deepEqual(vaultBlobCopies(null), [])
  assert.deepEqual(vaultBlobCopies({ encryptedBlobHosts: [] }), [])
})

test('openVaultCiphertext throws when the item has no blob copies', async () => {
  await assert.rejects(
    openVaultCiphertext({ extra: {}, settings: {} }),
    /Vault item has no encrypted blob copies/
  )
})

test('openVaultCiphertext reads a udrop copy end to end', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const calls = mockFetch(
    udropHandshake({
      bytesResponse: () =>
        new Response(BLOB_BYTES, {
          status: 200,
          headers: { 'content-length': String(BLOB_BYTES.byteLength) },
        }),
    })
  )
  const result = await openVaultCiphertext({
    extra: { encryptedBlobHosts: [{ host: 'udrop', fileId: 'f1' }] },
    settings: { udropKey1: 'fake-k1', udropKey2: 'fake-k2' },
  })
  assert.equal(result.status, 200)
  assert.equal(result.contentLength, 16)
  assert.equal(result.host, 'udrop')
  assert.equal(result.primaryHost, 'udrop')
  assert.equal(result.copyIndex, 0)
  assert.deepEqual(result.failures, [])
  assert.equal(new TextDecoder().decode(await readStream(result.body)), '0123456789ABCDEF')
  assert.equal(calls.length, 3)
  assert.equal(calls[2].options.headers['User-Agent'].includes('Chrome'), true)
  assert.equal(calls[2].options.headers.Range, undefined)
})

test('openVaultCiphertext forwards a byte range and honors a 206', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const calls = mockFetch(
    udropHandshake({
      bytesResponse: () =>
        new Response(BLOB_BYTES.slice(4, 8), {
          status: 206,
          headers: { 'content-length': '4', 'content-range': 'bytes 4-7/16' },
        }),
    })
  )
  const result = await openVaultCiphertext({
    extra: { encryptedBlobHosts: [{ host: 'udrop', fileId: 'f1' }] },
    settings: { udropKey1: 'fake-k1', udropKey2: 'fake-k2' },
    start: 4,
    end: 7,
  })
  assert.equal(result.status, 206)
  assert.equal(result.contentLength, 4)
  assert.equal(result.total, 16)
  assert.equal(new TextDecoder().decode(await readStream(result.body)), '4567')
  assert.equal(calls[2].options.headers.Range, 'bytes=4-7')
})

test('openVaultCiphertext slices the window itself when the host ignores Range', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(
    udropHandshake({
      bytesResponse: () =>
        new Response(BLOB_BYTES, {
          status: 200,
          headers: { 'content-length': '16' },
        }),
    })
  )
  const result = await openVaultCiphertext({
    extra: { encryptedBlobHosts: [{ host: 'udrop', fileId: 'f1' }] },
    settings: { udropKey1: 'fake-k1', udropKey2: 'fake-k2' },
    start: 10,
    end: 13,
  })
  assert.equal(result.status, 206)
  assert.equal(result.contentLength, 4)
  assert.equal(result.total, 16)
  assert.equal(new TextDecoder().decode(await readStream(result.body)), 'ABCD')
})

test('openVaultCiphertext fails loudly naming terabox (server cannot scrape its token)', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () => {
    throw new Error('must not fetch')
  })
  await assert.rejects(
    openVaultCiphertext({
      extra: { encryptedBlobHosts: [{ host: 'terabox', fileId: 'f1' }] },
      settings: {},
    }),
    (err) => {
      assert.match(err.message, /No readable vault blob copy/)
      assert.match(err.message, /terabox: terabox vault copies need the extension/)
      return true
    }
  )
})

test('openVaultCiphertext fails loudly for a host with no server-side reader', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () => {
    throw new Error('must not fetch')
  })
  await assert.rejects(
    openVaultCiphertext({
      extra: { encryptedBlobHosts: [{ host: 'filemoon', fileId: 'f1' }] },
      settings: {},
    }),
    /filemoon: vault host "filemoon" has no server-side reader/
  )
})

test('openVaultCiphertext throws when udrop keys are not configured', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () => {
    throw new Error('must not fetch')
  })
  await assert.rejects(
    openVaultCiphertext({
      extra: { encryptedBlobHosts: [{ host: 'udrop', fileId: 'f1' }] },
      settings: {},
    }),
    /udrop: udrop keys are not configured in Settings/
  )
})

test('openVaultCiphertext throws when the udrop copy has no file id', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () => {
    throw new Error('must not fetch')
  })
  await assert.rejects(
    openVaultCiphertext({
      extra: { encryptedBlobHosts: [{ host: 'udrop' }] },
      settings: { udropKey1: 'k1', udropKey2: 'k2' },
    }),
    /udrop: udrop copy has no file id/
  )
})

test('openVaultCiphertext throws when udrop authorize is rejected', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async (url) => {
    if (url.endsWith('/authorize')) {
      return jsonResponse({ _status: 'error', response: 'bad keys' })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  await assert.rejects(
    openVaultCiphertext({
      extra: { encryptedBlobHosts: [{ host: 'udrop', fileId: 'f1' }] },
      settings: { udropKey1: 'k1', udropKey2: 'k2' },
    }),
    /udrop: udrop authorize rejected: bad keys/
  )
})

test('openVaultCiphertext reads a telegram copy through getFile', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const calls = mockFetch(async (url) => {
    if (url.includes('/getFile')) {
      return jsonResponse({
        ok: true,
        result: { file_path: 'documents/vault.bin', file_size: 16 },
      })
    }
    return new Response(BLOB_BYTES, {
      status: 200,
      headers: { 'content-length': '16' },
    })
  })
  const result = await openVaultCiphertext({
    extra: { encryptedBlobHosts: [{ host: 'telegram', fileId: 'tg-file-1' }] },
    settings: { telegramBotToken: FAKE_TOKEN },
  })
  assert.equal(result.status, 200)
  assert.equal(result.host, 'telegram')
  assert.equal(result.copyIndex, 0)
  assert.equal(new TextDecoder().decode(await readStream(result.body)), '0123456789ABCDEF')
  assert.equal(calls[1].url, `https://api.telegram.org/file/bot${FAKE_TOKEN}/documents/vault.bin`)
})

test('openVaultCiphertext throws when the telegram copy has no bot token', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () => {
    throw new Error('must not fetch')
  })
  await assert.rejects(
    openVaultCiphertext({
      extra: { encryptedBlobHosts: [{ host: 'telegram', fileId: 'tg-file-1' }] },
      settings: {},
    }),
    /telegram: telegram vault copy needs the bot token in Settings/
  )
})

test('openVaultCiphertext enforces the telegram 20 MB read-back cap', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async (url) => {
    if (url.includes('/getFile')) {
      return jsonResponse({
        ok: true,
        result: { file_path: 'documents/big.bin', file_size: 21 * 1024 * 1024 },
      })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  await assert.rejects(
    openVaultCiphertext({
      extra: { encryptedBlobHosts: [{ host: 'telegram', fileId: 'tg-file-1' }] },
      settings: { telegramBotToken: FAKE_TOKEN },
    }),
    /telegram: Telegram getFile gate: 21\.0 MB is over the 20\.0 MB limit/
  )
})

test('openVaultCiphertext falls through to the next copy and records the failure', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async (url) => {
    if (url.endsWith('/authorize')) {
      return new Response('down', { status: 500 })
    }
    if (url.includes('/getFile')) {
      return jsonResponse({
        ok: true,
        result: { file_path: 'documents/vault.bin', file_size: 16 },
      })
    }
    if (url.includes('/file/bot')) {
      return new Response(BLOB_BYTES, { status: 200, headers: { 'content-length': '16' } })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  const result = await openVaultCiphertext({
    extra: {
      encryptedBlobHosts: [
        { host: 'udrop', fileId: 'f1' },
        { host: 'telegram', fileId: 'tg-file-1' },
      ],
    },
    settings: { udropKey1: 'k1', udropKey2: 'k2', telegramBotToken: FAKE_TOKEN },
  })
  assert.equal(result.host, 'telegram')
  assert.equal(result.primaryHost, 'udrop')
  assert.equal(result.copyIndex, 1, 'copyIndex > 0 means the primary copy failed')
  assert.equal(result.failures.length, 1)
  assert.match(result.failures[0], /udrop: udrop authorize failed \(HTTP 500\)/)
  assert.equal(new TextDecoder().decode(await readStream(result.body)), '0123456789ABCDEF')
})

test('openVaultCiphertext joins every host failure when no copy serves', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async (url) => {
    if (url.endsWith('/authorize')) {
      return new Response('down', { status: 500 })
    }
    if (url.includes('/getFile')) {
      return jsonResponse({
        ok: true,
        result: { file_path: 'documents/vault.bin', file_size: 16 },
      })
    }
    if (url.includes('/file/bot')) {
      return new Response('gone', { status: 404 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  await assert.rejects(
    openVaultCiphertext({
      extra: {
        encryptedBlobHosts: [
          { host: 'udrop', fileId: 'f1' },
          { host: 'telegram', fileId: 'tg-file-1' },
        ],
      },
      settings: { udropKey1: 'k1', udropKey2: 'k2', telegramBotToken: FAKE_TOKEN },
    }),
    (err) => {
      assert.match(err.message, /No readable vault blob copy/)
      assert.match(err.message, /udrop: udrop authorize failed \(HTTP 500\)/)
      assert.match(err.message, /telegram: HTTP 404/)
      return true
    }
  )
})

test('openVaultCiphertext redacts the bot token from recorded failures', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async (url) => {
    if (url.includes('/getFile')) {
      return jsonResponse({
        ok: true,
        result: { file_path: 'documents/vault.bin', file_size: 16 },
      })
    }
    if (url.includes('/file/bot')) {
      throw new Error(`fetch blew up on the url with ${FAKE_TOKEN} in it`)
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  await assert.rejects(
    openVaultCiphertext({
      extra: { encryptedBlobHosts: [{ host: 'telegram', fileId: 'tg-file-1' }] },
      settings: { telegramBotToken: FAKE_TOKEN },
    }),
    (err) => {
      assert.doesNotMatch(err.message, new RegExp(FAKE_TOKEN))
      assert.match(err.message, /\[redacted\]/)
      return true
    }
  )
})
