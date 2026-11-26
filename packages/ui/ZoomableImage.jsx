/**
 * ZoomableImage — a photo that zooms under the cursor, the way google
 * photos' viewer does.
 *
 * The gesture semantics and the constants come from the shared zoom engine
 * (packages/shared/zoomEngine.js), which was reverse-engineered from google
 * photos' own shipped css + bundles:
 *
 *   wheel          -> -sign(deltaY) * 0.5 zoom levels, one event per 100ms
 *   double click   -> one level in, a second one back to fit
 *   keyboard + / - -> one level
 *   pinch          -> (distance delta) / (0.25 * the largest viewport side)
 *   drag           -> pan, but only while zoomed in
 *
 * The zoom is a pure transform on top of the image's own css layout box —
 * nothing around it moves and no second request is fired.
 *
 * The image must NOT carry transform-based animation classes (a `scale-50`
 * entrance would fight the zoom): put the entrance animation on a wrapper.
 *
 * Props:
 *   src, alt                 - the image
 *   className                - classes for the <img>
 *   containerRef             - ref to the box that clips the image (the
 *                              visible area). Defaults to the img's parent.
 *   maxZoomLevel             - zoom ceiling, 1 level = 2x (default 3 = 8x)
 *   showZoomBadge            - small "2.0x" pill that resets on click
 *   showZoomMinibar          - google photos' zoom minibar over a zoomed
 *                              photo (miniature of the photo + a zoom bar)
 *   enabled                  - turns every gesture off
 *   onZoomChange             - called with the engine state on every change
 *   onLoad / onError         - passed through to the <img>
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DEFAULT_MAX_ZOOM_LEVEL,
  WHEEL_ZOOM_THROTTLE_MS,
  applyZoom,
  createZoomState,
  doubleClickZoomLevel,
  effectiveZoomCeiling,
  isZoomUpscaled,
  isZoomed,
  panZoomState,
  pinchZoomAmount,
  sourceResolutionZoomLevel,
  wheelZoomAmount,
  zoomPanToImagePoint,
} from '../shared/zoomEngine.js';
import ZoomMinibar from './ZoomMinibar.jsx';

const LINE_HEIGHT_PX = 16;

/** Chrome reports wheel deltas in pixels, lines or pages — normalise to px. */
function normalizeWheelDelta(event) {
  const mode = event.deltaMode;
  if (mode === 1) return { x: event.deltaX * LINE_HEIGHT_PX, y: event.deltaY * LINE_HEIGHT_PX };
  if (mode === 2) return { x: event.deltaX * 100, y: event.deltaY * 100 };
  return { x: event.deltaX, y: event.deltaY };
}

export default function ZoomableImage({
  src,
  alt = '',
  className = '',
  containerRef: externalContainerRef,
  maxZoomLevel = DEFAULT_MAX_ZOOM_LEVEL,
  showZoomBadge = true,
  showZoomMinibar = true,
  enabled = true,
  overscan = 0,
  onZoomChange,
  onLoad,
  onError,
  // eager by default: this image is the content of a modal, and a lazy image
  // never loads while the tab is in the background
  loading = 'eager',
  decoding = 'async',
  referrerPolicy,
  draggable = false,
}) {
  const imgRef = useRef(null);
  const lastWheelRef = useRef(0);
  const dragRef = useRef(null);
  const pinchRef = useRef(null);
  const zoomRef = useRef(null);
  const [zoom, setZoom] = useState(null);
  const [origin, setOrigin] = useState(null);
  const [containerEl, setContainerEl] = useState(null);
  // the decoded size of the photo — the ceiling for zooming depends on it
  const [naturalSize, setNaturalSize] = useState(null);

  // the native wheel/touchmove listeners below read the zoom from a ref, so
  // they stay attached while the zoom changes
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  /** The box that clips the photo — the visible area. */
  const resolveContainer = useCallback(() => {
    const external = externalContainerRef?.current;
    if (external) return external;
    return imgRef.current?.parentElement || null;
  }, [externalContainerRef]);

  /**
   * Measure the untransformed image box and the clipping box.
   *
   * The image size comes from the layout box (a transform never changes
   * layout); the position comes from a rect read with the transform cleared,
   * so the measurement is valid whatever the parent layout does.
   */
  const measure = useCallback(() => {
    const img = imgRef.current;
    const container = resolveContainer();
    if (!img || !container) return;

    const previousTransform = img.style.transform;
    if (previousTransform) img.style.transform = 'none';
    const rect = img.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (previousTransform) img.style.transform = previousTransform;

    const width = rect.width;
    const height = rect.height;
    if (!width || !height || !containerRect.width || !containerRect.height) return;

    const state = createZoomState({
      containerWidth: containerRect.width,
      containerHeight: containerRect.height,
      imageWidth: width,
      imageHeight: height,
      baseScale: 1,
    });
    state.x = rect.left - containerRect.left;
    state.y = rect.top - containerRect.top;

    setOrigin({ x: state.x, y: state.y });
    setZoom(state);
  }, [resolveContainer]);

  /**
   * The source-resolution ceiling for THIS photo.
   *
   * null until the photo has been measured (the natural size is unknown).
   * 0 means the photo has NO headroom at all: it is shown at (or above) its
   * own pixel size, so every zoom level would paint more pixels than the
   * file holds.
   */
  const sourceCeiling = useMemo(() => {
    if (!zoom || !naturalSize) return null;
    return sourceResolutionZoomLevel({
      naturalWidth: naturalSize.width,
      naturalHeight: naturalSize.height,
      baseWidth: zoom.imageWidth,
      baseHeight: zoom.imageHeight,
      devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    });
  }, [zoom, naturalSize]);

  /**
   * The zoom ceiling for THIS photo.
   *
   * Zooming past the source resolution forces the browser to upscale decoded
   * pixels, so the picture can only get softer — that is the "it depends on
   * the photo" part of the answer, and it is measurable: a 5120x2880 source
   * in a 1200px box runs out of detail at about 4.3x, a smaller photo much
   * earlier. The cap is the level where the rendered size reaches the
   * natural size, clamped to the caller's own ceiling.
   *
   * THE EXCEPTION: a photo with NO headroom (it is already shown at its own
   * pixel size) would get a ceiling of 0 — the zoom would be silently dead
   * and every gesture would look broken. Those photos get the small
   * UPSCALED_ZOOM_LEVEL allowance instead, and the badge/minibar say
   * "(upscaled)" there, so the paint is bigger but the file is untouched.
   */
  const effectiveMaxLevel = useMemo(
    () => effectiveZoomCeiling({ sourceCeiling, maxLevel: maxZoomLevel }),
    [sourceCeiling, maxZoomLevel],
  );

  // re-measure when the image or the clipping box changes size
  useLayoutEffect(() => {
    measure();
    const img = imgRef.current;
    const container = resolveContainer();
    if (!img || !container || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(img);
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure, resolveContainer, src]);

  // keep the container element around for the badge portal
  useEffect(() => {
    setContainerEl(resolveContainer());
  }, [resolveContainer, src]);

  // a new image starts fitted again
  useEffect(() => {
    measure();
    // a new photo starts with a fresh ceiling
    setNaturalSize(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const publish = useCallback((next) => {
    setZoom(next);
    if (onZoomChange) onZoomChange(next);
  }, [onZoomChange]);

  /** Client coordinates -> container coordinates. */
  const toContainerPoint = useCallback((clientX, clientY) => {
    const container = resolveContainer();
    if (!container) return { x: clientX, y: clientY };
    const rect = container.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, [resolveContainer]);

  const handleWheel = useCallback((event) => {
    if (!enabled) return;
    const current = zoomRef.current;
    if (!current) return;
    event.preventDefault();
    const now = Date.now();
    if (now - lastWheelRef.current < WHEEL_ZOOM_THROTTLE_MS) return;
    const delta = normalizeWheelDelta(event);
    const amount = wheelZoomAmount(delta.x, delta.y);
    if (!amount) return;
    lastWheelRef.current = now;
    const anchor = toContainerPoint(event.clientX, event.clientY);
    publish(applyZoom(current, current.level + amount, anchor, { maxLevel: effectiveMaxLevel, overscan }));
  }, [enabled, publish, toContainerPoint, effectiveMaxLevel, overscan]);

  const handleDoubleClick = useCallback((event) => {
    if (!enabled || !zoom) return;
    event.preventDefault();
    const anchor = toContainerPoint(event.clientX, event.clientY);
    const nextLevel = doubleClickZoomLevel(zoom.level, 0, effectiveMaxLevel);
    publish(applyZoom(zoom, nextLevel, anchor, { maxLevel: effectiveMaxLevel, overscan }));
  }, [enabled, zoom, publish, toContainerPoint, effectiveMaxLevel, overscan]);

  const handleKeyDown = useCallback((event) => {
    if (!enabled || !zoom) return;
    const key = event.key;
    if (key !== '+' && key !== '=' && key !== '-' && key !== '_') return;
    event.preventDefault();
    const nextLevel = key === '+' || key === '=' ? zoom.level + 1 : zoom.level - 1;
    publish(applyZoom(zoom, nextLevel, null, { maxLevel: effectiveMaxLevel, overscan }));
  }, [enabled, zoom, publish, effectiveMaxLevel, overscan]);

  const handlePointerDown = useCallback((event) => {
    if (!enabled || !zoom || !isZoomed(zoom)) return;
    // touch drags are swipes, not pans — the pinch handler owns two fingers
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) { /* not fatal */ }
  }, [enabled, zoom]);

  const handlePointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !zoom) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    publish(panZoomState(zoom, dx, dy, { overscan }));
  }, [zoom, publish, overscan]);

  const endDrag = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (_) { /* not fatal */ }
  }, []);

  const touchDistance = (touches) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = useCallback((event) => {
    if (!enabled) return;
    if (event.touches.length !== 2) return;
    // two fingers = pinch, never a swipe
    event.stopPropagation();
    pinchRef.current = {
      distance: touchDistance(event.touches),
      anchor: toContainerPoint(
        (event.touches[0].clientX + event.touches[1].clientX) / 2,
        (event.touches[0].clientY + event.touches[1].clientY) / 2,
      ),
    };
  }, [enabled, toContainerPoint]);

  const handleTouchMove = useCallback((event) => {
    const pinch = pinchRef.current;
    if (!pinch || !enabled) return;
    const current = zoomRef.current;
    if (event.touches.length !== 2 || !current) return;
    event.stopPropagation();
    event.preventDefault();
    const distance = touchDistance(event.touches);
    const amount = pinchZoomAmount(
      distance - pinch.distance,
      Math.max(window.innerWidth, window.innerHeight),
    );
    pinch.distance = distance;
    if (!amount) return;
    publish(applyZoom(current, current.level + amount, pinch.anchor, { maxLevel: effectiveMaxLevel, overscan }));
  }, [enabled, publish, effectiveMaxLevel, overscan]);

  const handleTouchEnd = useCallback((event) => {
    if (event.touches.length < 2) pinchRef.current = null;
  }, []);

  /**
   * React delegates `wheel` and `touchmove` to the root container with PASSIVE
   * listeners, so `preventDefault()` inside onWheel/onTouchMove is IGNORED —
   * the page behind the photo scrolls while the user zooms. The only way to
   * actually cancel that scroll is a native, non-passive listener on the
   * image itself.
   */
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return undefined;
    const onWheel = (event) => handleWheel(event);
    const onTouchMove = (event) => handleTouchMove(event);
    img.addEventListener('wheel', onWheel, { passive: false });
    img.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      img.removeEventListener('wheel', onWheel);
      img.removeEventListener('touchmove', onTouchMove);
    };
  }, [handleWheel, handleTouchMove, src]);

  const resetZoom = useCallback(() => {
    if (!zoom) return;
    publish(applyZoom(zoom, 0, null, { maxLevel: effectiveMaxLevel, overscan }));
  }, [zoom, publish, effectiveMaxLevel, overscan]);

  const zoomed = isZoomed(zoom);

  /**
   * The transform is 2D on purpose.
   *
   * A 3D transform and the `will-change` hint both PROMOTE the photo to its
   * own composited layer. A promoted layer is rasterised once, at the size it
   * had when it was promoted, and the compositor then MAGNIFIES that frozen
   * bitmap — so the picture goes soft exactly when it is zoomed in.
   *
   * Measured live in edge (2026-11-25) against a ground-truth resample of the
   * source file, a 5120x2880 photo in a 1200px box, same crop, same rect:
   *
   *   3D transform + the promotion hint        ->  0.67 of the ideal detail
   *   3D transform, no promotion hint          ->  0.65-0.76
   *   2D translate + scale                      ->  0.79-0.91   <- shipped here
   *   the scale baked into the layout size     ->  0.80-0.94   (same, but it
   *                                              changes the layout box, so
   *                                              it breaks the surrounding
   *                                              layout)
   *
   * The 2D form keeps the layout box untouched and still lets the browser
   * re-raster the photo at the zoomed size, which is the whole point.
   */
  const transform = zoom && origin
    ? `translate(${(zoom.x - origin.x).toFixed(2)}px, ${(zoom.y - origin.y).toFixed(2)}px) scale(${zoom.scale.toFixed(5)})`
    : undefined;

  // the picture is being painted LARGER than the file's own pixels — the
  // file is untouched, only the on-screen paint is bigger (and softer)
  const isUpscaled = isZoomUpscaled(zoom?.level, sourceCeiling);

  // at the source-resolution ceiling the photo is at 1:1 with its own pixels
  // — zooming further would only upscale, so the zoom stops there
  const atSourceCeiling = Boolean(
    zoom
    && sourceCeiling != null
    && sourceCeiling > 0
    && effectiveMaxLevel < maxZoomLevel
    && zoom.level >= effectiveMaxLevel - 0.001,
  );

  const badge = showZoomBadge && zoomed && containerEl
    ? createPortal(
      <button
        type="button"
        onClick={resetZoom}
        title={isUpscaled
          ? 'Reset zoom (this photo is at its own resolution — zooming enlarges the pixels, it does not add detail)'
          : atSourceCeiling
            ? 'Reset zoom (this photo is at its own resolution)'
            : 'Reset zoom'}
        className="absolute bottom-3 right-3 z-20 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg backdrop-blur transition-colors hover:bg-black/85"
      >
        {zoom.factor.toFixed(1)}x
        {isUpscaled && (
          <span className="ml-1 font-normal text-amber-300">(upscaled)</span>
        )}
        {!isUpscaled && atSourceCeiling && (
          <span className="ml-1 font-normal opacity-70">(max)</span>
        )}
      </button>,
      containerEl,
    )
    : null;

  /**
   * The zoom minibar — google photos shows a small panel over a zoomed
   * photo: a miniature of the whole picture with the visible part marked on
   * it, and a zoom bar underneath. It is a sibling of the photo (never a
   * child), so the zoom transform never scales it.
   */
  const handleMinibarLevel = useCallback((level) => {
    if (!zoom) return;
    publish(applyZoom(zoom, level, null, { maxLevel: effectiveMaxLevel, overscan }));
  }, [zoom, publish, effectiveMaxLevel, overscan]);

  const handleMinibarPan = useCallback((u, v) => {
    if (!zoom) return;
    publish(zoomPanToImagePoint(zoom, u, v, { overscan }));
  }, [zoom, publish, overscan]);

  const minibar = showZoomMinibar && zoomed && containerEl && zoom
    ? createPortal(
      <ZoomMinibar
        src={src}
        zoom={zoom}
        naturalSize={naturalSize}
        maxLevel={effectiveMaxLevel}
        sourceLevel={sourceCeiling}
        onLevelChange={handleMinibarLevel}
        onPanTo={handleMinibarPan}
        onReset={resetZoom}
      />,
      containerEl,
    )
    : null;

  return (
    <>
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={className}
        loading={loading}
        decoding={decoding}
        referrerPolicy={referrerPolicy}
        draggable={draggable}
        tabIndex={enabled ? 0 : -1}
        onLoad={(event) => {
          const img = event.currentTarget;
          if (img && img.naturalWidth) {
            setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
          }
          measure();
          if (onLoad) onLoad(event);
        }}
        onError={onError}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{
          transform,
          transformOrigin: '0 0',
          // NO promotion hint on the image: promoting it to its own composited
          // layer is what made the zoomed picture soft (see the note above).
          cursor: zoomed ? 'grab' : undefined,
          touchAction: 'pan-y pinch-zoom',
        }}
      />
      {badge}
      {minibar}
    </>
  );
}
