// node:test suite for packages/shared/pendingUpload.js — the pending-upload
// reservation flags. Gap-focused: the legacy test-pending-upload-flags.mjs
// (23/23) covers the headline flows; this suite pins the helper edge cases
// it does not reach.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PENDING_UPLOAD_EXTRA_KEYS,
  hasVideoHostLinks,
  isPendingUploadItem,
  withoutPendingUploadFlags,
} from '../../packages/shared/pendingUpload.js';

describe('PENDING_UPLOAD_EXTRA_KEYS', () => {
  test('the three flag keys, frozen', () => {
    assert.deepEqual([...PENDING_UPLOAD_EXTRA_KEYS], [
      'pendingUpload',
      'pendingUploadStartedAt',
      'pendingUploadFileName',
    ]);
    assert.ok(Object.isFrozen(PENDING_UPLOAD_EXTRA_KEYS));
  });
});

describe('isPendingUploadItem', () => {
  test('sees the flag in extraMetadata', () => {
    assert.equal(isPendingUploadItem({ extraMetadata: { pendingUpload: true } }), true);
    assert.equal(isPendingUploadItem({ extraMetadata: { pendingUpload: 'yes' } }), true);
  });
  test('a top-level flag alone does not count', () => {
    assert.equal(isPendingUploadItem({ pendingUpload: true, extraMetadata: {} }), false);
  });
  test('missing or falsy flags are not pending', () => {
    assert.equal(isPendingUploadItem({ extraMetadata: { pendingUpload: false } }), false);
    assert.equal(isPendingUploadItem({ extraMetadata: {} }), false);
    assert.equal(isPendingUploadItem({}), false);
  });
  test('null, undefined and non-objects are not pending', () => {
    assert.equal(isPendingUploadItem(null), false);
    assert.equal(isPendingUploadItem(undefined), false);
    assert.equal(isPendingUploadItem('nope'), false);
    assert.equal(isPendingUploadItem(42), false);
  });
});

describe('withoutPendingUploadFlags', () => {
  test('removes exactly the three flags and keeps everything else', () => {
    const cleaned = withoutPendingUploadFlags({
      pendingUpload: true,
      pendingUploadStartedAt: '2026-11-02T00:00:00Z',
      pendingUploadFileName: 'clip.mkv',
      videoHosts: { terabox: { fileId: '1' } },
      custom: 'kept',
    });
    assert.deepEqual(Object.keys(cleaned).sort(), ['custom', 'videoHosts']);
  });
  test('does not mutate its input', () => {
    const extra = { pendingUpload: true, keep: 1 };
    withoutPendingUploadFlags(extra);
    assert.equal(extra.pendingUpload, true);
    assert.equal(extra.keep, 1);
  });
  test('non-object input yields an empty object', () => {
    assert.deepEqual(withoutPendingUploadFlags(), {});
    assert.deepEqual(withoutPendingUploadFlags(null), {});
    assert.deepEqual(withoutPendingUploadFlags('nope'), {});
    assert.deepEqual(withoutPendingUploadFlags(42), {});
  });
  test('an input without flags comes back unchanged in content', () => {
    assert.deepEqual(withoutPendingUploadFlags({ a: 1 }), { a: 1 });
  });
});

describe('hasVideoHostLinks', () => {
  test('a non-empty top-level videoHosts map counts', () => {
    assert.equal(hasVideoHostLinks({ videoHosts: { filemoon: { watchUrl: 'x' } } }), true);
  });
  test('a non-empty extraMetadata videoHosts map counts', () => {
    assert.equal(hasVideoHostLinks({ extraMetadata: { videoHosts: { udrop: { watchUrl: 'x' } } } }), true);
  });
  test('an empty videoHosts map does not count on its own', () => {
    assert.equal(hasVideoHostLinks({ videoHosts: {} }), false);
    assert.equal(hasVideoHostLinks({ extraMetadata: { videoHosts: {} } }), false);
  });
  test('legacy top-level filemoon / udrop fields count', () => {
    assert.equal(hasVideoHostLinks({ filemoonWatchUrl: 'x' }), true);
    assert.equal(hasVideoHostLinks({ filemoonDirectUrl: 'x' }), true);
    assert.equal(hasVideoHostLinks({ filemoonUrl: 'x' }), true);
    assert.equal(hasVideoHostLinks({ udropWatchUrl: 'x' }), true);
    assert.equal(hasVideoHostLinks({ udropDirectUrl: 'x' }), true);
    assert.equal(hasVideoHostLinks({ udropUrl: 'x' }), true);
  });
  test('legacy filemoon / udrop fields inside extraMetadata count', () => {
    assert.equal(hasVideoHostLinks({ extraMetadata: { filemoonWatchUrl: 'x' } }), true);
    assert.equal(hasVideoHostLinks({ extraMetadata: { udropWatchUrl: 'x' } }), true);
  });
  test('terabox-only fields do NOT count (this helper only knows filemoon/udrop)', () => {
    assert.equal(hasVideoHostLinks({ teraboxWatchUrl: 'x' }), false);
    assert.equal(hasVideoHostLinks({ extraMetadata: { teraboxWatchUrl: 'x' } }), false);
  });
  test('a row with no links at all says no', () => {
    assert.equal(hasVideoHostLinks({ id: 'x', extraMetadata: { pendingUpload: true } }), false);
    assert.equal(hasVideoHostLinks({}), false);
  });
  test('null, undefined and non-objects say no', () => {
    assert.equal(hasVideoHostLinks(null), false);
    assert.equal(hasVideoHostLinks(undefined), false);
    assert.equal(hasVideoHostLinks('nope'), false);
  });
});
