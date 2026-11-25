/**
 * zoomEngine — cursor-anchored zoom math for image viewers.
 *
 * The constants and the gesture semantics mirror what google photos actually
 * ships (scraped from its CSS + bundles on 2026-11-25, see the repo
 * AGENTS.md entry "the google photos zoom spec — scraped, not guessed"):
 *
 *   - one gesture layer emits a single `zoom` event: (amount, type, anchor)
 *   - wheel  -> amount = -sign(deltaY) * 0.5, vertical intent only, one event
 *               per 100ms, preventDefault
 *   - double click / double tap -> amount = +1
 *   - keyboard +/- -> amount = ±1
 *   - pinch  -> amount = (distance - previousDistance) / (0.25 * max(vw, vh))
 *   - the zoom LEVEL is a float that doubles the rendered size per step, and
 *     it is clamped to [fit, maxLevel]
 *   - the anchor point (the cursor) stays under the cursor after the change
 *
 * Pure functions only — no DOM, no React. The UI layer owns the event
 * listeners and writes the returned transform.
 */

export const ZOOM_GESTURE_TYPE = {
  WHEEL: 1,
  DOUBLE_CLICK: 2,
  KEYBOARD: 3,
  PINCH: 4,
};

/** google photos: one wheel notch is half a level (level 1 = 2x). */
export const WHEEL_ZOOM_STEP = 0.5;

/** google photos: at most one zoom event per 100ms of wheel input. */
export const WHEEL_ZOOM_THROTTLE_MS = 100;

/** google photos: keyboard +/- moves one full level (2x). */
export const KEY_ZOOM_STEP = 1;

/** google photos: pinch delta is divided by 0.25 * max(viewport size). */
export const PINCH_ZOOM_DIVISOR = 0.25;

/** default ceiling: level 3 = 8x the fit size. */
export const DEFAULT_MAX_ZOOM_LEVEL = 3;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Wheel gesture -> zoom amount.
 * Vertical intent wins: a mostly-horizontal wheel never zooms.
 * Returns 0 when the gesture should be ignored.
 */
export function wheelZoomAmount(deltaX, deltaY) {
  const dx = Number(deltaX) || 0;
  const dy = Number(deltaY) || 0;
  if (Math.abs(dy) < Math.abs(dx)) return 0;
  if (dy === 0) return 0;
  return -Math.sign(dy) * WHEEL_ZOOM_STEP;
}

/**
 * Pinch gesture -> zoom amount.
 * `distanceDelta` is the change in the distance between the two touches.
 */
export function pinchZoomAmount(distanceDelta, viewportMaxSize) {
  const delta = Number(distanceDelta) || 0;
  const viewport = Number(viewportMaxSize) || 0;
  if (delta === 0 || viewport <= 0) return 0;
  return delta / (PINCH_ZOOM_DIVISOR * viewport);
}

/** level -> render factor (level 1 = 2x the fit size). */
export function zoomLevelToFactor(level) {
  return Math.pow(2, Number(level) || 0);
}

/** factor -> level. */
export function zoomFactorToLevel(factor) {
  return Math.log2(Math.max(Number(factor) || 1, Number.EPSILON));
}

/** Clamp a level into the allowed range. */
export function clampZoomLevel(level, minLevel = 0, maxLevel = DEFAULT_MAX_ZOOM_LEVEL) {
  return clamp(Number(level) || 0, minLevel, maxLevel);
}

/**
 * Scale that fits the image inside the container (object-contain behaviour).
 * Returns 0 when either side has no size.
 */
export function fitScale(containerWidth, containerHeight, imageWidth, imageHeight) {
  const cw = Number(containerWidth) || 0;
  const ch = Number(containerHeight) || 0;
  const iw = Number(imageWidth) || 0;
  const ih = Number(imageHeight) || 0;
  if (cw <= 0 || ch <= 0 || iw <= 0 || ih <= 0) return 0;
  return Math.min(cw / iw, ch / ih);
}

/**
 * The state of one zoomed image.
 *
 * level  - zoom level (0 = fit the container)
 * x, y   - top-left of the image, in container pixels
 * scale  - rendered scale = baseScale * 2^level
 *
 * `baseScale` is the scale the image has at level 0. It is normally the
 * contain-fit scale, but a caller that lets the browser lay the image out
 * (CSS max-width/max-height) passes its own baseScale of 1 and keeps the
 * layout box untouched — the transform then works on the laid-out size.
 */
export function createZoomState({
  containerWidth,
  containerHeight,
  imageWidth,
  imageHeight,
  baseScale,
} = {}) {
  const scale = baseScale != null
    ? Number(baseScale)
    : fitScale(containerWidth, containerHeight, imageWidth, imageHeight);
  const width = (Number(imageWidth) || 0) * scale;
  const height = (Number(imageHeight) || 0) * scale;
  return {
    level: 0,
    scale,
    baseScale: scale,
    factor: 1,
    x: (Number(containerWidth) || 0) / 2 - width / 2,
    y: (Number(containerHeight) || 0) / 2 - height / 2,
    containerWidth: Number(containerWidth) || 0,
    containerHeight: Number(containerHeight) || 0,
    imageWidth: Number(imageWidth) || 0,
    imageHeight: Number(imageHeight) || 0,
  };
}

/**
 * Keep the image covering the container: no empty gap on either side.
 * `overscan` allows panning a little past the edge (google photos has a
 * panning margin too).
 */
function clampOffset(offset, containerSize, renderedSize, overscan) {
  const margin = Math.max(0, overscan || 0);
  if (renderedSize <= containerSize - margin * 2) {
    return (containerSize - renderedSize) / 2;
  }
  const min = containerSize - renderedSize - margin;
  const max = margin;
  return clamp(offset, min, max);
}

/**
 * Apply a zoom change and return the new state.
 *
 * anchor - optional {x, y} in container pixels (the cursor). The pixel under
 *          the cursor stays under the cursor. When omitted, the container
 *          centre is the anchor.
 *
 * The returned `transform` is ready for a CSS transform with
 * `transform-origin: 0 0`:
 *   translate3d(x px, y px, 0) scale(scale)
 */
export function applyZoom(state, nextLevel, anchor, options = {}) {
  const {
    minLevel = 0,
    maxLevel = DEFAULT_MAX_ZOOM_LEVEL,
    overscan = 0,
  } = options;

  const current = state || createZoomState();
  const level = clampZoomLevel(nextLevel, minLevel, maxLevel);
  const factor = zoomLevelToFactor(level);
  const prevFactor = zoomLevelToFactor(current.level) || 1;
  const ratio = factor / prevFactor;

  const baseScale = current.baseScale != null
    ? current.baseScale
    : (current.scale || 1) / prevFactor;
  const scale = baseScale * factor;
  const renderedWidth = current.imageWidth * scale;
  const renderedHeight = current.imageHeight * scale;

  const ax = anchor && Number.isFinite(anchor.x)
    ? anchor.x
    : current.containerWidth / 2;
  const ay = anchor && Number.isFinite(anchor.y)
    ? anchor.y
    : current.containerHeight / 2;

  let x = ax - (ax - current.x) * ratio;
  let y = ay - (ay - current.y) * ratio;

  x = clampOffset(x, current.containerWidth, renderedWidth, overscan);
  y = clampOffset(y, current.containerHeight, renderedHeight, overscan);

  return {
    ...current,
    level,
    factor,
    scale,
    x,
    y,
    transform: formatZoomTransform(x, y, scale),
  };
}

/**
 * Move the image by a drag delta, keeping it inside the container.
 * Panning only makes sense while zoomed in — at level 0 the image is
 * centred and there is nothing to pan.
 */
export function panZoomState(state, dx, dy, options = {}) {
  const { overscan = 0 } = options;
  const current = state || createZoomState();
  const prevFactor = zoomLevelToFactor(current.level) || 1;
  const baseScale = current.baseScale != null
    ? current.baseScale
    : (current.scale || 1) / prevFactor;
  const scale = baseScale * prevFactor;
  const renderedWidth = current.imageWidth * scale;
  const renderedHeight = current.imageHeight * scale;
  const x = clampOffset(current.x + (Number(dx) || 0), current.containerWidth, renderedWidth, overscan);
  const y = clampOffset(current.y + (Number(dy) || 0), current.containerHeight, renderedHeight, overscan);
  return {
    ...current,
    scale,
    x,
    y,
    transform: formatZoomTransform(x, y, scale),
  };
}

/**
 * The CSS transform the component writes on the image layer.
 *
 * It is a 2D transform on purpose. `translate3d(...)` (and `will-change:
 * transform`) promote the image to its own composited layer, and a promoted
 * layer is rasterised ONCE at the size it had when it was promoted — a zoom
 * then magnifies that frozen bitmap instead of re-rasterising the photo, so
 * the picture goes soft. Measured live (2026-11-25, edge, a 5120x2880 source
 * in a 1200px box): the promoted 3D form kept only 0.67 of the detail a
 * perfect renderer produces, the 2D form kept 0.79-0.91.
 *
 * A 2D transform lets the browser re-raster the photo at the zoomed size,
 * which is the whole point of zooming.
 */
export function formatZoomTransform(x, y, scale) {
  return `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${scale.toFixed(5)})`;
}

/**
 * The zoom level at which the rendered photo reaches the source resolution.
 *
 * `baseWidth`/`baseHeight` are the size the photo occupies at fit (CSS px),
 * `naturalWidth`/`naturalHeight` the size of the file the browser decoded.
 * Past this level the browser has to upscale decoded pixels, so the picture
 * can only get softer — this is the honest ceiling for THIS photo, and it is
 * why the sharpness depends on the photo (a 5120px source in a 1200px box
 * runs out of detail at ~4.3x, a 2000px source at ~1.7x).
 *
 * `devicePixelRatio` matters: the raster is in DEVICE pixels, so a photo that
 * is already at its natural size on a 2x screen has no headroom at all.
 *
 * Returns DEFAULT_MAX_ZOOM_LEVEL when the source size is unknown (not loaded
 * yet), so an unmeasured image is never locked out of zooming.
 */
export function sourceResolutionZoomLevel({
  naturalWidth,
  naturalHeight,
  baseWidth,
  baseHeight,
  devicePixelRatio = 1,
} = {}) {
  const nw = Number(naturalWidth) || 0;
  const nh = Number(naturalHeight) || 0;
  const bw = Number(baseWidth) || 0;
  const bh = Number(baseHeight) || 0;
  if (!nw || !nh || !bw || !bh) return DEFAULT_MAX_ZOOM_LEVEL;
  const dpr = Number(devicePixelRatio) || 1;
  const limit = Math.min(nw / (bw * dpr), nh / (bh * dpr));
  if (!(limit > 1)) return 0;
  return Math.min(DEFAULT_MAX_ZOOM_LEVEL, zoomFactorToLevel(limit));
}

/**
 * Double click / double tap: google photos zooms one level in, and a second
 * double click on an already zoomed image returns it to fit.
 */
export function doubleClickZoomLevel(currentLevel, minLevel = 0, maxLevel = DEFAULT_MAX_ZOOM_LEVEL) {
  if (currentLevel > minLevel) return minLevel;
  return clampZoomLevel(minLevel + 1, minLevel, maxLevel);
}

/** True when the state is zoomed in (anything above the fit level). */
export function isZoomed(state, minLevel = 0) {
  return Boolean(state) && state.level > minLevel;
}
