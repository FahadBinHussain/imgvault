import { readFile } from 'fs/promises'
import path from 'path'

const ICON_BY_SIZE = {
  16: 'icon16.png',
  48: 'icon48.png',
  128: 'icon128.png',
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const requestedSize = Number(searchParams.get('size'))
  const size = ICON_BY_SIZE[requestedSize] ? requestedSize : 128

  const iconPath = path.join(
    process.cwd(),
    '..',
    'nextgen-extension',
    'icons',
    ICON_BY_SIZE[size],
  )

  try {
    const iconBuffer = await readFile(iconPath)

    return new Response(iconBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return new Response('Icon not found', { status: 404 })
  }
}
