// unit tests for the upload-run ledger (2.19.3)
//
// run:  node test-upload-run-ledger.mjs
//
// WHY THIS EXISTS: a finished upload kept coming back to life as a "running"
// run, and the worker then settled it as interrupted with "Nothing was saved
// for this upload" - while the item was already in the database. Two causes:
//   1. the gallery's `finally` read `runOutcome`, which was declared INSIDE
//      the try block (block scope) - that threw before the run could close
//   2. a progress tick that was still in flight could write its stale
//      "running" snapshot AFTER the close, because the ledger had no
//      compare-and-set
//
// The ledger now serialises every read-modify-write, so a late tick finds a
// terminal run and does nothing.
import {
  UPLOAD_RUN_STATUS,
  describeSavedOutcome,
  finishUploadRun,
  getUploadRun,
  settleInterruptedUploadRun,
  startUploadRun,
  updateUploadRun,
} from './src/utils/uploadRun.js';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// --- chrome stub --------------------------------------------------------
const store = new Map();
// Lets a test hold a specific storage write open, so the read/write
// interleaving can be forced instead of hoped for.
let blockedSet = null;
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const wanted = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : [...store.keys()]);
        const out = {};
        for (const key of wanted) {
          if (store.has(key)) out[key] = store.get(key);
        }
        return out;
      },
      set: async (obj) => {
        if (blockedSet && blockedSet.match(obj)) {
          await blockedSet.promise;
        }
        for (const [k, v] of Object.entries(obj)) store.set(k, v);
      },
      remove: async (key) => { store.delete(key); },
    },
    sync: { get: async () => ({}), set: async () => {} },
  },
};

// --- a normal close -----------------------------------------------------
await startUploadRun({
  kind: 'video',
  owner: 'page',
  hosts: ['TeraBox', 'Telegram'],
  hostKeys: ['terabox', 'telegram'],
  fileName: 'clip.mkv',
  bytesTotal: 900,
});

let run = await getUploadRun();
check('a new run starts as running', run.status === UPLOAD_RUN_STATUS.RUNNING, run.status);
check('the run keeps its hosts', run.hosts.join(',') === 'TeraBox,Telegram', run.hosts.join(','));
check('a new run has no saved item yet', !run.savedItemId);

// --- the late progress tick --------------------------------------------
let releaseSet;
const gate = new Promise((resolve) => { releaseSet = resolve; });
// Only the late progress tick is held open. The close write carries the run
// record too (with its own percent), so it must NOT be blocked - otherwise
// both writes would queue up and the ordering would be a coin flip.
blockedSet = { match: (obj) => obj?.uploadRun?.percent === 100, promise: gate };

const progressPromise = updateUploadRun({ percent: 100, bytesSent: 900 });
await tick();
const finishPromise = finishUploadRun(UPLOAD_RUN_STATUS.WARNING, 'partial success', {
  savedItemId: 'item-42',
  hostsDone: { terabox: { fileId: 'fs-1' } },
});
await tick();
releaseSet();
await Promise.all([progressPromise, finishPromise]);
blockedSet = null;

run = await getUploadRun();
check('a late progress tick cannot resurrect a closed run', run.status === UPLOAD_RUN_STATUS.WARNING, run.status);
check('the closed run keeps its summary', run.summary === 'partial success', run.summary);
check('the closed run carries the saved item id', run.savedItemId === 'item-42', run.savedItemId);
check('the late tick did not overwrite the saved item id', run.savedItemId === 'item-42');
check('the closed run records the hosts that finished', Boolean(run.hostsDone?.terabox));
check('the closed run has a completedAt stamp', Number(run.completedAt) > 0);
check('closing a run clears the uploadActive flag', store.get('uploadActive') === false);

// --- a progress tick after the close is a no-op --------------------------
await updateUploadRun({ percent: 100, bytesSent: 900 });
run = await getUploadRun();
check('a tick after the close changes nothing', run.status === UPLOAD_RUN_STATUS.WARNING, run.status);
check('a tick after the close keeps the saved item id', run.savedItemId === 'item-42');

// --- settling an already closed run is a no-op --------------------------
const settled = await settleInterruptedUploadRun('The browser was closed while ...', {});
check('an already closed run is not settled again', settled.status === UPLOAD_RUN_STATUS.WARNING, settled.status);
check('the summary of a closed run is untouched', settled.summary === 'partial success', settled.summary);

// --- the saved-outcome sentence ----------------------------------------
check(
  'a saved item is reported as saved',
  describeSavedOutcome({ savedItemId: 'item-42' }).includes('The item was saved to the gallery (ID item-42)'),
  describeSavedOutcome({ savedItemId: 'item-42' })
);
check(
  'hosts without a saved item say the item is missing',
  describeSavedOutcome({ hostsDone: { terabox: {} } }).includes('the gallery item was not saved'),
  describeSavedOutcome({ hostsDone: { terabox: {} } })
);
check(
  'a run that got nowhere says nothing was saved',
  describeSavedOutcome({}) === 'Nothing was saved for this upload.',
  describeSavedOutcome({})
);
check(
  'a saved item wins over the hosts that finished',
  describeSavedOutcome({ savedItemId: 'x', hostsDone: { terabox: {} } }).includes('was saved to the gallery')
);

// --- an unknown status is refused ---------------------------------------
let threw = false;
try {
  await finishUploadRun('not-a-status', 'nope');
} catch (error) {
  threw = String(error?.message || '').includes('Unknown upload run status');
}
check('an unknown status is refused loudly', threw);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  process.exitCode = 1;
}
