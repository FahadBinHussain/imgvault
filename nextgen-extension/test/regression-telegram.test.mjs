// Regression tests mined from the ImgVault bug history (AGENTS.md).
// Area: Telegram — native-host MTProto route, staging, scrape, listing.
// Every test pins the exact bug scenario from its AGENTS.md entry; the
// entry (version + date) is named in each test title.
//
// Live tests stub chrome.runtime (sendMessage / connectNative) and fetch;
// no live network, no real credentials. Source-text assertions cover the
// wiring that cannot be imported in plain node (uploaders.js is circular,
// GalleryPage.jsx / background.js are React/worker files).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  probeNativeHost,
  stageBlobForNativeUpload,
  deleteNativeTempFile,
  uploadTelegramNative,
  scrapeTelegramPostMedia,
  listTelegramPosts,
  telegramLocalMediaUrl,
} from '../src/utils/telegramApi.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const STAGED_PATH = 'C:\\Users\\Admin\\AppData\\Local\\Temp\\imgvault-tg-stage\\tg-stage-1\\clip.mp4';

// One native-host port speaking sequential request/response, like the real
// Rust host: each message gets exactly one answer, in order.
class FakeNativePort {
  constructor(handler) {
    this.handler = handler;
    this.messages = [];
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
  fireDisconnect() {
    this.disconnected = true;
    for (const fn of [...this.disconnectListeners]) fn();
  }
  postMessage(message) {
    this.messages.push(message);
    const response = this.handler(message, this);
    if (response !== undefined) queueMicrotask(() => this.emit(response));
  }
  disconnect() {
    this.disconnected = true;
  }
}

function installChrome({ sendMessage, connectNativeHandler } = {}) {
  const ports = [];
  const sent = [];
  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (message, callback) => {
        sent.push(message);
        sendMessage?.(message, callback);
      },
      connectNative: () => {
        const port = new FakeNativePort(connectNativeHandler);
        ports.push(port);
        return port;
      },
    },
  };
  return { ports, sent };
}

function uninstallChrome() {
  delete globalThis.chrome;
}

// A host that answers the staging protocol correctly: start returns the
// staged path, chunks ack, finish echoes the byte count in `message`.
function stagingHandler(totalBytes) {
  return (message) => {
    if (message.action === 'file_write_start') return { success: true, filePath: STAGED_PATH };
    if (message.action === 'file_write_chunk') return { success: true };
    if (message.action === 'file_write_finish') {
      return { success: true, filePath: STAGED_PATH, message: String(totalBytes) };
    }
    if (message.action === 'file_delete') return { success: true, message: 'deleted' };
    return { success: false, message: `unknown action ${message.action}` };
  };
}

// ---------------------------------------------------------------- probe ---

test('2.19.22 (2026-11-18): probeNativeHost sends the FLAT {action, command, data} shape', async () => {
  const { sent } = installChrome({
    sendMessage: (_msg, cb) => cb({ success: true, data: { message: 'pong' } }),
  });
  try {
    const result = await probeNativeHost();
    assert.deepEqual(sent, [{ action: 'nativeHostCommand', command: 'ping', data: {} }]);
    assert.deepEqual(result, { ok: true, message: 'pong' });
  } finally {
    uninstallChrome();
  }
});

test('2.19.22 (2026-11-18): probeNativeHost reports the worker error when the host is unreachable', async () => {
  installChrome({ sendMessage: (_msg, cb) => cb({ success: false, error: 'Native host unreachable' }) });
  try {
    const result = await probeNativeHost();
    assert.equal(result.ok, false);
    assert.match(result.error, /Native host unreachable/);
  } finally {
    uninstallChrome();
  }
});

test('2.19.22 (2026-11-18): probeNativeHost without an extension runtime says so instead of throwing', async () => {
  assert.equal(typeof globalThis.chrome, 'undefined');
  const result = await probeNativeHost();
  assert.deepEqual(result, { ok: false, error: 'extension runtime unavailable' });
});

test('2.19.22 (2026-11-18): probeNativeHost times out loudly when the worker never answers', async () => {
  installChrome({ sendMessage: () => { /* never calls back */ } });
  try {
    const result = await probeNativeHost({ timeoutMs: 30 });
    assert.equal(result.ok, false);
    assert.match(result.error, /timed out after 0\.03s/);
  } finally {
    uninstallChrome();
  }
});

// -------------------------------------------------------------- staging ---

test('2.19.22 (2026-11-18): stageBlobForNativeUpload stages in 512 KiB chunks and returns the host path', async () => {
  const size = 512 * 1024 * 2 + 100000;
  const blob = new Blob([new Uint8Array(size)]);
  const { ports } = installChrome({ connectNativeHandler: stagingHandler(size) });
  try {
    const path = await stageBlobForNativeUpload(blob, 'clip.mp4');
    assert.equal(path, STAGED_PATH);
    const messages = ports[0].messages;
    assert.equal(messages[0].action, 'file_write_start');
    assert.equal(messages[0].output_path, '');
    assert.equal(messages[0].file_name, 'clip.mp4');
    assert.match(messages[0].request_id, /^tg-stage-/);
    const chunks = messages.filter((m) => m.action === 'file_write_chunk');
    assert.equal(chunks.length, 3);
    assert.ok(chunks.every((c) => c.request_id === messages[0].request_id));
    assert.equal(messages.at(-1).action, 'file_write_finish');
    assert.equal(messages.at(-1).request_id, messages[0].request_id);
  } finally {
    uninstallChrome();
  }
});

test('2.19.22 (2026-11-18): staging progress reports phase=staging with loaded/current/total/percent', async () => {
  const size = 512 * 1024 + 10;
  const blob = new Blob([new Uint8Array(size)]);
  installChrome({ connectNativeHandler: stagingHandler(size) });
  const events = [];
  try {
    await stageBlobForNativeUpload(blob, 'clip.mp4', { onProgress: (e) => events.push(e) });
    assert.equal(events.length, 2);
    assert.equal(events[0].phase, 'staging');
    assert.equal(events[0].loaded, 512 * 1024);
    assert.equal(events[0].current, 512 * 1024);
    assert.equal(events[0].total, size);
    assert.equal(events.at(-1).loaded, size);
    assert.equal(events.at(-1).percent, 100);
  } finally {
    uninstallChrome();
  }
});

test('2.19.22 (2026-11-18): staging an empty blob throws instead of sending a zero-byte file', async () => {
  installChrome({ connectNativeHandler: stagingHandler(0) });
  try {
    await assert.rejects(
      () => stageBlobForNativeUpload(new Blob([]), 'empty.mp4'),
      /Cannot stage an empty file/,
    );
  } finally {
    uninstallChrome();
  }
});

test('2.19.22 (2026-11-18): a failed file_write_start names the reinstall fix (old host binary)', async () => {
  installChrome({
    connectNativeHandler: (message) => {
      if (message.action === 'file_write_start') return { success: false, message: 'unknown action' };
      return { success: true };
    },
  });
  try {
    await assert.rejects(
      () => stageBlobForNativeUpload(new Blob([new Uint8Array(10)]), 'clip.mp4'),
      /Staging failed at file_write_start.*reinstall it from the latest release/s,
    );
  } finally {
    uninstallChrome();
  }
});

test('2.19.22 (2026-11-18): a finish size mismatch throws naming wrote vs expected', async () => {
  const size = 1000;
  installChrome({
    connectNativeHandler: (message) => {
      if (message.action === 'file_write_start') return { success: true, filePath: STAGED_PATH };
      if (message.action === 'file_write_chunk') return { success: true };
      if (message.action === 'file_write_finish') {
        return { success: true, filePath: STAGED_PATH, message: '123' };
      }
      if (message.action === 'file_delete') return { success: true, message: 'deleted' };
      return { success: false, message: 'unknown' };
    },
  });
  try {
    await assert.rejects(
      () => stageBlobForNativeUpload(new Blob([new Uint8Array(size)]), 'clip.mp4'),
      /Staged file size mismatch: wrote 123 bytes, expected 1000/,
    );
  } finally {
    uninstallChrome();
  }
});

test('2.19.22 (2026-11-18): a failed chunk deletes the staged partial file instead of leaving MBs behind', async () => {
  const size = 512 * 1024 * 2;
  let chunkCount = 0;
  const { ports } = installChrome({
    connectNativeHandler: (message) => {
      if (message.action === 'file_write_start') return { success: true, filePath: STAGED_PATH };
      if (message.action === 'file_write_chunk') {
        chunkCount += 1;
        return chunkCount === 2
          ? { success: false, message: 'disk full' }
          : { success: true };
      }
      if (message.action === 'file_delete') return { success: true, message: 'deleted' };
      return { success: false, message: 'unknown' };
    },
  });
  try {
    await assert.rejects(
      () => stageBlobForNativeUpload(new Blob([new Uint8Array(size)]), 'clip.mp4'),
      /disk full/,
    );
    const allMessages = ports.flatMap((p) => p.messages);
    const deletes = allMessages.filter((m) => m.action === 'file_delete');
    assert.equal(deletes.length, 1);
    assert.equal(deletes[0].file_path, STAGED_PATH);
  } finally {
    uninstallChrome();
  }
});

test('2.19.22 (2026-11-18): staging without the extension runtime throws naming connectNative', async () => {
  assert.equal(typeof globalThis.chrome, 'undefined');
  await assert.rejects(
    () => stageBlobForNativeUpload(new Blob([new Uint8Array(10)]), 'clip.mp4'),
    /chrome\.runtime\.connectNative/,
  );
});

// ------------------------------------------------- deleteNativeTempFile ---

test('2.19.22 (2026-11-18): deleteNativeTempFile with an empty path returns false without touching the host', async () => {
  assert.equal(typeof globalThis.chrome, 'undefined');
  assert.equal(await deleteNativeTempFile(''), false);
  assert.equal(await deleteNativeTempFile('   '), false);
});

test('2.19.22 (2026-11-18): deleteNativeTempFile returns false for "already gone", true when deleted', async () => {
  let next = 'deleted';
  const { ports } = installChrome({
    connectNativeHandler: (message) => {
      if (message.action === 'file_delete') return { success: true, message: next };
      return { success: false, message: 'unknown' };
    },
  });
  try {
    assert.equal(await deleteNativeTempFile(STAGED_PATH), true);
    next = 'already gone';
    assert.equal(await deleteNativeTempFile(STAGED_PATH), false);
    assert.equal(ports[0].messages[0].action, 'file_delete');
    assert.equal(ports[0].messages[0].file_path, STAGED_PATH);
  } finally {
    uninstallChrome();
  }
});

// -------------------------------------------------- uploadTelegramNative ---

test('2.19.6 (2026-11-04): uploadTelegramNative refuses to run without a filePath or a channel', async () => {
  await assert.rejects(
    () => uploadTelegramNative({ channel: 'chan' }),
    /requires a local filePath/,
  );
  await assert.rejects(
    () => uploadTelegramNative({ filePath: 'C:\\x\\clip.mp4' }),
    /requires a valid channel/,
  );
});

test('2.19.6 (2026-11-04): uploadTelegramNative without chrome rejects naming the native host connection', async () => {
  assert.equal(typeof globalThis.chrome, 'undefined');
  await assert.rejects(
    () => uploadTelegramNative({ filePath: 'C:\\x\\clip.mp4', channel: 'chan' }),
    /Failed to connect to native host/,
  );
});

test('2.19.6 (2026-11-04): uploadTelegramNative surfaces progress (loaded byte count) and resolves the message id', async () => {
  const progress = [];
  installChrome({
    connectNativeHandler: (message, port) => {
      assert.equal(message.action, 'telegram_upload');
      assert.equal(message.file_path, 'C:\\x\\clip.mp4');
      assert.equal(message.channel, 'chan');
      queueMicrotask(() => port.emit({ event: 'progress', line: 'progress:100:1000:10', message: 'uploading' }));
      queueMicrotask(() => port.emit({
        success: true,
        stdout: JSON.stringify({ messageId: 90, size: 1000, date: 1730000000 }),
      }));
      return undefined;
    },
  });
  try {
    const result = await uploadTelegramNative({
      filePath: 'C:\\x\\clip.mp4',
      channel: 'chan',
      requestId: 'tg-upload-2-19-6',
      onProgress: (e) => progress.push(e),
    });
    assert.deepEqual(result, {
      ok: true, messageId: 90, size: 1000, date: 1730000000,
      warning: '', videoAttributes: false, requestId: 'tg-upload-2-19-6',
    });
    assert.equal(progress.length, 1);
    assert.equal(progress[0].phase, 'uploading');
    assert.equal(progress[0].loaded, 100);
    assert.equal(progress[0].total, 1000);
    assert.equal(progress[0].percent, 10);
  } finally {
    uninstallChrome();
  }
});

test('2.19.23: uploadTelegramNative passes the uploader warning and videoAttributes flag through', async () => {
  installChrome({
    connectNativeHandler: (message, port) => {
      queueMicrotask(() => port.emit({
        success: true,
        stdout: JSON.stringify({
          messageId: 91, size: 2000, date: 1730000001,
          warning: 'Could not read video dimensions from clip.mp4 — Telethon will attach zeroed video attributes (duration 0, 1x1), so Telegram shows it as a video with unknown duration/size.',
          videoAttributes: false,
        }),
      }));
      return undefined;
    },
  });
  try {
    const result = await uploadTelegramNative({ filePath: 'C:\\x\\clip.mp4', channel: 'chan' });
    assert.equal(result.messageId, 91);
    assert.match(result.warning, /Could not read video dimensions/);
    assert.equal(result.videoAttributes, false);
  } finally {
    uninstallChrome();
  }
});

test('2.19.6 (2026-11-04): uploadTelegramNative rejects loudly when the host disconnects mid-upload', async () => {
  const { ports } = installChrome({
    connectNativeHandler: () => undefined, // never answers
  });
  try {
    const promise = uploadTelegramNative({ filePath: 'C:\\x\\clip.mp4', channel: 'chan' });
    await new Promise((r) => setTimeout(r, 10));
    ports[0].fireDisconnect();
    await assert.rejects(promise, /disconnected unexpectedly during Telegram upload/);
  } finally {
    uninstallChrome();
  }
});

// ------------------------------------------------ scrapeTelegramPostMedia ---

test('2.19.7 (2026-11-04): scrapeTelegramPostMedia returns the mp4 + poster from the post segment only', async () => {
  const html = [
    '<div data-post="chan/90"><video src="https://cdn1.telesco.pe/file/aaa/video.mp4">',
    '<img src="https://cdn2.telesco.pe/file/aaa/thumb.jpg"></div>',
    '<div data-post="chan/91"><video src="https://cdn1.telesco.pe/file/bbb/other.mp4"></div>',
  ].join('');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => html });
  try {
    const media = await scrapeTelegramPostMedia('chan', 90, { attempts: 1 });
    assert.equal(media.mp4Url, 'https://cdn1.telesco.pe/file/aaa/video.mp4');
    assert.equal(media.posterUrl, 'https://cdn2.telesco.pe/file/aaa/thumb.jpg');
    // Segment-scoped: a post with only a poster must NOT pick up the NEXT post's mp4.
    const html2 = [
      '<div data-post="chan/90"><img src="https://cdn2.telesco.pe/file/aaa/thumb.jpg"></div>',
      '<div data-post="chan/91"><video src="https://cdn1.telesco.pe/file/bbb/other.mp4"></div>',
    ].join('');
    globalThis.fetch = async () => ({ ok: true, text: async () => html2 });
    const media2 = await scrapeTelegramPostMedia('chan', 90, { attempts: 1 });
    assert.equal(media2.mp4Url, '');
    assert.equal(media2.posterUrl, 'https://cdn2.telesco.pe/file/aaa/thumb.jpg');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.19.7 (2026-11-04): scrape retries after a network error, then throws naming attempts + last reason', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error('fetch failed');
    return {
      ok: true,
      text: async () => '<div data-post="chan/90"><video src="https://cdn1.telesco.pe/file/a/v.mp4"></div>',
    };
  };
  try {
    const media = await scrapeTelegramPostMedia('chan', 90, { attempts: 2 });
    assert.equal(media.mp4Url, 'https://cdn1.telesco.pe/file/a/v.mp4');
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = realFetch;
  }

  globalThis.fetch = async () => ({ ok: true, text: async () => '<div>no marker here</div>' });
  try {
    await assert.rejects(
      () => scrapeTelegramPostMedia('chan', 90, { attempts: 1 }),
      /no media CDN url for chan\/90 after 1 attempt\(s\).*marker data-post="chan\/90" not in page yet/s,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ----------------------------------------------------- listTelegramPosts ---

test('phase-1 (2026-11-04): listTelegramPosts walks pages ascending and skips service posts', async () => {
  const realFetch = globalThis.fetch;
  const page1 = [
    '<div data-post="chan/100"><div class="tgme_widget_message_video"></div></div>',
    '<div data-post="chan/99"><div class="tgme_widget_message_photo"></div></div>',
    '<div data-post="chan/98"><div>channel created</div></div>',
  ].join('');
  const page2 = '<div data-post="chan/97"><div class="tgme_widget_message_document"></div></div>';
  globalThis.fetch = async (url) => {
    const text = String(url).includes('before=98') ? page2 : page1;
    return { ok: true, text: async () => text };
  };
  try {
    // Page 2's oldest (97) becomes before=97; the mock then returns page1
    // again, whose oldest (98) is >= 97, so the walk stops (repeat-page rule).
    const posts = await listTelegramPosts('fake-token', 'chan');
    assert.deepEqual(posts, [{ messageId: '97' }, { messageId: '99' }, { messageId: '100' }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('phase-1 (2026-11-04): listTelegramPosts fails LOUD on HTTP errors and on the page cap, never truncated', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  try {
    await assert.rejects(
      () => listTelegramPosts('fake-token', 'chan'),
      /Telegram channel listing: HTTP 404/,
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  // Every page returns a fresh decreasing oldest id, so the cap is hit.
  let page = 0;
  globalThis.fetch = async () => {
    page += 1;
    const id = 1000 - page;
    return {
      ok: true,
      text: async () => `<div data-post="chan/${id}"><div class="tgme_widget_message_video"></div></div>`,
    };
  };
  try {
    await assert.rejects(
      () => listTelegramPosts('fake-token', 'chan', { maxPages: 2 }),
      /hit the 2-page cap with more history to read/,
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  await assert.rejects(() => listTelegramPosts('', 'chan'), /bot token is not configured/);
  await assert.rejects(() => listTelegramPosts('fake-token', ''), /channel is not configured/);
});

// --------------------------------------------------- telegramLocalMediaUrl ---

test('2.19.6 (2026-11-04): telegramLocalMediaUrl carries the mime on the mt query param, encoded', () => {
  assert.equal(
    telegramLocalMediaUrl('abc123', 'audio/mp4'),
    '/telegram-media/abc123?mt=audio%2Fmp4',
  );
  assert.equal(telegramLocalMediaUrl('abc123'), '/telegram-media/abc123');
  assert.equal(telegramLocalMediaUrl('a b', 'video/mp4'), '/telegram-media/a%20b?mt=video%2Fmp4');
});

// ------------------------------------------- source assertions (wiring) ---

test('2.19.22 (2026-11-18): uploaders.js stages ONLY picked files and deletes ONLY staged files', () => {
  const uploaders = src('../src/utils/uploaders.js');
  // Native branch keys on size over the threshold — 2.19.31 routes through
  // nativeThreshold (nativeAboveBytes when a caller lowers it, 50 MB default).
  assert.ok(uploaders.includes('if (size > nativeThreshold)'));
  assert.ok(uploaders.includes('? nativeAboveBytes\n      : TELEGRAM_UPLOAD_MAX_BYTES;'));
  assert.ok(uploaders.includes('let nativePath = filePath || \'\';'));
  assert.ok(uploaders.includes('const staged = !nativePath;'));
  assert.ok(uploaders.includes('nativePath = await stageBlobForNativeUpload(blob, filename, { onProgress, signal });'));
  // The staged temp file is deleted whether the upload succeeded or not;
  // a real download path is the user's file and is never touched.
  assert.ok(uploaders.includes('if (staged && nativePath) {'));
  assert.ok(uploaders.includes('await deleteNativeTempFile(nativePath);'));
  assert.ok(uploaders.includes("fileId: `native-${messageId}`"));
  // 2.19.23: the apiMessage names the uploader warning when one is present
  // (mp4 posted as a document), plain 'Uploaded via native host MTProto'
  // otherwise. 2.19.40 nests that inside the journal-recovery branch, so
  // the plain arm ends with a paren now — the wording is unchanged.
  assert.ok(uploaders.includes("? `Uploaded via native host MTProto — ${res.warning}`"));
  assert.ok(uploaders.includes(": 'Uploaded via native host MTProto'),"));
  // 2.19.40: a journal-recovered result says so in its apiMessage
  assert.ok(uploaders.includes('result recovered from the host journal'));
});

test('2.19.22 (2026-11-18): providerCatalog forwards data.filePath into the telegram upload options', () => {
  const catalog = src('../src/config/providerCatalog.js');
  assert.ok(catalog.includes("filePath: data?.filePath || '',"));
});

test('2.19.22 (2026-11-18): GalleryPage probes ONLY when Telegram is selected, over cap, and pathless', () => {
  const gallery = src('../src/pages/GalleryPage.jsx');
  assert.ok(gallery.includes('let hasNativeHost = Boolean(uploadData.filePath);'));
  assert.ok(gallery.includes(
    'if (!hasNativeHost && telegramSelected && videoBytes > telegramUploadSizeCap(videoFileName, videoMimeType)) {',
  ));
  assert.ok(gallery.includes('const probe = await probeNativeHost();'));
  assert.ok(gallery.includes('Native host reachable - Telegram can take this'));
  assert.ok(gallery.includes('Native host MTProto route unavailable ('));
  // The disk path is threaded through processMediaFile and buildUploadData,
  // and stripped before anything is persisted.
  assert.ok(gallery.includes('downloadFilePath = \'\''));
  assert.ok(gallery.includes('filePath: mediaData?.filePath || \'\''));
  assert.ok(gallery.includes('delete pendingMetaVideo.filePath'));
  assert.ok(gallery.includes('delete cleanUploadData.filePath'));
});

test('2.19.22 (2026-11-18): background.js nativeHostCommand reads command FLAT, matching the probe shape', () => {
  const background = src('../src/background/background.js');
  assert.ok(background.includes('this.handleNativeHostCommand(request.command, request.data || {})'));
});

test('2.19.6 (2026-11-04): telegramApi.js sends the native upload as action telegram_upload with file_path', () => {
  const api = src('../src/utils/telegramApi.js');
  assert.ok(api.includes("action: 'telegram_upload',"));
  assert.ok(api.includes('file_path: filePath,'));
});

test('2.19.23: telegram_upload.py attaches DocumentAttributeVideo from a pure-python mp4 probe', () => {
  const py = src('../../native-host/scripts/telegram_upload.py');
  assert.ok(py.includes('from telethon.tl.types import DocumentAttributeVideo'));
  assert.ok(py.includes('def probe_mp4_video(file_path):'));
  assert.ok(py.includes('DocumentAttributeVideo('));
  assert.ok(py.includes('attributes=attributes,'));
  // supports_streaming alone left zeroed attributes: Telethon attaches a
  // default DocumentAttributeVideo(0, 1, 1) when it cannot read metadata,
  // so the probe supplies the real duration/dims.
  assert.ok(py.includes('supports_streaming=True,'));
  // a probe failure is LOUD: a WARN line + a warning in the RESULT json
  assert.ok(py.includes('Could not read video dimensions from'));
  assert.ok(py.includes('print(f"WARN:{warning}", flush=True)'));
  assert.ok(py.includes('result["warning"] = warning'));
  assert.ok(py.includes('"videoAttributes": video_attributes,'));
});

test('2.19.23: the native-upload warning flows through to the result apiMessage', () => {
  const api = src('../src/utils/telegramApi.js');
  assert.ok(api.includes("warning: parsed.warning || '',"));
  assert.ok(api.includes('videoAttributes: parsed.videoAttributes === true,'));
  const uploaders = src('../src/utils/uploaders.js');
  assert.ok(uploaders.includes('if (res.warning) {'));
  assert.ok(uploaders.includes('console.warn(`[telegram-native] ${res.warning}`);'));
  assert.ok(uploaders.includes('`Uploaded via native host MTProto — ${res.warning}`'));
});
