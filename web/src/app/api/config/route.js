import { db } from '@/db'
import { userConfigs } from '@/db/schema'
import { eq } from 'drizzle-orm'

async function getSession() {
  const { auth } = await import('@/app/api/auth/[...nextauth]/route')
  return auth()
}

export async function GET() {
  const session = await getSession()
  
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!db) {
    return Response.json({ config: null })
  }

  const config = await db.query.userConfigs.findFirst({
    where: eq(userConfigs.userId, session.user.id),
  })

  return Response.json({ config: config?.firebaseConfig || null })
}

export async function POST(request) {
  const session = await getSession()
  
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!db) {
    return Response.json({ error: 'Database not configured' }, { status: 500 })
  }

  const body = await request.json()
  const { firebaseConfig } = body

  if (!firebaseConfig) {
    return Response.json({ error: 'Firebase config required' }, { status: 400 })
  }

  // Upsert the config
  const existing = await db.query.userConfigs.findFirst({
    where: eq(userConfigs.userId, session.user.id),
  })

  if (existing) {
    await db
      .update(userConfigs)
      .set({ firebaseConfig, updatedAt: new Date() })
      .where(eq(userConfigs.userId, session.user.id))
  } else {
    await db.insert(userConfigs).values({
      userId: session.user.id,
      firebaseConfig,
    })
  }

  return Response.json({ success: true })
}
