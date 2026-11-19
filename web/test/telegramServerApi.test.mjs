// Server-side Telegram Bot API helpers. All network is mocked — no live
// Telegram calls. The token used here is fake.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TELEGRAM_GETFILE_MAX_BYTES,
  TELEGRAM_TIMEOUT_MS,
  TELEGRAM_UPLOAD_MAX_BYTES,
  deleteTelegramMessage,
  fetchTelegramFile,
  formatBytesForError,
  getTelegramFileInfo,
  isNumericTelegramChannel,
  redactTelegramToken,
  sendTelegramFile,
  telegramCallApi,
  telegramChannelBareId,
  telegramChatId,
  telegramFileBytesUrl,
  telegramLocalMediaUrl,
  telegramPostPageUrl,
  telegramUploadField,
  telegramUploadMethod,
  telegramUploadSizeCap,
} from '../src/lib/telegramServerApi.js'
import * as sharedLimits from 'imgvault-shared/telegramLimits.js'

const FAKE_TOKEN = 'FAKE_TELEGRAM_BOT_TOKEN_12345'
const realFetch = globalThis.fetch

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function mockFetch(handler) {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    return handler(String(url), options)
  }
  return calls
}

test('redactTelegramToken replaces every occurrence with [redacted]', () => {
  assert.equal(
    redactTelegramToken(`leak ${FAKE_TOKEN} and ${FAKE_TOKEN} again`, FAKE_TOKEN),
    'leak [redacted] and [redacted] again'
  )
})

test('redactTelegramToken leaves text alone without a token', () => {
  assert.equal(redactTelegramToken('plain error', ''), 'plain error')
  assert.equal(redactTelegramToken('plain error', null), 'plain error')
  assert.equal(redactTelegramToken(null, FAKE_TOKEN), '')
})

test('telegramChatId @-prefixes a bare channel username', () => {
  assert.equal(telegramChatId('mychannel'), '@mychannel')
  assert.equal(telegramChatId('@mychannel'), '@mychannel')
  assert.equal(telegramChatId('@@mychannel'), '@mychannel')
  assert.equal(telegramChatId('  spaced  '), '@spaced')
})

test('telegramChatId passes explicit ids through unchanged', () => {
  assert.equal(telegramChatId('-1001234567890'), '-1001234567890')
})

test('telegramChatId gives a bare numeric id the -100 prefix (bare digits are a user id to the Bot API)', () => {
  assert.equal(telegramChatId('123456789'), '-100123456789')
  assert.equal(telegramChatId('  123456789  '), '-100123456789')
})

test('telegramPostPageUrl builds the t.me/c link for a numeric (private) channel', () => {
  assert.equal(telegramPostPageUrl('-1003959088547', '90'), 'https://t.me/c/3959088547/90')
  assert.equal(telegramPostPageUrl('3959088547', 90), 'https://t.me/c/3959088547/90')
  assert.equal(telegramPostPageUrl('mychannel', '90'), 'https://t.me/mychannel/90')
  assert.equal(telegramPostPageUrl('', '90'), '')
  assert.equal(telegramPostPageUrl('mychannel', ''), '')
})

test('isNumericTelegramChannel / telegramChannelBareId classify both id forms', () => {
  assert.equal(isNumericTelegramChannel('-1003959088547'), true)
  assert.equal(isNumericTelegramChannel('3959088547'), true)
  assert.equal(isNumericTelegramChannel('mychannel'), false)
  assert.equal(telegramChannelBareId('-1003959088547'), '3959088547')
  assert.equal(telegramChannelBareId('3959088547'), '3959088547')
  assert.equal(telegramChannelBareId('mychannel'), '')
})

test('telegramChatId throws loudly when no channel is configured', () => {
  assert.throws(() => telegramChatId(''), /not configured.*Settings → API Keys/)
  assert.throws(() => telegramChatId('   '), /not configured/)
  assert.throws(() => telegramChatId(null), /not configured/)
})

test('telegramLocalMediaUrl builds the platform-local byte route', () => {
  assert.equal(telegramLocalMediaUrl('abc123'), '/telegram-media/abc123')
  assert.equal(
    telegramLocalMediaUrl('abc123', 'video/mp4'),
    '/telegram-media/abc123?mt=video%2Fmp4'
  )
  assert.equal(telegramLocalMediaUrl('a b', 'audio/mp4'), '/telegram-media/a%20b?mt=audio%2Fmp4')
  assert.equal(telegramLocalMediaUrl('  abc123  '), '/telegram-media/abc123')
})

test('telegramFileBytesUrl embeds the token in the bytes path', () => {
  assert.equal(
    telegramFileBytesUrl(FAKE_TOKEN, 'documents/file_1.bin'),
    `https://api.telegram.org/file/bot${FAKE_TOKEN}/documents/file_1.bin`
  )
})

test('telegramCallApi posts to the Bot API and returns result', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const calls = mockFetch(async () => jsonResponse({ ok: true, result: { file_id: 'x' } }))
  const form = new FormData()
  form.append('file_id', 'x')
  const result = await telegramCallApi(FAKE_TOKEN, 'getFile', form)
  assert.deepEqual(result, { file_id: 'x' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `https://api.telegram.org/bot${FAKE_TOKEN}/getFile`)
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.cache, 'no-store')
  assert.equal(calls[0].options.credentials, 'omit')
  assert.equal(calls[0].options.body, form)
})

test('telegramCallApi redacts the token from network errors', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () => {
    throw new Error(`connect failed, url had ${FAKE_TOKEN} in it`)
  })
  await assert.rejects(
    telegramCallApi(FAKE_TOKEN, 'getFile', new FormData()),
    (err) => {
      assert.match(err.message, /Telegram getFile: network error/)
      assert.doesNotMatch(err.message, new RegExp(FAKE_TOKEN))
      assert.match(err.message, /\[redacted\]/)
      return true
    }
  )
})

test('telegramCallApi throws with method + status on HTTP errors, token redacted', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () => new Response(`bad request, token ${FAKE_TOKEN}`, { status: 400 }))
  await assert.rejects(telegramCallApi(FAKE_TOKEN, 'sendDocument', new FormData()), (err) => {
    assert.match(err.message, /Telegram sendDocument: HTTP 400/)
    assert.doesNotMatch(err.message, new RegExp(FAKE_TOKEN))
    return true
  })
})

test('telegramCallApi throws on an invalid JSON response', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () => new Response('this is not json', { status: 200 }))
  await assert.rejects(telegramCallApi(FAKE_TOKEN, 'getFile', new FormData()), /invalid JSON response/)
})

test('telegramCallApi throws with error_code + description on ok:false', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () =>
    jsonResponse({ ok: false, error_code: 400, description: 'Bad Request: chat not found' })
  )
  await assert.rejects(telegramCallApi(FAKE_TOKEN, 'sendDocument', new FormData()), (err) => {
    assert.match(err.message, /Telegram sendDocument: 400 Bad Request: chat not found/)
    return true
  })
})

test('getTelegramFileInfo throws on a missing file id', async () => {
  await assert.rejects(getTelegramFileInfo(FAKE_TOKEN, ''), /missing file id/)
  await assert.rejects(getTelegramFileInfo(FAKE_TOKEN, '   '), /missing file id/)
})

test('getTelegramFileInfo throws when getFile answers without file_path', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () => jsonResponse({ ok: true, result: { file_size: 10 } }))
  await assert.rejects(getTelegramFileInfo(FAKE_TOKEN, 'abc'), /no file_path in response/)
})

test('getTelegramFileInfo enforces the 20 MB getFile gate loudly', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () =>
    jsonResponse({ ok: true, result: { file_path: 'big.bin', file_size: 21 * 1024 * 1024 } })
  )
  await assert.rejects(getTelegramFileInfo(FAKE_TOKEN, 'abc'), (err) => {
    assert.match(err.message, /getFile gate/)
    assert.match(err.message, /21\.0 MB/)
    assert.match(err.message, /20\.0 MB/)
    return true
  })
})

test('getTelegramFileInfo returns the info at exactly the cap', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () =>
    jsonResponse({
      ok: true,
      result: { file_path: 'edge.bin', file_size: TELEGRAM_GETFILE_MAX_BYTES },
    })
  )
  const info = await getTelegramFileInfo(FAKE_TOKEN, 'abc')
  assert.equal(info.file_path, 'edge.bin')
})

test('fetchTelegramFile resolves getFile then fetches the bytes URL', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const calls = mockFetch(async (url) => {
    if (url.includes('/getFile')) {
      return jsonResponse({ ok: true, result: { file_path: 'docs/f.bin', file_size: 4 } })
    }
    return new Response('BYTES', { status: 200 })
  })
  const res = await fetchTelegramFile(FAKE_TOKEN, 'abc')
  assert.equal(await res.text(), 'BYTES')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url, `https://api.telegram.org/file/bot${FAKE_TOKEN}/docs/f.bin`)
  assert.deepEqual(calls[1].options.headers, {})
})

test('fetchTelegramFile forwards a Range header to the bytes fetch', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const calls = mockFetch(async (url) => {
    if (url.includes('/getFile')) {
      return jsonResponse({ ok: true, result: { file_path: 'docs/f.bin', file_size: 100 } })
    }
    return new Response('RANGE', { status: 206 })
  })
  const res = await fetchTelegramFile(FAKE_TOKEN, 'abc', { range: 'bytes=0-4' })
  assert.equal(res.status, 206)
  assert.equal(calls[1].options.headers.Range, 'bytes=0-4')
})

test('fetchTelegramFile throws when the bytes fetch answers a non-2xx', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async (url) => {
    if (url.includes('/getFile')) {
      return jsonResponse({ ok: true, result: { file_path: 'docs/f.bin', file_size: 4 } })
    }
    return new Response('gone', { status: 404 })
  })
  await assert.rejects(fetchTelegramFile(FAKE_TOKEN, 'abc'), (err) => {
    assert.match(err.message, /HTTP 404/)
    assert.match(err.message, /file_path.*can expire/)
    return true
  })
})

test('fetchTelegramFile times out and names the wait', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  mockFetch(async () => new Promise(() => {})) // never resolves
  await assert.rejects(fetchTelegramFile(FAKE_TOKEN, 'abc', { timeoutMs: 10 }), /timed out after 0s/)
})

test('fetchTelegramFile default timeout is 60 seconds', () => {
  assert.equal(TELEGRAM_TIMEOUT_MS, 60000)
})

test('sendTelegramFile throws without a token or channel', async () => {
  const blob = new Blob(['x'])
  await assert.rejects(
    sendTelegramFile({ token: '', channel: 'chan', blob, filename: 'f.bin' }),
    /bot token is not configured/
  )
  await assert.rejects(
    sendTelegramFile({ token: FAKE_TOKEN, channel: '', blob, filename: 'f.bin' }),
    /channel is not configured/
  )
})

test('sendTelegramFile posts a document with the opaque .bin default name', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const calls = mockFetch(async () => jsonResponse({ ok: true, result: { message_id: 7 } }))
  const blob = new Blob(['ciphertext'])
  const result = await sendTelegramFile({ token: FAKE_TOKEN, channel: 'mychan', blob })
  assert.deepEqual(result, { message_id: 7 })
  assert.equal(calls[0].url, `https://api.telegram.org/bot${FAKE_TOKEN}/sendDocument`)
  const form = calls[0].options.body
  assert.equal(form.get('chat_id'), '@mychan')
  assert.equal(form.get('disable_notification'), 'true')
  assert.equal(form.get('document').name, 'file.bin')
  assert.equal(form.get('supports_streaming'), null)
})

test('sendTelegramFile sendVideo uses the video field + supports_streaming', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const calls = mockFetch(async () => jsonResponse({ ok: true, result: { message_id: 8 } }))
  const blob = new Blob(['videobytes'])
  await sendTelegramFile({
    token: FAKE_TOKEN,
    channel: '-100123',
    blob,
    filename: 'clip.mp4',
    method: 'sendVideo',
  })
  assert.equal(calls[0].url, `https://api.telegram.org/bot${FAKE_TOKEN}/sendVideo`)
  const form = calls[0].options.body
  assert.equal(form.get('chat_id'), '-100123')
  assert.equal(form.get('video').name, 'clip.mp4')
  assert.equal(form.get('supports_streaming'), 'true')
})

test('deleteTelegramMessage throws on missing token, channel, or message id', async () => {
  await assert.rejects(
    deleteTelegramMessage({ token: '', channel: 'c', messageId: '1' }),
    /bot token is not configured/
  )
  await assert.rejects(
    deleteTelegramMessage({ token: FAKE_TOKEN, channel: '', messageId: '1' }),
    /channel is not configured/
  )
  await assert.rejects(
    deleteTelegramMessage({ token: FAKE_TOKEN, channel: 'c', messageId: '' }),
    /missing message id/
  )
})

test('deleteTelegramMessage posts chat_id + message_id and returns the result', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch
  })
  const calls = mockFetch(async () => jsonResponse({ ok: true, result: true }))
  const result = await deleteTelegramMessage({
    token: FAKE_TOKEN,
    channel: 'mychan',
    messageId: '42',
  })
  assert.equal(result, true)
  assert.equal(calls[0].url, `https://api.telegram.org/bot${FAKE_TOKEN}/deleteMessage`)
  const form = calls[0].options.body
  assert.equal(form.get('chat_id'), '@mychan')
  assert.equal(form.get('message_id'), '42')
})

test('re-exported telegram limits match packages/shared exactly', () => {
  assert.equal(TELEGRAM_GETFILE_MAX_BYTES, 20 * 1024 * 1024)
  assert.equal(TELEGRAM_UPLOAD_MAX_BYTES, 50 * 1024 * 1024)
  assert.equal(TELEGRAM_GETFILE_MAX_BYTES, sharedLimits.TELEGRAM_GETFILE_MAX_BYTES)
  assert.equal(TELEGRAM_UPLOAD_MAX_BYTES, sharedLimits.TELEGRAM_UPLOAD_MAX_BYTES)
  assert.equal(formatBytesForError, sharedLimits.formatBytesForError)
  assert.equal(telegramUploadField, sharedLimits.telegramUploadField)
  assert.equal(telegramUploadMethod, sharedLimits.telegramUploadMethod)
  assert.equal(telegramUploadSizeCap, sharedLimits.telegramUploadSizeCap)
})
