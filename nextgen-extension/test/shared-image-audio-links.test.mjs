// node:test suite for packages/shared/imageProviderLinks.js +
// packages/shared/audioProviderLinks.js. Pure functions, no network.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildImageProviderLinkFromResult,
  getImageProviderLabel,
  getImageProviderLinks,
  getImageRetrySourceCandidates,
  getImageUploadService,
  getMissingImageUploadServices,
  getPreferredImageProviderLink,
  getStrictImageProviderLink,
  hasAnyImageProviderLink,
  hasImageProviderLink,
  mergeImageProviderResult,
  normalizeImageProviderLinksForStorage,
} from '../../packages/shared/imageProviderLinks.js';
import {
  AUDIO_ACCEPT_ATTRIBUTE,
  AUDIO_FILE_EXTENSIONS,
  AUDIO_MIME_PREFIX,
  getFileExtension,
  isAudioFileName,
  isAudioMediaItem,
  isAudioUploadFile,
} from '../../packages/shared/audioProviderLinks.js';

describe('getImageUploadService / getImageProviderLabel', () => {
  test('looks up by key, case-insensitively', () => {
    assert.equal(getImageUploadService('imgbb').label, 'ImgBB');
    assert.equal(getImageUploadService(' PIXVID ').label, 'Pixvid');
    assert.equal(getImageUploadService('nope'), null);
    assert.equal(getImageProviderLabel('imgbb'), 'ImgBB');
    assert.equal(getImageProviderLabel('nope'), 'nope');
  });
});

describe('getImageProviderLinks', () => {
  test('reads links from imageHosts', () => {
    const links = getImageProviderLinks({
      imageHosts: { imgbb: { url: 'https://i.ibb.co/a.png', deleteUrl: 'https://ibb.co/del/a', thumbnailUrl: 'https://i.ibb.co/t.png' } },
    });
    assert.equal(links.imgbb.url, 'https://i.ibb.co/a.png');
    assert.equal(links.imgbb.displayUrl, 'https://i.ibb.co/a.png');
    assert.equal(links.imgbb.directUrl, 'https://i.ibb.co/a.png');
    assert.equal(links.imgbb.deleteUrl, 'https://ibb.co/del/a');
    assert.equal(links.imgbb.thumbnailUrl, 'https://i.ibb.co/t.png');
  });
  test('extraMetadata imageHosts are the fallback, top-level imageHosts win', () => {
    const links = getImageProviderLinks({
      imageHosts: { pixvid: { url: 'https://pixvid.example/top.png' } },
      extraMetadata: { imageHosts: { pixvid: { url: 'https://pixvid.example/extra.png', deleteUrl: 'https://pixvid.example/del' } } },
    });
    assert.equal(links.pixvid.url, 'https://pixvid.example/top.png');
    assert.equal(links.pixvid.deleteUrl, 'https://pixvid.example/del');
  });
  test('JSON-string extraMetadata and imageHosts are parsed', () => {
    const links = getImageProviderLinks({
      extraMetadata: JSON.stringify({ imageHosts: { imgbb: { url: 'https://i.ibb.co/s.png' } } }),
    });
    assert.equal(links.imgbb.url, 'https://i.ibb.co/s.png');
    const links2 = getImageProviderLinks({
      imageHosts: JSON.stringify({ pixvid: { url: 'https://pixvid.example/s.png' } }),
    });
    assert.equal(links2.pixvid.url, 'https://pixvid.example/s.png');
  });
  test('malformed JSON strings are ignored, not fatal', () => {
    const links = getImageProviderLinks({ extraMetadata: '{not json', imageHosts: '{also not' });
    assert.deepEqual(links, {});
  });
  test('legacy top-level fields fill in missing links', () => {
    const links = getImageProviderLinks({
      imgbbUrl: 'https://i.ibb.co/a.png',
      imgbbDeleteUrl: 'https://ibb.co/del/a',
      imgbbThumbUrl: 'https://i.ibb.co/t.png',
    });
    assert.equal(links.imgbb.url, 'https://i.ibb.co/a.png');
    assert.equal(links.imgbb.deleteUrl, 'https://ibb.co/del/a');
    assert.equal(links.imgbb.thumbnailUrl, 'https://i.ibb.co/t.png');
  });
  test('hosts with no URL at all are omitted', () => {
    const links = getImageProviderLinks({ imageHosts: { imgbb: { url: 'https://i.ibb.co/a.png' } } });
    assert.deepEqual(Object.keys(links), ['imgbb']);
  });
  test('non-object and empty items yield no links', () => {
    assert.deepEqual(getImageProviderLinks(), {});
    assert.deepEqual(getImageProviderLinks(null), {});
    assert.deepEqual(getImageProviderLinks('nope'), {});
  });
});

describe('getStrictImageProviderLink', () => {
  const item = { imageHosts: { imgbb: { url: 'https://i.ibb.co/a.png', thumbnailUrl: 'https://i.ibb.co/t.png' } } };
  test('url returns the url, thumbnailUrl returns the thumbnail', () => {
    assert.equal(getStrictImageProviderLink(item, 'imgbb', 'url'), 'https://i.ibb.co/a.png');
    assert.equal(getStrictImageProviderLink(item, 'imgbb', 'thumbnailUrl'), 'https://i.ibb.co/t.png');
  });
  test('thumbnailUrl falls back to thumbUrl, not to the full url', () => {
    const thumbOnly = { imageHosts: { imgbb: { thumbUrl: 'https://i.ibb.co/t2.png', url: 'https://i.ibb.co/a.png' } } };
    assert.equal(getStrictImageProviderLink(thumbOnly, 'imgbb', 'thumbnailUrl'), 'https://i.ibb.co/t2.png');
    const noThumb = { imageHosts: { imgbb: { url: 'https://i.ibb.co/a.png' } } };
    assert.equal(getStrictImageProviderLink(noThumb, 'imgbb', 'thumbnailUrl'), '');
  });
  test('unknown provider returns empty', () => {
    assert.equal(getStrictImageProviderLink(item, 'pixvid'), '');
  });
});

describe('getPreferredImageProviderLink', () => {
  const item = { imageHosts: { pixvid: { url: 'https://pixvid.example/a.png' } } };
  test('the preferred host wins when it has a link', () => {
    assert.equal(getPreferredImageProviderLink(item, 'pixvid'), 'https://pixvid.example/a.png');
  });
  test('a missing preferred host falls through in catalog order', () => {
    assert.equal(getPreferredImageProviderLink(item, 'imgbb'), 'https://pixvid.example/a.png');
  });
  test('the default preferred provider is imgbb', () => {
    const imgbbItem = { imageHosts: { imgbb: { url: 'https://i.ibb.co/a.png' }, pixvid: { url: 'https://pixvid.example/a.png' } } };
    assert.equal(getPreferredImageProviderLink(imgbbItem), 'https://i.ibb.co/a.png');
  });
  test('nothing anywhere returns empty', () => {
    assert.equal(getPreferredImageProviderLink({}), '');
  });
});

describe('hasImageProviderLink / hasAnyImageProviderLink / getMissingImageUploadServices', () => {
  const item = { imageHosts: { imgbb: { url: 'https://i.ibb.co/a.png' } } };
  test('per-host and any-host checks', () => {
    assert.equal(hasImageProviderLink(item, 'imgbb'), true);
    assert.equal(hasImageProviderLink(item, 'pixvid'), false);
    assert.equal(hasAnyImageProviderLink(item), true);
    assert.equal(hasAnyImageProviderLink({}), false);
  });
  test('missing services lists the hosts without a link', () => {
    assert.deepEqual(getMissingImageUploadServices(item).map((s) => s.key), ['pixvid', 'telegram']);
  });
});

describe('getImageRetrySourceCandidates', () => {
  test('excludes the target host and ends with the raw source URL', () => {
    const item = {
      sourceImageUrl: 'https://origin.example/a.png',
      imageHosts: {
        imgbb: { url: 'https://i.ibb.co/a.png', directUrl: 'https://i.ibb.co/a.png' },
        pixvid: { url: 'https://pixvid.example/a.png' },
      },
    };
    const out = getImageRetrySourceCandidates(item, 'imgbb');
    assert.ok(!out.includes('https://i.ibb.co/a.png'));
    assert.ok(out.includes('https://pixvid.example/a.png'));
    assert.equal(out[out.length - 1], 'https://origin.example/a.png');
  });
});

describe('buildImageProviderLinkFromResult / mergeImageProviderResult', () => {
  test('build maps aliases onto the canonical shape', () => {
    const link = buildImageProviderLinkFromResult({
      displayUrl: 'https://i.ibb.co/a.png',
      directUrl: 'https://i.ibb.co/a.png',
      filecode: 'f1',
      message_id: '5',
      apiResponse: 'ok',
    });
    assert.equal(link.url, 'https://i.ibb.co/a.png');
    assert.equal(link.fileId, 'f1');
    assert.equal(link.messageId, '5');
    assert.equal(link.apiMessage, 'ok');
  });
  test('merge writes imageHosts and mirrors the top-level fields', () => {
    const next = mergeImageProviderResult(
      { id: '1' },
      'imgbb',
      { url: 'https://i.ibb.co/a.png', deleteUrl: 'https://ibb.co/del/a', thumbnailUrl: 'https://i.ibb.co/t.png' },
    );
    assert.equal(next.imageHosts.imgbb.url, 'https://i.ibb.co/a.png');
    assert.equal(next.imgbbUrl, 'https://i.ibb.co/a.png');
    assert.equal(next.imgbbDeleteUrl, 'https://ibb.co/del/a');
    assert.equal(next.imgbbThumbUrl, 'https://i.ibb.co/t.png');
  });
  test('an unknown provider returns the target untouched', () => {
    const target = { id: '1' };
    assert.strictEqual(mergeImageProviderResult(target, 'nope', { url: 'x' }), target);
  });
  test('normalizeImageProviderLinksForStorage returns undefined when empty', () => {
    assert.equal(normalizeImageProviderLinksForStorage({}), undefined);
    const out = normalizeImageProviderLinksForStorage({ imageHosts: { imgbb: { url: 'https://i.ibb.co/a.png' } } });
    assert.equal(out.imgbb.url, 'https://i.ibb.co/a.png');
  });
});

describe('AUDIO_FILE_EXTENSIONS / AUDIO_ACCEPT_ATTRIBUTE', () => {
  test('the extension list is the audio-only set', () => {
    assert.deepEqual(AUDIO_FILE_EXTENSIONS, [
      'm4a', 'mp3', 'wav', 'opus', 'ogg', 'oga', 'flac', 'aac', 'm4b', 'weba', 'aif', 'aiff',
    ]);
  });
  test('.webm is deliberately excluded (video container as often as audio)', () => {
    assert.equal(AUDIO_FILE_EXTENSIONS.includes('webm'), false);
  });
  test('the accept attribute is audio/* plus every extension, dotted', () => {
    assert.equal(AUDIO_ACCEPT_ATTRIBUTE, 'audio/*,.m4a,.mp3,.wav,.opus,.ogg,.oga,.flac,.aac,.m4b,.weba,.aif,.aiff');
  });
  test('the mime prefix is audio/', () => {
    assert.equal(AUDIO_MIME_PREFIX, 'audio/');
  });
});

describe('getFileExtension', () => {
  test('lowercases and strips the dot', () => {
    assert.equal(getFileExtension('track.MP3'), 'mp3');
    assert.equal(getFileExtension('a.b.c.m4a'), 'm4a');
  });
  test('no dot or trailing dot yields empty', () => {
    assert.equal(getFileExtension('noext'), '');
    assert.equal(getFileExtension('trailing.'), '');
    assert.equal(getFileExtension(''), '');
    assert.equal(getFileExtension(null), '');
  });
});

describe('isAudioFileName', () => {
  test('audio extensions match, others do not', () => {
    assert.equal(isAudioFileName('song.m4a'), true);
    assert.equal(isAudioFileName('song.FLAC'), true);
    assert.equal(isAudioFileName('clip.mp4'), false);
    assert.equal(isAudioFileName('clip.webm'), false);
    assert.equal(isAudioFileName('image.png'), false);
  });
});

describe('isAudioUploadFile', () => {
  test('an audio mime wins even with a misleading name', () => {
    assert.equal(isAudioUploadFile({ name: 'x.bin', type: 'audio/mp4' }), true);
    assert.equal(isAudioUploadFile({ name: 'x.mp4', type: 'AUDIO/MPEG' }), true);
  });
  test('a video or image mime beats an audio-looking name', () => {
    assert.equal(isAudioUploadFile({ name: 'song.m4a', type: 'video/mp4' }), false);
    assert.equal(isAudioUploadFile({ name: 'song.mp3', type: 'image/png' }), false);
  });
  test('an untyped file falls back to its extension', () => {
    assert.equal(isAudioUploadFile({ name: 'song.flac', type: '' }), true);
    assert.equal(isAudioUploadFile({ name: 'clip.mp4' }), false);
  });
  test('an unrelated mime falls back to the extension', () => {
    assert.equal(isAudioUploadFile({ name: 'song.mp3', type: 'application/octet-stream' }), true);
    assert.equal(isAudioUploadFile({ name: 'clip.mp4', type: 'application/octet-stream' }), false);
  });
  test('null is not audio', () => {
    assert.equal(isAudioUploadFile(null), false);
    assert.equal(isAudioUploadFile(undefined), false);
  });
});

describe('isAudioMediaItem', () => {
  test('kind audio or the isAudio flag marks a song', () => {
    assert.equal(isAudioMediaItem({ kind: 'audio' }), true);
    assert.equal(isAudioMediaItem({ isAudio: true }), true);
  });
  test('isVideo true vetoes the song reading', () => {
    assert.equal(isAudioMediaItem({ isVideo: true, fileType: 'audio/mpeg' }), false);
  });
  test('an audio fileType marks a song', () => {
    assert.equal(isAudioMediaItem({ fileType: 'audio/mpeg' }), true);
    assert.equal(isAudioMediaItem({ fileType: 'AUDIO/MP4' }), true);
  });
  test('an audio filename marks a song when nothing says video', () => {
    assert.equal(isAudioMediaItem({ fileName: 'song.m4a' }), true);
    assert.equal(isAudioMediaItem({ isVideo: false, fileName: 'song.mp3' }), true);
    assert.equal(isAudioMediaItem({ fileName: 'clip.mp4' }), false);
  });
  test('null and empty items are not songs', () => {
    assert.equal(isAudioMediaItem(null), false);
    assert.equal(isAudioMediaItem({}), false);
  });
});
