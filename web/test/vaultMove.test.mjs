// Browser half of the web vault move: fetch the original through the
// same-origin /api/media proxy, encrypt it HERE with the tab-held master key,
// hand the ciphertext to /api/vault/move.
//
// The lib uses Next.js `@shared/` aliases + extensionless relative imports,
// which plain node cannot resolve — the resolve hook below teaches node the
// same resolution (no package.json / config change). The lib is imported
// dynamically AFTER the hook is registered. sessionStorage is stubbed with
// a Map, fetch is mocked, the crypto is real WebCrypto with a fake
// throwaway master key.
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

const { moveItemToVault } = await import('../src/lib/vaultMove.js')
const { VAULT_SESSION_KEY } = await import('../src/lib/vaultClient.js')
const { decryptMetadata } = await import('imgvault-shared/vaultCrypto.js')
const { VAULT_MOVE_MAX_CIPHERTEXT_BYTES } = await import('../src/lib/vaultMoveLimits.js')

const realFetch = globalThis.fetch

function randomKeyB64() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function unlockVault(keyB64) {
  const store = new Map()
  globalThis.sessionStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
  store.set(
    VAULT_SESSION_KEY,
    JSON.stringify({ passHash: 'fake-hash', keyB64, unlockedAt: Date.now() })
  )
}

function lockVault() {
  const store = new Map()
  globalThis.sessionStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
}

/** Mock fetch routing /api/media (proxy) and /api/vault/move (upload). */
function mockMoveFetch({ proxyResponse, uploadResponse }) {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    if (String(url).startsWith('/api/media?')) return proxyResponse()
    if (String(url) === '/api/vault/move') return uploadResponse()
    throw new Error(`unexpected fetch: ${url}`)
  }
  return calls
}

function okProxy(body = 'file-bytes', contentType = 'image/png') {
  return () =>
    new Response(new Blob([body], { type: contentType }), {
      status: 200,
      headers: { 'content-type': contentType, 'content-length': String(body.length) },
    })
}

function okUpload(payload = { item: { id: 'x' }, host: 'telegram', encryptedSize: 1 }) {
  return () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
}

const imageItem = {
  id: 'img-1',
  kind: 'image',
  fileType: 'image/png',
  fileSize: 10,
  fileName: 'photo.png',
  imageHosts: { pixvid: { url: 'https://pixvid.example/photo.png' } },
}

const videoItem = {
  id: 'vid-1',
  kind: 'video',
  fileType: 'video/mp4',
  fileSize: 10,
  fileName: 'clip.mp4',
  videoHosts: {
    terabox: { watchUrl: 'https://terabox.example/watch', directUrl: 'https://terabox.example/dl.mp4' },
  },
}

const songItem = {
  id: 'aud-1',
  kind: 'audio',
  fileType: 'audio/mp4',
  fileSize: 10,
  fileName: 'song.m4a',
  videoHosts: { telegram: { directUrl: '/telegram-media/abc?mt=audio%2Fmp4' } },
}

test('moveItemToVault throws when the item id is missing', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  unlockVault(randomKeyB64())
  await assert.rejects(
    moveItemToVault({ item: {}, preferredImageProvider: 'pixvid', preferredVideoProvider: 'terabox' }),
    /item id is missing/
  )
})

test('moveItemToVault throws when the vault is locked in this tab', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  lockVault()
  await assert.rejects(
    moveItemToVault({
      item: imageItem,
      preferredImageProvider: 'pixvid',
      preferredVideoProvider: 'terabox',
    }),
    /Secret Vault is locked in this tab/
  )
})

test('moveItemToVault refuses kinds outside image/video/audio, naming the kind', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  unlockVault(randomKeyB64())
  await assert.rejects(
    moveItemToVault({
      item: { id: 'lnk-1', kind: 'link', linkUrl: 'https://example.com' },
      preferredImageProvider: 'pixvid',
      preferredVideoProvider: 'terabox',
    }),
    /"link" items cannot be vaulted from the web — only images, videos and songs/
  )
  await assert.rejects(
    moveItemToVault({
      item: { id: 'scn-1', kind: 'scene', spzUrl: 'https://example.com/scene.spz' },
      preferredImageProvider: 'pixvid',
      preferredVideoProvider: 'terabox',
    }),
    /"scene" items cannot be vaulted/
  )
})

test('moveItemToVault moves an image end to end: proxy fetch, encrypt, upload', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const keyB64 = randomKeyB64()
  unlockVault(keyB64)
  const stages = []
  const calls = mockMoveFetch({ proxyResponse: okProxy(), uploadResponse: okUpload() })
  const result = await moveItemToVault({
    item: imageItem,
    preferredImageProvider: 'pixvid',
    preferredVideoProvider: 'terabox',
    onStage: (stage) => stages.push(stage),
  })
  assert.deepEqual(result, { item: { id: 'x' }, host: 'telegram', encryptedSize: 1 })
  assert.deepEqual(stages, ['download', 'encrypt', 'upload'])
  assert.equal(calls.length, 2)
  assert.equal(
    calls[0].url,
    '/api/media?url=https%3A%2F%2Fpixvid.example%2Fphoto.png'
  )
  assert.equal(calls[0].options.cache, 'no-store')
  assert.equal(calls[1].url, '/api/vault/move')
  assert.equal(calls[1].options.method, 'POST')
  const body = calls[1].options.body
  assert.equal(body.get('id'), 'img-1')
  assert.equal(body.get('encryptedMimeType'), 'image/png')
  assert.ok(body.get('encrypted') instanceof Blob)
  assert.ok(body.get('encrypted').size > 0)
  assert.equal(body.get('encrypted').name, 'vault.bin')
  // The metadata round-trips through the real master key.
  const { importMasterKeyFromB64 } = await import('../src/lib/vaultClient.js')
  const masterKey = await importMasterKeyFromB64(keyB64)
  const metadata = await decryptMetadata(masterKey, body.get('encryptedMetadata'))
  assert.equal(metadata.kind, 'image')
  assert.equal(metadata.isVideo, false)
  assert.equal(metadata.isAudio, undefined)
  assert.equal(metadata.fileName, 'photo.png')
})

test('moveItemToVault moves a song like a video, with isAudio in the metadata', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const keyB64 = randomKeyB64()
  unlockVault(keyB64)
  const calls = mockMoveFetch({
    proxyResponse: okProxy('song-bytes', 'audio/mp4'),
    uploadResponse: okUpload(),
  })
  await moveItemToVault({
    item: songItem,
    preferredImageProvider: 'pixvid',
    preferredVideoProvider: 'telegram',
    onStage: () => {},
  })
  assert.equal(calls[0].url, '/api/media?url=%2Ftelegram-media%2Fabc%3Fmt%3Daudio%252Fmp4')
  const { importMasterKeyFromB64 } = await import('../src/lib/vaultClient.js')
  const masterKey = await importMasterKeyFromB64(keyB64)
  const metadata = await decryptMetadata(
    masterKey,
    calls[1].options.body.get('encryptedMetadata')
  )
  assert.equal(metadata.kind, 'audio')
  assert.equal(metadata.isAudio, true)
  assert.equal(metadata.isVideo, false)
})

test('moveItemToVault moves a video from its direct URL', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  unlockVault(randomKeyB64())
  const calls = mockMoveFetch({
    proxyResponse: okProxy('video-bytes', 'video/mp4'),
    uploadResponse: okUpload(),
  })
  await moveItemToVault({
    item: videoItem,
    preferredImageProvider: 'pixvid',
    preferredVideoProvider: 'terabox',
  })
  assert.equal(calls[0].url, '/api/media?url=https%3A%2F%2Fterabox.example%2Fdl.mp4')
  assert.equal(calls[1].options.body.get('encryptedMimeType'), 'video/mp4')
})

test('moveItemToVault throws loudly naming the host when the video has no direct URL there', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  unlockVault(randomKeyB64())
  const watchOnly = {
    ...videoItem,
    videoHosts: { terabox: { watchUrl: 'https://terabox.example/watch' } },
  }
  await assert.rejects(
    moveItemToVault({
      item: watchOnly,
      preferredImageProvider: 'pixvid',
      preferredVideoProvider: 'terabox',
    }),
    (err) => {
      assert.match(err.message, /has no direct URL on TeraBox/)
      assert.match(err.message, /a watch page cannot be downloaded/)
      return true
    }
  )
})

test('moveItemToVault calls a song a song in the no-direct-URL error', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  unlockVault(randomKeyB64())
  const watchOnly = {
    ...songItem,
    videoHosts: { telegram: { watchUrl: 'https://t.me/c/123/90' } },
  }
  await assert.rejects(
    moveItemToVault({
      item: watchOnly,
      preferredImageProvider: 'pixvid',
      preferredVideoProvider: 'telegram',
    }),
    /This song has no direct URL on Telegram/
  )
})

test('moveItemToVault does NOT fall back: a telegram-only video stays unmovable when TeraBox is preferred', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  unlockVault(randomKeyB64())
  // The file IS on telegram with a direct URL — but the preferred provider
  // is TeraBox, and the contract is strict: move it from the extension.
  const telegramOnly = {
    ...videoItem,
    videoHosts: { telegram: { directUrl: '/telegram-media/xyz?mt=video%2Fmp4' } },
  }
  await assert.rejects(
    moveItemToVault({
      item: telegramOnly,
      preferredImageProvider: 'pixvid',
      preferredVideoProvider: 'terabox',
    }),
    (err) => {
      assert.match(err.message, /has no direct URL on TeraBox/)
      assert.match(err.message, /move it from the extension/)
      return true
    }
  )
})

test('moveItemToVault throws loudly naming the host when the image has no full-size URL there', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  unlockVault(randomKeyB64())
  const imgbbOnly = {
    ...imageItem,
    imageHosts: { imgbb: { url: 'https://i.ibb.co/photo.png' } },
  }
  await assert.rejects(
    moveItemToVault({
      item: imgbbOnly,
      preferredImageProvider: 'pixvid',
      preferredVideoProvider: 'terabox',
    }),
    /This item has no full-size URL on Pixvid/
  )
})

test('moveItemToVault refuses an over-cap fileSize before fetching anything', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  unlockVault(randomKeyB64())
  const calls = mockMoveFetch({ proxyResponse: okProxy(), uploadResponse: okUpload() })
  const big = { ...imageItem, fileSize: VAULT_MOVE_MAX_CIPHERTEXT_BYTES + 1 }
  await assert.rejects(
    moveItemToVault({
      item: big,
      preferredImageProvider: 'pixvid',
      preferredVideoProvider: 'terabox',
    }),
    (err) => {
      assert.match(err.message, /over the 4\.29 MB web-move limit/)
      assert.match(err.message, /Move this item from the extension/)
      return true
    }
  )
  assert.equal(calls.length, 0, 'no fetch should happen for an over-cap item')
})

test('moveItemToVault throws with host + status when the proxy fetch fails', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  unlockVault(randomKeyB64())
  mockMoveFetch({
    proxyResponse: () => new Response('expired', { status: 410 }),
    uploadResponse: okUpload(),
  })
  await assert.rejects(
    moveItemToVault({
      item: imageItem,
      preferredImageProvider: 'pixvid',
      preferredVideoProvider: 'terabox',
    }),
    /Could not fetch the original from Pixvid \(HTTP 410\)/
  )
})

test('moveItemToVault throws when the host answers a web page instead of the file', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  unlockVault(randomKeyB64())
  mockMoveFetch({
    proxyResponse: () =>
      new Response('<html>watch</html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    uploadResponse: okUpload(),
  })
  await assert.rejects(
    moveItemToVault({
      item: videoItem,
      preferredImageProvider: 'pixvid',
      preferredVideoProvider: 'terabox',
    }),
    /TeraBox returned a web page instead of the file/
  )
})

test('moveItemToVault refuses a declared content-length over the cap', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  unlockVault(randomKeyB64())
  mockMoveFetch({
    proxyResponse: () =>
      new Response(new Blob(['tiny'], { type: 'image/png' }), {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(VAULT_MOVE_MAX_CIPHERTEXT_BYTES + 1),
        },
      }),
    uploadResponse: okUpload(),
  })
  await assert.rejects(
    moveItemToVault({
      item: imageItem,
      preferredImageProvider: 'pixvid',
      preferredVideoProvider: 'terabox',
    }),
    /over the 4\.29 MB web-move limit/
  )
})

test('moveItemToVault throws when the host returns an empty file', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  unlockVault(randomKeyB64())
  mockMoveFetch({
    proxyResponse: () =>
      new Response(new Blob([], { type: 'image/png' }), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '0' },
      }),
    uploadResponse: okUpload(),
  })
  await assert.rejects(
    moveItemToVault({
      item: imageItem,
      preferredImageProvider: 'pixvid',
      preferredVideoProvider: 'terabox',
    }),
    /Pixvid returned an empty file/
  )
})

test('moveItemToVault surfaces the server error when the upload is rejected', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  unlockVault(randomKeyB64())
  mockMoveFetch({
    proxyResponse: okProxy(),
    uploadResponse: () =>
      new Response(JSON.stringify({ error: 'telegram post failed' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
  })
  await assert.rejects(
    moveItemToVault({
      item: imageItem,
      preferredImageProvider: 'pixvid',
      preferredVideoProvider: 'terabox',
    }),
    /telegram post failed/
  )
})

test('moveItemToVault falls back to the HTTP status when the upload error has no JSON', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  unlockVault(randomKeyB64())
  mockMoveFetch({
    proxyResponse: okProxy(),
    uploadResponse: () => new Response('gateway exploded', { status: 502 }),
  })
  await assert.rejects(
    moveItemToVault({
      item: imageItem,
      preferredImageProvider: 'pixvid',
      preferredVideoProvider: 'terabox',
    }),
    /Vault move failed \(HTTP 502\)/
  )
})
