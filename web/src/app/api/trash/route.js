import { db } from '@/db'
import { mediaItems } from '@/db/schema'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { auth } from '@/app/api/auth/[...nextauth]/route'
import { isSystemMediaItem, isVaultedMediaItem } from '@/lib/vault-media'
import { getImageProviderLinks } from '@/lib/image-provider-links'
import { getVideoProviderLinks } from '@/lib/video-provider-links'

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
    const items = await db
      .select()
      .from(mediaItems)
      .where(and(eq(mediaItems.isLink, false), isNotNull(mediaItems.deletedAt)))
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
