import { db } from '@/db'
import { mediaItems, shareLinks, settings as settingsTable } from '@/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { auth } from '@/app/api/auth/[...nextauth]/route'
import {
  IMAGE_UPLOAD_SERVICES,
  VIDEO_UPLOAD_SERVICES,
  buildVaultBlobCopy,
} from 'imgvault-shared/providerCatalog.js'
import {
  deleteTelegramMessage,
  sendTelegramFile,
  telegramChatId,
  telegramLocalMediaUrl,
} from '@/lib/telegramServerApi'
import {
  getExtraMetadata,
  isSystemMediaItem,
  isVaultedMediaItem,
  toClientMediaItem,
} from '@/lib/vault-media'
import { VAULT_MOVE_MAX_CIPHERTEXT_BYTES } from '@/lib/vaultMoveLimits'

// Telegram posting + the row update can take longer than the default budget.
export const maxDuration = 60

const MOVE_KINDS = new Set(['image', 'video'])

const PLAINTEXT_COLUMN_BLANKS = {
  pixvidUrl: '',
  pixvidDeleteUrl: '',
  imgbbUrl: '',
  imgbbDeleteUrl: '',
  imgbbThumbUrl: '',
  filemoonWatchUrl: '',
  filemoonDirectUrl: '',
  udropWatchUrl: '',
  udropDirectUrl: '',
  sourceImageUrl: '',
}

// Provider URLs also live in extra_metadata (terabox links only there), and
// fromNeonMediaRow rebuilds hosts from the flat keys too — so a vaulted row has
// to lose both copies, not just the columns.
const PLAINTEXT_EXTRA_KEYS = new Set(['imageHosts', 'videoHosts', 'sourceImageUrl'])
for (const service of [...IMAGE_UPLOAD_SERVICES, ...VIDEO_UPLOAD_SERVICES]) {
  for (const key of [
    service.urlField,
    service.deleteUrlField,
    service.thumbUrlField,
    service.watchUrlField,
    service.aliasWatchUrlField,
    service.directUrlField,
  ]) {
    if (key) PLAINTEXT_EXTRA_KEYS.add(key)
  }
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`
  if (value >= 1024) return `${Math.round(value / 1024)} KB`
  return `${value} B`
}

export async function POST(request) {
  const session = await auth()

  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!db) {
    return Response.json({ error: 'Database unavailable' }, { status: 503 })
  }

  let form
  try {
    form = await request.formData()
  } catch (error) {
    return Response.json(
      { error: `Could not read the encrypted move payload: ${error?.message || error}` },
      { status: 400 }
    )
  }

  const id = typeof form.get('id') === 'string' ? form.get('id').trim() : ''
  const encryptedMetadata = typeof form.get('encryptedMetadata') === 'string'
    ? form.get('encryptedMetadata').trim()
    : ''
  const encryptedMimeType = (typeof form.get('encryptedMimeType') === 'string'
    ? form.get('encryptedMimeType').trim()
    : '') || 'application/octet-stream'
  const encrypted = form.get('encrypted')

  if (!id) {
    return Response.json({ error: 'Vault item id is required' }, { status: 400 })
  }
  if (!encryptedMetadata) {
    return Response.json({ error: 'Encrypted metadata is required' }, { status: 400 })
  }
  if (!encrypted || typeof encrypted === 'string' || !encrypted.size) {
    return Response.json({ error: 'The encrypted blob is missing from the request' }, { status: 400 })
  }
  if (encrypted.size > VAULT_MOVE_MAX_CIPHERTEXT_BYTES) {
    return Response.json(
      {
        error:
          `Encrypted blob is ${formatBytes(encrypted.size)} — over the ` +
          `${formatBytes(VAULT_MOVE_MAX_CIPHERTEXT_BYTES)} web-move limit (the server caps a ` +
          'request body at 4.5 MB). Move this item from the extension instead; it uploads ' +
          'straight to the vault host with no relay limit.',
      },
      { status: 413 }
    )
  }

  let current
  try {
    const [row] = await db.select().from(mediaItems).where(eq(mediaItems.id, id)).limit(1)
    current = row
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to read the vault item' },
      { status: 500 }
    )
  }

  if (!current || current.deletedAt) {
    return Response.json({ error: 'Item not found' }, { status: 404 })
  }
  if (isSystemMediaItem(current)) {
    return Response.json({ error: 'System items cannot be vaulted' }, { status: 400 })
  }
  if (isVaultedMediaItem(current)) {
    return Response.json({ error: 'Item is already in the Secret Vault' }, { status: 400 })
  }
  if (!MOVE_KINDS.has(String(current.kind || '').toLowerCase())) {
    return Response.json(
      { error: `"${current.kind || 'unknown'}" items cannot be vaulted from the web — only images and videos` },
      { status: 400 }
    )
  }

  let settingsRow
  try {
    ;[settingsRow] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.id, 'config'))
      .limit(1)
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to read the API settings' },
      { status: 500 }
    )
  }

  const token = String(settingsRow?.telegramBotToken || '').trim()
  const channel = String(settingsRow?.telegramChannel || '').trim()
  let chatId = ''
  try {
    chatId = channel ? telegramChatId(channel) : ''
  } catch {
    chatId = ''
  }
  if (!token || !chatId) {
    return Response.json(
      {
        error:
          'The web vault move uploads the encrypted copy to your Telegram channel, and Telegram ' +
          'is not configured. Set the bot token + channel in Settings → API Keys, or move the ' +
          'item from the extension.',
      },
      { status: 400 }
    )
  }

  // Opaque name: the original filename only exists inside the encrypted metadata.
  const opaqueName = `${Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}.bin`

  let message
  try {
    message = await sendTelegramFile({
      token,
      channel,
      blob: encrypted,
      filename: opaqueName,
      mimeType: 'application/octet-stream',
      method: 'sendDocument',
    })
  } catch (error) {
    return Response.json(
      { error: `Could not store the encrypted blob in Telegram: ${error.message || error}` },
      { status: 502 }
    )
  }

  const messageId = String(message?.message_id || '')
  const fileId = String(message?.document?.file_id || '')
  if (!fileId) {
    return Response.json(
      {
        error:
          `Telegram sendDocument stored the blob as message ${messageId || 'unknown'} but returned ` +
          'no document.file_id — the item was not vaulted. Check the channel for a stray post.',
      },
      { status: 502 }
    )
  }

  const chatSlug = chatId.replace(/^@+/, '')
  const localUrl = telegramLocalMediaUrl(fileId, message?.document?.mime_type || '')
  const copy = buildVaultBlobCopy('telegram', {
    url: localUrl,
    directUrl: localUrl,
    watchUrl: messageId ? `https://t.me/${chatSlug}/${messageId}` : '',
    fileId,
    messageId,
  })

  const extra = getExtraMetadata(current)
  const nextExtra = { ...extra }
  for (const key of PLAINTEXT_EXTRA_KEYS) delete nextExtra[key]
  Object.assign(nextExtra, {
    isVaulted: true,
    wasVaulted: false,
    vaultMode: 'hidden',
    vaultedAt: new Date().toISOString(),
    encryptedBlobUrl: copy.encryptedBlobUrl || '',
    encryptedBlobWatchUrl: copy.encryptedBlobWatchUrl || '',
    encryptedBlobFileId: copy.encryptedBlobFileId || '',
    encryptedBlobMessageId: copy.encryptedBlobMessageId || '',
    encryptedBlobHosts: [copy],
    encryptedMetadata,
    encryptedMimeType,
    encryptedFileName: opaqueName,
    vaultHost: copy.host,
    vaultHosts: [copy.host],
  })

  let updated
  try {
    ;[updated] = await db
      .update(mediaItems)
      .set({
        ...PLAINTEXT_COLUMN_BLANKS,
        extraMetadata: nextExtra,
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, id))
      .returning()
  } catch (error) {
    let cleanup = ''
    try {
      await deleteTelegramMessage({ token, channel, messageId })
      cleanup = ` The uploaded Telegram post ${messageId} was deleted again so a retry starts clean.`
    } catch (cleanupError) {
      cleanup =
        ` The uploaded Telegram post ${messageId} could NOT be deleted ` +
        `(${cleanupError.message || cleanupError}) — remove it from the channel before retrying.`
    }
    return Response.json(
      {
        error:
          `The encrypted copy reached Telegram but the item could not be updated: ` +
          `${error?.message || error}.${cleanup}`,
      },
      { status: 500 }
    )
  }

  // The row is vaulted now, so revoking old public share links is a separate
  // step: deleting the blob here would strand the just-saved row. A revoke
  // failure rides back as a loud warning instead of undoing the move.
  let warning = ''
  try {
    await db
      .update(shareLinks)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(shareLinks.imageId, id), isNull(shareLinks.revokedAt)))
  } catch (error) {
    warning =
      `Item vaulted, but its public share links could not be revoked: ` +
      `${error?.message || error}. Revoke them from the share settings.`
  }

  return Response.json({
    item: toClientMediaItem(updated),
    host: copy.host,
    encryptedSize: encrypted.size,
    ...(warning ? { warning } : {}),
  })
}
