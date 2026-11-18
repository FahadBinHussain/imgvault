// node:test suite for packages/shared/providerCatalog.js — the provider/host
// catalog. Pure data + pure helpers, no network.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_SOURCE_OPTIONS,
  AUDIO_UPLOAD_SERVICES,
  DEFAULT_3D_SOURCE,
  DEFAULT_AUDIO_SOURCE,
  DEFAULT_IMAGE_SOURCE,
  DEFAULT_VAULT_BLOB_HOST,
  DEFAULT_VIDEO_SOURCE,
  IMAGE_SOURCE_OPTIONS,
  IMAGE_UPLOAD_SERVICES,
  THREE_D_HOST_KEYS,
  THREE_D_SOURCE_OPTIONS,
  VIDEO_SOURCE_OPTIONS,
  VIDEO_UPLOAD_SERVICES,
  assertVaultBlobHostSizes,
  buildVaultBlobCopy,
  filterUploadServicesByKeys,
  getConfiguredServices,
  getMissingRequiredImageUploadServices,
  getVaultBlobHostOptions,
  getVaultBlobHostServices,
  normalizeVaultBlobHostKeys,
} from '../../packages/shared/providerCatalog.js';

const byKey = (list) => Object.fromEntries(list.map((s) => [s.key, s]));

describe('defaults', () => {
  test('default sources are imgbb / filemoon / udrop', () => {
    assert.equal(DEFAULT_IMAGE_SOURCE, 'imgbb');
    assert.equal(DEFAULT_VIDEO_SOURCE, 'filemoon');
    assert.equal(DEFAULT_3D_SOURCE, 'udrop');
    assert.equal(DEFAULT_VAULT_BLOB_HOST, 'udrop');
  });
  test('the default audio source is the default video source', () => {
    assert.equal(DEFAULT_AUDIO_SOURCE, DEFAULT_VIDEO_SOURCE);
  });
});

describe('IMAGE_UPLOAD_SERVICES', () => {
  test('three image hosts, keyed pixvid / imgbb / telegram', () => {
    assert.deepEqual(IMAGE_UPLOAD_SERVICES.map((s) => s.key), ['pixvid', 'imgbb', 'telegram']);
  });
  test('imgbb has a thumb field, pixvid does not', () => {
    const services = byKey(IMAGE_UPLOAD_SERVICES);
    assert.equal(services.imgbb.thumbUrlField, 'imgbbThumbUrl');
    assert.equal(services.pixvid.thumbUrlField, undefined);
  });
  test('telegram image has no urlField (documents are served via /telegram-media/)', () => {
    const services = byKey(IMAGE_UPLOAD_SERVICES);
    assert.equal(services.telegram.urlField, undefined);
    assert.equal(services.telegram.deleteUrlField, undefined);
  });
  test('isConfigured checks the right api keys', () => {
    const services = byKey(IMAGE_UPLOAD_SERVICES);
    assert.equal(services.pixvid.isConfigured({ pixvidApiKey: 'k' }), true);
    assert.equal(services.pixvid.isConfigured({}), false);
    assert.equal(services.pixvid.isConfigured({ pixvidApiKey: '  ' }), false);
    assert.equal(services.imgbb.isConfigured({ imgbbApiKey: 'k' }), true);
    assert.equal(services.telegram.isConfigured({ telegramBotToken: 't', telegramChannel: 'c' }), true);
    assert.equal(services.telegram.isConfigured({ telegramBotToken: 't' }), false);
  });
  test('image source options put the default first', () => {
    assert.equal(IMAGE_SOURCE_OPTIONS[0].value, 'imgbb');
    assert.deepEqual(IMAGE_SOURCE_OPTIONS.map((o) => o.value).sort(), ['imgbb', 'pixvid', 'telegram']);
  });
});

describe('VIDEO_UPLOAD_SERVICES', () => {
  test('four video hosts, keyed filemoon / udrop / terabox / telegram', () => {
    assert.deepEqual(VIDEO_UPLOAD_SERVICES.map((s) => s.key), ['filemoon', 'udrop', 'terabox', 'telegram']);
  });
  test('filemoon/udrop/terabox carry watch + direct + alias fields', () => {
    const services = byKey(VIDEO_UPLOAD_SERVICES);
    for (const key of ['filemoon', 'udrop', 'terabox']) {
      assert.equal(services[key].watchUrlField, `${key}WatchUrl`, key);
      assert.equal(services[key].directUrlField, `${key}DirectUrl`, key);
      assert.equal(services[key].aliasWatchUrlField, `${key}Url`, key);
    }
  });
  test('telegram has NO watchUrlField / directUrlField (no top-level mirror)', () => {
    const services = byKey(VIDEO_UPLOAD_SERVICES);
    assert.equal(services.telegram.watchUrlField, undefined);
    assert.equal(services.telegram.directUrlField, undefined);
    assert.equal(services.telegram.aliasWatchUrlField, undefined);
  });
  test('telegram video caps are 20 MB documents / 50 MB mp4', () => {
    const services = byKey(VIDEO_UPLOAD_SERVICES);
    assert.equal(services.telegram.videoMaxBytes, 20 * 1024 * 1024);
    assert.equal(services.telegram.videoMp4MaxBytes, 50 * 1024 * 1024);
    assert.match(services.telegram.videoCapNote, /getFile/);
  });
  test('only telegram has video caps', () => {
    const services = byKey(VIDEO_UPLOAD_SERVICES);
    for (const key of ['filemoon', 'udrop', 'terabox']) {
      assert.equal(services[key].videoMaxBytes, undefined, key);
    }
  });
  test('terabox is always configured (cookie auto-reads)', () => {
    const services = byKey(VIDEO_UPLOAD_SERVICES);
    assert.equal(services.terabox.isConfigured({}), true);
    assert.equal(services.terabox.isConfigured(), true);
  });
  test('udrop needs both keys', () => {
    const services = byKey(VIDEO_UPLOAD_SERVICES);
    assert.equal(services.udrop.isConfigured({ udropKey1: 'a', udropKey2: 'b' }), true);
    assert.equal(services.udrop.isConfigured({ udropKey1: 'a' }), false);
  });
  test('video source options put the default first', () => {
    assert.equal(VIDEO_SOURCE_OPTIONS[0].value, 'filemoon');
  });
});

describe('audio services ride the video hosts', () => {
  test('AUDIO_UPLOAD_SERVICES is the SAME array as VIDEO_UPLOAD_SERVICES', () => {
    assert.strictEqual(AUDIO_UPLOAD_SERVICES, VIDEO_UPLOAD_SERVICES);
  });
  test('AUDIO_SOURCE_OPTIONS is the SAME array as VIDEO_SOURCE_OPTIONS', () => {
    assert.strictEqual(AUDIO_SOURCE_OPTIONS, VIDEO_SOURCE_OPTIONS);
  });
});

describe('3D hosts', () => {
  test('THREE_D_HOST_KEYS are udrop / terabox / telegram (filemoon is video-only)', () => {
    assert.deepEqual(THREE_D_HOST_KEYS, ['udrop', 'terabox', 'telegram']);
  });
  test('3D source options put udrop first and use the telegram 3D label', () => {
    assert.equal(THREE_D_SOURCE_OPTIONS[0].value, 'udrop');
    const telegram = THREE_D_SOURCE_OPTIONS.find((o) => o.value === 'telegram');
    assert.equal(telegram.label, 'Telegram (≤ 20 MB docs)');
  });
});

describe('getConfiguredServices', () => {
  test('filters by each service isConfigured', () => {
    const configured = getConfiguredServices(VIDEO_UPLOAD_SERVICES, { filemoonApiKey: 'k' });
    assert.deepEqual(configured.map((s) => s.key), ['filemoon', 'terabox']);
  });
});

describe('filterUploadServicesByKeys', () => {
  test('selects by key, case-insensitively, keeping catalog order', () => {
    const out = filterUploadServicesByKeys(VIDEO_UPLOAD_SERVICES, ['TELEGRAM', ' filemoon ']);
    assert.deepEqual(out.map((s) => s.key), ['filemoon', 'telegram']);
  });
  test('an empty selection selects nothing', () => {
    assert.deepEqual(filterUploadServicesByKeys(VIDEO_UPLOAD_SERVICES, []), []);
    assert.deepEqual(filterUploadServicesByKeys(VIDEO_UPLOAD_SERVICES, [' ', '']), []);
  });
  test('a non-array selection returns everything (no filter applied)', () => {
    assert.strictEqual(filterUploadServicesByKeys(VIDEO_UPLOAD_SERVICES, null), VIDEO_UPLOAD_SERVICES);
    assert.strictEqual(filterUploadServicesByKeys(VIDEO_UPLOAD_SERVICES, undefined), VIDEO_UPLOAD_SERVICES);
  });
  test('unknown keys are ignored', () => {
    const out = filterUploadServicesByKeys(VIDEO_UPLOAD_SERVICES, ['nope', 'udrop']);
    assert.deepEqual(out.map((s) => s.key), ['udrop']);
  });
});

describe('getMissingRequiredImageUploadServices', () => {
  test('no image service is required, so nothing is ever missing', () => {
    assert.deepEqual(getMissingRequiredImageUploadServices({}), []);
    assert.deepEqual(getMissingRequiredImageUploadServices(), []);
  });
});

describe('vault blob hosts', () => {
  test('vault blob hosts are udrop / terabox / telegram (filemoon rejects .bin)', () => {
    assert.deepEqual(getVaultBlobHostServices().map((s) => s.key), ['udrop', 'terabox', 'telegram']);
  });
  test('telegram shows its vault cap in the picker label', () => {
    const telegram = getVaultBlobHostServices().find((s) => s.key === 'telegram');
    assert.equal(telegram.label, 'Telegram (≤ 20 MB)');
    assert.equal(telegram.vaultMaxBytes, 20 * 1024 * 1024);
  });
  test('getVaultBlobHostOptions returns key + label pairs', () => {
    assert.deepEqual(getVaultBlobHostOptions(), [
      { key: 'udrop', label: 'UDrop' },
      { key: 'terabox', label: 'TeraBox' },
      { key: 'telegram', label: 'Telegram (≤ 20 MB)' },
    ]);
  });
});

describe('assertVaultBlobHostSizes', () => {
  test('an under-cap blob passes on every host', () => {
    assert.doesNotThrow(() => assertVaultBlobHostSizes(['udrop', 'terabox', 'telegram'], 10 * 1024 * 1024));
  });
  test('an over-cap blob on telegram throws naming the host, size and cap', () => {
    assert.throws(
      () => assertVaultBlobHostSizes(['telegram'], 21 * 1024 * 1024),
      (err) => err.message.includes('Telegram cannot store this encrypted blob')
        && err.message.includes('21.0 MiB')
        && err.message.includes('20 MB vault cap')
        && err.message.includes('getFile'),
    );
  });
  test('an over-cap blob on an uncapped host passes', () => {
    assert.doesNotThrow(() => assertVaultBlobHostSizes(['udrop', 'terabox'], 500 * 1024 * 1024));
  });
  test('an unselected capped host is not checked', () => {
    assert.doesNotThrow(() => assertVaultBlobHostSizes(['udrop'], 500 * 1024 * 1024));
  });
  test('host keys are case-insensitive', () => {
    assert.throws(() => assertVaultBlobHostSizes(['TELEGRAM'], 21 * 1024 * 1024));
  });
});

describe('buildVaultBlobCopy', () => {
  test('telegram takes the direct route (watchUrl is an HTML post page)', () => {
    const copy = buildVaultBlobCopy('telegram', {
      watchUrl: 'https://t.me/chan/90',
      directUrl: '/telegram-media/abc123?mt=application%2Foctet-stream',
      fileId: 'abc123',
      messageId: '90',
    });
    assert.equal(copy.host, 'telegram');
    assert.equal(copy.encryptedBlobUrl, '/telegram-media/abc123?mt=application%2Foctet-stream');
    assert.equal(copy.encryptedBlobWatchUrl, 'https://t.me/chan/90');
    assert.equal(copy.encryptedBlobFileId, 'abc123');
    assert.equal(copy.encryptedBlobMessageId, '90');
  });
  test('other hosts keep the watch URL as the blob URL', () => {
    const copy = buildVaultBlobCopy('udrop', {
      watchUrl: 'https://udrop.com/abc/file.bin',
      directUrl: 'https://cdn.udrop.com/abc/file.bin',
      fileId: '42',
    });
    assert.equal(copy.encryptedBlobUrl, 'https://udrop.com/abc/file.bin');
    assert.equal(copy.encryptedBlobWatchUrl, 'https://udrop.com/abc/file.bin');
    assert.equal(copy.encryptedBlobMessageId, undefined);
  });
  test('telegram without a directUrl falls back to the raw url', () => {
    const copy = buildVaultBlobCopy('telegram', { url: 'https://t.me/chan/91', fileId: 'x' });
    assert.equal(copy.encryptedBlobUrl, 'https://t.me/chan/91');
  });
  test('host is lowercased', () => {
    assert.equal(buildVaultBlobCopy('Udrop', {}).host, 'udrop');
  });
});

describe('normalizeVaultBlobHostKeys', () => {
  test('a legacy single string becomes a one-element array', () => {
    assert.deepEqual(normalizeVaultBlobHostKeys('telegram'), ['telegram']);
  });
  test('valid keys pass through lowercased, invalid ones are dropped', () => {
    assert.deepEqual(normalizeVaultBlobHostKeys(['TELEGRAM', 'filemoon', 'udrop']), ['telegram', 'udrop']);
  });
  test('empty / missing / all-invalid selections fall back to the default host', () => {
    assert.deepEqual(normalizeVaultBlobHostKeys([]), ['udrop']);
    assert.deepEqual(normalizeVaultBlobHostKeys(), ['udrop']);
    assert.deepEqual(normalizeVaultBlobHostKeys(['filemoon']), ['udrop']);
    assert.deepEqual(normalizeVaultBlobHostKeys(''), ['udrop']);
  });
});
