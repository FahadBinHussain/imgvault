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
  const fn = sliceBetween(page, 'const getModalVideoSource = (item) => {', 'const shouldRenderModalVideoPlayer');
  assert.ok(
    fn.includes('if (!isTelegramPostPageUrl(directUrl)) {'),
    'the preferred branch plays directUrl verbatim again — a t.me post page mounts in the <video>',
  );
});

test('2.19.44 (2026-11-25): the modal fallback maps a filemoon /e/ URL to the iframe player, not a <video>', () => {
  const page = gallery();
  const fn = sliceBetween(page, 'const getModalVideoSource = (item) => {', 'const shouldRenderModalVideoPlayer');
  const playableAt = fn.indexOf("const playable = getPlayableVideoProviderLink(item, defaultVideoSource, 'directUrl');");
  assert.ok(playableAt > 0, 'the fallback lookup moved — re-check the slice');
  const fallback = fn.slice(playableAt);
  assert.ok(fallback.includes("if (isFilemoonHtmlUrl(playable.url)) {"));
  assert.ok(fallback.includes("type: 'iframe',"));
  assert.ok(fallback.includes("type: 'video',"));
});

test('2.19.44 (2026-11-25): the playback-URL resolve follows the host the modal actually plays from', () => {
  const page = gallery();
  const effect = sliceBetween(page, '// Refresh the playback URL when the modal opens', '// Probe the container of the resolved playback URL');
  assert.ok(
    effect.includes('const modalSource = getModalVideoSource(selectedImage);'),
    'the resolve effect reads the preferred host again — a TeraBox fallback plays the expired stored dlink',
  );
  assert.ok(effect.includes("effectiveKey !== 'terabox'"));
  assert.ok(!effect.includes("defaultVideoSource !== 'terabox'"), 'the old preferred-only gate is still there');
});
