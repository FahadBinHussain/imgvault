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
import { preferredPreviewCopies, setVaultPreviewPaused } from '../src/utils/vaultPreview.js';
import { getCachedThumb } from '../src/utils/thumbCache.js';

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
  const pv = preview();
  const fetchPlainAt = pv.indexOf('const fetchPlain = async (start, end) => {');
  const headFirstAt = pv.indexOf('const headFirst = await fetchPlain(0, Math.min(chunkSize, total) - 1);');
  assert.ok(fetchPlainAt > 0 && headFirstAt > fetchPlainAt);
  const normalizeAt = pv.indexOf('const normalizeBytes = (part) => {');
  assert.ok(normalizeAt > 0 && normalizeAt < fetchPlainAt);
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
