// Regression tests mined from the ImgVault bug history (AGENTS.md).
// Area: upload runs — the interrupted-settle path (2.19.0), the
// runOutcome-before-try rule (2.19.3), resume skipping finished hosts
// (2.19.2), and the TeraBox resume-state loud failures (2.19.2).
//
// Live tests use an in-memory chrome.storage.local stub; no live
// network, no real credentials. The late-tick-cannot-reopen rule is
// pinned behaviourally by the legacy test-upload-run-ledger.mjs script,
// so this file pins it at the source level (the terminal check inside
// the lock) instead of re-writing those cases.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  UPLOAD_RUN_KEY,
  UPLOAD_RUN_STATUS,
  settleInterruptedUploadRun,
  getUploadRun,
} from '../src/utils/uploadRun.js';
import {
  ABSENT_BLOCK_MD5,
  calculateTeraBoxChunkSize,
  prepareResumeState,
  decideResumeCreateAction,
  assertCompleteBlockList,
} from '../src/utils/teraboxResume.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const gallery = () => src('../src/pages/GalleryPage.jsx');

function installStorage(initial = {}) {
  const store = { ...initial };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          if (typeof keys === 'string') return { [keys]: store[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, store[k]]));
          return { ...store };
        },
        set: async (items) => { Object.assign(store, items); },
        remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
      },
    },
  };
  return store;
}

function uninstallChrome() {
  delete globalThis.chrome;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

// ------------------------------------------- settleInterruptedUploadRun ---

test('2.19.0 (2026-11-03): settleInterruptedUploadRun closes a dead run as interrupted with the reason, clears uploadActive, archives it', async () => {
  const store = installStorage({
    [UPLOAD_RUN_KEY]: {
      id: 'upload-run-1', status: UPLOAD_RUN_STATUS.RUNNING, kind: 'video',
      fileName: 'clip.mp4', hosts: ['TeraBox'], startedAt: 1000, updatedAt: 1000,
    },
    uploadActive: true,
    uploadStatusLogs: ['log line'],
    uploadLogHistory: [],
  });
  try {
    const settled = await settleInterruptedUploadRun('The browser closed mid-upload.');
    assert.equal(settled.status, UPLOAD_RUN_STATUS.INTERRUPTED);
    assert.equal(settled.summary, 'The browser closed mid-upload.');
    assert.equal(settled.fileName, 'clip.mp4');
    assert.ok(settled.completedAt > 0);
    assert.equal(store.uploadActive, false);
    assert.equal(store[UPLOAD_RUN_KEY].status, UPLOAD_RUN_STATUS.INTERRUPTED);
    assert.equal(store.uploadLogHistory.length, 1);
    assert.equal(store.uploadLogHistory[0].id, 'upload-run-1');
    assert.equal(store.uploadLogHistory[0].status, UPLOAD_RUN_STATUS.INTERRUPTED);
    assert.deepEqual(store.uploadLogHistory[0].logs, ['log line']);
  } finally {
    uninstallChrome();
  }
});

test('2.19.0 (2026-11-03): settleInterruptedUploadRun with no run returns null and writes nothing', async () => {
  const store = installStorage({ uploadActive: false });
  try {
    const settled = await settleInterruptedUploadRun('The browser closed mid-upload.');
    assert.equal(settled, null);
    assert.equal(store[UPLOAD_RUN_KEY], undefined);
    assert.equal(store.uploadLogHistory, undefined);
  } finally {
    uninstallChrome();
  }
});

test('2.19.0 (2026-11-03): settleInterruptedUploadRun leaves an already-closed run untouched — no re-settle, no second archive entry', async () => {
  const closed = {
    id: 'upload-run-1', status: UPLOAD_RUN_STATUS.SUCCESS, kind: 'video',
    summary: 'Done.', completedAt: 5000, updatedAt: 5000,
  };
  const store = installStorage({
    [UPLOAD_RUN_KEY]: closed,
    uploadActive: false,
    uploadLogHistory: [{ ...closed, timestamp: 5000 }],
  });
  try {
    const settled = await settleInterruptedUploadRun('The browser closed mid-upload.');
    assert.equal(settled.status, UPLOAD_RUN_STATUS.SUCCESS);
    assert.equal(settled.summary, 'Done.');
    assert.equal(settled.completedAt, 5000);
    assert.equal(store.uploadLogHistory.length, 1);
  } finally {
    uninstallChrome();
  }
});

test('2.19.0 (2026-11-03): settleInterruptedUploadRun merges extra fields (hostsDone survives into the settled run)', async () => {
  installStorage({
    [UPLOAD_RUN_KEY]: {
      id: 'upload-run-1', status: UPLOAD_RUN_STATUS.RUNNING, kind: 'video',
      startedAt: 1000, updatedAt: 1000,
    },
    uploadActive: true,
    uploadLogHistory: [],
  });
  try {
    const settled = await settleInterruptedUploadRun('The browser closed mid-upload.', {
      hostsDone: { terabox: { watchUrl: 'https://terabox.example/v' } },
    });
    assert.deepEqual(settled.hostsDone, { terabox: { watchUrl: 'https://terabox.example/v' } });
    assert.equal((await getUploadRun()).hostsDone.terabox.watchUrl, 'https://terabox.example/v');
  } finally {
    uninstallChrome();
  }
});

// ------------------------------------------------------ teraboxResume ---

test('2.19.2 (2026-11-03): prepareResumeState throws loudly with no uploadid', () => {
  assert.throws(
    () => prepareResumeState({ size: 10 * MB, path: '/clip.mp4' }, '/clip.mp4', 10 * MB, 4 * MB),
    /has no uploadid - cannot resume/,
  );
});

test('2.19.2 (2026-11-03): prepareResumeState throws on a size mismatch naming expected vs got', () => {
  assert.throws(
    () => prepareResumeState(
      { uploadid: 'u1', size: 9 * MB, path: '/clip.mp4' }, '/clip.mp4', 10 * MB, 4 * MB,
    ),
    /does not match this file \(expected 9\.0 MB, got 10\.0 MB\)/,
  );
});

test('2.19.2 (2026-11-03): prepareResumeState throws on a path mismatch naming both paths', () => {
  assert.throws(
    () => prepareResumeState(
      { uploadid: 'u1', size: 10 * MB, path: '/other.mp4' }, '/clip.mp4', 10 * MB, 4 * MB,
    ),
    /expected path \/other\.mp4, got \/clip\.mp4/,
  );
});

test('2.19.2 (2026-11-03): prepareResumeState throws on a non-array blockList and on a blockList longer than the chunk count', () => {
  assert.throws(
    () => prepareResumeState(
      { uploadid: 'u1', size: 10 * MB, path: '/clip.mp4', blockList: 'not-an-array' },
      '/clip.mp4', 10 * MB, 4 * MB,
    ),
    /invalid blockList - expected an array/,
  );
  assert.throws(
    () => prepareResumeState(
      { uploadid: 'u1', size: 10 * MB, path: '/clip.mp4', blockList: ['a', 'b', 'c', 'd'] },
      '/clip.mp4', 10 * MB, 4 * MB,
    ),
    /expected 3 blocks, got 4/,
  );
});

test('2.19.2 (2026-11-03): prepareResumeState lets the persisted chunk size win and keeps sentinel/empty blocks absent', () => {
  const state = prepareResumeState(
    {
      uploadid: 'u1', size: 10 * MB, path: '/clip.mp4', chunkSize: 5 * MB,
      blockList: ['aaaabbbbccccddddaaaabbbbccccdddd', ABSENT_BLOCK_MD5],
      created: true, createdPath: '/clip.mp4',
    },
    '/clip.mp4', 10 * MB, 4 * MB,
  );
  assert.equal(state.chunkSize, 5 * MB);
  assert.equal(state.chunkCount, 2);
  assert.equal(state.blockList[0], 'aaaabbbbccccddddaaaabbbbccccdddd');
  assert.equal(state.blockList[1], undefined);
  assert.equal(state.presentBytes, 5 * MB);
  assert.equal(state.created, true);
  assert.equal(state.createdPath, '/clip.mp4');
  // An empty entry also means "never uploaded" and counts no bytes.
  const state2 = prepareResumeState(
    {
      uploadid: 'u1', size: 10 * MB, path: '/clip.mp4',
      blockList: ['aaaabbbbccccddddaaaabbbbccccdddd', '', 'eeeeffff00001111eeeeffff00001111'],
    },
    '/clip.mp4', 10 * MB, 4 * MB,
  );
  assert.equal(state2.chunkCount, 3);
  assert.equal(state2.blockList[1], undefined);
  assert.equal(state2.presentBytes, 4 * MB + 2 * MB);
});

test('2.19.2 (2026-11-03): decideResumeCreateAction — missing bytes win over created AND existingFile (upload first, create once)', () => {
  assert.equal(
    decideResumeCreateAction({ presentBytes: 4 * MB, size: 10 * MB, created: true, existingFile: { fs_id: 1 } }),
    'create',
  );
});

test('2.19.2 (2026-11-03): decideResumeCreateAction — all bytes + existing file reuses, all bytes + created-but-lost aborts, all bytes + neither creates', () => {
  assert.equal(
    decideResumeCreateAction({ presentBytes: 10 * MB, size: 10 * MB, existingFile: { fs_id: 1 } }),
    'reuse',
  );
  assert.equal(
    decideResumeCreateAction({ presentBytes: 10 * MB, size: 10 * MB, created: true }),
    'abort',
  );
  assert.equal(
    decideResumeCreateAction({ presentBytes: 10 * MB, size: 10 * MB }),
    'create',
  );
});

test('2.19.2 (2026-11-03): assertCompleteBlockList throws naming the exact missing/sentinel block', () => {
  assert.throws(
    () => assertCompleteBlockList(['aaaabbbbccccddddaaaabbbbccccdddd', undefined, 'eeeeffff00001111eeeeffff00001111'], 3),
    /missing block 2 of 3/,
  );
  assert.throws(
    () => assertCompleteBlockList(['aaaabbbbccccddddaaaabbbbccccdddd', ABSENT_BLOCK_MD5], 2),
    /block 2 of 2 is still marked absent/,
  );
  assert.deepEqual(
    assertCompleteBlockList(['aaaabbbbccccddddaaaabbbbccccdddd', 'eeeeffff00001111eeeeffff00001111'], 2),
    ['aaaabbbbccccddddaaaabbbbccccdddd', 'eeeeffff00001111eeeeffff00001111'],
  );
});

test('2.19.2 (2026-11-03): calculateTeraBoxChunkSize is 4 MB at the 4 GB boundary and never goes below 1 byte', () => {
  assert.equal(calculateTeraBoxChunkSize(4 * GB), 4 * MB);
  assert.equal(calculateTeraBoxChunkSize(4 * GB - 1), 4 * MB);
  assert.equal(calculateTeraBoxChunkSize(20 * MB), 4 * MB);
  assert.equal(calculateTeraBoxChunkSize(1 * MB), 1 * MB);
  assert.equal(calculateTeraBoxChunkSize(0), 1);
});

// FIXED 2.19.23: calculateTeraBoxChunkSize used to HANG FOREVER for any
// file over 4 GB — `threshold <<= 1` is a 32-bit shift, so the 4 GB
// threshold (2^32) became 0 on the first doubling and `streamSize >
// threshold` stayed true forever at 100% CPU. uploaders.js calls it with
// the real file size, so a >4 GB TeraBox upload hung the real uploader.
// The doubling is plain multiplication now, so the >4 GB cases below
// terminate and pin the chunk size at each boundary.
test('2.19.23: calculateTeraBoxChunkSize terminates past 4 GB and doubles per 4 GB threshold', () => {
  assert.equal(calculateTeraBoxChunkSize(5 * GB), 8 * MB);
  assert.equal(calculateTeraBoxChunkSize(8 * GB), 8 * MB);
  assert.equal(calculateTeraBoxChunkSize(9 * GB), 16 * MB);
  assert.equal(calculateTeraBoxChunkSize(16 * GB), 16 * MB);
  assert.equal(calculateTeraBoxChunkSize(17 * GB), 32 * MB);
  assert.equal(calculateTeraBoxChunkSize(100 * GB), 128 * MB);
});

// ------------------------------------------- source assertions (wiring) ---

test('2.19.3 (2026-11-03): runOutcome is declared BEFORE try in all three direct-upload functions', () => {
  const page = gallery();
  const cases = [
    ['uploadVideoDirectly', 'let runOutcome = {'],
    ['upload3DDirectly', 'let runOutcome3d = {'],
    ['uploadSceneDirectly', 'let runOutcomeScene = {'],
  ];
  for (const [fnName, decl] of cases) {
    const fnStart = page.indexOf(`const ${fnName} = `);
    assert.ok(fnStart > 0, `${fnName} not found`);
    const declAt = page.indexOf(decl, fnStart);
    const tryAt = page.indexOf('try {', fnStart);
    assert.ok(declAt > 0, `${decl} not found in ${fnName}`);
    assert.ok(tryAt > 0, `try not found in ${fnName}`);
    assert.ok(declAt < tryAt, `${decl} must be declared before try in ${fnName}`);
  }
  // pendingItemId too: the catch block removes the reserved DB row with it.
  const videoFn = page.indexOf('const uploadVideoDirectly = ');
  const pendingAt = page.indexOf('let pendingItemId = null;', videoFn);
  const tryAt = page.indexOf('try {', videoFn);
  assert.ok(pendingAt > 0 && pendingAt < tryAt);
});

test('2.19.0 (2026-11-03): endUploadRun sends the outcome FIRST and drops the owner port AFTER, in finally', () => {
  const page = gallery();
  const fn = page.slice(page.indexOf('const endUploadRun = async (status, summary, extra = {}) => {'));
  const sendAt = fn.indexOf("sendMessage('uploadRunFinished', { status, summary, extra })");
  const finallyAt = fn.indexOf('} finally {');
  const closeAt = fn.indexOf('closeUploadOwnerPort();', finallyAt);
  assert.ok(sendAt > 0 && finallyAt > sendAt && closeAt > finallyAt);
});

test('2.19.2 (2026-11-03): a resume reuses a finished host instead of uploading a second copy to it', () => {
  const page = gallery();
  assert.ok(page.includes('if (hostsDone[service.key]) {'));
  assert.ok(page.includes('uploadResults[service.key] = hostsDone[service.key];'));
  assert.ok(page.includes('finished before the interruption - reusing that upload instead of uploading the file again.'));
});

test('2.19.3 (2026-11-03): updateUploadRun checks the terminal state INSIDE the lock — a late tick cannot resurrect a closed run', () => {
  const run = src('../src/utils/uploadRun.js');
  const fn = run.slice(run.indexOf('export async function updateUploadRun'));
  const lockAt = fn.indexOf('withUploadRunLock(async () => {');
  const checkAt = fn.indexOf('if (!run || isTerminalUploadStatus(run.status)) {');
  assert.ok(lockAt > 0 && checkAt > lockAt);
  assert.ok(fn.includes('return run;'));
});

test('2.19.4 (2026-11-03): finalizeUploadedVideo passes extraMetadataDeletes so the pending flags die with the mirror merge', () => {
  const bg = src('../src/background/background.js');
  assert.ok(bg.includes('{ extraMetadataDeletes: PENDING_UPLOAD_EXTRA_KEYS }'));
  assert.ok(bg.includes("import { PENDING_UPLOAD_EXTRA_KEYS, withoutPendingUploadFlags } from '../utils/pendingUpload.js';"));
});
