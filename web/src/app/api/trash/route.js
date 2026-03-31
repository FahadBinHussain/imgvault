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

async function fetchAllFirestoreDocs(baseUrl, apiKey, baseParams, maskFields) {
  const allDocs = []
  let pageToken = null

  do {
    const url = new URL(baseUrl)
    url.searchParams.set('key', apiKey)

    for (const [key, value] of Object.entries(baseParams)) {
      url.searchParams.set(key, value)
    }

    for (const field of maskFields) {
      url.searchParams.append('mask.fieldPaths', field)
    }

    if (pageToken) {
      url.searchParams.set('pageToken', pageToken)
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to fetch trash from Firestore: ${errorText}`)
    }

    const result = await response.json()
    if (Array.isArray(result.documents) && result.documents.length > 0) {
      allDocs.push(...result.documents)
    }
    pageToken = result.nextPageToken || null
  } while (pageToken)

  return allDocs
}

export async function GET() {
  const session = await getSession()

  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!db) {
    return Response.json({ items: [] })
  }

  const config = await db.query.userConfigs.findFirst({
    where: eq(userConfigs.userId, session.user.id),
  })

  const firebaseConfig = config?.firebaseConfig
  if (!firebaseConfig?.projectId || !firebaseConfig?.apiKey) {
    return Response.json({ items: [] })
  }

  const baseUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/trash`
  const baseParams = {
    orderBy: 'deletedAt desc',
  }

  const maskFields = [
    'isVideo',
    'fileType',
    'pixvidUrl',
    'imgbbUrl',
    'imgbbThumbUrl',
    'filemoonUrl',
    'filemoonThumbUrl',
    'udropUrl',
    'sourceImageUrl',
    'sourcePageUrl',
    'pageTitle',
    'description',
    'tags',
    'deletedAt',
    'internalAddedTimestamp',
    'originalId',
  ]

  try {
    const documents = await fetchAllFirestoreDocs(
      baseUrl,
      firebaseConfig.apiKey,
      baseParams,
      maskFields
    )
    const items = documents.map(fromFirestoreDoc)
    return Response.json({ items })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to fetch trash' },
      { status: 500 }
    )
  }
}
