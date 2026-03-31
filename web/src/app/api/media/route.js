export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const target = searchParams.get('url')

  if (!target) {
    return new Response('Missing url parameter', { status: 400 })
  }

  let parsed
  try {
    parsed = new URL(target)
  } catch {
    return new Response('Invalid url', { status: 400 })
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return new Response('Unsupported protocol', { status: 400 })
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        // Helps with providers that reject empty/unknown UA.
        'User-Agent': 'ImgVault-Web/1.0',
      },
    })

    if (!upstream.ok) {
      return new Response(`Upstream error: ${upstream.status}`, { status: 502 })
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
    const contentLength = upstream.headers.get('content-length')

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        ...(contentLength ? { 'Content-Length': contentLength } : {}),
        'Cache-Control': 'public, max-age=300',
      },
    })
  } catch (error) {
    return new Response(`Proxy failed: ${error?.message || 'unknown error'}`, { status: 502 })
  }
}
