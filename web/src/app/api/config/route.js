import { db } from '@/db'
import { settings as settingsTable, userConfigs } from '@/db/schema'
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
    return Response.json({ config: { provider: 'neon' }, settings: null })
  }

  const [globalSettings] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.id, 'config'))
    .limit(1)

  const userConfig = await db.query.userConfigs.findFirst({
    where: eq(userConfigs.userId, session.user.id),
  })

  return Response.json({
    config: { provider: 'neon' },
    settings: {
      ...(globalSettings || {}),
      ...((userConfig?.appSettings && typeof userConfig.appSettings === 'object')
        ? userConfig.appSettings
        : {}),
    },
  })
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
  const settings = body?.settings && typeof body.settings === 'object' ? body.settings : {}

  const globalSettingsPayload = {
    id: 'config',
    pixvidApiKey: String(settings.pixvidApiKey || ''),
    imgbbApiKey: String(settings.imgbbApiKey || ''),
    filemoonApiKey: String(settings.filemoonApiKey || ''),
    udropKey1: String(settings.udropKey1 || ''),
    udropKey2: String(settings.udropKey2 || ''),
    defaultGallerySource: String(settings.defaultGallerySource || 'imgbb'),
    defaultVideoSource: String(settings.defaultVideoSource || 'filemoon'),
    updatedAt: new Date(),
  }

  const [existingGlobal] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.id, 'config'))
    .limit(1)

  if (existingGlobal) {
    await db.update(settingsTable).set(globalSettingsPayload).where(eq(settingsTable.id, 'config'))
  } else {
    await db.insert(settingsTable).values(globalSettingsPayload)
  }

  const existingUserConfig = await db.query.userConfigs.findFirst({
    where: eq(userConfigs.userId, session.user.id),
  })

  if (existingUserConfig) {
    await db
      .update(userConfigs)
      .set({
        appSettings: settings,
        updatedAt: new Date(),
      })
      .where(eq(userConfigs.userId, session.user.id))
  } else {
    await db.insert(userConfigs).values({
      userId: session.user.id,
      firebaseConfig: {},
      appSettings: settings,
    })
  }

  return Response.json({ success: true })
}
