import { db } from '@/db'
import { mediaItems } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { auth } from '@/app/api/auth/[...nextauth]/route'
import {
  VAULT_CONFIG_ITEM_ID,
  VAULT_CONFIG_SYSTEM_TYPE,
  getExtraMetadata,
} from '@/lib/vault-media'

function normalizeVaultConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null

  const salt = typeof config.salt === 'string' ? config.salt : ''
  const passHash = typeof config.passHash === 'string' ? config.passHash : ''

  if (!salt || !passHash) return null

  return {
    ...config,
    salt,
    passHash,
    mode: typeof config.mode === 'string' ? config.mode : 'hidden',
    createdAt: typeof config.createdAt === 'string' ? config.createdAt : new Date().toISOString(),
  }
}

export async function GET() {
  const session = await auth()

  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!db) {
    return Response.json({ config: null })
  }

  try {
    const [row] = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.id, VAULT_CONFIG_ITEM_ID))
      .limit(1)
    const extra = getExtraMetadata(row)

    return Response.json({ config: normalizeVaultConfig(extra.secretVaultConfig) })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to load vault config' },
      { status: 500 }
    )
  }
}

export async function POST(request) {
  const session = await auth()

  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!db) {
    return Response.json({ error: 'Database unavailable' }, { status: 503 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  const config = normalizeVaultConfig(body?.config)
  if (!config) {
    return Response.json({ error: 'Valid vault config is required' }, { status: 400 })
  }

  const now = new Date()
  const extraMetadata = {
    systemType: VAULT_CONFIG_SYSTEM_TYPE,
    secretVaultConfig: config,
  }

  try {
    await db
      .insert(mediaItems)
      .values({
        id: VAULT_CONFIG_ITEM_ID,
        kind: 'image',
        isVideo: false,
        isLink: false,
        pageTitle: 'ImgVault Secret Vault Config',
        description: 'Internal ImgVault vault configuration',
        tags: [],
        extraMetadata,
        internalAddedTimestamp: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: mediaItems.id,
        set: {
          extraMetadata,
          updatedAt: now,
        },
      })

    return Response.json({ config })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to save vault config' },
      { status: 500 }
    )
  }
}
