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
 * scale  - rendered scale = fitScale * 2^level
 */
export function createZoomState({ containerWidth, containerHeight, imageWidth, imageHeight } = {}) {
  const scale = fitScale(containerWidth, containerHeight, imageWidth, imageHeight);
  const width = (Number(imageWidth) || 0) * scale;
  const height = (Number(imageHeight) || 0) * scale;
  return {
    level: 0,
    scale,
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

  const fit = fitScale(
    current.containerWidth,
    current.containerHeight,
    current.imageWidth,
    current.imageHeight,
  );
  const scale = fit * factor;
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
    transform: `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(5)})`,
  };
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
