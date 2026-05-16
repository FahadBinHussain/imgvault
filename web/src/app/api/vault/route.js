import { db } from '@/db'
import { mediaItems, shareLinks } from '@/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { auth } from '@/app/api/auth/[...nextauth]/route'
import {
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

  if (!id || !['move', 'restore'].includes(action)) {
    return Response.json({ error: 'Vault item id and action are required' }, { status: 400 })
  }

  try {
    const [current] = await db.select().from(mediaItems).where(eq(mediaItems.id, id)).limit(1)

    if (!current || current.deletedAt) {
      return Response.json({ error: 'Item not found' }, { status: 404 })
    }

    if (isSystemMediaItem(current)) {
      return Response.json({ error: 'System items cannot be vaulted' }, { status: 400 })
    }

    const shouldVault = action === 'move'
    const extraMetadata = getVaultExtraMetadata(current, shouldVault)

    await db
      .update(mediaItems)
      .set({
        extraMetadata,
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, id))

    if (shouldVault) {
      await db
        .update(shareLinks)
        .set({
          revokedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(shareLinks.imageId, id), isNull(shareLinks.revokedAt)))
    }

    const [updatedItem] = await db.select().from(mediaItems).where(eq(mediaItems.id, id)).limit(1)

    return Response.json({ item: toClientMediaItem(updatedItem) })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to update vault item' },
      { status: 500 }
    )
  }
}
