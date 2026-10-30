import { db } from '@/db'
import { mediaItems, mediaItemPreviews } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { auth } from '@/app/api/auth/[...nextauth]/route'
import { isSystemMediaItem, isVaultedMediaItem } from '@/lib/vault-media'

// Encrypted preview thumbnails (video frame JPEGs) derived by the extension.
// Ciphertext only — the master key never reaches the server.
export async function GET(request) {
  const session = await auth()

  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!db) {
    return Response.json({ error: 'Database unavailable' }, { status: 503 })
  }

  const id = new URL(request.url).searchParams.get('id')?.trim() || ''
  if (!id) {
    return Response.json({ error: 'Vault item id is required' }, { status: 400 })
  }

  try {
    const [row] = await db.select().from(mediaItems).where(eq(mediaItems.id, id)).limit(1)

    if (!row || row.deletedAt) {
      return Response.json({ error: 'Item not found' }, { status: 404 })
    }

    if (isSystemMediaItem(row) || !isVaultedMediaItem(row)) {
      return Response.json({ error: 'Item is not in the Secret Vault' }, { status: 400 })
    }

    const [preview] = await db
      .select()
      .from(mediaItemPreviews)
      .where(eq(mediaItemPreviews.itemId, id))
      .limit(1)

    if (!preview?.previewEncrypted) {
      return Response.json(
        { error: 'No encrypted preview stored for this item yet — open it once in the extension to derive one' },
        { status: 404 }
      )
    }

    return Response.json({ previewEncrypted: preview.previewEncrypted })
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to load the encrypted vault preview' },
      { status: 500 }
    )
  }
}
