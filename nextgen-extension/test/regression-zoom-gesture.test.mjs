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
  assert.doesNotMatch(zoomable, /maxLevel: maxZoomLevel/);
  assert.match(zoomable, /doubleClickZoomLevel\(zoom\.level, 0, effectiveMaxLevel\)/);
});
