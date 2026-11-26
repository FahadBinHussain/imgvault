// Regression tests for the photo-zoom gesture (2.19.47).
// Area: the lightbox zoomed the photo AND scrolled the page behind it.
//
// User report (2026-11-25): "it scrolls in the background of the lightbox,
// stop that". Two real defects behind it, both invisible in a unit test:
//
// 1. REACT DELEGATES `wheel` PASSIVELY. React attaches the delegated
//    `wheel` (and `touchmove`) listener on the root container as a PASSIVE
//    listener, so `preventDefault()` inside onWheel is silently IGNORED —
//    the browser scrolls the gallery behind the photo while the user zooms.
//    The only way to cancel the scroll is a NATIVE, non-passive listener on
//    the image itself. Source-pinned below.
// 2. THE SHARED MODAL DID NOT LOCK THE PAGE. While a modal was open the
//    page behind could still scroll. The shared Modal (packages/ui) now
//    locks `body { overflow: hidden }` while it is open and restores
//    whatever was there before (not blindly cleared).
//
// A third defect found while verifying: the zoomed image defaulted to
// `loading="lazy"`, so a photo opened in a background tab never loaded at
// all (naturalWidth 0, no measurement, no zoom). A modal photo is eager.
//
// These are source pins plus the pure-math pins in
// shared-zoom-engine.test.mjs — the behaviour itself was verified live in
// edge (see AGENTS.md 2.19.47).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const zoomable = src('../../packages/ui/ZoomableImage.jsx');
const modal = src('../../packages/ui/Modal.jsx');
const minibar = src('../../packages/ui/ZoomMinibar.jsx');
const engine = src('../../packages/shared/zoomEngine.js');

test('2.19.47: the wheel listener is native and non-passive, so preventDefault actually cancels the scroll', () => {
  assert.match(zoomable, /addEventListener\('wheel',\s*onWheel,\s*\{\s*passive:\s*false\s*\}\)/);
  assert.match(zoomable, /addEventListener\('touchmove',\s*onTouchMove,\s*\{\s*passive:\s*false\s*\}\)/);
});

test('2.19.47: React\'s delegated wheel prop is NOT used (it would double-zoom and is passive anyway)', () => {
  assert.doesNotMatch(zoomable, /onWheel=\{handleWheel\}/);
  assert.doesNotMatch(zoomable, /onTouchMove=\{handleTouchMove\}/);
});

test('2.19.47: the wheel handler calls preventDefault before it does anything else', () => {
  const handler = zoomable.slice(zoomable.indexOf('const handleWheel'), zoomable.indexOf('const handleDoubleClick'));
  assert.match(handler, /event\.preventDefault\(\)/);
});

test('2.19.47: the shared modal locks the page behind it and restores the previous value', () => {
  assert.match(modal, /body\.style\.overflow\s*=\s*'hidden'/);
  assert.match(modal, /body\.style\.overflow\s*=\s*previousOverflow/);
  assert.match(modal, /body\.style\.paddingRight\s*=\s*previousPaddingRight/);
});

test('2.19.47: a photo in a modal loads eagerly (a lazy image never loads in a background tab)', () => {
  assert.match(zoomable, /loading = 'eager'/);
});

// ---------------------------------------------------------------------------
// 2.19.48: the zoomed photo was BLURRY.
//
// The user report (2026-11-25): "image getting blurry or pixelated when
// zoomed, how the google photos ones stay sharp? or does it depend on the
// photo?".
//
// Root cause (measured live in edge against a ground-truth resample of the
// source file, same crop, same rect, 5120x2880 source in a 1200px box):
//
//   translate3d(...) + will-change:transform  ->  0.67 of the ideal detail
//   translate3d(...), no will-change          ->  0.65-0.76
//   2D translate(...) + scale                  ->  0.79-0.91   <- the fix
//   the scale baked into the layout size       ->  0.80-0.94   (same sharpness,
//                                                    but it moves the layout box)
//
// `translate3d` and `will-change: transform` both PROMOTE the image to its own
// composited layer. A promoted layer is rasterised ONCE, at the size it had
// when it was promoted, and the compositor then MAGNIFIES that frozen bitmap —
// so the photo went soft exactly when it was zoomed in. The 2D transform lets
// the browser re-raster the photo at the zoomed size.
//
// The second half of the answer: past the photo's OWN resolution the browser
// must upscale decoded pixels, so sharpness does depend on the photo — the
// zoom ceiling is now the level where the rendered size reaches the natural
// size.
// ---------------------------------------------------------------------------

test('2.19.48: the zoom transform is 2D — a 3D transform promotes the image and freezes its raster', () => {
  assert.match(zoomable, /`translate\(\$\{\(zoom\.x - origin\.x\)/);
  assert.doesNotMatch(zoomable, /translate3d\(/);
});

test('2.19.48: the image is NOT promoted to a composited layer (will-change: transform freezes the raster)', () => {
  assert.doesNotMatch(zoomable, /willChange:\s*zoomed\s*\?\s*'transform'/);
  assert.doesNotMatch(zoomable, /will-change:\s*transform/);
});

test('2.19.48: the zoom ceiling follows the photo\'s own resolution', () => {
  assert.match(zoomable, /sourceResolutionZoomLevel\(/);
  assert.match(zoomable, /naturalSize/);
  assert.match(zoomable, /devicePixelRatio/);
  assert.match(zoomable, /effectiveMaxLevel/);
});

test('2.19.48: every gesture honours the source-aware ceiling', () => {
  const zoomCalls = zoomable.match(/applyZoom\([^)]*maxLevel: effectiveMaxLevel/g) || [];
  assert.ok(zoomCalls.length >= 4, 'every applyZoom must clamp to effectiveMaxLevel');
  // (2.19.50) the raw ceiling is still allowed in ONE place: the call that
  // computes the source-aware ceiling itself. A gesture must never use it.
  assert.doesNotMatch(zoomable, /applyZoom\([^)]*maxLevel: maxZoomLevel/);
  assert.match(zoomable, /doubleClickZoomLevel\(zoom\.level, 0, effectiveMaxLevel\)/);
});

// ---------------------------------------------------------------------------
// 2.19.49: the zoom MINIBAR.
//
// The user report (2026-11-25): "u missed the minibar which shows in google
// photos, when a image is zoomed, add that to our one as well".
//
// What google photos shows over a zoomed photo (google photos community,
// the scroll-to-zoom thread): "the black thumbnail of the picture appears in
// the top right corner with the level of zoom bar at the bottom". So the
// minibar is a small floating panel with a miniature of the whole photo and
// a zoom bar underneath it.
//
// The minibar is a SIBLING of the photo (a portal into the clipping box, not
// a child of the <img>), otherwise the zoom transform would scale the panel
// along with the picture.
// ---------------------------------------------------------------------------

test('2.19.49: the zoom minibar is rendered over a zoomed photo', () => {
  assert.match(zoomable, /import ZoomMinibar from '\.\/ZoomMinibar\.jsx'/);
  assert.match(zoomable, /showZoomMinibar && zoomed && containerEl/);
});

test('2.19.49: the minibar is a sibling of the photo, so the zoom never scales it', () => {
  assert.match(zoomable, /createPortal\(\s*<ZoomMinibar/);
  // no transform on the panel itself
  assert.doesNotMatch(minibar, /transform:/);
});

test('2.19.49: the minibar has a miniature of the photo and a real zoom bar', () => {
  assert.match(minibar, /zoomViewportRect\(/);
  assert.match(minibar, /role="slider"/);
  assert.match(minibar, /aria-valuemin/);
  assert.match(minibar, /zoomLevelFromSliderRatio\(/);
  assert.match(minibar, /zoomSliderRatioFromLevel\(/);
});

test('2.19.49: the minibar bar follows the photo\'s own resolution ceiling', () => {
  assert.match(zoomable, /maxLevel=\{effectiveMaxLevel\}/);
});

test('2.19.49: clicking the minibar never closes the lightbox', () => {
  assert.match(minibar, /event\.stopPropagation\(\)/);
  assert.match(minibar, /onClick=\{stop\}/);
});

// ---------------------------------------------------------------------------
// 2.19.50: the zoom was DEAD on a photo that has no source headroom.
//
// The user report (2026-11-26): "8dce6039-… zoom not working for this image"
// + "nothing happens when i scroll".
//
// Measured on that item: both hosts serve the file at 1024x671, and the
// lightbox shows it at 1024x671 inside a ~1269px pane — the photo is ALREADY
// at its own pixel size. The source-resolution ceiling therefore computed
// limit = 1024/1024 = 1 -> level ceiling 0 -> every gesture was clamped to
// level 0: no zoom, no badge, no minibar, no feedback at all.
//
// The zoom is now allowed a small UPSCALED_ZOOM_LEVEL on those photos and
// the UI says so: the badge reads "(upscaled)" and the minibar's bar marks
// the upscaled part of the range in amber. The FILE is never touched — the
// zoom is a CSS transform on the decoded image, the paint is bigger and
// softer, the stored file stays byte-identical.
// ---------------------------------------------------------------------------

test('2.19.50: the ceiling comes from the shared helper, so a headless photo still zooms', () => {
  assert.match(zoomable, /effectiveZoomCeiling\(\{/);
  assert.match(engine, /UPSCALED_ZOOM_LEVEL = 1/);
  assert.match(engine, /export function effectiveZoomCeiling/);
});

test('2.19.50: the badge says the photo is upscaled (the file is not changed)', () => {
  assert.match(zoomable, /\(upscaled\)/);
  assert.match(zoomable, /isZoomUpscaled\(/);
});

test('2.19.50: the minibar marks the upscaled part of the zoom range', () => {
  assert.match(minibar, /bg-amber-400/);
  assert.match(minibar, /isZoomUpscaled\(/);
});

test('2.19.50: the zoom is never locked to zero', () => {
  assert.doesNotMatch(engine, /UPSCALED_ZOOM_LEVEL = 0/);
  assert.match(engine, /if \(source > 0\) return Math\.min\(max, source\)/);
  assert.match(engine, /return Math\.min\(max, UPSCALED_ZOOM_LEVEL\)/);
});
