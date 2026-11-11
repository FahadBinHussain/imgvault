// unit tests for song (audio) support: file detection, media kind, host list
//
// run: node test-audio-media-kind.mjs
//
import {
  isAudioUploadFile,
  isAudioFileName,
  isAudioMediaItem,
  getFileExtension,
  AUDIO_FILE_EXTENSIONS,
  AUDIO_ACCEPT_ATTRIBUTE,
} from 'imgvault-shared/audioProviderLinks.js';
import {
  getMediaItemKind,
  MEDIA_KIND_AUDIO,
  MEDIA_KIND_VIDEO,
  MEDIA_KIND_IMAGE,
  getBaseFieldKeys,
  getAllBaseFieldKeys,
} from 'imgvault-shared/mediaFieldRegistry.js';
import {
  AUDIO_UPLOAD_SERVICES,
  VIDEO_UPLOAD_SERVICES,
  DEFAULT_AUDIO_SOURCE,
  DEFAULT_VIDEO_SOURCE,
  AUDIO_SOURCE_OPTIONS,
  VIDEO_SOURCE_OPTIONS,
} from 'imgvault-shared/providerCatalog.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures += 1; console.error(`FAIL  ${name}  ${extra}`); }
};

// --- file detection --------------------------------------------------------
check('m4a name is audio', isAudioFileName('horror ambience.m4a'));
check('mp3 name is audio', isAudioFileName('song.mp3'));
check('opus name is audio', isAudioFileName('voice.opus'));
check('mp4 name is not audio', !isAudioFileName('clip.mp4'));
check('png name is not audio', !isAudioFileName('photo.png'));
check('webm is not decided by extension alone', !AUDIO_FILE_EXTENSIONS.includes('webm'));
check('extension helper lowercases', getFileExtension('Track.M4A') === 'm4a');

check('mime audio/mp4 is audio', isAudioUploadFile({ name: 'x.bin', type: 'audio/mp4' }));
check('mime audio/mpeg is audio', isAudioUploadFile({ name: 'x.bin', type: 'audio/mpeg' }));
check('mime video/mp4 is not audio', !isAudioUploadFile({ name: 'x.mp4', type: 'video/mp4' }));
check('mime image/png is not audio', !isAudioUploadFile({ name: 'x.png', type: 'image/png' }));
check('no mime falls back to the extension', isAudioUploadFile({ name: 'x.m4a', type: '' }));
check('a typed video file named .m4a is not audio', !isAudioUploadFile({ name: 'x.m4a', type: 'video/mp4' }));

// --- media kind ------------------------------------------------------------
check('audio mime -> audio kind',
  getMediaItemKind({ fileType: 'audio/mp4', fileName: 'a.m4a' }) === MEDIA_KIND_AUDIO);
check('explicit audio kind wins over video links',
  getMediaItemKind({ kind: 'audio', fileType: 'audio/mp4', videoHosts: { filemoon: {} } }) === MEDIA_KIND_AUDIO);
check('isAudio flag -> audio kind',
  getMediaItemKind({ isAudio: true, fileType: '' }) === MEDIA_KIND_AUDIO);
check('a video row stays a video',
  getMediaItemKind({ isVideo: true, fileType: 'video/mp4' }) === MEDIA_KIND_VIDEO);
check('an image row stays an image',
  getMediaItemKind({ fileType: 'image/png' }) === MEDIA_KIND_IMAGE);
check('audio kind survives the video-host links a song carries',
  getMediaItemKind({ kind: 'audio', isVideo: false, videoHosts: { filemoon: { directUrl: 'x' } } }) === MEDIA_KIND_AUDIO);

check('audio base fields carry the video host fields',
  getBaseFieldKeys(MEDIA_KIND_AUDIO).includes('filemoonDirectUrl')
  && getBaseFieldKeys(MEDIA_KIND_AUDIO).includes('udropDirectUrl')
  && getBaseFieldKeys(MEDIA_KIND_AUDIO).includes('isAudio'));
check('audio base fields are part of the all-fields list',
  getAllBaseFieldKeys().includes('isAudio'));

// --- hosts: songs use the SAME hosts as video ------------------------------
check('song hosts are the video hosts',
  AUDIO_UPLOAD_SERVICES.map((s) => s.key).join(',') === VIDEO_UPLOAD_SERVICES.map((s) => s.key).join(','));
check('song default source is the video default source', DEFAULT_AUDIO_SOURCE === DEFAULT_VIDEO_SOURCE);
check('song source options mirror the video ones',
  AUDIO_SOURCE_OPTIONS.map((o) => o.value).join(',') === VIDEO_SOURCE_OPTIONS.map((o) => o.value).join(','));
check('the video hosts really are the file hosts (no image host in the song list)',
  !AUDIO_UPLOAD_SERVICES.some((s) => s.key === 'imgbb' || s.key === 'pixvid'));

// --- item helper -----------------------------------------------------------
check('stored song item is detected', isAudioMediaItem({ kind: 'audio', fileName: 'a.m4a' }));
check('stored video item is not a song', !isAudioMediaItem({ isVideo: true, fileName: 'a.mp4' }));

// --- the DB kind constraint must allow 'audio' ------------------------------
// A song row with kind='audio' is REJECTED by media_items.kind's CHECK
// constraint unless it allows 'audio', so the schema and the migration
// script have to agree with the live database.
{
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { join } = await import('node:path');
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const schemaTs = readFileSync(join(repoRoot, 'nextgen-extension/src/db/schema.ts'), 'utf8');
  const migrate = readFileSync(join(repoRoot, 'web/scripts/migrate-kind-audio.mjs'), 'utf8');
  const fixConstraint = readFileSync(join(repoRoot, 'nextgen-extension/fix-constraint.mjs'), 'utf8');
  check('the extension schema allows the audio kind',
    /kindCheck:.*'image','video','link','scene','audio'/.test(schemaTs), schemaTs.slice(0, 0));
  check('the migration script allows the audio kind',
    migrate.includes("'audio'") && migrate.includes('chk_media_items_kind'));
  check('the constraint fix script keeps the audio kind',
    fixConstraint.includes("'audio'") && fixConstraint.includes('chk_media_items_kind'));
}

// --- songs ride the video hosts, so the "is this a video?" checks must
// accept them (source host, restore host, retry, duplicate detection) ------
{
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { join } = await import('node:path');
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

  const background = read('nextgen-extension/src/background/background.js');
  check('handleImageUpload routes a song into the video pipeline',
    /if \(data\.isVideo \|\| data\.isAudio\) \{\s*return this\.handleVideoUpload\(data\);/.test(background));
  check('the video metadata keeps the song kind',
    /data\.isAudio \? \{ isAudio: true, kind: 'audio' \} : \{ kind: 'video' \}/.test(background));
  check('saveVaultedUpload keeps the song kind',
    /const isAudio = Boolean\(uploadData\.isAudio \|\| uploadData\.kind === 'audio'\)/.test(background));
  check('the vault move reads a song from a video host link',
    /const isAudio = Boolean\(current\.isAudio \|\| current\.kind === 'audio'\)/.test(background));
  check('retrying a video host accepts a song',
    /if \(!item\.isVideo && !item\.isAudio && !String\(item\.fileType/.test(background));

  const resolvePage = read('nextgen-extension/src/pages/ResolvePage.jsx');
  check('the resolve page treats a song as a video-host item',
    resolvePage.includes('function isVideoHostItem(item)') && resolvePage.includes('item.isAudio'));
  check('the resolve page does not list a song as an image',
    /isImageItem[\s\S]{0,400}item\.kind !== 'audio'/.test(resolvePage));

  const vaultModal = read('nextgen-extension/src/components/VaultMoveModal.jsx');
  check('the vault move modal offers video hosts for a song',
    /item\.isVideo \|\| item\.isAudio/.test(vaultModal));

  const storage = read('nextgen-extension/src/utils/storage.js');
  check('duplicate detection counts a song as a video-host item',
    /this\.isTruthyFlag\(item\.isAudio\)/.test(storage));

  const webVaultMove = read('web/src/lib/vaultMove.js');
  check('the web vault move accepts songs',
    webVaultMove.includes("new Set(['image', 'video', 'audio'])")
    && webVaultMove.includes("kind === 'video' || kind === 'audio'"));

  const webRoute = read('web/src/app/api/vault/move/route.js');
  check('the web vault move API accepts songs',
    webRoute.includes("new Set(['image', 'video', 'audio'])"));

  const webPage = read('web/src/app/gallery/page.jsx');
  check('the web gallery counts songs (no NaN counter)',
    /acc\[kind\] \+= 1[\s\S]{0,400}audio: 0/.test(webPage)
    || webPage.includes("{ all: 0, image: 0, video: 0, audio: 0, link: 0, scene: 0 }"));
  check('the web gallery has a Songs filter tab',
    webPage.includes("{ value: 'audio', label: 'Songs' }"));
  check('the web gallery renders a music tile for a song',
    webPage.includes("kind === 'audio' ? (") && webPage.includes('SONG'));
}

// --- the picker has to LET a song be picked ---------------------------------
// The OS file dialog filters on the accept attribute. A picker that only
// accepts image/*,video/* refuses to select a song, even though the drop
// handler, the upload path and the preview all handle one. A CDP probe that
// sets the file input directly ignores accept, so this never shows up in a
// headless test - it only shows up when a human opens the file dialog.
{
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { join } = await import('node:path');
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

  const galleryPage = read('nextgen-extension/src/pages/GalleryPage.jsx');
  check('the gallery picker accepts audio files',
    galleryPage.includes('image/*,video/*,${AUDIO_ACCEPT_ATTRIBUTE}'),
    galleryPage.slice(galleryPage.indexOf('accept={is3DMode'), galleryPage.indexOf('accept={is3DMode') + 220));
  check('the accept fragment carries the mime prefix and the extensions',
    AUDIO_ACCEPT_ATTRIBUTE.includes('audio/*')
    && AUDIO_ACCEPT_ATTRIBUTE.includes('.m4a')
    && AUDIO_ACCEPT_ATTRIBUTE.includes('.mp3'));
  check('the accept fragment does not smuggle webm in as an audio extension',
    !AUDIO_ACCEPT_ATTRIBUTE.includes('.webm'));
  check('every audio extension shows up in the accept fragment',
    AUDIO_FILE_EXTENSIONS.every((ext) => AUDIO_ACCEPT_ATTRIBUTE.includes(`.${ext}`)));
}

// --- a song must play from the host that actually holds the file ------------
// The gallery plays from the preferred video host, but an item can live on a
// host the preferred source does not have (a song uploaded to telegram only).
// A strict preferred-host lookup then reports "no playable host link" for a
// file that is sitting right there - that is what the user saw.
{
  const { getPlayableVideoProviderLink } = await import('imgvault-shared/videoProviderLinks.js');
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { join } = await import('node:path');
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const telegramOnlySong = {
    kind: 'audio',
    fileType: 'audio/mp4',
    videoHosts: {
      telegram: {
        directUrl: '/telegram-media/FILE?mt=audio%2Fmp4',
        watchUrl: 'https://t.me/channel/1',
      },
    },
  };

  const playable = getPlayableVideoProviderLink(telegramOnlySong, 'filemoon', 'directUrl');
  check('a telegram-only song still yields a playable url',
    playable.url === '/telegram-media/FILE?mt=audio%2Fmp4');
  check('the host that actually serves the file is reported',
    playable.sourceKey === 'telegram' && playable.sourceLabel.length > 0);
  check('a non-preferred host is flagged so the ui can name it',
    playable.isPreferred === false);

  const preferredFirst = getPlayableVideoProviderLink({
    kind: 'audio',
    videoHosts: {
      filemoon: { directUrl: 'https://filemoon.sx/d/abc' },
      telegram: { directUrl: '/telegram-media/FILE' },
    },
  }, 'filemoon', 'directUrl');
  check('the preferred host still wins when it has the file',
    preferredFirst.url === 'https://filemoon.sx/d/abc' && preferredFirst.isPreferred === true);

  check('an item with no host link at all yields nothing',
    getPlayableVideoProviderLink({ kind: 'audio' }, 'filemoon', 'directUrl').url === '');

  const galleryPage = readFileSync(join(repoRoot, 'nextgen-extension/src/pages/GalleryPage.jsx'), 'utf8');
  check('the gallery modal plays a song through the playable-host helper',
    galleryPage.includes('getPlayableVideoProviderLink(modalImage, defaultVideoSource'));
  check('the gallery modal names the host it plays from',
    galleryPage.includes('Playing from ${playableAudio.sourceLabel}'));

  const webLightbox = readFileSync(join(repoRoot, 'web/src/app/components/GalleryLightbox.jsx'), 'utf8');
  check('the web lightbox plays a song through the playable-host helper',
    webLightbox.includes('getPlayableVideoProviderLink(image, preferredVideoSource'));
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
