// node:test suite for packages/shared/hostUnsupported.js — the per-item
// "this host will not take this file" flags (filemoon duration rejection,
// 2.19.28). Pure functions, no network.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FILEMOON_TOO_LONG_REASON,
  buildHostUnsupportedFlag,
  findFilemoonTooLongError,
  formatVideoDuration,
  getFilemoonTooLongWarning,
  getHostUnsupportedFlag,
  isFilemoonTooLongError,
  isHostUnsupported,
  isHostUnsupportedDismissed,
  withHostUnsupportedDismissed,
  withHostUnsupportedFlag,
  withHostUnsupportedUndismissed,
} from '../../packages/shared/hostUnsupported.js';

const FLAG = {
  reason: 'video is too long',
  durationSeconds: 42900,
  recordedAt: '2026-11-21T08:00:00.000Z',
  dismissedAt: null,
};

describe('getHostUnsupportedFlag', () => {
  test('reads the flag from extraMetadata', () => {
    const item = { id: '1', extraMetadata: { hostUnsupported: { filemoon: FLAG } } };
    assert.deepEqual(getHostUnsupportedFlag(item, 'filemoon'), FLAG);
  });
  test('falls back to the top-level mirror (fromNeonMediaRow mirrors every extra key)', () => {
    const item = { id: '1', hostUnsupported: { filemoon: FLAG } };
    assert.deepEqual(getHostUnsupportedFlag(item, 'filemoon'), FLAG);
  });
  test('extraMetadata wins over a stale top-level mirror', () => {
    const stale = { ...FLAG, dismissedAt: '2026-11-21T09:00:00.000Z' };
    const item = {
      id: '1',
      hostUnsupported: { filemoon: stale },
      extraMetadata: { hostUnsupported: { filemoon: FLAG } },
    };
    assert.equal(getHostUnsupportedFlag(item, 'filemoon').dismissedAt, null);
  });
  test('host lookup is case-insensitive', () => {
    const item = { id: '1', extraMetadata: { hostUnsupported: { filemoon: FLAG } } };
    assert.deepEqual(getHostUnsupportedFlag(item, 'Filemoon'), FLAG);
    assert.deepEqual(getHostUnsupportedFlag(item, 'FILEMOON'), FLAG);
  });
  test('returns null for a missing item, map, host, or malformed flag', () => {
    assert.equal(getHostUnsupportedFlag(null, 'filemoon'), null);
    assert.equal(getHostUnsupportedFlag({}, 'filemoon'), null);
    assert.equal(getHostUnsupportedFlag({ extraMetadata: {} }, 'filemoon'), null);
    assert.equal(getHostUnsupportedFlag({ extraMetadata: { hostUnsupported: { udrop: FLAG } } }, 'filemoon'), null);
    assert.equal(getHostUnsupportedFlag({ extraMetadata: { hostUnsupported: { filemoon: 'nope' } } }, 'filemoon'), null);
    assert.equal(getHostUnsupportedFlag({ extraMetadata: { hostUnsupported: { filemoon: { durationSeconds: 1 } } } }, 'filemoon'), null);
    assert.equal(getHostUnsupportedFlag({ extraMetadata: { hostUnsupported: { filemoon: null } } }, 'filemoon'), null);
  });
});

describe('isHostUnsupported / isHostUnsupportedDismissed', () => {
  test('an active flag is unsupported and not dismissed', () => {
    const item = { extraMetadata: { hostUnsupported: { filemoon: FLAG } } };
    assert.equal(isHostUnsupported(item, 'filemoon'), true);
    assert.equal(isHostUnsupportedDismissed(item, 'filemoon'), false);
  });
  test('a dismissed flag is dismissed and not unsupported', () => {
    const item = { extraMetadata: { hostUnsupported: { filemoon: { ...FLAG, dismissedAt: '2026-11-21T09:00:00.000Z' } } } };
    assert.equal(isHostUnsupported(item, 'filemoon'), false);
    assert.equal(isHostUnsupportedDismissed(item, 'filemoon'), true);
  });
  test('no flag is neither', () => {
    assert.equal(isHostUnsupported({}, 'filemoon'), false);
    assert.equal(isHostUnsupportedDismissed({}, 'filemoon'), false);
  });
});

describe('buildHostUnsupportedFlag', () => {
  test('normalizes the shape and fills recordedAt', () => {
    const flag = buildHostUnsupportedFlag({ reason: 'video is too long', durationSeconds: 42900 });
    assert.equal(flag.reason, 'video is too long');
    assert.equal(flag.durationSeconds, 42900);
    assert.equal(flag.dismissedAt, null);
    assert.ok(!Number.isNaN(Date.parse(flag.recordedAt)));
  });
  test('a non-finite duration becomes null, never NaN', () => {
    assert.equal(buildHostUnsupportedFlag({ reason: 'x', durationSeconds: NaN }).durationSeconds, null);
    assert.equal(buildHostUnsupportedFlag({ reason: 'x', durationSeconds: '42900' }).durationSeconds, null);
    assert.equal(buildHostUnsupportedFlag({ reason: 'x' }).durationSeconds, null);
  });
});

describe('withHostUnsupportedFlag', () => {
  test('sets the flag and preserves other keys and other hosts', () => {
    const extra = {
      filemoonLinks: [{ filecode: 'abc' }],
      hostUnsupported: { udrop: { reason: 'other', durationSeconds: null, recordedAt: '2026-01-01T00:00:00.000Z', dismissedAt: null } },
    };
    const out = withHostUnsupportedFlag(extra, 'filemoon', FLAG);
    assert.deepEqual(out.hostUnsupported.filemoon, FLAG);
    assert.deepEqual(out.hostUnsupported.udrop, extra.hostUnsupported.udrop);
    assert.deepEqual(out.filemoonLinks, extra.filemoonLinks);
    // The input is untouched — the caller spreads the result into its update.
    assert.equal(extra.hostUnsupported.filemoon, undefined);
  });
  test('works from undefined extraMetadata', () => {
    const out = withHostUnsupportedFlag(undefined, 'filemoon', FLAG);
    assert.deepEqual(out, { hostUnsupported: { filemoon: FLAG } });
  });
  test('overwriting keeps the newest flag, not a merge of old and new', () => {
    const extra = { hostUnsupported: { filemoon: { ...FLAG, dismissedAt: '2026-11-21T09:00:00.000Z' } } };
    const out = withHostUnsupportedFlag(extra, 'filemoon', FLAG);
    assert.equal(out.hostUnsupported.filemoon.dismissedAt, null);
  });
});

describe('withHostUnsupportedDismissed / withHostUnsupportedUndismissed', () => {
  const extra = { hostUnsupported: { filemoon: FLAG }, sceneFiles: { udrop: {} } };
  test('dismiss sets dismissedAt and keeps reason/duration/recordedAt', () => {
    const out = withHostUnsupportedDismissed(extra, 'filemoon', '2026-11-21T09:30:00.000Z');
    assert.equal(out.hostUnsupported.filemoon.dismissedAt, '2026-11-21T09:30:00.000Z');
    assert.equal(out.hostUnsupported.filemoon.reason, 'video is too long');
    assert.equal(out.hostUnsupported.filemoon.durationSeconds, 42900);
    assert.equal(out.hostUnsupported.filemoon.recordedAt, '2026-11-21T08:00:00.000Z');
    assert.deepEqual(out.sceneFiles, { udrop: {} });
  });
  test('dismiss defaults dismissedAt to now when not given', () => {
    const out = withHostUnsupportedDismissed(extra, 'filemoon');
    assert.ok(!Number.isNaN(Date.parse(out.hostUnsupported.filemoon.dismissedAt)));
  });
  test('undismiss clears dismissedAt and keeps everything else', () => {
    const dismissed = withHostUnsupportedDismissed(extra, 'filemoon', '2026-11-21T09:30:00.000Z');
    const out = withHostUnsupportedUndismissed(dismissed, 'filemoon');
    assert.equal(out.hostUnsupported.filemoon.dismissedAt, null);
    assert.equal(out.hostUnsupported.filemoon.reason, 'video is too long');
  });
  test('both are no-ops when the host has no flag', () => {
    assert.deepEqual(withHostUnsupportedDismissed({}, 'filemoon'), {});
    assert.deepEqual(withHostUnsupportedUndismissed({}, 'filemoon'), {});
  });
});

describe('isFilemoonTooLongError', () => {
  test('matches the raw API status and every wrapping of it', () => {
    assert.equal(isFilemoonTooLongError('0:0:0:video is too long'), true);
    assert.equal(isFilemoonTooLongError('Failed to upload to Filemoon: 0:0:0:video is too long'), true);
    assert.equal(isFilemoonTooLongError(new Error('Filemoon: Failed to upload to Filemoon: video is too long')), true);
    assert.equal(isFilemoonTooLongError('VIDEO IS TOO LONG'), true);
  });
  test('does not match other failures', () => {
    assert.equal(isFilemoonTooLongError('Upload failed'), false);
    assert.equal(isFilemoonTooLongError('Not video file format'), false);
    assert.equal(isFilemoonTooLongError('Failed to get Filemoon upload server: 500'), false);
    assert.equal(isFilemoonTooLongError(null), false);
    assert.equal(isFilemoonTooLongError(undefined), false);
    assert.equal(isFilemoonTooLongError(''), false);
  });
});

describe('findFilemoonTooLongError', () => {
  test('finds the filemoon entry in an upload-errors list', () => {
    const errors = [
      'UDrop: timeout',
      'Filemoon: Failed to upload to Filemoon: 0:0:0:video is too long',
    ];
    assert.equal(findFilemoonTooLongError(errors), errors[1]);
  });
  test('a too-long error from ANOTHER host does not flag filemoon', () => {
    assert.equal(findFilemoonTooLongError(['TeraBox: video is too long']), null);
    assert.equal(findFilemoonTooLongError(['UDrop: video is too long']), null);
  });
  test('a filemoon error without the rejection does not match', () => {
    assert.equal(findFilemoonTooLongError(['Filemoon: uploader is not available']), null);
    assert.equal(findFilemoonTooLongError(['Filemoon: Not video file format']), null);
  });
  test('tolerates non-array and non-string input', () => {
    assert.equal(findFilemoonTooLongError(null), null);
    assert.equal(findFilemoonTooLongError(undefined), null);
    assert.equal(findFilemoonTooLongError([null, 42]), null);
  });
});

describe('formatVideoDuration', () => {
  test('formats hours, minutes, seconds', () => {
    assert.equal(formatVideoDuration(42900), '11h 55m');
    assert.equal(formatVideoDuration(2530), '42m 10s');
    assert.equal(formatVideoDuration(90), '1m 30s');
    assert.equal(formatVideoDuration(45), '45s');
    assert.equal(formatVideoDuration(3600), '1h 0m');
  });
  test('unknown durations format empty', () => {
    assert.equal(formatVideoDuration(null), '');
    assert.equal(formatVideoDuration(undefined), '');
    assert.equal(formatVideoDuration(NaN), '');
    assert.equal(formatVideoDuration(-5), '');
  });
});

describe('getFilemoonTooLongWarning', () => {
  test('returns the warning with reason, duration, and a loud message', () => {
    const warning = getFilemoonTooLongWarning(
      ['Filemoon: Failed to upload to Filemoon: 0:0:0:video is too long'],
      42900
    );
    assert.equal(warning.host, 'filemoon');
    assert.equal(warning.reason, FILEMOON_TOO_LONG_REASON);
    assert.equal(warning.durationSeconds, 42900);
    assert.match(warning.message, /Filemoon rejected this video/);
    assert.match(warning.message, /video is too long/);
    assert.match(warning.message, /11h 55m/);
  });
  test('the message still works when the duration is unknown', () => {
    const warning = getFilemoonTooLongWarning(
      ['Filemoon: Failed to upload to Filemoon: 0:0:0:video is too long'],
      null
    );
    assert.equal(warning.durationSeconds, null);
    assert.match(warning.message, /Filemoon rejected this video/);
    assert.doesNotMatch(warning.message, /duration/);
  });
  test('returns null when filemoon did not reject for duration', () => {
    assert.equal(getFilemoonTooLongWarning(['Filemoon: timeout'], 42900), null);
    assert.equal(getFilemoonTooLongWarning(['TeraBox: video is too long'], 42900), null);
    assert.equal(getFilemoonTooLongWarning([], 42900), null);
  });
});
