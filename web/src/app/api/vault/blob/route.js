import { db } from '@/db'
import { mediaItems, settings as settingsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { auth } from '@/app/api/auth/[...nextauth]/route'
import {
  getExtraMetadata,
  isSystemMediaItem,
  isVaultedMediaItem,
} from '@/lib/vault-media'
import { openVaultCiphertext } from '@/lib/vaultBlobSource'

const RANGE_RE = /^bytes=(\d+)-(\d+)$/

function parseRange(header) {
  if (!header) return null
  const match = RANGE_RE.exec(header.trim())
  if (!match) return { error: 'Range must be an explicit "bytes=start-end" window' }
  const start = Number(match[1])
  const end = Number(match[2])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    return { error: `Invalid byte range ${header}` }
  }
  return { start, end }
}

export async function GET(request) {
  const session = await auth()

  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!db) {
    return Response.json({ error: 'Database unavailable' }, { status: 503 })
  }

  const id = new URL(request.url).searchParams.get('id')?.trim() || ''
  if (!id) {
    return Response.json({ error: 'Vault item id is required' }, { status: 400 })
  }

  const range = parseRange(request.headers.get('range'))
  if (range?.error) {
    return Response.json({ error: range.error }, { status: 400 })
  }

  try {
    const [row] = await db.select().from(mediaItems).where(eq(mediaItems.id, id)).limit(1)

    if (!row || row.deletedAt) {
      return Response.json({ error: 'Item not found' }, { status: 404 })
    }

    if (isSystemMediaItem(row) || !isVaultedMediaItem(row)) {
      return Response.json({ error: 'Item is not in the Secret Vault' }, { status: 400 })
    }

    const extra = getExtraMetadata(row)
    if (!extra.encryptedBlobUrl && !(Array.isArray(extra.encryptedBlobHosts) && extra.encryptedBlobHosts.length > 0)) {
      return Response.json(
        { error: 'Item was vaulted without encryption — open the original provider URL from the gallery instead' },
        { status: 400 }
      )
    }

    const [settingsRow] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.id, 'config'))
      .limit(1)

    const { body, status, contentLength, total, host } = await openVaultCiphertext({
      extra,
      settings: settingsRow,
      start: range ? range.start : null,
      end: range ? range.end : null,
    })

    const headers = {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes',
      'X-Vault-Blob-Host': host,
    }
    if (contentLength > 0) headers['Content-Length'] = String(contentLength)
    if (status === 206) {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${total ?? '*'}`
    }

    return new Response(body, { status, headers })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to read the encrypted vault blob' },
      { status: 502 }
    )
  }
}
