// Regression tests mined from the ImgVault bug history (AGENTS.md).
// Area: vault upload completion + progress visibility (2.19.36).
//
// User report (2026-11-24 08:50): a 128 MB vault upload read as "stuck
// there forever". The upload had COMPLETED at 08:07:25 — Telegram post
// msg 683 (134,461,770 B), TeraBox copy saved, item saved, snapshot
// cached, modal closed. Nothing was stuck and nothing was lost; the log
// panel just ended at "saved" with no completion state. Four defects,
// all code-verified:
//   1. no terminal success line and uploadStatus stayed "Saving encrypted
//      item..." forever after a successful save.
//   2. staging progress was mislabeled as upload progress, AND the
//      staging-100% line poisoned the shared uploadLogBytes watermark,
//      so the whole 4.5-min Telethon upload logged NOTHING. (This also
//      corrects the 2.19.32 rationale: the silence was the UPLOAD itself,
//      not server-side finalization — finalization was ~instant.)
//   3. appendClientUploadLog was a read-modify-write with fire-and-forget
//      callers — two appends in the same tick lost one line (the 100%
//      line vanished this way).
//   4. the post-save snapshot persists had no timeouts — a never-settling
//      IndexedDB open or sendMessage would freeze the modal after a
//      successful save.
//
// Live tests cover the extracted seams (progress tracker, label builder,
// withTimeout, serialized appender). The GalleryPage wiring is pinned
// with SOURCE-TEXT assertions, like the 2.19.32 tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createUploadProgressTracker, vaultUploadProgressLabel, UPLOAD_LOG_STEP_BYTES } from '../src/utils/uploadProgress.js';
import { withTimeout, TimeoutError } from '../src/utils/withTimeout.js';
import { createUploadLogAppender, UPLOAD_LOG_MAX_ENTRIES } from '../src/utils/uploadLog.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const gallery = () => src('../src/pages/GalleryPage.jsx');
const vaultFn = () => {
  const g = gallery();
  return g.slice(g.indexOf('const uploadVaultedDirectly'));
};

// ------------------------------------------------------- progress tracker ---

test('2.19.36 (2026-11-24): staging-100% followed by upload progress at 50% still logs — the phase change resets the watermark', () => {
  const tracker = createUploadProgressTracker();
  const MB = 1024 * 1024;
  // The 128 MB blob's staging phase, as logged 2026-11-24 08:02:31-43.
  assert.equal(tracker.shouldLog({ loaded: 60 * MB, percent: 47, phase: 'staging' }), true);
  assert.equal(tracker.shouldLog({ loaded: 100 * MB, percent: 78, phase: 'staging' }), true);
  assert.equal(tracker.shouldLog({ loaded: 120 * MB, percent: 94, phase: 'staging' }), true);
  assert.equal(tracker.shouldLog({ loaded: 128 * MB, percent: 100, phase: 'staging' }), true);
  // The real Telethon upload starts. With the old shared watermark this
  // logged NOTHING until 100% (loaded - 128MB stays negative); the phase
  // change resets the watermark, so 50% logs.
  assert.equal(tracker.shouldLog({ loaded: 1 * MB, percent: 1, phase: 'uploading' }), false);
  assert.equal(tracker.shouldLog({ loaded: 64 * MB, percent: 50, phase: 'uploading' }), true);
  assert.equal(tracker.shouldLog({ loaded: 128 * MB, percent: 100, phase: 'uploading' }), true);
});

test('2.19.36 (2026-11-24): the same loaded value logs again after a phase change — the reset is by phase, not by bytes', () => {
  const tracker = createUploadProgressTracker();
  const MB = 1024 * 1024;
  assert.equal(tracker.shouldLog({ loaded: 64 * MB, percent: 50, phase: 'staging' }), true);
  // Same 64 MB, new phase: without the reset this is 64 - 64 = 0 < step.
  assert.equal(tracker.shouldLog({ loaded: 64 * MB, percent: 50, phase: 'uploading' }), true);
});

test('2.19.36 (2026-11-24): within one phase the 20 MB throttle still holds — small steps stay quiet', () => {
  const tracker = createUploadProgressTracker();
  const MB = 1024 * 1024;
  assert.equal(UPLOAD_LOG_STEP_BYTES, 20 * 1024 * 1024);
  assert.equal(tracker.shouldLog({ loaded: 1 * MB, percent: 1, phase: 'uploading' }), false);
  assert.equal(tracker.shouldLog({ loaded: 19 * MB, percent: 15, phase: 'uploading' }), false);
  assert.equal(tracker.shouldLog({ loaded: 21 * MB, percent: 16, phase: 'uploading' }), true);
  assert.equal(tracker.shouldLog({ loaded: 40 * MB, percent: 31, phase: 'uploading' }), false);
  assert.equal(tracker.shouldLog({ loaded: 41 * MB, percent: 32, phase: 'uploading' }), true);
});

test('2.19.36 (2026-11-24): percent 100 always logs, even below the step', () => {
  const tracker = createUploadProgressTracker();
  assert.equal(tracker.shouldLog({ loaded: 1024, percent: 100, phase: 'uploading' }), true);
});

test('2.19.36 (2026-11-24): the vault label renders staging as staging and keeps the upload shape byte-identical', () => {
  const staging = vaultUploadProgressLabel({ serviceLabel: 'Telegram', phase: 'staging', percentLabel: '47% (60 MB / 128 MB)' });
  assert.ok(staging.includes('staging for native upload'), 'staging line does not name the phase');
  assert.ok(staging.includes('Telegram'), 'staging line loses the service label');
  assert.ok(!staging.startsWith('Uploading to Telegram: 47%'), 'staging line is indistinguishable from an upload line');
  const uploading = vaultUploadProgressLabel({ serviceLabel: 'Telegram', phase: 'uploading', percentLabel: '50% (64 MB / 128 MB)' });
  assert.equal(uploading, 'Uploading to Telegram: 50% (64 MB / 128 MB)');
  assert.ok(!uploading.includes('staging'));
  const phaseless = vaultUploadProgressLabel({ serviceLabel: 'TeraBox', phase: undefined, percentLabel: '50% (64 MB / 128 MB)' });
  assert.equal(phaseless, 'Uploading to TeraBox: 50% (64 MB / 128 MB)');
});

// ------------------------------------------------------------- withTimeout ---

test('2.19.36 (2026-11-24): withTimeout resolves with the promise value when it settles first', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 1000, 'fast op'), 'ok');
  assert.equal(await withTimeout(42, 1000, 'plain value'), 42);
});

test('2.19.36 (2026-11-24): withTimeout rejects a never-settling promise with a TimeoutError naming the label', async () => {
  const never = new Promise(() => {});
  await assert.rejects(
    withTimeout(never, 10, 'vault preview cache write'),
    (err) => {
      assert.ok(err instanceof TimeoutError, 'not a TimeoutError');
      assert.equal(err.name, 'TimeoutError');
      assert.match(err.message, /vault preview cache write timed out after 0s/);
      return true;
    },
  );
});

test('2.19.36 (2026-11-24): withTimeout passes a rejection through untouched — it is not wrapped as a timeout', async () => {
  const boom = new Error('storage exploded');
  await assert.rejects(
    withTimeout(Promise.reject(boom), 1000, 'failing op'),
    (err) => {
      assert.equal(err, boom);
      assert.notEqual(err.name, 'TimeoutError');
      return true;
    },
  );
});

// ------------------------------------------------------- serialized appender ---

// A chrome.storage.local fake whose get/set yield a tick — the interleaving
// that let two concurrent read-modify-writes clobber each other.
function makeYieldingStorage() {
  let logs = [];
  const yieldTick = () => new Promise((resolve) => setImmediate(resolve));
  return {
    async get() { await yieldTick(); return { uploadStatusLogs: [...logs] }; },
    async set(items) { await yieldTick(); logs = [...items.uploadStatusLogs]; },
    snapshot() { return logs; },
  };
}

test('2.19.36 (2026-11-24): 20 concurrent appends all land, newest first — none lost', async () => {
  const storage = makeYieldingStorage();
  const append = createUploadLogAppender(storage);
  await Promise.all(Array.from({ length: 20 }, (_, i) => append(`line ${i}`)));
  const logs = storage.snapshot();
  assert.equal(logs.length, 20, `lost ${20 - logs.length} lines`);
  assert.deepEqual(
    logs.map((entry) => entry.message),
    Array.from({ length: 20 }, (_, i) => `line ${19 - i}`),
  );
  assert.ok(logs.every((entry) => entry.type === 'info'));
});

test('2.19.36 (2026-11-24): CONTROL — the naive read-modify-write loses lines under the same storage, so the test above is not vacuous', async () => {
  const storage = makeYieldingStorage();
  const naiveAppend = async (message) => {
    const result = await storage.get(['uploadStatusLogs']);
    const nextLogs = [{ timestamp: 'x', message, type: 'info' }, ...(result.uploadStatusLogs || [])].slice(0, 200);
    await storage.set({ uploadStatusLogs: nextLogs });
  };
  await Promise.all(Array.from({ length: 20 }, (_, i) => naiveAppend(`line ${i}`)));
  assert.ok(storage.snapshot().length < 20, 'naive appender lost nothing — the yielding fake does not reproduce the race');
});

test('2.19.36 (2026-11-24): the log caps at 200 entries, newest first', async () => {
  const storage = makeYieldingStorage();
  const append = createUploadLogAppender(storage);
  assert.equal(UPLOAD_LOG_MAX_ENTRIES, 200);
  await Promise.all(Array.from({ length: 205 }, (_, i) => append(`line ${i}`)));
  const logs = storage.snapshot();
  assert.equal(logs.length, 200);
  assert.equal(logs[0].message, 'line 204');
  assert.equal(logs[199].message, 'line 5');
});

test('2.19.36 (2026-11-24): a failed append does not poison the chain — later appends still land', async () => {
  let logs = [];
  let setCalls = 0;
  const storage = {
    async get() { return { uploadStatusLogs: [...logs] }; },
    async set(items) {
      setCalls += 1;
      if (setCalls === 2) throw new Error('simulated storage failure');
      logs = [...items.uploadStatusLogs];
    },
  };
  const append = createUploadLogAppender(storage);
  await append('line 1');
  await assert.rejects(append('line 2'), /simulated storage failure/);
  await append('line 3');
  assert.deepEqual(logs.map((entry) => entry.message), ['line 3', 'line 1']);
});

// ------------------------------------------------- GalleryPage wiring (text) ---

test('2.19.36 (2026-11-24): the vault handler logs through the phase-aware tracker and the staging label', () => {
  const fn = vaultFn();
  assert.ok(fn.includes('const vaultProgressTracker = createUploadProgressTracker();'), 'vault handler does not create the tracker');
  assert.ok(fn.includes('vaultUploadProgressLabel({ serviceLabel: vaultService.label, phase, percentLabel })'), 'vault handler does not use the staging-aware label');
  assert.ok(fn.includes('vaultProgressTracker.shouldLog({ loaded, percent, phase })'), 'vault handler does not gate log lines on the tracker');
  assert.ok(gallery().includes("import { createUploadProgressTracker, vaultUploadProgressLabel } from '../utils/uploadProgress.js';"), 'tracker/label not imported');
});

test('2.19.36 (2026-11-24): the shared uploadLogBytes watermark is gone from the vault upload — it was the poison', () => {
  const fn = vaultFn();
  // Pin the mechanism's absence, not the word (the new comment names the
  // old variable when explaining why it went away).
  assert.ok(!fn.includes('let uploadLogBytes'), 'uploadVaultedDirectly still declares the shared watermark');
  assert.ok(!fn.includes('uploadLogBytes = loaded'), 'uploadVaultedDirectly still writes the shared watermark');
  assert.ok(!fn.includes('loaded - uploadLogBytes'), 'uploadVaultedDirectly still throttles on the shared watermark');
  assert.ok(!fn.includes('UPLOAD_LOG_STEP'), 'uploadVaultedDirectly still has the local step constant');
});

test('2.19.36 (2026-11-24): the corrected finalization theory is recorded in the vault handler comment', () => {
  const fn = vaultFn();
  assert.ok(fn.includes('2.19.36 correction'), 'finalizing comment does not carry the correction');
  assert.ok(fn.includes('Finalization itself was ~instant'), 'finalizing comment does not state finalization was instant');
  assert.ok(!fn.includes('observed ~3 min on a 72 MB blob'), 'the misattributed ~3 min claim is still in the vault handler');
});

test('2.19.36 (2026-11-24): after the save AND the snapshot persists, a terminal completion line lands and uploadStatus leaves "Saving..."', () => {
  const fn = vaultFn();
  const saveAt = fn.indexOf("sendMessage('saveVaultedUpload'");
  const remoteAt = fn.indexOf('persistRemoteVaultPreview({ id: saved.id }');
  const completionAt = fn.indexOf('Vault upload complete');
  assert.ok(saveAt > 0 && remoteAt > saveAt, 'save/snapshot anchors missing');
  assert.ok(completionAt > remoteAt, 'completion line does not come after the save + snapshot persists');
  assert.ok(fn.includes('const completionMessage = `✅ Vault upload complete — ${fileName} saved to ${hostLabels || \'vault hosts\'}`;'), 'completion line shape changed');
  assert.ok(fn.includes("await chrome.storage.local.set({ uploadStatus: completionMessage });"), 'uploadStatus is not set to the completion message');
  assert.ok(fn.includes("await appendClientUploadLog(completionMessage, 'success');"), 'completion line is not logged as success');
  assert.ok(fn.indexOf('uploadStatus: completionMessage') > saveAt, 'uploadStatus is not updated after the save');
});

test('2.19.36 (2026-11-24): both post-save persists are bounded by withTimeout and time out LOUDLY in the upload log', () => {
  const fn = vaultFn();
  // Both persists wrapped — a never-settling await can no longer freeze
  // the modal after a successful save.
  assert.ok(fn.includes('withTimeout(\n            setCachedThumb(`vault-preview-${saved.id}`, vaultSnapshotBlob),'), 'local cache write is not wrapped in withTimeout');
  assert.ok(fn.includes('withTimeout(\n            persistRemoteVaultPreview({ id: saved.id }, vaultSnapshotBlob, sendMessage),'), 'remote persist is not wrapped in withTimeout');
  assert.ok(fn.includes('VAULT_SNAPSHOT_PERSIST_TIMEOUT_MS'), 'no shared snapshot timeout constant');
  // Timeouts warn in the UPLOAD LOG (not just console) and name the
  // consequence — a missing snapshot means on-demand derivation.
  const warnings = fn.match(/snapshot skipped, the card will derive on demand/g) || [];
  assert.equal(warnings.length, 2, 'expected one loud timeout warning per persist');
  assert.ok(fn.includes("cacheErr?.name === 'TimeoutError'"), 'cache timeout is not distinguished from a plain failure');
  assert.ok(fn.includes("remoteErr?.name === 'TimeoutError'"), 'remote timeout is not distinguished from a plain failure');
  assert.ok(gallery().includes("import { withTimeout } from '../utils/withTimeout.js';"), 'shared withTimeout not imported');
  assert.ok(!gallery().includes('const withTimeout = (promise, ms, label)'), 'the local withTimeout copy was not removed');
});

test('2.19.36 (2026-11-24): appendClientUploadLog is the serialized appender, held in a ref — one chain per page', () => {
  const g = gallery();
  assert.ok(g.includes("import { createUploadLogAppender } from '../utils/uploadLog.js';"), 'appender factory not imported');
  assert.ok(g.includes('appendClientUploadLogRef.current = createUploadLogAppender(chrome.storage.local);'), 'appender is not created once per page');
  assert.ok(g.includes('const appendClientUploadLog = appendClientUploadLogRef.current;'), 'callers do not use the ref-held appender');
  assert.ok(!g.includes("const appendClientUploadLog = async (message, type = 'info') => {"), 'the old unserialized append is still there');
});
