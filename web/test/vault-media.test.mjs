// Vault media shaping: DB rows -> client items. The lib uses Next.js
// `@shared/` aliases + extensionless relative imports, which plain node
// cannot resolve — the resolve hook below teaches node the same resolution
// (no package.json / config change). The lib is imported dynamically AFTER
// the hook is registered.
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

const {
  VAULT_CONFIG_ITEM_ID,
  VAULT_CONFIG_SYSTEM_TYPE,
  getExtraMetadata,
  getVaultExtraMetadata,
  isSystemMediaItem,
  isTruthyFlag,
  isVaultedMediaItem,
  toClientMediaItem,
  toClientMediaListItem,
} = await import('../src/lib/vault-media.js')
const registry = await import('imgvault-shared/mediaFieldRegistry.js')

test('isVaultedMediaItem reads the flag from the row or its extra metadata', () => {
  assert.equal(isVaultedMediaItem({ isVaulted: true }), true)
  assert.equal(isVaultedMediaItem({ isVaulted: 1 }), true)
  assert.equal(isVaultedMediaItem({ extraMetadata: { isVaulted: 'true' } }), true)
  assert.equal(isVaultedMediaItem({ extraMetadata: { isVaulted: true } }), true)
  assert.equal(isVaultedMediaItem({ isVaulted: false }), false)
  assert.equal(isVaultedMediaItem({ extraMetadata: { isVaulted: false } }), false)
  assert.equal(isVaultedMediaItem({}), false)
  assert.equal(isVaultedMediaItem(null), false)
})

test('isSystemMediaItem recognises the vault config row only', () => {
  assert.equal(isSystemMediaItem({ id: VAULT_CONFIG_ITEM_ID }), true)
  assert.equal(isSystemMediaItem({ id: '__imgvault_something_else' }), true)
  assert.equal(isSystemMediaItem({ systemType: VAULT_CONFIG_SYSTEM_TYPE }), true)
  assert.equal(
    isSystemMediaItem({ extraMetadata: { systemType: VAULT_CONFIG_SYSTEM_TYPE } }),
    true
  )
  assert.equal(isSystemMediaItem({ id: 'img-1', kind: 'image' }), false)
  assert.equal(isSystemMediaItem({}), false)
  assert.equal(isSystemMediaItem(null), false)
})

test('toClientMediaItem keeps the full row, resolves hosts, strips ai metadata', () => {
  const item = {
    id: 'img-1',
    kind: 'image',
    pageTitle: 'A photo',
    tags: ['a', 'b'],
    extraMetadata: {
      isVaulted: true,
      vaultMode: 'hidden',
      vaultedAt: '2026-11-01T00:00:00.000Z',
      ai: { caption: 'secret analysis' },
    },
    imageHosts: { pixvid: { url: 'https://pixvid.example/photo.png' } },
    videoHosts: {
      filemoon: { watchUrl: 'https://filemoon.example/w' },
      udrop: { watchUrl: 'https://udrop.example/w' },
      terabox: { watchUrl: 'https://terabox.example/w' },
    },
  }
  const client = toClientMediaItem(item)
  assert.equal(client.id, 'img-1')
  assert.equal(client.pageTitle, 'A photo')
  assert.deepEqual(client.tags, ['a', 'b'])
  assert.equal(client.isVaulted, true)
  assert.equal(client.vaultMode, 'hidden')
  assert.equal(client.vaultedAt, '2026-11-01T00:00:00.000Z')
  assert.equal(client.ai, undefined, 'ai metadata must not leak to the client')
  assert.equal(client._isSummary, false)
  assert.equal(client.imageHosts.pixvid.url, 'https://pixvid.example/photo.png')
  assert.equal(client.filemoonUrl, 'https://filemoon.example/w')
  assert.equal(client.udropUrl, 'https://udrop.example/w')
  assert.equal(client.teraboxUrl, 'https://terabox.example/w')
})

test('toClientMediaItem defaults tags, vault fields, and host URLs on a bare row', () => {
  const client = toClientMediaItem({ id: 'img-2', kind: 'image' })
  assert.deepEqual(client.tags, [])
  assert.equal(client.isVaulted, false)
  assert.equal(client.vaultMode, '')
  assert.equal(client.vaultedAt, '')
  assert.equal(client.filemoonUrl, '')
  assert.equal(client.udropUrl, '')
  assert.equal(client.teraboxUrl, '')
  assert.deepEqual(client.imageHosts, {})
  assert.deepEqual(client.videoHosts, {})
})

test('toClientMediaItem falls back to flat watch-URL columns for filemoon/udrop', () => {
  const client = toClientMediaItem({
    id: 'vid-1',
    kind: 'video',
    filemoonWatchUrl: 'https://filemoon.example/flat',
    udropWatchUrl: 'https://udrop.example/flat',
  })
  assert.equal(client.filemoonUrl, 'https://filemoon.example/flat')
  assert.equal(client.udropUrl, 'https://udrop.example/flat')
  assert.equal(client.teraboxUrl, '')
})

test('toClientMediaListItem marks itself a summary and defaults every field', () => {
  const client = toClientMediaListItem({})
  assert.equal(client._isSummary, true)
  assert.equal(client.id, '')
  assert.equal(client.kind, 'image')
  assert.equal(client.isVideo, false)
  assert.equal(client.isLink, false)
  assert.deepEqual(client.tags, [])
  assert.equal(client.collectionId, null)
  assert.equal(client.fileSize, null)
  assert.equal(client.isVaulted, false)
  assert.equal(client.vaultMode, '')
  assert.equal(client.vaultedAt, '')
  assert.deepEqual(client.imageHosts, {})
  assert.deepEqual(client.videoHosts, {})
})

test('toClientMediaListItem compacts provider links: empty fields and empty providers drop out', () => {
  const client = toClientMediaListItem({
    id: 'img-1',
    kind: 'image',
    imageHosts: {
      pixvid: { url: 'https://pixvid.example/p.png', displayUrl: '', thumbnailUrl: undefined },
      imgbb: { url: '', displayUrl: null },
    },
    videoHosts: {
      terabox: { watchUrl: 'https://terabox.example/w', directUrl: '', thumbnailUrl: null },
    },
  })
  // The shared link builder fills displayUrl/directUrl from url, so all
  // three survive compaction; the empty thumbnailUrl and the all-empty
  // imgbb provider drop out.
  assert.deepEqual(client.imageHosts, {
    pixvid: {
      url: 'https://pixvid.example/p.png',
      displayUrl: 'https://pixvid.example/p.png',
      directUrl: 'https://pixvid.example/p.png',
    },
  })
  assert.deepEqual(client.videoHosts, {
    terabox: { watchUrl: 'https://terabox.example/w' },
  })
})

test('toClientMediaListItem keeps list-only fields off the summary', () => {
  const client = toClientMediaListItem({
    id: 'vid-1',
    kind: 'video',
    isVideo: true,
    fileName: 'clip.mp4',
    fileSize: 12345,
    duration: 42,
    filemoonWatchUrl: 'https://filemoon.example/w',
    filemoonDirectUrl: 'https://filemoon.example/d.mp4',
  })
  assert.equal(client.isVideo, true)
  assert.equal(client.fileName, 'clip.mp4')
  assert.equal(client.fileSize, 12345)
  assert.equal(client.duration, 42)
  assert.equal(client.filemoonWatchUrl, 'https://filemoon.example/w')
  assert.equal(client.filemoonDirectUrl, 'https://filemoon.example/d.mp4')
  assert.equal(client.filemoonUrl, 'https://filemoon.example/w')
})

test('getVaultExtraMetadata vaulting sets hidden mode + a timestamp', () => {
  const extra = getVaultExtraMetadata(
    { extraMetadata: { isVaulted: false, pageTitle: 'kept' } },
    true
  )
  assert.equal(extra.isVaulted, true)
  assert.equal(extra.vaultMode, 'hidden')
  assert.match(extra.vaultedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  assert.equal(extra.pageTitle, 'kept')
})

test('getVaultExtraMetadata unvaulting clears mode + timestamp', () => {
  const extra = getVaultExtraMetadata(
    {
      extraMetadata: {
        isVaulted: true,
        vaultMode: 'hidden',
        vaultedAt: '2026-11-01T00:00:00.000Z',
      },
    },
    false
  )
  assert.equal(extra.isVaulted, false)
  assert.equal(extra.vaultMode, '')
  assert.equal(extra.vaultedAt, '')
})

test('re-exported registry values match packages/shared exactly', () => {
  assert.equal(VAULT_CONFIG_ITEM_ID, registry.VAULT_CONFIG_ITEM_ID)
  assert.equal(VAULT_CONFIG_SYSTEM_TYPE, registry.VAULT_CONFIG_SYSTEM_TYPE)
  assert.equal(getExtraMetadata, registry.getExtraMetadata)
  assert.equal(isTruthyFlag, registry.isTruthyFlag)
  assert.equal(typeof VAULT_CONFIG_ITEM_ID, 'string')
  assert.ok(VAULT_CONFIG_ITEM_ID.length > 0)
})
