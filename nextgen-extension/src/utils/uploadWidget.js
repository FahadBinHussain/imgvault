/**
 * Persistent upload-progress widget — the pure model.
 *
 * Why this exists (2.19.39): closing the upload modal used to hide the
 * upload entirely. The transfer kept running (the modal close never
 * cancelled it), but the user had no way to watch it while doing other
 * work — reopening the modal was the only progress display. The widget
 * is a small floating card that keeps showing the live upload after the
 * modal closes.
 *
 * Single source of truth: the upload-run ledger (`uploadRun` in
 * chrome.storage.local, utils/uploadRun.js) plus the legacy status
 * mirror (`uploadActive` / `uploadStatus`). The widget reads the SAME
 * record the modal and the Logs page read — it never computes a second
 * percentage. Flows that never reported to the ledger (the page-side
 * vault upload before 2.19.39) now do; flows with no run at all (video
 * host retry, vault restore) still show through the legacy mirror.
 *
 * Dismiss is view-only, always: hiding the card never cancels anything.
 * There is no cancel path in this module or in the widget component —
 * the modal's Terminate button stays the only way to stop an upload.
 */
import { UPLOAD_RUN_STATUS, isUploadRunStalled } from './uploadRun.js';

/** chrome.storage.local key carrying the live batch state (GalleryPage mirrors it). */
export const UPLOAD_BATCH_KEY = 'uploadBatch';

/** chrome.storage.local key carrying whether the upload modal is open (GalleryPage mirrors it). */
export const UPLOAD_MODAL_OPEN_KEY = 'uploadModalOpen';

/** How long the success card stays before it dismisses itself. Errors never auto-dismiss. */
export const UPLOAD_WIDGET_SUCCESS_AUTO_DISMISS_MS = 5000;

const RUNNING = UPLOAD_RUN_STATUS.RUNNING;

const KIND_LABELS = {
  video: 'video',
  audio: 'song',
  image: 'image',
  vault: 'vault item',
  '3d': '3D model',
  scene: 'scene',
};

function kindLabel(kind) {
  return KIND_LABELS[String(kind || '').toLowerCase()] || 'upload';
}

function clampPercent(percent) {
  // null/undefined/'' mean "no percent" (SW-side uploads never report
  // one) — and Number(null) is 0, so the empty check must come FIRST,
  // or every imageless-percent run would render a stuck 0% bar.
  if (percent === null || percent === undefined || percent === '') return null;
  const value = Number(percent);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function nonEmptyString(value) {
  const text = String(value || '').trim();
  return text || '';
}

/**
 * The display model for the floating progress card, or null when the card
 * must stay hidden. Pure — every visibility rule lives here so it can be
 * tested without a React harness.
 *
 * Visibility, in order:
 *   1. modal open → hidden (the modal shows the full log).
 *   2. run running → running card (or stalled warning when the heartbeat
 *      is older than the stall window), unless dismissed for this run.
 *   3. run success/warning → brief success card, unless a batch is still
 *      active (a batch file finishing is not the end) or dismissed.
 *   4. run error/interrupted/stalled → loud error card, persistent until
 *      dismissed or the modal is reopened.
 *   5. run cancelled → hidden.
 *   6. no live run but the legacy `uploadActive` flag is set → fallback
 *      card with the status line and an indeterminate bar (video host
 *      retry, vault restore, and the vault encrypt phase before its run
 *      starts all live here). Never shown over a dismissed error or a
 *      cancelled run.
 *
 * @param {Object} input
 * @param {Object|null} input.run - the uploadRun record (or null)
 * @param {boolean} input.uploadActive - legacy chrome.storage.local flag
 * @param {string} input.uploadStatusText - legacy status line
 * @param {Object|null} input.batch - the mirrored batch state (or null)
 * @param {boolean} input.modalOpen - the upload modal is open
 * @param {string|null} input.dismissedRunId - run id dismissed while running
 * @param {string|null} input.terminalDismissedRunId - run id dismissed after finishing
 * @param {boolean} input.fallbackDismissed - the fallback card was dismissed
 * @param {number} [input.now] - ms timestamp (stall check)
 * @returns {Object|null} the card model, or null when hidden
 */
export function getUploadWidgetModel({
  run = null,
  uploadActive = false,
  uploadStatusText = '',
  batch = null,
  modalOpen = false,
  dismissedRunId = null,
  terminalDismissedRunId = null,
  fallbackDismissed = false,
  now = Date.now(),
} = {}) {
  if (modalOpen) return null;

  const batchActive = Boolean(batch?.active) && Number(batch?.total) > 0;
  const batchText = batchActive ? `${Number(batch.index) || 0}/${Number(batch.total)}` : null;
  const statusLine = nonEmptyString(uploadStatusText);
  const status = run?.status || '';
  const runId = run?.id ? String(run.id) : null;
  const fileName = nonEmptyString(run?.fileName) || nonEmptyString(batch?.currentFile);
  const percent = clampPercent(run?.percent);
  const bytesSent = Math.max(0, Number(run?.bytesSent) || 0);
  const bytesTotal = Math.max(0, Number(run?.bytesTotal) || 0);

  if (status === RUNNING) {
    if (runId && dismissedRunId === runId) return null;
    const stalled = isUploadRunStalled(run, now);
    return {
      variant: stalled ? 'stalled' : 'running',
      runId,
      title: fileName || `Uploading ${kindLabel(run?.kind)}…`,
      subtitle: stalled
        ? 'No progress for a while — the transfer may be stalled.'
        : (statusLine || `Uploading to ${(run?.hosts || []).filter(Boolean).join(', ') || kindLabel(run?.kind)}…`),
      percent,
      bytesSent,
      bytesTotal,
      batchText,
      autoDismiss: false,
      isFallback: false,
    };
  }

  if (status === UPLOAD_RUN_STATUS.SUCCESS || status === UPLOAD_RUN_STATUS.WARNING) {
    // A per-file success inside a live batch is NOT the end — the next
    // file follows immediately, so no success flash. And a dismissed
    // success stays dismissed. Either way execution falls through to the
    // fallback below: a live upload (the next batch file encrypting, a
    // retry starting) still deserves a card.
    if (!batchActive && !(runId && terminalDismissedRunId === runId)) {
      return {
        variant: 'success',
        runId,
        title: 'Upload complete',
        subtitle: nonEmptyString(run?.summary) || fileName || 'Upload finished.',
        percent: 100,
        bytesSent,
        bytesTotal,
        batchText,
        autoDismiss: true,
        isFallback: false,
      };
    }
  } else if (
    status === UPLOAD_RUN_STATUS.ERROR ||
    status === UPLOAD_RUN_STATUS.INTERRUPTED ||
    status === UPLOAD_RUN_STATUS.STALLED
  ) {
    if (!(runId && terminalDismissedRunId === runId)) {
      return {
        variant: 'error',
        runId,
        title: 'Upload failed',
        subtitle: nonEmptyString(run?.summary) || fileName || statusLine || 'The upload did not finish.',
        percent,
        bytesSent,
        bytesTotal,
        batchText,
        autoDismiss: false,
        isFallback: false,
      };
    }
    // A dismissed error falls through, but the fallback guard below
    // excludes error/interrupted/stalled runs, so it stays hidden.
  }

  // No live run. The legacy mirror is the only signal left — a flow with
  // no run record (video host retry, vault restore) or a vault upload
  // still encrypting before its run starts. Never over a dismissed
  // error or a cancelled run: those are settled, not in flight.
  const fallbackAllowed = !run
    || status === UPLOAD_RUN_STATUS.SUCCESS
    || status === UPLOAD_RUN_STATUS.WARNING;
  if (uploadActive && !fallbackDismissed && fallbackAllowed) {
    // The stored run is finished, so its fileName belongs to the LAST
    // upload — never show it for the live one. The batch mirror (when
    // batching) names the live file; otherwise the status line does.
    const liveFileName = nonEmptyString(batch?.currentFile);
    return {
      variant: 'running',
      runId: null,
      title: liveFileName || 'Uploading…',
      subtitle: statusLine || 'Upload in progress…',
      percent: null,
      bytesSent: 0,
      bytesTotal: 0,
      batchText,
      autoDismiss: false,
      isFallback: true,
    };
  }

  return null;
}
