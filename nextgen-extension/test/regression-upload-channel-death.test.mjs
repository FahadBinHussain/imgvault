// Regression tests mined from the ImgVault bug history (AGENTS.md).
// Area: the native-upload channel death (2.19.40) — a 381 MB vault upload
// stuck at 74% on 2026-11-24 because the page's event stream died while
// the host finished the upload (channel msg 701 landed, the page never
// saw the result, no vault item was saved). The fix: a host-side upload
// journal, a page heartbeat that recovers through it, a durable vault
// intent so the worker can finish the save, and a reload guard.
//
// Live tests stub chrome.storage.local and chrome.runtime.connectNative;
// no live network, no real credentials. Source-text assertions cover the
// wiring that cannot be imported in plain node (background.js, GalleryPage).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  VAULT_UPLOAD_INTENT_KEY,
  createVaultUploadIntent,
  getVaultUploadIntent,
  saveVaultUploadIntent,
  updateVaultUploadIntent,
  recordVaultUploadHostResult,
  clearVaultUploadIntent,
  buildVaultEncryptedPayload,
  decideVaultUploadRecovery,
} from '../src/utils/vaultUploadIntent.js';
import {
  NATIVE_UPLOAD_SILENCE_MS,
  readUploadJournal,
  deleteUploadJournal,
  uploadTelegramNative,
} from '../src/utils/telegramApi.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const background = () => src('../src/background/background.js');
const gallery = () => src('../src/pages/GalleryPage.jsx');
const reloadScript = () => src('../../tools/reload-extension.ps1');
const probeScript = () => src('../../tools/probe-upload-state.py');
const hostMain = () => src('../../native-host/src-tauri/src/main.rs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One native-host port speaking sequential request/response, like the real
// Rust host: each message gets exactly one answer, in order. (Same shape
// as regression-telegram.test.mjs's FakeNativePort.)
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

function installChrome({ connectNativeHandler, initialStorage = {} } = {}) {
  const store = { ...initialStorage };
  const ports = [];
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
    runtime: {
      lastError: undefined,
      connectNative: () => {
        const port = new FakeNativePort(connectNativeHandler);
        ports.push(port);
        return port;
      },
    },
  };
  return { ports, store };
}

function uninstallChrome() {
  delete globalThis.chrome;
}

function sampleIntent(overrides = {}) {
  return createVaultUploadIntent({
    runId: 'run-1',
    fileName: 'clip.mp4',
    blobSize: 399455208,
    opaqueName: 'abc123.bin',
    encryptedMetadata: 'bWV0YQ==',
    encryptedMimeType: 'video/mp4',
    uploadData: { kind: 'video', isVideo: true, fileName: 'clip.mp4', fileSize: 399455208 },
    vaultHostKeys: ['terabox', 'telegram'],
    telegramChannel: '3959088547',
    ...overrides,
  });
}

const teraboxCopy = {
  host: 'terabox',
  encryptedBlobUrl: 'https://terabox.example/dlink',
  encryptedBlobWatchUrl: 'https://terabox.example/watch',
  encryptedBlobFileId: 'fs-1',
  encryptedBlobMessageId: '',
};

const telegramCopy = {
  host: 'telegram',
  encryptedBlobUrl: 'https://t.me/c/3959088547/701',
  encryptedBlobWatchUrl: 'https://t.me/c/3959088547/701',
  encryptedBlobFileId: 'native-701',
  encryptedBlobMessageId: '701',
};

// ------------------------------------------------------- intent storage ---

test('2.19.40 (2026-11-24): the vault intent round-trips through storage and records each host leg as it lands', async () => {
  installChrome();
  try {
    assert.equal(await getVaultUploadIntent(), null);
    await saveVaultUploadIntent(sampleIntent());
    let intent = await getVaultUploadIntent();
    assert.equal(intent.runId, 'run-1');
    assert.equal(intent.telegramRequestId, '');
    assert.deepEqual(intent.hostResults, {});

    await updateVaultUploadIntent({ telegramRequestId: 'tg-upload-1' });
    intent = await getVaultUploadIntent();
    assert.equal(intent.telegramRequestId, 'tg-upload-1');

    await recordVaultUploadHostResult('terabox', teraboxCopy);
    intent = await getVaultUploadIntent();
    assert.deepEqual(intent.hostResults.terabox, teraboxCopy);
    assert.equal(intent.hostResults.telegram, undefined);

    await clearVaultUploadIntent();
    assert.equal(await getVaultUploadIntent(), null);
  } finally {
    uninstallChrome();
  }
});

test('2.19.40 (2026-11-24): an intent patch or host result never resurrects a cleared intent', async () => {
  installChrome();
  try {
    assert.equal(await updateVaultUploadIntent({ telegramRequestId: 'x' }), null);
    assert.equal(await recordVaultUploadHostResult('terabox', teraboxCopy), null);
    assert.equal(await getVaultUploadIntent(), null);
  } finally {
    uninstallChrome();
  }
});

test('2.19.40 (2026-11-24): the intent key is stable — the page and the worker must read the same slot', () => {
  assert.equal(VAULT_UPLOAD_INTENT_KEY, 'vaultUploadIntent');
  assert.match(background(), /from '\.\.\/utils\/vaultUploadIntent\.js'/);
  assert.match(gallery(), /from '\.\.\/utils\/vaultUploadIntent\.js'/);
});

// ----------------------------------------------- buildVaultEncryptedPayload ---

test('2.19.40 (2026-11-24): buildVaultEncryptedPayload mirrors the FIRST copy top-level and lists every copy', () => {
  const encrypted = buildVaultEncryptedPayload({
    copies: [teraboxCopy, telegramCopy],
    encryptedMetadata: 'bWV0YQ==',
    encryptedMimeType: 'video/mp4',
    encryptedFileName: 'abc123.bin',
  });
  assert.equal(encrypted.encryptedBlobUrl, teraboxCopy.encryptedBlobUrl);
  assert.equal(encrypted.encryptedBlobFileId, 'fs-1');
  assert.equal(encrypted.encryptedBlobMessageId, '');
  assert.deepEqual(encrypted.encryptedBlobHosts, [teraboxCopy, telegramCopy]);
  assert.equal(encrypted.vaultHost, 'terabox');
  assert.deepEqual(encrypted.vaultHosts, ['terabox', 'telegram']);
  assert.equal(encrypted.encryptedMetadata, 'bWV0YQ==');
  assert.equal(encrypted.encryptedFileName, 'abc123.bin');
});

test('2.19.40 (2026-11-24): buildVaultEncryptedPayload defaults the mime type and vault host when nothing is recorded', () => {
  const encrypted = buildVaultEncryptedPayload({ copies: [] });
  assert.equal(encrypted.encryptedMimeType, 'application/octet-stream');
  assert.equal(encrypted.vaultHost, 'terabox');
  assert.deepEqual(encrypted.encryptedBlobHosts, []);
});

// ---------------------------------------------- decideVaultUploadRecovery ---

test('2.19.40 (2026-11-24): recovery decides SAVE when every targeted leg is recorded (terabox stored + telegram from the journal)', () => {
  const intent = sampleIntent();
  intent.hostResults = { terabox: teraboxCopy };
  const decision = decideVaultUploadRecovery({ intent, telegramCopy });
  assert.equal(decision.action, 'save');
  assert.deepEqual(decision.missingLegs, []);
  assert.equal(decision.blobSize, 399455208);
  assert.equal(decision.uploadData.fileName, 'clip.mp4');
  assert.equal(decision.encrypted.vaultHost, 'terabox');
  assert.deepEqual(decision.encrypted.vaultHosts, ['terabox', 'telegram']);
  assert.equal(decision.encrypted.encryptedBlobMessageId, '');
  // the telegram copy is the second host — its message id rides in the list
  assert.equal(decision.encrypted.encryptedBlobHosts[1].encryptedBlobMessageId, '701');
});

test('2.19.40 (2026-11-24): recovery decides REPORT with the missing legs when the telegram copy never landed', () => {
  const intent = sampleIntent();
  intent.hostResults = { terabox: teraboxCopy };
  const decision = decideVaultUploadRecovery({ intent, telegramCopy: null });
  assert.equal(decision.action, 'report');
  assert.deepEqual(decision.missingLegs, ['telegram']);
  assert.equal(decision.encrypted, null);
});

test('2.19.40 (2026-11-24): recovery decides REPORT (no intent) instead of inventing a save', () => {
  const decision = decideVaultUploadRecovery({ intent: null, telegramCopy });
  assert.equal(decision.action, 'report');
  assert.equal(decision.encrypted, null);
  assert.deepEqual(decision.telegramCopy, telegramCopy);
});

test('2.19.40 (2026-11-24): recovery with no vaultHostKeys targets the legs actually recorded', () => {
  const intent = sampleIntent({ vaultHostKeys: [] });
  intent.hostResults = { terabox: teraboxCopy };
  const decision = decideVaultUploadRecovery({ intent, telegramCopy });
  assert.equal(decision.action, 'save');
  assert.deepEqual(decision.encrypted.vaultHosts, ['terabox', 'telegram']);
});

// ------------------------------------------------------------ journal IO ---

test('2.19.40 (2026-11-24): readUploadJournal maps a host "missing" to running — the original host is still uploading', async () => {
  installChrome({
    connectNativeHandler: (message) => {
      if (message.action === 'read_upload_journal') {
        assert.equal(message.request_id, 'tg-upload-1');
        return { success: true, message: 'missing', stdout: '' };
      }
      return { success: false, message: 'unknown action' };
    },
  });
  try {
    const checked = await readUploadJournal('tg-upload-1');
    assert.equal(checked.status, 'running');
  } finally {
    uninstallChrome();
  }
});

test('2.19.40 (2026-11-24): readUploadJournal never throws — an unreachable host reads as unreachable', async () => {
  const checked = await readUploadJournal('tg-upload-1');
  assert.equal(checked.status, 'unreachable');
  assert.equal(await deleteUploadJournal('tg-upload-1'), false);
});

// ------------------------------------------------- heartbeat / recovery ---

test('2.19.40 (2026-11-24): a silent event stream + a completed journal resolves the upload, labelled as journal-recovered', async () => {
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  const resultJson = JSON.stringify({ ok: true, messageId: '701', size: 399456568, date: 1793125200 });
  // The real host answers read_upload_journal with the full journal entry
  // in `stdout` — the RESULT json rides INSIDE the entry's stdout field.
  const journalEntry = JSON.stringify({
    requestId: 'tg-upload-1',
    status: 'completed',
    file_path: 'C:\\temp\\abc123.bin',
    channel: '3959088547',
    message: 'Telegram upload succeeded',
    stdout: resultJson,
    stderr: null,
  });
  installChrome({
    connectNativeHandler: (message) => {
      // telegram_upload: the dead stream — never answers.
      if (message.action === 'telegram_upload') return undefined;
      if (message.action === 'read_upload_journal') {
        return { success: true, message: 'completed', stdout: journalEntry };
      }
      return { success: false, message: 'unknown action' };
    },
  });
  try {
    const result = await uploadTelegramNative({
      filePath: 'C:\\temp\\abc123.bin',
      channel: '3959088547',
      requestId: 'tg-upload-1',
      silenceMs: 30,
    });
    assert.equal(result.ok, true);
    assert.equal(result.messageId, '701');
    assert.equal(result.size, 399456568);
    assert.equal(result.requestId, 'tg-upload-1');
    assert.equal(result.recoveredViaJournal, true);
    assert.ok(warnings.some((line) => line.includes('recovered from the host journal')));
  } finally {
    console.warn = realWarn;
    uninstallChrome();
  }
});

test('2.19.40 (2026-11-24): a silent event stream + a failed journal rejects with the journal error instead of hanging', async () => {
  const realWarn = console.warn;
  console.warn = () => {};
  installChrome({
    connectNativeHandler: (message) => {
      if (message.action === 'telegram_upload') return undefined;
      if (message.action === 'read_upload_journal') {
        return {
          success: true,
          message: 'failed',
          stdout: JSON.stringify({
            requestId: 'tg-upload-1',
            status: 'failed',
            channel: '3959088547',
            message: 'FloodWait 120',
            stdout: null,
            stderr: null,
          }),
        };
      }
      return { success: false, message: 'unknown action' };
    },
  });
  try {
    await assert.rejects(
      uploadTelegramNative({
        filePath: 'C:\\temp\\abc123.bin',
        channel: '3959088547',
        requestId: 'tg-upload-1',
        silenceMs: 30,
      }),
      /FloodWait 120/
    );
  } finally {
    console.warn = realWarn;
    uninstallChrome();
  }
});

test('2.19.40 (2026-11-24): a still-running journal re-arms the timer and the live result still wins', async () => {
  const realWarn = console.warn;
  console.warn = () => {};
  const { ports } = installChrome({
    connectNativeHandler: (message) => {
      if (message.action === 'telegram_upload') return undefined;
      if (message.action === 'read_upload_journal') {
        return {
          success: true,
          message: 'running',
          stdout: JSON.stringify({
            requestId: 'tg-upload-1',
            status: 'running',
            channel: '3959088547',
            message: 'Telegram upload in progress',
            stdout: null,
            stderr: null,
          }),
        };
      }
      return { success: false, message: 'unknown action' };
    },
  });
  try {
    const pending = uploadTelegramNative({
      filePath: 'C:\\temp\\abc123.bin',
      channel: '3959088547',
      requestId: 'tg-upload-1',
      silenceMs: 30,
    });
    // Past the first silence check (journal said "running"), the live port
    // delivers the real result — it must win, unlabelled.
    await sleep(45);
    ports[0].emit({
      success: true,
      stdout: JSON.stringify({ ok: true, messageId: '702', size: 100, date: 1 }),
    });
    const result = await pending;
    assert.equal(result.messageId, '702');
    assert.equal(result.recoveredViaJournal, undefined);
  } finally {
    console.warn = realWarn;
    uninstallChrome();
  }
});

test('2.19.40 (2026-11-24): the live path is unchanged — a fast success resolves before any silence check', async () => {
  installChrome({
    connectNativeHandler: (message) => {
      if (message.action === 'telegram_upload') {
        return {
          success: true,
          stdout: JSON.stringify({ ok: true, messageId: '703', size: 100, date: 1 }),
        };
      }
      return { success: false, message: 'unknown action' };
    },
  });
  try {
    const result = await uploadTelegramNative({
      filePath: 'C:\\temp\\abc123.bin',
      channel: '3959088547',
      requestId: 'tg-upload-1',
    });
    assert.equal(result.messageId, '703');
    assert.equal(result.recoveredViaJournal, undefined);
  } finally {
    uninstallChrome();
  }
});

test('2.19.40 (2026-11-24): telegram_upload carries request_id and the silence window is 5 minutes', async () => {
  assert.equal(NATIVE_UPLOAD_SILENCE_MS, 5 * 60 * 1000);
  const { ports } = installChrome({
    connectNativeHandler: (message) => {
      if (message.action === 'telegram_upload') {
        return {
          success: true,
          stdout: JSON.stringify({ ok: true, messageId: '704', size: 1, date: 1 }),
        };
      }
      return { success: false, message: 'unknown action' };
    },
  });
  try {
    await uploadTelegramNative({
      filePath: 'C:\\temp\\abc123.bin',
      channel: '3959088547',
      requestId: 'tg-upload-9',
    });
    assert.equal(ports[0].messages[0].action, 'telegram_upload');
    assert.equal(ports[0].messages[0].request_id, 'tg-upload-9');
  } finally {
    uninstallChrome();
  }
});

// ------------------------------------------------------- worker wiring ---

test('2.19.40 (2026-11-24): the worker checks the upload journal before settling an interrupted run', () => {
  const worker = background();
  assert.match(worker, /async checkNativeUploadJournal\(requestId/);
  assert.match(worker, /async settleInterruptedUploadViaJournal\(run, reason\)/);
  assert.match(worker, /async recoverNativeUploadResult\(run, journal\)/);
  // the settle path consults the journal FIRST, and only falls through to
  // the plain interrupted settle when the journal said nothing
  const settle = worker.slice(worker.indexOf('async settleInterruptedUpload(run, reason)'));
  assert.ok(settle.indexOf('settleInterruptedUploadViaJournal(run, reason)') < settle.indexOf('The sentence has to be TRUE'));
  // recovery finishes the save through the same save path as the live flow
  assert.match(worker, /saveVaultedUpload\(\{\s*uploadData: decision\.uploadData/);
  assert.match(worker, /clearVaultUploadIntent\(\)/);
  assert.match(worker, /cleanupNativeUploadJournal\(run\.nativeUploadRequestId\)/);
  // a journal failure never breaks the settle
  assert.match(worker, /Native upload journal recovery failed/);
});

test('2.19.40 (2026-11-24): an already-terminal interrupted run gets a late journal re-check on reconcile', () => {
  const worker = background();
  const reconcile = worker.slice(worker.indexOf('async reconcileStaleUploadRuns('));
  assert.match(reconcile, /Late journal completion/);
  assert.match(reconcile, /checkNativeUploadJournal\(run\.nativeUploadRequestId\)/);
  assert.match(reconcile, /recoverNativeUploadResult\(run, checked\.journal\)/);
  // terminal runs are rewritten directly — finishUploadRun refuses them
  assert.match(reconcile, /status: UPLOAD_RUN_STATUS\.SUCCESS/);
});

test('2.19.40 (2026-11-24): the vault flow saves the intent before the host loop and records every leg', () => {
  const page = gallery();
  const flow = page.slice(page.indexOf('uploadVaultedDirectly'));
  assert.match(flow, /saveVaultUploadIntent\(createVaultUploadIntent\(/);
  assert.match(flow, /nativeRequestId: telegramRequestId/);
  assert.match(flow, /recordVaultUploadHostResult\(vaultHost, vaultCopy\)/);
  assert.match(flow, /buildVaultEncryptedPayload\(/);
  assert.match(flow, /clearVaultUploadIntent\(\)/);
  // the video flow records its telegram request id on the run too
  assert.match(page, /videoTelegramRequestId/);
  assert.match(page, /nativeUploadRequestId/);
});

// ---------------------------------------------------------- reload guard ---

test('2.19.40 (2026-11-24): the reload script probes the upload state BEFORE building and refuses while active', () => {
  const script = reloadScript();
  assert.ok(script.indexOf('probe-upload-state.py') !== -1);
  assert.ok(script.indexOf('probe-upload-state.py') < script.indexOf('pnpm build'),
    'the guard must run before the build, not after');
  assert.match(script, /uploadActive/);
  assert.match(script, /REFUSING to reload - an upload is ACTIVE/);
  assert.match(script, /exit 1/);
  // a probe failure fails CLOSED — never reloads on unknown state
  assert.match(script, /UPLOAD_STATE_ERROR/);
  assert.match(script, /refusing to reload while the state is unknown/);
});

test('2.19.40 (2026-11-24): the probe page is a read-only storage read with no inline script (MV3 CSP)', () => {
  const html = src('../public/probe-upload-state.html');
  const js = src('../public/probe-upload-state.js');
  assert.match(html, /<script src="probe-upload-state\.js"><\/script>/);
  assert.ok(!html.includes('<script>'), 'no inline script tag allowed');
  assert.match(js, /chrome\.storage\.local\.get\(\['uploadActive', 'uploadStatus', 'uploadRun'\]\)/);
  assert.match(js, /getElementById\('result'\)/);
  assert.ok(!js.includes('chrome.storage.local.set'), 'the probe must never write storage');
});

test('2.19.40 (2026-11-24): the probe script reads through the probe page and falls back to the app shell', () => {
  const script = probeScript();
  assert.match(script, /probe-upload-state\.html/);
  assert.match(script, /index\.html/);
  assert.match(script, /UPLOAD_STATE:/);
  assert.match(script, /UPLOAD_STATE_ERROR:/);
  assert.match(script, /Target\.closeTarget/);
  assert.match(script, /background=True/);
});

// ------------------------------------------------------------ host journal ---

test('2.19.40 (2026-11-24): the native host journals telegram uploads and serves read/delete actions', () => {
  const main = hostMain();
  assert.match(main, /imgvault-tg-upload-journal-/);
  assert.match(main, /"read_upload_journal"/);
  assert.match(main, /"delete_upload_journal"/);
  // the host drains the child stderr on a thread from spawn, so a noisy
  // child can never deadlock the stdout reader
  assert.match(main, /stderr.*thread|thread.*stderr/s);
});
