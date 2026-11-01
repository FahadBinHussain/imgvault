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
}

/**
 * Merge a patch into the live run. Writes are ignored once the run reached a
 * terminal state - a late progress tick from a dying context must not
 * resurrect a finished run.
 * @param {Object} patch
 * @returns {Promise<Object|null>} the stored run after the patch, or null
 */
export async function updateUploadRun(patch = {}) {
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
}

/**
 * Close the run with a terminal status and archive it into the log history.
 * @param {string} status - one of UPLOAD_RUN_STATUS
 * @param {string} summary - one line, human readable
 * @returns {Promise<Object|null>} the closed run
 */
export async function finishUploadRun(status, summary = '') {
  if (!isTerminalUploadStatus(status)) {
    throw new Error(`Unknown upload run status "${status}" - refusing to close the run.`);
  }
  const run = await getUploadRun();
  if (!run) {
    return null;
  }
  if (isTerminalUploadStatus(run.status)) {
    return run;
  }
  const now = Date.now();
  const closed = {
    ...run,
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
    ...extra,
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
