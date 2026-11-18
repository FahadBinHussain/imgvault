// Regression tests mined from the ImgVault bug history (AGENTS.md).
// Area: audio as a first-class media kind (2.19.14-2.19.16).
//
// The pure seams (getMediaItemKind audio-before-video, the accept
// attribute string, getPlayableVideoProviderLink preferred-first +
// fallback) are covered live by the sibling unit tests and the legacy
// test-audio-media-kind.mjs script, so this file pins the WIRING the
// entries actually broke: the modal preview, the picker accept, the
// navbar bucket, the DB constraint, the modal player, and the delete
// path. GalleryPage.jsx / background.js cannot be imported in plain
// node, so these are SOURCE-TEXT assertions.
//
// NOTE (doc/code mismatch, reported not pinned): AGENTS.md 2.19.14(3)
// claims the upload modal's currentUploadKind checks audio before
// video, but the code checks video first (line ~557 before ~560).
// Behaviour is still correct because processMediaFile sets the flags
// mutually exclusively (pinned below), so no test asserts the
// audio-first order in currentUploadKind.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const gallery = () => src('../src/pages/GalleryPage.jsx');
const background = () => src('../src/background/background.js');

// ---------------------------------------------------------- 2.19.14 ---

test('2.19.14 (2026-11-11): processMediaFile sets isVideo/isAudio mutually exclusively — an .m4a can never be both', () => {
  const page = gallery();
  assert.ok(page.includes('const isVideo = !is3D && isVideoUploadFile(file);'));
  assert.ok(page.includes('const isAudio = !is3D && !isVideo && isAudioUpload(file);'));
});

test('2.19.14 (2026-11-11): the upload modal renders <audio controls> for a song and titles it "Upload Song"', () => {
  const page = gallery();
  assert.ok(page.includes('<audio src={audioSrc} controls className="w-full" preload="metadata" />'));
  assert.ok(page.includes("((uploadImageData?.isAudio || uploadMetadata?.isAudio) ? 'Upload Song' : 'Upload Image')"));
});

test('2.19.14 (2026-11-11): the kind constraint admits audio in the schema, the fix script, and the web migration', () => {
  const schema = src('../src/db/schema.ts');
  assert.ok(schema.includes("kindCheck: check('chk_media_items_kind', sql`${table.kind} in ('image','video','link','scene','audio')`),"));
  const fix = src('../fix-constraint.mjs');
  assert.ok(fix.includes("CHECK (kind IN ('image', 'video', 'link', 'scene', 'audio'))"));
  assert.ok(existsSync(fileURLToPath(new URL('../../web/scripts/migrate-kind-audio.mjs', import.meta.url))));
});

test('2.19.14 (2026-11-11): the navbar counts a song via getMediaItemKind BEFORE the video branch and says "song(s)"', () => {
  const navbar = src('../src/components/GalleryNavbar.jsx');
  const audioAt = navbar.indexOf("getMediaItemKind(item || {}) === 'audio'");
  const videoAt = navbar.indexOf("else if (item?.isVideo || String(item?.fileType || '').startsWith('video/'))");
  assert.ok(audioAt > 0 && videoAt > audioAt);
  assert.ok(navbar.includes('`${breakdown.songs} song${breakdown.songs !== 1 ? \'s\' : \'\'}`'));
});

// ---------------------------------------------------------- 2.19.15 ---

test('2.19.15 (2026-11-11): the picker accept is built from AUDIO_ACCEPT_ATTRIBUTE, not a hardcoded literal that can drift', () => {
  const page = gallery();
  assert.ok(page.includes("import { isAudioUploadFile, AUDIO_ACCEPT_ATTRIBUTE } from '../utils/audioProviderLinks';"));
  assert.ok(page.includes('accept={is3DMode ? ".glb,.gltf,.obj,.fbx,.stl,.spz,.3mf,.usdz,.usd,.blend,.dae,.ply,.abc,.bvh,model/*,application/octet-stream" : `image/*,video/*,${AUDIO_ACCEPT_ATTRIBUTE}`}'));
});

// ---------------------------------------------------------- 2.19.16 ---

test('2.19.16 (2026-11-11): the modal plays from the host that HAS the file — song, video, and poster all use getPlayableVideoProviderLink', () => {
  const page = gallery();
  assert.ok(page.includes("return getPlayableVideoProviderLink(item, defaultVideoSource, 'watchUrl').url;"));
  assert.ok(page.includes("return getPlayableVideoProviderLink(item, defaultVideoSource, 'directUrl').url;"));
  assert.ok(page.includes("const videoThumb = getPlayableVideoProviderLink(item, defaultVideoSource, 'thumbnailUrl').url"));
  assert.ok(page.includes("const playableAudio = getPlayableVideoProviderLink(modalImage, defaultVideoSource, 'directUrl');"));
});

test('2.19.16 (2026-11-11): the modal NAMES the serving host when it is not the preferred one', () => {
  const page = gallery();
  assert.ok(page.includes('`Playing from ${playableAudio.sourceLabel} — ${getVideoProviderLabel(defaultVideoSource)} has no link for this song`'));
  assert.ok(page.includes('Playing from {modalVideoSource.sourceLabel} — {getVideoProviderLabel(defaultVideoSource)} has no link for this video'));
});

test('2.19.16 (2026-11-11): with no link anywhere the modal still says so honestly', () => {
  const page = gallery();
  assert.ok(page.includes('No playable host link for this song yet.'));
});

test('2.19.16 (2026-11-11): the web lightbox also plays through getPlayableVideoProviderLink (same helper, both platforms)', () => {
  const lightbox = src('../../web/src/app/components/GalleryLightbox.jsx');
  assert.ok(lightbox.includes("import { getPlayableVideoProviderLink } from '@/lib/video-provider-links'"));
  assert.ok(lightbox.includes("getPlayableVideoProviderLink(item, preferredVideoSource, 'watchUrl').url"));
  assert.ok(lightbox.includes("getPlayableVideoProviderLink(item, preferredVideoSource, 'directUrl').url"));
});

test('2.19.16 (2026-11-11): permanentlyDeleteItem only ever deletes a TRASHED item, host blobs first, telegram post included', () => {
  const bg = background();
  const fn = bg.slice(bg.indexOf('async permanentlyDeleteItem(id) {'));
  assert.ok(fn.includes('const item = await this.storage.getTrashedImageById(id);'));
  assert.ok(fn.includes("if (!item) throw new Error('Trashed item not found');"));
  assert.ok(fn.includes('await this.deleteVaultBlobFiles(item);'));
  assert.ok(fn.includes('await this.deleteTelegramPosts(item);'));
  assert.ok(fn.includes('return this.storage.permanentlyDelete(id);'));
  // Empty-trash survivors stay in trash loudly instead of vanishing while
  // their blob lives on.
  assert.ok(bg.includes('could not be deleted (host blob delete failed'));
});

test('2.19.16 (2026-11-11): web vaultMove still demands a direct URL ON the preferred provider — a telegram-only item moves from the extension', () => {
  const move = src('../../web/src/lib/vaultMove.js');
  assert.ok(move.includes('getStrictVideoProviderLink') || move.includes('getStrictImageProviderLink'));
});

// ------------------------------------------------- gap-closing pins ---

test('2.13.19 (2026-10-04): updateVideoThumbnail writes the host map BOTH top-level and in extraMetadata (the legacy firestore readers take the top-level copy first)', () => {
  const storage = src('../src/utils/storage.js');
  const fn = storage.slice(storage.indexOf('async updateVideoThumbnail'));
  assert.ok(fn.includes('extraMetadata: { ...(current.extraMetadata || {}), videoHosts: vh },'));
  assert.ok(fn.includes('videoHosts: vh,'));
});
