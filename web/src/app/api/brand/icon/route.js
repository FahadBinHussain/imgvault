import { readFile } from 'fs/promises'
import path from 'path'

const ICON_BY_SIZE = {
  16: '1-16.png',
  48: '1-48.png',
  128: '1-128.png',
}

const ICON_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=31536000, immutable',
}

const EMBEDDED_ICON_PNG_BASE64 =
  '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'

function getIconCandidates(iconFile) {
  const cwd = process.cwd()

  return [
    path.join(cwd, 'public', 'brand', iconFile),
    path.join(cwd, 'nextgen-extension', 'icons', iconFile),
    path.join(cwd, '..', 'nextgen-extension', 'icons', iconFile),
  ]
}

function renderFallbackIcon(size) {
  return Buffer.from(EMBEDDED_ICON_PNG_BASE64, 'base64')
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const requestedSize = Number(searchParams.get('size'))
  const size = ICON_BY_SIZE[requestedSize] ? requestedSize : 128
  const iconFile = ICON_BY_SIZE[size]

  for (const iconPath of getIconCandidates(iconFile)) {
    try {
      const iconBuffer = await readFile(iconPath)

      return new Response(iconBuffer, {
        headers: {
          ...ICON_CACHE_HEADERS,
          'Content-Type': 'image/png',
        },
      })
    } catch {
      // Try the next canonical asset location before falling back to SVG.
    }
  }

  return new Response(renderFallbackIcon(size), {
    headers: {
      ...ICON_CACHE_HEADERS,
      'Content-Type': 'image/png',
    },
  })
}
