// unit tests for the TeraBox orphan/duplicate matching (2.19.4)
//
// run:  node test-terabox-orphan-matching.mjs
//
// WHY THIS EXISTS: the orphan scan decided "is this file referenced?" by NAME
// only, so it skipped every file whose name appeared anywhere in the vault.
// A duplicate is exactly that: the item points at ONE copy (by fs_id) and the
// second copy has the SAME NAME with a different fs_id. The name matched, the
// copy was swallowed, and it could never be cleaned up - a second copy of a
// 900 MB video sat on the account, invisible to the Resolve page.
import {
  addTeraBoxRef,
  classifyTeraBoxFiles,
  createTeraBoxRefIndex,
  isTeraBoxFileReferenced,
  isVaultFolderFile,
} from 'imgvault-shared/teraboxRefs.js';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const file = (fs_id, server_filename) => ({ fs_id, server_filename });

// --- the reported case: one item, two copies with the same name ---------
const index = createTeraBoxRefIndex();
// the gallery item claims fs_id 111 under that name
addTeraBoxRef(index, '111', 'sample-clip.mkv');

const copyA = file('111', 'sample-clip.mkv');
const copyB = file('222', 'sample-clip.mkv');

check('the copy the item points at is referenced', isTeraBoxFileReferenced(copyA, index));
check('the SECOND copy with the same name is NOT referenced', !isTeraBoxFileReferenced(copyB, index));

const split = classifyTeraBoxFiles([copyA, copyB], index);
check('the duplicate is reported as an orphan', split.extra.length === 1, `extra=${split.extra.length}`);
check('the orphan is the second copy', split.extra[0]?.fs_id === '222', split.extra[0]?.fs_id);
check('the linked copy is not reported', split.referenced.length === 1 && split.referenced[0].fs_id === '111');

// --- the old buggy rule must be gone -----------------------------------
check(
  'a name match alone no longer marks a file as referenced',
  !isTeraBoxFileReferenced(file('999', 'sample-clip.mkv'), index)
);

// --- an item that only knows the NAME -----------------------------------
const nameOnly = createTeraBoxRefIndex();
addTeraBoxRef(nameOnly, '', 'holiday.mp4');
check('a name-only claim still matches a file with an id', isTeraBoxFileReferenced(file('555', 'holiday.mp4'), nameOnly));
check('a name-only claim does not swallow a different name', !isTeraBoxFileReferenced(file('556', 'other.mp4'), nameOnly));

// --- two DIFFERENT items, two files that share a name -------------------
const twoItems = createTeraBoxRefIndex();
addTeraBoxRef(twoItems, '111', 'clip.mp4');
addTeraBoxRef(twoItems, '222', 'clip.mp4');
const twoSplit = classifyTeraBoxFiles([file('111', 'clip.mp4'), file('222', 'clip.mp4')], twoItems);
check('two linked copies of the same name stay linked', twoSplit.extra.length === 0, `extra=${twoSplit.extra.length}`);

// --- a plain orphan ------------------------------------------------------
const plain = createTeraBoxRefIndex();
addTeraBoxRef(plain, '111', 'linked.mp4');
const plainSplit = classifyTeraBoxFiles([file('111', 'linked.mp4'), file('333', 'nobody-claims-me.mkv')], plain);
check('an unclaimed file is an orphan', plainSplit.extra.length === 1 && plainSplit.extra[0].fs_id === '333');

// --- the scene skip ------------------------------------------------------
const skipSplit = classifyTeraBoxFiles(
  [file('444', 'scene.spz'), file('555', 'plain.mkv')],
  plain,
  { shouldSkip: (f) => String(f.server_filename || '').endsWith('.spz') }
);
check('a skipped file is not reported at all', skipSplit.extra.length === 1 && skipSplit.extra[0].fs_id === '555');
check('a skipped file is not reported as referenced either', skipSplit.referenced.length === 0);

// --- only the folder the vault writes to ---------------------------------
// The uploader sanitizes the destination name with split('/').pop() and
// uploads to /<name>, so every vault file lands in the ROOT folder. Files in
// other folders belong to other tools (the gh-mirror bundles) and must never
// be reported as vault orphans with a delete button on them.
check('a root-folder file is a vault file', isVaultFolderFile({ _folder: 'root' }));
check('a file without a folder marker counts as root', isVaultFolderFile({}));
check('a gh-mirror file is NOT a vault file', !isVaultFolderFile({ _folder: 'gh-mirror' }));
check('a nested folder is NOT a vault file', !isVaultFolderFile({ _folder: 'videos/2026' }));

const folderSplit = classifyTeraBoxFiles(
  [
    { ...file('111', 'linked.mp4'), _folder: 'root' },
    { ...file('222', 'bundle.bundle'), _folder: 'gh-mirror' },
    { ...file('333', 'orphan.mkv'), _folder: 'root' },
  ],
  plain,
  { shouldSkip: (f) => !isVaultFolderFile(f) }
);
check(
  'a file from another folder is not reported as an orphan',
  folderSplit.extra.length === 1 && folderSplit.extra[0].fs_id === '333',
  `extra=${folderSplit.extra.map((f) => f.fs_id).join(',')}`
);

// --- an empty listing ----------------------------------------------------
const emptySplit = classifyTeraBoxFiles([], plain);
check('an empty listing yields nothing', emptySplit.extra.length === 0 && emptySplit.referenced.length === 0);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  process.exitCode = 1;
}
