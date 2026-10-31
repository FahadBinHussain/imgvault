// Browser half of the web vault move: fetch the original through the
// same-origin /api/media proxy, encrypt it HERE with the tab-held master key,
// then hand the ciphertext to /api/vault/move (the server only sees ciphertext
// and posts it to the Telegram channel). The key never leaves this tab.
import {
  getImageProviderLabel,
  getStrictImageProviderLink,
} from 'imgvault-shared/imageProviderLinks.js'
import {
  getStrictVideoProviderLink,
  getVideoProviderLabel,
} from 'imgvault-shared/videoProviderLinks.js'
import { encryptBlob, encryptMetadata } from 'imgvault-shared/vaultCrypto.js'
import { getMediaItemKind } from '@shared/mediaFieldRegistry.js'
import { importMasterKeyFromB64, readVaultSession } from './vaultClient'
import { VAULT_MOVE_MAX_CIPHERTEXT_BYTES } from './vaultMoveLimits'

const MOVE_KINDS = new Set(['image', 'video'])

function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`
  if (value >= 1024) return `${Math.round(value / 1024)} KB`
  return `${value} B`
}

function capError(size, stage) {
  return new Error(
    `${stage === 'request' ? 'The encrypted request' : 'The encrypted blob'} is ${formatBytes(size)} — ` +
      `over the ${formatBytes(VAULT_MOVE_MAX_CIPHERTEXT_BYTES)} web-move limit (the server rejects ` +
      'request bodies over 4.5 MB). Move this item from the extension: it uploads straight to the ' +
      'vault host with no relay limit.'
  )
}

function pickSource({ item, kind, preferredImageProvider, preferredVideoProvider }) {
  if (kind === 'video') {
    // watch URLs serve HTML; only a direct byte URL can be encrypted.
    const url = getStrictVideoProviderLink(item, preferredVideoProvider, 'directUrl')
    if (!url) {
      throw new Error(
        `This video has no direct URL on ${getVideoProviderLabel(preferredVideoProvider)} — a watch ` +
          'page cannot be downloaded. Switch the gallery video source or move it from the extension.'
      )
    }
    return { url, label: getVideoProviderLabel(preferredVideoProvider) }
  }

  // Full-size only: a thumbnail would silently vault a low-res copy and then
  // blank the original URL.
  const url = getStrictImageProviderLink(item, preferredImageProvider, 'url')
  if (!url) {
    throw new Error(
      `This item has no full-size URL on ${getImageProviderLabel(preferredImageProvider)}. ` +
        'Switch the gallery image source or move it from the extension.'
    )
  }
  return { url, label: getImageProviderLabel(preferredImageProvider) }
}

/**
 * Encrypt one gallery item into the vault.
 * @param {Object} options
 * @param {Object} options.item - gallery row (toClientMediaListItem shape)
 * @param {string} options.preferredImageProvider
 * @param {string} options.preferredVideoProvider
 * @param {(stage:'download'|'encrypt'|'upload')=>void} [options.onStage]
 * @returns {Promise<{item:Object, host:string, encryptedSize:number}>}
 */
export async function moveItemToVault({
  item,
  preferredImageProvider,
  preferredVideoProvider,
  onStage,
}) {
  if (!item?.id) throw new Error('Vault move: item id is missing')

  const session = readVaultSession()
  if (!session?.keyB64) {
    throw new Error(
      'Secret Vault is locked in this tab. Open the Vault page, unlock it, then move the item again.'
    )
  }

  const kind = getMediaItemKind(item)
  if (!MOVE_KINDS.has(kind)) {
    throw new Error(`"${kind}" items cannot be vaulted from the web — only images and videos.`)
  }

  const source = pickSource({
    item,
    kind,
    preferredImageProvider,
    preferredVideoProvider,
  })

  if (Number(item.fileSize) > VAULT_MOVE_MAX_CIPHERTEXT_BYTES) throw capError(item.fileSize)

  onStage?.('download')
  const res = await fetch(`/api/media?url=${encodeURIComponent(source.url)}`, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(
      `Could not fetch the original from ${source.label} (HTTP ${res.status}). The stored URL ` +
        'may have expired — retry, or move the item from the extension.'
    )
  }

  const contentType = String(res.headers.get('content-type') || '').toLowerCase()
  if (contentType.startsWith('text/html') || contentType.startsWith('application/xhtml')) {
    throw new Error(
      `${source.label} returned a web page instead of the file, so there is nothing to encrypt. ` +
        'This URL cannot be vaulted from the web — move the item from the extension.'
    )
  }

  const declaredSize = Number(res.headers.get('content-length') || 0)
  if (declaredSize > VAULT_MOVE_MAX_CIPHERTEXT_BYTES) throw capError(declaredSize)

  const plain = await res.blob()
  if (!plain.size) {
    throw new Error(`${source.label} returned an empty file — nothing was vaulted.`)
  }

  onStage?.('encrypt')
  const masterKey = await importMasterKeyFromB64(session.keyB64)
  const encrypted = await encryptBlob(masterKey, plain)

  const metadata = {
    kind: item.kind || (kind === 'video' ? 'video' : 'image'),
    isVideo: kind === 'video',
    pageTitle: item.pageTitle || '',
    description: item.description || '',
    tags: Array.isArray(item.tags) ? item.tags : [],
    fileName: item.fileName || '',
    fileType: item.fileType || plain.type || '',
    sourceImageUrl: item.sourceImageUrl || '',
    sourcePageUrl: item.sourcePageUrl || '',
    creationDate: item.creationDate || null,
    width: item.width || null,
    height: item.height || null,
    duration: item.duration || null,
  }
  const encryptedMetadata = await encryptMetadata(masterKey, metadata)

  const bodySize = encrypted.size + new TextEncoder().encode(encryptedMetadata).length + 4096
  if (bodySize > VAULT_MOVE_MAX_CIPHERTEXT_BYTES) throw capError(bodySize, 'request')

  onStage?.('upload')
  const body = new FormData()
  body.append('id', item.id)
  body.append('encryptedMetadata', encryptedMetadata)
  body.append('encryptedMimeType', plain.type || item.fileType || 'application/octet-stream')
  body.append('encrypted', encrypted, 'vault.bin')

  const upload = await fetch('/api/vault/move', { method: 'POST', body })
  let data = null
  try {
    data = await upload.json()
  } catch {
    data = null
  }
  if (!upload.ok) {
    throw new Error(data?.error || `Vault move failed (HTTP ${upload.status})`)
  }
  return data
}
