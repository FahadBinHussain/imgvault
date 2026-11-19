// node:test suite for the small pure utils:
//   src/utils/sceneConfig.js, src/utils/vaultVideoNormalizer.js,
//   src/utils/videoSnapshot.js (type guard only — the rest needs a DOM),
//   src/utils/uploadRun.js (GAP coverage: the legacy test-upload-run-ledger
//   covers start/update/finish/settle + describeSavedOutcome; this file pins
//   the pure describers, the summary repair helpers it does not reach, the
//   lock, the archiver, and the session-id functions).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { flattenSceneConfig, isNestedSceneConfig } from '../src/utils/sceneConfig.js';
import { needsVaultVideoNormalization, normalizeVaultVideo } from '../src/utils/vaultVideoNormalizer.js';
import { captureVideoSnapshotBlob } from '../src/utils/videoSnapshot.js';
import {
  TERMINAL_UPLOAD_STATUSES,
  UPLOAD_OWNER,
  UPLOAD_RUN_KEY,
  UPLOAD_RUN_STATUS,
  UPLOAD_SESSION_KEY,
  UPLOAD_STALL_WINDOW_MS,
  archiveUploadRun,
  describeSavedOutcome,
  describeUploadProgress,
  describeUploadRun,
  ensureBrowserSessionId,
  finishUploadRun,
  formatBytes,
  getUploadRun,
  isTerminalUploadStatus,
  isUploadRunStalled,
  needsSavedOutcomeRepair,
  repairSavedOutcomeSummary,
  rotateBrowserSessionId,
  splitInterruptedSummary,
  startUploadRun,
  withUploadRunLock,
} from '../src/utils/uploadRun.js';

describe('sceneConfig', () => {
  test('isNestedSceneConfig detects the worldlabs dump shape', () => {
    assert.equal(isNestedSceneConfig({ camera: {}, scene: {}, controls: {} }), true);
    assert.equal(isNestedSceneConfig({ camera: {} }), true);
    assert.equal(isNestedSceneConfig({ scene: {} }), true);
    assert.equal(isNestedSceneConfig({ controls: {} }), true);
    assert.equal(isNestedSceneConfig({ position: [0, 0, 0] }), false);
    assert.equal(isNestedSceneConfig({}), false);
    assert.equal(isNestedSceneConfig(null), false);
    assert.equal(isNestedSceneConfig('nope'), false);
  });
  test('flattenSceneConfig flattens a nested config', () => {
    const out = flattenSceneConfig({
      camera: { position: [0, 0, 5], quaternion: [0, 0, 0, 1], fov_y_deg: 45 },
      scene: { position: [1, 2, 3], rotation: [0, 1, 0], offset: [0, 0, 0] },
      controls: { camera_radius: 7, orbit_radius: 9, duration: 12 },
    });
    assert.deepEqual(out, {
      position: [1, 2, 3],
      rotation: [0, 1, 0],
      offset: [0, 0, 0],
      cameraRadius: 7,
      radius: 9,
      duration: 12,
    });
  });
  test('cameraRadius falls back to the camera z position', () => {
    const out = flattenSceneConfig({
      camera: { position: [0, 0, 4.5] },
      scene: {},
      controls: {},
    });
    assert.equal(out.cameraRadius, 4.5);
    assert.equal(out.radius, null);
    assert.equal(out.duration, null);
  });
  test('missing vectors default to [0, 0, 0] and bad numbers to null', () => {
    const out = flattenSceneConfig({ scene: { position: [1, 2] }, controls: { duration: 'abc' } });
    assert.deepEqual(out.position, [0, 0, 0]);
    assert.deepEqual(out.rotation, [0, 0, 0]);
    assert.deepEqual(out.offset, [0, 0, 0]);
    assert.equal(out.duration, null);
  });
  test('numeric strings are coerced', () => {
    const out = flattenSceneConfig({ controls: { camera_radius: '7', orbit_radius: '9.5', duration: '12' } });
    assert.equal(out.cameraRadius, 7);
    assert.equal(out.radius, 9.5);
    assert.equal(out.duration, 12);
  });
  test('a flat config passes through untouched (same reference)', () => {
    const flat = { position: [1, 2, 3], rotation: [0, 0, 0], offset: [0, 0, 0] };
    assert.strictEqual(flattenSceneConfig(flat), flat);
    assert.strictEqual(flattenSceneConfig(null), null);
    assert.strictEqual(flattenSceneConfig(undefined), undefined);
  });
});

describe('vaultVideoNormalizer — needsVaultVideoNormalization', () => {
  test('avi and mov need normalization, mp4 and the rest do not', () => {
    assert.equal(needsVaultVideoNormalization({ name: 'clip.avi' }), true);
    assert.equal(needsVaultVideoNormalization({ name: 'clip.AVI' }), true);
    assert.equal(needsVaultVideoNormalization({ name: 'clip.mov' }), true);
    assert.equal(needsVaultVideoNormalization({ name: 'clip.MOV' }), true);
    assert.equal(needsVaultVideoNormalization({ name: 'clip.mp4' }), false);
    assert.equal(needsVaultVideoNormalization({ name: 'clip.mkv' }), false);
    assert.equal(needsVaultVideoNormalization({ name: 'clip.avi.bak' }), false);
    assert.equal(needsVaultVideoNormalization({ name: '' }), false);
    assert.equal(needsVaultVideoNormalization({}), false);
    assert.equal(needsVaultVideoNormalization(null), false);
  });
});

describe('vaultVideoNormalizer — normalizeVaultVideo', () => {
  test('a file that needs no normalization passes through unchanged', async () => {
    const file = new Blob(['fake-mp4-bytes'], { type: 'video/mp4' });
    file.name = 'clip.mp4';
    const out = await normalizeVaultVideo(file);
    assert.strictEqual(out.blob, file);
    assert.equal(out.fileName, 'clip.mp4');
    assert.equal(out.fileType, 'video/mp4');
    assert.equal(out.normalizedFrom, '');
  });
  test('the passthrough defaults the name and type when missing', async () => {
    const out = await normalizeVaultVideo(new Blob(['x']));
    assert.equal(out.fileName, 'video.mp4');
    assert.equal(out.fileType, 'video/mp4');
  });

  // The native FFmpeg path needs chrome.runtime.sendMessage; stub it with a
  // fake native host that echoes a 4-byte "converted" output.
  const fakeNativeHost = () => {
    const calls = [];
    const saved = globalThis.chrome;
    globalThis.chrome = {
      runtime: {
        lastError: undefined,
        sendMessage: (message, callback) => {
          calls.push(message);
          const { operation } = message.data || {};
          if (operation === 'finish') {
            callback({ success: true, data: { message: '4' } });
          } else if (operation === 'read') {
            callback({ success: true, data: { stdout: Buffer.from([9, 8, 7, 6]).toString('base64') } });
          } else {
            callback({ success: true, data: {} });
          }
        },
      },
    };
    return {
      calls,
      restore: () => {
        if (saved === undefined) delete globalThis.chrome;
        else globalThis.chrome = saved;
      },
    };
  };

  test('an .avi is converted through the native host and renamed to .mp4', async () => {
    const host = fakeNativeHost();
    try {
      const reports = [];
      const file = new File(['avi-bytes-here'], 'movie.avi', { type: 'video/avi' });
      const out = await normalizeVaultVideo(file, (msg) => reports.push(msg));
      assert.equal(out.blob.type, 'video/mp4');
      assert.equal(out.fileName, 'movie.mp4');
      assert.equal(out.fileType, 'video/mp4');
      assert.equal(out.normalizedFrom, 'movie.avi');
      assert.deepEqual(new Uint8Array(await out.blob.arrayBuffer()), new Uint8Array([9, 8, 7, 6]));
      const ops = host.calls.map((c) => c.data.operation);
      assert.deepEqual(ops, ['start', 'chunk', 'finish', 'read', 'cleanup']);
      assert.ok(reports.some((r) => r.includes('native FFmpeg')));
      assert.ok(reports.some((r) => r.includes('Converted movie.avi to MP4')));
    } finally {
      host.restore();
    }
  });
  test('a native failure is wrapped with the file name', async () => {
    const saved = globalThis.chrome;
    globalThis.chrome = {
      runtime: {
        lastError: undefined,
        sendMessage: (_message, callback) => callback({ success: false, error: 'ffmpeg missing' }),
      },
    };
    try {
      const file = new File(['avi'], 'bad.avi', { type: 'video/avi' });
      await assert.rejects(
        () => normalizeVaultVideo(file),
        (err) => err.message.includes('Could not normalize bad.avi') && err.message.includes('ffmpeg missing'),
      );
    } finally {
      if (saved === undefined) delete globalThis.chrome;
      else globalThis.chrome = saved;
    }
  });
});

describe('videoSnapshot (type guard only — capture needs a DOM)', () => {
  test('a non-Blob input rejects with the type error', async () => {
    await assert.rejects(
      () => captureVideoSnapshotBlob('not-a-blob'),
      /expected a Blob or File instance/,
    );
    await assert.rejects(() => captureVideoSnapshotBlob(null), /expected a Blob or File instance/);
  });
});

// --- uploadRun -----------------------------------------------------------
// chrome.storage stub, same shape as the legacy test-upload-run-ledger.mjs.
const store = new Map();
beforeEach(() => {
  store.clear();
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const wanted = Array.isArray(keys)
            ? keys
            : (typeof keys === 'string' ? [keys] : [...store.keys()]);
          const out = {};
          for (const key of wanted) {
            if (store.has(key)) out[key] = store.get(key);
          }
          return out;
        },
        set: async (obj) => {
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
        remove: async (key) => { store.delete(key); },
      },
    },
  };
});
afterEach(() => {
  delete globalThis.chrome;
});

describe('uploadRun constants', () => {
  test('keys, statuses, owners, and limits', () => {
    assert.equal(UPLOAD_RUN_KEY, 'uploadRun');
    assert.equal(UPLOAD_SESSION_KEY, 'imgvaultBrowserSessionId');
    assert.equal(UPLOAD_RUN_STATUS.RUNNING, 'running');
    assert.equal(UPLOAD_RUN_STATUS.INTERRUPTED, 'interrupted');
    assert.equal(UPLOAD_OWNER.PAGE, 'page');
    assert.equal(UPLOAD_OWNER.WORKER, 'worker');
    assert.equal(UPLOAD_STALL_WINDOW_MS, 90 * 1000);
    assert.deepEqual([...TERMINAL_UPLOAD_STATUSES].sort(), [
      'cancelled', 'error', 'interrupted', 'stalled', 'success', 'warning',
    ]);
  });
});

describe('isTerminalUploadStatus', () => {
  test('all six terminal states are terminal; running is not', () => {
    for (const s of ['success', 'error', 'warning', 'interrupted', 'stalled', 'cancelled']) {
      assert.equal(isTerminalUploadStatus(s), true, s);
    }
    assert.equal(isTerminalUploadStatus('running'), false);
    assert.equal(isTerminalUploadStatus(''), false);
    assert.equal(isTerminalUploadStatus(null), false);
    assert.equal(isTerminalUploadStatus(undefined), false);
    assert.equal(isTerminalUploadStatus('bogus'), false);
  });
});

describe('formatBytes (uploadRun)', () => {
  test('zero, negative, and non-finite inputs read 0 B', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(-5), '0 B');
    assert.equal(formatBytes(NaN), '0 B');
    assert.equal(formatBytes(Infinity), '0 B');
    assert.equal(formatBytes('nope'), '0 B');
  });
  test('bytes and KB', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1023), '1023 B');
    assert.equal(formatBytes(1024), '1.0 KB');
    assert.equal(formatBytes(1536), '1.5 KB');
  });
  test('values >= 100 drop the decimal', () => {
    assert.equal(formatBytes(100 * 1024 * 1024), '100 MB');
    assert.equal(formatBytes(99.5 * 1024 * 1024), '99.5 MB');
  });
  test('GB and TB', () => {
    assert.equal(formatBytes(5 * 1024 * 1024 * 1024), '5.0 GB');
    assert.equal(formatBytes(1024 * 1024 * 1024 * 1024), '1.0 TB');
  });
});

describe('splitInterruptedSummary', () => {
  test('splits reason from each known outcome sentence', () => {
    assert.deepEqual(splitInterruptedSummary('The tab closed. Nothing was saved for this upload.'), {
      reason: 'The tab closed.',
      outcome: 'Nothing was saved for this upload.',
    });
    assert.deepEqual(
      splitInterruptedSummary('No progress. The upload reached TeraBox, but the gallery item was not saved.'),
      {
        reason: 'No progress.',
        outcome: 'The upload reached TeraBox, but the gallery item was not saved.',
      },
    );
    assert.deepEqual(
      splitInterruptedSummary('Closed. The item was saved to the gallery (ID abc-123).'),
      {
        reason: 'Closed.',
        outcome: 'The item was saved to the gallery (ID abc-123).',
      },
    );
  });
  test('a summary with no outcome sentence keeps everything as the reason', () => {
    assert.deepEqual(splitInterruptedSummary('Something went wrong'), {
      reason: 'Something went wrong',
      outcome: '',
    });
    assert.deepEqual(splitInterruptedSummary(''), { reason: '', outcome: '' });
    assert.deepEqual(splitInterruptedSummary(null), { reason: '', outcome: '' });
  });
  test('an outcome sentence mid-summary does not split (it must be last)', () => {
    const out = splitInterruptedSummary('Nothing was saved for this upload. Then more happened.');
    assert.equal(out.outcome, '');
  });
});

describe('needsSavedOutcomeRepair / repairSavedOutcomeSummary', () => {
  const lyingRun = {
    id: 'upload-run-1',
    status: UPLOAD_RUN_STATUS.INTERRUPTED,
    fileName: 'clip.mkv',
    hosts: ['Telegram', 'TeraBox'],
    hostKeys: ['telegram', 'terabox'],
    hostsDone: { terabox: { apiStatus: 'success' } },
    summary: 'The tab closed. Nothing was saved for this upload.',
  };
  test('a non-interrupted run needs no repair', () => {
    assert.equal(needsSavedOutcomeRepair({ ...lyingRun, status: UPLOAD_RUN_STATUS.SUCCESS }), false);
    assert.equal(needsSavedOutcomeRepair({ ...lyingRun, status: UPLOAD_RUN_STATUS.RUNNING }), false);
    assert.equal(needsSavedOutcomeRepair(null), false);
  });
  test('an interrupted run with no outcome sentence needs no repair', () => {
    assert.equal(needsSavedOutcomeRepair({ ...lyingRun, summary: 'Something went wrong' }), false);
  });
  test('an interrupted run that already names the saved item needs no repair', () => {
    assert.equal(needsSavedOutcomeRepair({
      ...lyingRun,
      summary: 'Closed. The item was saved to the gallery (ID abc).',
    }), false);
  });
  test('a lying run is detected even without host evidence (the repair itself is then a no-op)', () => {
    const noEvidence = { ...lyingRun, hostsDone: {} };
    assert.equal(needsSavedOutcomeRepair(noEvidence), true);
    // ...but the corrected sentence IS the legacy sentence, so nothing changes
    assert.strictEqual(repairSavedOutcomeSummary(noEvidence), noEvidence);
  });
  test('repairSavedOutcomeSummary returns non-interrupted and null runs unchanged', () => {
    const finished = { ...lyingRun, status: UPLOAD_RUN_STATUS.SUCCESS };
    assert.strictEqual(repairSavedOutcomeSummary(finished), finished);
    assert.strictEqual(repairSavedOutcomeSummary(null), null);
    const noOutcome = { ...lyingRun, summary: 'Something went wrong' };
    assert.strictEqual(repairSavedOutcomeSummary(noOutcome), noOutcome);
  });
  test('repair is idempotent: an already-saved sentence is never downgraded to the host claim', () => {
    const alreadySaved = { ...lyingRun, summary: 'Closed. The item was saved to the gallery (ID abc).' };
    assert.strictEqual(repairSavedOutcomeSummary(alreadySaved), alreadySaved);
    // and a repaired run repairs to the same thing a second time
    const repaired = repairSavedOutcomeSummary(lyingRun);
    assert.strictEqual(repairSavedOutcomeSummary(repaired), repaired);
    const repairedWithId = repairSavedOutcomeSummary(lyingRun, 'item-42');
    assert.strictEqual(repairSavedOutcomeSummary(repairedWithId, 'item-42'), repairedWithId);
  });
  test('the repair replaces the lie with the host truth and keeps the reason', () => {
    const repaired = repairSavedOutcomeSummary(lyingRun);
    assert.equal(
      repaired.summary,
      'The tab closed. The upload reached TeraBox, but the gallery item was not saved.',
    );
    assert.equal(repaired.status, UPLOAD_RUN_STATUS.INTERRUPTED);
  });
  test('a found item id replaces the wrong claim and is recorded on the run', () => {
    const repaired = repairSavedOutcomeSummary(lyingRun, 'item-42');
    assert.equal(repaired.summary, 'The tab closed. The item was saved to the gallery (ID item-42).');
    assert.equal(repaired.savedItemId, 'item-42');
  });
  test('the run’s own savedItemId is used when no id is passed', () => {
    const repaired = repairSavedOutcomeSummary({ ...lyingRun, savedItemId: 'item-9' });
    assert.match(repaired.summary, /ID item-9/);
  });
});

describe('describeSavedOutcome', () => {
  test('a saved item wins', () => {
    assert.equal(
      describeSavedOutcome({ savedItemId: 'abc' }),
      'The item was saved to the gallery (ID abc).',
    );
  });
  test('finished hosts are named by label via the parallel hostKeys array', () => {
    assert.equal(
      describeSavedOutcome({
        hosts: ['Telegram', 'TeraBox'],
        hostKeys: ['telegram', 'terabox'],
        hostsDone: { terabox: {}, telegram: {} },
      }),
      'The upload reached TeraBox, Telegram, but the gallery item was not saved.',
    );
  });
  test('a host key with no label falls back to the key itself', () => {
    assert.equal(
      describeSavedOutcome({ hosts: [], hostKeys: [], hostsDone: { mystery: {} } }),
      'The upload reached mystery, but the gallery item was not saved.',
    );
  });
  test('nothing saved says so', () => {
    assert.equal(describeSavedOutcome({}), 'Nothing was saved for this upload.');
    assert.equal(describeSavedOutcome({ hostsDone: {} }), 'Nothing was saved for this upload.');
    assert.equal(describeSavedOutcome(null), 'Nothing was saved for this upload.');
  });
});

describe('describeUploadRun / describeUploadProgress', () => {
  test('describeUploadRun names hosts, file, and percent', () => {
    assert.equal(describeUploadRun(null), 'No upload');
    assert.equal(
      describeUploadRun({ hosts: ['TeraBox', 'Telegram'], fileName: 'clip.mkv', percent: 42 }),
      'TeraBox, Telegram · clip.mkv · 42%',
    );
    assert.equal(describeUploadRun({ kind: 'video' }), 'video');
    assert.equal(describeUploadRun({ hosts: [], kind: 'image', fileName: 'a.png' }), 'image · a.png');
    assert.equal(describeUploadRun({ hosts: ['TeraBox'], percent: 0 }), 'TeraBox · 0%');
    assert.equal(describeUploadRun({ hosts: ['TeraBox'], percent: null }), 'TeraBox');
  });
  test('describeUploadProgress reports bytes sent', () => {
    assert.equal(describeUploadProgress(null), '');
    assert.equal(describeUploadProgress({}), '');
    assert.equal(describeUploadProgress({ bytesSent: 0, bytesTotal: 100 }), '');
    assert.equal(describeUploadProgress({ bytesSent: 512 }), ' · 512 B sent');
    assert.equal(
      describeUploadProgress({ bytesSent: 1024 * 1024, bytesTotal: 2 * 1024 * 1024 }),
      ' · 1.0 MB / 2.0 MB',
    );
  });
});

describe('isUploadRunStalled', () => {
  const now = Date.now();
  test('only a running run can stall', () => {
    assert.equal(isUploadRunStalled({ status: UPLOAD_RUN_STATUS.SUCCESS, updatedAt: 0 }, now), false);
    assert.equal(isUploadRunStalled(null, now), false);
  });
  test('a running run with no heartbeat is stalled', () => {
    assert.equal(isUploadRunStalled({ status: 'running', updatedAt: 0 }, now), true);
    assert.equal(isUploadRunStalled({ status: 'running' }, now), true);
  });
  test('a running run stalls only after the 90s window', () => {
    assert.equal(isUploadRunStalled({ status: 'running', updatedAt: now - 89 * 1000 }, now), false);
    assert.equal(isUploadRunStalled({ status: 'running', updatedAt: now - 90 * 1000 }, now), false);
    assert.equal(isUploadRunStalled({ status: 'running', updatedAt: now - 90 * 1000 - 1 }, now), true);
  });
});

describe('withUploadRunLock', () => {
  test('tasks run in order, never concurrently', async () => {
    const order = [];
    const slow = withUploadRunLock(async () => {
      order.push('slow-start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('slow-end');
      return 'slow';
    });
    const fast = withUploadRunLock(async () => {
      order.push('fast');
      return 'fast';
    });
    assert.deepEqual(await Promise.all([slow, fast]), ['slow', 'fast']);
    assert.deepEqual(order, ['slow-start', 'slow-end', 'fast']);
  });
  test('a rejected task does not wedge the queue', async () => {
    await assert.rejects(() => withUploadRunLock(async () => { throw new Error('boom'); }), /boom/);
    assert.equal(await withUploadRunLock(async () => 'next'), 'next');
  });
});

describe('ensureBrowserSessionId / rotateBrowserSessionId', () => {
  test('ensure mints once and returns the stored id afterwards', async () => {
    const first = await ensureBrowserSessionId();
    assert.match(first, /^session-\d+-[a-z0-9]{8}$/);
    assert.equal(await ensureBrowserSessionId(), first);
    assert.equal(store.get(UPLOAD_SESSION_KEY), first);
  });
  test('rotate replaces the stored id', async () => {
    const first = await ensureBrowserSessionId();
    const next = await rotateBrowserSessionId();
    assert.notEqual(next, first);
    assert.equal(store.get(UPLOAD_SESSION_KEY), next);
    assert.equal(await ensureBrowserSessionId(), next);
  });
});

describe('archiveUploadRun', () => {
  test('archives a run into uploadLogHistory with timestamp + completedAt', async () => {
    const run = await startUploadRun({ kind: 'video', fileName: 'clip.mp4' });
    const closed = await finishUploadRun(UPLOAD_RUN_STATUS.SUCCESS, 'done');
    const history = store.get('uploadLogHistory');
    assert.equal(history.length, 1);
    assert.equal(history[0].id, run.id);
    assert.equal(history[0].status, 'success');
    assert.equal(history[0].summary, 'done');
    assert.equal(history[0].timestamp, closed.completedAt);
    assert.ok(history[0].completedAt > 0);
    assert.deepEqual(history[0].logs, []);
  });
  test('history is capped at 20, newest first', async () => {
    for (let i = 0; i < 22; i += 1) {
      await startUploadRun({ kind: 'image', fileName: `f${i}.png` });
      await finishUploadRun(UPLOAD_RUN_STATUS.SUCCESS, `run ${i}`);
    }
    const history = store.get('uploadLogHistory');
    assert.equal(history.length, 20);
    assert.equal(history[0].summary, 'run 21');
    assert.equal(history[19].summary, 'run 2');
  });
  test('archiveUploadRun defaults a missing status to error', async () => {
    const entry = await archiveUploadRun({ id: 'x', fileName: 'a.png' });
    assert.equal(entry.status, 'error');
    assert.ok(entry.timestamp > 0);
    assert.equal(entry.completedAt, entry.timestamp);
    assert.equal((await getUploadRun()), null);
  });
});

describe('finishUploadRun — empty savedItemId never overwrites a real one', () => {
  test('a progress tick’s saved item survives a close that carries no id', async () => {
    await startUploadRun({ kind: 'video', fileName: 'clip.mp4' });
    const { updateUploadRun } = await import('../src/utils/uploadRun.js');
    await updateUploadRun({ savedItemId: 'real-item' });
    const closed = await finishUploadRun(UPLOAD_RUN_STATUS.ERROR, 'failed late', { savedItemId: '' });
    assert.equal(closed.savedItemId, 'real-item');
  });
});
