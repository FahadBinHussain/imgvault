// node:test suite for packages/shared/collectionsLogic.js,
// packages/shared/downloadTargets.js, packages/shared/settingsSchema.js and
// the packages/shared/index.js re-exports. Pure functions, no network.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLLECTION_ID_PREFIX,
  collectionCountDeltas,
  createCollectionId,
  mergeCollectionUpdates,
  normalizeCollection,
  normalizeCollectionName,
} from '../../packages/shared/collectionsLogic.js';
import {
  getDownloadFileName,
  getDownloadItemTitle,
  getDownloadTarget,
  isHtmlContentType,
} from '../../packages/shared/downloadTargets.js';
import {
  IMAGE_SOURCE_SETTING_OPTIONS,
  SETTINGS_DEFAULTS,
  SETTINGS_FIELDS,
  SETTINGS_SECTIONS,
  TABLE_SETTINGS_FIELDS,
  THREE_D_SOURCE_SETTING_OPTIONS,
  VIDEO_SOURCE_SETTING_OPTIONS,
  buildTableSettingsPayload,
  getSettingsSectionFields,
} from '../../packages/shared/settingsSchema.js';
import * as sharedIndex from '../../packages/shared/index.js';

describe('collectionsLogic', () => {
  test('collection ids are collection_<timestamp>', () => {
    assert.equal(COLLECTION_ID_PREFIX, 'collection_');
    assert.equal(createCollectionId(1234567890), 'collection_1234567890');
    assert.match(createCollectionId(), /^collection_\d+$/);
  });
  test('normalizeCollectionName trims and rejects empty names', () => {
    assert.equal(normalizeCollectionName('  My Pics  '), 'My Pics');
    assert.throws(() => normalizeCollectionName(''), /Collection name is required/);
    assert.throws(() => normalizeCollectionName('   '), /Collection name is required/);
    assert.throws(() => normalizeCollectionName(null), /Collection name is required/);
    assert.throws(() => normalizeCollectionName(42), /Collection name is required/);
  });
  test('normalizeCollection accepts snake_case and camelCase rows', () => {
    assert.deepEqual(normalizeCollection({
      id: 'c1', name: 'A', description: 'd', color: 'red',
      image_count: 3, created_at: 't1', updated_at: 't2',
    }), {
      id: 'c1', name: 'A', description: 'd', color: 'red',
      imageCount: 3, createdAt: 't1', updatedAt: 't2',
    });
    assert.deepEqual(normalizeCollection({
      id: 'c2', name: 'B', imageCount: '7', createdAt: 't1', updatedAt: 't2',
    }), {
      id: 'c2', name: 'B', description: '', color: '',
      imageCount: 7, createdAt: 't1', updatedAt: 't2',
    });
  });
  test('normalizeCollection defaults missing fields and nulls a null row', () => {
    assert.deepEqual(normalizeCollection({ id: 'c3' }), {
      id: 'c3', name: '', description: '', color: '',
      imageCount: 0, createdAt: '', updatedAt: '',
    });
    assert.equal(normalizeCollection(null), null);
    assert.equal(normalizeCollection(undefined), null);
  });
  test('mergeCollectionUpdates uses ?? semantics (null/undefined keep current)', () => {
    const current = { name: 'A', description: 'd', color: 'red', imageCount: 3 };
    assert.deepEqual(mergeCollectionUpdates(current, { name: 'B' }), {
      name: 'B', description: 'd', color: 'red', imageCount: 3,
    });
    assert.deepEqual(mergeCollectionUpdates(current, { name: null, color: undefined }), current);
    assert.deepEqual(mergeCollectionUpdates(current, {}), current);
    assert.deepEqual(mergeCollectionUpdates(current), current);
  });
  test('collectionCountDeltas moves counts only on a real change', () => {
    assert.deepEqual(collectionCountDeltas('a', 'b'), { decrement: 'a', increment: 'b' });
    assert.deepEqual(collectionCountDeltas('a', 'a'), { decrement: null, increment: null });
    assert.deepEqual(collectionCountDeltas(null, null), { decrement: null, increment: null });
    assert.deepEqual(collectionCountDeltas('a', null), { decrement: 'a', increment: null });
    assert.deepEqual(collectionCountDeltas(null, 'b'), { decrement: null, increment: 'b' });
    assert.deepEqual(collectionCountDeltas('', 'b'), { decrement: null, increment: 'b' });
  });
});

describe('getDownloadItemTitle', () => {
  test('pageTitle wins, then fileName, then untitled', () => {
    assert.equal(getDownloadItemTitle({ pageTitle: 'T', fileName: 'f.png' }), 'T');
    assert.equal(getDownloadItemTitle({ fileName: 'f.png' }), 'f.png');
    assert.equal(getDownloadItemTitle({}), 'untitled');
    assert.equal(getDownloadItemTitle(), 'untitled');
  });
});

describe('getDownloadTarget', () => {
  const imageItem = {
    kind: 'image',
    fileName: 'pic.png',
    imageHosts: { imgbb: { url: 'https://i.ibb.co/a.png' } },
  };
  const videoItem = {
    kind: 'video',
    fileName: 'clip.mp4',
    videoHosts: { filemoon: { watchUrl: 'https://filemoon.sx/d/a' } },
  };
  test('an image resolves STRICTLY from the configured image source', () => {
    const out = getDownloadTarget(imageItem, { imageSource: 'imgbb', videoSource: 'filemoon' });
    assert.deepEqual(out, {
      url: 'https://i.ibb.co/a.png',
      sourceKey: 'imgbb',
      sourceLabel: 'ImgBB',
      kind: 'image',
      title: 'pic.png',
    });
  });
  test('an image with no URL on the configured source throws, naming the item and host', () => {
    assert.throws(
      () => getDownloadTarget(imageItem, { imageSource: 'pixvid' }),
      (err) => err.message.includes('"pic.png"')
        && err.message.includes('no Pixvid URL stored')
        && err.message.includes('default image source: Pixvid'),
    );
  });
  test('a video resolves STRICTLY from the configured video source', () => {
    const out = getDownloadTarget(videoItem, { imageSource: 'imgbb', videoSource: 'filemoon' });
    assert.equal(out.url, 'https://filemoon.sx/d/a');
    assert.equal(out.sourceLabel, 'Filemoon');
    assert.equal(out.kind, 'video');
  });
  test('a video with no URL on the configured source throws', () => {
    assert.throws(
      () => getDownloadTarget(videoItem, { videoSource: 'udrop' }),
      (err) => err.message.includes('no UDrop URL stored'),
    );
  });
  test('a scene resolves from spzUrl (top-level or extra)', () => {
    const out = getDownloadTarget({ kind: 'scene', fileName: 'm.spz', spzUrl: 'https://udrop.com/x/m.spz' }, {});
    assert.deepEqual(out, {
      url: 'https://udrop.com/x/m.spz',
      sourceKey: '',
      sourceLabel: '3D scene',
      kind: 'scene',
      title: 'm.spz',
    });
    const out2 = getDownloadTarget({ kind: 'scene', extraMetadata: { spzUrl: 'https://udrop.com/x/m.spz' } }, {});
    assert.equal(out2.url, 'https://udrop.com/x/m.spz');
  });
  test('a scene with no spzUrl throws', () => {
    assert.throws(
      () => getDownloadTarget({ kind: 'scene', fileName: 'm.spz' }, {}),
      /no 3D scene file URL stored/,
    );
  });
  test('a link item throws telling the caller to open the link', () => {
    assert.throws(
      () => getDownloadTarget({ kind: 'link', linkUrl: 'https://example.com', pageTitle: 'Site' }, {}),
      (err) => err.message.includes('"Site"')
        && err.message.includes('link items have no file'),
    );
  });
  test('an audio item currently throws the link message (only image/video/scene resolve)', () => {
    assert.throws(
      () => getDownloadTarget({ kind: 'audio', fileName: 'song.m4a' }, {}),
      /link items have no file/,
    );
  });
});

describe('isHtmlContentType', () => {
  test('detects HTML content types case-insensitively', () => {
    assert.equal(isHtmlContentType('text/html'), true);
    assert.equal(isHtmlContentType('text/html; charset=utf-8'), true);
    assert.equal(isHtmlContentType('TEXT/HTML'), true);
    assert.equal(isHtmlContentType('video/mp4'), false);
    assert.equal(isHtmlContentType(''), false);
    assert.equal(isHtmlContentType(), false);
  });
});

describe('getDownloadFileName', () => {
  test('a title that already carries a known extension is kept as-is', () => {
    assert.equal(getDownloadFileName({ fileName: 'clip.mp4' }, 'https://cdn.example/x.mkv', 'video/x-matroska'), 'clip.mp4');
    assert.equal(getDownloadFileName({ fileName: 'pic.png' }, '', ''), 'pic.png');
  });
  test('the URL extension wins over the content type', () => {
    assert.equal(
      getDownloadFileName({ fileName: 'clip' }, 'https://cdn.example/x.webm?token=abc', 'video/mp4'),
      'clip.webm',
    );
  });
  test('an unknown URL extension falls through to the content type', () => {
    assert.equal(
      getDownloadFileName({ fileName: 'clip' }, 'https://cdn.example/download.php?id=1', 'video/mp4'),
      'clip.mp4',
    );
  });
  test('the content type wins over the kind default', () => {
    assert.equal(getDownloadFileName({ fileName: 'pic' }, '', 'image/png'), 'pic.png');
    assert.equal(getDownloadFileName({ fileName: 'pic' }, '', 'image/jpeg; charset=binary'), 'pic.jpg');
  });
  test('the kind default is the last resort', () => {
    assert.equal(getDownloadFileName({ kind: 'image', fileName: 'pic' }, '', ''), 'pic.jpg');
    assert.equal(getDownloadFileName({ kind: 'video', fileName: 'clip' }, '', ''), 'clip.mp4');
    assert.equal(getDownloadFileName({ kind: 'scene', fileName: 'm' }, '', ''), 'm.spz');
    assert.equal(getDownloadFileName({ kind: 'link', fileName: 'site' }, '', ''), 'site.url');
  });
  test('forbidden filename characters become dashes, collapsed and trimmed', () => {
    assert.equal(
      getDownloadFileName({ kind: 'image', fileName: 'a/b:c*d?e"f<g>h|i\\j' }, '', ''),
      'a-b-c-d-e-f-g-h-i-j.jpg',
    );
  });
  test('control characters become dashes too', () => {
    assert.equal(getDownloadFileName({ kind: 'image', fileName: 'a\tb\nc' }, '', ''), 'a-b-c.jpg');
  });
  test('leading/trailing dots, spaces and dashes are trimmed', () => {
    assert.equal(getDownloadFileName({ kind: 'image', fileName: '... pic ...' }, '', ''), 'pic.jpg');
  });
  test('a title that sanitizes to nothing becomes "download"', () => {
    assert.equal(getDownloadFileName({ kind: 'image', fileName: '///' }, '', ''), 'download.jpg');
  });
  test('the base is capped at 120 characters', () => {
    const out = getDownloadFileName({ kind: 'image', fileName: 'a'.repeat(200) }, '', '');
    assert.equal(out, `${'a'.repeat(120)}.jpg`);
  });
});

describe('settingsSchema', () => {
  test('every field has a key, label, type, section and default', () => {
    const keys = new Set();
    for (const field of SETTINGS_FIELDS) {
      assert.equal(typeof field.key, 'string');
      assert.equal(typeof field.label, 'string');
      assert.equal(typeof field.type, 'string');
      assert.ok(SETTINGS_SECTIONS.some((s) => s.id === field.section), field.key);
      assert.ok('default' in field, field.key);
      assert.ok(!keys.has(field.key), `duplicate key ${field.key}`);
      keys.add(field.key);
    }
  });
  test('defaults: imgbb / filemoon / udrop, everything else empty', () => {
    assert.equal(SETTINGS_DEFAULTS.defaultGallerySource, 'imgbb');
    assert.equal(SETTINGS_DEFAULTS.defaultVideoSource, 'filemoon');
    assert.equal(SETTINGS_DEFAULTS.default3DSource, 'udrop');
    assert.equal(SETTINGS_DEFAULTS.pixvidApiKey, '');
    assert.equal(SETTINGS_DEFAULTS.telegramBotToken, '');
    assert.equal(Object.keys(SETTINGS_DEFAULTS).length, SETTINGS_FIELDS.length);
  });
  test('table-backed fields exclude the JSON-only ones', () => {
    const tableKeys = TABLE_SETTINGS_FIELDS.map((f) => f.key);
    assert.ok(!tableKeys.includes('teraboxCookie'));
    assert.ok(!tableKeys.includes('neonDatabaseUrl'));
    assert.ok(!tableKeys.includes('downloadFolder'));
    assert.ok(tableKeys.includes('pixvidApiKey'));
    assert.ok(tableKeys.includes('defaultGallerySource'));
  });
  test('getSettingsSectionFields filters by section', () => {
    const keys = getSettingsSectionFields('keys');
    assert.ok(keys.length > 0);
    assert.ok(keys.every((f) => f.section === 'keys'));
    assert.deepEqual(getSettingsSectionFields('nope'), []);
  });
  test('buildTableSettingsPayload fills defaults for empty values', () => {
    const payload = buildTableSettingsPayload({});
    assert.equal(payload.defaultGallerySource, 'imgbb');
    assert.equal(payload.pixvidApiKey, '');
  });
  test('buildTableSettingsPayload keeps provided values, coerced to strings', () => {
    const payload = buildTableSettingsPayload({ pixvidApiKey: 'k1', defaultGallerySource: 'telegram', udropKey1: 42 });
    assert.equal(payload.pixvidApiKey, 'k1');
    assert.equal(payload.defaultGallerySource, 'telegram');
    assert.equal(payload.udropKey1, '42');
  });
  test('buildTableSettingsPayload keeps unknown select values as-is (never rewrites to default)', () => {
    const payload = buildTableSettingsPayload({ defaultGallerySource: 'some-future-host' });
    assert.equal(payload.defaultGallerySource, 'some-future-host');
  });
  test('buildTableSettingsPayload ignores non-table fields', () => {
    const payload = buildTableSettingsPayload({ teraboxCookie: 'ndus=x', neonDatabaseUrl: 'postgres://x' });
    assert.equal(payload.teraboxCookie, undefined);
    assert.equal(payload.neonDatabaseUrl, undefined);
  });
  test('source option lists match the catalog', () => {
    assert.deepEqual(IMAGE_SOURCE_SETTING_OPTIONS.map((o) => o.value), ['imgbb', 'pixvid', 'telegram']);
    assert.deepEqual(VIDEO_SOURCE_SETTING_OPTIONS.map((o) => o.value), ['filemoon', 'udrop', 'terabox', 'telegram']);
    assert.deepEqual(THREE_D_SOURCE_SETTING_OPTIONS.map((o) => o.value), ['udrop', 'terabox']);
  });
});

describe('packages/shared/index.js re-exports', () => {
  test('every settings export resolves through the barrel', () => {
    assert.ok(Array.isArray(sharedIndex.SETTINGS_FIELDS));
    assert.ok(sharedIndex.SETTINGS_DEFAULTS);
    assert.ok(Array.isArray(sharedIndex.TABLE_SETTINGS_FIELDS));
    assert.equal(typeof sharedIndex.getSettingsSectionFields, 'function');
    assert.equal(typeof sharedIndex.buildTableSettingsPayload, 'function');
    assert.ok(Array.isArray(sharedIndex.IMAGE_SOURCE_SETTING_OPTIONS));
    assert.ok(Array.isArray(sharedIndex.VIDEO_SOURCE_SETTING_OPTIONS));
    assert.ok(Array.isArray(sharedIndex.THREE_D_SOURCE_SETTING_OPTIONS));
    assert.ok(Array.isArray(sharedIndex.SETTINGS_SECTIONS));
  });
});
