import { db } from '@/db'
import { settings as settingsTable, userConfigs } from '@/db/schema'
import { eq } from 'drizzle-orm'
import {
  buildTableSettingsPayload,
  SETTINGS_DEFAULTS,
} from 'imgvault-shared'

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

  const appSettings =
    userConfig?.appSettings && typeof userConfig.appSettings === 'object'
      ? userConfig.appSettings
      : {}

  const { id: _rowId, updatedAt: _rowUpdatedAt, ...globalTableSettings } =
    globalSettings || {}

  return Response.json({
    config: userConfig?.firebaseConfig || { provider: 'neon' },
    settings: {
      ...SETTINGS_DEFAULTS,
      ...appSettings,
      // public.settings columns win over the app_settings JSON for
      // table-backed keys (the extension upserts those columns)
      ...globalTableSettings,
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

  // every table-backed field from the shared schema, always written -
  // a missing key falls to the schema default, never silently skipped
  const globalSettingsPayload = {
    id: 'config',
    ...buildTableSettingsPayload(settings),
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

  const firebaseConfig =
    body?.firebaseConfig && typeof body.firebaseConfig === 'object' && !Array.isArray(body.firebaseConfig)
      ? body.firebaseConfig
      : {}

  const existingUserConfig = await db.query.userConfigs.findFirst({
    where: eq(userConfigs.userId, session.user.id),
  })

  if (existingUserConfig) {
    await db
      .update(userConfigs)
      .set({
        appSettings: settings,
        firebaseConfig,
        updatedAt: new Date(),
      })
      .where(eq(userConfigs.userId, session.user.id))
  } else {
    await db.insert(userConfigs).values({
      userId: session.user.id,
      firebaseConfig,
      appSettings: settings,
    })
  }

  return Response.json({ success: true })
}
