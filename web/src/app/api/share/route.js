import { db } from '@/db'
import { collections, mediaItems, shareLinks } from '@/db/schema'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { auth } from '@/app/api/auth/[...nextauth]/route'
import {
  VAULT_CONFIG_SYSTEM_TYPE,
  isSystemMediaItem,
  isVaultedMediaItem,
  toClientMediaItem,
} from '@/lib/vault-media'
import { getMediaItemKind } from '@shared/mediaFieldRegistry.js'

function stripImageHostDeleteUrls(imageHosts) {
  if (!imageHosts || typeof imageHosts !== 'object') return imageHosts

  return Object.fromEntries(
    Object.entries(imageHosts).map(([key, value]) => {
      if (!value || typeof value !== 'object') return [key, value]
      const safeValue = { ...value }
      delete safeValue.deleteUrl
      return [key, safeValue]
    })
  )
}

function createToken() {
  return crypto.randomUUID().replace(/-/g, '')
}

function sanitizeSharedMediaData(imageData) {
  const cloned = { ...imageData }
  delete cloned.imgbbDeleteUrl
  delete cloned.pixvidDeleteUrl
  delete cloned.ai
  cloned.imageHosts = stripImageHostDeleteUrls(cloned.imageHosts)
  if (cloned.extraMetadata?.imageHosts && typeof cloned.extraMetadata.imageHosts === 'object') {
    cloned.extraMetadata = {
      ...cloned.extraMetadata,
      imageHosts: stripImageHostDeleteUrls(cloned.extraMetadata.imageHosts),
    }
  }
  if (cloned.extraMetadata?.ai) {
    const safeExtraMetadata = { ...cloned.extraMetadata }
    delete safeExtraMetadata.ai
    cloned.extraMetadata = safeExtraMetadata
  }
  return cloned
}

const visibleShareWhere = and(
  isNull(mediaItems.deletedAt),
  sql`left(${mediaItems.id}, 11) <> ${'__imgvault_'}`,
  sql`coalesce(${mediaItems.extraMetadata}->>'systemType', '') <> ${VAULT_CONFIG_SYSTEM_TYPE}`,
  sql`coalesce(lower(${mediaItems.extraMetadata}->>'isVaulted'), 'false') not in ('true', '1', 'yes')`
)

const SHARE_FILTERS = new Set(['all', 'image', 'video', 'link'])

function normalizeShareFilter(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : 'all'
  return SHARE_FILTERS.has(normalized) ? normalized : 'all'
}

function getSharePayloadTitle({ scope, filter, collection }) {
  if (scope === 'collection') {
    return collection?.name ? `${collection.name}` : 'Shared album'
  }

  if (filter === 'image') return 'Shared images'
  if (filter === 'video') return 'Shared videos'
  if (filter === 'link') return 'Shared links'
  return 'Shared gallery'
}

async function findVisibleMediaItems({ scope, collectionId, filter }) {
  const whereClause = scope === 'collection'
    ? and(visibleShareWhere, eq(mediaItems.collectionId, collectionId))
    : visibleShareWhere

  const rows = await db
    .select()
    .from(mediaItems)
    .where(whereClause)
    .orderBy(desc(mediaItems.internalAddedTimestamp))

  const safeItems = rows
    .filter((item) => !isSystemMediaItem(item) && !isVaultedMediaItem(item))
    .map(toClientMediaItem)
    .filter((item) => filter === 'all' || getMediaItemKind(item) === filter)
    .map(sanitizeSharedMediaData)

  return safeItems
}

async function upsertShareLink({ userId, shareKey, payload }) {
  const existing = await db.query.shareLinks.findFirst({
    where: and(
      eq(shareLinks.userId, userId),
      eq(shareLinks.imageId, shareKey),
      isNull(shareLinks.revokedAt)
    ),
  })

  if (existing) {
    await db
      .update(shareLinks)
      .set({
        imageData: payload,
        updatedAt: new Date(),
      })
      .where(eq(shareLinks.id, existing.id))

    return {
      token: existing.token,
      url: `/share/${existing.token}`,
    }
  }

  const token = createToken()

  await db.insert(shareLinks).values({
    userId,
    imageId: shareKey,
    token,
    imageData: payload,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  return {
    token,
    url: `/share/${token}`,
  }
}

export async function POST(request) {
  try {
    const session = await auth()

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

    const scope = typeof body?.scope === 'string' ? body.scope.trim().toLowerCase() : 'item'
    const filter = normalizeShareFilter(body?.mediaFilter || body?.filter || body?.kind)
    const imageId = typeof body?.imageId === 'string' ? body.imageId.trim() : ''
    const imageData = body?.imageData && typeof body.imageData === 'object' ? body.imageData : null
    const collectionId = typeof body?.collectionId === 'string' ? body.collectionId.trim() : ''

    if (scope === 'collection' || scope === 'filter') {
      if (scope === 'collection' && !collectionId) {
        return Response.json({ error: 'collectionId is required for album share links' }, { status: 400 })
      }

      const collection = scope === 'collection'
        ? await db.query.collections.findFirst({ where: eq(collections.id, collectionId) })
        : null

      const items = await findVisibleMediaItems({ scope, collectionId, filter })

      if (items.length === 0) {
        return Response.json({ error: 'No shareable items found for this view' }, { status: 404 })
      }

      const shareKey = scope === 'collection'
        ? `collection:${collectionId}:${filter}`
        : `filter:${filter}`

      const payload = {
        shareVersion: 1,
        shareType: 'album',
        scope,
        filter,
        title: getSharePayloadTitle({ scope, filter, collection }),
        collectionId: scope === 'collection' ? collectionId : null,
        itemCount: items.length,
        items,
      }

      const response = await upsertShareLink({
        userId: session.user.id,
        shareKey,
        payload,
      })

      return Response.json(response)
    }

    if (!imageId || !imageData) {
      return Response.json({ error: 'imageId and imageData are required' }, { status: 400 })
    }

    const storedItem = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, imageId),
    })

    if (storedItem && isSystemMediaItem(storedItem)) {
      return Response.json({ error: 'Image not found' }, { status: 404 })
    }

    if (isVaultedMediaItem(imageData) || isVaultedMediaItem(storedItem)) {
      return Response.json({ error: 'Vaulted items cannot be shared' }, { status: 403 })
    }

    const sanitizedImageData = sanitizeSharedMediaData(
      storedItem ? toClientMediaItem(storedItem) : imageData
    )

    const response = await upsertShareLink({
      userId: session.user.id,
      shareKey: imageId,
      payload: sanitizedImageData,
    })

    return Response.json(response)
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to create share link' },
      { status: 500 }
    )
  }
}
