// unit tests for the pending-upload reservation flag + the interrupted-run
// message repair (2.19.4)
//
// run:  node test-pending-upload-flags.mjs
//
// WHY THIS EXISTS: a finished upload kept the "pending upload" flag forever.
// The row stores every extra key TWICE (mirrored top-level + inside
// extraMetadata), and the payload builder merged the stale mirror back over
// the cleaned extra copy - so the flag the finalisation write had removed
// came straight back.
//
// That is not cosmetic. The resolve page matches an orphaned host file to a
// pending row BY NAME, so a finished item that still says "pending" made the
// page offer to "recover" a file that was already linked - that is how one
// video ended up on TeraBox twice.
//
// The same run also left the gallery with a false banner ("Nothing was saved
// for this upload") for an upload that WAS saved, plus a Resume button that
// would have pushed a second copy to the host that never finished.
import { toMediaDbPayload } from 'imgvault-shared/mediaDbPayload.js';
import {
  PENDING_UPLOAD_EXTRA_KEYS,
  hasVideoHostLinks,
  isPendingUploadItem,
  withoutPendingUploadFlags,
} from 'imgvault-shared/pendingUpload.js';
import {
  UPLOAD_RUN_STATUS,
  describeSavedOutcome,
  needsSavedOutcomeRepair,
  repairSavedOutcomeSummary,
} from './src/utils/uploadRun.js';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// --- the row as it comes back from the database --------------------------
// fromNeonMediaRow mirrors every extra key top-level AND hands the extra
// copy back, so a reserved upload looks like this:
const reservedRow = {
  id: 'item-1',
  kind: 'video',
  isVideo: true,
  isLink: false,
  fileName: 'sample-clip.mkv',
  fileSize: 7600000,
  fileType: 'video/x-matroska',
  pageTitle: 'Sample clip',
  sourcePageUrl: 'https://example.com/watch',
  tags: [],
  videoHosts: {
    terabox: { watchUrl: 'https://terabox.example/s/abc', fileId: '900100200300' },
  },
  extraMetadata: {
    pendingUpload: true,
    pendingUploadStartedAt: '2026-10-26T13:49:30.000Z',
    pendingUploadFileName: 'sample-clip.mkv',
    videoHosts: {
      terabox: { watchUrl: 'https://terabox.example/s/abc', fileId: '900100200300' },
    },
  },
};

// --- 1. the bug: the mirrored copy wins ----------------------------------
{
  const payload = toMediaDbPayload({ ...reservedRow }, reservedRow);
  check(
    'the stale mirror keeps the flag alive (the 2.19.4 bug)',
    payload.extraMetadata.pendingUpload === true,
    `pendingUpload=${payload.extraMetadata.pendingUpload}`
  );
}

// --- 2. the fix: an explicit delete wins --------------------------------
{
  const cleanedExtra = withoutPendingUploadFlags(reservedRow.extraMetadata);
  const source = { ...reservedRow, extraMetadata: cleanedExtra };
  // the top-level mirror is still there - the delete must beat it
  delete source.pendingUpload;
  delete source.pendingUploadStartedAt;
  delete source.pendingUploadFileName;

  const payload = toMediaDbPayload(source, reservedRow, {
    extraMetadataDeletes: PENDING_UPLOAD_EXTRA_KEYS,
  });

  check(
    'the finalisation write removes pendingUpload',
    payload.extraMetadata.pendingUpload === undefined,
    `pendingUpload=${String(payload.extraMetadata.pendingUpload)}`
  );
  check(
    'the finalisation write removes pendingUploadStartedAt',
    payload.extraMetadata.pendingUploadStartedAt === undefined
  );
  check(
    'the finalisation write removes pendingUploadFileName',
    payload.extraMetadata.pendingUploadFileName === undefined
  );
  check(
    'the host links survive the deletion',
    payload.extraMetadata.videoHosts?.terabox?.fileId === '900100200300'
  );
  check(
    'the delete list does not touch anything else',
    payload.extraMetadata.videoHosts !== undefined
      && payload.fileName === 'sample-clip.mkv'
  );
}

// --- 3. the helpers ------------------------------------------------------
{
  check('isPendingUploadItem sees the flag', isPendingUploadItem(reservedRow) === true);
  check(
    'isPendingUploadItem sees a finished row',
    isPendingUploadItem({ ...reservedRow, extraMetadata: withoutPendingUploadFlags(reservedRow.extraMetadata) }) === false
  );
  check(
    'hasVideoHostLinks finds the host links',
    hasVideoHostLinks(reservedRow) === true
  );
  check(
    'hasVideoHostLinks says no for a row without links',
    hasVideoHostLinks({ id: 'x', extraMetadata: { pendingUpload: true } }) === false
  );

  const cleaned = withoutPendingUploadFlags(reservedRow.extraMetadata);
  check(
    'withoutPendingUploadFlags removes exactly the three flags',
    Object.keys(cleaned).length === 1 && cleaned.videoHosts !== undefined,
    Object.keys(cleaned).join(',')
  );
}

// --- 4. the interrupted-run message repair -------------------------------
{
  const lyingRun = {
    id: 'upload-run-1',
    status: UPLOAD_RUN_STATUS.INTERRUPTED,
    fileName: 'sample-clip.mkv',
    hosts: ['Telegram', 'TeraBox'],
    hostKeys: ['telegram', 'terabox'],
    hostsDone: { terabox: { apiStatus: 'success' } },
    summary:
      'The gallery tab was closed while Telegram, TeraBox was still running. Nothing was saved for this upload.',
  };

  check('the lying run is detected', needsSavedOutcomeRepair(lyingRun) === true);
  check(
    'a run with no evidence keeps its (honest) summary',
    repairSavedOutcomeSummary({ ...lyingRun, hostsDone: {} }).summary === lyingRun.summary
  );
  check(
    'a successful run is left alone',
    needsSavedOutcomeRepair({ ...lyingRun, status: UPLOAD_RUN_STATUS.SUCCESS }) === false
  );
  check(
    'a run that already names the saved item is left alone',
    needsSavedOutcomeRepair({
      ...lyingRun,
      summary: 'Closed. The item was saved to the gallery (ID abc-123).',
    }) === false
  );

  const repaired = repairSavedOutcomeSummary(lyingRun);
  check(
    'the lie is replaced by the truth',
    !repaired.summary.includes('Nothing was saved for this upload')
      && repaired.summary.includes('TeraBox'),
    repaired.summary
  );
  check(
    'the reason is kept',
    repaired.summary.startsWith('The gallery tab was closed while'),
    repaired.summary
  );
  check(
    'the repaired run still reads as an interruption',
    repaired.status === UPLOAD_RUN_STATUS.INTERRUPTED
  );

  const savedRun = {
    ...lyingRun,
    savedItemId: 'a1b2c3d4-0000-4000-8000-000000000001',
  };
  const repairedSaved = repairSavedOutcomeSummary(savedRun);
  check(
    'a saved run says the item is in the gallery',
    repairedSaved.summary.includes('a1b2c3d4-0000-4000-8000-000000000001'),
    repairedSaved.summary
  );
  check(
    'describeSavedOutcome prefers the saved item',
    describeSavedOutcome(savedRun).includes('a1b2c3d4-0000-4000-8000-000000000001')
  );

  // the second repair pass: the summary already says "reached TeraBox, but
  // the gallery item was not saved" - the lookup finds the item and the
  // sentence has to become the truth.
  const halfRepaired = {
    ...lyingRun,
    summary:
      'No progress for more than 90s during TeraBox, Telegram. The upload reached TeraBox, but the gallery item was not saved.',
  };
  check(
    'the half-repaired summary is still detected',
    needsSavedOutcomeRepair(halfRepaired) === true
  );
  const fullyRepaired = repairSavedOutcomeSummary(halfRepaired, 'a1b2c3d4-0000-4000-8000-000000000001');
  check(
    'the found item replaces the wrong claim',
    fullyRepaired.summary.endsWith('The item was saved to the gallery (ID a1b2c3d4-0000-4000-8000-000000000001).')
      && !fullyRepaired.summary.includes('not saved'),
    fullyRepaired.summary
  );
  check(
    'the found item is recorded on the run',
    fullyRepaired.savedItemId === 'a1b2c3d4-0000-4000-8000-000000000001'
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.error('FAILED:');
  for (const f of failed) console.error(`  - ${f.name} ${f.detail}`);
  process.exit(1);
}
