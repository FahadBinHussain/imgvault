// node:test suite for src/utils/teraboxResume.js — the pure helpers behind
// the TeraBox (PCS superfile2) resumable upload. No chrome.*, no imports in
// the module under test, so everything here runs in plain node.
//
// The chunk-size table is the 2.19.23 fix: the old code doubled the 4 GB
// threshold with a 32-bit shift, so the threshold became 0 on the first
// doubling and calculateTeraBoxChunkSize NEVER RETURNED for any file over
// 4 GB. The boundary tests below pin the doubling rule at every threshold
// up to 1 TB — each test asserting a return value IS the hang regression
// test (the old code would hang the suite instead of failing it).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ABSENT_BLOCK_MD5,
  assertCompleteBlockList,
  calculateTeraBoxChunkSize,
  decideResumeCreateAction,
  formatBytesForError,
  prepareResumeState,
} from '../src/utils/teraboxResume.js';

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('calculateTeraBoxChunkSize', () => {
  test('a file under 4 MB is a single chunk of its own size', () => {
    assert.equal(calculateTeraBoxChunkSize(2 * MB), 2 * MB);
    assert.equal(calculateTeraBoxChunkSize(1), 1);
    assert.equal(calculateTeraBoxChunkSize(4 * MB - 1), 4 * MB - 1);
  });
  test('a zero or negative size still returns a 1-byte chunk (never 0)', () => {
    assert.equal(calculateTeraBoxChunkSize(0), 1);
    assert.equal(calculateTeraBoxChunkSize(-5), 1);
  });
  test('exactly 4 MB takes the 4 MB chunk', () => {
    assert.equal(calculateTeraBoxChunkSize(4 * MB), 4 * MB);
  });
  test('4 MB .. 4 GB takes the 4 MB chunk', () => {
    assert.equal(calculateTeraBoxChunkSize(20 * MB), 4 * MB);
    assert.equal(calculateTeraBoxChunkSize(1 * GB), 4 * MB);
    assert.equal(calculateTeraBoxChunkSize(4 * GB), 4 * MB);
  });
  test('the 4 GB threshold is strict: exactly 4 GB stays 4 MB, one byte over doubles to 8 MB', () => {
    assert.equal(calculateTeraBoxChunkSize(4 * GB), 4 * MB);
    assert.equal(calculateTeraBoxChunkSize(4 * GB + 1), 8 * MB);
  });
  test('the chunk doubles at every 4 GB multiple: 8 GB -> 8 MB, 16 GB -> 16 MB, 32 GB -> 32 MB', () => {
    assert.equal(calculateTeraBoxChunkSize(8 * GB), 8 * MB);
    assert.equal(calculateTeraBoxChunkSize(8 * GB + 1), 16 * MB);
    assert.equal(calculateTeraBoxChunkSize(16 * GB), 16 * MB);
    assert.equal(calculateTeraBoxChunkSize(16 * GB + 1), 32 * MB);
    assert.equal(calculateTeraBoxChunkSize(32 * GB), 32 * MB);
  });
  test('a 1 TB file returns a 1 GB chunk — and returns at all (the old 32-bit shift hung here forever)', () => {
    const started = Date.now();
    assert.equal(calculateTeraBoxChunkSize(1024 * GB), 1024 * MB);
    assert.ok(Date.now() - started < 1000, 'must return immediately, not loop');
  });
  test('chunk sizes are always powers of two and never exceed the file below the first threshold', () => {
    for (const size of [MB, 100 * MB, 3 * GB, 5 * GB, 100 * GB, 512 * GB]) {
      const chunk = calculateTeraBoxChunkSize(size);
      assert.ok(chunk > 0 && (chunk & (chunk - 1)) === 0, `${size} -> ${chunk} is not a power of two`);
      assert.ok(chunk <= Math.max(size, 1), `${size} -> chunk ${chunk} exceeds the file`);
    }
  });
  test('the chunk count for a 20 MB file is 5 (4 MB blocks)', () => {
    const chunk = calculateTeraBoxChunkSize(20 * MB);
    assert.equal(Math.ceil((20 * MB) / chunk), 5);
  });
});

describe('prepareResumeState — loud failures', () => {
  const base = (over = {}) => ({
    uploadid: 'session-1',
    path: '/movie.mp4',
    size: 20 * MB,
    chunkSize: 4 * MB,
    blockList: [],
    ...over,
  });
  test('a state without an uploadid throws instead of resuming blind', () => {
    assert.throws(
      () => prepareResumeState(base({ uploadid: '' }), '/movie.mp4', 20 * MB, 4 * MB),
      /no uploadid/,
    );
    assert.throws(
      () => prepareResumeState(base({ uploadid: undefined }), '/movie.mp4', 20 * MB, 4 * MB),
      /no uploadid/,
    );
  });
  test('a size mismatch throws naming both sizes', () => {
    assert.throws(
      () => prepareResumeState(base({ size: 10 * MB }), '/movie.mp4', 20 * MB, 4 * MB),
      /does not match this file/,
    );
  });
  test('a path mismatch throws naming both paths', () => {
    assert.throws(
      () => prepareResumeState(base({ path: '/other.mp4' }), '/movie.mp4', 20 * MB, 4 * MB),
      /expected path \/other\.mp4, got \/movie\.mp4/,
    );
  });
  test('a non-array blockList throws', () => {
    assert.throws(
      () => prepareResumeState(base({ blockList: 'nope' }), '/movie.mp4', 20 * MB, 4 * MB),
      /invalid blockList/,
    );
  });
  test('a blockList longer than the chunk count throws', () => {
    assert.throws(
      () => prepareResumeState(
        base({ blockList: ['a', 'b', 'c', 'd', 'e', 'f'] }),
        '/movie.mp4',
        20 * MB,
        4 * MB,
      ),
      /expected 5 blocks, got 6/,
    );
  });
  test('the persisted chunk size wins over the freshly computed one (it owns the live session boundaries)', () => {
    const out = prepareResumeState(base({ chunkSize: 8 * MB }), '/movie.mp4', 20 * MB, 4 * MB);
    assert.equal(out.chunkSize, 8 * MB);
    assert.equal(out.chunkCount, 3);
  });
  test('an invalid persisted chunk size falls back to the default', () => {
    const out = prepareResumeState(base({ chunkSize: 0 }), '/movie.mp4', 20 * MB, 4 * MB);
    assert.equal(out.chunkSize, 4 * MB);
  });
  test('the absent sentinel never counts as uploaded bytes', () => {
    const out = prepareResumeState(
      base({ blockList: ['abc', ABSENT_BLOCK_MD5, '', 'def'] }),
      '/movie.mp4',
      20 * MB,
      4 * MB,
    );
    assert.equal(out.presentBytes, 2 * 4 * MB);
    assert.deepEqual(out.blockList, ['abc', undefined, undefined, 'def', undefined]);
  });
});

describe('decideResumeCreateAction', () => {
  test('missing bytes -> create (upload them, then create once)', () => {
    assert.equal(
      decideResumeCreateAction({ presentBytes: 4 * MB, size: 20 * MB }),
      'create',
    );
  });
  test('all bytes present + the file exists -> reuse (never create a second copy)', () => {
    assert.equal(
      decideResumeCreateAction({ presentBytes: 20 * MB, size: 20 * MB, existingFile: { fs_id: '1' } }),
      'reuse',
    );
  });
  test('all bytes present + no file + never created -> create exactly once', () => {
    assert.equal(
      decideResumeCreateAction({ presentBytes: 20 * MB, size: 20 * MB, created: false }),
      'create',
    );
  });
  test('all bytes present + no file + created before -> abort (refuse to guess)', () => {
    assert.equal(
      decideResumeCreateAction({ presentBytes: 20 * MB, size: 20 * MB, created: true }),
      'abort',
    );
  });
});

describe('assertCompleteBlockList', () => {
  test('a complete list passes through unchanged', () => {
    assert.deepEqual(assertCompleteBlockList(['a', 'b', 'c'], 3), ['a', 'b', 'c']);
  });
  test('a missing block throws naming the block number', () => {
    assert.throws(
      () => assertCompleteBlockList(['a', undefined, 'c'], 3),
      /missing block 2 of 3/,
    );
  });
  test('a block still marked absent throws naming the block number', () => {
    assert.throws(
      () => assertCompleteBlockList(['a', ABSENT_BLOCK_MD5], 2),
      /block 2 of 2 is still marked absent/,
    );
  });
});

describe('formatBytesForError', () => {
  test('formats bytes through TB with one decimal under 100', () => {
    assert.equal(formatBytesForError(0), '0 B');
    assert.equal(formatBytesForError(512), '512 B');
    assert.equal(formatBytesForError(1536), '1.5 KB');
    assert.equal(formatBytesForError(20 * MB), '20.0 MB');
    assert.equal(formatBytesForError(4 * GB), '4.0 GB');
    assert.equal(formatBytesForError(1536 * GB), '1.5 TB');
  });
  test('non-finite or negative input is 0 B', () => {
    assert.equal(formatBytesForError(NaN), '0 B');
    assert.equal(formatBytesForError(-1), '0 B');
    assert.equal(formatBytesForError(undefined), '0 B');
  });
});
