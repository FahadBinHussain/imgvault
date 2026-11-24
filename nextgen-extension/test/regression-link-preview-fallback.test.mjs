// Regression tests mined from the ImgVault bug history (AGENTS.md).
// Area: link-preview broken-image fallback (2.19.37).
//
// User report (2026-11-24 10:19, with screenshot): vault LINK cards showed
// the browser's broken-image icon. The stored preview URLs were dead
// hotlinks (5 xossipy threads pointing at a 404 logo.png, 1 inscript
// article on a dead domain — all 6 refreshed by data update the same
// morning), and the link preview <img> tags had NO onError handler
// anywhere: the vault grid card, the vault detail modal, the gallery link
// card, and the gallery detail modal all rendered a bare <img> for a
// present-but-dead URL. When getLinkPreviewImage returns '' all four sites
// already render the clean Link2 placeholder — the bug was only the
// dead-URL case (URL present, load fails).
//
// A second rot symptom in the same screenshot: the blogspot item
// ("এ কি রকম খেলা!", id 6d1346f2) has NO preview URL anywhere — its only
// preview-chain field was faviconUrl, so a 16px favicon rendered
// full-card as a blurry smear. faviconUrl is out of the chain now: that
// item gets the clean placeholder.
//
// Live tests cover the extracted seam (utils/linkPreview.js). The page
// wiring is pinned with SOURCE-TEXT assertions, like the 2.19.32 tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pickLinkPreviewImage, addFailedPreviewId, hasFailedPreviewId } from '../src/utils/linkPreview.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const vault = () => src('../src/pages/VaultPage.jsx');
const gallery = () => src('../src/pages/GalleryPage.jsx');

// ------------------------------------------------------------- preview chain ---

test('2.19.37 (2026-11-24): the preview chain prefers linkPreviewImageUrl, then previewImageUrl, ogImage, thumbnailUrl', () => {
  const full = {
    linkPreviewImageUrl: 'https://x/link.jpg',
    previewImageUrl: 'https://x/preview.jpg',
    ogImage: 'https://x/og.jpg',
    thumbnailUrl: 'https://x/thumb.jpg',
    faviconUrl: 'https://x/favicon.ico',
  };
  assert.equal(pickLinkPreviewImage(full), 'https://x/link.jpg');
  assert.equal(pickLinkPreviewImage({ ...full, linkPreviewImageUrl: '' }), 'https://x/preview.jpg');
  assert.equal(pickLinkPreviewImage({ ...full, linkPreviewImageUrl: '', previewImageUrl: '' }), 'https://x/og.jpg');
  assert.equal(pickLinkPreviewImage({ thumbnailUrl: 'https://x/thumb.jpg' }), 'https://x/thumb.jpg');
});

test('2.19.37 (2026-11-24): a favicon alone is NOT a preview — the blogspot item (faviconUrl only) gets the placeholder', () => {
  assert.equal(
    pickLinkPreviewImage({ faviconUrl: 'https://bn-navelstories.blogspot.com/favicon.ico' }),
    '',
    'faviconUrl leaked back into the preview chain',
  );
  assert.equal(pickLinkPreviewImage({}), '');
  assert.equal(pickLinkPreviewImage(null), '');
  assert.equal(pickLinkPreviewImage(undefined), '');
});

// ------------------------------------------------------------- failed-preview set ---

test('2.19.37 (2026-11-24): addFailedPreviewId adds the id and returns a NEW set — the input is never mutated', () => {
  const prev = new Set(['a']);
  const next = addFailedPreviewId(prev, 'b');
  assert.notEqual(next, prev, 'same Set object returned — React state would not re-render');
  assert.deepEqual([...prev], ['a'], 'input set was mutated');
  assert.deepEqual([...next].sort(), ['a', 'b']);
  assert.deepEqual([...addFailedPreviewId(next, 'b')].sort(), ['a', 'b'], 're-adding the same id changed the set');
});

test('2.19.37 (2026-11-24): hasFailedPreviewId reads the set and tolerates a missing set', () => {
  const set = new Set(['x']);
  assert.equal(hasFailedPreviewId(set, 'x'), true);
  assert.equal(hasFailedPreviewId(set, 'y'), false);
  assert.equal(hasFailedPreviewId(null, 'x'), false);
  assert.equal(hasFailedPreviewId(undefined, 'x'), false);
});

// ------------------------------------------------------------- VaultPage wiring ---

test('2.19.37 (2026-11-24): VaultPage tracks failed link previews in session state and delegates the chain to the util', () => {
  const v = vault();
  assert.ok(v.includes("import { pickLinkPreviewImage, addFailedPreviewId, hasFailedPreviewId, removeFailedPreviewId } from '../utils/linkPreview';"), 'linkPreview util not imported');
  assert.ok(v.includes('const [failedLinkPreviews, setFailedLinkPreviews] = useState(new Set());'), 'failedLinkPreviews state missing');
  assert.ok(v.includes('const getLinkPreviewImage = (item) => pickLinkPreviewImage(item);'), 'getLinkPreviewImage does not delegate to the util');
  assert.ok(!v.includes('faviconUrl'), 'faviconUrl is still referenced in VaultPage — it must not render as a preview');
  assert.ok(v.includes('setFailedLinkPreviews((prev) => addFailedPreviewId(prev, item.id));'), 'error handler does not use the failed-set helper');
});

test('2.19.37 (2026-11-24): the vault GRID link card falls back to the placeholder when its preview img errors', () => {
  const v = vault();
  assert.ok(v.includes('{linkPreviewImage && !hasFailedPreviewId(failedLinkPreviews, item.id) ? ('), 'grid link card does not gate on the failed set');
  assert.ok(v.includes("onError={(e) => handleLinkPreviewError(item, e.currentTarget?.src || '')}"), 'grid link img has no onError fallback');
});

test('2.19.37 (2026-11-24): the vault DETAIL MODAL link preview falls back to the placeholder when its img errors', () => {
  const v = vault();
  assert.ok(v.includes('{getLinkPreviewImage(item) && !hasFailedPreviewId(failedLinkPreviews, item.id) ? ('), 'modal link preview does not gate on the failed set');
  assert.ok(v.includes('onError={(e) => handleLinkPreviewError(item, e.currentTarget?.src || \'\')}'), 'modal link img has no onError fallback');
});

// ------------------------------------------------------------- GalleryPage wiring ---

test('2.19.37 (2026-11-24): the gallery link card falls back to the placeholder when its preview errors', () => {
  const g = gallery();
  assert.ok(g.includes('{linkPreviewImage && !failedImages.has(img.id) ? ('), 'gallery link card does not gate on failedImages');
  const anchor = g.indexOf('thumbKey={linkPreviewThumbKey(img.id)}');
  assert.ok(anchor > 0, 'gallery link CachedImg anchor missing');
  const window = g.slice(anchor, anchor + 700);
  assert.ok(window.includes("onError={(e) => handleLinkPreviewError(img, e.currentTarget?.src || '')}"), 'gallery link CachedImg has no onError fallback');
});

test('2.19.37 (2026-11-24): the gallery DETAIL MODAL link preview falls back to the placeholder when its img errors', () => {
  const g = gallery();
  assert.ok(g.includes('{linkPreviewImage && !failedImages.has(modalImage.id) ? ('), 'gallery modal link preview does not gate on failedImages');
  assert.ok(g.includes("onError={(e) => handleLinkPreviewError(modalImage, e.currentTarget?.src || '')}"), 'gallery modal link img has no onError fallback');
});
