/**
 * Phase-aware progress logging for native-host uploads.
 *
 * A native upload has phases: the picked file is STAGED to disk first
 * (phase 'staging'), then Telethon uploads it (phase 'uploading'), then
 * the post finalizes (phase 'finalizing'). The vault handler used to
 * render every phase as "Uploading to Telegram" and throttle all of them
 * through ONE shared byte watermark — so staging-100% set the watermark
 * to the full size and the whole Telethon upload logged NOTHING (2.19.36:
 * a 128 MB vault blob went silent for 4.5 min, which read as "stuck
 * forever"). Each phase now gets its own watermark, and staging renders
 * as staging.
 */
export const UPLOAD_LOG_STEP_BYTES = 20 * 1024 * 1024; // log every ~20 MB so slow big uploads show movement

/**
 * Throttled "should this event get a log line?" tracker. Logs at 100% and
 * every `stepBytes` of progress — and RESETS the watermark on a phase
 * change, so a new phase logs from 0 instead of inheriting the old
 * phase's 100%.
 * @param {{stepBytes?: number}} [options]
 * @returns {{shouldLog: ({loaded: number, percent: number|null, phase: string|undefined}) => boolean}}
 */
export function createUploadProgressTracker({ stepBytes = UPLOAD_LOG_STEP_BYTES } = {}) {
  let loggedBytes = 0;
  let lastPhase = null;
  return {
    shouldLog({ loaded, percent, phase }) {
      if (phase !== lastPhase) {
        loggedBytes = 0;
        lastPhase = phase;
      }
      if (percent === 100 || loaded - loggedBytes >= stepBytes) {
        loggedBytes = loaded;
        return true;
      }
      return false;
    },
  };
}

/**
 * The vault progress line for one event. Staging renders as staging
 * ("staging for native upload", same wording as the video handler) so it
 * can never be mistaken for upload progress; the upload phase keeps the
 * established "Uploading to <host>: ..." shape byte-identical.
 * @param {{serviceLabel: string, phase: string|undefined, percentLabel: string}} event
 * @returns {string}
 */
export function vaultUploadProgressLabel({ serviceLabel, phase, percentLabel }) {
  if (phase === 'staging') {
    return `Uploading to ${serviceLabel} (staging for native upload): ${percentLabel}`;
  }
  return `Uploading to ${serviceLabel}: ${percentLabel}`;
}
