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
 *   enabled                  - turns every gesture off
 *   onZoomChange             - called with the engine state on every change
 *   onLoad / onError         - passed through to the <img>
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DEFAULT_MAX_ZOOM_LEVEL,
  WHEEL_ZOOM_THROTTLE_MS,
  applyZoom,
  createZoomState,
  doubleClickZoomLevel,
  isZoomed,
  panZoomState,
  pinchZoomAmount,
  wheelZoomAmount,
} from '../shared/zoomEngine.js';

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
    publish(applyZoom(current, current.level + amount, anchor, { maxLevel: maxZoomLevel, overscan }));
  }, [enabled, publish, toContainerPoint, maxZoomLevel, overscan]);

  const handleDoubleClick = useCallback((event) => {
    if (!enabled || !zoom) return;
    event.preventDefault();
    const anchor = toContainerPoint(event.clientX, event.clientY);
    const nextLevel = doubleClickZoomLevel(zoom.level, 0, maxZoomLevel);
    publish(applyZoom(zoom, nextLevel, anchor, { maxLevel: maxZoomLevel, overscan }));
  }, [enabled, zoom, publish, toContainerPoint, maxZoomLevel, overscan]);

  const handleKeyDown = useCallback((event) => {
    if (!enabled || !zoom) return;
    const key = event.key;
    if (key !== '+' && key !== '=' && key !== '-' && key !== '_') return;
    event.preventDefault();
    const nextLevel = key === '+' || key === '=' ? zoom.level + 1 : zoom.level - 1;
    publish(applyZoom(zoom, nextLevel, null, { maxLevel: maxZoomLevel, overscan }));
  }, [enabled, zoom, publish, maxZoomLevel, overscan]);

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
    publish(applyZoom(current, current.level + amount, pinch.anchor, { maxLevel: maxZoomLevel, overscan }));
  }, [enabled, publish, maxZoomLevel, overscan]);

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
    publish(applyZoom(zoom, 0, null, { maxLevel: maxZoomLevel, overscan }));
  }, [zoom, publish, maxZoomLevel, overscan]);

  const zoomed = isZoomed(zoom);
  const transform = zoom && origin
    ? `translate3d(${(zoom.x - origin.x).toFixed(2)}px, ${(zoom.y - origin.y).toFixed(2)}px, 0) scale(${zoom.scale.toFixed(5)})`
    : undefined;

  const badge = showZoomBadge && zoomed && containerEl
    ? createPortal(
      <button
        type="button"
        onClick={resetZoom}
        title="Reset zoom"
        className="absolute bottom-3 right-3 z-20 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg backdrop-blur transition-colors hover:bg-black/85"
      >
        {zoom.factor.toFixed(1)}x
      </button>,
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
          willChange: zoomed ? 'transform' : undefined,
          cursor: zoomed ? 'grab' : undefined,
          touchAction: 'pan-y pinch-zoom',
        }}
      />
      {badge}
    </>
  );
}
