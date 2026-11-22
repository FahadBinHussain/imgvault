// node:test suite for the Telegram uploader's result shaping
// (TelegramUploader.buildProviderResult in src/utils/uploaders.js) and the
// private-channel upload behavior (2.19.24).
//
// IMPORT ORDER MATTERS HERE. uploaders.js cannot be imported directly in
// plain node: it pulls in teraBoxApi -> videoProviderLinks ->
// config/providerCatalog -> uploaders (the cycle), and the direct import
// dies with "Cannot access 'FilemoonUploader' before initialization".
// Importing config/providerCatalog.js FIRST breaks the cycle the other
// way — uploaders.js then initializes fully. Do not reorder these imports,
// and do not "simplify" them into source-text pins: the behavior tests
// below are the point.
import '../src/config/providerCatalog.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TelegramUploader } from '../src/utils/uploaders.js';
import { getConfiguredAudioUploadServices } from '../src/config/providerCatalog.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const uploader = new TelegramUploader();

describe('TelegramUploader.buildProviderResult — documents', () => {
  test('a sendDocument result keeps the file_id and serves bytes through the platform-local route', () => {
    const out = uploader.buildProviderResult({
      message: { message_id: 5, document: { file_id: 'BQADx', mime_type: 'image/webp', file_name: 'a.webp' } },
      channel: 'mychannel',
      filename: 'a.webp',
      method: 'sendDocument',
    });
    assert.equal(out.fileId, 'BQADx');
    assert.equal(out.messageId, '5');
    assert.equal(out.url, '/telegram-media/BQADx?mt=image%2Fwebp');
    assert.equal(out.directUrl, '/telegram-media/BQADx?mt=image%2Fwebp');
    assert.equal(out.watchUrl, 'https://t.me/mychannel/5');
    assert.equal(out.apiStatus, 'success');
  });
  test('a sendDocument result on a numeric (private) channel links the post as t.me/c', () => {
    const out = uploader.buildProviderResult({
      message: { message_id: 90, document: { file_id: 'BQADy', mime_type: 'video/mp4', file_name: 'clip.mp4' } },
      channel: '-1003959088547',
      filename: 'clip.mp4',
      method: 'sendDocument',
    });
    assert.equal(out.watchUrl, 'https://t.me/c/3959088547/90');
    assert.equal(out.displayUrl, 'https://t.me/c/3959088547/90');
  });
  test('a message with no file_id throws naming the method and the message', () => {
    assert.throws(
      () => uploader.buildProviderResult({
        message: { message_id: 7 },
        channel: 'mychannel',
        filename: 'x.bin',
        method: 'sendDocument',
      }),
      /Telegram: sendDocument returned no file_id \(message 7\)/,
    );
  });
  test('a message carrying BOTH document and sticker reads the document (document wins)', () => {
    const out = uploader.buildProviderResult({
      message: {
        message_id: 8,
        document: { file_id: 'BQADdoc', mime_type: 'image/webp' },
        sticker: { file_id: 'CAADstk', mime_type: 'image/webp' },
      },
      channel: 'mychannel',
      filename: 'a.webp',
      method: 'sendDocument',
    });
    assert.equal(out.fileId, 'BQADdoc');
  });
});

// FIXED in 2.19.27. Telegram classifies webp uploads sent via Bot API
// sendDocument as STICKERS: the response carries result.sticker, not
// result.document. buildProviderResult used to read ONLY message[field]
// (field = 'document' for sendDocument), so a webp image upload threw
// "returned no file_id" even though the post landed — the message was on
// the channel, the extension recorded a failure, and a retry posted a
// DUPLICATE (proven live 2026-11-19: two webp images posted twice, msgs
// 468/469 orphans + 472/473 recorded). It now falls back to
// message.sticker when message.document is absent (document still wins
// when both are present).
test('2.19.27 (2026-11-20): a sendDocument response carrying ONLY a sticker (webp) must yield its file_id', () => {
  const out = uploader.buildProviderResult({
    message: {
      message_id: 472,
      sticker: { file_id: 'CAADBQADYCAAAiqqAAFUe1ZHWlBjG6EC', mime_type: 'image/webp', file_name: 'wp15140068.webp' },
    },
    channel: '-1003959088547',
    filename: 'wp15140068.webp',
    method: 'sendDocument',
  });
  assert.equal(out.fileId, 'CAADBQADYCAAAiqqAAFUe1ZHWlBjG6EC');
  assert.equal(out.url, '/telegram-media/CAADBQADYCAAAiqqAAFUe1ZHWlBjG6EC?mt=image%2Fwebp');
  assert.equal(out.watchUrl, 'https://t.me/c/3959088547/472');
});

describe('TelegramUploader.buildProviderResult — videos + private channels (2.19.24)', () => {
  const videoMessage = (id) => ({
    message_id: id,
    video: { file_id: 'BAADv', mime_type: 'video/mp4', file_name: 'clip.mp4' },
  });
  test('a sendVideo result with a scraped CDN url uses it as the direct link', () => {
    const out = uploader.buildProviderResult({
      message: videoMessage(10),
      channel: 'mychannel',
      filename: 'clip.mp4',
      method: 'sendVideo',
      cdnUrl: 'https://cdn1.telesco.pe/file.mp4',
      posterUrl: 'https://cdn1.telesco.pe/poster.jpg',
    });
    assert.equal(out.directUrl, 'https://cdn1.telesco.pe/file.mp4');
    assert.equal(out.thumbUrl, 'https://cdn1.telesco.pe/poster.jpg');
    assert.equal(out.watchUrl, 'https://t.me/mychannel/10');
  });
  test('a sendVideo result with NO CDN url on a PUBLIC channel refuses to store a half-resolved link', () => {
    assert.throws(
      () => uploader.buildProviderResult({
        message: videoMessage(11),
        channel: 'mychannel',
        filename: 'clip.mp4',
        method: 'sendVideo',
      }),
      /has no CDN url - refusing to store a half-resolved link/,
    );
  });
  test('a sendVideo result with NO CDN url on a PRIVATE channel stores the watchUrl as the direct link and says so', () => {
    const out = uploader.buildProviderResult({
      message: videoMessage(12),
      channel: '-1003959088547',
      filename: 'clip.mp4',
      method: 'sendVideo',
    });
    assert.equal(out.directUrl, 'https://t.me/c/3959088547/12');
    assert.match(out.apiMessage, /Private Telegram channel/);
  });
  test('a bare numeric channel id also gets the t.me/c watchUrl (no -100 needed from the caller)', () => {
    const out = uploader.buildProviderResult({
      message: videoMessage(13),
      channel: '3959088547',
      filename: 'clip.mp4',
      method: 'sendVideo',
    });
    assert.equal(out.watchUrl, 'https://t.me/c/3959088547/13');
    assert.equal(out.directUrl, 'https://t.me/c/3959088547/13');
  });
});

describe('private channels skip the CDN scrape (2.19.24) — wiring pins', () => {
  test('finishUpload skips the scrape on a numeric channel instead of burning 4 doomed attempts', () => {
    const uploaders = src('../src/utils/uploaders.js');
    const fn = uploaders.slice(uploaders.indexOf('async finishUpload'));
    assert.ok(fn.includes('if (isNumericTelegramChannel(channel)) {'));
    assert.ok(fn.includes('no public post page, skipping the CDN scrape (watchUrl is stored instead)'));
  });
  test('the native (>50 MB) upload path also skips the scrape on a numeric channel', () => {
    const uploaders = src('../src/utils/uploaders.js');
    // 2.19.31: the native branch moved into uploadViaNativeHost, shared by
    // upload() and uploadWithProgress() — pin the shared method, not the
    // page-side wrapper (a slice from 'uploadWithProgress' starts at the
    // Filemoon method and proves nothing).
    const fn = uploaders.slice(uploaders.indexOf('async uploadViaNativeHost'));
    assert.ok(fn.includes('isNumericTelegramChannel(channel)'));
    assert.ok(fn.includes('is a private channel — no public post page, skipping the CDN scrape'));
  });
  test('telegram_upload.py maps channel ids the same way as the Bot API chat_id rule', () => {
    const py = src('../../native-host/scripts/telegram_upload.py');
    assert.ok(py.includes('entity = int(f"-100{target}")'), 'bare digits get the -100 prefix');
    assert.ok(py.includes('elif target.startswith("-"):\n        entity = int(target)'), 'an explicit -100 id passes through');
    assert.ok(py.includes('entity = "me"'), '"me" stays "me"');
    assert.ok(py.includes('entity = f"@{clean}"'), 'a username gets the @ prefix');
  });
});

describe('native vault route (2.19.31) — wiring pins', () => {
  test('the native branch is one shared method used by BOTH upload() and uploadWithProgress()', () => {
    const uploaders = src('../src/utils/uploaders.js');
    assert.ok(uploaders.includes('async uploadViaNativeHost('));
    const swUpload = uploaders.slice(
      uploaders.indexOf('async upload(blob, options = {})'),
      uploaders.indexOf('async uploadViaNativeHost'),
    );
    assert.ok(swUpload.includes('uploadViaNativeHost('), 'the SW fetch path routes over-threshold blobs to the native host');
    const pageUpload = uploaders.slice(uploaders.indexOf('async uploadWithProgress(blob, options = {})'));
    assert.ok(pageUpload.includes('uploadViaNativeHost('), 'the page-side path routes over-threshold blobs to the native host');
  });
  test('nativeAboveBytes lowers the native threshold; the default stays 50 MB', () => {
    const uploaders = src('../src/utils/uploaders.js');
    const fn = uploaders.slice(uploaders.indexOf('async upload(blob, options = {})'));
    assert.ok(fn.includes('Number.isFinite(nativeAboveBytes)'));
    assert.ok(fn.includes(': TELEGRAM_UPLOAD_MAX_BYTES'));
    assert.ok(fn.includes('if (size > nativeThreshold)'));
  });
  test('the shared native method stages in-memory blobs and deletes the staged file either way', () => {
    const uploaders = src('../src/utils/uploaders.js');
    const fn = uploaders.slice(uploaders.indexOf('async uploadViaNativeHost'));
    assert.ok(fn.includes('stageBlobForNativeUpload(blob, filename'));
    assert.ok(fn.includes('deleteNativeTempFile(nativePath)'));
    assert.ok(fn.includes("fileId: `native-${messageId}`"));
  });
  test('the native branch skips the CDN scrape for documents (only an mp4 can have one)', () => {
    const uploaders = src('../src/utils/uploaders.js');
    const fn = uploaders.slice(uploaders.indexOf('async uploadViaNativeHost'));
    assert.ok(fn.includes("telegramUploadField(filename, mimeType) === 'video'"));
  });
  test('telegramUploadOptions passes nativeAboveBytes through to the uploader', () => {
    const catalog = src('../src/config/providerCatalog.js');
    assert.ok(catalog.includes('nativeAboveBytes: data.nativeAboveBytes'));
  });
});

describe('getConfiguredAudioUploadServices (2.19.25)', () => {
  test('fully configured settings return udrop + terabox + telegram — never filemoon', () => {
    const out = getConfiguredAudioUploadServices({
      filemoonApiKey: 'k',
      udropKey1: 'a',
      udropKey2: 'b',
      telegramBotToken: 't',
      telegramChannel: 'c',
    });
    assert.deepEqual(out.map((s) => s.key), ['udrop', 'terabox', 'telegram']);
  });
  test('a filemoon key alone configures no audio host except always-on terabox', () => {
    const out = getConfiguredAudioUploadServices({ filemoonApiKey: 'k' });
    assert.deepEqual(out.map((s) => s.key), ['terabox']);
  });
  test('udrop needs BOTH keys to count as configured for audio', () => {
    const out = getConfiguredAudioUploadServices({ udropKey1: 'a' });
    assert.deepEqual(out.map((s) => s.key), ['terabox']);
  });
});

// ------------------------------------------- 2.19.32 native finalize wait ---

// FIXED in 2.19.32. Telethon reports 100% when the LAST PART is sent, but
// the post is not created until Telegram finalizes server-side — observed
// live 2026-11-22 as ~3 silent minutes on a 72 MB vault blob (100% at
// 13:20:54, msg 630 created 13:23:55), which reads as "stuck forever".
// uploadViaNativeHost now fires a LOUD finalizing line once on the first
// 100% event: a console.log line plus a synthetic phase:'finalizing'
// progress event the UI renders. The host can emit the 100% line twice
// (the live log showed it twice) — the line must still fire exactly once.

// Minimal fake native port (same shape as regression-telegram.test.mjs):
// postMessage hands the message to the handler, which emits responses
// over time through port.emit.
class FakeNativePortForUpload {
  constructor(handler) {
    this.handler = handler;
    this.messageListeners = [];
    this.disconnectListeners = [];
    this.disconnected = false;
    this.onMessage = { addListener: (fn) => { this.messageListeners.push(fn); } };
    this.onDisconnect = { addListener: (fn) => { this.disconnectListeners.push(fn); } };
  }
  emit(response) {
    if (this.disconnected) return;
    for (const fn of [...this.messageListeners]) fn(response);
  }
  postMessage(message) {
    this.handler(message, this);
  }
  disconnect() {
    this.disconnected = true;
  }
}

function installChromeForUpload(handler) {
  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      connectNative: () => new FakeNativePortForUpload(handler),
    },
  };
}

function uninstallChromeForUpload() {
  delete globalThis.chrome;
}

// A host that behaves like the live 2026-11-22 run: progress to 100% (the
// 100% line twice, as the live log showed), then a delayed RESULT — the
// server-side finalize gap the finalizing line exists to name.
function delayedNativeUploadHandler({ total = 72000000, messageId = 630, resultDelayMs = 100 } = {}) {
  return (message, port) => {
    if (message.action !== 'telegram_upload') return;
    const progress = (current, percent) => ({
      event: 'progress',
      line: `PROGRESS:${current}:${total}:${percent}`,
      message: `uploading ${percent}%`,
    });
    queueMicrotask(() => port.emit(progress(Math.floor(total / 2), 50)));
    setTimeout(() => port.emit(progress(total, 100)), 5);
    setTimeout(() => port.emit(progress(total, 100)), 10);
    setTimeout(() => port.emit({
      success: true,
      stdout: JSON.stringify({ messageId, size: total, date: '2026-11-22T07:23:55Z' }),
    }), resultDelayMs);
  };
}

describe('TelegramUploader.uploadViaNativeHost — finalizing line (2.19.32)', () => {
  test('a 100% event fires exactly one phase:finalizing progress event — before the delayed result returns', async () => {
    installChromeForUpload(delayedNativeUploadHandler());
    const logLines = [];
    const realLog = console.log;
    console.log = (...args) => { logLines.push(args.join(' ')); };
    const events = [];
    let finalizingSeenAt = 0;
    try {
      const result = await uploader.uploadViaNativeHost(new Blob([new Uint8Array(100)]), {
        channel: '-1003959088547',
        filename: 'x.bin',
        mimeType: 'application/octet-stream',
        filePath: 'C:\\fake\\x.bin',
        onProgress: (event) => {
          events.push(event);
          if (event.phase === 'finalizing' && !finalizingSeenAt) finalizingSeenAt = Date.now();
        },
      });
      const resolvedAt = Date.now();
      assert.equal(result.fileId, 'native-630');
      assert.equal(result.messageId, '630');
      // The 100% line came twice (live behavior) — the finalizing event
      // still fires exactly once, right after the FIRST 100% event.
      const finalizing = events.filter((e) => e.phase === 'finalizing');
      assert.equal(finalizing.length, 1);
      const first100 = events.findIndex((e) => e.percent === 100 && e.phase !== 'finalizing');
      assert.equal(events.indexOf(finalizing[0]), first100 + 1);
      assert.match(finalizing[0].text, /finalize/);
      assert.equal(finalizing[0].percent, 100);
      // The line was emitted while the result was still in flight, not
      // after it — that is the whole point (the wait is named, not silent).
      assert.ok(finalizingSeenAt > 0 && finalizingSeenAt < resolvedAt);
      // Console channel carries both lines: the finalize wait + completion.
      assert.ok(logLines.some((l) => /waiting for Telegram to finalize/.test(l)), `no finalize console line in: ${logLines.join(' | ')}`);
      assert.ok(logLines.some((l) => /native MTProto ok - message 630, fileId native-630/.test(l)), `no completion console line in: ${logLines.join(' | ')}`);
    } finally {
      console.log = realLog;
      uninstallChromeForUpload();
    }
  });

  test('with no onProgress (SW path) the finalizing line still reaches the console', async () => {
    installChromeForUpload(delayedNativeUploadHandler());
    const logLines = [];
    const realLog = console.log;
    console.log = (...args) => { logLines.push(args.join(' ')); };
    try {
      const result = await uploader.uploadViaNativeHost(new Blob([new Uint8Array(100)]), {
        channel: '-1003959088547',
        filename: 'x.bin',
        mimeType: 'application/octet-stream',
        filePath: 'C:\\fake\\x.bin',
      });
      assert.equal(result.fileId, 'native-630');
      assert.ok(logLines.some((l) => /waiting for Telegram to finalize/.test(l)), `no finalize console line in: ${logLines.join(' | ')}`);
      assert.ok(logLines.some((l) => /native MTProto ok - message 630/.test(l)), `no completion console line in: ${logLines.join(' | ')}`);
    } finally {
      console.log = realLog;
      uninstallChromeForUpload();
    }
  });

  test('every gallery progress handler on a telegram-capable path renders the finalizing event', () => {
    const gallery = src('../src/pages/GalleryPage.jsx');
    // Five handlers can receive native Telegram progress: the vault loop,
    // the gallery video upload, the 3D upload, the scene upload, and the
    // video-host retry. A handler that ignores `phase` would print a
    // second bare 100% line instead of naming the finalize wait.
    const branches = gallery.match(/if \(phase === 'finalizing'\) \{/g) || [];
    assert.ok(branches.length >= 5, `expected >= 5 finalizing branches in GalleryPage, found ${branches.length}`);
  });
});
