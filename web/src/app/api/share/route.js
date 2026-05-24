import { db } from '@/db'
import { mediaItems, shareLinks } from '@/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { auth } from '@/app/api/auth/[...nextauth]/route'
import { isVaultedMediaItem } from '@/lib/vault-media'

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

function sanitizeSharedImageData(imageData) {
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

    const imageId = typeof body?.imageId === 'string' ? body.imageId.trim() : ''
    const imageData = body?.imageData && typeof body.imageData === 'object' ? body.imageData : null

    if (!imageId || !imageData) {
      return Response.json({ error: 'imageId and imageData are required' }, { status: 400 })
    }

    const storedItem = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, imageId),
    })

    if (isVaultedMediaItem(imageData) || isVaultedMediaItem(storedItem)) {
      return Response.json({ error: 'Vaulted items cannot be shared' }, { status: 403 })
    }

    const sanitizedImageData = sanitizeSharedImageData(imageData)

    const existing = await db.query.shareLinks.findFirst({
      where: and(
        eq(shareLinks.userId, session.user.id),
        eq(shareLinks.imageId, imageId),
        isNull(shareLinks.revokedAt)
      ),
    })

    if (existing) {
      await db
        .update(shareLinks)
        .set({
          imageData: sanitizedImageData,
          updatedAt: new Date(),
        })
        .where(eq(shareLinks.id, existing.id))

      return Response.json({
        token: existing.token,
        url: `/share/${existing.token}`,
      })
    }

    const token = createToken()

    await db.insert(shareLinks).values({
      userId: session.user.id,
      imageId,
      token,
      imageData: sanitizedImageData,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    return Response.json({
      token,
      url: `/share/${token}`,
    })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to create share link' },
      { status: 500 }
    )
  }
}
