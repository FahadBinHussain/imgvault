import { db } from '@/db'
import { shareLinks } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/app/api/auth/[...nextauth]/route'

export async function DELETE(_request, { params }) {
  try {
    const resolvedParams = await params
    const session = await auth()

    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!db) {
      return Response.json({ error: 'Database unavailable' }, { status: 503 })
    }

    const token = typeof resolvedParams?.token === 'string' ? resolvedParams.token.trim() : ''

    if (!token) {
      return Response.json({ error: 'Missing share token' }, { status: 400 })
    }

    const existing = await db.query.shareLinks.findFirst({
      where: and(
        eq(shareLinks.userId, session.user.id),
        eq(shareLinks.token, token)
      ),
    })

    if (!existing) {
      return Response.json({ error: 'Share link not found' }, { status: 404 })
    }

    await db
      .update(shareLinks)
      .set({
        revokedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(shareLinks.id, existing.id))

    return Response.json({ success: true })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to delete share link' },
      { status: 500 }
    )
  }
}
