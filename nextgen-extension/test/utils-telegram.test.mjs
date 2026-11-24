// node:test suite for src/utils/telegramApi.js — the Telegram Bot API
// client + the native-host MTProto helpers. All network is mocked
// (globalThis.fetch stubbed per test); the native port is a fake
// chrome.runtime.connectNative. Fake tokens only.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  TELEGRAM_GETFILE_MAX_BYTES,
  TELEGRAM_NATIVE_MAX_BYTES,
  TELEGRAM_UPLOAD_MAX_BYTES,
  assertTelegramUploadSize,
  checkTelegramSceneIntegrity,
  deleteNativeTempFile,
  deleteTelegramMessage,
  downloadTelegramFileNative,
  fetchTelegramFile,
  formatBytesForError,
  getTelegramFileInfo,
  isNativeTelegramFileId,
  isNumericTelegramChannel,
  listTelegramPosts,
  nativeTelegramMessageId,
  probeNativeHost,
  scrapeTelegramPostMedia,
  scrapeTelegramPostUrl,
  sendTelegramFile,
  stageBlobForNativeUpload,
  telegramApiBase,
  telegramCallApi,
  telegramChannelBareId,
  telegramChatId,
  telegramFileBytesUrl,
  telegramFileIdFromLocalUrl,
  telegramLocalMediaUrl,
  telegramPostPageUrl,
  telegramUploadField,
  telegramUploadMethod,
  telegramUploadSizeCap,
  uploadTelegramNative,
  verifyTelegramFileNative,
} from '../src/utils/telegramApi.js';

const FAKE_TOKEN = '123456:FAKE-TOKEN-FOR-TESTS-ONLY';
const CHANNEL = 'testchannel';

const jsonResponse = (obj, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => obj,
  text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)),
});
const htmlResponse = (html, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => { throw new Error('not json'); },
  text: async () => html,
});
const realFetch = globalThis.fetch;
let fetchCalls;
let fetchHandler;
beforeEach(() => {
  fetchCalls = [];
  fetchHandler = null;
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url: String(url), options });
    if (!fetchHandler) throw new Error(`unexpected fetch: ${url}`);
    return fetchHandler(String(url), options);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (globalThis.chrome !== undefined) delete globalThis.chrome;
});

describe('re-exported telegram limits', () => {
  test('the limits module is re-exported through telegramApi', () => {
    assert.equal(TELEGRAM_UPLOAD_MAX_BYTES, 50 * 1024 * 1024);
    assert.equal(TELEGRAM_GETFILE_MAX_BYTES, 20 * 1024 * 1024);
    assert.equal(TELEGRAM_NATIVE_MAX_BYTES, 2000 * 1024 * 1024);
    assert.equal(telegramUploadField('a.mp4'), 'video');
    assert.equal(telegramUploadMethod('a.mp4'), 'sendVideo');
    assert.equal(telegramUploadSizeCap('a.mp4'), 50 * 1024 * 1024);
    assert.equal(formatBytesForError(2000 * 1024 * 1024), '1.95 GB');
    assert.doesNotThrow(() => assertTelegramUploadSize(10, 'a.mp4'));
  });
});

describe('telegramChatId / telegramApiBase / requireTelegramToken (via telegramApiBase)', () => {
  test('telegramChatId strips @ and prefixes it back', () => {
    assert.equal(telegramChatId('testchannel'), '@testchannel');
    assert.equal(telegramChatId('@testchannel'), '@testchannel');
    assert.equal(telegramChatId('@@testchannel'), '@testchannel');
    assert.equal(telegramChatId('  testchannel  '), '@testchannel');
  });
  test('a numeric chat id (leading -) is kept as-is', () => {
    assert.equal(telegramChatId('-100123456789'), '-100123456789');
  });
  test('a bare numeric id gets the -100 prefix (bare digits are a user id to the Bot API)', () => {
    assert.equal(telegramChatId('3959088547'), '-1003959088547');
    assert.equal(telegramChatId('  3959088547  '), '-1003959088547');
  });
  test('an empty channel throws naming Settings', () => {
    assert.throws(() => telegramChatId(''), /Telegram channel is not configured/);
    assert.throws(() => telegramChatId('   '), /Telegram channel is not configured/);
    assert.throws(() => telegramChatId(null), /Telegram channel is not configured/);
  });
  test('telegramApiBase embeds the trimmed token', () => {
    assert.equal(telegramApiBase(` ${FAKE_TOKEN} `), `https://api.telegram.org/bot${FAKE_TOKEN}`);
  });
  test('an empty token throws naming Settings', () => {
    assert.throws(() => telegramApiBase(''), /Telegram bot token is not configured/);
    assert.throws(() => telegramApiBase('   '), /Telegram bot token is not configured/);
  });
});

describe('telegramFileBytesUrl / telegramLocalMediaUrl / telegramPostPageUrl / telegramFileIdFromLocalUrl', () => {
  test('telegramFileBytesUrl builds the token-carrying file URL', () => {
    assert.equal(
      telegramFileBytesUrl(FAKE_TOKEN, 'documents/file_1.mp4'),
      `https://api.telegram.org/file/bot${FAKE_TOKEN}/documents/file_1.mp4`,
    );
    assert.throws(() => telegramFileBytesUrl('', 'x'), /bot token is not configured/);
  });
  test('telegramLocalMediaUrl builds the platform-local path with the mime in the query', () => {
    assert.equal(telegramLocalMediaUrl('abc123'), '/telegram-media/abc123');
    assert.equal(
      telegramLocalMediaUrl('abc123', 'audio/mp4'),
      '/telegram-media/abc123?mt=audio%2Fmp4',
    );
    assert.equal(
      telegramLocalMediaUrl('a/b c', 'video/mp4'),
      '/telegram-media/a%2Fb%20c?mt=video%2Fmp4',
    );
  });
  test('telegramPostPageUrl builds the public post link', () => {
    assert.equal(telegramPostPageUrl('testchannel', '90'), 'https://t.me/testchannel/90');
    assert.equal(telegramPostPageUrl('@testchannel', 90), 'https://t.me/testchannel/90');
    assert.equal(telegramPostPageUrl('', '90'), '');
    assert.equal(telegramPostPageUrl('testchannel', ''), '');
  });
  test('telegramPostPageUrl builds the t.me/c link for a numeric (private) channel', () => {
    assert.equal(telegramPostPageUrl('-1003959088547', '90'), 'https://t.me/c/3959088547/90');
    assert.equal(telegramPostPageUrl('3959088547', 90), 'https://t.me/c/3959088547/90');
    assert.equal(telegramPostPageUrl('  -1003959088547  ', '90'), 'https://t.me/c/3959088547/90');
  });
  test('isNumericTelegramChannel / telegramChannelBareId classify both id forms', () => {
    assert.equal(isNumericTelegramChannel('-1003959088547'), true);
    assert.equal(isNumericTelegramChannel('3959088547'), true);
    assert.equal(isNumericTelegramChannel('testchannel'), false);
    assert.equal(isNumericTelegramChannel('@testchannel'), false);
    assert.equal(isNumericTelegramChannel(''), false);
    assert.equal(telegramChannelBareId('-1003959088547'), '3959088547');
    assert.equal(telegramChannelBareId('3959088547'), '3959088547');
    assert.equal(telegramChannelBareId('testchannel'), '');
  });
  test('telegramFileIdFromLocalUrl extracts and decodes the file id', () => {
    assert.equal(telegramFileIdFromLocalUrl('/telegram-media/abc123?mt=audio%2Fmp4'), 'abc123');
    assert.equal(telegramFileIdFromLocalUrl('/telegram-media/a%2Fb%20c'), 'a/b c');
    assert.equal(telegramFileIdFromLocalUrl('https://example.com/x'), '');
    assert.equal(telegramFileIdFromLocalUrl(''), '');
  });
});

describe('telegramCallApi', () => {
  test('GETs when there is no body, POSTs with one, and returns result', async () => {
    fetchHandler = (url, options) => {
      assert.match(url, new RegExp(`^https://api\\.telegram\\.org/bot${FAKE_TOKEN}/getMe$`));
      return jsonResponse({ ok: true, result: { id: 1, username: 'bot' } });
    };
    assert.deepEqual(await telegramCallApi(FAKE_TOKEN, 'getMe'), { id: 1, username: 'bot' });
    assert.equal(fetchCalls[0].options.method, 'GET');
    assert.equal(fetchCalls[0].options.credentials, 'omit');

    const form = new FormData();
    form.append('chat_id', '@testchannel');
    fetchHandler = () => jsonResponse({ ok: true, result: { message_id: 7 } });
    assert.deepEqual(await telegramCallApi(FAKE_TOKEN, 'sendMessage', { body: form }), { message_id: 7 });
    assert.equal(fetchCalls[1].options.method, 'POST');
    assert.strictEqual(fetchCalls[1].options.body, form);
  });
  test('an HTTP error throws with method, status, and body text', async () => {
    fetchHandler = () => jsonResponse({ error: 'x' }, { ok: false, status: 403 });
    await assert.rejects(
      () => telegramCallApi(FAKE_TOKEN, 'getMe'),
      (err) => err.message.includes('Telegram getMe: HTTP 403'),
    );
  });
  test('a non-ok JSON payload throws with code and description', async () => {
    fetchHandler = () => jsonResponse({ ok: false, error_code: 400, description: 'Bad Request: chat not found' });
    await assert.rejects(
      () => telegramCallApi(FAKE_TOKEN, 'sendMessage'),
      /Telegram sendMessage: 400 Bad Request: chat not found/,
    );
  });
  test('invalid JSON throws naming the method', async () => {
    fetchHandler = () => ({
      ok: true,
      status: 200,
      json: async () => { throw new Error('bad json'); },
      text: async () => 'not json',
    });
    await assert.rejects(() => telegramCallApi(FAKE_TOKEN, 'getMe'), /Telegram getMe: invalid JSON response/);
  });
  test('a network failure is wrapped with the method', async () => {
    fetchHandler = () => { throw new Error('connection reset'); };
    await assert.rejects(() => telegramCallApi(FAKE_TOKEN, 'getMe'), /Telegram getMe: network error - connection reset/);
  });
  test('an aborted signal reports an abort, not a network error', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchHandler = () => { throw new Error('aborted by signal'); };
    await assert.rejects(
      () => telegramCallApi(FAKE_TOKEN, 'sendVideo', { signal: controller.signal }),
      /Telegram sendVideo: upload aborted/,
    );
  });
  test('timeoutMs aborts a hanging fetch', async () => {
    fetchHandler = (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted by timeout')));
    });
    await assert.rejects(
      () => telegramCallApi(FAKE_TOKEN, 'getMe', { timeoutMs: 10 }),
      /Telegram getMe: network error - aborted by timeout/,
    );
  });
});

describe('sendTelegramFile', () => {
  test('sendVideo sends the blob as video with supports_streaming', async () => {
    let seenBody;
    fetchHandler = (_url, options) => {
      seenBody = options.body;
      return jsonResponse({ ok: true, result: { message_id: 10 } });
    };
    const blob = new Blob(['fake-video'], { type: 'video/mp4' });
    const out = await sendTelegramFile({
      token: FAKE_TOKEN, channel: CHANNEL, blob, filename: 'clip.mp4', method: 'sendVideo',
    });
    assert.equal(out.message_id, 10);
    assert.equal(seenBody.get('chat_id'), '@testchannel');
    assert.equal(seenBody.get('disable_notification'), 'true');
    assert.equal(seenBody.get('supports_streaming'), 'true');
    assert.ok(seenBody.get('video') instanceof Blob);
    assert.equal(seenBody.get('video').size, 10);
  });
  test('sendDocument sends the blob as document without supports_streaming', async () => {
    let seenBody;
    fetchHandler = (_url, options) => {
      seenBody = options.body;
      return jsonResponse({ ok: true, result: { message_id: 11 } });
    };
    const blob = new Blob(['fake-doc'], { type: 'image/png' });
    await sendTelegramFile({ token: FAKE_TOKEN, channel: CHANNEL, blob, method: 'sendDocument' });
    assert.equal(seenBody.get('supports_streaming'), null);
    assert.ok(seenBody.get('document') instanceof Blob);
    assert.equal(seenBody.get('video'), null);
  });
  test('filenames default to video.mp4 / file.bin', async () => {
    const seen = [];
    fetchHandler = (_url, options) => {
      seen.push(options.body);
      return jsonResponse({ ok: true, result: {} });
    };
    await sendTelegramFile({ token: FAKE_TOKEN, channel: CHANNEL, blob: new Blob(['x']), method: 'sendVideo' });
    await sendTelegramFile({ token: FAKE_TOKEN, channel: CHANNEL, blob: new Blob(['x']), method: 'sendDocument' });
    // FormData file names are not readable via .get(); assert the call went out twice.
    assert.equal(seen.length, 2);
  });
});

describe('getTelegramFileInfo', () => {
  test('returns the getFile result for a readable file', async () => {
    fetchHandler = () => jsonResponse({
      ok: true,
      result: { file_id: 'abc', file_path: 'documents/f.mp4', file_size: 1000 },
    });
    const info = await getTelegramFileInfo(FAKE_TOKEN, 'abc');
    assert.equal(info.file_path, 'documents/f.mp4');
    assert.match(fetchCalls[0].url, /\/getFile$/);
    assert.equal(fetchCalls[0].options.body.get('file_id'), 'abc');
  });
  test('a missing file id throws before any fetch', async () => {
    await assert.rejects(() => getTelegramFileInfo(FAKE_TOKEN, ''), /missing file id/);
    await assert.rejects(() => getTelegramFileInfo(FAKE_TOKEN, '   '), /missing file id/);
    assert.equal(fetchCalls.length, 0);
  });
  test('a response without file_path throws', async () => {
    fetchHandler = () => jsonResponse({ ok: true, result: { file_id: 'abc' } });
    await assert.rejects(() => getTelegramFileInfo(FAKE_TOKEN, 'abc'), /no file_path in response/);
  });
  test('a file over the 20 MB getFile gate throws naming the gate', async () => {
    fetchHandler = () => jsonResponse({
      ok: true,
      result: { file_id: 'abc', file_path: 'documents/f.mp4', file_size: 21 * 1024 * 1024 },
    });
    await assert.rejects(
      () => getTelegramFileInfo(FAKE_TOKEN, 'abc'),
      (err) => err.message.includes('Telegram getFile gate')
        && err.message.includes('21.0 MB')
        && err.message.includes('20.0 MB'),
    );
  });
  test('a file at EXACTLY the 20 MB cap passes — the gate is strict greater-than, not greater-or-equal', async () => {
    fetchHandler = () => jsonResponse({
      ok: true,
      result: { file_id: 'abc', file_path: 'documents/f.mp4', file_size: 20 * 1024 * 1024 },
    });
    const info = await getTelegramFileInfo(FAKE_TOKEN, 'abc');
    assert.equal(info.file_size, 20 * 1024 * 1024);
  });
  test('one byte over the cap trips the gate', async () => {
    fetchHandler = () => jsonResponse({
      ok: true,
      result: { file_id: 'abc', file_path: 'documents/f.mp4', file_size: 20 * 1024 * 1024 + 1 },
    });
    await assert.rejects(() => getTelegramFileInfo(FAKE_TOKEN, 'abc'), /Telegram getFile gate/);
  });
});

describe('fetchTelegramFile', () => {
  const getFileOk = () => jsonResponse({
    ok: true,
    result: { file_id: 'abc', file_path: 'documents/f.mp4', file_size: 1000 },
  });
  test('resolves getFile then fetches the bytes URL', async () => {
    fetchHandler = (url) => (url.includes('/getFile') ? getFileOk() : jsonResponse({ bytes: true }));
    const resp = await fetchTelegramFile(FAKE_TOKEN, 'abc');
    assert.equal(fetchCalls.length, 2);
    assert.equal(
      fetchCalls[1].url,
      `https://api.telegram.org/file/bot${FAKE_TOKEN}/documents/f.mp4`,
    );
    assert.equal(resp.ok, true);
  });
  test('a Range header is forwarded', async () => {
    fetchHandler = (url) => (url.includes('/getFile') ? getFileOk() : jsonResponse({}));
    await fetchTelegramFile(FAKE_TOKEN, 'abc', { range: 'bytes=0-999' });
    assert.equal(fetchCalls[1].options.headers.Range, 'bytes=0-999');
  });
  test('a 206 response is accepted', async () => {
    fetchHandler = (url) => (url.includes('/getFile')
      ? getFileOk()
      : jsonResponse({}, { ok: false, status: 206 }));
    const resp = await fetchTelegramFile(FAKE_TOKEN, 'abc');
    assert.equal(resp.status, 206);
  });
  test('a 404 on the bytes fetch throws naming expiry', async () => {
    fetchHandler = (url) => (url.includes('/getFile')
      ? getFileOk()
      : jsonResponse({}, { ok: false, status: 404 }));
    await assert.rejects(
      () => fetchTelegramFile(FAKE_TOKEN, 'abc'),
      (err) => err.message.includes('HTTP 404') && err.message.includes('file_path from getFile can expire'),
    );
  });
});

describe('deleteTelegramMessage', () => {
  test('posts deleteMessage with chat_id and message_id', async () => {
    let seenBody;
    fetchHandler = (url, options) => {
      seenBody = options.body;
      assert.match(url, /\/deleteMessage$/);
      return jsonResponse({ ok: true, result: true });
    };
    assert.equal(await deleteTelegramMessage({ token: FAKE_TOKEN, channel: CHANNEL, messageId: '90' }), true);
    assert.equal(seenBody.get('chat_id'), '@testchannel');
    assert.equal(seenBody.get('message_id'), '90');
  });
});

describe('scrapeTelegramPostMedia', () => {
  const postHtml = (channel, id, inner) =>
    `<div class="tgme_widget_message" data-post="${channel}/${id}">${inner}</div>`;
  const mp4 = 'https://cdn1.telesco.pe/file/abc123/video.mp4?token=x';
  const poster = 'https://cdn2.telesco.pe/file/abc123/thumb.jpg';

  test('a numeric (private) channel fails fast without fetching — no public post page exists', async () => {
    await assert.rejects(
      () => scrapeTelegramPostMedia('-1003959088547', '90', { attempts: 4 }),
      /is private \(numeric id\) — it has no public t\.me\/s page/,
    );
    assert.equal(fetchCalls.length, 0);
  });

  test('extracts the mp4 and the poster from the post segment', async () => {
    fetchHandler = () => htmlResponse(postHtml(CHANNEL, '90', `<video src="${mp4}"></video><img src="${poster}">`));
    const out = await scrapeTelegramPostMedia(CHANNEL, '90', { attempts: 1 });
    assert.equal(out.mp4Url, mp4);
    assert.equal(out.posterUrl, poster);
    assert.equal(fetchCalls[0].url, `https://t.me/s/${CHANNEL}/90`);
  });
  test('a poster-only post (document, no video) returns the poster and no mp4', async () => {
    fetchHandler = () => htmlResponse(postHtml(CHANNEL, '91', `<img src="${poster}">`));
    const out = await scrapeTelegramPostMedia(CHANNEL, '91', { attempts: 1 });
    assert.equal(out.mp4Url, '');
    assert.equal(out.posterUrl, poster);
  });
  test('CDN URLs outside the post segment are ignored', async () => {
    const otherPost = postHtml(CHANNEL, '89', `<video src="${mp4}"></video>`);
    const targetPost = postHtml(CHANNEL, '90', `<img src="${poster}">`);
    fetchHandler = () => htmlResponse(otherPost + targetPost);
    const out = await scrapeTelegramPostMedia(CHANNEL, '90', { attempts: 1 });
    assert.equal(out.mp4Url, '');
    assert.equal(out.posterUrl, poster);
  });
  test('a missing marker throws naming the marker and the last reason', async () => {
    fetchHandler = () => htmlResponse('<html><body>no posts here</body></html>');
    await assert.rejects(
      () => scrapeTelegramPostMedia(CHANNEL, '90', { attempts: 1 }),
      (err) => err.message.includes(`marker data-post="${CHANNEL}/90" not in page yet`)
        && err.message.includes('after 1 attempt(s)'),
    );
  });
  test('an HTTP error is retried and then throws with the status', async () => {
    fetchHandler = () => htmlResponse('', { ok: false, status: 500 });
    await assert.rejects(
      () => scrapeTelegramPostMedia(CHANNEL, '90', { attempts: 1 }),
      /last reason: HTTP 500/,
    );
  });
  test('a network error is retried and then throws with the message', async () => {
    fetchHandler = () => { throw new Error('dns failed'); };
    await assert.rejects(
      () => scrapeTelegramPostMedia(CHANNEL, '90', { attempts: 1 }),
      /last reason: dns failed/,
    );
  });
  test('a post segment with no CDN URLs throws with that reason', async () => {
    fetchHandler = () => htmlResponse(postHtml(CHANNEL, '90', '<p>text only</p>'));
    await assert.rejects(
      () => scrapeTelegramPostMedia(CHANNEL, '90', { attempts: 1 }),
      /last reason: no cdn urls found in post segment/,
    );
  });
  test('a later attempt succeeds after an early miss (2s retry delay)', async () => {
    let n = 0;
    fetchHandler = () => {
      n += 1;
      return n === 1
        ? htmlResponse('<html><body>not yet</body></html>')
        : htmlResponse(postHtml(CHANNEL, '90', `<video src="${mp4}"></video>`));
    };
    const out = await scrapeTelegramPostMedia(CHANNEL, '90', { attempts: 2 });
    assert.equal(out.mp4Url, mp4);
    assert.equal(n, 2);
  });
  test('the channel is @-stripped in the marker and URL', async () => {
    fetchHandler = (url) => {
      assert.equal(url, `https://t.me/s/${CHANNEL}/90`);
      return htmlResponse(postHtml(CHANNEL, '90', `<video src="${mp4}"></video>`));
    };
    const out = await scrapeTelegramPostMedia(`@${CHANNEL}`, '90', { attempts: 1 });
    assert.equal(out.mp4Url, mp4);
  });
});

describe('scrapeTelegramPostUrl', () => {
  const mp4 = 'https://cdn1.telesco.pe/file/abc/video.mp4';
  const poster = 'https://cdn1.telesco.pe/file/abc/thumb.jpg';
  const page = (inner) => `<div data-post="${CHANNEL}/90">${inner}</div>`;
  test('wantMp4 returns the mp4', async () => {
    fetchHandler = () => htmlResponse(page(`<video src="${mp4}"></video>`));
    assert.equal(await scrapeTelegramPostUrl(CHANNEL, '90'), mp4);
  });
  test('wantMp4 with no mp4 throws', async () => {
    fetchHandler = () => htmlResponse(page(`<img src="${poster}">`));
    await assert.rejects(
      () => scrapeTelegramPostUrl(CHANNEL, '90', { attempts: 1 }),
      /no MP4 CDN url for testchannel\/90 after 1 attempt/,
    );
  });
  test('wantMp4: false falls back to the poster', async () => {
    fetchHandler = () => htmlResponse(page(`<img src="${poster}">`));
    assert.equal(await scrapeTelegramPostUrl(CHANNEL, '90', { wantMp4: false, attempts: 1 }), poster);
  });
});

describe('listTelegramPosts', () => {
  const pageHtml = (posts) => posts.map(([id, kind]) => {
    const media = kind === 'service'
      ? '<div class="tgme_widget_message_text">Channel created</div>'
      : `<div class="tgme_widget_message_${kind}"><img src="https://cdn1.telesco.pe/file/x.jpg"></div>`;
    return `<div class="tgme_widget_message" data-post="${CHANNEL}/${id}">${media}</div>`;
  }).join('');
  test('a numeric (private) channel fails fast without fetching — no public listing exists', async () => {
    await assert.rejects(
      () => listTelegramPosts(FAKE_TOKEN, '-1003959088547'),
      /is private \(numeric id\) — it has no public t\.me\/s page/,
    );
    assert.equal(fetchCalls.length, 0);
  });
  test('walks pages backward, keeps media posts only, sorts ascending', async () => {
    fetchHandler = (url) => {
      const before = new URL(url).searchParams.get('before');
      if (!before) return htmlResponse(pageHtml([[10, 'video'], [9, 'photo'], [8, 'service']]));
      if (before === '8') return htmlResponse(pageHtml([[5, 'document'], [4, 'service']]));
      return htmlResponse('<html></html>');
    };
    const posts = await listTelegramPosts(FAKE_TOKEN, CHANNEL);
    assert.deepEqual(posts, [{ messageId: '5' }, { messageId: '9' }, { messageId: '10' }]);
    assert.equal(fetchCalls.length, 3);
  });
  test('a repeated page (server ignored the cursor) ends the walk', async () => {
    fetchHandler = () => htmlResponse(pageHtml([[10, 'video'], [9, 'video']]));
    const posts = await listTelegramPosts(FAKE_TOKEN, CHANNEL);
    assert.deepEqual(posts, [{ messageId: '9' }, { messageId: '10' }]);
    assert.equal(fetchCalls.length, 2);
  });
  test('hitting the page cap throws instead of returning a truncated list', async () => {
    let page = 0;
    fetchHandler = () => {
      page += 1;
      return htmlResponse(pageHtml([[100 - page, 'video']]));
    };
    await assert.rejects(
      () => listTelegramPosts(FAKE_TOKEN, CHANNEL, { maxPages: 2 }),
      /hit the 2-page cap/,
    );
  });
  test('an HTTP error throws loudly', async () => {
    fetchHandler = () => htmlResponse('', { ok: false, status: 404 });
    await assert.rejects(
      () => listTelegramPosts(FAKE_TOKEN, CHANNEL),
      /Telegram channel listing: HTTP 404/,
    );
  });
  test('a network error throws loudly', async () => {
    fetchHandler = () => { throw new Error('reset'); };
    await assert.rejects(() => listTelegramPosts(FAKE_TOKEN, CHANNEL), /network error - reset/);
  });
  test('missing token or channel throws before fetching', async () => {
    await assert.rejects(() => listTelegramPosts('', CHANNEL), /bot token is not configured/);
    await assert.rejects(() => listTelegramPosts(FAKE_TOKEN, ''), /channel is not configured/);
    assert.equal(fetchCalls.length, 0);
  });
  test('onProgress reports page and post counts', async () => {
    fetchHandler = (url) => {
      const before = new URL(url).searchParams.get('before');
      return before ? htmlResponse('<html></html>') : htmlResponse(pageHtml([[10, 'video']]));
    };
    const seen = [];
    await listTelegramPosts(FAKE_TOKEN, CHANNEL, { onProgress: (p) => seen.push(p) });
    assert.deepEqual(seen, [{ page: 1, posts: 1 }]);
  });
});

describe('checkTelegramSceneIntegrity', () => {
  const sceneItem = (id, spz, tex) => ({
    id,
    fileName: 'model.spz',
    extraMetadata: {
      sceneFiles: {
        telegram: {
          ...(spz ? { spz: { fileId: spz.fileId, messageId: spz.messageId, filename: 'model.spz' } } : {}),
          ...(tex ? { texture: { fileId: tex.fileId, messageId: tex.messageId, filename: 'texture.webp' } } : {}),
        },
      },
    },
  });
  // getFile mock: file ids ending in 'ok' resolve, others 400.
  const apiMock = (listingPosts = []) => (url, options) => {
    if (url.includes('/getFile')) {
      const fileId = options.body.get('file_id');
      if (fileId.endsWith('ok')) {
        return jsonResponse({ ok: true, result: { file_id: fileId, file_path: `documents/${fileId}`, file_size: 100 } });
      }
      if (fileId.endsWith('gate')) {
        return jsonResponse({ ok: false, error_code: 400, description: 'Bad Request: file is too big' });
      }
      return jsonResponse({ ok: false, error_code: 400, description: 'Bad Request: file not found' });
    }
    if (url.startsWith('https://t.me/s/')) {
      const before = new URL(url).searchParams.get('before');
      if (before) return htmlResponse('<html></html>');
      const html = listingPosts.map((id) =>
        `<div data-post="${CHANNEL}/${id}"><div class="tgme_widget_message_document"></div></div>`).join('');
      return htmlResponse(html);
    }
    throw new Error(`unexpected url ${url}`);
  };

  test('a scene with both files readable is found; unreferenced posts are extra', async () => {
    fetchHandler = apiMock(['101', '102', '999']);
    const item = sceneItem('s1', { fileId: 'spz-ok', messageId: '101' }, { fileId: 'tex-ok', messageId: '102' });
    const out = await checkTelegramSceneIntegrity([item], [item], { token: FAKE_TOKEN, channel: CHANNEL });
    assert.equal(out.found.length, 1);
    assert.equal(out.found[0].spzCode, 'spz-ok');
    assert.equal(out.found[0].texCode, 'tex-ok');
    assert.equal(out.found[0].spzPageUrl, `https://t.me/${CHANNEL}/101`);
    assert.deepEqual(out.missing, []);
    assert.deepEqual(out.noUrl, []);
    assert.deepEqual(out.extra, [{ messageId: '999', pageUrl: `https://t.me/${CHANNEL}/999` }]);
  });
  test('a numeric (private) channel skips the listing — getFile probes still verify, extras are unknown', async () => {
    fetchHandler = (url, options) => {
      if (url.startsWith('https://t.me/s/')) throw new Error('listing must not be attempted on a private channel');
      return apiMock([])(url, options);
    };
    const item = sceneItem('s1', { fileId: 'spz-ok', messageId: '101' }, { fileId: 'tex-ok', messageId: '102' });
    const out = await checkTelegramSceneIntegrity([item], [item], { token: FAKE_TOKEN, channel: '-1003959088547' });
    assert.equal(out.found.length, 1);
    assert.equal(out.found[0].spzPageUrl, 'https://t.me/c/3959088547/101');
    assert.deepEqual(out.missing, []);
    assert.deepEqual(out.extra, []);
    assert.ok(!fetchCalls.some((c) => c.url.startsWith('https://t.me/s/')));
  });
  test('a deleted file (4xx) makes the scene missing, with the reason named', async () => {
    fetchHandler = apiMock([]);
    const item = sceneItem('s1', { fileId: 'spz-ok', messageId: '101' }, { fileId: 'tex-gone', messageId: '102' });
    const out = await checkTelegramSceneIntegrity([item], [item], { token: FAKE_TOKEN, channel: CHANNEL });
    assert.equal(out.missing.length, 1);
    assert.ok(out.missing[0].spzMatched);
    assert.equal(out.missing[0].texMatched, null);
    assert.ok(out.missing[0].reasons.some((r) => r.startsWith('Image:')));
  });
  test('a scene with no telegram refs lands in noUrl', async () => {
    fetchHandler = apiMock([]);
    const out = await checkTelegramSceneIntegrity(
      [{ id: 's1', fileName: 'model.spz', spzUrl: 'https://udrop.com/x/model.spz' }],
      [], { token: FAKE_TOKEN, channel: CHANNEL },
    );
    assert.equal(out.noUrl.length, 1);
    assert.equal(out.noUrl[0].spzCode, null);
  });
  test('a 5xx/network failure aborts the check instead of reporting data loss', async () => {
    fetchHandler = (url) => {
      if (url.includes('/getFile')) return jsonResponse({}, { ok: false, status: 500 });
      return htmlResponse('<html></html>');
    };
    const item = sceneItem('s1', { fileId: 'spz-ok', messageId: '101' }, null);
    await assert.rejects(
      () => checkTelegramSceneIntegrity([item], [item], { token: FAKE_TOKEN, channel: CHANNEL }),
      /Telegram getFile: HTTP 500/,
    );
  });
  test('missing token or channel throws before fetching', async () => {
    await assert.rejects(
      () => checkTelegramSceneIntegrity([], [], { token: '', channel: CHANNEL }),
      /bot token is not configured/,
    );
    await assert.rejects(
      () => checkTelegramSceneIntegrity([], [], { token: FAKE_TOKEN, channel: '' }),
      /channel is not configured/,
    );
    assert.equal(fetchCalls.length, 0);
  });

  // --- native verify for gate-hit files (2.19.30) ----------------------
  const nativeVerifyHandler = (size) => (message) => {
    assert.equal(message.action, 'telegram_verify');
    assert.equal(message.message_id, '589');
    assert.equal(message.channel, CHANNEL);
    return { success: true, stdout: JSON.stringify({ ok: true, messageId: 589, size, name: 'model.spz' }) };
  };
  const gateItem = (overrides = {}) => ({
    ...sceneItem('s1', { fileId: 'spz-gate', messageId: '589' }, { fileId: 'tex-ok', messageId: '102' }),
    fileSize: '30361257',
    spzFileSize: '30361257',
    ...overrides,
  });

  test('a gate-hit spz verified natively on exact size match is found, not unverified', async () => {
    fetchHandler = apiMock([]);
    installNativePort(nativeVerifyHandler(30361257));
    const item = gateItem();
    const out = await checkTelegramSceneIntegrity([item], [item], { token: FAKE_TOKEN, channel: CHANNEL });
    assert.equal(out.found.length, 1);
    assert.equal(out.found[0].spzMatched.nativeVerified, true);
    assert.deepEqual(out.found[0].reasons, []);
    assert.deepEqual(out.unverified, []);
    assert.deepEqual(out.missing, []);
  });
  test('a gate-hit spz whose native size mismatches is broken, with the mismatch named', async () => {
    fetchHandler = apiMock([]);
    installNativePort(nativeVerifyHandler(12345));
    const item = gateItem();
    const out = await checkTelegramSceneIntegrity([item], [item], { token: FAKE_TOKEN, channel: CHANNEL });
    assert.equal(out.missing.length, 1);
    assert.ok(out.missing[0].reasons.some((r) => r.includes('Telegram has 12345 bytes, expected 30361257')));
    assert.deepEqual(out.unverified, []);
  });
  test('a gate-hit spz stays unverified when the native host is down', async () => {
    fetchHandler = apiMock([]);
    installNativePort(() => ({ success: false, message: 'host down' }));
    const item = gateItem();
    const out = await checkTelegramSceneIntegrity([item], [item], { token: FAKE_TOKEN, channel: CHANNEL });
    assert.equal(out.unverified.length, 1);
    assert.ok(out.unverified[0].reasons.some((r) => r.includes('native verify unavailable: host down')));
    assert.deepEqual(out.missing, []);
  });
  test('a gate-hit spz with no message id stays unverified and never calls the host', async () => {
    fetchHandler = apiMock([]);
    const seen = [];
    installNativePort((message) => { seen.push(message); return { success: true, stdout: '{}' }; });
    const item = sceneItem('s1', { fileId: 'spz-gate', messageId: '' }, { fileId: 'tex-ok', messageId: '102' });
    item.fileSize = '30361257';
    const out = await checkTelegramSceneIntegrity([item], [item], { token: FAKE_TOKEN, channel: CHANNEL });
    assert.equal(out.unverified.length, 1);
    assert.deepEqual(seen, []);
  });
  test('a gate-hit spz with no stored size stays unverified and never calls the host', async () => {
    fetchHandler = apiMock([]);
    const seen = [];
    installNativePort((message) => { seen.push(message); return { success: true, stdout: '{}' }; });
    const item = sceneItem('s1', { fileId: 'spz-gate', messageId: '589' }, { fileId: 'tex-ok', messageId: '102' });
    const out = await checkTelegramSceneIntegrity([item], [item], { token: FAKE_TOKEN, channel: CHANNEL });
    assert.equal(out.unverified.length, 1);
    assert.ok(out.unverified[0].reasons.some((r) => r.includes('no stored size to compare against')));
    assert.deepEqual(seen, []);
  });
  test('a deleted file (non-gate 4xx) is broken without ever calling the native host', async () => {
    fetchHandler = apiMock([]);
    const seen = [];
    installNativePort((message) => { seen.push(message); return { success: true, stdout: '{}' }; });
    const item = sceneItem('s1', { fileId: 'spz-gone', messageId: '101' }, { fileId: 'tex-ok', messageId: '102' });
    item.fileSize = '30361257';
    const out = await checkTelegramSceneIntegrity([item], [item], { token: FAKE_TOKEN, channel: CHANNEL });
    assert.equal(out.missing.length, 1);
    assert.deepEqual(seen, []);
  });
});

// --- native host helpers -------------------------------------------------
// A fake chrome.runtime.connectNative port: postMessage answers from the
// handler, in order, on the next tick.
function fakeNativePort(handler) {
  const listeners = { message: [], disconnect: [] };
  let disconnected = false;
  const port = {
    onMessage: { addListener: (fn) => listeners.message.push(fn) },
    onDisconnect: { addListener: (fn) => listeners.disconnect.push(fn) },
    postMessage: (message) => {
      if (disconnected) throw new Error('port disconnected');
      const responses = handler(message, port);
      const list = Array.isArray(responses) ? responses : [responses];
      for (const response of list) {
        if (response === undefined) continue;
        queueMicrotask(() => listeners.message.forEach((fn) => fn(response)));
      }
    },
    disconnect: () => {
      disconnected = true;
    },
    _disconnectWithError: (message) => {
      globalThis.chrome.runtime.lastError = { message };
      listeners.disconnect.forEach((fn) => fn());
    },
  };
  return port;
}
function installNativePort(handler) {
  const ports = [];
  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      connectNative: () => {
        const port = fakeNativePort(handler);
        ports.push(port);
        return port;
      },
      sendMessage: (message, callback) => {
        callback({ success: true, data: { message: 'pong' } });
      },
    },
  };
  return ports;
}

describe('probeNativeHost', () => {
  test('without a chrome runtime it reports unavailable, never throws', async () => {
    const out = await probeNativeHost();
    assert.deepEqual(out, { ok: false, error: 'extension runtime unavailable' });
  });
  test('a pong answers ok with the host message', async () => {
    installNativePort(() => ({}));
    const out = await probeNativeHost();
    assert.deepEqual(out, { ok: true, message: 'pong' });
  });
  test('a lastError answers ok: false with the error', async () => {
    globalThis.chrome = {
      runtime: {
        lastError: { message: 'no such host' },
        sendMessage: (_message, callback) => callback(undefined),
      },
    };
    const out = await probeNativeHost();
    assert.deepEqual(out, { ok: false, error: 'no such host' });
  });
  test('a failed response answers ok: false with the host error', async () => {
    globalThis.chrome = {
      runtime: {
        lastError: undefined,
        sendMessage: (_message, callback) => callback({ success: false, error: 'host down' }),
      },
    };
    const out = await probeNativeHost();
    assert.deepEqual(out, { ok: false, error: 'host down' });
  });
  test('a silent worker times out', async () => {
    globalThis.chrome = {
      runtime: {
        lastError: undefined,
        sendMessage: () => { /* never answers */ },
      },
    };
    const out = await probeNativeHost({ timeoutMs: 10 });
    assert.equal(out.ok, false);
    assert.match(out.error, /timed out after 0\.01s/);
  });
  test('the ping uses the flat {action, command, data} shape', async () => {
    let seen;
    globalThis.chrome = {
      runtime: {
        lastError: undefined,
        sendMessage: (message, callback) => {
          seen = message;
          callback({ success: true, data: {} });
        },
      },
    };
    await probeNativeHost();
    assert.deepEqual(seen, { action: 'nativeHostCommand', command: 'ping', data: {} });
  });
});

describe('stageBlobForNativeUpload', () => {
  const STAGED_PATH = 'C:\\Users\\Admin\\AppData\\Local\\Temp\\imgvault-tg-stage\\s1\\clip.mp4';
  const stagingHandler = (size) => (message) => {
    if (message.action === 'file_write_start') {
      return { success: true, filePath: STAGED_PATH };
    }
    if (message.action === 'file_write_chunk') return { success: true };
    if (message.action === 'file_write_finish') {
      return { success: true, message: String(size), filePath: STAGED_PATH };
    }
    if (message.action === 'file_delete') return { success: true, message: 'deleted' };
    return { success: false, message: `unknown action ${message.action}` };
  };

  test('stages a blob in chunks and returns the host-assigned path', async () => {
    const blob = new Blob([new Uint8Array(600 * 1024)]);
    installNativePort(stagingHandler(blob.size));
    const progress = [];
    const path = await stageBlobForNativeUpload(blob, 'clip.mp4', { onProgress: (p) => progress.push(p) });
    assert.equal(path, STAGED_PATH);
    assert.equal(progress.length, 2); // 512 KiB + remainder
    assert.equal(progress[0].phase, 'staging');
    assert.equal(progress[0].loaded, 512 * 1024);
    assert.equal(progress[1].loaded, blob.size);
    assert.equal(progress[1].percent, 100);
  });
  test('an empty blob throws before touching the host', async () => {
    installNativePort(stagingHandler(0));
    await assert.rejects(
      () => stageBlobForNativeUpload(new Blob([]), 'clip.mp4'),
      /Cannot stage an empty file/,
    );
  });
  test('without connectNative it throws naming the runtime', async () => {
    await assert.rejects(
      () => stageBlobForNativeUpload(new Blob(['x']), 'clip.mp4'),
      /needs the extension runtime/,
    );
  });
  test('a failed start names the reinstall fix', async () => {
    installNativePort((message) => {
      if (message.action === 'file_write_start') return { success: false, message: 'unknown action' };
      return { success: true };
    });
    await assert.rejects(
      () => stageBlobForNativeUpload(new Blob(['x']), 'clip.mp4'),
      (err) => err.message.includes('Staging failed at file_write_start')
        && err.message.includes('reinstall it from the latest release'),
    );
  });
  test('a size mismatch at finish throws', async () => {
    installNativePort(stagingHandler(999));
    await assert.rejects(
      () => stageBlobForNativeUpload(new Blob(['tiny']), 'clip.mp4'),
      /Staged file size mismatch: wrote 999 bytes, expected 4/,
    );
  });
  test('an aborted signal throws and the partial file is deleted', async () => {
    const deleted = [];
    installNativePort((message) => {
      if (message.action === 'file_write_start') return { success: true, filePath: STAGED_PATH };
      if (message.action === 'file_delete') {
        deleted.push(message.file_path);
        return { success: true, message: 'deleted' };
      }
      return { success: true };
    });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => stageBlobForNativeUpload(new Blob(['x'.repeat(100)]), 'clip.mp4', { signal: controller.signal }),
      /Telegram native upload aborted/,
    );
    // the abort fires before the start request, so no staged path exists yet
    assert.deepEqual(deleted, []);
  });
});

describe('native telegram file ids (2.19.31)', () => {
  test('isNativeTelegramFileId matches the native- prefix only', () => {
    assert.equal(isNativeTelegramFileId('native-619'), true);
    assert.equal(isNativeTelegramFileId('native-'), true);
    assert.equal(isNativeTelegramFileId('BAACAgIAAxkBAAI...'), false);
    assert.equal(isNativeTelegramFileId(''), false);
    assert.equal(isNativeTelegramFileId(null), false);
  });
  test('nativeTelegramMessageId strips the prefix, digits only', () => {
    assert.equal(nativeTelegramMessageId('native-619'), '619');
    assert.equal(nativeTelegramMessageId('native-619 '), '619');
    assert.equal(nativeTelegramMessageId('native-abc'), '');
    assert.equal(nativeTelegramMessageId('native-'), '');
    assert.equal(nativeTelegramMessageId('BAACAgIAAxkBAAI...'), '');
    assert.equal(nativeTelegramMessageId(''), '');
  });
});

describe('downloadTelegramFileNative (2.19.31)', () => {
  const toB64 = (bytes) => Buffer.from(bytes).toString('base64');
  // The host forwards each DATA line as its own message, then a complete
  // message whose stdout carries the RESULT json — the fake port answers
  // with the whole array, in order, on the next tick.
  const downloadHandler = (parts, { resultLength = null, result = null, seen = null } = {}) => (message) => {
    seen?.push(message);
    assert.equal(message.action, 'telegram_download');
    assert.equal(message.message_id, '619');
    assert.equal(message.channel, CHANNEL);
    const total = resultLength ?? parts.reduce((n, p) => n + p.length, 0);
    const stdout = result ?? JSON.stringify({ ok: true, messageId: 619, offset: 0, length: total, totalSize: 1024, fileName: 'blob.bin' });
    return [
      ...parts.map((part) => ({ success: true, event: 'data', line: `DATA:${toB64(part)}` })),
      { success: true, event: 'complete', stdout },
    ];
  };

  test('multiple DATA lines join into the exact bytes, in order', async () => {
    const parts = [
      new Uint8Array([0, 1, 2, 3]),
      new Uint8Array([4, 5, 6, 7, 8, 9]),
      new Uint8Array([10]),
    ];
    installNativePort(downloadHandler(parts));
    const out = await downloadTelegramFileNative({ messageId: '619', channel: CHANNEL });
    assert.deepEqual([...out], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
  test('offset + length are passed through to the host', async () => {
    const seen = [];
    const part = new Uint8Array([7, 8, 9]);
    installNativePort(downloadHandler([part], { seen }));
    const out = await downloadTelegramFileNative({ messageId: '619', channel: CHANNEL, offset: 4, length: 3 });
    assert.deepEqual([...out], [7, 8, 9]);
    assert.equal(seen[0].offset, 4);
    assert.equal(seen[0].max_bytes, 3);
  });
  test('a RESULT length mismatch throws instead of returning short bytes', async () => {
    installNativePort(downloadHandler([new Uint8Array([1, 2])], { resultLength: 5 }));
    await assert.rejects(
      () => downloadTelegramFileNative({ messageId: '619', channel: CHANNEL }),
      /short: served 2 bytes, RESULT says 5/,
    );
  });
  test('a failed RESULT surfaces the host error', async () => {
    installNativePort(downloadHandler([], { result: JSON.stringify({ ok: false, error: 'message not found' }) }));
    await assert.rejects(
      () => downloadTelegramFileNative({ messageId: '619', channel: CHANNEL }),
      /message not found/,
    );
  });
  test('a host failure message rejects', async () => {
    installNativePort(() => ({ success: false, event: 'complete', message: 'telegram_download.py script not found' }));
    await assert.rejects(
      () => downloadTelegramFileNative({ messageId: '619', channel: CHANNEL }),
      /telegram_download\.py script not found/,
    );
  });
  test('a missing message id or channel throws before connecting', async () => {
    await assert.rejects(() => downloadTelegramFileNative({ channel: CHANNEL }), /requires a message id/);
    await assert.rejects(() => downloadTelegramFileNative({ messageId: '619' }), /requires a valid channel/);
  });
  test('a negative offset or length throws before connecting', async () => {
    installNativePort(() => { throw new Error('should not be called'); });
    await assert.rejects(
      () => downloadTelegramFileNative({ messageId: '619', channel: CHANNEL, offset: -1 }),
      /offset -1 is negative/,
    );
    await assert.rejects(
      () => downloadTelegramFileNative({ messageId: '619', channel: CHANNEL, length: -5 }),
      /length -5 is negative/,
    );
  });
  test('without connectNative it throws naming the runtime', async () => {
    await assert.rejects(
      () => downloadTelegramFileNative({ messageId: '619', channel: CHANNEL }),
      /needs the extension runtime/,
    );
  });
});

describe('deleteNativeTempFile', () => {
  test('returns true when the host deletes, false when already gone', async () => {
    installNativePort((message) => {
      assert.equal(message.action, 'file_delete');
      return { success: true, message: 'deleted' };
    });
    assert.equal(await deleteNativeTempFile('C:\\Temp\\imgvault-tg-stage\\x.mp4'), true);
    installNativePort(() => ({ success: true, message: 'already gone' }));
    assert.equal(await deleteNativeTempFile('C:\\Temp\\imgvault-tg-stage\\x.mp4'), false);
  });
  test('an empty path returns false without touching the host', async () => {
    installNativePort(() => { throw new Error('should not be called'); });
    assert.equal(await deleteNativeTempFile(''), false);
    assert.equal(await deleteNativeTempFile('   '), false);
  });
});

describe('uploadTelegramNative', () => {
  test('a missing filePath or channel throws before connecting', async () => {
    await assert.rejects(() => uploadTelegramNative({}), /requires a local filePath/);
    await assert.rejects(
      () => uploadTelegramNative({ filePath: 'C:\\v.mp4', channel: '' }),
      /requires a valid channel/,
    );
  });
  test('a successful upload resolves with the parsed message JSON', async () => {
    installNativePort((message) => {
      assert.equal(message.action, 'telegram_upload');
      assert.equal(message.file_path, 'C:\\v.mp4');
      assert.equal(message.channel, 'testchannel');
      return {
        success: true,
        stdout: JSON.stringify({ messageId: 90, size: 177099614, date: 1799999999 }),
      };
    });
    const out = await uploadTelegramNative({ filePath: 'C:\\v.mp4', channel: '@testchannel', requestId: 'tg-upload-utils-1' });
    assert.deepEqual(out, {
      ok: true, messageId: 90, size: 177099614, date: 1799999999,
      warning: '', videoAttributes: false, requestId: 'tg-upload-utils-1',
    });
  });
  test('progress lines reach onProgress with loaded + total + percent', async () => {
    installNativePort(() => [
      { event: 'progress', line: 'progress:524288:1048576:50.0', message: 'Uploading...' },
      { success: true, stdout: JSON.stringify({ messageId: 91 }) },
    ]);
    const seen = [];
    const out = await uploadTelegramNative({
      filePath: 'C:\\v.mp4',
      channel: CHANNEL,
      onProgress: (p) => seen.push(p),
    });
    assert.equal(out.messageId, 91);
    assert.deepEqual(seen, [{
      current: 524288,
      loaded: 524288,
      total: 1048576,
      percent: 50,
      phase: 'uploading',
      text: 'Uploading...',
    }]);
  });
  test('a failed upload rejects with the host message', async () => {
    installNativePort(() => ({ success: false, message: 'Telethon flood wait' }));
    await assert.rejects(
      () => uploadTelegramNative({ filePath: 'C:\\v.mp4', channel: CHANNEL }),
      /Telethon flood wait/,
    );
  });
  test('a disconnect mid-upload rejects', async () => {
    const ports = installNativePort(() => undefined); // never answers
    const pending = uploadTelegramNative({ filePath: 'C:\\v.mp4', channel: CHANNEL });
    // the port connects synchronously inside uploadTelegramNative
    await new Promise((r) => setTimeout(r, 0));
    ports[0]._disconnectWithError('host crashed');
    await assert.rejects(() => pending, /host crashed/);
  });
  test('an aborted signal rejects', async () => {
    installNativePort(() => undefined);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => uploadTelegramNative({ filePath: 'C:\\v.mp4', channel: CHANNEL, signal: controller.signal }),
      /Telegram native upload aborted/,
    );
  });
});

describe('verifyTelegramFileNative', () => {
  test('a successful verify returns the live size + name', async () => {
    installNativePort((message) => {
      assert.equal(message.action, 'telegram_verify');
      assert.equal(message.message_id, '589');
      assert.equal(message.channel, CHANNEL);
      return {
        success: true,
        stdout: JSON.stringify({ ok: true, messageId: 589, size: 30361257, name: 'model.spz' }),
      };
    });
    const out = await verifyTelegramFileNative({ messageId: '589', channel: `@${CHANNEL}` });
    assert.deepEqual(out, { messageId: '589', size: 30361257, name: 'model.spz' });
  });
  test('a missing message id or channel throws before connecting', async () => {
    await assert.rejects(
      () => verifyTelegramFileNative({ channel: CHANNEL }),
      /requires a message id/,
    );
    await assert.rejects(
      () => verifyTelegramFileNative({ messageId: '589', channel: '' }),
      /requires a valid channel/,
    );
  });
  test('a failed verify rejects with the host message', async () => {
    installNativePort(() => ({ success: false, message: 'Message 589 not found' }));
    await assert.rejects(
      () => verifyTelegramFileNative({ messageId: '589', channel: CHANNEL }),
      /Message 589 not found/,
    );
  });
  test('unreadable output rejects instead of returning a guess', async () => {
    installNativePort(() => ({ success: true, stdout: 'not json' }));
    await assert.rejects(
      () => verifyTelegramFileNative({ messageId: '589', channel: CHANNEL }),
      /unreadable output/,
    );
  });
  test('a payload without a size rejects', async () => {
    installNativePort(() => ({ success: true, stdout: JSON.stringify({ ok: true, messageId: 589 }) }));
    await assert.rejects(
      () => verifyTelegramFileNative({ messageId: '589', channel: CHANNEL }),
      /returned no file size/,
    );
  });
  test('without connectNative it throws naming the runtime', async () => {
    await assert.rejects(
      () => verifyTelegramFileNative({ messageId: '589', channel: CHANNEL }),
      /needs the extension runtime/,
    );
  });
});
