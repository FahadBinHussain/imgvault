import { db } from '@/db'
import { mediaItems } from '@/db/schema'
import { desc, isNull } from 'drizzle-orm'
import { auth } from '@/app/api/auth/[...nextauth]/route'

async function getSession() {
  return auth()
}

function toClientMediaItem(item) {
  return {
    ...item,
    tags: Array.isArray(item.tags) ? item.tags : [],
    filemoonUrl: item.filemoonWatchUrl || '',
    udropUrl: item.udropWatchUrl || '',
  }
}

export async function GET() {
  const session = await getSession()

  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!db) {
    return Response.json({ images: [] })
  }

  try {
    const images = await db
      .select()
      .from(mediaItems)
      .where(isNull(mediaItems.deletedAt))
      .orderBy(desc(mediaItems.internalAddedTimestamp))

    return Response.json({ images: images.map(toClientMediaItem) })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to fetch images' },
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

  const imageId = typeof body?.id === 'string' ? body.id.trim() : ''
  const updates = body?.updates && typeof body.updates === 'object' ? body.updates : null

  if (!imageId || !updates) {
    return Response.json({ error: 'Image id and updates are required' }, { status: 400 })
  }

  const editableFields = new Set([
    'pageTitle',
    'creationDate',
    'pixvidUrl',
    'imgbbUrl',
    'sourceImageUrl',
    'sourcePageUrl',
    'description',
    'tags',
  ])

  const sanitizedUpdates = {}

  for (const [key, value] of Object.entries(updates)) {
    if (!editableFields.has(key)) continue

    if (key === 'tags') {
      if (!Array.isArray(value)) {
        return Response.json({ error: 'tags must be an array of strings' }, { status: 400 })
      }

      sanitizedUpdates.tags = value
        .map((item) => String(item).trim())
        .filter(Boolean)
      continue
    }

    if (value === null) {
      sanitizedUpdates[key] = null
      continue
    }

    if (typeof value !== 'string') {
      return Response.json({ error: `${key} must be a string or null` }, { status: 400 })
    }

    const trimmed = value.trim()
    sanitizedUpdates[key] = trimmed || null
  }

  const fieldsToUpdate = Object.keys(sanitizedUpdates)
  if (fieldsToUpdate.length === 0) {
    return Response.json({ error: 'No editable fields provided to update' }, { status: 400 })
  }

  try {
    await db
      .update(mediaItems)
      .set({
        ...sanitizedUpdates,
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, imageId))

    const [updatedItem] = await db.select().from(mediaItems).where(eq(mediaItems.id, imageId)).limit(1)
    if (!updatedItem) {
      return Response.json({ error: 'Image not found' }, { status: 404 })
    }

    return Response.json({ image: toClientMediaItem(updatedItem) })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to update image metadata' },
      { status: 500 }
    )
  }
}
