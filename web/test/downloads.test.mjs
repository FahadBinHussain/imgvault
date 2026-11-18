// Download helpers: everything goes through the same-origin /api/media proxy.
// Network is mocked; the DOM bits (saveBlobAsFile) run against a minimal
// fake document.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  downloadFieldViaProxy,
  downloadItemViaProxy,
  fetchFileViaProxy,
  saveBlobAsFile,
} from '../src/lib/downloads.js'

const realFetch = globalThis.fetch
const realSetTimeout = globalThis.setTimeout

function mockFetch(handler) {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    return handler(String(url), options)
  }
  return calls
}

function fakeDocument() {
  const anchor = {
    href: '',
    download: '',
    clicked: false,
    removed: false,
    click() {
      this.clicked = true
    },
    remove() {
      this.removed = true
    },
  }
  const doc = {
    anchor,
    appended: [],
    createElement(tag) {
      assert.equal(tag, 'a')
      return anchor
    },
    body: {
      appendChild(el) {
        doc.appended.push(el)
      },
    },
  }
  return doc
}

test('fetchFileViaProxy fetches through /api/media and returns blob + contentType', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const calls = mockFetch(async () =>
    new Response(new Blob(['file-bytes'], { type: 'image/png' }), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })
  )
  const { blob, contentType } = await fetchFileViaProxy('https://pixvid.example/f.png?x=1&y=2')
  assert.equal(contentType, 'image/png')
  assert.equal(await blob.text(), 'file-bytes')
  assert.equal(calls.length, 1)
  assert.equal(
    calls[0].url,
    '/api/media?url=https%3A%2F%2Fpixvid.example%2Ff.png%3Fx%3D1%26y%3D2'
  )
})

test('fetchFileViaProxy throws with status + detail on a proxy error', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () => new Response('upstream gone', { status: 502 }))
  await assert.rejects(
    fetchFileViaProxy('https://example.com/f.png'),
    /media proxy responded 502 \(upstream gone\)/
  )
})

test('fetchFileViaProxy truncates a long error detail to 200 chars', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () => new Response('x'.repeat(500), { status: 500 }))
  await assert.rejects(fetchFileViaProxy('https://example.com/f.png'), (err) => {
    assert.match(err.message, /media proxy responded 500 \(x{200}\)/)
    assert.equal(err.message.length, 'media proxy responded 500 ('.length + 200 + 1)
    return true
  })
})

test('fetchFileViaProxy throws when the URL served an HTML page', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () =>
    new Response('<html>watch page</html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  )
  await assert.rejects(
    fetchFileViaProxy('https://example.com/watch'),
    /served an HTML download page, not file bytes/
  )
})

test('fetchFileViaProxy throws on an empty response', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () =>
    new Response(new Blob([], { type: 'image/png' }), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })
  )
  await assert.rejects(fetchFileViaProxy('https://example.com/f.png'), /empty response/)
})

test('saveBlobAsFile clicks a download anchor and schedules revocation', () => {
  const doc = fakeDocument()
  const realDocument = globalThis.document
  const realCreateObjectURL = URL.createObjectURL
  const realRevokeObjectURL = URL.revokeObjectURL
  const revoked = []
  let scheduled = null
  globalThis.document = doc
  URL.createObjectURL = () => 'blob:fake-url'
  URL.revokeObjectURL = (url) => revoked.push(url)
  globalThis.setTimeout = (fn, ms) => {
    scheduled = { fn, ms }
    return 0
  }
  try {
    saveBlobAsFile(new Blob(['x']), 'my-file.png')
    assert.equal(doc.anchor.href, 'blob:fake-url')
    assert.equal(doc.anchor.download, 'my-file.png')
    assert.equal(doc.appended[0], doc.anchor)
    assert.equal(doc.anchor.clicked, true)
    assert.equal(doc.anchor.removed, true)
    assert.equal(scheduled.ms, 60000)
    scheduled.fn()
    assert.deepEqual(revoked, ['blob:fake-url'])
  } finally {
    globalThis.document = realDocument
    URL.createObjectURL = realCreateObjectURL
    URL.revokeObjectURL = realRevokeObjectURL
    globalThis.setTimeout = realSetTimeout
  }
})

test('downloadItemViaProxy resolves the strict source, fetches, saves, returns the name', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const doc = fakeDocument()
  const realDocument = globalThis.document
  const realCreateObjectURL = URL.createObjectURL
  globalThis.document = doc
  URL.createObjectURL = () => 'blob:fake-url'
  globalThis.setTimeout = () => 0
  t.after(() => {
    globalThis.document = realDocument
    URL.createObjectURL = realCreateObjectURL
    globalThis.setTimeout = realSetTimeout
  })

  const calls = mockFetch(async () =>
    new Response(new Blob(['png-bytes'], { type: 'image/png' }), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })
  )
  const item = {
    id: 'img-1',
    kind: 'image',
    fileName: 'photo.png',
    imageHosts: { pixvid: { url: 'https://pixvid.example/photo.png' } },
  }
  const fileName = await downloadItemViaProxy(item, { imageSource: 'pixvid' })
  assert.equal(typeof fileName, 'string')
  assert.ok(fileName.length > 0)
  assert.equal(doc.anchor.clicked, true)
  assert.equal(doc.anchor.download, fileName)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/media?url=https%3A%2F%2Fpixvid.example%2Fphoto.png')
})

test('downloadFieldViaProxy fetches exactly the URL the field shows', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const doc = fakeDocument()
  const realDocument = globalThis.document
  const realCreateObjectURL = URL.createObjectURL
  globalThis.document = doc
  URL.createObjectURL = () => 'blob:fake-url'
  globalThis.setTimeout = () => 0
  t.after(() => {
    globalThis.document = realDocument
    URL.createObjectURL = realCreateObjectURL
    globalThis.setTimeout = realSetTimeout
  })

  const calls = mockFetch(async () =>
    new Response(new Blob(['mp4-bytes'], { type: 'video/mp4' }), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    })
  )
  const item = { id: 'vid-1', kind: 'video', fileName: 'clip.mp4' }
  const fileName = await downloadFieldViaProxy(item, 'https://terabox.example/direct/clip.mp4')
  assert.equal(typeof fileName, 'string')
  assert.ok(fileName.length > 0)
  assert.equal(doc.anchor.clicked, true)
  assert.equal(
    calls[0].url,
    '/api/media?url=https%3A%2F%2Fterabox.example%2Fdirect%2Fclip.mp4'
  )
})
