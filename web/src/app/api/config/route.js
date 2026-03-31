import { db } from '@/db'
import { userConfigs } from '@/db/schema'
import { eq } from 'drizzle-orm'

async function getSession() {
  const { auth } = await import('@/app/api/auth/[...nextauth]/route')
  return auth()
}

function fromFirestoreDoc(doc) {
  const fields = doc?.fields || {}
  const result = {}

  for (const [key, value] of Object.entries(fields)) {
    if (value.stringValue !== undefined) {
      result[key] = value.stringValue
    } else if (value.integerValue !== undefined) {
      result[key] = Number.parseInt(value.integerValue, 10)
    } else if (value.doubleValue !== undefined) {
      result[key] = Number.parseFloat(value.doubleValue)
    } else if (value.booleanValue !== undefined) {
      result[key] = value.booleanValue
    } else if (value.timestampValue !== undefined) {
      result[key] = value.timestampValue
    } else if (value.arrayValue !== undefined) {
      result[key] = value.arrayValue.values?.map((v) => v.stringValue ?? '') || []
    } else if (value.nullValue !== undefined) {
      result[key] = null
    }
  }

  return result
}

function toFirestoreValue(value) {
  if (value === null) return { nullValue: null }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => ({ stringValue: String(item) })),
      },
    }
  }

  return { stringValue: String(value) }
}

async function fetchFirebaseSettings(firebaseConfig) {
  if (!firebaseConfig?.projectId || !firebaseConfig?.apiKey) {
    return null
  }

  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/userSettings/config`
  )
  url.searchParams.set('key', firebaseConfig.apiKey)

  const response = await fetch(url.toString(), {
    cache: 'no-store',
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to load Firebase settings: ${errorText}`)
  }

  const doc = await response.json()
  return fromFirestoreDoc(doc)
}

async function saveFirebaseSettings(firebaseConfig, settings) {
  if (!firebaseConfig?.projectId || !firebaseConfig?.apiKey) {
    return
  }

  const settingsToSave = Object.fromEntries(
    Object.entries(settings || {}).filter(([, value]) => value !== undefined && value !== '')
  )

  if (Object.keys(settingsToSave).length === 0) {
    return
  }

  const docUrl = new URL(
    `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/userSettings/config`
  )
  docUrl.searchParams.set('key', firebaseConfig.apiKey)

  const payload = {
    fields: Object.fromEntries(
      Object.entries({
        ...settingsToSave,
        updatedAt: new Date().toISOString(),
      }).map(([key, value]) => [key, toFirestoreValue(value)])
    ),
  }

  const existingResponse = await fetch(docUrl.toString(), { cache: 'no-store' })

  if (existingResponse.ok) {
    for (const field of Object.keys(payload.fields)) {
      docUrl.searchParams.append('updateMask.fieldPaths', field)
    }

    const patchResponse = await fetch(docUrl.toString(), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })

    if (!patchResponse.ok) {
      const errorText = await patchResponse.text()
      throw new Error(`Failed to save Firebase settings: ${errorText}`)
    }

    return
  }

  if (existingResponse.status !== 404) {
    const errorText = await existingResponse.text()
    throw new Error(`Failed to check Firebase settings: ${errorText}`)
  }

  const createUrl = new URL(
    `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/userSettings`
  )
  createUrl.searchParams.set('key', firebaseConfig.apiKey)
  createUrl.searchParams.set('documentId', 'config')

  const createResponse = await fetch(createUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  })

  if (!createResponse.ok) {
    const errorText = await createResponse.text()
    throw new Error(`Failed to create Firebase settings: ${errorText}`)
  }
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

  let settings = config?.appSettings || null

  try {
    const firebaseSettings = await fetchFirebaseSettings(config?.firebaseConfig)
    if (firebaseSettings) {
      settings = {
        ...(settings || {}),
        ...firebaseSettings,
      }
    }
  } catch (error) {
    console.error('Failed to sync settings from Firebase:', error)
  }

  return Response.json({
    config: config?.firebaseConfig || null,
    settings,
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
  const { firebaseConfig, settings } = body

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
      .set({
        firebaseConfig,
        appSettings: settings || null,
        updatedAt: new Date(),
      })
      .where(eq(userConfigs.userId, session.user.id))
  } else {
    await db.insert(userConfigs).values({
      userId: session.user.id,
      firebaseConfig,
      appSettings: settings || null,
    })
  }

  try {
    await saveFirebaseSettings(firebaseConfig, settings || null)
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Saved locally, but Firebase sync failed' },
      { status: 500 }
    )
  }

  return Response.json({ success: true })
}
