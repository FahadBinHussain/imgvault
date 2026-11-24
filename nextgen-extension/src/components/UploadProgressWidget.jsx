/**
 * @fileoverview Floating upload-progress card (2.19.39).
 *
 * The upload modal is the only progress display the app had, and closing
 * it hid the upload entirely — the transfer kept running, but the user
 * could not watch it while doing other work. This card lives at app
 * level (mounted in index.jsx, outside the routes) so it survives route
 * changes and shows on every page, including the vault page. It appears
 * when an upload is active and the modal is closed, and hides when the
 * modal is open (the modal shows the full log).
 *
 * Data comes from the upload-run ledger (`uploadRun`) plus the legacy
 * status mirror (`uploadActive` / `uploadStatus`) — the same records
 * the modal reads. The visibility rules live in utils/uploadWidget.js
 * (pure, unit-tested); this component only subscribes, renders, and
 * handles click/dismiss.
 *
 * Dismiss is view-only, always: the X hides the card and NOTHING else.
 * It never cancels, terminates, or touches any batch flag — the modal's
 * Terminate button stays the only way to stop an upload. After a
 * dismiss, the card comes back on completion (brief success state) or
 * on error (loud, persistent until dismissed or the modal reopens).
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Upload, X } from 'lucide-react';
import { useChromeStorage } from '../hooks/useChromeExtension';
import { formatBytes } from '../utils/uploadRun';
import {
  UPLOAD_BATCH_KEY,
  UPLOAD_MODAL_OPEN_KEY,
  UPLOAD_WIDGET_SUCCESS_AUTO_DISMISS_MS,
  getUploadWidgetModel,
} from '../utils/uploadWidget';

// How often the card re-checks a live run for staleness. The storage
// subscription only fires when the run record changes — a stalled run
// never does, so without a tick the stall warning would never appear.
const STALL_CHECK_INTERVAL_MS = 10 * 1000;

const VARIANT_STYLES = {
  running: {
    border: 'border-base-300',
    icon: <Upload className="h-4 w-4 shrink-0 text-primary" />,
    bar: 'bg-gradient-to-r from-primary-500 to-secondary-500',
  },
  stalled: {
    border: 'border-warning/60',
    icon: <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />,
    bar: 'bg-warning',
  },
  success: {
    border: 'border-success/60',
    icon: <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />,
    bar: 'bg-success',
  },
  error: {
    border: 'border-error/70',
    icon: <AlertTriangle className="h-4 w-4 shrink-0 text-error" />,
    bar: 'bg-error',
  },
};

export default function UploadProgressWidget() {
  const navigate = useNavigate();
  const [run] = useChromeStorage('uploadRun', null, 'local');
  const [uploadActive] = useChromeStorage('uploadActive', false, 'local');
  const [uploadStatusText] = useChromeStorage('uploadStatus', '', 'local');
  const [batch] = useChromeStorage(UPLOAD_BATCH_KEY, null, 'local');
  const [modalOpen] = useChromeStorage(UPLOAD_MODAL_OPEN_KEY, false, 'local');
  const [dismissedRunId, setDismissedRunId] = useState(null);
  const [terminalDismissedRunId, setTerminalDismissedRunId] = useState(null);
  const [fallbackDismissed, setFallbackDismissed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const runIsLive = run?.status === 'running';
  useEffect(() => {
    if (!runIsLive) return undefined;
    const timer = setInterval(() => setNow(Date.now()), STALL_CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [runIsLive]);

  // A fresh upload clears the fallback dismiss — the dismiss only ever
  // hides the upload that was running when the user tapped X.
  useEffect(() => {
    if (!uploadActive) setFallbackDismissed(false);
  }, [uploadActive]);

  // Reopening the modal acknowledges the current run: a terminal outcome
  // the user just saw in the modal must not pop back as a card, and a
  // modal closed again is a fresh wish to watch the live run.
  const prevModalOpenRef = useRef(false);
  const runId = run?.id || null;
  const runStatus = run?.status || '';
  useEffect(() => {
    const wasOpen = prevModalOpenRef.current;
    prevModalOpenRef.current = modalOpen;
    if (!modalOpen || wasOpen || !runId) return;
    if (runStatus !== 'running') setTerminalDismissedRunId(runId);
    setDismissedRunId((current) => (current === runId ? null : current));
  }, [modalOpen, runId, runStatus]);

  const model = getUploadWidgetModel({
    run,
    uploadActive,
    uploadStatusText,
    batch,
    modalOpen,
    dismissedRunId,
    terminalDismissedRunId,
    fallbackDismissed,
    now,
  });

  // Success is a brief confirmation, not a resident: it auto-dismisses.
  // Errors never auto-dismiss — fail loudly, stay until seen.
  const modelRunId = model?.runId || null;
  const modelVariant = model?.variant || null;
  const modelAutoDismiss = Boolean(model?.autoDismiss);
  useEffect(() => {
    if (!modelRunId || modelVariant !== 'success' || !modelAutoDismiss) return undefined;
    const timer = setTimeout(
      () => setTerminalDismissedRunId(modelRunId),
      UPLOAD_WIDGET_SUCCESS_AUTO_DISMISS_MS,
    );
    return () => clearTimeout(timer);
  }, [modelRunId, modelVariant, modelAutoDismiss]);

  // AnimatePresence stays mounted even with no card, so the exit
  // animation plays when the model disappears.
  const style = model
    ? (VARIANT_STYLES[model.variant] || VARIANT_STYLES.running)
    : VARIANT_STYLES.running;
  const bytesLine = model && model.bytesTotal > 0
    ? `${formatBytes(model.bytesSent)} / ${formatBytes(model.bytesTotal)}`
    : (model && model.bytesSent > 0 ? `${formatBytes(model.bytesSent)} sent` : '');

  const handleDismiss = (event) => {
    event.stopPropagation();
    if (!model) return;
    // View-only dismiss: it hides the card and NOTHING else. It never
    // touches the upload — no cancel, no terminate, no batch flag.
    if (!model.runId) {
      setFallbackDismissed(true);
      return;
    }
    if (model.variant === 'running' || model.variant === 'stalled') {
      setDismissedRunId(model.runId);
    } else {
      setTerminalDismissedRunId(model.runId);
    }
  };

  const handleOpen = () => {
    navigate('/gallery', { state: { reopenUploadModal: Date.now() } });
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleOpen();
    }
  };

  return (
    <AnimatePresence>
      {model && (
      <motion.div
        key={model.runId || 'fallback'}
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="fixed z-[45] w-[340px] max-w-[calc(100vw-64px)]"
        // Above the two gallery FABs (upload at bottom 32 + 56 tall, 3D at
        // bottom 100 + 48 tall) so the card never covers them.
        style={{ bottom: 164, right: 32 }}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={handleOpen}
          onKeyDown={handleKeyDown}
          title="Open the upload modal"
          className={`w-full cursor-pointer rounded-[var(--radius-box)] border ${style.border} bg-base-100/95 p-3 shadow-2xl backdrop-blur transition-shadow hover:shadow-[0_8px_32px_oklch(from_var(--color-primary)_l_c_h/0.25)]`}
        >
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5">{style.icon}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-base-content">
                  {model.title}
                </p>
                {model.batchText && (
                  <span className="shrink-0 rounded-full border border-base-300 bg-base-200 px-2 py-0.5 text-[11px] font-semibold text-base-content/75">
                    {model.batchText}
                  </span>
                )}
                {model.percent !== null && (
                  <span className="shrink-0 text-xs font-semibold text-base-content/75">
                    {model.percent}%
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-base-content/65" title={model.subtitle}>
                {model.subtitle}
              </p>
              {bytesLine && (
                <p className="mt-0.5 text-[11px] text-base-content/50">{bytesLine}</p>
              )}
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-base-300">
                {model.percent !== null ? (
                  <div
                    className={`h-full rounded-full ${style.bar} transition-all duration-300`}
                    style={{ width: `${model.percent}%` }}
                  />
                ) : (
                  <div className={`h-full w-1/3 animate-pulse rounded-full ${style.bar}`} />
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={handleDismiss}
              className="btn btn-ghost btn-xs shrink-0"
              aria-label="Hide progress card"
              title="Hide this card (the upload keeps running)"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </motion.div>
      )}
    </AnimatePresence>
  );
}
