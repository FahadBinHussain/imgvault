/**
 * Self-healing link previews (2.19.38).
 *
 * A stored og:image URL is a hotlink to someone else's server — it rots
 * (2.19.37: 5 xossipy threads pointing at a 404 logo.png, 1 inscript
 * article whose image domain changed). Hand-refreshing preview URLs does
 * not scale — the user rejected that on 2026-11-24 — so the fix is
 * automatic, in two layers:
 *
 *   1. CACHE: link previews render through CachedImg (blob cache in
 *      IndexedDB), so a preview that loaded once keeps showing even after
 *      its source URL dies.
 *   2. SELF-HEAL: when a preview img errors and no cached copy exists, the
 *      UI dispatches ONE background refresh for that item. The service
 *      worker re-fetches the item's page, runs the SAME save-time
 *      extractor (extractMetaImageFromHtml — never a second parser), and
 *      either stores the fresh URL or records a retry timestamp.
 *
 * Guardrails (all load-bearing, all tested):
 *   - failure-triggered ONLY: nothing runs on vault/gallery open, no bulk
 *     refresh — 20 pages are never fetched at once.
 *   - at most ONE refresh dispatch per item per session (module-level
 *     claim set, below) and at most one in flight per item (the worker's
 *     in-flight set).
 *   - a page with no usable image sets `extraMetadata.linkPreviewRetryAt`
 *     (now + 7 days) and the item is NOT re-scraped until it passes.
 *   - a URL the refresh just proved dead is never stored: when the fresh
 *     extraction returns the same URL that failed (or the stored one),
 *     the item is gated instead of re-written.
 *   - a page FETCH failure (site down, non-2xx) is not a no-image
 *     verdict: nothing is written and no gate is set, so the item can
 *     re-scrape next session.
 *
 * The 2.19.37 placeholder stays as the safety net underneath all of this:
 * an item that can never have a preview (e.g. the blogspot item 6d1346f2,
 * whose page has no og:image at all) shows the clean Link2 placeholder.
 */

/** How long a no-image verdict suppresses re-scraping for one item. */
export const LINK_PREVIEW_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

/** extraMetadata key holding the retry timestamp (epoch ms). */
export const LINK_PREVIEW_RETRY_EXTRA_KEY = 'linkPreviewRetryAt';

/**
 * How long the UI waits after skipping a failure because a cached copy
 * exists, before re-checking whether the blob survived. getThumbUrl
 * prunes a corrupt cached blob and falls back to the (dead) remote URL —
 * without the re-check the card would sit on a broken icon with the
 * failed flag never set. 3s covers getThumbUrl's 3s blob-alive probe.
 */
export const LINK_PREVIEW_CACHE_RECHECK_MS = 3000;

/** The thumb-cache key for a link item's preview (shared by all 4 sites). */
export function linkPreviewThumbKey(id) {
  return `link-${id}`;
}

/**
 * Read the retry timestamp for an item. extraMetadata wins; the top-level
 * mirror is the fallback (fromNeonMediaRow mirrors every extra key
 * top-level — the hostUnsupported read pattern).
 * @param {Object|null|undefined} item
 * @returns {number|null} epoch ms, or null when no valid timestamp exists
 */
export function getLinkPreviewRetryAt(item) {
  const raw = item?.extraMetadata?.[LINK_PREVIEW_RETRY_EXTRA_KEY] ?? item?.[LINK_PREVIEW_RETRY_EXTRA_KEY];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * Is this item inside its retry window — i.e. must it NOT be re-scraped yet?
 * @param {Object|null|undefined} item
 * @param {number} [now] - epoch ms (injectable for tests)
 * @returns {boolean}
 */
export function isLinkPreviewRefreshGated(item, now = Date.now()) {
  const retryAt = getLinkPreviewRetryAt(item);
  return retryAt !== null && retryAt > now;
}

// ---------------------------------------------------------------- session guard ---

// Item ids already dispatched for a refresh in this page session. A URL can
// come back, so nothing is persisted — a fresh mount may dispatch again,
// subject to the stored retry gate.
const claimedRefreshIds = new Set();

/**
 * Claim this item's one refresh dispatch for the session. Returns false
 * when the item is retry-gated or already claimed — the caller must not
 * dispatch. Returns true and records the claim otherwise.
 * @param {Object|null|undefined} item
 * @param {number} [now] - epoch ms (injectable for tests)
 * @returns {boolean}
 */
export function tryClaimLinkPreviewRefresh(item, now = Date.now()) {
  if (!item?.id) return false;
  if (isLinkPreviewRefreshGated(item, now)) return false;
  if (claimedRefreshIds.has(item.id)) return false;
  claimedRefreshIds.add(item.id);
  return true;
}

/** Test-only escape hatch: clear the session claim set. */
export function resetLinkPreviewRefreshClaims() {
  claimedRefreshIds.clear();
}

// ---------------------------------------------------------------- refresh plan ---

/**
 * Decide what a re-scrape result means for an item. Pure — no I/O.
 *
 *   extractedUrl empty                    -> gate (page has no usable image)
 *   extractedUrl === failedUrl            -> gate (the page still serves the
 *                                            URL that just proved dead)
 *   extractedUrl === linkPreviewImageUrl  -> gate (writing it would be a
 *                                            no-op re-store of a dead URL)
 *   otherwise                             -> update (store the fresh URL)
 *
 * @param {Object} args
 * @param {Object} args.item - the item as stored
 * @param {string} args.extractedUrl - what the extractor found (' ' when none)
 * @param {string} [args.failedUrl] - the preview URL that just failed to load
 * @param {number} [args.now] - epoch ms (injectable for tests)
 * @returns {{ action: 'update', url: string } | { action: 'gate', retryAt: number, reason: string }}
 */
export function planLinkPreviewRefresh({ item, extractedUrl = '', failedUrl = '', now = Date.now() } = {}) {
  const fresh = String(extractedUrl || '').trim();
  const failed = String(failedUrl || '').trim();
  const stored = String(item?.linkPreviewImageUrl || '').trim();
  const retryAt = now + LINK_PREVIEW_RETRY_MS;
  if (!fresh) {
    return { action: 'gate', retryAt, reason: 'no-image' };
  }
  if ((failed && fresh === failed) || (stored && fresh === stored)) {
    return { action: 'gate', retryAt, reason: 'same-as-stored' };
  }
  return { action: 'update', url: fresh };
}

// ---------------------------------------------------------------- item transforms ---

/**
 * Return a NEW item with the fresh preview URL and the retry gate REMOVED
 * (from extraMetadata AND the top-level mirror — removing it from only
 * one side resurrects it from the other, the pendingUpload lesson).
 * The worker achieves the same stored result via
 * updateImage's `extraMetadataDeletes`; this is the UI-side mirror for
 * local state, so the re-rendered card is not still gated.
 * @param {Object} item
 * @param {string} url - fresh preview URL
 * @returns {Object}
 */
export function withLinkPreviewUrl(item, url) {
  const { [LINK_PREVIEW_RETRY_EXTRA_KEY]: _droppedExtra, ...restExtra } = item?.extraMetadata || {};
  const { [LINK_PREVIEW_RETRY_EXTRA_KEY]: _droppedTop, ...rest } = item || {};
  return { ...rest, linkPreviewImageUrl: url, extraMetadata: restExtra };
}

/**
 * Return a NEW item with the retry gate set (extraMetadata only — writes
 * go through extraMetadata, the mirror is read-only for us).
 * @param {Object} item
 * @param {number} retryAt - epoch ms
 * @returns {Object}
 */
export function withLinkPreviewRetryGate(item, retryAt) {
  return {
    ...item,
    extraMetadata: { ...(item?.extraMetadata || {}), [LINK_PREVIEW_RETRY_EXTRA_KEY]: retryAt },
  };
}

// ---------------------------------------------------------------- dispatch ---

/**
 * Dispatch one background refresh for an item, through the page's
 * sendMessage. Claims the session slot first (returns null without
 * sending when the item is gated or already claimed). The worker's
 * response data is `{ updated, linkPreviewImageUrl?, retryAt?, reason? }`.
 * A rejected send (worker unreachable) returns null — the claim stays
 * spent for this session and the item retries on the next mount.
 *
 * @param {Object} args
 * @param {Object} args.item
 * @param {string} [args.failedUrl] - the preview URL that just failed
 * @param {Function} args.sendMessage - the page's chrome-message sender
 * @param {Function} [args.onUpdated] - called with the fresh URL on success
 * @param {Function} [args.onGated] - called with retryAt when the worker gated
 * @returns {Promise<Object|null>} the worker's result, or null
 */
export async function dispatchLinkPreviewRefresh({ item, failedUrl = '', sendMessage, onUpdated, onGated } = {}) {
  if (!tryClaimLinkPreviewRefresh(item)) return null;
  let result;
  try {
    result = await sendMessage('refreshLinkPreview', { id: item.id, failedUrl });
  } catch {
    return null;
  }
  if (!result || typeof result !== 'object') return null;
  if (result.updated && typeof result.linkPreviewImageUrl === 'string' && result.linkPreviewImageUrl) {
    onUpdated?.(result.linkPreviewImageUrl);
  } else if (typeof result.retryAt === 'number') {
    onGated?.(result.retryAt);
  }
  return result;
}
