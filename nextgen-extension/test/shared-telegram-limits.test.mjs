// node:test suite for packages/shared/telegramLimits.js + hostUploadLimits.js
// (the Telegram caps + the per-host pre-flight). Pure functions, no network.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TELEGRAM_GETFILE_MAX_BYTES,
  TELEGRAM_NATIVE_MAX_BYTES,
  TELEGRAM_UPLOAD_MAX_BYTES,
  assertTelegramUploadSize,
  formatBytesForError,
  telegramUploadField,
  telegramUploadMethod,
  telegramUploadSizeCap,
} from '../../packages/shared/telegramLimits.js';
import {
  describeHostUploadLimit,
  partitionHostsByUploadLimit,
} from '../../packages/shared/hostUploadLimits.js';

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('telegramLimits constants', () => {
  test('sendVideo cap is 50 MiB', () => {
    assert.equal(TELEGRAM_UPLOAD_MAX_BYTES, 50 * MB);
  });
  test('getFile gate is 20 MiB', () => {
    assert.equal(TELEGRAM_GETFILE_MAX_BYTES, 20 * MB);
  });
  test('native MTProto cap is 2000 MiB', () => {
    assert.equal(TELEGRAM_NATIVE_MAX_BYTES, 2000 * MB);
  });
});

describe('formatBytesForError', () => {
  test('non-finite sizes are unknown', () => {
    assert.equal(formatBytesForError(NaN), 'unknown size');
    assert.equal(formatBytesForError(Infinity), 'unknown size');
    assert.equal(formatBytesForError(undefined), 'unknown size');
  });
  test('bytes stay bytes below 1 KiB', () => {
    assert.equal(formatBytesForError(0), '0 B');
    assert.equal(formatBytesForError(512), '512 B');
    assert.equal(formatBytesForError(1023), '1023 B');
  });
  test('KiB rounds to whole KB', () => {
    assert.equal(formatBytesForError(1024), '1 KB');
    assert.equal(formatBytesForError(1536), '2 KB');
  });
  test('MiB renders with one decimal', () => {
    assert.equal(formatBytesForError(1 * MB), '1.0 MB');
    assert.equal(formatBytesForError(900.5 * MB), '900.5 MB');
    assert.equal(formatBytesForError(20 * MB), '20.0 MB');
    assert.equal(formatBytesForError(50 * MB), '50.0 MB');
  });
  test('GiB renders with two decimals', () => {
    assert.equal(formatBytesForError(1 * GB), '1.00 GB');
    assert.equal(formatBytesForError(2.5 * GB), '2.50 GB');
  });
  test('2000 MiB renders as 1.95 GB (the native-cap pin)', () => {
    assert.equal(formatBytesForError(2000 * MB), '1.95 GB');
  });
});

describe('telegramUploadField', () => {
  test('mp4 goes out as video', () => {
    assert.equal(telegramUploadField('clip.mp4'), 'video');
    assert.equal(telegramUploadField('CLIP.MP4'), 'video');
    assert.equal(telegramUploadField('a/b/c.mp4?x=1'), 'video');
  });
  test('images are always documents', () => {
    for (const name of ['a.jpg', 'a.jpeg', 'a.png', 'a.gif', 'a.webp', 'a.bmp', 'a.tif', 'a.tiff', 'a.avif', 'a.heic']) {
      assert.equal(telegramUploadField(name), 'document', name);
    }
  });
  test('other video containers stay documents', () => {
    for (const name of ['a.mkv', 'a.mov', 'a.webm', 'a.avi']) {
      assert.equal(telegramUploadField(name), 'document', name);
    }
  });
  test('video/mp4 mime rescues an extension-less file', () => {
    assert.equal(telegramUploadField('noext', 'video/mp4'), 'video');
    assert.equal(telegramUploadField('file.bin', 'VIDEO/MP4'), 'video');
  });
  test('an image extension beats a video/mp4 mime', () => {
    assert.equal(telegramUploadField('photo.jpg', 'video/mp4'), 'document');
  });
  test('empty input is a document', () => {
    assert.equal(telegramUploadField(), 'document');
    assert.equal(telegramUploadField('', ''), 'document');
  });
});

describe('telegramUploadMethod / telegramUploadSizeCap', () => {
  test('mp4 maps to sendVideo + 50 MB', () => {
    assert.equal(telegramUploadMethod('a.mp4'), 'sendVideo');
    assert.equal(telegramUploadSizeCap('a.mp4'), 50 * MB);
  });
  test('everything else maps to sendDocument + 20 MB', () => {
    assert.equal(telegramUploadMethod('a.mkv'), 'sendDocument');
    assert.equal(telegramUploadSizeCap('a.mkv'), 20 * MB);
    assert.equal(telegramUploadMethod('a.jpg'), 'sendDocument');
    assert.equal(telegramUploadSizeCap('a.jpg'), 20 * MB);
  });
});

describe('assertTelegramUploadSize', () => {
  test('at the cap passes (video and document)', () => {
    assert.doesNotThrow(() => assertTelegramUploadSize(50 * MB, 'a.mp4'));
    assert.doesNotThrow(() => assertTelegramUploadSize(20 * MB, 'a.mkv'));
  });
  test('an over-cap mp4 throws the upload-cap message with size, cap and name', () => {
    assert.throws(
      () => assertTelegramUploadSize(60 * MB, 'big.mp4'),
      (err) => err.message.includes('Telegram upload cap')
        && err.message.includes('60.0 MB')
        && err.message.includes('50.0 MB')
        && err.message.includes('big.mp4'),
    );
  });
  test('an over-cap document throws the getFile-gate message', () => {
    assert.throws(
      () => assertTelegramUploadSize(21 * MB, 'big.mkv'),
      (err) => err.message.includes('Telegram getFile gate')
        && err.message.includes('21.0 MB')
        && err.message.includes('20.0 MB'),
    );
  });
  test('a missing filename falls back to a placeholder', () => {
    assert.throws(
      () => assertTelegramUploadSize(60 * MB, '', 'video/mp4'),
      (err) => err.message.includes('video.mp4'),
    );
    assert.throws(
      () => assertTelegramUploadSize(21 * MB, ''),
      (err) => err.message.includes('(file: file)'),
    );
  });
  test('the native host lifts both caps to 2 GB', () => {
    assert.doesNotThrow(() => assertTelegramUploadSize(168.9 * MB, 'big.mp4', '', true));
    assert.doesNotThrow(() => assertTelegramUploadSize(100 * MB, 'big.mkv', '', true));
    assert.doesNotThrow(() => assertTelegramUploadSize(2000 * MB, 'big.mp4', '', true));
  });
  test('even the native host refuses over 2 GB', () => {
    assert.throws(
      () => assertTelegramUploadSize(2.5 * GB, 'huge.mp4', '', true),
      (err) => err.message.includes('1.95 GB'),
    );
  });
  test('non-numeric sizes coerce to 0 and pass', () => {
    assert.doesNotThrow(() => assertTelegramUploadSize('not-a-number', 'a.mp4'));
    assert.doesNotThrow(() => assertTelegramUploadSize('100', 'a.mp4'));
  });
});

describe('describeHostUploadLimit', () => {
  test('telegram mkv gets the 20 MB getFile cap', () => {
    const limit = describeHostUploadLimit('telegram', { fileName: 'a.mkv' });
    assert.equal(limit.hostKey, 'telegram');
    assert.equal(limit.maxBytes, 20 * MB);
    assert.equal(limit.label, 'Telegram');
    assert.match(limit.note, /getFile/);
  });
  test('telegram mp4 gets the 50 MB sendVideo cap', () => {
    const limit = describeHostUploadLimit('telegram', { fileName: 'a.mp4' });
    assert.equal(limit.maxBytes, 50 * MB);
  });
  test('telegram mime video/mp4 also gets the 50 MB cap', () => {
    const limit = describeHostUploadLimit('telegram', { fileName: 'noext', mimeType: 'video/mp4' });
    assert.equal(limit.maxBytes, 50 * MB);
  });
  test('the native host lifts telegram to 2 GB with a note naming it', () => {
    const limit = describeHostUploadLimit('telegram', { fileName: 'a.mp4', hasNativeHost: true });
    assert.equal(limit.maxBytes, 2000 * MB);
    assert.equal(limit.note, 'Native host MTProto upload enabled up to 2 GB');
  });
  test('the native host lifts documents too, not just mp4', () => {
    const limit = describeHostUploadLimit('telegram', { fileName: 'a.mkv', hasNativeHost: true });
    assert.equal(limit.maxBytes, 2000 * MB);
  });
  test('host keys are case-insensitive', () => {
    assert.equal(describeHostUploadLimit('TELEGRAM', { fileName: 'a.mkv' }).maxBytes, 20 * MB);
  });
  test('hosts without a cap return null', () => {
    assert.equal(describeHostUploadLimit('terabox', { fileName: 'a.mkv' }), null);
    assert.equal(describeHostUploadLimit('filemoon', { fileName: 'a.mkv' }), null);
    assert.equal(describeHostUploadLimit('udrop', { fileName: 'a.mkv' }), null);
  });
  test('unknown and empty hosts return null', () => {
    assert.equal(describeHostUploadLimit('nope', { fileName: 'a.mkv' }), null);
    assert.equal(describeHostUploadLimit('', { fileName: 'a.mkv' }), null);
    assert.equal(describeHostUploadLimit(null), null);
  });
});

describe('partitionHostsByUploadLimit', () => {
  const services = [
    { key: 'filemoon', label: 'Filemoon' },
    { key: 'udrop', label: 'UDrop' },
    { key: 'terabox', label: 'TeraBox' },
    { key: 'telegram', label: 'Telegram' },
  ];

  test('a 901 MB mkv is rejected by telegram only, with the size and cap named', () => {
    const { accepted, rejected } = partitionHostsByUploadLimit(services, { bytes: 900.5 * MB, fileName: 'big.mkv' });
    assert.deepEqual(accepted.map((s) => s.key), ['filemoon', 'udrop', 'terabox']);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].service.key, 'telegram');
    assert.equal(rejected[0].limit.maxBytes, 20 * MB);
    assert.match(rejected[0].reason, /^Telegram cannot take this file: 900\.5 MB is over its 20\.0 MB limit/);
    assert.match(rejected[0].reason, /getFile/);
  });
  test('a 10 MB mp4 is accepted everywhere', () => {
    const { accepted, rejected } = partitionHostsByUploadLimit(services, { bytes: 10 * MB, fileName: 'a.mp4' });
    assert.equal(accepted.length, 4);
    assert.equal(rejected.length, 0);
  });
  test('a 60 MB mp4 is rejected by telegram at the 50 MB video cap', () => {
    const { rejected } = partitionHostsByUploadLimit(services, { bytes: 60 * MB, fileName: 'a.mp4' });
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].reason, /50\.0 MB/);
  });
  test('a 168.9 MB mp4 is accepted by telegram with the native host', () => {
    const { accepted, rejected } = partitionHostsByUploadLimit(services, { bytes: 168.9 * MB, fileName: 'a.mp4', hasNativeHost: true });
    assert.ok(accepted.some((s) => s.key === 'telegram'));
    assert.equal(rejected.length, 0);
  });
  test('a 2.5 GB mp4 is rejected even with the native host, cap named as 1.95 GB', () => {
    const { rejected } = partitionHostsByUploadLimit(services, { bytes: 2.5 * GB, fileName: 'a.mp4', hasNativeHost: true });
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].reason, /1\.95 GB/);
  });
  test('an empty or missing selection accepts and rejects nothing', () => {
    assert.deepEqual(partitionHostsByUploadLimit([], { bytes: 10 * MB }), { accepted: [], rejected: [] });
    assert.deepEqual(partitionHostsByUploadLimit(null, { bytes: 10 * MB }), { accepted: [], rejected: [] });
  });
  test('a service with no key is accepted (no limit can be found for it)', () => {
    const { accepted, rejected } = partitionHostsByUploadLimit([{ label: 'Mystery' }], { bytes: 10 * GB });
    assert.equal(accepted.length, 1);
    assert.equal(rejected.length, 0);
  });
  test('a size exactly at the cap is accepted', () => {
    const { rejected } = partitionHostsByUploadLimit(services, { bytes: 20 * MB, fileName: 'a.mkv' });
    assert.equal(rejected.length, 0);
  });
});
