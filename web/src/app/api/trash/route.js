import { db } from '@/db'
import {
  mediaItems,
  mediaItemPreviews,
  collections,
  settings as settingsTable,
  userConfigs,
} from '@/db/schema'
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { auth } from '@/app/api/auth/[...nextauth]/route'
import { isSystemMediaItem, isVaultedMediaItem } from '@/lib/vault-media'
import { getImageProviderLinks } from '@/lib/image-provider-links'
import { getVideoProviderLinks } from '@/lib/video-provider-links'
import { isTruthyFlag } from '@shared/mediaFieldRegistry.js'
import {
  deleteImgbbByDeleteUrl,
  deletePixvidByDeleteUrl,
  deleteVaultBlobCopies,
} from '@/lib/hostDeletes'

// TeraBox recursive path resolution + host deletes can run long; give the
// action room (survivors of a timeout stay in trash and are retryable).
export const maxDuration = 60

async function getSession() {
  return auth()
}

function toClientTrashItem(item) {
  const imageHosts = getImageProviderLinks(item)
  const videoHosts = getVideoProviderLinks(item)
  return {
    ...item,
    imageHosts,
    videoHosts,
    tags: Array.isArray(item.tags) ? item.tags : [],
    filemoonUrl: videoHosts.filemoon?.watchUrl || item.filemoonWatchUrl || '',
    udropUrl: videoHosts.udrop?.watchUrl || item.udropWatchUrl || '',
    originalId: item.id,
  }
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
    // no isLink filter — the extension trash lists link items too, and the
    // web gallery shows them, so hiding them here was a parity gap
    const items = await db
      .select()
      .from(mediaItems)
      .where(isNotNull(mediaItems.deletedAt))
      .orderBy(desc(mediaItems.deletedAt))
    return Response.json({
      items: items
        .filter((item) => !isSystemMediaItem(item) && !isVaultedMediaItem(item))
        .map(toClientTrashItem),
    })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to fetch trash' },
      { status: 500 }
    )
  }
}

async function getTrashedRow(id) {
  const [row] = await db
    .select()
    .from(mediaItems)
    .where(and(eq(mediaItems.id, id), isNotNull(mediaItems.deletedAt)))
    .limit(1)
  return row || null
}

/**
 * Host credentials for vault-blob cleanup: UDrop keys live in the
 * public.settings columns, the TeraBox cookie in user_configs.app_settings
 * (same merge rule as /api/config GET).
 */
async function loadHostSettings(userId) {
  const [globalSettings] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.id, 'config'))
    .limit(1)
  const userConfig = await db.query.userConfigs.findFirst({
    where: eq(userConfigs.userId, userId),
  })
  const appSettings =
    userConfig?.appSettings && typeof userConfig.appSettings === 'object'
      ? userConfig.appSettings
      : {}
  return {
    udropKey1: globalSettings?.udropKey1 || '',
    udropKey2: globalSettings?.udropKey2 || '',
    teraboxCookie: appSettings.teraboxCookie || '',
  }
}

/**
 * Restore from trash — mirror of restoreFromTrashNeon:
 *  1. clear deleted_at
 *  2. re-vault anything showing vault provenance (encrypted blob or the
 *     wasVaulted/vaultMode/vaultedAt markers) — a plain restore would strand
 *     an encrypted .bin with no provider URLs ("item vanished", 2.12.77)
 *  3. clear stale vault markers on plain gallery items
 *  4. a NON-re-vault restore exits the vault for good → drop its preview row
 *  5. collection count +1 for non-vault restores (vault items are excluded
 *     from counts, symmetric with the delete side)
 */
async function restoreTrashedItem(row) {
  const extra = row.extraMetadata && typeof row.extraMetadata === 'object' ? row.extraMetadata : {}
  const wasVaultItem = Boolean(
    extra.encryptedBlobUrl ||
      isTruthyFlag(extra.wasVaulted) ||
      extra.vaultMode === 'hidden' ||
      extra.vaultedAt
  )

  const now = new Date()
  const updatePayload = { deletedAt: null, updatedAt: now }
  if (wasVaultItem) {
    updatePayload.extraMetadata = {
      ...extra,
      isVaulted: true,
      wasVaulted: false,
      vaultMode: 'hidden',
      vaultedAt: now.toISOString(),
    }
  } else if (isTruthyFlag(extra.wasVaulted) || extra.vaultMode === 'hidden') {
    updatePayload.extraMetadata = { ...extra, wasVaulted: false, vaultMode: '', vaultedAt: '' }
  }

  await db.update(mediaItems).set(updatePayload).where(eq(mediaItems.id, row.id))

  if (!wasVaultItem) {
    try {
      await db.delete(mediaItemPreviews).where(eq(mediaItemPreviews.itemId, row.id))
    } catch (error) {
      console.warn(
        `[trash restore] vault preview cleanup failed for ${row.id}: ${error.message || error}`
      )
    }
  }

  if (row.collectionId && !wasVaultItem) {
    await db
      .update(collections)
      .set({ imageCount: sql`${collections.imageCount} + 1`, updatedAt: now })
      .where(eq(collections.id, row.collectionId))
  }

  return Response.json({ success: true, revaulted: wasVaultItem })
}

/**
 * Permanent delete of one trashed row — mirror of permanentlyDeleteItem:
 * vault blob host cleanup FIRST (throws keep the row), then the imgbb delete
 * URL (must confirm or throw — the URL is lost once the row goes), then the
 * pixvid delete URL (best-effort warn), then the row itself (FK cascade drops
 * the preview row).
 */
async function performPermanentDelete(row, settings) {
  const extra = row.extraMetadata && typeof row.extraMetadata === 'object' ? row.extraMetadata : {}

  await deleteVaultBlobCopies(extra, settings)

  if (row.imgbbDeleteUrl) {
    let confirmed = false
    try {
      confirmed = await deleteImgbbByDeleteUrl(row.imgbbDeleteUrl)
    } catch (error) {
      throw new Error(
        `ImgBB deletion failed (${error.message || error}); keeping item in trash so the delete URL is not lost.`
      )
    }
    if (!confirmed) {
      throw new Error(
        'ImgBB delete URL did not confirm deletion; keeping item in trash so the delete URL is not lost.'
      )
    }
  }

  if (row.pixvidDeleteUrl) {
    await deletePixvidByDeleteUrl(row.pixvidDeleteUrl)
  }

  await db.delete(mediaItems).where(eq(mediaItems.id, row.id))
}

/**
 * Empty trash — mirror of emptyTrashItems: every row goes through the same
 * per-item permanent delete; items whose host delete fails SURVIVE (a blocked
 * item never silently vanishes while its blob lives on, and never blocks the
 * deletable items), and the response then fails loud with the counts.
 */
async function emptyTrash(userId) {
  const rows = await db.select({ id: mediaItems.id }).from(mediaItems).where(isNotNull(mediaItems.deletedAt))
  if (rows.length === 0) {
    return Response.json({ success: true, deleted: 0 })
  }

  const settings = await loadHostSettings(userId)
  let deleted = 0
  const survivors = []

  for (const { id } of rows) {
    try {
      const row = await getTrashedRow(id)
      if (!row) continue
      await performPermanentDelete(row, settings)
      deleted += 1
    } catch (error) {
      survivors.push(id)
      console.error(`[empty trash] item ${id} survived: ${error.message || error}`)
    }
  }

  if (survivors.length > 0) {
    return Response.json(
      {
        error: `${survivors.length} of ${rows.length} item(s) could not be deleted (host cleanup failed — see server logs for per-item reasons). They remain in trash; reload trash to see them.`,
        deleted,
        survivors: survivors.length,
      },
      { status: 500 }
    )
  }

  return Response.json({ success: true, deleted })
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

  const action = typeof body?.action === 'string' ? body.action : ''
  const id = typeof body?.id === 'string' ? body.id.trim() : ''

  if (action === 'trash') {
    // Move INTO trash — mirror of the extension's moveToTrashNeon: stamp
    // deleted_at + updated_at on a live row and drop the collection count.
    if (!id) {
      return Response.json({ error: 'Item id is required' }, { status: 400 })
    }
    try {
      const [row] = await db
        .select({ id: mediaItems.id, collectionId: mediaItems.collectionId })
        .from(mediaItems)
        .where(and(eq(mediaItems.id, id), isNull(mediaItems.deletedAt)))
        .limit(1)
      if (!row) {
        return Response.json(
          { error: 'Item not found (already in trash, or never existed)' },
          { status: 404 }
        )
      }

      const now = new Date()
      await db
        .update(mediaItems)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(mediaItems.id, id), isNull(mediaItems.deletedAt)))

      if (row.collectionId) {
        await db
          .update(collections)
          .set({ imageCount: sql`greatest(0, ${collections.imageCount} - 1)`, updatedAt: now })
          .where(eq(collections.id, row.collectionId))
      }

      return Response.json({ success: true, id })
    } catch (error) {
      return Response.json(
        { error: error?.message || 'Move to trash failed' },
        { status: 500 }
      )
    }
  }

  if (action === 'restore' || action === 'delete') {
    if (!id) {
      return Response.json({ error: 'Item id is required' }, { status: 400 })
    }
    const row = await getTrashedRow(id)
    if (!row) {
      return Response.json({ error: 'Item not found in trash' }, { status: 404 })
    }
    try {
      if (action === 'restore') {
        return await restoreTrashedItem(row)
      }
      await performPermanentDelete(row, await loadHostSettings(session.user.id))
      return Response.json({ success: true })
    } catch (error) {
      return Response.json(
        { error: error?.message || 'Trash action failed' },
        { status: 500 }
      )
    }
  }

  if (action === 'empty') {
    try {
      return await emptyTrash(session.user.id)
    } catch (error) {
      return Response.json({ error: error?.message || 'Empty trash failed' }, { status: 500 })
    }
  }

  return Response.json(
    { error: `Unknown trash action "${action}" (expected trash, restore, delete or empty)` },
    { status: 400 }
  )
}
