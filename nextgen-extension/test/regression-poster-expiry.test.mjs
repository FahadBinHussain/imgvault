// Regression tests mined from the ImgVault bug history (AGENTS.md).
// Area: gallery video posters expiring after 7 days (2.19.42).
//
// User report (2026-11-24 22:10, with screenshot): every video card from
// 11/9-11/10 showed the browser's broken-image icon. The poster chain is:
// CachedImg -> getThumbUrl(poster-<id>, stored thumb URL) -> local
// IndexedDB blob first, else fetch the stored remote URL. Two defects
// combined into the breakage:
//
// 1. getCachedThumb expired EVERYTHING after 7 days (MAX_AGE_MS), including
//    the poster snapshots captured at upload time — but a poster is a frame
//    of an immutable video, it never goes stale. The 11/9-11/10 posters
//    expired 11/16-11/17; their blobs were still sitting in IndexedDB
//    (33 expired poster rows, verified live), only the age gate hid them.
// 2. The fallback remote URL was a TeraBox thumb URL from upload time —
//    signed, expires=8h. Fetching it two weeks later answered 403, so the
//    <img> errored. And the video card's poster onError just marked the
//    card loaded (handleImageLoad without failed=true), so the broken icon
//    stayed on screen forever with no fallback tile.
//
// The fix: snapshot keys (poster-, img-, scene-) keep their cached blob
// for a year (same as vault previews), and a dead poster marks the card
// failed so it falls through to the Video-icon tile instead of showing a
// broken image. Lifting the expiry revives the 33 expired posters with no
// re-fetch and no migration — their blobs are still in the store.
//
// Link previews keep the 7-day default: a page's og:image can change, and
// the 2.19.38 self-heal re-scrapes on failure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getThumbMaxAgeMs } from '../src/utils/thumbCache.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const DAY_MS = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------- key ages ---

test('2.19.42 (2026-11-24): snapshot keys keep their blob a year — a poster is a frame of an immutable video', () => {
  assert.equal(getThumbMaxAgeMs('poster-09c7f040-0204-47fa-bd0c-8d43b38cd28b'), 365 * DAY_MS);
  assert.equal(getThumbMaxAgeMs('img-abc123'), 365 * DAY_MS);
  assert.equal(getThumbMaxAgeMs('scene-abc123-xyz'), 365 * DAY_MS);
});

test('2.19.42 (2026-11-24): link previews keep the 7-day default — a page og:image can change', () => {
  assert.equal(getThumbMaxAgeMs('link-abc123'), 7 * DAY_MS);
  assert.equal(getThumbMaxAgeMs('something-else'), 7 * DAY_MS);
  assert.equal(getThumbMaxAgeMs(''), 7 * DAY_MS);
  assert.equal(getThumbMaxAgeMs(null), 7 * DAY_MS);
  assert.equal(getThumbMaxAgeMs(undefined), 7 * DAY_MS);
});

test('2.19.42 (2026-11-24): getThumbUrl reads with the key-scoped age, not the 7-day default', () => {
  const thumb = src('../src/utils/thumbCache.js');
  assert.ok(thumb.includes('const SNAPSHOT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;'));
  assert.ok(thumb.includes('await getCachedThumb(key, getThumbMaxAgeMs(key))'));
  // the 7-day default still exists for non-snapshot keys
  assert.ok(thumb.includes('const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;'));
  assert.ok(!thumb.includes('await getCachedThumb(key);'), 'getThumbUrl still reads with the bare 7-day default — posters expire again');
});

// ------------------------------------------------- video card fallback ---

test('2.19.42 (2026-11-24): a dead video poster falls to the icon tile, never a broken image', () => {
  const gallery = src('../src/pages/GalleryPage.jsx');
  // slice the grid video-card branch: from the poster URL lookup to the
  // image branch that follows it.
  const start = gallery.indexOf('const videoPosterUrl = getVideoPosterUrl(img);');
  const end = gallery.indexOf('thumbKey={`img-${img.id}`}');
  assert.ok(start > 0 && end > start, 'video card branch anchors moved — re-check the slice');
  const branch = gallery.slice(start, end);

  // the poster render is gated on the failed flag ...
  assert.ok(branch.includes('const posterFailed = failedImages.has(img.id);'));
  assert.ok(branch.includes('return videoPosterUrl && !posterFailed ? ('));
  // ... the poster error marks the card failed (exactly once in this branch:
  // the CachedVideo error below it only marks loaded) ...
  const failedMarks = branch.split('handleImageLoad(img.id, true)').length - 1;
  assert.equal(failedMarks, 1, `expected exactly one failed mark (the poster onError), found ${failedMarks}`);
  // ... and a failed poster skips the direct-URL video too (a stored
  // TeraBox dlink is just as expired as the thumb URL) ...
  assert.ok(branch.includes('videoDirectUrl && !isFilemoonHtml && !posterFailed ? ('));
  // ... landing on the Video-icon tile with its Open-video link.
  assert.ok(branch.includes('Open video'));
});
