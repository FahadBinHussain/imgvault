import { db } from '@/db'
import { mediaItems } from '@/db/schema'
import { desc, eq, isNull } from 'drizzle-orm'
import { auth } from '@/app/api/auth/[...nextauth]/route'
import {
  getExtraMetadata,
  getVaultExtraMetadata,
  isSystemMediaItem,
  isVaultedMediaItem,
  toClientMediaItem,
} from '@/lib/vault-media'

async function getSession() {
  return auth()
}

export async function GET() {
  const session = await getSession()

  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!db) {
    return Response.json({ items: [] })
  }

  try {
    const items = await db
      .select()
      .from(mediaItems)
      .where(isNull(mediaItems.deletedAt))
      .orderBy(desc(mediaItems.internalAddedTimestamp))

    return Response.json({
      items: items
        .filter((item) => !isSystemMediaItem(item) && isVaultedMediaItem(item))
        .map(toClientMediaItem),
    })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to fetch vault items' },
      { status: 500 }
    )
  }
}

export async function PATCH(request) {
  const session = await getSession()

  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!db) {
    return Response.json({ error: 'Database unavailable' }, { status: 503 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  const action = typeof body?.action === 'string' ? body.action.trim() : ''

  // Moves encrypt, so they live on POST /api/vault/move (multipart ciphertext).
  // A flag-only move must never come back — it was the parity gap this closed.
  if (action === 'move') {
    return Response.json(
      { error: 'Web moves must encrypt — use POST /api/vault/move with the encrypted blob' },
      { status: 400 }
    )
  }
  if (!id || action !== 'restore') {
    return Response.json({ error: 'Vault item id and action=restore are required' }, { status: 400 })
  }

  try {
    const [current] = await db.select().from(mediaItems).where(eq(mediaItems.id, id)).limit(1)

    if (!current || current.deletedAt) {
      return Response.json({ error: 'Item not found' }, { status: 404 })
    }

    if (isSystemMediaItem(current)) {
      return Response.json({ error: 'System items cannot be vaulted' }, { status: 400 })
    }

    const extra = getExtraMetadata(current)
    const encryptedCopy = Boolean(extra.encryptedBlobUrl) ||
      (Array.isArray(extra.encryptedBlobHosts) && extra.encryptedBlobHosts.length > 0)
    if (encryptedCopy) {
      // Un-vaulting would leave a row with no plaintext URL to show. Restoring
      // needs the master key + an upload path, which only the extension has.
      return Response.json(
        {
          error:
            'Encrypted vault items can only be restored from the extension — restoring needs the ' +
            'master key to re-upload the plaintext, and the web app has no upload path.',
        },
        { status: 400 }
      )
    }

    await db
      .update(mediaItems)
      .set({
        extraMetadata: getVaultExtraMetadata(current, false),
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, id))

    const [updatedItem] = await db.select().from(mediaItems).where(eq(mediaItems.id, id)).limit(1)

    return Response.json({ item: toClientMediaItem(updatedItem) })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to update vault item' },
      { status: 500 }
    )
  }
}
