// Regression tests mined from the ImgVault bug history (AGENTS.md).
// Area: modal playback picking an unplayable URL (2.19.44).
//
// User report (2026-11-25 07:29, with screenshot): opening a video showed
// a black player stuck at 0:00. The item (0d1b3832, a Facebook .mkv) has
// four hosts, but the preferred source was telegram — and the Telegram
// uploader stores the POST PAGE (https://t.me/c/3959088547/117) as
// directUrl when the channel is private and no CDN URL exists.
// getModalVideoSource returned that page as a playable 'video' source
// and the <video> loaded HTML: DEMUXER_ERROR_COULD_NOT_OPEN, readyState
// 0, no duration. Live-proven: the modal video's currentSrc was the
// t.me page, while the TeraBox playback resolve returned a fresh dlink.
//
// Three defects, one fix:
// 1. The shared playable-link picker skipped nothing: a t.me post page
//    counted as a playable directUrl (fixed in videoProviderLinks.js,
//    covered by shared-video-links.test.mjs).
// 2. getModalVideoSource's preferred branch read directUrl verbatim, and
//    its fallback returned type 'video' unconditionally — even for a
//    filemoon /e/ URL, which is an iframe player, not a file.
// 3. The playback-URL resolve effect only ran when terabox was PREFERRED:
//    a TeraBox fallback played the 8h-expired stored dlink. It now
//    resolves for the host the modal actually plays from.
//
// The page wiring is pinned with SOURCE-TEXT assertions, like the 2.19.32
// tests. The shared picker itself is unit-tested live.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const gallery = () => src('../src/pages/GalleryPage.jsx');

function sliceBetween(text, startAnchor, endAnchor) {
  const start = text.indexOf(startAnchor);
  const end = text.indexOf(endAnchor, start);
  assert.ok(start > 0 && end > start, `anchors moved — re-check the slice (${startAnchor.slice(0, 40)}...)`);
  return text.slice(start, end);
}

test('2.19.44 (2026-11-25): the modal skips a t.me post page on the preferred host instead of playing HTML', () => {
  const page = gallery();
  assert.ok(page.includes('isTelegramPostPageUrl,'), 'GalleryPage no longer imports isTelegramPostPageUrl');
  const fn = sliceBetween(page, 'const getModalVideoSource = (item, preferredKey = defaultVideoSource) => {', 'const getModalPlayableSources');
  assert.ok(
    fn.includes('if (isTelegramPostPageUrl(directUrl)) return null;'),
    'the selected-host branch plays directUrl verbatim again — a t.me post page mounts in the <video>',
  );
});

test('2.19.44 (2026-11-25): the modal maps a filemoon /e/ URL to the iframe player, not a <video>', () => {
  const page = gallery();
  const fn = sliceBetween(page, 'const getModalVideoSource = (item, preferredKey = defaultVideoSource) => {', 'const getModalPlayableSources');
  assert.ok(fn.includes("if (isFilemoonHtmlUrl(directUrl)) {"));
  assert.ok(fn.includes("type: 'iframe',"));
  assert.ok(fn.includes("type: 'video',"));
});

test('2.19.44 (2026-11-25): the playback-URL resolve follows the host the modal actually plays from', () => {
  const page = gallery();
  const effect = sliceBetween(page, '// Refresh the playback URL when the modal opens', '// Probe the container of the resolved playback URL');
  assert.ok(
    effect.includes('const modalSource = getModalVideoSource(selectedImage, modalSourceKey);'),
    'the resolve effect reads the preferred host again — a TeraBox pick plays the expired stored dlink',
  );
  assert.ok(effect.includes("effectiveKey !== 'terabox'"));
  assert.ok(!effect.includes("defaultVideoSource !== 'terabox'"), 'the old preferred-only gate is still there');
});

// ------------------------------------------------- 2.19.45: the setting is authoritative ---
//
// The 2.19.44 fix fell back to the next host when the preferred one was
// unplayable — and the user asked why the modal played filemoon when
// terabox was selected (2.19.45, 2026-11-25 07:42): the fallback had
// served him a dead filemoon's 404 for a file TeraBox still holds. Two
// defects behind it:
// 1. The modal silently fell back to another host instead of respecting
//    the setting. Now getModalVideoSource returns the SELECTED host only
//    (the in-modal pick, else the setting); when it has no playable link
//    the modal shows a source picker and the user picks. A <video> that
//    errors swaps to the same picker, naming the failed host.
// 2. The setting itself did not stick: the prefs dropdowns only wrote on
//    Save, so a change without Save was silently dropped — the stored
//    value stayed telegram while the user believed terabox was set. The
//    dropdowns now save the moment they change (local + cloud).

test('2.19.45 (2026-11-25): the modal source is the selected host only — no silent fallback to another host', () => {
  const page = gallery();
  const fn = sliceBetween(page, 'const getModalVideoSource = (item, preferredKey = defaultVideoSource) => {', 'const getModalPlayableSources');
  assert.ok(!fn.includes('getPlayableVideoProviderLink('), 'getModalVideoSource falls back to another host again — the setting must be authoritative');
  assert.ok(fn.includes('if (!preferredLink) return null;'));
});

test('2.19.45 (2026-11-25): a video with no playable link on the selected host shows the source picker', () => {
  const page = gallery();
  assert.ok(page.includes('const renderModalSourcePicker = (item, { isModalAnimating, failed }) => {'));
  assert.ok(
    page.includes("if (getMediaItemKind(modalImage) === 'video' && (modalMediaFailed || !getModalVideoSource(modalImage, modalSourceKey))) {"),
    'the picker branch is gone — an unplayable selection falls through to a black player again',
  );
  assert.ok(page.includes('renderModalSourcePicker(modalImage, { isModalAnimating, failed: modalMediaFailed })'));
  assert.ok(page.includes('Play from {source.sourceLabel}'));
});

test('2.19.45 (2026-11-25): a <video> that errors swaps to the picker naming the failed host', () => {
  const page = gallery();
  assert.ok(page.includes('onError={() => modalVideoSource && setModalMediaFailed({ sourceKey: modalVideoSource.sourceKey, sourceLabel: modalVideoSource.sourceLabel })}'));
  assert.ok(page.includes('`${failed.sourceLabel} failed to load this video`'));
});

test('2.19.45 (2026-11-25): a playing player names its host and offers the other hosts as switches', () => {
  const page = gallery();
  assert.ok(page.includes('const renderModalSourceSwitcher = (item, currentSource) => {'));
  assert.ok(page.includes('Playing from {currentSource.sourceLabel}'));
  assert.ok(page.includes('renderModalSourceSwitcher(modalImage, modalVideoSource)'));
  assert.ok(page.includes('renderModalSourceSwitcher(modalImage, embedSource)'));
});

test('2.19.45 (2026-11-25): terabox playback waits for the fresh dlink instead of mounting the expired stored one', () => {
  const page = gallery();
  assert.ok(page.includes("if (modalVideoSource?.sourceKey === 'terabox' && modalPlaybackPending) {"));
  assert.ok(page.includes('setModalPlaybackPending(true);'));
  assert.ok(page.includes('Resolving playback URL...'));
});

test('2.19.45 (2026-11-25): the prefs source dropdowns save the moment they change, local and cloud', () => {
  const settings = src('../src/pages/SettingsPage.jsx');
  assert.ok(settings.includes('const saveSourcePref = useCallback(async (field, setter, cloudKey, value) => {'));
  assert.ok(settings.includes("saveSourcePref('videoSrc', setDefaultVideoSource, 'defaultVideoSource', e.target.value)"));
  assert.ok(settings.includes("saveSourcePref('gallerySrc', setDefaultGallerySource, 'defaultGallerySource', e.target.value)"));
  assert.ok(settings.includes("saveSourcePref('threeDSrc', setDefault3DSource, 'default3DSource', e.target.value)"));
  assert.ok(settings.includes('await sm.saveUserSettings({ [cloudKey]: value });'), 'the immediate save skips the cloud copy — the next visit would overwrite the choice back');
});
