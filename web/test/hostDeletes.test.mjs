// Server-side host file cleanup for web trash actions. The lib uses
// Next.js `@/` aliases, which plain node cannot resolve — the resolve hook
// below teaches node the same resolution (no package.json / config change).
// The lib is imported dynamically AFTER the hook is registered. All network
// is mocked; tokens/keys/cookies are fake. console output is silenced per
// test (the module logs loudly by design).
import { register } from 'node:module'
import { fileURLToPath } from 'node:url'

const WEB_DIR = fileURLToPath(new URL('..', import.meta.url))
const SHARED_DIR = fileURLToPath(new URL('../../packages/shared', import.meta.url))

register(
  'data:text/javascript,' +
    encodeURIComponent(`
import { pathToFileURL, fileURLToPath } from 'node:url'
import fs from 'node:fs'
const WEB = ${JSON.stringify(WEB_DIR)}
const SHARED = ${JSON.stringify(SHARED_DIR)}
function hit(p) {
  if (fs.existsSync(p)) return { url: pathToFileURL(p).href, shortCircuit: true }
  if (fs.existsSync(p + '.js')) return { url: pathToFileURL(p + '.js').href, shortCircuit: true }
  return null
}
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const found = hit(WEB + '/src/' + specifier.slice(2))
    if (found) return found
  }
  if (specifier.startsWith('@shared/')) {
    const found = hit(SHARED + '/' + specifier.slice(8))
    if (found) return found
  }
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
      const found = hit(fileURLToPath(new URL(specifier, context.parentURL)))
      if (found) return found
    }
    throw err
  }
}
`)
)

import test from 'node:test'
import assert from 'node:assert/strict'

const {
  authorizeUdrop,
  deleteImgbbByDeleteUrl,
  deletePixvidByDeleteUrl,
  deleteTelegramPostsForItem,
  deleteTeraBoxFiles,
  deleteUdropFile,
  deleteVaultBlobCopies,
  listAllTeraBoxFiles,
  teraBoxFsIdFromUrl,
} = await import('../src/lib/hostDeletes.js')

const realFetch = globalThis.fetch
const realWarn = console.warn
const realLog = console.log
const FAKE_TOKEN = 'FAKE_TELEGRAM_BOT_TOKEN_12345'

function mockFetch(handler) {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    return handler(String(url), options)
  }
  return calls
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function silenceConsole(t) {
  console.warn = () => {}
  console.log = () => {}
  t.after(() => {
    console.warn = realWarn
    console.log = realLog
  })
}

function restoreFetch(t) {
  t.after(() => {
    globalThis.fetch = realFetch
  })
}

// --- teraBoxFsIdFromUrl ----------------------------------------------------

test('teraBoxFsIdFromUrl extracts the trailing numeric segment of ?fid=', () => {
  assert.equal(teraBoxFsIdFromUrl('https://dm.terabox.com/api/download?fid=abc-250528-123456'), '123456')
  assert.equal(
    teraBoxFsIdFromUrl('https://dm.terabox.com/x?fid=abc%2D250528%2D987654&other=1'),
    '987654'
  )
})

test('teraBoxFsIdFromUrl returns empty when no usable fs_id is present', () => {
  assert.equal(teraBoxFsIdFromUrl('https://dm.terabox.com/x?fid=abc-250528-notanumber'), '')
  assert.equal(teraBoxFsIdFromUrl('https://dm.terabox.com/x?noid=1'), '')
  assert.equal(teraBoxFsIdFromUrl(''), '')
  assert.equal(teraBoxFsIdFromUrl(null), '')
  assert.equal(teraBoxFsIdFromUrl(undefined), '')
})

// --- ImgBB -----------------------------------------------------------------

test('deleteImgbbByDeleteUrl returns false without a URL', async () => {
  assert.equal(await deleteImgbbByDeleteUrl(''), false)
  assert.equal(await deleteImgbbByDeleteUrl(null), false)
})

test('deleteImgbbByDeleteUrl deletes through ibb.co/json and posts id + hash', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  const calls = mockFetch(async () => new Response('', { status: 200 }))
  const ok = await deleteImgbbByDeleteUrl('https://ibb.co/IMGID123/HASH456')
  assert.equal(ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://ibb.co/json')
  assert.equal(calls[0].options.method, 'POST')
  const form = calls[0].options.body
  assert.equal(form.get('pathname'), '/IMGID123/HASH456')
  assert.equal(form.get('action'), 'delete')
  assert.equal(form.get('deleting[id]'), 'IMGID123')
  assert.equal(form.get('deleting[hash]'), 'HASH456')
})

test('deleteImgbbByDeleteUrl falls to imgbb.com/json when ibb.co/json fails', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  const calls = mockFetch(async (url) => {
    if (url === 'https://ibb.co/json') return new Response('err', { status: 500 })
    return new Response('', { status: 200 })
  })
  const ok = await deleteImgbbByDeleteUrl('https://ibb.co/IMGID123/HASH456')
  assert.equal(ok, true)
  assert.deepEqual(
    calls.map((c) => c.url),
    ['https://ibb.co/json', 'https://imgbb.com/json']
  )
})

test('deleteImgbbByDeleteUrl treats a non-JSON body as the delete confirmation page', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  mockFetch(async () => new Response('<html>deleted</html>', { status: 200 }))
  assert.equal(await deleteImgbbByDeleteUrl('https://ibb.co/IMGID123/HASH456'), true)
})

test('deleteImgbbByDeleteUrl returns false when nothing confirms the delete', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  mockFetch(async (url) => {
    if (url.includes('/json')) return new Response('err', { status: 500 })
    return new Response('<html>delete page</html>', { status: 200 })
  })
  assert.equal(await deleteImgbbByDeleteUrl('https://ibb.co/IMGID123/HASH456'), false)
})

test('deleteImgbbByDeleteUrl returns false for an unparseable delete URL', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  mockFetch(async () => new Response('nope', { status: 404 }))
  assert.equal(await deleteImgbbByDeleteUrl('not-a-url'), false)
})

// --- Pixvid ----------------------------------------------------------------

test('deletePixvidByDeleteUrl is best-effort: true only on a confirmed load', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  assert.equal(await deletePixvidByDeleteUrl(''), false)
  mockFetch(async () => new Response('ok', { status: 200 }))
  assert.equal(await deletePixvidByDeleteUrl('https://pixvid.example/delete/abc'), true)
  mockFetch(async () => new Response('gone', { status: 404 }))
  assert.equal(await deletePixvidByDeleteUrl('https://pixvid.example/delete/abc'), false)
  mockFetch(async () => {
    throw new Error('network down')
  })
  assert.equal(await deletePixvidByDeleteUrl('https://pixvid.example/delete/abc'), false)
})

// --- UDrop -----------------------------------------------------------------

test('authorizeUdrop returns the auth data on success', async (t) => {
  restoreFetch(t)
  const calls = mockFetch(async () =>
    jsonResponse({ _status: 'success', data: { access_token: 'tok', account_id: 'acc' } })
  )
  const data = await authorizeUdrop('fake-k1', 'fake-k2')
  assert.deepEqual(data, { access_token: 'tok', account_id: 'acc' })
  assert.equal(calls[0].url, 'https://www.udrop.com/api/v2/authorize')
  assert.equal(calls[0].options.body.get('key1'), 'fake-k1')
  assert.equal(calls[0].options.body.get('key2'), 'fake-k2')
})

test('authorizeUdrop throws loudly on HTTP failure, rejection, or missing data', async (t) => {
  restoreFetch(t)
  mockFetch(async () => new Response('no', { status: 401 }))
  await assert.rejects(authorizeUdrop('k1', 'k2'), /Auth failed: 401/)
  mockFetch(async () => jsonResponse({ _status: 'error', response: 'bad keys' }))
  await assert.rejects(authorizeUdrop('k1', 'k2'), /Auth error: bad keys/)
  mockFetch(async () => jsonResponse({ _status: 'success' }))
  await assert.rejects(authorizeUdrop('k1', 'k2'), /no data returned/)
})

test('deleteUdropFile posts the delete and returns true', async (t) => {
  restoreFetch(t)
  const calls = mockFetch(async () => jsonResponse({ _status: 'success' }))
  assert.equal(await deleteUdropFile('tok', 'acc', 'file-1'), true)
  assert.equal(calls[0].url, 'https://www.udrop.com/api/v2/file/delete')
  assert.equal(calls[0].options.body.get('access_token'), 'tok')
  assert.equal(calls[0].options.body.get('account_id'), 'acc')
  assert.equal(calls[0].options.body.get('file_id'), 'file-1')
})

test('deleteUdropFile throws on HTTP failure or a rejected delete', async (t) => {
  restoreFetch(t)
  mockFetch(async () => new Response('no', { status: 500 }))
  await assert.rejects(deleteUdropFile('tok', 'acc', 'f1'), /Delete failed: 500/)
  mockFetch(async () => jsonResponse({ _status: 'error', response: 'file gone' }))
  await assert.rejects(deleteUdropFile('tok', 'acc', 'f1'), /file gone/)
})

// --- TeraBox ---------------------------------------------------------------

const JSTOKEN_HTML = '<html><script>fn("jsTokenABC123456")</script></html>'
const MAIN_HTML =
  '<html><script>fn("pageJsToken987654")</script>' +
  '<script>window.config = {"bdstoken": "FAKE_BDSTOKEN"};</script>' +
  '<a href="/x?dp-logid=FAKELOGID123">x</a></html>'

function teraboxRouter({ listPages = {}, filemanager = () => jsonResponse({ errno: 0 }) } = {}) {
  return async (url) => {
    if (url === 'https://www.terabox.com/') return new Response(JSTOKEN_HTML, { status: 200 })
    if (url === 'https://www.terabox.com/main') return new Response(MAIN_HTML, { status: 200 })
    if (url.includes('/api/list')) {
      const dir = new URL(url).searchParams.get('dir')
      const page = new URL(url).searchParams.get('page')
      const key = `${dir}|${page}`
      if (listPages[key]) return jsonResponse(listPages[key])
      return jsonResponse({ errno: 0, list: [] })
    }
    if (url.includes('/api/filemanager')) return filemanager(url)
    throw new Error(`unexpected fetch: ${url}`)
  }
}

test('deleteTeraBoxFiles validates its inputs before touching the network', async (t) => {
  restoreFetch(t)
  mockFetch(async () => {
    throw new Error('must not fetch')
  })
  await assert.rejects(deleteTeraBoxFiles('cookie', []), /No TeraBox paths to delete/)
  await assert.rejects(
    deleteTeraBoxFiles('cookie', Array.from({ length: 11 }, (_, i) => `/f${i}`)),
    /Refusing to delete 11 files at once \(cap 10/
  )
  await assert.rejects(deleteTeraBoxFiles('cookie', ['relative/path']), /non-absolute path/)
  await assert.rejects(deleteTeraBoxFiles('cookie', ['/']), /Refusing to delete root/)
})

test('deleteTeraBoxFiles throws without a cookie (the web has no browser session)', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  mockFetch(async () => {
    throw new Error('must not fetch')
  })
  await assert.rejects(deleteTeraBoxFiles('', ['/vault.bin']), /No TeraBox cookie/)
})

test('deleteTeraBoxFiles deletes by exact path with the scraped page context', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  const calls = mockFetch(teraboxRouter())
  const ok = await deleteTeraBoxFiles('fake-cookie', ['/vault.bin', '/other.bin'])
  assert.equal(ok, true)
  const fm = calls.find((c) => c.url.includes('/api/filemanager'))
  assert.ok(fm, 'expected a filemanager call')
  assert.ok(fm.url.startsWith('https://dm.terabox.com/api/filemanager?'))
  assert.match(fm.url, /jsToken=pageJsToken987654/)
  assert.match(fm.url, /bdstoken=FAKE_BDSTOKEN/)
  assert.match(fm.url, /dp-logid=FAKELOGID123/)
  assert.match(fm.url, /opera=delete/)
  const body = new URLSearchParams(fm.options.body)
  assert.deepEqual(JSON.parse(body.get('filelist')), ['/vault.bin', '/other.bin'])
  assert.equal(fm.options.method, 'POST')
})

test('deleteTeraBoxFiles throws with a sanitized trace when every attempt fails', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  mockFetch(teraboxRouter({ filemanager: () => jsonResponse({ errno: 1, errmsg: 'denied' }) }))
  await assert.rejects(deleteTeraBoxFiles('fake-cookie', ['/vault.bin']), (err) => {
    assert.match(err.message, /TeraBox delete failed/)
    assert.match(err.message, /dm\.terabox\.com errno=1/)
    assert.match(err.message, /www\.terabox\.com errno=1/)
    assert.match(err.message, /Nothing deleted — files are untouched/)
    assert.doesNotMatch(err.message, /FAKE_BDSTOKEN|FAKELOGID123/)
    return true
  })
})

test('listAllTeraBoxFiles throws without a cookie', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  mockFetch(async () => {
    throw new Error('must not fetch')
  })
  await assert.rejects(listAllTeraBoxFiles(''), /No TeraBox cookie/)
})

test('listAllTeraBoxFiles walks folders and tags each file with its folder', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  mockFetch(
    teraboxRouter({
      listPages: {
        '/|1': {
          errno: 0,
          list: [
            { fs_id: 1, isdir: 0, path: '/a.txt', server_filename: 'a.txt', size: 5 },
            { fs_id: 2, isdir: 1, path: '/sub', server_filename: 'sub' },
          ],
        },
        '/sub|1': {
          errno: 0,
          list: [{ fs_id: 3, isdir: 0, path: '/sub/b.txt', server_filename: 'b.txt', size: 6 }],
        },
      },
    })
  )
  const files = await listAllTeraBoxFiles('fake-cookie')
  assert.deepEqual(files, [
    { fs_id: '1', path: '/a.txt', server_filename: 'a.txt', size: 5, isdir: 0, _folder: 'root' },
    { fs_id: '3', path: '/sub/b.txt', server_filename: 'b.txt', size: 6, isdir: 0, _folder: 'sub' },
  ])
})

test('listAllTeraBoxFiles paginates past the 100-per-page cap', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  const page1 = Array.from({ length: 100 }, (_, i) => ({
    fs_id: i + 1,
    isdir: 0,
    path: `/f${i + 1}`,
    server_filename: `f${i + 1}`,
    size: 1,
  }))
  mockFetch(
    teraboxRouter({
      listPages: {
        '/|1': { errno: 0, list: page1 },
        '/|2': {
          errno: 0,
          list: [{ fs_id: 101, isdir: 0, path: '/f101', server_filename: 'f101', size: 1 }],
        },
      },
    })
  )
  const files = await listAllTeraBoxFiles('fake-cookie')
  assert.equal(files.length, 101)
  assert.equal(files[100].fs_id, '101')
})

test('listAllTeraBoxFiles throws on a listing failure instead of returning a partial list', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  mockFetch(teraboxRouter({ listPages: { '/|1': { errno: -6, errmsg: 'need verify' } } }))
  await assert.rejects(listAllTeraBoxFiles('fake-cookie'), (err) => {
    assert.match(err.message, /\/api\/list failed for \/ page 1: errno=-6/)
    return true
  })
})

test('listAllTeraBoxFiles aborts past 100 pages rather than using a truncated listing', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  const fullPage = Array.from({ length: 100 }, (_, i) => ({
    fs_id: i + 1,
    isdir: 0,
    path: `/f${i + 1}`,
    server_filename: `f${i + 1}`,
    size: 1,
  }))
  mockFetch(async (url) => {
    if (url === 'https://www.terabox.com/') return new Response(JSTOKEN_HTML, { status: 200 })
    if (url.includes('/api/list')) return jsonResponse({ errno: 0, list: fullPage })
    throw new Error(`unexpected fetch: ${url}`)
  })
  await assert.rejects(listAllTeraBoxFiles('fake-cookie'), /exceeded 100 pages for \//)
})

// --- deleteVaultBlobCopies -------------------------------------------------

test('deleteVaultBlobCopies is a no-op for a plain gallery item with no blob', async (t) => {
  restoreFetch(t)
  const calls = mockFetch(async () => {
    throw new Error('must not fetch')
  })
  assert.equal(await deleteVaultBlobCopies({}, {}), undefined)
  assert.equal(await deleteVaultBlobCopies(null, {}), undefined)
  assert.equal(calls.length, 0)
})

test('deleteVaultBlobCopies deletes a udrop blob through authorize + delete', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  const calls = mockFetch(async (url) => {
    if (url.endsWith('/authorize')) {
      return jsonResponse({ _status: 'success', data: { access_token: 'tok', account_id: 'acc' } })
    }
    if (url.endsWith('/file/delete')) return jsonResponse({ _status: 'success' })
    throw new Error(`unexpected fetch: ${url}`)
  })
  await deleteVaultBlobCopies(
    { encryptedBlobHosts: [{ host: 'udrop', encryptedBlobFileId: 'file-1' }] },
    { udropKey1: 'k1', udropKey2: 'k2' }
  )
  assert.equal(calls.length, 2)
  assert.equal(calls[1].options.body.get('file_id'), 'file-1')
})

test('deleteVaultBlobCopies throws naming udrop when the blob has no file id or keys', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  mockFetch(async () => {
    throw new Error('must not fetch')
  })
  await assert.rejects(
    deleteVaultBlobCopies({ encryptedBlobHosts: [{ host: 'udrop' }] }, { udropKey1: 'k1', udropKey2: 'k2' }),
    /Vault blob delete failed on udrop: item has no encryptedBlobFileId/
  )
  await assert.rejects(
    deleteVaultBlobCopies(
      { encryptedBlobHosts: [{ host: 'udrop', encryptedBlobFileId: 'f1' }] },
      {}
    ),
    /Vault blob delete failed on udrop: UDrop API keys not configured/
  )
})

test('deleteVaultBlobCopies deletes a terabox blob found in the root folder', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  const calls = mockFetch(
    teraboxRouter({
      listPages: {
        '/|1': {
          errno: 0,
          list: [{ fs_id: 777, isdir: 0, path: '/vault.bin', server_filename: 'vault.bin', size: 9 }],
        },
      },
    })
  )
  await deleteVaultBlobCopies(
    {
      encryptedBlobHosts: [{ host: 'terabox', encryptedBlobFileId: '777' }],
      encryptedFileName: 'vault.bin',
    },
    { teraboxCookie: 'fake-cookie' }
  )
  const fm = calls.find((c) => c.url.includes('/api/filemanager'))
  assert.ok(fm, 'expected a filemanager delete call')
  assert.deepEqual(JSON.parse(new URLSearchParams(fm.options.body).get('filelist')), ['/vault.bin'])
})

test('deleteVaultBlobCopies releases the row when the terabox file is verifiably absent', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  mockFetch(teraboxRouter({ listPages: { '/|1': { errno: 0, list: [] } } }))
  await deleteVaultBlobCopies(
    {
      encryptedBlobHosts: [{ host: 'terabox', encryptedBlobFileId: '777' }],
      encryptedFileName: 'vault.bin',
    },
    { teraboxCookie: 'fake-cookie' }
  )
})

test('deleteVaultBlobCopies throws naming terabox when no fs_id can be resolved', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  mockFetch(async () => {
    throw new Error('must not fetch')
  })
  await assert.rejects(
    deleteVaultBlobCopies(
      { encryptedBlobHosts: [{ host: 'terabox', encryptedBlobUrl: 'https://example.com/no-fid' }] },
      { teraboxCookie: 'fake-cookie' }
    ),
    /Vault blob delete failed on terabox: no fs_id/
  )
})

test('deleteVaultBlobCopies deletes the telegram channel post carrying the blob', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  const calls = mockFetch(async (url) => {
    assert.ok(url.includes('/deleteMessage'))
    return jsonResponse({ ok: true, result: true })
  })
  await deleteVaultBlobCopies(
    {
      encryptedBlobHosts: [{ host: 'telegram', encryptedBlobMessageId: '90' }],
    },
    { telegramBotToken: FAKE_TOKEN, telegramChannel: 'mychan' }
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `https://api.telegram.org/bot${FAKE_TOKEN}/deleteMessage`)
  assert.equal(calls[0].options.body.get('chat_id'), '@mychan')
  assert.equal(calls[0].options.body.get('message_id'), '90')
})

test('deleteVaultBlobCopies releases the row when the telegram post is already gone', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  mockFetch(async () =>
    jsonResponse(
      { ok: false, error_code: 400, description: 'Bad Request: message to delete not found' },
      400
    )
  )
  await deleteVaultBlobCopies(
    { encryptedBlobHosts: [{ host: 'telegram', encryptedBlobMessageId: '90' }] },
    { telegramBotToken: FAKE_TOKEN, telegramChannel: 'mychan' }
  )
})

test('deleteVaultBlobCopies throws naming telegram when the message id or credentials are missing', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  mockFetch(async () => {
    throw new Error('must not fetch')
  })
  await assert.rejects(
    deleteVaultBlobCopies(
      { encryptedBlobHosts: [{ host: 'telegram' }] },
      { telegramBotToken: FAKE_TOKEN, telegramChannel: 'mychan' }
    ),
    /Vault blob delete failed on telegram: telegram copy has no encryptedBlobMessageId/
  )
  await assert.rejects(
    deleteVaultBlobCopies(
      { encryptedBlobHosts: [{ host: 'telegram', encryptedBlobMessageId: '90' }] },
      { telegramChannel: 'mychan' }
    ),
    /missing telegram_bot_token/
  )
  await assert.rejects(
    deleteVaultBlobCopies(
      { encryptedBlobHosts: [{ host: 'telegram', encryptedBlobMessageId: '90' }] },
      { telegramBotToken: FAKE_TOKEN }
    ),
    /missing telegram_channel/
  )
})

test('deleteVaultBlobCopies redacts the bot token from a telegram failure', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  mockFetch(async () => new Response(`server blew up, saw ${FAKE_TOKEN}`, { status: 500 }))
  await assert.rejects(
    deleteVaultBlobCopies(
      { encryptedBlobHosts: [{ host: 'telegram', encryptedBlobMessageId: '90' }] },
      { telegramBotToken: FAKE_TOKEN, telegramChannel: 'mychan' }
    ),
    (err) => {
      assert.doesNotMatch(err.message, new RegExp(FAKE_TOKEN))
      assert.match(err.message, /\[redacted\]/)
      return true
    }
  )
})

test('deleteVaultBlobCopies throws for an unsupported vault blob host', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  mockFetch(async () => {
    throw new Error('must not fetch')
  })
  await assert.rejects(
    deleteVaultBlobCopies(
      { encryptedBlobHosts: [{ host: 'filemoon', encryptedBlobFileId: 'f1' }] },
      {}
    ),
    /Vault blob delete failed on filemoon: unsupported vault blob host "filemoon"/
  )
})

// --- deleteTelegramPostsForItem --------------------------------------------

test('deleteTelegramPostsForItem is a no-op when the row never touched the channel', async (t) => {
  restoreFetch(t)
  const calls = mockFetch(async () => {
    throw new Error('must not fetch')
  })
  assert.deepEqual(
    await deleteTelegramPostsForItem({ id: 'img-1' }, { telegramBotToken: FAKE_TOKEN, telegramChannel: 'c' }),
    { checked: 0, deleted: 0, alreadyGone: 0 }
  )
  assert.equal(calls.length, 0)
})

test('deleteTelegramPostsForItem deletes each distinct message id once', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  const calls = mockFetch(async () => jsonResponse({ ok: true, result: true }))
  const row = {
    id: 'img-1',
    imageHosts: { telegram: { url: '/telegram-media/a', messageId: '42' } },
    videoHosts: { telegram: { watchUrl: 'https://t.me/c/1/43', messageId: '43' } },
  }
  const result = await deleteTelegramPostsForItem(row, {
    telegramBotToken: FAKE_TOKEN,
    telegramChannel: 'mychan',
  })
  assert.deepEqual(result, { checked: 2, deleted: 2, alreadyGone: 0 })
  assert.equal(calls.length, 2)
  assert.deepEqual(
    calls.map((c) => c.options.body.get('message_id')).sort(),
    ['42', '43']
  )
})

test('deleteTelegramPostsForItem dedupes a message id shared by image + video links', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  const calls = mockFetch(async () => jsonResponse({ ok: true, result: true }))
  const row = {
    id: 'img-1',
    imageHosts: { telegram: { url: '/telegram-media/a', messageId: '42' } },
    videoHosts: { telegram: { watchUrl: 'https://t.me/c/1/42', messageId: '42' } },
  }
  const result = await deleteTelegramPostsForItem(row, {
    telegramBotToken: FAKE_TOKEN,
    telegramChannel: 'mychan',
  })
  assert.deepEqual(result, { checked: 1, deleted: 1, alreadyGone: 0 })
  assert.equal(calls.length, 1)
})

test('deleteTelegramPostsForItem counts an already-gone post instead of throwing', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  mockFetch(async () =>
    jsonResponse(
      { ok: false, error_code: 400, description: 'Bad Request: message to delete not found' },
      400
    )
  )
  const row = {
    id: 'img-1',
    imageHosts: { telegram: { url: '/telegram-media/a', messageId: '42' } },
  }
  const result = await deleteTelegramPostsForItem(row, {
    telegramBotToken: FAKE_TOKEN,
    telegramChannel: 'mychan',
  })
  assert.deepEqual(result, { checked: 1, deleted: 0, alreadyGone: 1 })
})

test('deleteTelegramPostsForItem throws without token/channel so the ids are not lost', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  mockFetch(async () => {
    throw new Error('must not fetch')
  })
  const row = {
    id: 'img-1',
    imageHosts: { telegram: { url: '/telegram-media/a', messageId: '42' } },
  }
  await assert.rejects(
    deleteTelegramPostsForItem(row, { telegramChannel: 'mychan' }),
    /missing telegram_bot_token/
  )
  await assert.rejects(
    deleteTelegramPostsForItem(row, { telegramBotToken: FAKE_TOKEN }),
    /missing telegram_channel/
  )
})

test('deleteTelegramPostsForItem throws naming the message id on a real failure', async (t) => {
  silenceConsole(t)
  restoreFetch(t)
  mockFetch(async () => new Response('forbidden', { status: 403 }))
  const row = {
    id: 'img-1',
    imageHosts: { telegram: { url: '/telegram-media/a', messageId: '42' } },
  }
  await assert.rejects(
    deleteTelegramPostsForItem(row, { telegramBotToken: FAKE_TOKEN, telegramChannel: 'mychan' }),
    (err) => {
      assert.match(err.message, /Telegram post delete failed for message 42/)
      assert.match(err.message, /HTTP 403/)
      assert.match(err.message, /bot-delete window/)
      return true
    }
  )
})
