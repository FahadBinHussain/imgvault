/**
 * @fileoverview Shared upload-run ledger.
 * @version 1.0.0
 *
 * Why this exists: an upload used to be two loose flags in chrome.storage.local
 * (`uploadActive` + `uploadStatus`). When the browser (or the tab, or the MV3
 * worker) died mid-transfer, the transport never settled, so the `finally`
 * that clears `uploadActive` never ran and the UI came back from a restart
 * showing "Uploading..." with a frozen log FOREVER. Nothing in the extension
 * could tell an in-flight upload from a corpse.
 *
 * This module is the single source of truth for "what upload is running, who
 * owns it, how far it got, and can it be resumed". It is imported by BOTH the
 * service worker and the extension pages, so it must stay free of DOM and
 * node-only APIs.
 *
 * Liveness model (three independent signals, because no single one is enough):
 *   1. browser session id - rotated on chrome.runtime.onStartup. A run whose
 *      session id differs from the current one is PROVABLY dead: the browser
 *      restarted under it.
 *   2. owner port - a page-owned upload holds a runtime port open for the
 *      duration of the transfer. If the page dies, the port disconnects and
 *      the worker settles the run immediately instead of waiting for a restart.
 *   3. heartbeat - every progress tick stamps `updatedAt`. A run whose
 *      `updatedAt` is older than the stall window is reported as stalled
 *      (hung request, not dead).
 */

export const UPLOAD_RUN_KEY = 'uploadRun';
export const UPLOAD_SESSION_KEY = 'imgvaultBrowserSessionId';

export const UPLOAD_RUN_STATUS = {
  RUNNING: 'running',
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INTERRUPTED: 'interrupted',
  STALLED: 'stalled',
  CANCELLED: 'cancelled',
};

export const UPLOAD_OWNER = {
  PAGE: 'page',
  WORKER: 'worker',
};

/** Terminal states - a run in one of these is no longer live. */
export const TERMINAL_UPLOAD_STATUSES = [
  UPLOAD_RUN_STATUS.SUCCESS,
  UPLOAD_RUN_STATUS.ERROR,
  UPLOAD_RUN_STATUS.WARNING,
  UPLOAD_RUN_STATUS.INTERRUPTED,
  UPLOAD_RUN_STATUS.STALLED,
  UPLOAD_RUN_STATUS.CANCELLED,
];

/**
 * How long a run may go without a heartbeat before the UI calls it stalled.
 * Upload progress ticks are emitted per chunk (~4 MB) and per host, so a
 * 90-second silence means the request is hung, not slow.
 */
export const UPLOAD_STALL_WINDOW_MS = 90 * 1000;

/** How many finished runs the Logs page keeps. */
export const UPLOAD_HISTORY_LIMIT = 20;

/** Runtime port name a page-owned upload holds open while it transfers. */
export const UPLOAD_OWNER_PORT = 'imgvault-upload-owner';

/**
 * Serialises every read-modify-write of the run record.
 *
 * WHY THIS EXISTS: `updateUploadRun` (a progress tick) and `finishUploadRun`
 * (the run being closed) both do read -> modify -> write on the SAME storage
 * key, and `chrome.storage` has no compare-and-set. The page's progress
 * callback is NOT awaited by the uploader (`onProgress(...)` is fire and
 * forget), so a tick from the last chunk was regularly still in flight when
 * the upload ended. That tick then wrote its STALE "running" snapshot AFTER
 * the close, and the run came back to life: the worker later settled a
 * finished upload as "interrupted" and claimed "Nothing was saved for this
 * upload" while the item was already in the database.
 *
 * Every mutation goes through the worker (the pages only send messages), so
 * one queue here serialises the writers and a late tick simply finds a
 * terminal run and does nothing.
 */
let uploadRunMutationQueue = Promise.resolve();

/**
 * Run a task with exclusive access to the run record.
 * @param {() => Promise<any>} task
 * @returns {Promise<any>} the task result
 */
export function withUploadRunLock(task) {
  const result = uploadRunMutationQueue.then(() => task());
  // The queue must survive a rejected task, otherwise one failed write would
  // wedge every later write behind it.
  uploadRunMutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function isTerminalUploadStatus(status) {
  return TERMINAL_UPLOAD_STATUSES.includes(String(status || ''));
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let size = value;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const decimals = size >= 100 || index === 0 ? 0 : 1;
  return `${size.toFixed(decimals)} ${units[index]}`;
}

/**
 * Current browser session id, minted on first use.
 *
 * IMPORTANT: this must only ever be ROTATED from chrome.runtime.onStartup.
 * The MV3 service worker re-evaluates this module on every idle wake, so
 * minting a fresh id at module scope would make every worker restart look
 * like a browser restart and would kill live uploads.
 * @returns {Promise<string>}
 */
export async function ensureBrowserSessionId() {
  const stored = await chrome.storage.local.get(UPLOAD_SESSION_KEY);
  const existing = stored?.[UPLOAD_SESSION_KEY];
  if (existing) {
    return existing;
  }
  const minted = `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await chrome.storage.local.set({ [UPLOAD_SESSION_KEY]: minted });
  return minted;
}

/**
 * Start a NEW browser session. Called from chrome.runtime.onStartup only.
 * Every run recorded under the previous id is now provably interrupted.
 * @returns {Promise<string>} the new session id
 */
export async function rotateBrowserSessionId() {
  const next = `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await chrome.storage.local.set({ [UPLOAD_SESSION_KEY]: next });
  return next;
}

/**
 * @returns {Promise<Object|null>} the current run record, or null
 */
export async function getUploadRun() {
  const stored = await chrome.storage.local.get(UPLOAD_RUN_KEY);
  const run = stored?.[UPLOAD_RUN_KEY];
  return run && typeof run === 'object' ? run : null;
}

/**
 * Create a run record and mark the upload as active.
 * @param {Object} init
 * @param {string} init.kind - 'image' | 'video' | '3d' | 'scene' | 'vault'
 * @param {string} init.owner - UPLOAD_OWNER.PAGE | UPLOAD_OWNER.WORKER
 * @param {string[]} [init.hosts] - host labels this run targets
 * @param {string} [init.fileName]
 * @param {number} [init.bytesTotal]
 * @param {string} [init.source] - 'local-file' | 'url' | 'blob'
 * @param {string} [init.sourcePageUrl]
 * @param {string} [init.sessionId] - browser session id (defaults to current)
 * @returns {Promise<Object>} the new run record
 */
export async function startUploadRun({
  kind = 'image',
  owner = UPLOAD_OWNER.WORKER,
  hosts = [],
  hostKeys = [],
  fileName = '',
  bytesTotal = 0,
  source = '',
  sourcePageUrl = '',
  sessionId = '',
} = {}) {
  return withUploadRunLock(async () => {
    const session = sessionId || (await ensureBrowserSessionId());
    const now = Date.now();
    const run = {
      id: `upload-run-${now}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      owner,
      hosts: Array.isArray(hosts) ? hosts.filter(Boolean) : [],
      hostKeys: Array.isArray(hostKeys) ? hostKeys.filter(Boolean) : [],
      fileName: fileName || '',
      bytesTotal: Number(bytesTotal) || 0,
      bytesSent: 0,
      percent: null,
      source,
      sourcePageUrl,
      status: UPLOAD_RUN_STATUS.RUNNING,
      startedAt: now,
      updatedAt: now,
      completedAt: 0,
      sessionId: session,
      resume: null,
      summary: '',
    };

    await chrome.storage.local.set({
      [UPLOAD_RUN_KEY]: run,
      uploadActive: true,
    });

    return run;
  });
}

/**
 * Merge a patch into the live run. Writes are ignored once the run reached a
 * terminal state - a late progress tick from a dying context must not
 * resurrect a finished run.
 *
 * The terminal check happens INSIDE the lock, so a tick that was already in
 * flight when the run closed finds the closed run and does nothing. That is
 * what stops a finished upload from coming back to life and being reported as
 * interrupted with nothing saved.
 * @param {Object} patch
 * @returns {Promise<Object|null>} the stored run after the patch, or null
 */
export async function updateUploadRun(patch = {}) {
  return withUploadRunLock(async () => {
    const run = await getUploadRun();
    if (!run || isTerminalUploadStatus(run.status)) {
      return run;
    }
    const next = {
      ...run,
      ...patch,
      updatedAt: Date.now(),
    };
    await chrome.storage.local.set({ [UPLOAD_RUN_KEY]: next });
    return next;
  });
}

/**
 * Close the run with a terminal status and archive it into the log history.
 * @param {string} status - one of UPLOAD_RUN_STATUS
 * @param {string} summary - one line, human readable
 * @param {Object} [extra] - fields merged into the closed run (savedItemId,
 *   hostsDone, resumes ...). They are merged BEFORE the status so a late
 *   caller can never overwrite the terminal status itself.
 * @returns {Promise<Object|null>} the closed run
 */
export async function finishUploadRun(status, summary = '', extra = {}) {
  if (!isTerminalUploadStatus(status)) {
    throw new Error(`Unknown upload run status "${status}" - refusing to close the run.`);
  }
  return withUploadRunLock(async () => {
    const run = await getUploadRun();
    if (!run) {
      return null;
    }
    if (isTerminalUploadStatus(run.status)) {
      return run;
    }
    const now = Date.now();
    // An empty savedItemId must NOT overwrite a real one: the page reports
    // the saved item through a progress tick, and a later close that carries
    // an empty id (the upload failed after the item was finalized) would
    // otherwise erase the truth.
    const merged = { ...(extra && typeof extra === 'object' ? extra : {}) };
    if (!String(merged.savedItemId || '').trim()) {
      delete merged.savedItemId;
    }
    const closed = {
      ...run,
      ...merged,
      status,
      summary: summary || run.summary || '',
      completedAt: now,
      updatedAt: now,
    };
    await chrome.storage.local.set({
      [UPLOAD_RUN_KEY]: closed,
      uploadActive: false,
    });
    await archiveUploadRun(closed);
    return closed;
  });
}

/**
 * Archive a finished run into the Logs page history.
 *
 * The Logs page sorts on `completedAt`; older runs written before that field
 * existed have none and collapsed to the epoch. Both fields are written now.
 * @param {Object} run
 * @returns {Promise<Object>} the archived run
 */
export async function archiveUploadRun(run) {
  const stored = await chrome.storage.local.get(['uploadStatusLogs', 'uploadLogHistory']);
  const logs = Array.isArray(stored.uploadStatusLogs) ? stored.uploadStatusLogs : [];
  const entry = {
    ...run,
    id: run.id || `upload-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: run.completedAt || Date.now(),
    completedAt: run.completedAt || Date.now(),
    status: run.status || UPLOAD_RUN_STATUS.ERROR,
    summary: run.summary || '',
    logs,
  };
  const nextHistory = [entry, ...(stored.uploadLogHistory || [])].slice(0, UPLOAD_HISTORY_LIMIT);
  await chrome.storage.local.set({ uploadLogHistory: nextHistory });
  return entry;
}

/**
 * Settle a run that died with its owner (browser closed, tab crashed, worker
 * evicted mid-transfer). Never silent: the run keeps a truthful status and a
 * summary that says WHAT was lost.
 * @param {string} reason - human readable explanation
 * @param {Object} [extra] - extra fields merged into the run before closing
 * @returns {Promise<Object|null>} the settled run
 */
export async function settleInterruptedUploadRun(reason, extra = {}) {
  return withUploadRunLock(async () => {
    const run = await getUploadRun();
    if (!run) {
      return null;
    }
    if (isTerminalUploadStatus(run.status)) {
      return run;
    }
    const now = Date.now();
    const summary = reason || 'The upload stopped before it finished.';
    const closed = {
      ...run,
      ...(extra && typeof extra === 'object' ? extra : {}),
      status: UPLOAD_RUN_STATUS.INTERRUPTED,
      summary,
      completedAt: now,
      updatedAt: now,
    };
    await chrome.storage.local.set({
      [UPLOAD_RUN_KEY]: closed,
      uploadActive: false,
    });
    await archiveUploadRun(closed);
    return closed;
  });
}

/**
 * The sentence the OLD settle path wrote for every interrupted run.
 *
 * It was a lie whenever the upload had actually been saved - the item sat in
 * the database with its host links while the banner claimed that nothing was
 * saved, and the user was told to go and upload a file they already had.
 * @type {string}
 */
export const LEGACY_NOTHING_SAVED_SUMMARY = 'Nothing was saved for this upload.';

/**
 * The outcome sentence is always the LAST sentence of an interrupted run's
 * summary - it says what the upload left behind ("Nothing was saved...",
 * "The upload reached TeraBox, but the gallery item was not saved.", "The
 * item was saved to the gallery (ID ...).").
 */
const OUTCOME_SENTENCE_RE = /\s*(Nothing was saved for this upload\.|The upload reached .+?, but the gallery item was not saved\.|The item was saved to the gallery \(ID [^)]+\)\.)$/;

/**
 * Split an interrupted run's summary into the reason and the outcome
 * sentence, so the outcome can be replaced with the truth.
 * @param {string} summary
 * @returns {{reason: string, outcome: string}}
 */
export function splitInterruptedSummary(summary) {
  const text = String(summary || '').trim();
  const match = text.match(OUTCOME_SENTENCE_RE);
  if (!match || match.index === undefined) {
    return { reason: text, outcome: '' };
  }
  return {
    reason: text.slice(0, match.index).trim(),
    outcome: match[0].trim(),
  };
}

/**
 * True when a run's stored outcome sentence contradicts its evidence.
 *
 * A run settled by the old path always ended with the legacy sentence, even
 * when the upload had reached a host (or been saved) - the evidence lives in
 * `savedItemId` / `hostsDone`, the sentence did not. Such a summary has to be
 * corrected, otherwise it stays on screen forever (the run is terminal, so
 * nothing ever rewrites it on its own).
 * @param {Object} run
 * @returns {boolean}
 */
export function needsSavedOutcomeRepair(run) {
  if (!run || run.status !== UPLOAD_RUN_STATUS.INTERRUPTED) return false;
  const { outcome } = splitInterruptedSummary(run.summary);
  if (!outcome) return false;
  // Already telling the truth - nothing to correct.
  return !/The item was saved to the gallery \(ID [^)]+\)\./.test(outcome);
}

/**
 * The corrected summary for a run whose stored sentence contradicts its
 * evidence. Returns the run unchanged when there is nothing to correct.
 *
 * @param {Object} run
 * @param {string} [savedItemId] - the gallery item the run actually saved, if
 *   it is known (the caller can look it up; the run itself may not know).
 * @returns {Object}
 */
export function repairSavedOutcomeSummary(run, savedItemId = '') {
  if (!run || run.status !== UPLOAD_RUN_STATUS.INTERRUPTED) return run;
  const { reason, outcome } = splitInterruptedSummary(run.summary);
  if (!outcome) return run;

  const itemId = String(savedItemId || run.savedItemId || '').trim();
  const truth = itemId
    ? `The item was saved to the gallery (ID ${itemId}).`
    : describeSavedOutcome(run);
  if (truth === outcome) return run;

  const summary = reason ? `${reason} ${truth}` : truth;
  if (summary === run.summary) return run;
  return {
    ...run,
    summary,
    ...(itemId ? { savedItemId: itemId } : {}),
  };
}

/**
 * The one sentence that says what the user actually lost.
 *
 * A run that was settled as interrupted used to always claim "Nothing was
 * saved for this upload." That was a lie for an upload whose item was already
 * finalised: the item was in the database with its host links, the banner
 * said nothing was saved, and the user was told to retry a file they already
 * had. The run now carries the id of the saved item, so the sentence can
 * tell the truth.
 * @param {Object} run
 * @returns {string}
 */
export function describeSavedOutcome(run) {
  const savedItemId = String(run?.savedItemId || '').trim();
  if (savedItemId) {
    return `The item was saved to the gallery (ID ${savedItemId}).`;
  }
  const done = Object.keys(run?.hostsDone || {}).filter(Boolean);
  if (done.length > 0) {
    // The run stores host KEYS in hostsDone and host LABELS in hosts (the
    // two arrays are parallel) - the user gets the readable label.
    const labels = done.map((key) => {
      const index = (run?.hostKeys || []).indexOf(key);
      return index >= 0 ? (run?.hosts?.[index] || key) : key;
    });
    return `The upload reached ${labels.join(', ')}, but the gallery item was not saved.`;
  }
  return 'Nothing was saved for this upload.';
}

/**
 * One line describing a run, used in notifications and in the UI.
 * @param {Object} run
 * @returns {string}
 */
export function describeUploadRun(run) {
  if (!run) {
    return 'No upload';
  }
  const hosts = (run.hosts || []).filter(Boolean);
  const target = hosts.length > 0 ? hosts.join(', ') : (run.kind || 'upload');
  const name = run.fileName ? ` · ${run.fileName}` : '';
  const progress = Number.isFinite(run.percent) && run.percent !== null
    ? ` · ${run.percent}%`
    : '';
  return `${target}${name}${progress}`;
}

/**
 * Progress detail for the interrupted message - how many bytes actually made
 * it out, so the user knows what was lost.
 * @param {Object} run
 * @returns {string}
 */
export function describeUploadProgress(run) {
  if (!run) {
    return '';
  }
  const sent = Number(run.bytesSent) || 0;
  const total = Number(run.bytesTotal) || 0;
  if (!sent) {
    return '';
  }
  if (!total) {
    return ` · ${formatBytes(sent)} sent`;
  }
  return ` · ${formatBytes(sent)} / ${formatBytes(total)}`;
}

/**
 * True when the run's heartbeat is older than the stall window.
 * @param {Object} run
 * @param {number} [now]
 * @returns {boolean}
 */
export function isUploadRunStalled(run, now = Date.now()) {
  if (!run || run.status !== UPLOAD_RUN_STATUS.RUNNING) {
    return false;
  }
  const updatedAt = Number(run.updatedAt) || 0;
  if (!updatedAt) {
    return true;
  }
  return now - updatedAt > UPLOAD_STALL_WINDOW_MS;
}
