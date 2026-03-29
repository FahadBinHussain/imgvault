import { db } from '@/db'
import { userConfigs } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { auth } from '@/app/api/auth/[...nextauth]/route'

async function getSession() {
  return auth()
}

function fromFirestoreDoc(doc) {
  const id = doc.name?.split('/').pop() || ''
  const fields = doc.fields || {}
  const result = { id }

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

  if (!Array.isArray(result.tags)) result.tags = []
  return result
}

export async function GET() {
  const session = await getSession()

  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!db) {
    return Response.json({ images: [] })
  }

  const config = await db.query.userConfigs.findFirst({
    where: eq(userConfigs.userId, session.user.id),
  })

  const firebaseConfig = config?.firebaseConfig
  if (!firebaseConfig?.projectId || !firebaseConfig?.apiKey) {
    return Response.json({ images: [] })
  }

  const baseUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/images`
  const url = new URL(baseUrl)
  url.searchParams.set('key', firebaseConfig.apiKey)
  url.searchParams.set('orderBy', 'internalAddedTimestamp desc')
  const maskFields = [
    'BlueMatrixColumn',
    'BlueTRC',
    'ColorSpaceData',
    'DeviceManufacturer',
    'DeviceModel',
    'GreenMatrixColumn',
    'GreenTRC',
    'JFIFVersion',
    'MediaWhitePoint',
    'PrimaryPlatform',
    'ProfileCMMType',
    'ProfileClass',
    'ProfileConnectionSpace',
    'ProfileCopyright',
    'ProfileCreator',
    'ProfileDateTime',
    'ProfileDescription',
    'ProfileFileSignature',
    'ProfileVersion',
    'RedMatrixColumn',
    'RedTRC',
    'RenderingIntent',
    'ResolutionUnit',
    'ThumbnailHeight',
    'ThumbnailWidth',
    'XResolution',
    'YResolution',
    'aHash',
    'creationDate',
    'creationDateSource',
    'dHash',
    'description',
    'fileName',
    'fileSize',
    'fileType',
    'height',
    'imgbbDeleteUrl',
    'imgbbThumbUrl',
    'imgbbUrl',
    'internalAddedTimestamp',
    'pHash',
    'pageTitle',
    'pixvidDeleteUrl',
    'pixvidUrl',
    'sha256',
    'sourceImageUrl',
    'sourcePageUrl',
    'tags',
    'width',
  ]
  for (const field of maskFields) {
    url.searchParams.append('mask.fieldPaths', field)
  }

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
    })

    if (!response.ok) {
      const errorText = await response.text()
      return Response.json(
        { error: `Failed to fetch images from Firestore: ${errorText}` },
        { status: response.status }
      )
    }

    const result = await response.json()
    const images = result.documents ? result.documents.map(fromFirestoreDoc) : []

    return Response.json({ images })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to fetch images' },
      { status: 500 }
    )
  }
}

function toFirestoreValue(value) {
  if (value === null) {
    return { nullValue: null }
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => ({ stringValue: String(item) })),
      },
    }
  }

  return { stringValue: String(value) }
}

export async function PATCH(request) {
  const session = await getSession()

  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!db) {
    return Response.json({ error: 'Database unavailable' }, { status: 503 })
  }

  const config = await db.query.userConfigs.findFirst({
    where: eq(userConfigs.userId, session.user.id),
  })

  const firebaseConfig = config?.firebaseConfig
  if (!firebaseConfig?.projectId || !firebaseConfig?.apiKey) {
    return Response.json({ error: 'Firebase config missing' }, { status: 400 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  const imageId = typeof body?.id === 'string' ? body.id.trim() : ''
  const updates = body?.updates && typeof body.updates === 'object' ? body.updates : null

  if (!imageId || !updates) {
    return Response.json({ error: 'Image id and updates are required' }, { status: 400 })
  }

  const editableFields = new Set([
    'pageTitle',
    'creationDate',
    'pixvidUrl',
    'imgbbUrl',
    'sourceImageUrl',
    'sourcePageUrl',
    'description',
    'tags',
  ])

  const sanitizedUpdates = {}

  for (const [key, value] of Object.entries(updates)) {
    if (!editableFields.has(key)) continue

    if (key === 'tags') {
      if (!Array.isArray(value)) {
        return Response.json({ error: 'tags must be an array of strings' }, { status: 400 })
      }

      sanitizedUpdates.tags = value
        .map((item) => String(item).trim())
        .filter(Boolean)
      continue
    }

    if (value === null) {
      sanitizedUpdates[key] = null
      continue
    }

    if (typeof value !== 'string') {
      return Response.json({ error: `${key} must be a string or null` }, { status: 400 })
    }

    const trimmed = value.trim()
    sanitizedUpdates[key] = trimmed || null
  }

  const fieldsToUpdate = Object.keys(sanitizedUpdates)
  if (fieldsToUpdate.length === 0) {
    return Response.json({ error: 'No editable fields provided to update' }, { status: 400 })
  }

  const docUrl = new URL(
    `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/images/${encodeURIComponent(imageId)}`
  )
  docUrl.searchParams.set('key', firebaseConfig.apiKey)
  docUrl.searchParams.set('currentDocument.exists', 'true')

  for (const field of fieldsToUpdate) {
    docUrl.searchParams.append('updateMask.fieldPaths', field)
  }

  const payload = {
    fields: Object.fromEntries(
      fieldsToUpdate.map((field) => [field, toFirestoreValue(sanitizedUpdates[field])])
    ),
  }

  try {
    const response = await fetch(docUrl.toString(), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })

    if (!response.ok) {
      const errorText = await response.text()
      return Response.json(
        { error: `Failed to update image metadata: ${errorText}` },
        { status: response.status }
      )
    }

    const updatedDoc = await response.json()
    return Response.json({ image: fromFirestoreDoc(updatedDoc) })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to update image metadata' },
      { status: 500 }
    )
  }
}
