import { db } from '@/db'
import { collections, mediaItems } from '@/db/schema'
import { asc, eq } from 'drizzle-orm'
import { auth } from '@/app/api/auth/[...nextauth]/route'
import {
  createCollectionId,
  mergeCollectionUpdates,
  normalizeCollection,
  normalizeCollectionName,
} from '@shared/collectionsLogic.js'

async function getSession() {
  return auth()
}

export async function GET() {
  const session = await getSession()

  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!db) {
    return Response.json({ collections: [] })
  }

  try {
    const rows = await db.select().from(collections).orderBy(asc(collections.name))
    return Response.json({ collections: rows.map((row) => normalizeCollection(row)) })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to load collections' },
      { status: 500 }
    )
  }
}

export async function POST(request) {
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

  let name
  try {
    name = normalizeCollectionName(body?.name)
  } catch (error) {
    return Response.json({ error: error?.message || 'Invalid collection name' }, { status: 400 })
  }

  const description = typeof body?.description === 'string' ? body.description.trim() : ''
  const color = typeof body?.color === 'string' ? body.color.trim() : ''
  const id = createCollectionId()

  try {
    const [row] = await db
      .insert(collections)
      .values({ id, name, description, color, imageCount: 0 })
      .returning()

    return Response.json({ collection: normalizeCollection(row) })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to create collection' },
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
  const updates = body?.updates && typeof body.updates === 'object' ? body.updates : null

  if (!id || !updates) {
    return Response.json({ error: 'Collection id and updates are required' }, { status: 400 })
  }

  // counts move only through item operations (PATCH /api/images collectionId,
  // /api/trash restore/trash) — never through a client write, so they cannot drift.
  if (Object.prototype.hasOwnProperty.call(updates, 'imageCount')) {
    return Response.json(
      {
        error:
          'imageCount is server-managed; assign/unassign items (PATCH /api/images with collectionId) or trash actions adjust it',
      },
      { status: 400 }
    )
  }

  const picked = {}
  for (const key of ['name', 'description', 'color']) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      const value = updates[key]
      picked[key] = value === null || value === undefined ? '' : String(value).trim()
    }
  }

  if (Object.prototype.hasOwnProperty.call(picked, 'name')) {
    try {
      picked.name = normalizeCollectionName(picked.name)
    } catch (error) {
      return Response.json({ error: error?.message || 'Invalid collection name' }, { status: 400 })
    }
  }

  try {
    const [current] = await db.select().from(collections).where(eq(collections.id, id)).limit(1)
    if (!current) {
      return Response.json({ error: 'Collection not found' }, { status: 404 })
    }

    const merged = mergeCollectionUpdates(normalizeCollection(current), picked)
    const [row] = await db
      .update(collections)
      .set({
        name: merged.name,
        description: merged.description,
        color: merged.color,
        updatedAt: new Date(),
      })
      .where(eq(collections.id, id))
      .returning()

    return Response.json({ collection: normalizeCollection(row) })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to update collection' },
      { status: 500 }
    )
  }
}

export async function DELETE(request) {
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
  if (!id) {
    return Response.json({ error: 'Collection id is required' }, { status: 400 })
  }

  try {
    const [current] = await db.select().from(collections).where(eq(collections.id, id)).limit(1)
    if (!current) {
      return Response.json({ error: 'Collection not found' }, { status: 404 })
    }

    // items are never deleted with their collection — they lose the assignment
    // (same semantics as the extension; the DB FK is also ON DELETE SET NULL).
    const unassigned = await db
      .update(mediaItems)
      .set({ collectionId: null })
      .where(eq(mediaItems.collectionId, id))

    await db.delete(collections).where(eq(collections.id, id))

    return Response.json({ ok: true, unassigned: unassigned.rowCount ?? 0 })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to delete collection' },
      { status: 500 }
    )
  }
}
