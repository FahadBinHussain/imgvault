import { db } from '@/db'
import { shareLinks } from '@/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { auth } from '@/app/api/auth/[...nextauth]/route'

export async function GET() {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!db) {
      return Response.json({ error: 'Database unavailable' }, { status: 503 })
    }

    const links = await db.query.shareLinks.findMany({
      where: and(
        eq(shareLinks.userId, session.user.id),
        isNull(shareLinks.revokedAt)
      ),
      orderBy: [desc(shareLinks.updatedAt)],
    })

    return Response.json({
      links: links.map((link) => ({
        id: link.id,
        imageId: link.imageId,
        token: link.token,
        url: `/share/${link.token}`,
        imageData: link.imageData,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
      })),
    })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to load share links' },
      { status: 500 }
    )
  }
}
