import { db } from '@/db'
import { shareLinks } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function GET(_request, { params }) {
  try {
    const resolvedParams = await params

    if (!db) {
      return Response.json({ error: 'Database unavailable' }, { status: 503 })
    }

    const token = typeof resolvedParams?.token === 'string' ? resolvedParams.token.trim() : ''

    if (!token) {
      return Response.json({ error: 'Missing share token' }, { status: 400 })
    }

    const shareLink = await db.query.shareLinks.findFirst({
      where: eq(shareLinks.token, token),
    })

    if (!shareLink) {
      return Response.json({ error: 'Share link not found' }, { status: 404 })
    }

    if (shareLink.revokedAt) {
      return Response.json({ error: 'Link deleted' }, { status: 410 })
    }

    const payload = shareLink.imageData

    if (payload?.shareType === 'album' && Array.isArray(payload.items)) {
      return Response.json({
        share: payload,
      })
    }

    return Response.json({
      image: payload,
      share: {
        shareVersion: 1,
        shareType: 'item',
        title: payload?.pageTitle || 'Shared item',
        itemCount: 1,
        items: payload ? [payload] : [],
      },
    })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to load shared image' },
      { status: 500 }
    )
  }
}
