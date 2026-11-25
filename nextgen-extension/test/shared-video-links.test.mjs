// node:test suite for packages/shared/videoProviderLinks.js — the video host
// link readers/builders. Pure functions, no network.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVideoProviderLinkFromResult,
  getMissingVideoUploadServices,
  getPlayableVideoProviderLink,
  getPreferredVideoProviderLink,
  getStrictVideoProviderLink,
  getVideoProviderLabel,
  getVideoProviderLinks,
  getVideoRetrySourceCandidates,
  getVideoSourceHostOptions,
  getVideoUploadService,
  hasAnyVideoProviderLink,
  hasVideoProviderLink,
  isTelegramPostPageUrl,
  mergeVideoProviderResult,
  normalizeVideoProviderLinksForStorage,
} from '../../packages/shared/videoProviderLinks.js';

describe('getVideoUploadService / getVideoProviderLabel', () => {
  test('looks up by key, case-insensitively, trimmed', () => {
    assert.equal(getVideoUploadService('filemoon').label, 'Filemoon');
    assert.equal(getVideoUploadService('  TELEGRAM ').label, 'Telegram');
  });
  test('unknown keys return null / echo the key as the label', () => {
    assert.equal(getVideoUploadService('nope'), null);
    assert.equal(getVideoUploadService(''), null);
    assert.equal(getVideoProviderLabel('nope'), 'nope');
    assert.equal(getVideoProviderLabel('telegram'), 'Telegram');
  });
});

describe('getVideoProviderLinks', () => {
  test('reads links from videoHosts', () => {
    const links = getVideoProviderLinks({
      videoHosts: {
        filemoon: { watchUrl: 'https://filemoon.sx/d/abc', directUrl: 'https://cdn.example/a.mp4', thumbnailUrl: 'https://cdn.example/a.jpg' },
      },
    });
    assert.equal(links.filemoon.watchUrl, 'https://filemoon.sx/d/abc');
    assert.equal(links.filemoon.directUrl, 'https://cdn.example/a.mp4');
    assert.equal(links.filemoon.thumbnailUrl, 'https://cdn.example/a.jpg');
  });
  test('extraMetadata videoHosts are the fallback, top-level videoHosts win', () => {
    const links = getVideoProviderLinks({
      videoHosts: { udrop: { watchUrl: 'https://udrop.com/top' } },
      extraMetadata: { videoHosts: { udrop: { watchUrl: 'https://udrop.com/extra', directUrl: 'https://cdn.example/u.mp4' } } },
    });
    assert.equal(links.udrop.watchUrl, 'https://udrop.com/top');
    assert.equal(links.udrop.directUrl, 'https://cdn.example/u.mp4');
  });
  test('legacy top-level fields fill in missing links', () => {
    const links = getVideoProviderLinks({
      filemoonWatchUrl: 'https://filemoon.sx/d/abc',
      filemoonDirectUrl: 'https://cdn.example/a.mp4',
      filemoonUrl: 'https://filemoon.sx/d/abc',
      udropWatchUrl: 'https://udrop.com/u1',
    });
    assert.equal(links.filemoon.watchUrl, 'https://filemoon.sx/d/abc');
    assert.equal(links.filemoon.directUrl, 'https://cdn.example/a.mp4');
    assert.equal(links.udrop.watchUrl, 'https://udrop.com/u1');
  });
  test('displayUrl / url / downloadUrl / thumbUrl aliases are honoured', () => {
    const links = getVideoProviderLinks({
      videoHosts: {
        terabox: { displayUrl: 'https://terabox.example/w', downloadUrl: 'https://terabox.example/d', thumbUrl: 'https://terabox.example/t' },
      },
    });
    assert.equal(links.terabox.watchUrl, 'https://terabox.example/w');
    assert.equal(links.terabox.directUrl, 'https://terabox.example/d');
    assert.equal(links.terabox.thumbnailUrl, 'https://terabox.example/t');
  });
  test('hosts with no URL at all are omitted', () => {
    const links = getVideoProviderLinks({ videoHosts: { filemoon: { watchUrl: 'https://filemoon.sx/d/a' } } });
    assert.deepEqual(Object.keys(links), ['filemoon']);
  });
  test('a host with only a thumbnail still counts as a link', () => {
    const links = getVideoProviderLinks({ videoHosts: { telegram: { thumbnailUrl: 'https://cdn.example/t.jpg' } } });
    assert.equal(links.telegram.thumbnailUrl, 'https://cdn.example/t.jpg');
  });
  test('non-object and empty items yield no links', () => {
    assert.deepEqual(getVideoProviderLinks(), {});
    assert.deepEqual(getVideoProviderLinks(null), {});
    assert.deepEqual(getVideoProviderLinks('nope'), {});
    assert.deepEqual(getVideoProviderLinks({}), {});
  });
  test('whitespace-only URLs are dropped', () => {
    const links = getVideoProviderLinks({ videoHosts: { filemoon: { watchUrl: '   ' } } });
    assert.deepEqual(links, {});
  });
});

describe('getStrictVideoProviderLink', () => {
  const item = {
    videoHosts: {
      filemoon: { watchUrl: 'https://filemoon.sx/d/a', directUrl: 'https://cdn.example/a.mp4' },
      udrop: { watchUrl: 'https://udrop.com/u1' },
    },
  };
  test('watchUrl falls back to directUrl when the watch URL is missing', () => {
    const onlyDirect = { videoHosts: { filemoon: { directUrl: 'https://cdn.example/a.mp4' } } };
    assert.equal(getStrictVideoProviderLink(onlyDirect, 'filemoon', 'watchUrl'), 'https://cdn.example/a.mp4');
  });
  test('directUrl does NOT fall back to watchUrl', () => {
    assert.equal(getStrictVideoProviderLink(item, 'udrop', 'directUrl'), '');
  });
  test('unknown provider or missing link returns empty', () => {
    assert.equal(getStrictVideoProviderLink(item, 'telegram'), '');
    assert.equal(getStrictVideoProviderLink(item, 'nope'), '');
  });
});

describe('getPreferredVideoProviderLink', () => {
  const item = {
    videoHosts: {
      udrop: { watchUrl: 'https://udrop.com/u1', directUrl: 'https://cdn.example/u.mp4' },
      telegram: { watchUrl: 'https://t.me/chan/9', directUrl: '/telegram-media/x' },
    },
  };
  test('the preferred host wins when it has a link', () => {
    assert.equal(getPreferredVideoProviderLink(item, 'udrop', 'watchUrl'), 'https://udrop.com/u1');
  });
  test('a missing preferred host falls through in catalog order', () => {
    // filemoon missing -> udrop (next in catalog order) answers
    assert.equal(getPreferredVideoProviderLink(item, 'filemoon', 'watchUrl'), 'https://udrop.com/u1');
  });
  test('watchUrl falls back to directUrl, directUrl falls back to watchUrl', () => {
    const directOnly = { videoHosts: { filemoon: { directUrl: 'https://cdn.example/a.mp4' } } };
    assert.equal(getPreferredVideoProviderLink(directOnly, 'filemoon', 'watchUrl'), 'https://cdn.example/a.mp4');
    const watchOnly = { videoHosts: { filemoon: { watchUrl: 'https://filemoon.sx/d/a' } } };
    assert.equal(getPreferredVideoProviderLink(watchOnly, 'filemoon', 'directUrl'), 'https://filemoon.sx/d/a');
  });
  test('thumbnailUrl has no fallback', () => {
    assert.equal(getPreferredVideoProviderLink(item, 'udrop', 'thumbnailUrl'), '');
  });
  test('nothing anywhere returns empty', () => {
    assert.equal(getPreferredVideoProviderLink({}, 'filemoon'), '');
  });
});

describe('getPlayableVideoProviderLink', () => {
  const telegramOnly = {
    videoHosts: { telegram: { watchUrl: 'https://t.me/chan/9', directUrl: '/telegram-media/x?mt=audio%2Fmp4' } },
  };
  test('a telegram-only song still yields a URL when terabox is preferred', () => {
    const out = getPlayableVideoProviderLink(telegramOnly, 'terabox', 'directUrl');
    assert.equal(out.url, '/telegram-media/x?mt=audio%2Fmp4');
    assert.equal(out.sourceKey, 'telegram');
    assert.equal(out.sourceLabel, 'Telegram');
    assert.equal(out.isPreferred, false);
  });
  test('the preferred host still wins when it has a link', () => {
    const item = {
      videoHosts: {
        filemoon: { directUrl: 'https://cdn.example/a.mp4' },
        telegram: { directUrl: '/telegram-media/x' },
      },
    };
    const out = getPlayableVideoProviderLink(item, 'filemoon', 'directUrl');
    assert.equal(out.url, 'https://cdn.example/a.mp4');
    assert.equal(out.sourceKey, 'filemoon');
    assert.equal(out.isPreferred, true);
  });
  test('the preferred host is tried first even when it only has the other field', () => {
    const item = {
      videoHosts: {
        filemoon: { watchUrl: 'https://filemoon.sx/d/a' },
        udrop: { directUrl: 'https://cdn.example/u.mp4' },
      },
    };
    // directUrl requested: filemoon falls back to its watchUrl before udrop is tried
    const out = getPlayableVideoProviderLink(item, 'filemoon', 'directUrl');
    assert.equal(out.url, 'https://filemoon.sx/d/a');
    assert.equal(out.isPreferred, true);
  });
  test('no link anywhere returns the empty shape', () => {
    assert.deepEqual(getPlayableVideoProviderLink({}, 'filemoon'), {
      url: '', sourceKey: '', sourceLabel: '', isPreferred: false,
    });
  });
  test('the default preferred provider is filemoon', () => {
    const item = { videoHosts: { filemoon: { directUrl: 'https://cdn.example/a.mp4' } } };
    assert.equal(getPlayableVideoProviderLink(item).isPreferred, true);
  });
});

// 2.19.44 (2026-11-25): a t.me post page stored as directUrl is a watch
// page, not media — the Telegram uploader stores it when the channel is
// private and no CDN URL exists, and a <video> fed the page loads HTML
// and dies with DEMUXER_ERROR. The modal played a black 0:00 player for
// a native Telegram video while telegram was preferred, although the same
// file sat on filemoon, uDrop and TeraBox.
describe('isTelegramPostPageUrl', () => {
  test('matches private-channel and public-channel post links', () => {
    assert.equal(isTelegramPostPageUrl('https://t.me/c/3959088547/117'), true);
    assert.equal(isTelegramPostPageUrl('https://t.me/somechannel/123'), true);
    assert.equal(isTelegramPostPageUrl('https://t.me/c/3959088547/117/'), true);
    assert.equal(isTelegramPostPageUrl('https://t.me/c/3959088547/117?single'), true);
    assert.equal(isTelegramPostPageUrl('https://t.me/c/3959088547/117/118'), true);
  });
  test('does not match real media URLs or the local route', () => {
    assert.equal(isTelegramPostPageUrl('https://cdn5.telesco.pe/file/abc123.mp4?token=x'), false);
    assert.equal(isTelegramPostPageUrl('https://dm-d.terabox.com/file/abc?fid=1'), false);
    assert.equal(isTelegramPostPageUrl('https://filemoon.sx/e/ok3gcuarlyc9'), false);
    assert.equal(isTelegramPostPageUrl('https://www.udrop.com/file/QYhh/a.mkv'), false);
    assert.equal(isTelegramPostPageUrl('/telegram-media/x?mt=audio%2Fmp4'), false);
    assert.equal(isTelegramPostPageUrl('https://t.me/'), false);
    assert.equal(isTelegramPostPageUrl('https://example.com/t.me/c/1/2'), false);
    assert.equal(isTelegramPostPageUrl(''), false);
    assert.equal(isTelegramPostPageUrl(null), false);
    assert.equal(isTelegramPostPageUrl(undefined), false);
    assert.equal(isTelegramPostPageUrl(42), false);
  });
});

describe('getPlayableVideoProviderLink skips t.me post pages for directUrl', () => {
  const multiHost = {
    videoHosts: {
      telegram: { watchUrl: 'https://t.me/c/3959088547/117', directUrl: 'https://t.me/c/3959088547/117' },
      filemoon: { watchUrl: 'https://filemoon.sx/d/ok3gcuarlyc9', directUrl: 'https://filemoon.sx/e/ok3gcuarlyc9' },
      terabox: { directUrl: 'https://dm-d.terabox.com/file/abc?fid=1' },
    },
  };
  test('a t.me directUrl falls through to the next host with real bytes', () => {
    const out = getPlayableVideoProviderLink(multiHost, 'telegram', 'directUrl');
    assert.equal(out.url, 'https://filemoon.sx/e/ok3gcuarlyc9');
    assert.equal(out.sourceKey, 'filemoon');
    assert.equal(out.isPreferred, false);
  });
  test('a telegram-only item with just a post page yields no playable URL', () => {
    const telegramOnly = {
      videoHosts: { telegram: { watchUrl: 'https://t.me/c/3959088547/117', directUrl: 'https://t.me/c/3959088547/117' } },
    };
    assert.deepEqual(getPlayableVideoProviderLink(telegramOnly, 'telegram', 'directUrl'), {
      url: '', sourceKey: '', sourceLabel: '', isPreferred: false,
    });
  });
  test('the watchUrl fallback cannot smuggle the post page back in as directUrl', () => {
    // directUrl requested, telegram has ONLY a t.me watchUrl: the fallback
    // picks the watchUrl, which must still be skipped.
    const watchOnly = {
      videoHosts: { telegram: { watchUrl: 'https://t.me/c/3959088547/117' } },
    };
    assert.equal(getPlayableVideoProviderLink(watchOnly, 'telegram', 'directUrl').url, '');
  });
  test('watchUrl requests still return the post page — it IS the watch link', () => {
    const out = getPlayableVideoProviderLink(multiHost, 'telegram', 'watchUrl');
    assert.equal(out.url, 'https://t.me/c/3959088547/117');
    assert.equal(out.sourceKey, 'telegram');
    assert.equal(out.isPreferred, true);
  });
  test('a real telegram media URL (local route, CDN) still plays', () => {
    const local = {
      videoHosts: { telegram: { watchUrl: 'https://t.me/chan/9', directUrl: '/telegram-media/x?mt=audio%2Fmp4' } },
    };
    assert.equal(getPlayableVideoProviderLink(local, 'telegram', 'directUrl').url, '/telegram-media/x?mt=audio%2Fmp4');
    const cdn = {
      videoHosts: { telegram: { directUrl: 'https://cdn5.telesco.pe/file/abc.mp4?token=x' } },
    };
    assert.equal(getPlayableVideoProviderLink(cdn, 'telegram', 'directUrl').url, 'https://cdn5.telesco.pe/file/abc.mp4?token=x');
  });
});

describe('hasVideoProviderLink / hasAnyVideoProviderLink / getMissingVideoUploadServices', () => {
  const item = { videoHosts: { filemoon: { watchUrl: 'https://filemoon.sx/d/a' } } };
  test('hasVideoProviderLink is per-host', () => {
    assert.equal(hasVideoProviderLink(item, 'filemoon'), true);
    assert.equal(hasVideoProviderLink(item, 'udrop'), false);
  });
  test('hasAnyVideoProviderLink is true when any host has a URL', () => {
    assert.equal(hasAnyVideoProviderLink(item), true);
    assert.equal(hasAnyVideoProviderLink({}), false);
    assert.equal(hasAnyVideoProviderLink({ videoHosts: { filemoon: { thumbnailUrl: 'https://cdn.example/t.jpg' } } }), false);
  });
  test('getMissingVideoUploadServices lists the hosts without a link', () => {
    assert.deepEqual(getMissingVideoUploadServices(item).map((s) => s.key), ['udrop', 'terabox', 'telegram']);
    assert.deepEqual(getMissingVideoUploadServices({}).map((s) => s.key), ['filemoon', 'udrop', 'terabox', 'telegram']);
  });
});

describe('getVideoRetrySourceCandidates', () => {
  const item = {
    sourceImageUrl: 'https://origin.example/clip.mp4',
    videoHosts: {
      filemoon: { watchUrl: 'https://filemoon.sx/d/a', directUrl: 'https://cdn.example/a.mp4' },
      udrop: { watchUrl: 'https://udrop.com/u1', directUrl: 'https://cdn.example/u.mp4' },
      telegram: { watchUrl: 'https://t.me/chan/9', directUrl: '/telegram-media/x' },
    },
  };
  test('excludes the target host and ends with the raw source URL', () => {
    const out = getVideoRetrySourceCandidates(item, 'udrop');
    assert.ok(!out.includes('https://udrop.com/u1'));
    assert.ok(out.includes('https://cdn.example/a.mp4'));
    assert.ok(out.includes('/telegram-media/x'));
    assert.equal(out[out.length - 1], 'https://origin.example/clip.mp4');
  });
  test('a requested source host restricts the list and drops the raw source URL', () => {
    const out = getVideoRetrySourceCandidates(item, 'udrop', 'filemoon');
    assert.deepEqual(out, ['https://cdn.example/a.mp4', 'https://filemoon.sx/d/a']);
  });
  test('an unknown requested host yields nothing', () => {
    assert.deepEqual(getVideoRetrySourceCandidates(item, 'udrop', 'nope'), []);
  });
});

describe('getVideoSourceHostOptions', () => {
  const item = {
    videoHosts: {
      filemoon: { watchUrl: 'https://filemoon.sx/d/a' },
      telegram: { directUrl: '/telegram-media/x' },
    },
  };
  test('lists hosts with a URL, excluding the target', () => {
    assert.deepEqual(getVideoSourceHostOptions(item, 'filemoon'), [{ key: 'telegram', label: 'Telegram' }]);
    assert.deepEqual(getVideoSourceHostOptions(item), [
      { key: 'filemoon', label: 'Filemoon' },
      { key: 'telegram', label: 'Telegram' },
    ]);
  });
  test('a host with only a thumbnail is not an option', () => {
    const thumbs = { videoHosts: { udrop: { thumbnailUrl: 'https://cdn.example/t.jpg' } } };
    assert.deepEqual(getVideoSourceHostOptions(thumbs), []);
  });
});

describe('buildVideoProviderLinkFromResult', () => {
  test('maps result aliases onto the canonical link shape', () => {
    const link = buildVideoProviderLinkFromResult({
      displayUrl: 'https://filemoon.sx/d/a',
      downloadUrl: 'https://cdn.example/a.mp4',
      filecode: 'abc123',
      message_id: '77',
      apiResponse: 'ok',
      thumbnailUrl: 'https://cdn.example/t.jpg',
      deleteUrl: 'https://filemoon.sx/del/a',
      shortUrl: 'https://fm.example/a',
      accountId: 'acc-1',
      filename: 'clip.mp4',
      apiStatus: 'success',
    });
    assert.equal(link.watchUrl, 'https://filemoon.sx/d/a');
    assert.equal(link.directUrl, 'https://cdn.example/a.mp4');
    assert.equal(link.fileId, 'abc123');
    assert.equal(link.messageId, '77');
    assert.equal(link.apiMessage, 'ok');
    assert.equal(link.thumbnailUrl, 'https://cdn.example/t.jpg');
    assert.equal(link.deleteUrl, 'https://filemoon.sx/del/a');
    assert.equal(link.shortUrl, 'https://fm.example/a');
    assert.equal(link.accountId, 'acc-1');
    assert.equal(link.filename, 'clip.mp4');
    assert.equal(link.apiStatus, 'success');
  });
  test('direct fields beat aliases, missing fields become empty strings', () => {
    const link = buildVideoProviderLinkFromResult({ watchUrl: 'https://w', displayUrl: 'https://d' });
    assert.equal(link.watchUrl, 'https://w');
    assert.equal(link.directUrl, '');
    assert.equal(link.messageId, '');
  });
  test('an empty result yields all empty strings', () => {
    const link = buildVideoProviderLinkFromResult();
    assert.ok(Object.values(link).every((v) => v === ''));
  });
});

describe('mergeVideoProviderResult', () => {
  test('merges a result into videoHosts and mirrors the top-level fields', () => {
    const next = mergeVideoProviderResult(
      { id: '1', fileName: 'clip.mp4' },
      'filemoon',
      { watchUrl: 'https://filemoon.sx/d/a', directUrl: 'https://cdn.example/a.mp4', fileId: 'abc' },
    );
    assert.equal(next.videoHosts.filemoon.watchUrl, 'https://filemoon.sx/d/a');
    assert.equal(next.videoHosts.filemoon.fileId, 'abc');
    assert.equal(next.filemoonWatchUrl, 'https://filemoon.sx/d/a');
    assert.equal(next.filemoonDirectUrl, 'https://cdn.example/a.mp4');
    assert.equal(next.filemoonUrl, 'https://filemoon.sx/d/a');
    assert.equal(next.fileName, 'clip.mp4');
  });
  test('telegram writes videoHosts only — no top-level mirror fields exist for it', () => {
    const next = mergeVideoProviderResult(
      {},
      'telegram',
      { watchUrl: 'https://t.me/chan/9', directUrl: '/telegram-media/x', messageId: '9' },
    );
    assert.equal(next.videoHosts.telegram.watchUrl, 'https://t.me/chan/9');
    assert.equal(next.videoHosts.telegram.messageId, '9');
    assert.equal(next.telegramWatchUrl, undefined);
    assert.equal(next.telegramDirectUrl, undefined);
    assert.equal(next.telegramUrl, undefined);
  });
  test('an unknown provider returns the target untouched', () => {
    const target = { id: '1' };
    assert.strictEqual(mergeVideoProviderResult(target, 'nope', { watchUrl: 'x' }), target);
  });
  test('merging keeps other hosts intact', () => {
    const next = mergeVideoProviderResult(
      { videoHosts: { udrop: { watchUrl: 'https://udrop.com/u1' } } },
      'filemoon',
      { watchUrl: 'https://filemoon.sx/d/a' },
    );
    assert.equal(next.videoHosts.udrop.watchUrl, 'https://udrop.com/u1');
    assert.equal(next.videoHosts.filemoon.watchUrl, 'https://filemoon.sx/d/a');
  });
  test('the target object is not mutated', () => {
    const target = { id: '1' };
    mergeVideoProviderResult(target, 'filemoon', { watchUrl: 'https://filemoon.sx/d/a' });
    assert.equal(target.videoHosts, undefined);
  });
});

describe('normalizeVideoProviderLinksForStorage', () => {
  test('returns the link map when links exist, undefined otherwise', () => {
    const out = normalizeVideoProviderLinksForStorage({ videoHosts: { filemoon: { watchUrl: 'https://filemoon.sx/d/a' } } });
    assert.equal(out.filemoon.watchUrl, 'https://filemoon.sx/d/a');
    assert.equal(normalizeVideoProviderLinksForStorage({}), undefined);
    assert.equal(normalizeVideoProviderLinksForStorage(), undefined);
  });
});
