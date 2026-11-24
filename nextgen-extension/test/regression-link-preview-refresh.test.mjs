// Regression tests mined from the ImgVault bug history (AGENTS.md).
// Area: self-healing link previews (2.19.38).
//
// User rejection (2026-11-24 10:42): the 6 preview URLs refreshed BY HAND
// that morning were not a fix — the mechanism has to work for ALL links,
// now and in the future, with no manual rework. So previews are now
// (1) CACHED locally on first load (vault grid + modal switched to the
// gallery's CachedImg/blob-cache pattern, so a preview that ever loaded
// survives its source URL dying) and (2) SELF-HEALING: when a preview img
// errors and no cached copy exists, the UI dispatches ONE background
// refresh for that item — the worker re-fetches the page, runs the SAME
// save-time extractor, and either stores the fresh URL or records a
// 7-day retry timestamp. Failure-triggered only, never bulk.
//
// Live tests cover the extracted seam (utils/linkPreviewRefresh.js). The
// page + worker wiring is pinned with SOURCE-TEXT assertions, like the
// 2.19.32 / 2.19.37 tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { removeFailedPreviewId } from '../src/utils/linkPreview.js';
import {
  LINK_PREVIEW_RETRY_EXTRA_KEY,
  LINK_PREVIEW_RETRY_MS,
  dispatchLinkPreviewRefresh,
  getLinkPreviewRetryAt,
  isLinkPreviewRefreshGated,
  linkPreviewThumbKey,
  planLinkPreviewRefresh,
  resetLinkPreviewRefreshClaims,
  tryClaimLinkPreviewRefresh,
  withLinkPreviewRetryGate,
  withLinkPreviewUrl,
} from '../src/utils/linkPreviewRefresh.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const vault = () => src('../src/pages/VaultPage.jsx');
const gallery = () => src('../src/pages/GalleryPage.jsx');
const background = () => src('../src/background/background.js');

const NOW = 1_800_000_000_000;

// ----------------------------------------------------------------- retry gate ---

test('2.19.38 (2026-11-24): the retry timestamp reads extraMetadata first, falls back to the top-level mirror', () => {
  const item = {
    [LINK_PREVIEW_RETRY_EXTRA_KEY]: NOW + 1000,
    extraMetadata: { [LINK_PREVIEW_RETRY_EXTRA_KEY]: NOW + 2000 },
  };
  assert.equal(getLinkPreviewRetryAt(item), NOW + 2000, 'extraMetadata must win over the stale mirror');
  assert.equal(getLinkPreviewRetryAt({ [LINK_PREVIEW_RETRY_EXTRA_KEY]: NOW + 1000 }), NOW + 1000);
  assert.equal(getLinkPreviewRetryAt({}), null);
  assert.equal(getLinkPreviewRetryAt(null), null);
  assert.equal(getLinkPreviewRetryAt({ extraMetadata: { [LINK_PREVIEW_RETRY_EXTRA_KEY]: 'soon' } }), null, 'a non-number timestamp is not a gate');
  assert.equal(getLinkPreviewRetryAt({ extraMetadata: { [LINK_PREVIEW_RETRY_EXTRA_KEY]: Number.NaN } }), null);
});

test('2.19.38 (2026-11-24): the gate blocks a future timestamp and opens once it passes', () => {
  assert.equal(isLinkPreviewRefreshGated({ extraMetadata: { [LINK_PREVIEW_RETRY_EXTRA_KEY]: NOW + 1 } }, NOW), true);
  assert.equal(isLinkPreviewRefreshGated({ extraMetadata: { [LINK_PREVIEW_RETRY_EXTRA_KEY]: NOW } }, NOW), false, 'an expired timestamp must not gate');
  assert.equal(isLinkPreviewRefreshGated({ extraMetadata: { [LINK_PREVIEW_RETRY_EXTRA_KEY]: NOW - 1 } }, NOW), false);
  assert.equal(isLinkPreviewRefreshGated({}, NOW), false);
  assert.equal(LINK_PREVIEW_RETRY_MS, 7 * 24 * 60 * 60 * 1000, 'the retry window is 7 days');
});

// ----------------------------------------------------------------- refresh plan ---

test('2.19.38 (2026-11-24): the inscript domain-change shape heals — old URL dead, fresh og:image on a new domain', () => {
  const item = {
    id: '4e5b7cf5',
    linkPreviewImageUrl: 'https://ins-media.ideadump.in/wp-content/uploads/2022/10/29103415/IMG-20221029-WA0034.jpg',
  };
  const plan = planLinkPreviewRefresh({
    item,
    extractedUrl: 'https://ins-media.inscript.me/wp-content/uploads/2022/10/29103415/IMG-20221029-WA0034.jpg',
    failedUrl: 'https://ins-media.ideadump.in/wp-content/uploads/2022/10/29103415/IMG-20221029-WA0034.jpg',
    now: NOW,
  });
  assert.deepEqual(plan, {
    action: 'update',
    url: 'https://ins-media.inscript.me/wp-content/uploads/2022/10/29103415/IMG-20221029-WA0034.jpg',
  });
});

test('2.19.38 (2026-11-24): a page with no usable image gates the item for 7 days and stores no URL', () => {
  const plan = planLinkPreviewRefresh({ item: { id: '6d1346f2' }, extractedUrl: '', failedUrl: '', now: NOW });
  assert.equal(plan.action, 'gate');
  assert.equal(plan.reason, 'no-image');
  assert.equal(plan.retryAt, NOW + LINK_PREVIEW_RETRY_MS);
  assert.ok(!('url' in plan), 'a no-image verdict must not carry a URL to store');
});

test('2.19.38 (2026-11-24): a URL the refresh just proved dead is never stored — same-as-stored gates instead', () => {
  const item = { id: 'x', linkPreviewImageUrl: 'https://xossipy.com/themes/sharepoint/logo.png' };
  // the page still serves the dead URL as its og:image
  const byFailed = planLinkPreviewRefresh({
    item,
    extractedUrl: 'https://xossipy.com/themes/sharepoint/logo.png',
    failedUrl: 'https://xossipy.com/themes/sharepoint/logo.png',
    now: NOW,
  });
  assert.equal(byFailed.action, 'gate');
  assert.equal(byFailed.reason, 'same-as-stored');
  // ...and the stored-URL comparison catches it even when the rendered
  // preview came from a different chain field (gallery's sourceImageUrl)
  const byStored = planLinkPreviewRefresh({
    item,
    extractedUrl: 'https://xossipy.com/themes/sharepoint/logo.png',
    failedUrl: 'https://cdn.example.com/other.jpg',
    now: NOW,
  });
  assert.equal(byStored.action, 'gate');
  assert.equal(byStored.reason, 'same-as-stored');
});

// ----------------------------------------------------------------- session claim ---

test('2.19.38 (2026-11-24): one refresh dispatch per item per session — the second claim fails', () => {
  resetLinkPreviewRefreshClaims();
  const item = { id: 'claim-1' };
  assert.equal(tryClaimLinkPreviewRefresh(item, NOW), true);
  assert.equal(tryClaimLinkPreviewRefresh(item, NOW), false, 'second dispatch in the same session must be blocked');
  assert.equal(tryClaimLinkPreviewRefresh({ id: 'claim-2' }, NOW), true, 'a different item is unaffected');
  assert.equal(tryClaimLinkPreviewRefresh(null, NOW), false);
  assert.equal(tryClaimLinkPreviewRefresh({}, NOW), false);
  resetLinkPreviewRefreshClaims();
  assert.equal(tryClaimLinkPreviewRefresh(item, NOW), true, 'a fresh session may dispatch again');
  resetLinkPreviewRefreshClaims();
});

test('2.19.38 (2026-11-24): a retry-gated item cannot claim a dispatch at all', () => {
  resetLinkPreviewRefreshClaims();
  const gated = { id: 'gated-1', extraMetadata: { [LINK_PREVIEW_RETRY_EXTRA_KEY]: NOW + 1000 } };
  assert.equal(tryClaimLinkPreviewRefresh(gated, NOW), false);
  const expired = { id: 'gated-2', extraMetadata: { [LINK_PREVIEW_RETRY_EXTRA_KEY]: NOW - 1000 } };
  assert.equal(tryClaimLinkPreviewRefresh(expired, NOW), true);
  resetLinkPreviewRefreshClaims();
});

// ----------------------------------------------------------------- item transforms ---

test('2.19.38 (2026-11-24): withLinkPreviewUrl stores the fresh URL and drops the retry gate from BOTH copies', () => {
  const item = {
    id: 'x',
    linkPreviewImageUrl: 'https://old.example.com/dead.jpg',
    [LINK_PREVIEW_RETRY_EXTRA_KEY]: NOW + 1000,
    extraMetadata: { [LINK_PREVIEW_RETRY_EXTRA_KEY]: NOW + 1000, keepMe: 1 },
  };
  const next = withLinkPreviewUrl(item, 'https://new.example.com/fresh.jpg');
  assert.equal(next.linkPreviewImageUrl, 'https://new.example.com/fresh.jpg');
  assert.ok(!(LINK_PREVIEW_RETRY_EXTRA_KEY in next), 'top-level mirror copy of the gate survived');
  assert.ok(!(LINK_PREVIEW_RETRY_EXTRA_KEY in next.extraMetadata), 'extraMetadata copy of the gate survived');
  assert.equal(next.extraMetadata.keepMe, 1, 'unrelated extraMetadata was dropped');
  assert.equal(item.linkPreviewImageUrl, 'https://old.example.com/dead.jpg', 'input item was mutated');
});

test('2.19.38 (2026-11-24): withLinkPreviewRetryGate sets the gate in extraMetadata only', () => {
  const next = withLinkPreviewRetryGate({ id: 'x', extraMetadata: { keepMe: 1 } }, NOW + 5000);
  assert.equal(next.extraMetadata[LINK_PREVIEW_RETRY_EXTRA_KEY], NOW + 5000);
  assert.equal(next.extraMetadata.keepMe, 1);
  assert.ok(!(LINK_PREVIEW_RETRY_EXTRA_KEY in next), 'the gate must not be written top-level');
});

// ----------------------------------------------------------------- dispatch ---

test('2.19.38 (2026-11-24): dispatch sends once per session and routes updated/gated results to the right callback', async () => {
  resetLinkPreviewRefreshClaims();
  const calls = [];
  const fakeSend = async (action, data) => {
    calls.push({ action, data });
    return { updated: true, linkPreviewImageUrl: 'https://fresh.example.com/a.jpg' };
  };
  let updatedUrl = null;
  let gatedAt = null;
  const item = { id: 'dispatch-1' };
  const res = await dispatchLinkPreviewRefresh({
    item,
    failedUrl: 'https://dead.example.com/a.jpg',
    sendMessage: fakeSend,
    onUpdated: (url) => { updatedUrl = url; },
    onGated: (retryAt) => { gatedAt = retryAt; },
  });
  assert.equal(res.updated, true);
  assert.equal(updatedUrl, 'https://fresh.example.com/a.jpg');
  assert.equal(gatedAt, null);
  assert.deepEqual(calls, [{ action: 'refreshLinkPreview', data: { id: 'dispatch-1', failedUrl: 'https://dead.example.com/a.jpg' } }]);
  // second dispatch in the same session: no send, no callbacks
  const res2 = await dispatchLinkPreviewRefresh({ item, sendMessage: fakeSend, onUpdated: () => { updatedUrl = 'again'; } });
  assert.equal(res2, null);
  assert.equal(calls.length, 1, 'a second dispatch went out in the same session');
  assert.equal(updatedUrl, 'https://fresh.example.com/a.jpg');
  resetLinkPreviewRefreshClaims();
});

test('2.19.38 (2026-11-24): dispatch routes a gated result to onGated and swallows a rejected send', async () => {
  resetLinkPreviewRefreshClaims();
  let gatedAt = null;
  const gated = await dispatchLinkPreviewRefresh({
    item: { id: 'dispatch-2' },
    sendMessage: async () => ({ updated: false, reason: 'no-image', retryAt: NOW + 1000 }),
    onGated: (retryAt) => { gatedAt = retryAt; },
  });
  assert.equal(gated.reason, 'no-image');
  assert.equal(gatedAt, NOW + 1000);
  const failed = await dispatchLinkPreviewRefresh({
    item: { id: 'dispatch-3' },
    sendMessage: async () => { throw new Error('worker gone'); },
    onUpdated: () => { throw new Error('onUpdated must not run on a rejected send'); },
  });
  assert.equal(failed, null);
  resetLinkPreviewRefreshClaims();
});

// ----------------------------------------------------------------- failed-set removal ---

test('2.19.38 (2026-11-24): removeFailedPreviewId removes the id and returns a NEW set — the input is never mutated', () => {
  const prev = new Set(['a', 'b']);
  const next = removeFailedPreviewId(prev, 'a');
  assert.notEqual(next, prev, 'same Set object returned — React state would not re-render');
  assert.deepEqual([...prev].sort(), ['a', 'b'], 'input set was mutated');
  assert.deepEqual([...next], ['b']);
  assert.deepEqual([...removeFailedPreviewId(next, 'zzz')], ['b'], 'removing an absent id changed the set');
});

// ----------------------------------------------------------------- thumb key ---

test('2.19.38 (2026-11-24): every render site caches a link preview under the same thumb key', () => {
  assert.equal(linkPreviewThumbKey('abc'), 'link-abc');
});

// ----------------------------------------------------------------- VaultPage wiring ---

test('2.19.38 (2026-11-24): both vault link sites render through CachedImg (blob cache) with the shared thumb key', () => {
  const v = vault();
  assert.ok(v.includes("import { CachedImg } from '../components/CachedThumb';"), 'VaultPage does not import CachedImg');
  assert.ok(v.includes('thumbKey={linkPreviewThumbKey(item.id)} src={linkPreviewImage}'), 'vault GRID link card is not a CachedImg');
  assert.ok(v.includes('thumbKey={linkPreviewThumbKey(item.id)} src={getLinkPreviewImage(item)}'), 'vault MODAL link preview is not a CachedImg');
  // no raw <img> left in either link branch — a raw img never caches
  assert.ok(!v.includes('<img src={linkPreviewImage}'), 'vault grid link card still renders a raw <img>');
  assert.ok(!v.includes('<img src={getLinkPreviewImage(item)}'), 'vault modal link preview still renders a raw <img>');
});

test('2.19.38 (2026-11-24): VaultPage dispatches the refresh only from the link-error handler, never on mount', () => {
  const v = vault();
  const handlerAt = v.indexOf('const handleLinkPreviewError = async (item, failedSrc');
  assert.ok(handlerAt > 0, 'VaultPage link-error handler missing');
  const dispatchAt = v.indexOf('dispatchLinkPreviewRefresh({', handlerAt);
  assert.ok(dispatchAt > handlerAt, 'the refresh is not dispatched from the error handler');
  const nextFn = v.indexOf('const groupItemsByDate', handlerAt);
  assert.ok(dispatchAt < nextFn, 'the dispatch call is not inside handleLinkPreviewError');
  assert.ok(v.includes('await getCachedThumb(thumbKey)'), 'the error handler does not check for a cached copy first');
  assert.ok(v.includes('LINK_PREVIEW_CACHE_RECHECK_MS'), 'the cached-copy re-check window is missing');
  assert.ok(v.includes("failedSrc.startsWith('blob:')"), 'the undecodable-blob branch is missing');
});

// ----------------------------------------------------------------- GalleryPage wiring ---

test('2.19.38 (2026-11-24): the gallery DETAIL MODAL link preview renders through CachedImg too', () => {
  const g = gallery();
  const anchor = g.indexOf('thumbKey={linkPreviewThumbKey(modalImage.id)}');
  assert.ok(anchor > 0, 'gallery modal link preview is not a CachedImg');
  assert.ok(!g.includes('<img\n                      src={linkPreviewImage}'), 'gallery modal link preview still renders a raw <img>');
});

test('2.19.38 (2026-11-24): GalleryPage dispatches the refresh only from its link-error handler and clears the flag after reload', () => {
  const g = gallery();
  const handlerAt = g.indexOf('const handleLinkPreviewError = async (item, failedSrc');
  assert.ok(handlerAt > 0, 'GalleryPage link-error handler missing');
  const dispatchAt = g.indexOf('dispatchLinkPreviewRefresh({', handlerAt);
  assert.ok(dispatchAt > handlerAt, 'the refresh is not dispatched from the error handler');
  const onUpdatedAt = g.indexOf('onUpdated: async (freshUrl) => {', handlerAt);
  assert.ok(onUpdatedAt > handlerAt, 'gallery onUpdated handler missing');
  const reloadAt = g.indexOf('await reload();', onUpdatedAt);
  const clearAt = g.indexOf('next.delete(item.id);', onUpdatedAt);
  assert.ok(reloadAt > 0 && clearAt > reloadAt, 'the failed flag must clear only AFTER reload lands, or the grid re-errors on the stale URL');
});

// ----------------------------------------------------------------- worker wiring ---

test('2.19.38 (2026-11-24): the worker answers refreshLinkPreview, reuses the save-time extractor, and gates in flight', () => {
  const b = background();
  assert.ok(b.includes("case 'refreshLinkPreview':"), 'no refreshLinkPreview message case');
  assert.ok(b.includes('this.refreshLinkPreview(request.data?.id, request.data?.failedUrl)'), 'the case does not call the handler with id + failedUrl');
  assert.ok(b.includes('async refreshLinkPreview(itemId'), 'refreshLinkPreview method missing');
  assert.ok(b.includes('this.extractMetaImageFromHtml(html, finalUrl)'), 'the refresh does not reuse the save-time extractor');
  assert.ok(b.includes('this.linkPreviewRefreshInFlight'), 'the in-flight guard is missing');
  assert.ok(b.includes("reason: 'in-flight'"), 'an in-flight refresh does not report itself');
  assert.ok(b.includes("reason: 'retry-gated'"), 'a gated item does not report itself');
  assert.ok(b.includes('extraMetadataDeletes: [LINK_PREVIEW_RETRY_EXTRA_KEY]'), 'a healed item does not delete its retry gate');
  assert.ok(b.includes("import { LINK_PREVIEW_RETRY_EXTRA_KEY, getLinkPreviewRetryAt, isLinkPreviewRefreshGated, planLinkPreviewRefresh } from '../utils/linkPreviewRefresh.js';"), 'the worker does not import the refresh util');
});
