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
