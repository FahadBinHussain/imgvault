/**
 * ZoomMinibar — google photos' zoom minibar.
 *
 * When google photos shows a zoomed photo it also shows a small floating
 * panel over it: a miniature of the whole picture with a zoom bar underneath
 * it (the "black thumbnail of the picture ... with the level of zoom bar at
 * the bottom" — google photos community, the scroll-to-zoom thread).
 *
 * This is that panel:
 *
 *   - a miniature of the photo with a rectangle on it showing the part of
 *     the photo that is on screen right now (click or drag it to jump)
 *   - a zoom bar underneath: drag it, or use the - / + buttons, or the arrow
 *     keys when the bar has focus
 *   - the current zoom factor
 *
 * The panel is a sibling of the photo (never a child), so it is never scaled
 * by the zoom transform.
 */
import React, { useCallback, useRef } from 'react';
import {
  zoomLevelFromSliderRatio,
  zoomSliderRatioFromLevel,
  zoomViewportRect,
} from '../shared/zoomEngine.js';

/** The miniature is a square; the photo is letterboxed inside it. */
const MAP_SIZE = 72;

/** The zoom bar moves in half levels, like the wheel. */
const BUTTON_STEP = 0.5;

const clamp01 = (value) => Math.min(Math.max(value, 0), 1);

/** Where the photo sits inside the square miniature (object-contain maths). */
export function zoomMiniMapFrame(naturalSize, size = MAP_SIZE) {
  const width = Number(naturalSize?.width) || 0;
  const height = Number(naturalSize?.height) || 0;
  if (!width || !height) return { left: 0, top: 0, width: size, height: size };
  const fit = Math.min(size / width, size / height);
  const innerWidth = width * fit;
  const innerHeight = height * fit;
  return {
    left: (size - innerWidth) / 2,
    top: (size - innerHeight) / 2,
    width: innerWidth,
    height: innerHeight,
  };
}

export default function ZoomMinibar({
  src,
  zoom,
  naturalSize,
  maxLevel,
  onLevelChange,
  onPanTo,
  onReset,
}) {
  const trackRef = useRef(null);
  const mapRef = useRef(null);
  const draggingRef = useRef(false);

  const viewport = zoomViewportRect(zoom);
  const frame = zoomMiniMapFrame(naturalSize);
  const ratio = zoomSliderRatioFromLevel(zoom?.level, maxLevel);

  const applyLevel = useCallback((level) => {
    if (onLevelChange) onLevelChange(Math.min(Math.max(level, 0), maxLevel));
  }, [onLevelChange, maxLevel]);

  /** Pointer x on the bar -> a zoom level. */
  const levelFromClientX = useCallback((clientX) => {
    const track = trackRef.current;
    if (!track) return null;
    const rect = track.getBoundingClientRect();
    if (!rect.width) return null;
    return zoomLevelFromSliderRatio((clientX - rect.left) / rect.width, maxLevel);
  }, [maxLevel]);

  const handleTrackPointerDown = useCallback((event) => {
    const level = levelFromClientX(event.clientX);
    if (level == null) return;
    event.preventDefault();
    draggingRef.current = true;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) { /* not fatal */ }
    applyLevel(level);
  }, [applyLevel, levelFromClientX]);

  const handleTrackPointerMove = useCallback((event) => {
    if (!draggingRef.current) return;
    const level = levelFromClientX(event.clientX);
    if (level == null) return;
    applyLevel(level);
  }, [applyLevel, levelFromClientX]);

  const endTrackDrag = useCallback((event) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (_) { /* not fatal */ }
  }, []);

  const handleTrackKeyDown = useCallback((event) => {
    const step = event.shiftKey ? 1 : BUTTON_STEP;
    let next = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = (zoom?.level || 0) - step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = (zoom?.level || 0) + step;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = maxLevel;
    else if (event.key === 'Enter' || event.key === ' ') next = 0;
    if (next == null) return;
    event.preventDefault();
    event.stopPropagation();
    applyLevel(next);
  }, [applyLevel, maxLevel, zoom]);

  /** A click on the miniature: jump the photo so that point is in the middle. */
  const panFromClientPoint = useCallback((event) => {
    const map = mapRef.current;
    if (!map || !onPanTo) return;
    const rect = map.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // the miniature is square, the photo is letterboxed inside it
    const u = clamp01((event.clientX - rect.left - frame.left) / frame.width);
    const v = clamp01((event.clientY - rect.top - frame.top) / frame.height);
    onPanTo(u, v);
  }, [frame.height, frame.left, frame.top, frame.width, onPanTo]);

  const handleMapPointerDown = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) { /* not fatal */ }
    panFromClientPoint(event);
  }, [panFromClientPoint]);

  const handleMapPointerMove = useCallback((event) => {
    if (event.buttons === 0) return;
    panFromClientPoint(event);
  }, [panFromClientPoint]);

  const stop = useCallback((event) => {
    // the lightbox closes when the backdrop is clicked — the minibar is not
    // the backdrop
    event.stopPropagation();
  }, []);

  const handleReset = useCallback((event) => {
    event.stopPropagation();
    if (onReset) onReset();
  }, [onReset]);

  return (
    <div
      className="absolute top-3 right-3 z-30 flex select-none flex-col items-center gap-1.5 rounded-xl bg-black/65 p-2 text-white shadow-xl backdrop-blur"
      onClick={stop}
      onPointerDown={stop}
      onDoubleClick={stop}
      onWheel={stop}
      data-testid="zoom-minibar"
    >
      {/* the miniature of the whole photo, with the visible part marked */}
      <div
        ref={mapRef}
        className="relative cursor-crosshair overflow-hidden rounded-md"
        style={{ width: MAP_SIZE, height: MAP_SIZE }}
        onPointerDown={handleMapPointerDown}
        onPointerMove={handleMapPointerMove}
        title="Jump to a spot in the photo"
      >
        <img
          src={src}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-80"
        />
        {viewport && (
          <div
            className="pointer-events-none absolute rounded-[2px] border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.65)]"
            style={{
              left: `${frame.left + viewport.left * frame.width}px`,
              top: `${frame.top + viewport.top * frame.height}px`,
              width: `${Math.max(viewport.width * frame.width, 3)}px`,
              height: `${Math.max(viewport.height * frame.height, 3)}px`,
            }}
          />
        )}
      </div>

      {/* the zoom bar */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={(event) => { event.stopPropagation(); applyLevel((zoom?.level || 0) - BUTTON_STEP); }}
          className="flex h-5 w-5 items-center justify-center rounded-full bg-white/15 text-[13px] leading-none transition-colors hover:bg-white/30"
        >
          &minus;
        </button>
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Zoom level"
          aria-valuemin={0}
          aria-valuemax={maxLevel}
          aria-valuenow={Number((zoom?.level || 0).toFixed(2))}
          aria-valuetext={`${(zoom?.factor || 1).toFixed(1)}x`}
          onKeyDown={handleTrackKeyDown}
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={endTrackDrag}
          onPointerCancel={endTrackDrag}
          className="relative h-1.5 w-16 cursor-pointer rounded-full bg-white/25 outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white/80"
            style={{ width: `${ratio * 100}%` }}
          />
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
            style={{ left: `${ratio * 100}%` }}
          />
        </div>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={(event) => { event.stopPropagation(); applyLevel((zoom?.level || 0) + BUTTON_STEP); }}
          className="flex h-5 w-5 items-center justify-center rounded-full bg-white/15 text-[13px] leading-none transition-colors hover:bg-white/30"
        >
          +
        </button>
      </div>

      <div className="flex items-center gap-1.5 text-[10px] font-semibold tabular-nums">
        <button
          type="button"
          onClick={handleReset}
          title="Reset zoom"
          className="rounded px-1 text-white/90 transition-colors hover:bg-white/15"
        >
          {(zoom?.factor || 1).toFixed(1)}x
        </button>
      </div>
    </div>
  );
}
