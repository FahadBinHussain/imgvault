// Regression tests mined from the ImgVault bug history (AGENTS.md).
// Area: persistent upload-progress widget (2.19.39).
//
// User request (2026-11-24 12:44): closing the upload modal hid the
// upload entirely — the transfer kept running, but the only way to watch
// it was to reopen the modal. Now a floating card (app level, so it
// survives route changes and shows on the vault page too) keeps showing
// the live upload after the modal closes. Click reopens the modal;
// dismiss (X) hides the card ONLY and never cancels anything.
//
// Live tests cover the extracted seam (utils/uploadWidget.js). The page
// + shell wiring is pinned with SOURCE-TEXT assertions, like the
// 2.19.32 / 2.19.37 / 2.19.38 tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UPLOAD_STALL_WINDOW_MS } from '../src/utils/uploadRun.js';
import {
  UPLOAD_BATCH_KEY,
  UPLOAD_MODAL_OPEN_KEY,
  UPLOAD_WIDGET_SUCCESS_AUTO_DISMISS_MS,
  getUploadWidgetModel,
} from '../src/utils/uploadWidget.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const gallery = () => src('../src/pages/GalleryPage.jsx');
const widget = () => src('../src/components/UploadProgressWidget.jsx');
const shell = () => src('../src/index.jsx');

const NOW = 1_800_000_000_000;

const runningRun = (overrides = {}) => ({
  id: 'run-1',
  kind: 'video',
  owner: 'page',
  hosts: ['TeraBox'],
  hostKeys: ['terabox'],
  fileName: 'clip.mp4',
  bytesTotal: 100 * 1024 * 1024,
  bytesSent: 45 * 1024 * 1024,
  percent: 45,
  status: 'running',
  startedAt: NOW - 60_000,
  updatedAt: NOW - 1_000,
  ...overrides,
});

const model = (overrides = {}) => getUploadWidgetModel({
  run: runningRun(),
  uploadActive: true,
  uploadStatusText: 'TeraBox upload progress: 45% (45 MB / 100 MB)',
  batch: null,
  modalOpen: false,
  dismissedRunId: null,
  terminalDismissedRunId: null,
  fallbackDismissed: false,
  now: NOW,
  ...overrides,
});

// ------------------------------------------------------------- visibility ---

test('2.19.39 (2026-11-24): a running upload with the modal closed shows the card with the run percent and bytes', () => {
  const card = model();
  assert.ok(card, 'the card must show');
  assert.equal(card.variant, 'running');
  assert.equal(card.runId, 'run-1');
  assert.equal(card.title, 'clip.mp4');
  assert.equal(card.percent, 45);
  assert.equal(card.bytesSent, 45 * 1024 * 1024);
  assert.equal(card.bytesTotal, 100 * 1024 * 1024);
  assert.equal(card.autoDismiss, false, 'a live upload never auto-dismisses');
  assert.equal(card.isFallback, false);
});

test('2.19.39 (2026-11-24): the card hides while the modal is open — the modal shows the full log', () => {
  assert.equal(model({ modalOpen: true }), null);
});

test('2.19.39 (2026-11-24): idle shows nothing — no run, no legacy flag', () => {
  assert.equal(model({ run: null, uploadActive: false, uploadStatusText: '' }), null);
});

test('2.19.39 (2026-11-24): dismissing hides the card for that run only — the next run shows again', () => {
  assert.equal(model({ dismissedRunId: 'run-1' }), null, 'dismissed run stays hidden');
  assert.ok(model({ dismissedRunId: 'run-0' }), 'a new run id is not dismissed');
});

test('2.19.39 (2026-11-24): a success run shows the brief success card that auto-dismisses', () => {
  const card = model({ run: runningRun({ status: 'success', percent: 100, summary: 'Video upload completed successfully.' }) });
  assert.ok(card);
  assert.equal(card.variant, 'success');
  assert.equal(card.title, 'Upload complete');
  assert.equal(card.percent, 100);
  assert.equal(card.autoDismiss, true);
  assert.equal(UPLOAD_WIDGET_SUCCESS_AUTO_DISMISS_MS, 5000);
});

test('2.19.39 (2026-11-24): a warning close (partial success) reads as success, not an error', () => {
  const card = model({ run: runningRun({ status: 'warning', summary: 'Video upload finished with partial success.' }) });
  assert.ok(card);
  assert.equal(card.variant, 'success');
});

test('2.19.39 (2026-11-24): a per-file success inside a live batch shows the fallback, never a success flash', () => {
  const card = model({
    run: runningRun({ status: 'success' }),
    batch: { active: true, index: 3, total: 27, completed: 3, failed: 0, currentFile: 'clip.mp4' },
  });
  assert.ok(card, 'the batch is still going — the card stays up');
  assert.equal(card.variant, 'running', 'no success flash mid-batch');
  assert.equal(card.isFallback, true, 'the next file has no run yet; the legacy mirror covers the gap');
});

test('2.19.39 (2026-11-24): a dismissed success stays dismissed once the upload settles', () => {
  assert.equal(
    model({ run: runningRun({ status: 'success' }), terminalDismissedRunId: 'run-1', uploadActive: false }),
    null,
  );
});

test('2.19.39 (2026-11-24): an error run shows a loud persistent card — never auto-dismissed', () => {
  const card = model({ run: runningRun({ status: 'error', summary: 'Encrypted vault upload failed: boom' }) });
  assert.ok(card);
  assert.equal(card.variant, 'error');
  assert.equal(card.title, 'Upload failed');
  assert.equal(card.subtitle, 'Encrypted vault upload failed: boom');
  assert.equal(card.autoDismiss, false, 'errors stay until dismissed or the modal reopens');
});

test('2.19.39 (2026-11-24): an interrupted run reads as an error, and dismissing it hides it for good', () => {
  const card = model({ run: runningRun({ status: 'interrupted', summary: 'The upload stopped before it finished.' }) });
  assert.ok(card);
  assert.equal(card.variant, 'error');
  assert.equal(
    model({ run: runningRun({ status: 'interrupted' }), terminalDismissedRunId: 'run-1' }),
    null,
  );
});

test('2.19.39 (2026-11-24): a cancelled run shows nothing — the user stopped it on purpose', () => {
  assert.equal(model({ run: runningRun({ status: 'cancelled' }), uploadActive: false }), null);
});

test('2.19.39 (2026-11-24): a running run with a stale heartbeat shows the stall warning, not a frozen bar', () => {
  const stalled = model({ run: runningRun({ updatedAt: NOW - UPLOAD_STALL_WINDOW_MS - 1000 }) });
  assert.ok(stalled);
  assert.equal(stalled.variant, 'stalled');
  assert.match(stalled.subtitle, /stalled/);
  const fresh = model({ run: runningRun({ updatedAt: NOW - 1000 }) });
  assert.equal(fresh.variant, 'running');
});

// ----------------------------------------------------------------- fallback ---

test('2.19.39 (2026-11-24): no run record but the legacy flag set shows the fallback card with the status line', () => {
  const card = model({ run: null, uploadStatusText: 'Retrying TeraBox from local video file...' });
  assert.ok(card);
  assert.equal(card.variant, 'running');
  assert.equal(card.isFallback, true);
  assert.equal(card.percent, null, 'no run record means no percent — indeterminate bar');
  assert.equal(card.subtitle, 'Retrying TeraBox from local video file...');
});

test('2.19.39 (2026-11-24): the fallback over a finished run never shows the stale file name', () => {
  // Vault encrypt phase mid-batch: the previous upload finished (run =
  // success), the new upload has no run yet. The card must not name the
  // old file.
  const card = model({
    run: runningRun({ status: 'success', fileName: 'old-clip.mp4' }),
    batch: { active: true, index: 2, total: 5, completed: 1, failed: 0, currentFile: 'new-clip.mp4' },
    uploadStatusText: 'Encrypting 128 MB... 40%',
  });
  assert.ok(card, 'the encrypt phase still shows a card');
  assert.equal(card.isFallback, true);
  assert.equal(card.title, 'new-clip.mp4', 'the batch mirror names the live file');
  // Same shape without a batch: the success was dismissed, a new upload
  // is encrypting. The stale name must not leak through.
  const noBatch = model({
    run: runningRun({ status: 'success', fileName: 'old-clip.mp4' }),
    terminalDismissedRunId: 'run-1',
    uploadStatusText: 'Encrypting 128 MB... 40%',
  });
  assert.ok(noBatch);
  assert.equal(noBatch.isFallback, true);
  assert.equal(noBatch.title, 'Uploading…');
});

test('2.19.39 (2026-11-24): the fallback never resurrects a dismissed error or a cancelled run', () => {
  assert.equal(
    model({ run: runningRun({ status: 'error' }), terminalDismissedRunId: 'run-1' }),
    null,
    'dismissing the error must not bring back an indeterminate card',
  );
  assert.equal(
    model({ run: runningRun({ status: 'cancelled' }), uploadActive: true }),
    null,
    'a cancelled run stays hidden even if the flag is still set',
  );
});

test('2.19.39 (2026-11-24): dismissing the fallback hides it until the next upload', () => {
  assert.equal(model({ run: null, fallbackDismissed: true }), null);
});

// ------------------------------------------------------------- batch + data ---

test('2.19.39 (2026-11-24): an active batch renders its count on the running card', () => {
  const card = model({
    batch: { active: true, index: 3, total: 27, completed: 2, failed: 0, currentFile: 'clip.mp4' },
  });
  assert.equal(card.batchText, '3/27');
  assert.equal(
    model({ batch: { active: false, index: 0, total: 27, completed: 27, failed: 0, currentFile: '' } }).batchText,
    null,
    'an inactive batch shows no count',
  );
});

test('2.19.39 (2026-11-24): percent is clamped and a null percent means indeterminate (SW image uploads)', () => {
  assert.equal(model({ run: runningRun({ percent: 150 }) }).percent, 100);
  assert.equal(model({ run: runningRun({ percent: -5 }) }).percent, 0);
  const swImage = model({ run: runningRun({ percent: null, bytesSent: 0, bytesTotal: 0, kind: 'image' }) });
  assert.equal(swImage.percent, null);
  assert.equal(swImage.variant, 'running');
});

// ------------------------------------------------------------------- wiring ---

test('2.19.39 (2026-11-24): the widget is mounted at app level, inside the router, outside the routes', () => {
  // Strip JSX comments first: a commented-out mount must fail this pin.
  const jsx = shell().replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  assert.match(jsx, /import UploadProgressWidget from '.\/components\/UploadProgressWidget'/);
  assert.match(jsx, /<UploadProgressWidget \/>/);
  const routerOpen = jsx.indexOf('<HashRouter>');
  const widgetAt = jsx.indexOf('<UploadProgressWidget />');
  const routesClose = jsx.indexOf('</Routes>');
  const routerClose = jsx.indexOf('</HashRouter>');
  assert.ok(routerOpen !== -1 && widgetAt > routerOpen, 'inside the router (needs useNavigate)');
  assert.ok(widgetAt > routesClose, 'outside the routes (survives route changes)');
  assert.ok(widgetAt < routerClose, 'inside the router');
});

test('2.19.39 (2026-11-24): clicking the card navigates to the gallery with a reopen request', () => {
  assert.match(widget(), /navigate\('\/gallery', \{ state: \{ reopenUploadModal: Date\.now\(\) \} \}\)/);
  assert.match(gallery(), /location\.state\?\.reopenUploadModal/);
  assert.match(gallery(), /navigate\(location\.pathname, \{ replace: true, state: \{\} \}\)/);
});

test('2.19.39 (2026-11-24): dismiss is view-only — the widget has no cancel path anywhere', () => {
  const code = widget();
  assert.doesNotMatch(code, /cancelUpload/);
  assert.doesNotMatch(code, /terminateUploadJob/);
  assert.doesNotMatch(code, /batchCancelRequestedRef/);
  assert.doesNotMatch(code, /sendMessage\(/);
  assert.match(code, /View-only dismiss/);
});

test('2.19.39 (2026-11-24): only the success card auto-dismisses — the error timer is gated on success', () => {
  const code = widget();
  assert.match(code, /modelVariant !== 'success'/);
  assert.match(code, /UPLOAD_WIDGET_SUCCESS_AUTO_DISMISS_MS/);
});

test('2.19.39 (2026-11-24): the vault flow reports to the run ledger — begin, progress ticks, close', () => {
  const page = gallery();
  const start = page.indexOf('const uploadVaultedDirectly');
  const end = page.indexOf('const upload3DDirectly');
  assert.ok(start !== -1 && end > start, 'vault flow bounds found');
  const vault = page.slice(start, end);
  assert.match(vault, /let runOutcomeVault = \{/);
  assert.match(vault, /await beginUploadRun\(\{\s*kind: 'vault',/);
  assert.match(vault, /await reportUploadRunProgress\(\{\s*percent,\s*bytesSent: loaded,/);
  assert.match(vault, /await reportUploadRunProgress\(\{\s*percent: 100,/);
  assert.match(vault, /await endUploadRun\(runOutcomeVault\.status, runOutcomeVault\.summary/);
  // Close-before-flag-clear: the run settles before uploadActive drops,
  // exactly like the video flow.
  assert.ok(
    vault.indexOf('await endUploadRun(runOutcomeVault') < vault.lastIndexOf("uploadActive: false"),
    'the run closes before the active flag clears',
  );
});

test('2.19.39 (2026-11-24): every batch transition is mirrored to storage — no bare batch setState remains', () => {
  const page = gallery();
  assert.match(page, /chrome\.storage\.local\.set\(\{ \[UPLOAD_BATCH_KEY\]: next \}\)/);
  assert.equal(UPLOAD_BATCH_KEY, 'uploadBatch');
  assert.doesNotMatch(page, /setBatchUploadState\(\{/);
  assert.doesNotMatch(page, /setBatchUploadState\(\(current\)/);
  assert.match(page, /setBatchUploadStateMirrored\(\{/);
});

test('2.19.39 (2026-11-24): the modal-open state is mirrored to storage with an unmount cleanup', () => {
  const page = gallery();
  assert.match(page, /chrome\.storage\.local\.set\(\{ \[UPLOAD_MODAL_OPEN_KEY\]: showUploadModal \}\)/);
  assert.match(page, /chrome\.storage\.local\.set\(\{ \[UPLOAD_MODAL_OPEN_KEY\]: false \}\)/);
  assert.equal(UPLOAD_MODAL_OPEN_KEY, 'uploadModalOpen');
  assert.match(widget(), /useChromeStorage\(UPLOAD_MODAL_OPEN_KEY, false, 'local'\)/);
});
