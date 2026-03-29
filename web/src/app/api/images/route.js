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
    'pixvidUrl',
    'imgbbUrl',
    'imgbbThumbUrl',
    'filemoonUrl',
    'udropUrl',
    'sourceImageUrl',
    'sourcePageUrl',
    'pageTitle',
    'tags',
    'description',
    'internalAddedTimestamp',
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
