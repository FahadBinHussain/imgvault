// node:test suite for the FilemoonUploader duration-rejection signal
// (2.19.28) and the background/page wiring that turns the rejection into
// a per-item flag.
//
// IMPORT ORDER MATTERS HERE (same as utils-uploaders-telegram.test.mjs):
// uploaders.js cannot be imported directly in plain node — it pulls in
// teraBoxApi -> videoProviderLinks -> config/providerCatalog -> uploaders
// (the cycle), and the direct import dies with "Cannot access
// 'FilemoonUploader' before initialization". Importing
// config/providerCatalog.js FIRST breaks the cycle the other way.
// Do not reorder these imports.
import '../src/config/providerCatalog.js';
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FilemoonUploader } from '../src/utils/uploaders.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const FAKE_KEY = 'fake-byse-key-for-tests-only';
const UPLOAD_SERVER = 'https://upload.example/filemoon';

// --- fetch mock ----------------------------------------------------------
const jsonResponse = (obj, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => obj,
  text: async () => JSON.stringify(obj),
});
const realFetch = globalThis.fetch;
let fetchHandler;
beforeEach(() => {
  fetchHandler = null;
  globalThis.fetch = async (url, options) => {
    if (!fetchHandler) throw new Error(`unexpected fetch: ${url}`);
    return fetchHandler(String(url), options);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const serverOk = () => jsonResponse({ status: 200, result: UPLOAD_SERVER });
const blob = () => new Blob(['fake-video-bytes'], { type: 'video/mp4' });

describe('FilemoonUploader.upload — the duration rejection survives as an error', () => {
  test('a "video is too long" status (no msg) reaches the caller in the error text', async () => {
    const uploader = new FilemoonUploader();
    fetchHandler = (url) => {
      if (url.startsWith('https://api.byse.sx/upload/server')) return serverOk();
      if (url === UPLOAD_SERVER) return jsonResponse({ status: '0:0:0:video is too long' });
      throw new Error(`unexpected fetch: ${url}`);
    };
    // This is the real rejection shape, proven live 2026-11-20 on the
    // 905 MB / 11h55m videoplayback.mp4: the status IS the message, there
    // is no msg field. Before 2.19.28 the uploader threw a generic
    // 'Upload failed' here and the auto-flag could never see the signal.
    await assert.rejects(
      () => uploader.upload(blob(), FAKE_KEY, 'videoplayback.mp4'),
      /video is too long/
    );
  });
  test('a msg is still preferred over the raw status when present', async () => {
    const uploader = new FilemoonUploader();
    fetchHandler = (url) => {
      if (url.startsWith('https://api.byse.sx/upload/server')) return serverOk();
      if (url === UPLOAD_SERVER) return jsonResponse({ status: 400, msg: 'Not video file format' });
      throw new Error(`unexpected fetch: ${url}`);
    };
    await assert.rejects(
      () => uploader.upload(blob(), FAKE_KEY, 'song.m4a'),
      /Not video file format/
    );
  });
  test('a 200 with no files still fails generically (the status is not the error)', async () => {
    const uploader = new FilemoonUploader();
    fetchHandler = (url) => {
      if (url.startsWith('https://api.byse.sx/upload/server')) return serverOk();
      if (url === UPLOAD_SERVER) return jsonResponse({ status: 200, files: [] });
      throw new Error(`unexpected fetch: ${url}`);
    };
    await assert.rejects(
      () => uploader.upload(blob(), FAKE_KEY, 'clip.mp4'),
      /Upload failed/
    );
  });
  test('a successful upload still returns the filecode and URLs', async () => {
    const uploader = new FilemoonUploader();
    fetchHandler = (url) => {
      if (url.startsWith('https://api.byse.sx/upload/server')) return serverOk();
      if (url === UPLOAD_SERVER) return jsonResponse({ status: 200, files: [{ filecode: 'abc123', filename: 'clip.mp4' }] });
      throw new Error(`unexpected fetch: ${url}`);
    };
    const out = await uploader.upload(blob(), FAKE_KEY, 'clip.mp4');
    assert.equal(out.filecode, 'abc123');
    assert.equal(out.watchUrl, 'https://filemoon.sx/d/abc123');
    assert.equal(out.directUrl, 'https://filemoon.sx/e/abc123');
  });
});

describe('uploaders.js — the XHR path preserves the status too (source pin)', () => {
  test('both filemoon upload methods keep the raw status in the failure error', () => {
    // uploadWithProgress runs over XMLHttpRequest, which node has no
    // implementation of — so the behavior test above covers upload()
    // and this pins the identical line in uploadWithProgress().
    const uploaders = src('../src/utils/uploaders.js');
    const pin = "const rawStatus = result.status !== 200 && result.status != null ? String(result.status) : '';";
    const hits = uploaders.split(pin).length - 1;
    assert.equal(hits, 2, `expected the raw-status line in upload() and uploadWithProgress(), found ${hits}`);
  });
});

describe('background.js — the auto-flag hooks (source pins)', () => {
  const bg = src('../src/background/background.js');
  test('handleVideoUpload flags the item and logs loudly on a filemoon duration rejection', () => {
    assert.ok(bg.includes('const filemoonTooLong = findFilemoonTooLongError(uploadErrors);'));
    assert.ok(bg.includes('Filemoon rejected this video: "video is too long"'));
    assert.ok(bg.includes("? ' Filemoon rejected this video: video is too long — it will never upload there.' : ''}"));
  });
  test('saveUploadedVideo and finalizeUploadedVideo read the page error list', () => {
    const hits = bg.split('findFilemoonTooLongError(data.videoUploadErrors)').length - 1;
    assert.equal(hits, 2, `expected the detector in saveUploadedVideo + finalizeUploadedVideo, found ${hits}`);
    // finalize reads the duration off the pending item, save off the upload data.
    assert.ok(bg.includes('durationSeconds: current.duration'));
  });
  test('every flag write goes through withHostUnsupportedFlag', () => {
    const hits = bg.split('withHostUnsupportedFlag(').length - 1;
    assert.equal(hits, 4, `expected 4 flag writes (handle/save/finalize/retry), found ${hits}`);
  });
  test('retryVideoHostUpload refuses a flagged item before downloading anything', () => {
    const fn = bg.slice(bg.indexOf('async retryVideoHostUpload('));
    assert.ok(fn.includes('Filemoon already rejected this video'));
    assert.ok(fn.includes("if (targetHost === 'filemoon') {"));
    assert.ok(fn.includes('getHostUnsupportedFlag(item, \'filemoon\')'));
  });
  test('retryVideoHostUpload auto-flags on a duration rejection in the catch', () => {
    const fn = bg.slice(bg.indexOf('async retryVideoHostUpload('));
    assert.ok(fn.includes("if (targetHost === 'filemoon' && isFilemoonTooLongError(error)) {"));
    assert.ok(fn.includes('could not record the filemoon unsupported flag'));
  });
});

describe('GalleryPage.jsx — the upload-time warning wiring (source pins)', () => {
  const page = src('../src/pages/GalleryPage.jsx');
  test('the video upload sets the loud modal warning from the error list', () => {
    assert.ok(page.includes('getFilemoonTooLongWarning(uploadErrors, uploadData.duration)'));
    assert.ok(page.includes('setFilemoonTooLongWarning({ ...tooLongWarning, fileName: uploadData.fileName || \'\' });'));
    assert.ok(page.includes('setFilemoonTooLongWarning(null);'));
  });
  test('the banner renders in both upload-progress spots', () => {
    const hits = page.split('{filemoonTooLongBanner}').length - 1;
    assert.equal(hits, 2, `expected the banner in both progress spots, found ${hits}`);
    assert.ok(page.includes("Filemoon won't take this video"));
  });
  test('the detail modal hides the filemoon retry for flagged items and guards the retry call', () => {
    assert.ok(page.includes("service.key === 'filemoon' && selectedVideoUnsupportedFlag"));
    assert.ok(page.includes("Filemoon won't support this"));
    assert.ok(page.includes("String(host).toLowerCase() === 'filemoon' && getHostUnsupportedFlag(retryItem, 'filemoon')"));
  });
});

describe('ResolvePage.jsx — the dismiss wiring (source pins)', () => {
  const page = src('../src/pages/ResolvePage.jsx');
  test('the notice comes from the shared formatter (counts stay honest)', () => {
    assert.ok(page.includes('message: formatFilemoonCheckNotice(result),'));
  });
  test('dismiss / undismiss persist through updateImage with a fresh read first', () => {
    assert.ok(page.includes("withHostUnsupportedDismissed(fresh.extraMetadata, 'filemoon'"));
    assert.ok(page.includes("withHostUnsupportedUndismissed(fresh.extraMetadata, 'filemoon'"));
    assert.ok(page.includes("await sendMessage('getImageById', { id: item.id });"));
    assert.ok(page.includes("await sendMessage('updateImage', { id: item.id, extraMetadata });"));
  });
  test('the unsupported and dismissed filters exist', () => {
    assert.ok(page.includes("{ value: 'unsupported', label: 'Unsupported'"));
    assert.ok(page.includes("{ value: 'dismissed', label: 'Dismissed'"));
  });
});
