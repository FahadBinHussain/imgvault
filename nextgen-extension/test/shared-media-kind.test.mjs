// node:test suite for packages/shared/mediaFieldRegistry.js +
// packages/shared/mediaItemNormalizer.js — media kind detection, the field
// registry, and row normalization. Pure functions, no network.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEDIA_FIELD_REGISTRY,
  MEDIA_KIND_AUDIO,
  MEDIA_KIND_IMAGE,
  MEDIA_KIND_LINK,
  MEDIA_KIND_SCENE,
  MEDIA_KIND_SYSTEM,
  MEDIA_KIND_VIDEO,
  VAULT_CONFIG_ITEM_ID,
  VAULT_CONFIG_SYSTEM_TYPE,
  getAiAnalysisFieldKeys,
  getAiMetadataFieldKeys,
  getAllBaseFieldKeys,
  getBaseFieldKeys,
  getDisplayFieldKeys,
  getExtraMetadata,
  getMediaItemKind,
  getOverviewEntries,
  getSystemFieldKeys,
  getTechnicalFieldKeys,
  getTechnicalMetadataEntries,
  getVaultDisplayItem,
  hasAnyVideoProviderLink,
  hasRenderableFieldValue,
  isSystemMediaItem,
  isTruthyFlag,
  stripKnownTopLevelMediaFields,
} from '../../packages/shared/mediaFieldRegistry.js';
import {
  normalizeImageHosts,
  normalizeMediaItem,
  normalizeMediaItems,
  normalizeVideoHosts,
} from '../../packages/shared/mediaItemNormalizer.js';

describe('media kind constants', () => {
  test('kinds are image / video / audio / link / scene / system', () => {
    assert.equal(MEDIA_KIND_IMAGE, 'image');
    assert.equal(MEDIA_KIND_VIDEO, 'video');
    assert.equal(MEDIA_KIND_AUDIO, 'audio');
    assert.equal(MEDIA_KIND_LINK, 'link');
    assert.equal(MEDIA_KIND_SCENE, 'scene');
    assert.equal(MEDIA_KIND_SYSTEM, 'system');
  });
  test('the registry labels songs as Song', () => {
    assert.equal(MEDIA_FIELD_REGISTRY[MEDIA_KIND_AUDIO].label, 'Song');
    assert.equal(MEDIA_FIELD_REGISTRY[MEDIA_KIND_IMAGE].label, 'Image');
    assert.equal(MEDIA_FIELD_REGISTRY[MEDIA_KIND_VIDEO].label, 'Video');
  });
  test('the vault config id and system type', () => {
    assert.equal(VAULT_CONFIG_ITEM_ID, '__imgvault_vault_config__');
    assert.equal(VAULT_CONFIG_SYSTEM_TYPE, 'secretVaultConfig');
  });
});

describe('isTruthyFlag', () => {
  test('true / 1 / "1" / "true" (any case, padded) are truthy', () => {
    assert.equal(isTruthyFlag(true), true);
    assert.equal(isTruthyFlag(1), true);
    assert.equal(isTruthyFlag('1'), true);
    assert.equal(isTruthyFlag('true'), true);
    assert.equal(isTruthyFlag(' True '), true);
    assert.equal(isTruthyFlag('TRUE'), true);
  });
  test('everything else is falsy', () => {
    for (const v of [false, 0, '0', 'false', '', null, undefined, 'yes', 2]) {
      assert.equal(isTruthyFlag(v), false, String(v));
    }
  });
});

describe('getExtraMetadata / isSystemMediaItem', () => {
  test('getExtraMetadata returns the object or an empty object', () => {
    assert.deepEqual(getExtraMetadata({ extraMetadata: { a: 1 } }), { a: 1 });
    assert.deepEqual(getExtraMetadata({ extraMetadata: 'json?' }), {});
    assert.deepEqual(getExtraMetadata({}), {});
    assert.deepEqual(getExtraMetadata(), {});
  });
  test('system items are detected by id, prefix, or systemType', () => {
    assert.equal(isSystemMediaItem({ id: VAULT_CONFIG_ITEM_ID }), true);
    assert.equal(isSystemMediaItem({ id: '__imgvault_something' }), true);
    assert.equal(isSystemMediaItem({ systemType: VAULT_CONFIG_SYSTEM_TYPE }), true);
    assert.equal(isSystemMediaItem({ extraMetadata: { systemType: VAULT_CONFIG_SYSTEM_TYPE } }), true);
    assert.equal(isSystemMediaItem({ id: 'normal-id' }), false);
    assert.equal(isSystemMediaItem({}), false);
  });
});

describe('hasAnyVideoProviderLink (registry version)', () => {
  test('top-level filemoon / udrop fields count', () => {
    assert.equal(hasAnyVideoProviderLink({ filemoonWatchUrl: 'x' }), true);
    assert.equal(hasAnyVideoProviderLink({ filemoonDirectUrl: 'x' }), true);
    assert.equal(hasAnyVideoProviderLink({ filemoonUrl: 'x' }), true);
    assert.equal(hasAnyVideoProviderLink({ udropWatchUrl: 'x' }), true);
    assert.equal(hasAnyVideoProviderLink({ udropDirectUrl: 'x' }), true);
    assert.equal(hasAnyVideoProviderLink({ udropUrl: 'x' }), true);
  });
  test('nested videoHosts links count, from either copy', () => {
    assert.equal(hasAnyVideoProviderLink({ videoHosts: { terabox: { watchUrl: 'x' } } }), true);
    assert.equal(hasAnyVideoProviderLink({ videoHosts: { terabox: { directUrl: 'x' } } }), true);
    assert.equal(hasAnyVideoProviderLink({ extraMetadata: { videoHosts: { telegram: { watchUrl: 'x' } } } }), true);
  });
  test('a thumbnail-only host does not count', () => {
    assert.equal(hasAnyVideoProviderLink({ videoHosts: { filemoon: { thumbnailUrl: 'x' } } }), false);
  });
  test('nothing returns false', () => {
    assert.equal(hasAnyVideoProviderLink({}), false);
    assert.equal(hasAnyVideoProviderLink(), false);
  });
});

describe('getMediaItemKind', () => {
  test('the default kind is image', () => {
    assert.equal(getMediaItemKind({}), 'image');
    assert.equal(getMediaItemKind(), 'image');
  });
  test('system wins over everything', () => {
    assert.equal(getMediaItemKind({ id: VAULT_CONFIG_ITEM_ID, kind: 'video', isVideo: true }), 'system');
    assert.equal(getMediaItemKind({ kind: 'system' }), 'system');
  });
  test('3D files are scenes, by extension, mime, or spzUrl', () => {
    assert.equal(getMediaItemKind({ fileName: 'model.spz' }), 'scene');
    assert.equal(getMediaItemKind({ fileName: 'model.glb' }), 'scene');
    assert.equal(getMediaItemKind({ fileType: 'model/gltf-binary' }), 'scene');
    assert.equal(getMediaItemKind({ fileType: 'model/gltf+json' }), 'scene');
    assert.equal(getMediaItemKind({ spzUrl: 'https://udrop.com/x/model.spz' }), 'scene');
    assert.equal(getMediaItemKind({ kind: 'scene' }), 'scene');
  });
  test('explicit kinds are honoured (case-insensitive)', () => {
    assert.equal(getMediaItemKind({ kind: 'VIDEO' }), 'video');
    assert.equal(getMediaItemKind({ kind: ' Audio ' }), 'audio');
    assert.equal(getMediaItemKind({ kind: 'image' }), 'image');
    assert.equal(getMediaItemKind({ kind: 'link' }), 'link');
  });
  test('AUDIO IS CHECKED BEFORE VIDEO — a song with video-host links is still a song', () => {
    assert.equal(getMediaItemKind({
      isAudio: true,
      videoHosts: { filemoon: { watchUrl: 'https://filemoon.sx/d/a' } },
    }), 'audio');
    assert.equal(getMediaItemKind({
      kind: 'audio',
      videoHosts: { telegram: { watchUrl: 'https://t.me/chan/9' } },
    }), 'audio');
    assert.equal(getMediaItemKind({
      fileType: 'audio/mpeg',
      videoHosts: { filemoon: { watchUrl: 'https://filemoon.sx/d/a' } },
    }), 'audio');
  });
  test('an explicit audio kind with an image mime and no video links is an image', () => {
    assert.equal(getMediaItemKind({ kind: 'audio', fileType: 'image/png' }), 'image');
  });
  test('an explicit video kind with an image mime and no video links is an image', () => {
    assert.equal(getMediaItemKind({ kind: 'video', fileType: 'image/png' }), 'image');
  });
  test('an explicit video kind with video links stays a video even with an image mime', () => {
    assert.equal(getMediaItemKind({
      kind: 'video',
      fileType: 'image/png',
      videoHosts: { filemoon: { watchUrl: 'https://filemoon.sx/d/a' } },
    }), 'video');
  });
  test('links are detected by flag or URL', () => {
    assert.equal(getMediaItemKind({ isLink: true }), 'link');
    assert.equal(getMediaItemKind({ isLink: 'true' }), 'link');
    assert.equal(getMediaItemKind({ linkUrl: 'https://example.com' }), 'link');
  });
  test('videos are detected by flag, mime, duration, links, or encrypted mime', () => {
    assert.equal(getMediaItemKind({ isVideo: true }), 'video');
    assert.equal(getMediaItemKind({ fileType: 'video/mp4' }), 'video');
    assert.equal(getMediaItemKind({ duration: 12.5 }), 'video');
    assert.equal(getMediaItemKind({ videoHosts: { udrop: { directUrl: 'x' } } }), 'video');
    assert.equal(getMediaItemKind({ encryptedMimeType: 'video/mp4' }), 'video');
    assert.equal(getMediaItemKind({ _decryptedMeta: { isVideo: true } }), 'video');
  });
  test('audio is detected by encrypted mime too', () => {
    assert.equal(getMediaItemKind({ encryptedMimeType: 'audio/mpeg' }), 'audio');
  });
  test('an image mime with no video links is an image', () => {
    assert.equal(getMediaItemKind({ fileType: 'image/jpeg' }), 'image');
  });
  test('an unknown explicit kind falls through to inference', () => {
    assert.equal(getMediaItemKind({ kind: 'weird', isVideo: true }), 'video');
    assert.equal(getMediaItemKind({ kind: 'weird' }), 'image');
  });
});

describe('field key getters', () => {
  test('getBaseFieldKeys returns a copy per kind', () => {
    const video = getBaseFieldKeys('video');
    assert.ok(video.includes('videoHosts'));
    assert.ok(video.includes('filemoonWatchUrl'));
    const audio = getBaseFieldKeys('audio');
    assert.ok(audio.includes('isAudio'));
    assert.ok(audio.includes('videoHosts'));
    const link = getBaseFieldKeys('link');
    assert.ok(link.includes('linkUrl'));
    assert.ok(!link.includes('videoHosts'));
  });
  test('an unknown kind falls back to the image base', () => {
    assert.deepEqual(getBaseFieldKeys('nope'), getBaseFieldKeys('image'));
  });
  test('an item argument derives its kind first', () => {
    assert.ok(getBaseFieldKeys({ isVideo: true }).includes('videoHosts'));
    assert.ok(getBaseFieldKeys({ isAudio: true }).includes('isAudio'));
  });
  test('getAllBaseFieldKeys covers every kind', () => {
    const all = getAllBaseFieldKeys();
    assert.ok(all.includes('imgbbUrl'));
    assert.ok(all.includes('videoHosts'));
    assert.ok(all.includes('isAudio'));
    assert.ok(all.includes('linkUrl'));
    assert.ok(all.includes('spzUrl'));
  });
  test('technical / system / ai key lists', () => {
    assert.deepEqual(getTechnicalFieldKeys(), ['sha256', 'pHash', 'aHash', 'dHash', 'exifMetadata']);
    assert.ok(getSystemFieldKeys().includes('id'));
    assert.ok(getSystemFieldKeys().includes('extraMetadata'));
    assert.ok(getAiMetadataFieldKeys().includes('provider'));
    assert.ok(getAiAnalysisFieldKeys().includes('caption'));
    assert.ok(getAiAnalysisFieldKeys().includes('ocr'));
  });
  test('getDisplayFieldKeys honours omissions', () => {
    const keys = getDisplayFieldKeys({ kind: 'image' }, { omittedFields: ['tags'] });
    assert.ok(!keys.includes('tags'));
    assert.ok(keys.includes('fileName'));
  });
});

describe('hasRenderableFieldValue', () => {
  test('false / undefined / null / empty are not renderable; 0 is', () => {
    assert.equal(hasRenderableFieldValue(false), false);
    assert.equal(hasRenderableFieldValue(undefined), false);
    assert.equal(hasRenderableFieldValue(null), false);
    assert.equal(hasRenderableFieldValue(''), false);
    assert.equal(hasRenderableFieldValue(0), true);
    assert.equal(hasRenderableFieldValue('x'), true);
  });
});

describe('getTechnicalMetadataEntries', () => {
  test('returns unknown fields only, sorted, skipping internals', () => {
    const entries = getTechnicalMetadataEntries({
      id: '1',
      fileName: 'a.png',
      customZ: 'z',
      customA: 'a',
      _decryptedMeta: { x: 1 },
      extraMetadata: { y: 2 },
      ai: { caption: 'c' },
      empty: '',
      flag: false,
    });
    assert.deepEqual(entries, [['customA', 'a'], ['customZ', 'z']]);
  });
  test('includeAi opts ai back in', () => {
    const item = { extraMetadata: { y: 2 }, ai: { caption: 'c' } };
    assert.deepEqual(
      getTechnicalMetadataEntries(item, { includeAi: true }).map(([k]) => k),
      ['ai'],
    );
  });
  test('includeExtraMetadata does NOT bring extraMetadata back — it is a system key, always excluded', () => {
    const item = { extraMetadata: { y: 2 }, ai: { caption: 'c' } };
    assert.deepEqual(
      getTechnicalMetadataEntries(item, { includeExtraMetadata: true, includeAi: true }).map(([k]) => k),
      ['ai'],
    );
  });
  test('omittedFields are honoured', () => {
    const entries = getTechnicalMetadataEntries({ a: 1, b: 2 }, { omittedFields: ['a'] });
    assert.deepEqual(entries, [['b', 2]]);
  });
});

describe('getOverviewEntries', () => {
  test('base fields present on the item are listed', () => {
    const entries = getOverviewEntries({ kind: 'image', fileName: 'a.png', fileSize: 123 });
    assert.ok(entries.some((e) => e.key === 'fileName' && e.value === 'a.png'));
    assert.ok(entries.some((e) => e.key === 'fileSize' && e.value === 123));
  });
  test('nested provider links expand into provider.field rows', () => {
    const entries = getOverviewEntries({
      imageHosts: { pixvid: { url: 'https://pixvid.example/a.png', deleteUrl: 'https://pixvid.example/del' } },
    });
    assert.ok(entries.some((e) => e.key === 'pixvid.url' && e.value === 'https://pixvid.example/a.png'));
    assert.ok(entries.some((e) => e.key === 'pixvid.deleteUrl'));
    assert.ok(!entries.some((e) => e.key === 'imageHosts'));
  });
  test('a nested URL whose top-level mirror exists is skipped', () => {
    const entries = getOverviewEntries({
      filemoonWatchUrl: 'https://filemoon.sx/d/a',
      videoHosts: { filemoon: { watchUrl: 'https://filemoon.sx/d/a' } },
    });
    assert.ok(entries.some((e) => e.key === 'filemoonWatchUrl'));
    assert.ok(!entries.some((e) => e.key === 'filemoon.watchUrl'));
  });
  test('extraKeys add page-specific fields', () => {
    const entries = getOverviewEntries({ deletedAt: '2026-01-01' }, { extraKeys: ['deletedAt'] });
    assert.ok(entries.some((e) => e.key === 'deletedAt'));
  });
});

describe('stripKnownTopLevelMediaFields', () => {
  test('drops known top-level fields and keeps unknown + vault-managed ones', () => {
    const out = stripKnownTopLevelMediaFields({
      fileName: 'a.png',
      sha256: 'abc',
      isVaulted: true,
      vaultMode: 'secret',
      systemType: 'secretVaultConfig',
      secretVaultConfig: { v: 1 },
      customField: 'keep me',
      ai: { caption: 'c' },
    });
    assert.deepEqual(out, {
      isVaulted: true,
      vaultMode: 'secret',
      systemType: 'secretVaultConfig',
      secretVaultConfig: { v: 1 },
      customField: 'keep me',
    });
  });
  test('a non-object yields an empty object', () => {
    assert.deepEqual(stripKnownTopLevelMediaFields(null), {});
    assert.deepEqual(stripKnownTopLevelMediaFields('nope'), {});
  });
});

describe('getVaultDisplayItem', () => {
  test('without decrypted metadata the item is returned as-is', () => {
    const item = { id: '1', fileName: 'blob.bin' };
    assert.strictEqual(getVaultDisplayItem(item), item);
  });
  test('decrypted metadata overlays the placeholders', () => {
    const out = getVaultDisplayItem({
      id: '1',
      fileName: 'abc123.bin',
      _decryptedMeta: { fileName: 'real-clip.mp4', pageTitle: 'Real Title' },
    });
    assert.equal(out.fileName, 'real-clip.mp4');
    assert.equal(out.pageTitle, 'Real Title');
    assert.equal(out.id, '1');
  });
});

describe('normalizeImageHosts / normalizeVideoHosts', () => {
  test('image hosts merge extra + item, item wins; the merged map beats top-level fields', () => {
    const links = normalizeImageHosts(
      { imgbbUrl: 'https://i.ibb.co/a.png', imageHosts: { imgbb: { deleteUrl: 'https://ibb.co/del/a' } } },
      { imageHosts: { imgbb: { url: 'https://i.ibb.co/old.png' } } },
    );
    // the url already in the (extra) host map wins over the top-level column
    assert.equal(links.imgbb.url, 'https://i.ibb.co/old.png');
    assert.equal(links.imgbb.deleteUrl, 'https://ibb.co/del/a');
  });
  test('top-level fields fill gaps the host maps leave', () => {
    const links = normalizeImageHosts(
      { imgbbUrl: 'https://i.ibb.co/a.png', imgbbDeleteUrl: 'https://ibb.co/del/a' },
      {},
    );
    assert.equal(links.imgbb.url, 'https://i.ibb.co/a.png');
    assert.equal(links.imgbb.deleteUrl, 'https://ibb.co/del/a');
  });
  test('video hosts merge filemoon + udrop from both copies', () => {
    const links = normalizeVideoHosts(
      { filemoonWatchUrl: 'https://filemoon.sx/d/a' },
      { videoHosts: { udrop: { watchUrl: 'https://udrop.com/u1', directUrl: 'https://cdn.example/u.mp4' } } },
    );
    assert.equal(links.filemoon.watchUrl, 'https://filemoon.sx/d/a');
    assert.equal(links.udrop.watchUrl, 'https://udrop.com/u1');
    assert.equal(links.udrop.directUrl, 'https://cdn.example/u.mp4');
  });
  test('JSON-string host maps are parsed', () => {
    const links = normalizeImageHosts({ imageHosts: JSON.stringify({ pixvid: { url: 'https://pixvid.example/a.png' } }) }, {});
    assert.equal(links.pixvid.url, 'https://pixvid.example/a.png');
  });
  test('empty input yields empty maps', () => {
    assert.deepEqual(normalizeImageHosts({}, {}), {});
    assert.deepEqual(normalizeVideoHosts({}, {}), {});
  });
});

describe('normalizeMediaItem', () => {
  test('an empty item normalizes to an image with defaults', () => {
    const out = normalizeMediaItem({});
    assert.equal(out.kind, 'image');
    assert.equal(out.isVideo, false);
    assert.equal(out.isLink, false);
    assert.deepEqual(out.tags, []);
    assert.equal(out.collectionId, null);
    assert.deepEqual(out.extraMetadata, {});
    assert.equal(out.imageHosts, undefined);
    assert.equal(out.videoHosts, undefined);
  });
  test('extraMetadata fills top-level fields that are empty, top-level wins otherwise', () => {
    const out = normalizeMediaItem({
      fileName: 'top.png',
      extraMetadata: { fileName: 'extra.png', fileSize: 42 },
    });
    assert.equal(out.fileName, 'top.png');
    assert.equal(out.fileSize, 42);
  });
  test('a video kind sets isVideo, a link kind sets isLink', () => {
    assert.equal(normalizeMediaItem({ isVideo: true }).kind, 'video');
    assert.equal(normalizeMediaItem({ isVideo: true }).isVideo, true);
    assert.equal(normalizeMediaItem({ linkUrl: 'https://example.com' }).kind, 'link');
    assert.equal(normalizeMediaItem({ linkUrl: 'https://example.com' }).isLink, true);
  });
  test('legacy aliases are filled from the host maps', () => {
    const out = normalizeMediaItem({
      imageHosts: { imgbb: { url: 'https://i.ibb.co/a.png', thumbnailUrl: 'https://i.ibb.co/t.png' } },
      videoHosts: { filemoon: { watchUrl: 'https://filemoon.sx/d/a', directUrl: 'https://cdn.example/a.mp4' } },
    });
    assert.equal(out.imgbbUrl, 'https://i.ibb.co/a.png');
    assert.equal(out.imgbbThumbUrl, 'https://i.ibb.co/t.png');
    assert.equal(out.filemoonWatchUrl, 'https://filemoon.sx/d/a');
    assert.equal(out.filemoonDirectUrl, 'https://cdn.example/a.mp4');
    assert.equal(out.filemoonUrl, 'https://filemoon.sx/d/a');
  });
  test('preserveLegacyAliases: false skips the alias fill', () => {
    const out = normalizeMediaItem(
      { imageHosts: { imgbb: { url: 'https://i.ibb.co/a.png' } } },
      { preserveLegacyAliases: false },
    );
    assert.equal(out.imgbbUrl, undefined);
  });
  test('ai metadata moves into extraMetadata.ai and off the top level', () => {
    const out = normalizeMediaItem({ ai: { caption: 'a cat', status: 'done' } });
    assert.equal(out.ai, undefined);
    assert.deepEqual(out.extraMetadata.ai, { caption: 'a cat', status: 'done' });
  });
  test('tags fall back to the extra copy, then to an empty array', () => {
    assert.deepEqual(normalizeMediaItem({ extraMetadata: { tags: ['a'] } }).tags, ['a']);
    assert.deepEqual(normalizeMediaItem({ tags: 'not-an-array' }).tags, []);
  });
  test('known top-level fields are stripped out of the stored extra copy', () => {
    const out = normalizeMediaItem({ extraMetadata: { fileName: 'a.png', custom: 'keep' } });
    assert.equal(out.extraMetadata.fileName, undefined);
    assert.equal(out.extraMetadata.custom, 'keep');
  });
  test('a non-object item normalizes like an empty one', () => {
    assert.equal(normalizeMediaItem(null).kind, 'image');
    assert.equal(normalizeMediaItem('nope').kind, 'image');
  });
});

describe('normalizeMediaItems', () => {
  test('maps an array, and yields [] for a non-array', () => {
    const out = normalizeMediaItems([{ isVideo: true }, {}]);
    assert.deepEqual(out.map((i) => i.kind), ['video', 'image']);
    assert.deepEqual(normalizeMediaItems(null), []);
    assert.deepEqual(normalizeMediaItems('nope'), []);
  });
});
