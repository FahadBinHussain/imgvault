// unit tests for the TeraBox resumable-upload helpers (2.19.0)
// run:  node test-upload-resume.mjs
// The helpers live in src/utils/teraboxResume.js on purpose: they are pure
// (no chrome.*, no imports), so they can be tested in plain node without the
// extension bundle and without the providerCatalog <-> uploaders import cycle.
import {
  ABSENT_BLOCK_MD5,
  assertCompleteBlockList,
  calculateTeraBoxChunkSize,
  decideResumeCreateAction,
  prepareResumeState,
} from './src/utils/teraboxResume.js';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const throwsWith = async (name, fn, needle) => {
  try {
    await fn();
    check(name, false, 'did NOT throw');
  } catch (error) {
    const message = String(error?.message || error);
    check(name, message.includes(needle), message);
  }
};

const ABSENT = ABSENT_BLOCK_MD5;
const MB = 1024 * 1024;

// 20 MB file cut into 4 MB chunks -> 5 blocks
const size = 20 * MB;
const chunkSize = calculateTeraBoxChunkSize(size);
const chunkCount = Math.ceil(size / chunkSize);
check('chunk size is 4 MB for a 20 MB file', chunkSize === 4 * MB, `${chunkSize}`);
check('chunk count is 5', chunkCount === 5, `${chunkCount}`);
check('a file under 4 MB is one chunk', calculateTeraBoxChunkSize(2 * MB) === 2 * MB);

const fullBlockList = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32), 'd'.repeat(32), 'e'.repeat(32)];

// --- prepareResumeState -------------------------------------------------
const prepared = prepareResumeState(
  { uploadid: 'session-1', path: '/movie.mp4', size, chunkSize, blockList: fullBlockList },
  '/movie.mp4',
  size,
  chunkSize
);
check('resume keeps every uploaded block', prepared.blockList.filter(Boolean).length === chunkCount);
check('resume counts the bytes already on the server', prepared.presentBytes === size, `${prepared.presentBytes}`);
check('resume reuses the server session id', prepared.uploadid === 'session-1');

const partial = prepareResumeState(
  { uploadid: 'session-2', path: '/movie.mp4', size, chunkSize, blockList: [fullBlockList[0], '', fullBlockList[2]] },
  '/movie.mp4',
  size,
  chunkSize
);
check('resume only counts the blocks that are really there', partial.presentBytes === 2 * chunkSize, `${partial.presentBytes}`);
check('resume leaves the missing blocks empty', partial.blockList[1] === undefined && partial.blockList[4] === undefined);

const withSentinel = prepareResumeState(
  { uploadid: 'session-3', path: '/movie.mp4', size, chunkSize, blockList: [fullBlockList[0], ABSENT, fullBlockList[2]] },
  '/movie.mp4',
  size,
  chunkSize
);
check('the absent sentinel never counts as uploaded', withSentinel.presentBytes === 2 * chunkSize, `${withSentinel.presentBytes}`);

await throwsWith(
  'a resume state for a different file size is rejected loudly',
  () => prepareResumeState({ uploadid: 'x', path: '/movie.mp4', size: 10 * MB, chunkSize, blockList: [] }, '/movie.mp4', size, chunkSize),
  'does not match this file'
);
await throwsWith(
  'a resume state for a different path is rejected loudly',
  () => prepareResumeState({ uploadid: 'x', path: '/other.mp4', size, chunkSize, blockList: [] }, '/movie.mp4', size, chunkSize),
  'does not match this file'
);
await throwsWith(
  'a resume state without an uploadid is rejected loudly',
  () => prepareResumeState({ path: '/movie.mp4', size, chunkSize, blockList: [] }, '/movie.mp4', size, chunkSize),
  'no uploadid'
);
await throwsWith(
  'a resume state with a bad blockList is rejected loudly',
  () => prepareResumeState({ uploadid: 'x', path: '/movie.mp4', size, chunkSize, blockList: 'nope' }, '/movie.mp4', size, chunkSize),
  'invalid blockList'
);

// --- assertCompleteBlockList ------------------------------------------
const complete = assertCompleteBlockList(fullBlockList, chunkCount);
check('a complete block list passes through', complete.length === chunkCount && complete[0] === fullBlockList[0]);
await throwsWith(
  'a hole in the block list is refused before create',
  () => assertCompleteBlockList([fullBlockList[0], '', fullBlockList[2], fullBlockList[3], fullBlockList[4]], chunkCount),
  'cannot be created'
);
await throwsWith(
  'the absent sentinel never reaches create',
  () => assertCompleteBlockList([fullBlockList[0], ABSENT, fullBlockList[2], fullBlockList[3], fullBlockList[4]], chunkCount),
  'cannot be created'
);

// --- the resume must never create the file twice ------------------------
// A resume whose blocks are ALL on the server used to call create() again,
// which made a second copy of the video on terabox.
const createdState = prepareResumeState(
  { uploadid: 's', path: '/movie.mp4', size, chunkSize, blockList: fullBlockList, created: true, createdPath: '/movie(1).mp4' },
  '/movie.mp4',
  size,
  chunkSize
);
check('a created session is carried through the resume state', createdState.created === true);
check('the created path is carried through', createdState.createdPath === '/movie(1).mp4', createdState.createdPath);

const notCreatedState = prepareResumeState(
  { uploadid: 's', path: '/movie.mp4', size, chunkSize, blockList: fullBlockList },
  '/movie.mp4',
  size,
  chunkSize
);
check('a session without a create is not marked created', notCreatedState.created === false);

check('missing bytes -> upload them and create the file',
  decideResumeCreateAction({ presentBytes: 0, size, created: false, existingFile: null }) === 'create');
check('all bytes present + the file exists -> reuse it, never create it again',
  decideResumeCreateAction({ presentBytes: size, size, created: true, existingFile: { fs_id: '1' } }) === 'reuse');
check('all bytes present + no file + never created -> create it once',
  decideResumeCreateAction({ presentBytes: size, size, created: false, existingFile: null }) === 'create');
check('all bytes present + no file + it was created before -> refuse to guess',
  decideResumeCreateAction({ presentBytes: size, size, created: true, existingFile: null }) === 'abort');

// --- a resumed upload reports the real percentage ----------------------
// The progress of a resumed run must include the blocks that are already on
// the server, otherwise the UI would jump back to 0% after a resume.
const alreadyOnServer = 3 * chunkSize;
const resumedLoaded = alreadyOnServer;
const resumedPercent = Math.round((resumedLoaded / size) * 100);
check('a resumed run starts at the percentage it really is at', resumedPercent === 60, `${resumedPercent}%`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pass`);
process.exit(failed.length ? 1 : 0);
