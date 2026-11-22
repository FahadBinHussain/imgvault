// Regression tests mined from the ImgVault bug history (AGENTS.md).
// Area: vault video previews (2.12.74-2.12.99, 2.13.0) — the
// single-frame preview derivation, host-aware copy choice, and the
// remote encrypted preview tier.
//
// Live tests cover the pure seams (preferredPreviewCopies, the
// thumb-cache fail-soft contract). The derivation itself needs a DOM
// (<video>, canvas) and the service worker, so its internals are
// pinned with SOURCE-TEXT assertions. The mp4 box-walk seams
// (findMoov / locateVideoFrame / buildSingleFrameMp4) are covered live
// by the sibling utils-mp4 tests and the legacy suite — not re-written
// here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { preferredPreviewCopies, setVaultPreviewPaused, persistRemoteVaultPreview, fetchPlaintextRange, resolvePreviewCopies, requestVaultImagePreview, decryptLegacyVaultBlob } from '../src/utils/vaultPreview.js';
import { getCachedThumb } from '../src/utils/thumbCache.js';
import { setVaultMasterKey, clearVaultMasterKey } from '../src/utils/vaultSession.js';
import { createVaultConfig, unwrapMasterKey, decryptPreviewBytes } from '../../packages/shared/vaultCrypto.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const preview = () => src('../src/utils/vaultPreview.js');

// ------------------------------------------------- preferredPreviewCopies ---

test('2.12.76 (2026-09-13): preferredPreviewCopies reads ONLY the fast copy — a udrop copy means terabox is never touched', () => {
  const copies = preferredPreviewCopies({
    encryptedBlobHosts: [
      { host: 'terabox', encryptedBlobUrl: 'https://tb.example/b.bin', encryptedBlobFileId: '1' },
      { host: 'udrop', encryptedBlobUrl: 'https://ud.example/b.bin', encryptedBlobFileId: '2' },
    ],
  });
  assert.equal(copies.length, 1);
  assert.equal(copies[0].host, 'udrop');
});

test('2.12.76 (2026-09-13): preferredPreviewCopies with only terabox copies reads terabox (no fast host to prefer)', () => {
  const copies = preferredPreviewCopies({
    encryptedBlobHosts: [
      { host: 'terabox', encryptedBlobUrl: 'https://tb.example/b.bin', encryptedBlobFileId: '1' },
    ],
  });
  assert.equal(copies.length, 1);
  assert.equal(copies[0].host, 'terabox');
});

test('2.12.76 (2026-09-13): preferredPreviewCopies falls back to the legacy single-host fields, defaulting to udrop', () => {
  assert.deepEqual(
    preferredPreviewCopies({ vaultHost: 'terabox', encryptedBlobUrl: 'https://tb.example/b.bin', encryptedBlobFileId: '7' }),
    [{ host: 'terabox', encryptedBlobUrl: 'https://tb.example/b.bin', encryptedBlobFileId: '7' }],
  );
  assert.deepEqual(
    preferredPreviewCopies({}),
    [{ host: 'udrop', encryptedBlobUrl: '', encryptedBlobFileId: '' }],
  );
});

// ------------------------------------------------------------- thumb TTL ---

test('2.12.76 (2026-09-13): getCachedThumb fails soft without IndexedDB — a missing DB never breaks the gallery', async () => {
  assert.equal(typeof globalThis.indexedDB, 'undefined');
  assert.equal(await getCachedThumb('vault-preview-x'), null);
  assert.equal(await getCachedThumb('vault-preview-x', 365 * 24 * 60 * 60 * 1000), null);
});

test('2.12.76 (2026-09-13): the preview TTL is 365 days (vault blobs are immutable) and the shared thumb TTL is 7 days', () => {
  const pv = preview();
  assert.ok(pv.includes('const PREVIEW_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;'));
  assert.ok(pv.includes('await getCachedThumb(key, PREVIEW_MAX_AGE_MS);'));
  const thumb = src('../src/utils/thumbCache.js');
  assert.ok(thumb.includes('const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;'));
  assert.ok(thumb.includes('export async function getCachedThumb(key, maxAgeMs = MAX_AGE_MS) {'));
  assert.ok(thumb.includes('if (Date.now() - result.cachedAt > maxAgeMs) return null;'));
});

// ------------------------------------------------------- derivation shape ---

test('2.12.99 (2026-09-20): fetchPlain is declared BEFORE the container branch — no TDZ when the head read runs', () => {
  // 2.19.33: the range reader is factored to module level
  // (fetchPlaintextRange) so the image derivation shares it; runExtraction
  // keeps a thin `fetchPlain` wrapper above the head read, so the no-TDZ
  // property this test pins is unchanged.
  const pv = preview();
  const fetchPlainAt = pv.indexOf('const fetchPlain = async (start, end) => {');
  const headFirstAt = pv.indexOf('const headFirst = await fetchPlain(0, Math.min(chunkSize, total) - 1);');
  assert.ok(fetchPlainAt > 0 && headFirstAt > fetchPlainAt);
  const normalizeAt = pv.indexOf('const normalizeBytes = (part) => {');
  assert.ok(normalizeAt > 0 && normalizeAt < fetchPlainAt);
  assert.ok(pv.includes('export async function fetchPlaintextRange(sendMessage, item, copies, start, end) {'));
  assert.ok(pv.includes('return fetchPlaintextRange(sendMessage, item, copies, start, end);'));
});

test('2.12.88 (2026-09-17): large plaintext ranges split into 1 MiB messages — an 8 MiB structured clone blows the 64 MiB cap', () => {
  const pv = preview();
  assert.ok(pv.includes('const PLAIN_FETCH_CHUNK = 1 * 1024 * 1024;'));
  assert.ok(pv.includes('if (len <= PLAIN_FETCH_CHUNK) {'));
  assert.ok(pv.includes("sendMessage('vaultFetchPlaintextRange', {"));
  // normalize BEFORE the length check: structured-clone may deliver a
  // plain object with numeric keys, whose .length is undefined.
  assert.ok(pv.includes("if (part && typeof part === 'object') {"));
  assert.ok(pv.includes('const vals = Object.values(part);'));
  assert.ok(pv.includes("if (vals.length && typeof vals[0] === 'number') return new Uint8Array(vals);"));
});

test('2.12.90 (2026-09-18): the moov window GROWS (1 chunk at a time, capped 32 MiB) until moov fits completely — a truncated moov is never parsed', () => {
  const pv = preview();
  assert.ok(pv.includes('const MOOV_MAX_WINDOW = 32 * 1024 * 1024;'));
  assert.ok(pv.includes('let windowChunks = 1;'));
  assert.ok(pv.includes('if (moov && moov.off + moov.size <= win.length) {'));
  assert.ok(pv.includes('moov in ${side} needs ${moov.size}B, window is ${win.length}B — growing'));
  assert.ok(pv.includes("throw new Error('moov not found or did not fit in a 32MiB head/tail window — cannot locate a frame');"));
});

test('2.12.74 (2026-09-12): candidates are tried at 50% / 25% / 75% and a frame must beat the black/fade thresholds', () => {
  const pv = preview();
  assert.ok(pv.includes('const CANDIDATE_RATIOS = [0.5, 0.25, 0.75];'));
  assert.ok(pv.includes('const MIN_MEAN_LUMA = 18;'));
  assert.ok(pv.includes('const MIN_LUMA_SD = 8;'));
  assert.ok(pv.includes('const usable = mean >= MIN_MEAN_LUMA && sd >= MIN_LUMA_SD;'));
  assert.ok(pv.includes("throw new Error('no decodable frame at any candidate position');"));
});

test('2.12.76 (2026-09-13): host concurrency is 3 for terabox and 3 for udrop (terabox was 1 — the whole-library warm crawled)', () => {
  const pv = preview();
  assert.ok(pv.includes('const HOST_CONCURRENCY = { terabox: 3, udrop: 3 };'));
  assert.ok(pv.includes('const limit = HOST_CONCURRENCY[host] ?? 2;'));
});

test('2.12.75 (2026-09-12): the pause gate stops NEW preview jobs while the detail modal plays (dlink race)', () => {
  const pv = preview();
  assert.ok(pv.includes('let paused = false;'));
  assert.ok(pv.includes('export function setVaultPreviewPaused(next) {'));
  assert.ok(pv.includes('if (!st || paused) return;'));
  // Toggling the switch is safe even with no jobs queued.
  setVaultPreviewPaused(true);
  setVaultPreviewPaused(false);
});

test('2.12.83-84 (2026-09-15): the remote tier decrypts server previews, rejects implausibly small payloads loudly, and backfills once per session', () => {
  const pv = preview();
  assert.ok(pv.includes("b64 = await sendMessage('getVaultPreview', { id: item.id });"));
  assert.ok(pv.includes("if (blob.size < 64) throw new Error(`implausibly small payload (${blob.size}B)`);"));
  assert.ok(pv.includes('stored preview unusable for ${item.id}'));
  assert.ok(pv.includes('const remoteBackfilled = new Set();'));
  assert.ok(pv.includes("if (typeof sendMessage === 'function' && !remoteBackfilled.has(key)) {"));
  assert.ok(pv.includes('remoteBackfilled.delete(key);'));
  assert.ok(pv.includes("await sendMessage('saveVaultPreview', { id: item.id, data: b64 });"));
});

test('2.12.88 (2026-09-17): the probe carries hostCopies (not copies) and a legacy non-chunked blob throws loudly', () => {
  const pv = preview();
  assert.ok(pv.includes("const probe = await sendMessage('vaultProbeBlobFormat', {"));
  assert.ok(pv.includes('hostCopies: copies,'));
  assert.ok(pv.includes("throw new Error('legacy (non-chunked) blob — single-frame preview unavailable');"));
  const probeBlock = pv.slice(pv.indexOf("sendMessage('vaultProbeBlobFormat'"));
  assert.ok(!probeBlock.slice(0, 600).includes('copies: copies,'));
});

test('2.12.98 (2026-09-19): the container is detected from the head bytes — ftyp at offset 4, EBML magic for Matroska', () => {
  const pv = preview();
  assert.ok(pv.includes("const type = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);"));
  assert.ok(pv.includes("if (type === 'ftyp') return 'iso-bmff';"));
  assert.ok(pv.includes('if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return \'matroska\';'));
  assert.ok(pv.includes("if (container !== 'iso-bmff') {"));
});

test('2.12.97 (2026-09-19): fragmented MP4 (mvex) decodes the head window directly instead of locating a frame in moov', () => {
  const pv = preview();
  assert.ok(pv.includes("return !!findBox(moovBytes, 'mvex', moovBox.dataOff, moovBox.dataEnd);"));
  assert.ok(pv.includes('const frag = await decodeFragmentedHead(moovBytes, timeouts);'));
  assert.ok(pv.includes("throw new Error('fragmented MP4: head window did not decode (unsupported fragmentation?)');"));
});

test('2.12.96 (2026-09-19): Matroska probes early seconds with a 3s per-seek timeout — duration-based seeking stalls past the available data', () => {
  const pv = preview();
  assert.ok(pv.includes('const res = await decodeMatroskaHead(head, total, timeouts);'));
  assert.ok(pv.includes("await waitForEvent(video, 'seeked', 3000, `matroska seek ${t.toFixed(1)}s`);"));
  assert.ok(pv.includes("throw new Error('matroska: head window did not decode (unsupported variants?)');"));
});

// ------------------------------------------- 2.19.32 upload-time snapshot ---

// FIXED in 2.19.32. Gallery videos capture a 1-frame snapshot at upload
// time (captureVideoSnapshotBlob → poster-<id> thumb cache) but the vault
// path captured nothing, so every new vault video showed DERIVING PREVIEW
// while the vault page decrypted the blob and located a frame on demand.
// uploadVaultedDirectly now captures the same snapshot from the PLAINTEXT
// blob before encryption and persists it after save — local IndexedDB
// under `vault-preview-<id>` (NOT poster-<id>, which the vault card never
// reads) AND the remote encrypted store via persistRemoteVaultPreview.
// Capture + both persists are non-fatal: a missing snapshot just means
// on-demand derivation, never a failed upload.

test('2.19.32 (2026-11-22): persistRemoteVaultPreview sends vault-key-encrypted bytes the same key decrypts', async () => {
  const config = await createVaultConfig('test passcode only');
  const key = await unwrapMasterKey(config, 'test passcode only');
  setVaultMasterKey(key);
  const sent = [];
  try {
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], { type: 'image/jpeg' });
    await persistRemoteVaultPreview({ id: 'item-1' }, jpeg, async (action, data) => { sent.push([action, data]); });
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], 'saveVaultPreview');
    assert.equal(sent[0][1].id, 'item-1');
    assert.equal(typeof sent[0][1].data, 'string');
    assert.ok(sent[0][1].data.length > 0);
    const roundTripped = await decryptPreviewBytes(key, sent[0][1].data);
    assert.deepEqual(roundTripped, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]));
  } finally {
    clearVaultMasterKey();
  }
});

test('2.19.32 (2026-11-22): persistRemoteVaultPreview with no master key sends nothing (locked vault never persists)', async () => {
  clearVaultMasterKey();
  const sent = [];
  await persistRemoteVaultPreview({ id: 'item-1' }, new Blob([new Uint8Array([1])]), async (action, data) => { sent.push([action, data]); });
  assert.deepEqual(sent, []);
});

test('2.19.32 (2026-11-22): the vault upload captures a snapshot from the plaintext blob before encryption — video only, non-fatal', () => {
  const gallery = src('../src/pages/GalleryPage.jsx');
  const vaultFn = gallery.slice(gallery.indexOf('const uploadVaultedDirectly'));
  // Captured from the normalized plaintext blob, video only, before the
  // encryption step — after encryption only ciphertext exists in the page.
  const captureAt = vaultFn.indexOf('vaultSnapshotBlob = await captureVideoSnapshotBlob(blob, 1.0);');
  assert.ok(captureAt > 0, 'vault path never captures a snapshot');
  assert.ok(vaultFn.slice(0, captureAt).includes("if (kind === 'video'"), 'snapshot is not gated to video');
  assert.ok(vaultFn.indexOf('// 1) Encrypt with chunked progress') > captureAt, 'snapshot is captured AFTER encryption — too late, only ciphertext exists then');
  // Non-fatal: a failed capture warns and the upload continues (the card
  // just derives on demand instead).
  const catchBlock = vaultFn.slice(captureAt, captureAt + 400);
  assert.ok(catchBlock.includes('catch (snapErr)'), 'snapshot capture has no catch — a failure would kill the upload');
  assert.ok(catchBlock.includes('Vault preview snapshot skipped'), 'snapshot failure is not named in the warning');
});

test('2.19.32 (2026-11-22): the vault snapshot is persisted under vault-preview-<id> locally AND the remote encrypted store after save', () => {
  const gallery = src('../src/pages/GalleryPage.jsx');
  const vaultFn = gallery.slice(gallery.indexOf('const uploadVaultedDirectly'));
  // Local tier: the vault card reads `vault-preview-<id>` — the gallery
  // `poster-<id>` key would be written and never read.
  assert.ok(vaultFn.includes('setCachedThumb(`vault-preview-${saved.id}`, vaultSnapshotBlob)'), 'vault snapshot is not cached under vault-preview-<id>');
  assert.ok(!vaultFn.includes('setCachedThumb(`poster-${saved.id}`, vaultSnapshotBlob)'), 'vault snapshot is cached under the gallery poster- key — the vault card never reads it');
  // Remote tier: same bytes, vault-key-encrypted, via the existing helper.
  assert.ok(vaultFn.includes('persistRemoteVaultPreview({ id: saved.id }, vaultSnapshotBlob, sendMessage)'), 'vault snapshot is not persisted to the remote encrypted store');
  // Both persists happen after the save (the item id only exists then)
  // and the local write is non-fatal.
  const saveAt = vaultFn.indexOf("sendMessage('saveVaultedUpload'");
  const cacheAt = vaultFn.indexOf('setCachedThumb(`vault-preview-${saved.id}`');
  const remoteAt = vaultFn.indexOf('persistRemoteVaultPreview({ id: saved.id }');
  assert.ok(saveAt > 0 && cacheAt > saveAt && remoteAt > saveAt, 'snapshot persists run before the save — saved.id does not exist yet');
  assert.ok(vaultFn.slice(cacheAt, cacheAt + 400).includes('Vault preview cache write failed'), 'local cache write failure is not warned');
  assert.ok(gallery.includes("import { persistRemoteVaultPreview } from '../utils/vaultPreview.js';"), 'persistRemoteVaultPreview is not imported in GalleryPage');
});

// ------------------------------------------- 2.19.33 vault image previews ---

// FIXED in 2.19.33. The vault grid rendered a hardcoded static lock tile for
// ANY encrypted item that was not a Video — only Video went through
// VaultEncryptedVideoThumb. All 8 vault images ALWAYS showed locks; there
// was no image-preview path at all. The image derivation mirrors the video
// system: same cache key (vault-preview-<id>), same remote encrypted tier,
// same per-host queue — but it reads the WHOLE plaintext (images are small)
// and downscales it on a canvas. Legacy single-shot blobs are fully
// decrypted like the detail modal does. Upload-time snapshots cover images
// too (canvas downscale of the plaintext file, before encryption).

function installImageDomStubs({ width = 1000, height = 500 } = {}) {
  const calls = { drawImage: [], toBlob: [] };
  const fakeCtx = {
    fillStyle: '',
    fillRect() {},
    drawImage(...args) { calls.drawImage.push(args); },
  };
  const fakeCanvas = {
    width: 0,
    height: 0,
    getContext: () => fakeCtx,
    toBlob(cb, type, quality) {
      calls.toBlob.push([type, quality]);
      cb(new Blob([new Uint8Array(100).fill(7)], { type: 'image/jpeg' }));
    },
  };
  const prevBitmap = globalThis.createImageBitmap;
  const prevDocument = globalThis.document;
  globalThis.createImageBitmap = async () => ({ width, height, close() {} });
  globalThis.document = { createElement: () => fakeCanvas };
  return {
    calls,
    fakeCanvas,
    restore() {
      if (prevBitmap === undefined) delete globalThis.createImageBitmap;
      else globalThis.createImageBitmap = prevBitmap;
      if (prevDocument === undefined) delete globalThis.document;
      else globalThis.document = prevDocument;
    },
  };
}

function makeRangeMock(pattern) {
  const calls = [];
  const sendMessage = async (action, data) => {
    if (action === 'vaultResolveStreamUrls') {
      return { copies: [{ host: 'udrop', encryptedBlobUrl: 'https://ud.example/b.bin', encryptedBlobFileId: '9' }] };
    }
    if (action === 'vaultProbeBlobFormat') {
      return { chunked: true, total: pattern.length, chunkSize: 8 * 1024 * 1024 };
    }
    if (action === 'vaultFetchPlaintextRange') {
      calls.push([data.start, data.end]);
      return pattern.subarray(data.start, data.end + 1);
    }
    throw new Error(`unexpected action ${action}`);
  };
  return { sendMessage, calls };
}

test('2.19.33 (2026-11-22): fetchPlaintextRange fetches a small range in one call, exact bytes', async () => {
  const pattern = new Uint8Array([9, 8, 7, 6, 5]);
  const seen = [];
  const out = await fetchPlaintextRange(async (action, data) => {
    seen.push([action, data.start, data.end]);
    return pattern.subarray(data.start, data.end + 1);
  }, { id: 'i-small', encryptedFileName: '' }, [], 1, 3);
  assert.deepEqual(out, new Uint8Array([8, 7, 6]));
  assert.deepEqual(seen, [['vaultFetchPlaintextRange', 1, 3]]);
});

test('2.19.33 (2026-11-22): fetchPlaintextRange splits a 2.5 MiB range into 1 MiB messages and reassembles in order', async () => {
  const total = Math.floor(2.5 * 1024 * 1024);
  const pattern = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) pattern[i] = i % 251;
  const seen = [];
  const out = await fetchPlaintextRange(async (action, data) => {
    seen.push([data.start, data.end]);
    return pattern.subarray(data.start, data.end + 1);
  }, { id: 'i-big', encryptedFileName: '' }, [], 0, total - 1);
  assert.deepEqual(seen, [[0, 1048575], [1048576, 2097151], [2097152, total - 1]]);
  assert.deepEqual(out, pattern);
});

test('2.19.33 (2026-11-22): fetchPlaintextRange normalizes a structured-clone plain object (numeric keys, no .length)', async () => {
  const out = await fetchPlaintextRange(async () => ({ 0: 10, 1: 20, 2: 30 }), { id: 'i-obj', encryptedFileName: '' }, [], 0, 2);
  assert.deepEqual(out, new Uint8Array([10, 20, 30]));
});

test('2.19.33 (2026-11-22): fetchPlaintextRange throws loudly when a part comes back empty (never a silently short blob)', async () => {
  const total = 2 * 1024 * 1024;
  await assert.rejects(
    () => fetchPlaintextRange(async (action, data) => {
      if (data.start === 0) return new Uint8Array(1024 * 1024);
      return new Uint8Array(0);
    }, { id: 'i-empty', encryptedFileName: '' }, [], 0, total - 1),
    /returned no bytes/,
  );
});

test('2.19.33 (2026-11-22): resolvePreviewCopies returns the resolved copies, null when nothing resolves', async () => {
  const copies = [{ host: 'udrop', encryptedBlobUrl: 'https://ud.example/b.bin', encryptedBlobFileId: '9' }];
  assert.deepEqual(
    await resolvePreviewCopies({ id: 'i-res', encryptedFileName: '' }, async () => ({ copies })),
    copies,
  );
  assert.equal(
    await resolvePreviewCopies({ id: 'i-res', encryptedFileName: '' }, async () => ({})),
    null,
  );
  assert.equal(
    await resolvePreviewCopies({ id: 'i-res', encryptedFileName: '' }, async () => ({ copies: [] })),
    null,
  );
});

test('2.19.33 (2026-11-22): requestVaultImagePreview derives a chunked image end to end — 1 MiB parts, 480-wide JPEG', async () => {
  clearVaultMasterKey();
  setVaultPreviewPaused(false);
  const stubs = installImageDomStubs({ width: 1000, height: 500 });
  try {
    const total = Math.floor(2.5 * 1024 * 1024);
    const pattern = new Uint8Array(total);
    for (let i = 0; i < total; i += 1) pattern[i] = (i * 7) % 251;
    const { sendMessage, calls } = makeRangeMock(pattern);
    const url = await requestVaultImagePreview(
      { id: 'img-chunked-1', encryptedBlobUrl: 'https://ud.example/b.bin' },
      { sendMessage },
    );
    assert.equal(typeof url, 'string');
    assert.ok(url.startsWith('blob:'));
    assert.deepEqual(calls, [[0, 1048575], [1048576, 2097151], [2097152, total - 1]]);
    assert.equal(stubs.fakeCanvas.width, 480);
    assert.equal(stubs.fakeCanvas.height, 240);
    assert.deepEqual(stubs.calls.toBlob, [['image/jpeg', 0.75]]);
  } finally {
    stubs.restore();
  }
});

test('2.19.33 (2026-11-22): requestVaultImagePreview decrypts a legacy blob whole (vaultDecryptBlob, unwrapped { blob })', async () => {
  clearVaultMasterKey();
  setVaultPreviewPaused(false);
  const stubs = installImageDomStubs({ width: 640, height: 480 });
  try {
    const seen = [];
    const legacyBytes = new Uint8Array(4096).fill(3);
    const sendMessage = async (action, data) => {
      seen.push(action);
      if (action === 'vaultResolveStreamUrls') {
        return { copies: [{ host: 'udrop', encryptedBlobUrl: 'https://ud.example/b.bin', encryptedBlobFileId: '9' }] };
      }
      if (action === 'vaultProbeBlobFormat') return { chunked: false };
      if (action === 'vaultDecryptBlob') return { blob: new Blob([legacyBytes], { type: 'image/png' }) };
      throw new Error(`unexpected action ${action}`);
    };
    const url = await requestVaultImagePreview(
      { id: 'img-legacy-1', encryptedBlobUrl: 'https://ud.example/b.bin' },
      { sendMessage },
    );
    assert.ok(url.startsWith('blob:'));
    assert.ok(seen.includes('vaultDecryptBlob'));
    assert.ok(!seen.includes('vaultFetchPlaintextRange'), 'legacy path must not range-fetch');
    assert.equal(stubs.fakeCanvas.width, 480);
    assert.equal(stubs.fakeCanvas.height, 360);
  } finally {
    stubs.restore();
  }
});

test('2.19.33 (2026-11-22): a legacy decrypt with no blob rejects — never a fake frame', async () => {
  clearVaultMasterKey();
  setVaultPreviewPaused(false);
  const sendMessage = async (action) => {
    if (action === 'vaultResolveStreamUrls') {
      return { copies: [{ host: 'udrop', encryptedBlobUrl: 'https://ud.example/b.bin', encryptedBlobFileId: '9' }] };
    }
    if (action === 'vaultProbeBlobFormat') return { chunked: false };
    if (action === 'vaultDecryptBlob') return {};
    throw new Error(`unexpected action ${action}`);
  };
  await assert.rejects(
    () => requestVaultImagePreview({ id: 'img-legacy-empty', encryptedBlobUrl: 'https://ud.example/b.bin' }, { sendMessage }),
    /no bytes/,
  );
});

test('2.19.33 (2026-11-22): an oversize image rejects BEFORE any range fetch (memory bound, loud)', async () => {
  clearVaultMasterKey();
  setVaultPreviewPaused(false);
  let rangeCalls = 0;
  const sendMessage = async (action) => {
    if (action === 'vaultResolveStreamUrls') {
      return { copies: [{ host: 'udrop', encryptedBlobUrl: 'https://ud.example/b.bin', encryptedBlobFileId: '9' }] };
    }
    if (action === 'vaultProbeBlobFormat') return { chunked: true, total: 65 * 1024 * 1024, chunkSize: 8 * 1024 * 1024 };
    if (action === 'vaultFetchPlaintextRange') { rangeCalls += 1; return new Uint8Array(0); }
    throw new Error(`unexpected action ${action}`);
  };
  await assert.rejects(
    () => requestVaultImagePreview({ id: 'img-huge', encryptedBlobUrl: 'https://ud.example/b.bin' }, { sendMessage }),
    /too large to thumbnail/,
  );
  assert.equal(rangeCalls, 0);
});

test('2.19.33 (2026-11-22): an unresolvable copy rejects loudly (no stale-URL read)', async () => {
  clearVaultMasterKey();
  setVaultPreviewPaused(false);
  const sendMessage = async (action) => {
    if (action === 'vaultResolveStreamUrls') return {};
    throw new Error(`unexpected action ${action}`);
  };
  await assert.rejects(
    () => requestVaultImagePreview({ id: 'img-nocopy', encryptedBlobUrl: 'https://ud.example/b.bin' }, { sendMessage }),
    /no readable copy/,
  );
});

test('2.19.33 (2026-11-22): the image derivation reads decrypted?.blob — NOT result.success (useChromeMessage unwraps .data)', () => {
  const pv = preview();
  // 2.19.34: the decrypt step is the shared decryptLegacyVaultBlob helper
  // (the detail modal uses it too) — the derivation calls it, the helper
  // reads decrypted?.blob directly.
  const imageFn = pv.slice(pv.indexOf('async function runImageExtraction'));
  assert.ok(imageFn.includes('const blob = await decryptLegacyVaultBlob(sendMessage, {'));
  assert.ok(!imageFn.includes("sendMessage('vaultDecryptBlob'"), 'image path calls vaultDecryptBlob directly instead of the shared helper');
  assert.ok(!imageFn.includes('result.success'), 'image path checks result.success — the unwrapped response has no success field (see the modal bug in AGENTS.md)');
  const helper = pv.slice(pv.indexOf('export async function decryptLegacyVaultBlob'));
  assert.ok(helper.includes("const decrypted = await sendMessage('vaultDecryptBlob', {"));
  assert.ok(helper.includes('const blob = decrypted?.blob;'));
  assert.ok(pv.includes('const IMAGE_PREVIEW_MAX_BYTES = 64 * 1024 * 1024;'));
  assert.ok(pv.includes('export function requestVaultImagePreview(item, { sendMessage }) {'));
  assert.ok(pv.includes('export async function resolvePreviewCopies(item, sendMessage) {'));
});

test('2.19.33 (2026-11-22): the vault grid renders encrypted images through VaultEncryptedImageThumb (same states as video)', () => {
  const vault = src('../src/pages/VaultPage.jsx');
  assert.ok(vault.includes('function VaultEncryptedImageThumb({ item, sendMessage, paused }) {'));
  assert.ok(vault.includes("const next = await requestVaultImagePreview(item, { sendMessage });"));
  // Same user-visible strings as the video card — symmetry, one vocabulary.
  const imageCard = vault.slice(vault.indexOf('function VaultEncryptedImageThumb'));
  assert.ok(imageCard.includes('deriving preview'));
  assert.ok(imageCard.includes('preview unavailable'));
  assert.ok(imageCard.includes('object-contain'), 'image thumbnail crops with object-cover — a photo must not be cropped to fit');
  // Wired: the encrypted branch sends Image items to the image thumb (before
  // 2.19.33 every non-Video encrypted item fell through to the static lock).
  const branch = vault.slice(vault.indexOf('{item.encryptedBlobUrl ? ('));
  assert.ok(branch.includes("kind === 'Image' ? ("));
  assert.ok(branch.includes('<VaultEncryptedImageThumb item={item} sendMessage={sendMessage} paused={Boolean(selectedItem)} />'));
  // (the import grew in 2.19.34: decryptLegacyVaultBlob is the shared
  // legacy-decrypt helper the detail modal uses too.)
  assert.ok(vault.includes("import { requestVaultPreview, requestVaultImagePreview, getCachedVaultPreview, setVaultPreviewPaused, resolvePreviewCopies, decryptLegacyVaultBlob } from '../utils/vaultPreview.js';"));
});

test('2.19.33 (2026-11-22): Warm previews covers encrypted images too, not just videos', () => {
  const vault = src('../src/pages/VaultPage.jsx');
  assert.ok(vault.includes("const isEncryptedImageItem = (item) => Boolean(item?.encryptedBlobUrl) && getMediaItemKind(item) === 'image';"));
  const warm = vault.slice(vault.indexOf('const warmAllPreviews'));
  assert.ok(warm.includes('isEncryptedVideoItem(item) || isEncryptedImageItem(item)'));
  assert.ok(warm.includes('await requestVaultImagePreview(item, { sendMessage });'));
  assert.ok(warm.includes("showToast('All previews are already cached.', 'info');"));
  assert.ok(!warm.includes('All video previews are already cached.'), 'warm toast still says videos only');
});

test('2.19.33 (2026-11-22): the vault upload captures an image snapshot from the plaintext blob before encryption — non-fatal', () => {
  const gallery = src('../src/pages/GalleryPage.jsx');
  const vaultFn = gallery.slice(gallery.indexOf('const uploadVaultedDirectly'));
  const captureAt = vaultFn.indexOf('vaultSnapshotBlob = await captureImageSnapshotBlob(blob);');
  assert.ok(captureAt > 0, 'vault path never captures an image snapshot');
  assert.ok(vaultFn.slice(0, captureAt).includes("else if (kind === 'image'"), 'image snapshot is not gated to kind image');
  assert.ok(vaultFn.indexOf('// 1) Encrypt with chunked progress') > captureAt, 'image snapshot is captured AFTER encryption — too late, only ciphertext exists then');
  const catchBlock = vaultFn.slice(captureAt, captureAt + 400);
  assert.ok(catchBlock.includes('catch (snapErr)'), 'image snapshot capture has no catch — a failure would kill the upload');
  assert.ok(catchBlock.includes('Vault preview snapshot skipped'), 'image snapshot failure is not named in the warning');
  assert.ok(gallery.includes("import { captureImageSnapshotBlob } from '../utils/imageSnapshot.js';"), 'captureImageSnapshotBlob is not imported in GalleryPage');
  // The persist block is kind-agnostic: the same vaultSnapshotBlob variable
  // feeds the vault-preview-<id> local + remote writes for video and image.
  assert.ok(vaultFn.includes('setCachedThumb(`vault-preview-${saved.id}`, vaultSnapshotBlob)'));
});

// ------------------------------------------- 2.19.34 legacy decrypt fix ---

// FIXED in 2.19.34. The detail modal's legacy decrypt check read
// `result.success` on the UNWRAPPED sendMessage value — useChromeMessage
// resolves with response.data, so the value is `{ blob }` with no
// `.success` field, and the modal threw 'Decrypt failed' for EVERY legacy
// blob even when the decrypt succeeded. Legacy blobs are rare
// (pre-chunking single-shot, vaulted before IVG1 landed in 2.12.8), so it
// went unnoticed. The decrypt step is now the shared helper
// `decryptLegacyVaultBlob` (used by the modal AND the image derivation),
// which reads `decrypted?.blob` directly. The SW response shape is
// unchanged — the caller was fixed, not the contract.

const legacyParams = {
  id: 'legacy-1',
  url: 'https://ud.example/b.bin',
  fileId: '9',
  chunks: [],
  mimeType: 'image/png',
  vaultHost: 'udrop',
  hostCopies: [{ host: 'udrop', encryptedBlobUrl: 'https://ud.example/b.bin', encryptedBlobFileId: '9' }],
};

test('2.19.34 (2026-11-22): decryptLegacyVaultBlob returns the blob from an unwrapped { blob } value — no .success field anywhere', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const seen = [];
  const sendMessage = async (action, data) => {
    seen.push([action, data]);
    // Exactly what useChromeMessage resolves with: response.data, no
    // success/error wrapper. The old modal check read .success off this
    // and always threw.
    return { blob: new Blob([bytes], { type: 'image/png' }) };
  };
  const blob = await decryptLegacyVaultBlob(sendMessage, legacyParams);
  assert.ok(blob instanceof Blob);
  assert.equal(blob.size, bytes.length);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], 'vaultDecryptBlob');
  assert.equal(seen[0][1].id, 'legacy-1');
  assert.equal(seen[0][1].vaultHost, 'udrop');
  assert.deepEqual(await new Uint8Array(await blob.arrayBuffer()), bytes);
});

test('2.19.34 (2026-11-22): decryptLegacyVaultBlob throws loudly when the decrypt resolves with no blob — never a silently empty decrypt', async () => {
  const sendMessage = async () => ({});
  await assert.rejects(() => decryptLegacyVaultBlob(sendMessage, legacyParams), /no bytes/);
});

test('2.19.34 (2026-11-22): decryptLegacyVaultBlob throws loudly on an empty blob', async () => {
  const sendMessage = async () => ({ blob: new Blob([], { type: 'image/png' }) });
  await assert.rejects(() => decryptLegacyVaultBlob(sendMessage, legacyParams), /no bytes/);
});

test('2.19.34 (2026-11-22): decryptLegacyVaultBlob lets a rejected sendMessage through — the real SW error surfaces, not a generic failure', async () => {
  const sendMessage = async () => { throw new Error('vault locked'); };
  await assert.rejects(() => decryptLegacyVaultBlob(sendMessage, legacyParams), /vault locked/);
});

// ------------------------------------------- 2.19.35 image loading labels ---

// FIXED in 2.19.35. User report (2026-11-22): opening a vault IMAGE showed
// "Resolving stream link..." while it loaded — images have no stream, they
// are decrypted and loaded. The grid card was innocent (it says "deriving
// preview"); the leak was the detail modal's renderVaultMedia, whose
// resolving + error labels were kind-agnostic: every encrypted item,
// image included, read "Resolving stream link..." / "Stream unavailable"
// during the terabox dlink resolve (up to 30s+). The modal now classifies
// the item with getVaultMediaKind — the SAME classification that picks the
// <video>/<audio>/<img> element, so the label and the element can never
// disagree — and images get "Loading image..." / "Image unavailable".
// Video and audio wording is byte-identical (they genuinely stream).

test('2.19.35 (2026-11-22): the modal resolving label is kind-aware — images load, videos/audio resolve a stream link', () => {
  const vault = src('../src/pages/VaultPage.jsx');
  const media = vault.slice(vault.indexOf('const renderVaultMedia'));
  assert.ok(media.includes("{mediaKind === 'image' ? 'Loading image...' : 'Resolving stream link...'}"), 'resolving label is not kind-aware');
});

test('2.19.35 (2026-11-22): the modal error heading is kind-aware — "Image unavailable" for images, "Stream unavailable" kept for video/audio', () => {
  const vault = src('../src/pages/VaultPage.jsx');
  const media = vault.slice(vault.indexOf('const renderVaultMedia'));
  assert.ok(media.includes("{mediaKind === 'image' ? 'Image unavailable' : 'Stream unavailable'}"), 'error heading is not kind-aware');
});

test('2.19.35 (2026-11-22): the resolve-failure detail is kind-aware — it surfaces under the modal heading, so an image must never read "stream link"', () => {
  const vault = src('../src/pages/VaultPage.jsx');
  const resolve = vault.slice(vault.indexOf('const ensureStreamResolved'));
  assert.ok(resolve.includes("getVaultMediaKind(item) === 'image' ? 'Failed to resolve image link' : 'Failed to resolve stream link'"), 'resolve failure message is not kind-aware');
});

test('2.19.35 (2026-11-22): the modal labels and the rendered element share one classification — getVaultMediaKind, audio checked before video', () => {
  const vault = src('../src/pages/VaultPage.jsx');
  const helperAt = vault.indexOf('const getVaultMediaKind');
  assert.ok(helperAt > 0, 'getVaultMediaKind is missing');
  const helper = vault.slice(helperAt, vault.indexOf('};', helperAt));
  // Songs were vaulted with kind 'audio' — the audio check must come first,
  // exactly like the classification renderVaultMedia used to inline.
  assert.ok(helper.indexOf("return 'audio'") > 0 && helper.indexOf("return 'audio'") < helper.indexOf("return isVideo ? 'video' : 'image'"), 'audio is not classified before video');
  const media = vault.slice(vault.indexOf('const renderVaultMedia'));
  assert.ok(media.includes('const mediaKind = getVaultMediaKind(item);'), 'renderVaultMedia does not use the shared classifier');
  assert.ok(media.includes('const isAudio = mediaKind === \'audio\';'), 'isAudio is not derived from the shared classifier');
  assert.ok(media.includes('const isVideo = mediaKind === \'video\';'), 'isVideo is not derived from the shared classifier');
});

test('2.19.35 (2026-11-22): the grid image card contains NO "stream" wording anywhere — it derives, it never streams', () => {
  const vault = src('../src/pages/VaultPage.jsx');
  const thumb = vault.slice(vault.indexOf('function VaultEncryptedImageThumb'), vault.indexOf('export default function VaultPage'));
  assert.ok(thumb.length > 0, 'VaultEncryptedImageThumb not found');
  assert.ok(!/stream/i.test(thumb), 'image thumb component mentions "stream"');
});

test('2.19.35 (2026-11-22): the grid image card keeps exactly one loading label — "deriving preview"; the modal label never leaks into the card', () => {
  const vault = src('../src/pages/VaultPage.jsx');
  const thumb = vault.slice(vault.indexOf('function VaultEncryptedImageThumb'), vault.indexOf('export default function VaultPage'));
  assert.equal((thumb.match(/deriving preview/g) || []).length, 1, 'image card does not have exactly one "deriving preview" label');
  assert.ok(!thumb.includes('Loading image...'), 'modal loading label leaked into the grid card');
});

test('2.19.35 (2026-11-22): the image derivation errors never mention "stream" — no stream wording on any image path', () => {
  const pv = preview();
  const imageFn = pv.slice(pv.indexOf('async function runImageExtraction'), pv.indexOf('export function requestVaultImagePreview'));
  assert.ok(imageFn.length > 0, 'runImageExtraction not found');
  // The 'application/octet-stream' MIME fallback is a technical constant,
  // not a label — exclude it before checking.
  const withoutMime = imageFn.replaceAll('application/octet-stream', '');
  assert.ok(!/stream/i.test(withoutMime), 'image derivation mentions "stream"');
});
