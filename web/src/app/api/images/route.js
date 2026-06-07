import { db } from '@/db'
import { mediaItems } from '@/db/schema'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { auth } from '@/app/api/auth/[...nextauth]/route'
import {
  VAULT_CONFIG_SYSTEM_TYPE,
  isSystemMediaItem,
  isVaultedMediaItem,
  toClientMediaItem,
  toClientMediaListItem,
} from '@/lib/vault-media'
import { normalizeImageHosts } from '@shared/mediaItemNormalizer.js'

async function getSession() {
  return auth()
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && entryValue !== '')
  )
}

function parseNullableTimestamp(value, fieldName) {
  if (value === null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid date/time`)
  }

  return parsed
}

function syncImageHostUrl(imageHosts, providerKey, nextUrl) {
  const nextHosts = { ...imageHosts }
  const current = isPlainObject(nextHosts[providerKey]) ? { ...nextHosts[providerKey] } : {}

  if (typeof nextUrl === 'string' && nextUrl.trim()) {
    const url = nextUrl.trim()
    nextHosts[providerKey] = {
      ...current,
      url,
      displayUrl: current.displayUrl || url,
      directUrl: current.directUrl || url,
    }
    return nextHosts
  }

  delete current.url
  delete current.displayUrl
  delete current.directUrl

  const compacted = compactObject(current)
  if (Object.keys(compacted).length > 0) {
    nextHosts[providerKey] = compacted
  } else {
    delete nextHosts[providerKey]
  }

  return nextHosts
}

function buildExtraMetadataForImageEdits(current, sanitizedUpdates) {
  const touchesImageHosts = (
    Object.prototype.hasOwnProperty.call(sanitizedUpdates, 'pixvidUrl') ||
    Object.prototype.hasOwnProperty.call(sanitizedUpdates, 'imgbbUrl')
  )

  if (!touchesImageHosts) return null

  const extraMetadata = isPlainObject(current.extraMetadata) ? { ...current.extraMetadata } : {}
  let imageHosts = normalizeImageHosts({
    ...current,
    ...sanitizedUpdates,
    extraMetadata,
  }, extraMetadata)

  if (Object.prototype.hasOwnProperty.call(sanitizedUpdates, 'pixvidUrl')) {
    imageHosts = syncImageHostUrl(imageHosts, 'pixvid', sanitizedUpdates.pixvidUrl)
  }
  if (Object.prototype.hasOwnProperty.call(sanitizedUpdates, 'imgbbUrl')) {
    imageHosts = syncImageHostUrl(imageHosts, 'imgbb', sanitizedUpdates.imgbbUrl)
  }

  if (Object.keys(imageHosts).length > 0) {
    extraMetadata.imageHosts = imageHosts
  } else {
    delete extraMetadata.imageHosts
  }

  return extraMetadata
}

const visibleGalleryWhere = and(
  isNull(mediaItems.deletedAt),
  sql`left(${mediaItems.id}, 11) <> ${'__imgvault_'}`,
  sql`coalesce(${mediaItems.extraMetadata}->>'systemType', '') <> ${VAULT_CONFIG_SYSTEM_TYPE}`,
  sql`coalesce(lower(${mediaItems.extraMetadata}->>'isVaulted'), 'false') not in ('true', '1', 'yes')`
)

const galleryListSelect = {
  id: mediaItems.id,
  kind: mediaItems.kind,
  isVideo: mediaItems.isVideo,
  isLink: mediaItems.isLink,
  pageTitle: mediaItems.pageTitle,
  description: mediaItems.description,
  tags: mediaItems.tags,
  collectionId: mediaItems.collectionId,
  internalAddedTimestamp: mediaItems.internalAddedTimestamp,
  sourceImageUrl: mediaItems.sourceImageUrl,
  sourcePageUrl: mediaItems.sourcePageUrl,
  fileName: mediaItems.fileName,
  fileSize: mediaItems.fileSize,
  width: mediaItems.width,
  height: mediaItems.height,
  duration: mediaItems.duration,
  fileType: mediaItems.fileType,
  creationDate: mediaItems.creationDate,
  pixvidUrl: mediaItems.pixvidUrl,
  imgbbUrl: mediaItems.imgbbUrl,
  imgbbThumbUrl: mediaItems.imgbbThumbUrl,
  filemoonWatchUrl: mediaItems.filemoonWatchUrl,
  filemoonDirectUrl: mediaItems.filemoonDirectUrl,
  udropWatchUrl: mediaItems.udropWatchUrl,
  udropDirectUrl: mediaItems.udropDirectUrl,
  linkUrl: mediaItems.linkUrl,
  linkUrlCanonical: mediaItems.linkUrlCanonical,
  linkPreviewImageUrl: mediaItems.linkPreviewImageUrl,
  faviconUrl: mediaItems.faviconUrl,
  lastVisitedAt: mediaItems.lastVisitedAt,
  deletedAt: mediaItems.deletedAt,
  createdAt: mediaItems.createdAt,
  updatedAt: mediaItems.updatedAt,
  videoThumbnailUrl: sql`coalesce(
    ${mediaItems.extraMetadata}->'videoHosts'->'filemoon'->>'thumbnailUrl',
    ${mediaItems.extraMetadata}->'videoHosts'->'udrop'->>'thumbnailUrl',
    ${mediaItems.extraMetadata}->'_migrations'->'mediaFormatV2'->'originalRow'->>'imgbb_thumb_url',
    ${mediaItems.extraMetadata}->'_migrations'->'mediaFormatV2'->'originalRow'->>'link_preview_image_url',
    ${mediaItems.extraMetadata}->'_migrations'->'mediaFormatV2'->'originalRow'->'extra_metadata'->>'imgbbThumbUrl',
    ${mediaItems.extraMetadata}->'_migrations'->'mediaFormatV2'->'originalRow'->'extra_metadata'->>'linkPreviewImageUrl',
    ''
  )`,
}

export async function GET(request) {
  const session = await getSession()

  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!db) {
    return Response.json({ images: [] })
  }

  try {
    const detailId = new URL(request.url).searchParams.get('id')?.trim()

    if (detailId) {
      const [image] = await db
        .select()
        .from(mediaItems)
        .where(and(eq(mediaItems.id, detailId), isNull(mediaItems.deletedAt)))
        .limit(1)

      if (!image || isSystemMediaItem(image) || isVaultedMediaItem(image)) {
        return Response.json({ error: 'Image not found' }, { status: 404 })
      }

      return Response.json({ image: toClientMediaItem(image) })
    }

    const images = await db
      .select(galleryListSelect)
      .from(mediaItems)
      .where(visibleGalleryWhere)
      .orderBy(desc(mediaItems.createdAt), desc(mediaItems.internalAddedTimestamp))

    return Response.json({
      images: images.map(toClientMediaListItem),
    })
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

    if (key === 'creationDate') {
      const parsedTimestamp = parseNullableTimestamp(value, key)
      if (parsedTimestamp === undefined) {
        return Response.json({ error: `${key} must be a valid date/time string or null` }, { status: 400 })
      }
      sanitizedUpdates[key] = parsedTimestamp
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
    const [currentItem] = await db.select().from(mediaItems).where(eq(mediaItems.id, imageId)).limit(1)
    if (!currentItem) {
      return Response.json({ error: 'Image not found' }, { status: 404 })
    }

    const updateSet = {
      ...sanitizedUpdates,
      updatedAt: new Date(),
    }
    const extraMetadata = buildExtraMetadataForImageEdits(currentItem, sanitizedUpdates)
    if (extraMetadata) updateSet.extraMetadata = extraMetadata

    await db
      .update(mediaItems)
      .set(updateSet)
      .where(eq(mediaItems.id, imageId))

    const [updatedItem] = await db.select().from(mediaItems).where(eq(mediaItems.id, imageId)).limit(1)

    return Response.json({ image: toClientMediaItem(updatedItem) })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to update image metadata' },
      { status: 500 }
    )
  }
}
