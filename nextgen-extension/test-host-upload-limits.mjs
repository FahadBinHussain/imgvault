// unit tests for the host size pre-flight (2.19.3)
//
// run:  node test-host-upload-limits.mjs
//
// WHY THIS EXISTS: a 901 MB `.mkv` was uploaded to TeraBox and Telegram.
// Telegram died at the END with "Telegram getFile gate: 900.5 MB is over the
// 20.0 MB getFile limit" - the Bot API reads files back through getFile, and
// that stops at 20 MB, so this file could NEVER be served by Telegram. The
// failure surfaced after the other host had already taken the file, and a
// resume hit the very same gate, so it never fixed anything.
//
// The cap is now checked BEFORE the first byte goes out.
import {
  describeHostUploadLimit,
  partitionHostsByUploadLimit,
} from './src/utils/hostUploadLimits.js';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const MB = 1024 * 1024;

const telegram = { key: 'telegram', label: 'Telegram' };
const terabox = { key: 'terabox', label: 'TeraBox' };

// --- the limit of a single host ----------------------------------------
check('telegram has a limit', describeHostUploadLimit('telegram', { fileName: 'a.mkv' }) !== null);
check('terabox has no limit', describeHostUploadLimit('terabox', { fileName: 'a.mkv' }) === null);
check(
  'an mp4 uses the 50 MB video cap',
  describeHostUploadLimit('telegram', { fileName: 'a.mp4' }).maxBytes === 50 * MB,
  `${describeHostUploadLimit('telegram', { fileName: 'a.mp4' }).maxBytes}`
);
check(
  'an mkv uses the 20 MB getFile cap',
  describeHostUploadLimit('telegram', { fileName: 'a.mkv' }).maxBytes === 20 * MB,
  `${describeHostUploadLimit('telegram', { fileName: 'a.mkv' }).maxBytes}`
);

// The exact size the user hit: "900.5 MB is over the 20.0 MB getFile limit".
const BIG_FILE_BYTES = Math.round(900.5 * MB);

// --- the reported case: 901 MB to TeraBox + Telegram ---------------------
const big = partitionHostsByUploadLimit([terabox, telegram], {
  bytes: BIG_FILE_BYTES,
  fileName: 'big-video.mkv',
  mimeType: '',
});

check('terabox still takes the 901 MB file', big.accepted.some((s) => s.key === 'terabox'));
check('telegram is rejected for the 901 MB file', big.rejected.length === 1, `${big.rejected.length}`);
check('telegram is not in the accepted list', !big.accepted.some((s) => s.key === 'telegram'));
check('the reason names the size', big.rejected[0].reason.includes('900.5 MB'), big.rejected[0].reason);
check('the reason names the cap', big.rejected[0].reason.includes('20.0 MB'), big.rejected[0].reason);
check('the reason names the host', big.rejected[0].reason.startsWith('Telegram cannot take this file'), big.rejected[0].reason);
check('the reason explains the gate', big.rejected[0].reason.includes('getFile'), big.rejected[0].reason);

// --- a file that fits ---------------------------------------------------
const small = partitionHostsByUploadLimit([terabox, telegram], {
  bytes: 10 * MB,
  fileName: 'clip.mp4',
  mimeType: 'video/mp4',
});
check('a 10 MB mp4 is accepted by telegram', small.accepted.some((s) => s.key === 'telegram'));
check('nothing is rejected for a 10 MB mp4', small.rejected.length === 0);

// --- the video cap ------------------------------------------------------
const bigVideo = partitionHostsByUploadLimit([telegram], {
  bytes: 60 * MB,
  fileName: 'clip.mp4',
  mimeType: 'video/mp4',
});
check('a 60 MB mp4 is over the telegram video cap', bigVideo.rejected.length === 1);
check('the video cap is named as 50.0 MB', bigVideo.rejected[0].reason.includes('50.0 MB'), bigVideo.rejected[0].reason);

// --- an empty selection -------------------------------------------------
const none = partitionHostsByUploadLimit([], { bytes: BIG_FILE_BYTES, fileName: 'a.mkv' });
check('an empty selection accepts nothing', none.accepted.length === 0);
check('an empty selection rejects nothing', none.rejected.length === 0);

// --- the pre-flight agrees with the uploader ----------------------------
const { assertTelegramUploadSize } = await import('./src/utils/telegramApi.js');
let uploaderThrew = false;
try {
  assertTelegramUploadSize(901 * MB, 'movie.mkv', '');
} catch (error) {
  uploaderThrew = /getFile gate/.test(String(error?.message || ''));
}
check('the uploader refuses the same file', uploaderThrew);
let uploaderAccepted = false;
try {
  assertTelegramUploadSize(10 * MB, 'clip.mp4', 'video/mp4');
  uploaderAccepted = true;
} catch (_) {}
check('the uploader accepts the same small file', uploaderAccepted);

// --- the native host lifts telegram to 2 GB ------------------------------
// 2.19.6 shipped the native MTProto route, but no upload ever set the
// filePath that unlocks it, so the pre-flight always applied the Bot API
// cap and Telegram skipped every >50 MB file. These cases pin the 2 GB
// behaviour the pre-flight now relies on.
check(
  'native host lifts the mp4 cap to 2000 MB',
  describeHostUploadLimit('telegram', { fileName: 'a.mp4', hasNativeHost: true }).maxBytes === 2000 * MB,
  `${describeHostUploadLimit('telegram', { fileName: 'a.mp4', hasNativeHost: true }).maxBytes}`
);
check(
  'native host lifts the mkv cap to 2000 MB',
  describeHostUploadLimit('telegram', { fileName: 'a.mkv', hasNativeHost: true }).maxBytes === 2000 * MB,
  `${describeHostUploadLimit('telegram', { fileName: 'a.mkv', hasNativeHost: true }).maxBytes}`
);
check(
  'the native note names MTProto',
  describeHostUploadLimit('telegram', { fileName: 'a.mp4', hasNativeHost: true }).note.includes('MTProto'),
  describeHostUploadLimit('telegram', { fileName: 'a.mp4', hasNativeHost: true }).note
);

// The exact size the user hit: a 168.9 MB mp4 picked from disk (no filePath).
const PICKED_FILE_BYTES = Math.round(168.9 * MB);
const pickedNative = partitionHostsByUploadLimit([telegram], {
  bytes: PICKED_FILE_BYTES,
  fileName: 'clip.mp4',
  mimeType: 'video/mp4',
  hasNativeHost: true,
});
check('a 168.9 MB mp4 is accepted by telegram with the native host', pickedNative.accepted.some((s) => s.key === 'telegram'));
check('nothing is rejected for the 168.9 MB mp4 with the native host', pickedNative.rejected.length === 0);

const pickedBot = partitionHostsByUploadLimit([telegram], {
  bytes: PICKED_FILE_BYTES,
  fileName: 'clip.mp4',
  mimeType: 'video/mp4',
  hasNativeHost: false,
});
check('the same file is still rejected without the native host', pickedBot.rejected.length === 1);

// --- the native cap still ends at 2 GB ------------------------------------
// 2000 MiB renders as 1.95 GB (the formatter divides by 1024^3) - pin the
// rendered value, not the round number.
const hugeNative = partitionHostsByUploadLimit([telegram], {
  bytes: Math.round(2.5 * 1024 * MB),
  fileName: 'huge.mp4',
  mimeType: 'video/mp4',
  hasNativeHost: true,
});
check('a 2.5 GB mp4 is rejected even with the native host', hugeNative.rejected.length === 1);
check('the native cap is named as 1.95 GB', hugeNative.rejected[0].reason.includes('1.95 GB'), hugeNative.rejected[0].reason);

// --- the uploader agrees on the native cap ----------------------------------
let uploaderAcceptedNative = false;
try {
  assertTelegramUploadSize(PICKED_FILE_BYTES, 'clip.mp4', 'video/mp4', true);
  uploaderAcceptedNative = true;
} catch (_) {}
check('the uploader accepts the 168.9 MB mp4 with the native host', uploaderAcceptedNative);
let uploaderRefusedHugeNative = false;
try {
  assertTelegramUploadSize(Math.round(2.5 * 1024 * MB), 'huge.mp4', 'video/mp4', true);
} catch (_) {
  uploaderRefusedHugeNative = true;
}
check('the uploader refuses a 2.5 GB mp4 even with the native host', uploaderRefusedHugeNative);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  process.exitCode = 1;
}
