// node:test suite for packages/shared/mediaDbPayload.js — the DB payload
// builder. Pure functions, no network.
//
// NOTE on the legacy test-pending-upload-flags.mjs: it calls
// toMediaDbPayload(source, existing, { extraMetadataDeletes }) with THREE
// arguments, but this function takes (source, options) — the third argument
// is silently ignored, so the legacy suite never exercises the deletes path.
// The deletes-after-merge cases below are the ones that actually run it.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  asBool,
  asFloat,
  asInt,
  asIsoOrNull,
  asNullableText,
  asTags,
  asText,
  canonicalizeLinkUrl,
  toMediaDbPayload,
} from '../../packages/shared/mediaDbPayload.js';
import { PENDING_UPLOAD_EXTRA_KEYS } from '../../packages/shared/pendingUpload.js';

describe('asText / asNullableText', () => {
  test('asText stringifies, with a fallback for nullish', () => {
    assert.equal(asText('a'), 'a');
    assert.equal(asText(42), '42');
    assert.equal(asText(null), '');
    assert.equal(asText(undefined), '');
    assert.equal(asText(null, 'fb'), 'fb');
  });
  test('asNullableText returns null for nullish and empty', () => {
    assert.equal(asNullableText('a'), 'a');
    assert.equal(asNullableText(42), '42');
    assert.equal(asNullableText(null), null);
    assert.equal(asNullableText(undefined), null);
    assert.equal(asNullableText(''), null);
  });
});

describe('asBool', () => {
  test('booleans and 1/0 pass through, strings are parsed', () => {
    assert.equal(asBool(true), true);
    assert.equal(asBool(false), false);
    assert.equal(asBool(1), true);
    assert.equal(asBool(0), false);
    assert.equal(asBool('1'), true);
    assert.equal(asBool('0'), false);
    assert.equal(asBool('true'), true);
    assert.equal(asBool(' True '), true);
    assert.equal(asBool('false'), false);
    assert.equal(asBool('FALSE'), false);
  });
  test('anything else falls back (default false)', () => {
    assert.equal(asBool('yes'), false);
    assert.equal(asBool('yes', true), true);
    assert.equal(asBool(null), false);
    assert.equal(asBool(undefined, true), true);
  });
});

describe('asInt / asFloat', () => {
  test('asInt truncates and nulls the unparseable', () => {
    assert.equal(asInt('123.9'), 123);
    assert.equal(asInt(42.7), 42);
    assert.equal(asInt('42'), 42);
    assert.equal(asInt(null), null);
    assert.equal(asInt(''), null);
    assert.equal(asInt('nope'), null);
    assert.equal(asInt(NaN), null);
  });
  test('asFloat keeps the fraction', () => {
    assert.equal(asFloat('12.5'), 12.5);
    assert.equal(asFloat(3), 3);
    assert.equal(asFloat(null), null);
    assert.equal(asFloat('nope'), null);
  });
});

describe('asIsoOrNull', () => {
  test('dates and date strings become ISO, bad input becomes null', () => {
    assert.equal(asIsoOrNull(new Date('2026-01-02T03:04:05.000Z')), '2026-01-02T03:04:05.000Z');
    assert.equal(asIsoOrNull('2026-01-02T03:04:05.000Z'), '2026-01-02T03:04:05.000Z');
    assert.equal(asIsoOrNull('not a date'), null);
    assert.equal(asIsoOrNull(''), null);
    assert.equal(asIsoOrNull(null), null);
  });
});

describe('asTags', () => {
  test('arrays are stringified, anything else becomes []', () => {
    assert.deepEqual(asTags(['a', 1]), ['a', '1']);
    assert.deepEqual(asTags('a'), []);
    assert.deepEqual(asTags(null), []);
    assert.deepEqual(asTags(undefined), []);
  });
});

describe('canonicalizeLinkUrl', () => {
  test('lowercases the host, strips www, drops tracking params', () => {
    assert.equal(
      canonicalizeLinkUrl('https://WWW.Example.COM/path?utm_source=x&keep=1&fbclid=abc'),
      'https://example.com/path?keep=1',
    );
  });
  test('all seven tracking params are dropped', () => {
    const url = 'https://example.com/p?utm_source=a&utm_medium=b&utm_campaign=c&utm_term=d&utm_content=e&fbclid=f&gclid=g&x=1';
    assert.equal(canonicalizeLinkUrl(url), 'https://example.com/p?x=1');
  });
  test('a URL with no query stays clean', () => {
    assert.equal(canonicalizeLinkUrl('https://example.com/a/b'), 'https://example.com/a/b');
  });
  test('an invalid URL comes back trimmed but unchanged', () => {
    assert.equal(canonicalizeLinkUrl('  not a url  '), 'not a url');
  });
  test('empty input is empty', () => {
    assert.equal(canonicalizeLinkUrl(''), '');
    assert.equal(canonicalizeLinkUrl(), '');
  });
});

describe('toMediaDbPayload — basics', () => {
  test('a minimal source yields an image row with defaults', () => {
    const payload = toMediaDbPayload({}, { fallbackTimestamp: '2026-01-01T00:00:00.000Z' });
    assert.equal(payload.kind, 'image');
    assert.equal(payload.isVideo, false);
    assert.equal(payload.isLink, false);
    assert.equal(payload.pageTitle, '');
    assert.deepEqual(payload.tags, []);
    assert.equal(payload.collectionId, null);
    assert.equal(payload.internalAddedTimestamp, '2026-01-01T00:00:00.000Z');
    assert.equal(payload.fileSize, null);
    assert.equal(payload.deletedAt, null);
    assert.equal(payload.exifMetadata, null);
  });
  test('a video item maps kind, flags, and host columns', () => {
    const payload = toMediaDbPayload({
      isVideo: true,
      fileName: 'clip.mp4',
      fileSize: '123456',
      duration: '12.5',
      filemoonWatchUrl: 'https://filemoon.sx/d/a',
      filemoonDirectUrl: 'https://cdn.example/a.mp4',
      videoHosts: { filemoon: { watchUrl: 'https://filemoon.sx/d/a', directUrl: 'https://cdn.example/a.mp4' } },
    }, { fallbackTimestamp: '2026-01-01T00:00:00.000Z' });
    assert.equal(payload.kind, 'video');
    assert.equal(payload.isVideo, true);
    assert.equal(payload.fileSize, 123456);
    assert.equal(payload.duration, 12.5);
    assert.equal(payload.filemoonWatchUrl, 'https://filemoon.sx/d/a');
    assert.equal(payload.filemoonDirectUrl, 'https://cdn.example/a.mp4');
    assert.equal(payload.extraMetadata.videoHosts.filemoon.watchUrl, 'https://filemoon.sx/d/a');
  });
  test('a link item maps isLink and canonicalizes the URL', () => {
    const payload = toMediaDbPayload({
      linkUrl: 'https://www.example.com/p?utm_source=x&keep=1',
    }, { fallbackTimestamp: '2026-01-01T00:00:00.000Z' });
    assert.equal(payload.kind, 'link');
    assert.equal(payload.isLink, true);
    assert.equal(payload.linkUrl, 'https://www.example.com/p?utm_source=x&keep=1');
    assert.equal(payload.linkUrlCanonical, 'https://example.com/p?keep=1');
  });
  test('linkUrlCanonical falls back to the source page URL', () => {
    const payload = toMediaDbPayload({
      kind: 'image',
      sourcePageUrl: 'https://www.example.com/p?utm_medium=x',
    }, { fallbackTimestamp: '2026-01-01T00:00:00.000Z' });
    assert.equal(payload.linkUrlCanonical, 'https://example.com/p');
  });
  test('an explicit linkUrlCanonical is kept', () => {
    const payload = toMediaDbPayload({
      kind: 'image',
      linkUrlCanonical: 'https://example.com/kept',
    }, { fallbackTimestamp: '2026-01-01T00:00:00.000Z' });
    assert.equal(payload.linkUrlCanonical, 'https://example.com/kept');
  });
  test('a system item is stored as kind image with both flags false', () => {
    const payload = toMediaDbPayload({
      id: '__imgvault_vault_config__',
      systemType: 'secretVaultConfig',
    }, { fallbackTimestamp: '2026-01-01T00:00:00.000Z' });
    assert.equal(payload.kind, 'image');
    assert.equal(payload.isVideo, false);
    assert.equal(payload.isLink, false);
  });
  test('image hosts land in extraMetadata', () => {
    const payload = toMediaDbPayload({
      imgbbUrl: 'https://i.ibb.co/a.png',
    }, { fallbackTimestamp: '2026-01-01T00:00:00.000Z' });
    assert.equal(payload.imgbbUrl, 'https://i.ibb.co/a.png');
    assert.equal(payload.extraMetadata.imageHosts.imgbb.url, 'https://i.ibb.co/a.png');
  });
});

describe('toMediaDbPayload — extraMetadataDeletes run AFTER the mirror merge', () => {
  const reservedRow = {
    id: 'row-1',
    fileName: 'sample-clip.mkv',
    pendingUpload: true,
    pendingUploadStartedAt: '2026-11-02T00:00:00.000Z',
    pendingUploadFileName: 'sample-clip.mkv',
    extraMetadata: {
      pendingUpload: true,
      pendingUploadStartedAt: '2026-11-02T00:00:00.000Z',
      pendingUploadFileName: 'sample-clip.mkv',
      videoHosts: { terabox: { watchUrl: 'https://terabox.example/s/abc', fileId: '900100200300' } },
    },
  };

  test('WITHOUT deletes, the stale top-level mirror resurrects the flag', () => {
    // The caller removed the flags from extraMetadata only; the mirrored
    // top-level copy merges back in and the flag survives — the 2.19.4 bug.
    const source = {
      ...reservedRow,
      extraMetadata: { videoHosts: reservedRow.extraMetadata.videoHosts },
    };
    const payload = toMediaDbPayload(source, { existing: reservedRow });
    assert.equal(payload.extraMetadata.pendingUpload, true);
  });
  test('WITH deletes, all three flags are gone and the host links survive', () => {
    const source = {
      ...reservedRow,
      extraMetadata: { videoHosts: reservedRow.extraMetadata.videoHosts },
    };
    delete source.pendingUpload;
    delete source.pendingUploadStartedAt;
    delete source.pendingUploadFileName;
    const payload = toMediaDbPayload(source, {
      existing: reservedRow,
      extraMetadataDeletes: PENDING_UPLOAD_EXTRA_KEYS,
    });
    assert.equal(payload.extraMetadata.pendingUpload, undefined);
    assert.equal(payload.extraMetadata.pendingUploadStartedAt, undefined);
    assert.equal(payload.extraMetadata.pendingUploadFileName, undefined);
    assert.equal(payload.extraMetadata.videoHosts.terabox.fileId, '900100200300');
    assert.equal(payload.fileName, 'sample-clip.mkv');
  });
  test('the delete list only drops listed keys', () => {
    const payload = toMediaDbPayload(
      { extraMetadata: { custom: 'keep', pendingUpload: true } },
      { extraMetadataDeletes: ['pendingUpload'] },
    );
    assert.equal(payload.extraMetadata.pendingUpload, undefined);
    assert.equal(payload.extraMetadata.custom, 'keep');
  });
  test('non-string delete entries are ignored', () => {
    const payload = toMediaDbPayload(
      { extraMetadata: { custom: 'keep' } },
      { extraMetadataDeletes: [null, 42, 'custom'] },
    );
    assert.equal(payload.extraMetadata.custom, undefined);
  });
});

describe('toMediaDbPayload — extra writes beat the stale top-level mirror', () => {
  test('a changed extra key wins over the untouched top-level mirror', () => {
    const existing = {
      isVaulted: true,
      extraMetadata: { isVaulted: true },
    };
    const payload = toMediaDbPayload(
      { extraMetadata: { isVaulted: false } },
      { existing },
    );
    assert.equal(payload.extraMetadata.isVaulted, false);
  });
  test('a write on the top-level field itself wins over the extra copy', () => {
    const existing = {
      isVaulted: true,
      extraMetadata: { isVaulted: true },
    };
    const payload = toMediaDbPayload(
      { isVaulted: false, extraMetadata: { isVaulted: true } },
      { existing },
    );
    assert.equal(payload.extraMetadata.isVaulted, false);
  });
});

describe('toMediaDbPayload — deletedAt / ensureExtraMetadata', () => {
  test('forceDeleted stamps deletedAt from the fallback timestamp', () => {
    const payload = toMediaDbPayload(
      { fileName: 'a.png' },
      { fallbackTimestamp: '2026-01-01T00:00:00.000Z', forceDeleted: true },
    );
    assert.equal(payload.deletedAt, '2026-01-01T00:00:00.000Z');
  });
  test('forceDeleted keeps a source deletedAt when present', () => {
    const payload = toMediaDbPayload(
      { deletedAt: '2026-02-02T00:00:00.000Z' },
      { fallbackTimestamp: '2026-01-01T00:00:00.000Z', forceDeleted: true },
    );
    assert.equal(payload.deletedAt, '2026-02-02T00:00:00.000Z');
  });
  test('without forceDeleted, deletedAt comes from the source only', () => {
    const payload = toMediaDbPayload(
      {},
      { fallbackTimestamp: '2026-01-01T00:00:00.000Z' },
    );
    assert.equal(payload.deletedAt, null);
  });
  test('ensureExtraMetadata can add keys and sees kind / dbKind / isSystem', () => {
    let seen;
    const payload = toMediaDbPayload(
      { id: '__imgvault_vault_config__', systemType: 'secretVaultConfig' },
      {
        fallbackTimestamp: '2026-01-01T00:00:00.000Z',
        ensureExtraMetadata: (extra, ctx) => {
          seen = ctx;
          return { ...extra, injected: true };
        },
      },
    );
    assert.equal(payload.extraMetadata.injected, true);
    assert.equal(seen.kind, 'system');
    assert.equal(seen.dbKind, 'image');
    assert.equal(seen.isSystem, true);
  });
});

describe('toMediaDbPayload — hostUnsupported flag round-trips (2.19.28)', () => {
  // These model updateImageNeon exactly: source is the merged item
  // ({...existing, ...updates}), existing is the row as read (every extra
  // key mirrored top-level). The flag must survive the mirror merge or
  // the resolve page would lose the dismissal on the next write.
  const flag = {
    reason: 'video is too long',
    durationSeconds: 42900,
    recordedAt: '2026-11-21T08:00:00.000Z',
    dismissedAt: null,
  };
  test('a fresh flag write lands in extra_metadata', () => {
    const existing = {
      id: 'defb04cd',
      fileName: 'videoplayback.mp4',
      isVideo: true,
      extraMetadata: { videoHosts: { udrop: { watchUrl: 'https://www.udrop.com/2624798' } } },
    };
    const updates = {
      extraMetadata: {
        ...existing.extraMetadata,
        hostUnsupported: { filemoon: flag },
      },
    };
    const payload = toMediaDbPayload({ ...existing, ...updates }, { existing });
    assert.deepEqual(payload.extraMetadata.hostUnsupported.filemoon, flag);
    assert.equal(payload.extraMetadata.videoHosts.udrop.watchUrl, 'https://www.udrop.com/2624798');
  });
  test('a dismiss (dismissedAt change) beats the stale top-level mirror', () => {
    const existing = {
      id: 'defb04cd',
      fileName: 'videoplayback.mp4',
      isVideo: true,
      // fromNeonMediaRow mirrors the flag top-level on read.
      hostUnsupported: { filemoon: flag },
      extraMetadata: { hostUnsupported: { filemoon: flag } },
    };
    const dismissedFlag = { ...flag, dismissedAt: '2026-11-21T09:30:00.000Z' };
    const updates = {
      extraMetadata: { hostUnsupported: { filemoon: dismissedFlag } },
    };
    const payload = toMediaDbPayload({ ...existing, ...updates }, { existing });
    assert.equal(payload.extraMetadata.hostUnsupported.filemoon.dismissedAt, '2026-11-21T09:30:00.000Z');
    assert.equal(payload.extraMetadata.hostUnsupported.filemoon.reason, 'video is too long');
  });
  test('an undismiss (dismissedAt back to null) beats the stale mirror too', () => {
    const dismissedFlag = { ...flag, dismissedAt: '2026-11-21T09:30:00.000Z' };
    const existing = {
      id: 'defb04cd',
      hostUnsupported: { filemoon: dismissedFlag },
      extraMetadata: { hostUnsupported: { filemoon: dismissedFlag } },
    };
    const updates = {
      extraMetadata: { hostUnsupported: { filemoon: flag } },
    };
    const payload = toMediaDbPayload({ ...existing, ...updates }, { existing });
    assert.equal(payload.extraMetadata.hostUnsupported.filemoon.dismissedAt, null);
  });
});
