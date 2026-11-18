// The three API routes that run without a database, auth, or Next.js
// server: they import nothing (media, releases) or only node builtins
// (brand/icon), take a plain `{ url }` request, and answer with a standard
// Response. Network is mocked; the brand icon reads disk only through its
// own candidate paths (web/public/brand does not exist in this repo, so the
// embedded fallback is exercised).
import test from 'node:test'
import assert from 'node:assert/strict'

import { GET as mediaGET } from '../src/app/api/media/route.js'
import { GET as releasesGET } from '../src/app/api/releases/latest-assets/route.js'
import { GET as brandIconGET } from '../src/app/api/brand/icon/route.js'

const realFetch = globalThis.fetch
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

function mockFetch(handler) {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    return handler(String(url), options)
  }
  return calls
}

// --- /api/media: same-origin proxy for downloads ---------------------------

test('media proxy: missing url parameter is a 400', async () => {
  const res = await mediaGET({ url: 'http://localhost/api/media' })
  assert.equal(res.status, 400)
  assert.equal(await res.text(), 'Missing url parameter')
})

test('media proxy: an unparseable url is a 400', async () => {
  const res = await mediaGET({ url: 'http://localhost/api/media?url=::::' })
  assert.equal(res.status, 400)
  assert.equal(await res.text(), 'Invalid url')
})

test('media proxy: a non-http(s) protocol is a 400', async () => {
  const res = await mediaGET({ url: 'http://localhost/api/media?url=ftp%3A%2F%2Fexample.com%2Ff' })
  assert.equal(res.status, 400)
  assert.equal(await res.text(), 'Unsupported protocol')
})

test('media proxy: an upstream error is a 502', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () => new Response('gone', { status: 404 }))
  const res = await mediaGET({ url: 'http://localhost/api/media?url=https%3A%2F%2Fexample.com%2Ff.png' })
  assert.equal(res.status, 502)
  assert.equal(await res.text(), 'Upstream error: 404')
})

test('media proxy: a fetch failure is a 502 with the cause', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () => {
    throw new Error('socket hangup')
  })
  const res = await mediaGET({ url: 'http://localhost/api/media?url=https%3A%2F%2Fexample.com%2Ff.png' })
  assert.equal(res.status, 502)
  assert.equal(await res.text(), 'Proxy failed: socket hangup')
})

test('media proxy: success streams the bytes with type + length + cache headers', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const calls = mockFetch(async () =>
    new Response('IMAGE-BYTES', {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': '11' },
    })
  )
  const res = await mediaGET({
    url: 'http://localhost/api/media?url=https%3A%2F%2Fpixvid.example%2Fphoto.jpg',
  })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/jpeg')
  assert.equal(res.headers.get('content-length'), '11')
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300')
  assert.equal(await res.text(), 'IMAGE-BYTES')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://pixvid.example/photo.jpg')
  assert.equal(calls[0].options.headers['User-Agent'], 'ImgVault-Web/1.0')
  assert.equal(calls[0].options.cache, 'no-store')
  assert.equal(calls[0].options.redirect, 'follow')
})

test('media proxy: a missing upstream content-type defaults to octet-stream', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  // A typeless Blob body carries no content-type header (a string body
  // would auto-gain text/plain from undici).
  mockFetch(async () => new Response(new Blob(['DATA']), { status: 200 }))
  const res = await mediaGET({ url: 'http://localhost/api/media?url=https%3A%2F%2Fexample.com%2Ff' })
  assert.equal(res.headers.get('content-type'), 'application/octet-stream')
})

// --- /api/releases/latest-assets: GitHub latest release picker -------------

const releaseFixture = {
  name: 'ImgVault 2.19.22',
  tag_name: 'v2.19.22',
  html_url: 'https://github.com/FahadBinHussain/imgvault/releases/tag/v2.19.22',
  assets: [
    { name: 'imgvault-2.19.22.zip', browser_download_url: 'https://dl.example/zip' },
    { name: 'imgvault-2.19.22.crx', browser_download_url: 'https://dl.example/crx' },
    { name: 'ImgVault-Native-Host-Setup.exe', browser_download_url: 'https://dl.example/native' },
    { name: 'other.exe', browser_download_url: 'https://dl.example/other-exe' },
  ],
}

test('releases: returns the zip, crx, and native exe of the latest release', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const calls = mockFetch(async () =>
    new Response(JSON.stringify(releaseFixture), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  )
  const res = await releasesGET()
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.releaseName, 'ImgVault 2.19.22')
  assert.equal(data.releaseTag, 'v2.19.22')
  assert.equal(data.releaseUrl, releaseFixture.html_url)
  assert.deepEqual(data.assets, {
    zip: 'https://dl.example/zip',
    crx: 'https://dl.example/crx',
    nativeHost: 'https://dl.example/native',
  })
  assert.equal(calls.length, 1)
  assert.equal(
    calls[0].url,
    'https://api.github.com/repos/FahadBinHussain/imgvault/releases/latest'
  )
  assert.equal(calls[0].options.headers['User-Agent'], 'imgvault-web')
})

test('releases: a plain .exe is the native-host fallback when no native .exe exists', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const fixture = {
    ...releaseFixture,
    assets: releaseFixture.assets.filter((a) => !a.name.includes('Native')),
  }
  mockFetch(async () =>
    new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  )
  const data = await (await releasesGET()).json()
  assert.equal(data.assets.nativeHost, 'https://dl.example/other-exe')
})

test('releases: a missing required asset is a 500 naming zip/crx/exe', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const fixture = { ...releaseFixture, assets: releaseFixture.assets.slice(0, 2) }
  mockFetch(async () =>
    new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  )
  const res = await releasesGET()
  assert.equal(res.status, 500)
  assert.match((await res.json()).error, /missing one or more required assets \(zip\/crx\/exe\)/)
})

test('releases: a GitHub error passes its status through', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () => new Response('rate limited', { status: 403 }))
  const res = await releasesGET()
  assert.equal(res.status, 403)
  assert.match((await res.json()).error, /Failed to fetch latest release \(403\)/)
})

test('releases: a network failure is a 500 with the cause', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () => {
    throw new Error('dns blew up')
  })
  const res = await releasesGET()
  assert.equal(res.status, 500)
  assert.equal((await res.json()).error, 'dns blew up')
})

// --- /api/brand/icon: sized brand icon with an embedded fallback -----------

test('brand icon: size=48 answers a PNG with immutable cache headers', async () => {
  const res = await brandIconGET({ url: 'http://localhost/api/brand/icon?size=48' })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/png')
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  const bytes = Buffer.from(await res.arrayBuffer())
  assert.deepEqual(bytes.subarray(0, 4), PNG_MAGIC)
  assert.ok(bytes.length > 100)
})

test('brand icon: no size defaults to 128', async () => {
  const res = await brandIconGET({ url: 'http://localhost/api/brand/icon' })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/png')
  const bytes = Buffer.from(await res.arrayBuffer())
  assert.deepEqual(bytes.subarray(0, 4), PNG_MAGIC)
})

test('brand icon: an unknown size falls back to 128 instead of 404ing', async () => {
  const res = await brandIconGET({ url: 'http://localhost/api/brand/icon?size=999' })
  assert.equal(res.status, 200)
  const bytes = Buffer.from(await res.arrayBuffer())
  assert.deepEqual(bytes.subarray(0, 4), PNG_MAGIC)
  const res128 = await brandIconGET({ url: 'http://localhost/api/brand/icon?size=128' })
  const bytes128 = Buffer.from(await res128.arrayBuffer())
  assert.deepEqual(bytes, bytes128)
})

test('brand icon: size=16 answers a PNG', async () => {
  const res = await brandIconGET({ url: 'http://localhost/api/brand/icon?size=16' })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/png')
  const bytes = Buffer.from(await res.arrayBuffer())
  assert.deepEqual(bytes.subarray(0, 4), PNG_MAGIC)
})
