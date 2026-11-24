/**
 * Link-preview display helpers (2.19.37).
 *
 * A stored og:image URL is a hotlink to someone else's server — it rots.
 * Every preview <img> therefore needs an onError fallback to the Link2
 * placeholder, and the preview chain must never serve a 16px favicon as a
 * full-card image (it renders as a blurry smear that looks broken).
 */

/**
 * Pick the preview image for a link item.
 * Chain: linkPreviewImageUrl -> previewImageUrl -> ogImage -> thumbnailUrl.
 * faviconUrl is deliberately NOT in the chain: a 16px favicon stretched
 * over a full card looks broken anyway, and the Link2 placeholder is the
 * honest rendering for a link with no real preview image.
 * @param {Object|null|undefined} item
 * @returns {string} preview URL, or '' when the item has no real preview
 */
export function pickLinkPreviewImage(item) {
  return (
    item?.linkPreviewImageUrl ||
    item?.previewImageUrl ||
    item?.ogImage ||
    item?.thumbnailUrl ||
    ''
  );
}

/**
 * Add an item id to the failed-preview set. Returns a NEW Set (React state
 * must never be mutated in place) and leaves the input untouched.
 * Failures live for the session only — a URL can come back, so nothing is
 * persisted.
 * @param {Set<string>} prevSet
 * @param {string} id
 * @returns {Set<string>}
 */
export function addFailedPreviewId(prevSet, id) {
  const next = new Set(prevSet);
  next.add(id);
  return next;
}

/**
 * @param {Set<string>|null|undefined} failedSet
 * @param {string} id
 * @returns {boolean}
 */
export function hasFailedPreviewId(failedSet, id) {
  return Boolean(failedSet?.has(id));
}

/**
 * Remove an item id from the failed-preview set (a refresh just healed
 * it). Returns a NEW Set and leaves the input untouched.
 * @param {Set<string>} prevSet
 * @param {string} id
 * @returns {Set<string>}
 */
export function removeFailedPreviewId(prevSet, id) {
  const next = new Set(prevSet);
  next.delete(id);
  return next;
}
