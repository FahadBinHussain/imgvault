// node:test suite for packages/shared/zoomEngine.js — the cursor-anchored
// zoom math (google photos gesture semantics). Pure functions, no DOM.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAX_ZOOM_LEVEL,
  KEY_ZOOM_STEP,
  PINCH_ZOOM_DIVISOR,
  UPSCALED_ZOOM_LEVEL,
  WHEEL_ZOOM_STEP,
  WHEEL_ZOOM_THROTTLE_MS,
  ZOOM_GESTURE_TYPE,
  applyZoom,
  clampZoomLevel,
  createZoomState,
  doubleClickZoomLevel,
  effectiveZoomCeiling,
  fitScale,
  isZoomUpscaled,
  isZoomed,
  panZoomState,
  pinchZoomAmount,
  sourceResolutionZoomLevel,
  wheelZoomAmount,
  zoomFactorToLevel,
  zoomLevelFromSliderRatio,
  zoomLevelToFactor,
  zoomPanToImagePoint,
  zoomSliderRatioFromLevel,
  zoomViewportRect,
} from '../../packages/shared/zoomEngine.js';

describe('zoom engine constants', () => {
  test('the google photos constants are pinned', () => {
    assert.equal(WHEEL_ZOOM_STEP, 0.5);
    assert.equal(WHEEL_ZOOM_THROTTLE_MS, 100);
    assert.equal(KEY_ZOOM_STEP, 1);
    assert.equal(PINCH_ZOOM_DIVISOR, 0.25);
    assert.equal(DEFAULT_MAX_ZOOM_LEVEL, 3);
    assert.deepEqual(Object.values(ZOOM_GESTURE_TYPE).sort(), [1, 2, 3, 4]);
  });
});

describe('wheel gesture', () => {
  test('scrolling up zooms in, scrolling down zooms out', () => {
    assert.equal(wheelZoomAmount(0, -100), 0.5);
    assert.equal(wheelZoomAmount(0, 100), -0.5);
  });

  test('a mostly horizontal wheel never zooms', () => {
    assert.equal(wheelZoomAmount(120, 10), 0);
  });

  test('a zero delta never zooms', () => {
    assert.equal(wheelZoomAmount(0, 0), 0);
  });
});

describe('pinch gesture', () => {
  test('the delta is divided by 0.25 * the largest viewport side', () => {
    assert.equal(pinchZoomAmount(100, 800), 100 / (0.25 * 800));
  });

  test('a zero delta or a zero viewport never zooms', () => {
    assert.equal(pinchZoomAmount(0, 800), 0);
    assert.equal(pinchZoomAmount(100, 0), 0);
  });
});

describe('level helpers', () => {
  test('one level doubles the rendered size', () => {
    assert.equal(zoomLevelToFactor(0), 1);
    assert.equal(zoomLevelToFactor(1), 2);
    assert.equal(zoomLevelToFactor(0.5), Math.SQRT2);
  });

  test('factor converts back to level', () => {
    assert.equal(zoomFactorToLevel(2), 1);
    assert.equal(zoomFactorToLevel(1), 0);
  });

  test('the level is clamped into range', () => {
    assert.equal(clampZoomLevel(-3), 0);
    assert.equal(clampZoomLevel(9), DEFAULT_MAX_ZOOM_LEVEL);
    assert.equal(clampZoomLevel(2, 0, 5), 2);
  });
});

describe('fit scale', () => {
  test('the image is contained, never cropped', () => {
    assert.equal(fitScale(400, 400, 200, 100), 2);
    assert.equal(fitScale(400, 400, 800, 400), 0.5);
  });

  test('a zero-sized side gives no scale', () => {
    assert.equal(fitScale(0, 400, 200, 100), 0);
    assert.equal(fitScale(400, 400, 0, 0), 0);
  });
});

describe('initial state', () => {
  test('a fitted image starts centred', () => {
    const state = createZoomState({
      containerWidth: 400,
      containerHeight: 400,
      imageWidth: 200,
      imageHeight: 100,
    });
    assert.equal(state.level, 0);
    assert.equal(state.scale, 2);
    assert.equal(state.x, 0);
    assert.equal(state.y, 100);
    assert.equal(isZoomed(state), false);
  });
});

describe('anchored zoom', () => {
  const base = () => createZoomState({
    containerWidth: 400,
    containerHeight: 400,
    imageWidth: 200,
    imageHeight: 100,
  });

  test('the pixel under the cursor stays under the cursor', () => {
    const state = base();
    const anchor = { x: 200, y: 200 };
    // image-space point under the cursor before the zoom
    const u = (anchor.x - state.x) / state.scale;
    const v = (anchor.y - state.y) / state.scale;

    const zoomed = applyZoom(state, 1, anchor);
    assert.equal(zoomed.level, 1);
    assert.equal(zoomed.scale, 4);
    assert.equal(zoomed.x + zoomed.scale * u, anchor.x);
    assert.equal(zoomed.y + zoomed.scale * v, anchor.y);
  });

  test('without an anchor the container centre is the pivot', () => {
    const state = base();
    const zoomed = applyZoom(state, 1, null);
    assert.equal(zoomed.x, -200);
    assert.equal(zoomed.y, 0);
  });

  test('zooming never leaves a gap on the shorter axis', () => {
    const state = base();
    const zoomed = applyZoom(state, 1, { x: 0, y: 0 });
    // rendered height == container height -> stay centred on that axis
    assert.equal(zoomed.y, 0);
    // rendered width is wider than the container -> clamped to the edge
    assert.equal(zoomed.x, 0);
  });

  test('the level is clamped to the maximum', () => {
    const zoomed = applyZoom(base(), 99, null);
    assert.equal(zoomed.level, DEFAULT_MAX_ZOOM_LEVEL);
  });

  test('the transform string is a translate + scale pair', () => {
    const zoomed = applyZoom(base(), 1, null);
    assert.match(zoomed.transform, /^translate\(-?\d+(\.\d+)?px, -?\d+(\.\d+)?px\) scale\(\d+(\.\d+)?\)$/);
  });
});

describe('the zoom transform is 2D on purpose', () => {
  // A promoted layer (translate3d / will-change:transform) is rasterised once
  // and then magnified by the compositor, which is what made the zoomed photo
  // soft. Measured live 2026-11-25: 0.67 of the ideal detail vs 0.79-0.91
  // for the 2D form. The transform must NOT be a 3D one.
  test('the transform never promotes the image to a composited layer', () => {
    const zoomed = applyZoom(createZoomState({
      containerWidth: 400,
      containerHeight: 400,
      imageWidth: 200,
      imageHeight: 100,
    }), 1, null);
    assert.doesNotMatch(zoomed.transform, /translate3d/);
    assert.doesNotMatch(zoomed.transform, /matrix3d/);
    assert.match(zoomed.transform, /^translate\(/);
  });
});

describe('the source resolution ceiling', () => {
  test('a 5120px source in a 1200px box runs out of detail at about 4.3x', () => {
    const level = sourceResolutionZoomLevel({
      naturalWidth: 5120,
      naturalHeight: 2880,
      baseWidth: 1200,
      baseHeight: 675,
    });
    assert.ok(Math.abs(Math.pow(2, level) - 4.2667) < 0.01);
    assert.ok(level > 2 && level < 2.2);
  });

  test('a smaller photo gets a smaller ceiling — sharpness depends on the photo', () => {
    const big = sourceResolutionZoomLevel({
      naturalWidth: 5120, naturalHeight: 2880, baseWidth: 1200, baseHeight: 675,
    });
    const small = sourceResolutionZoomLevel({
      naturalWidth: 1200, naturalHeight: 675, baseWidth: 1200, baseHeight: 675,
    });
    assert.ok(small < big);
    assert.equal(small, 0); // already at its own resolution -> no headroom
  });

  test('a 2x screen halves the headroom (the raster is in device pixels)', () => {
    const one = sourceResolutionZoomLevel({
      naturalWidth: 5120, naturalHeight: 2880, baseWidth: 1200, baseHeight: 675, devicePixelRatio: 1,
    });
    const two = sourceResolutionZoomLevel({
      naturalWidth: 5120, naturalHeight: 2880, baseWidth: 1200, baseHeight: 675, devicePixelRatio: 2,
    });
    assert.ok(two < one);
    assert.ok(Math.abs(Math.pow(2, two) - Math.pow(2, one) / 2) < 0.01);
  });

  test('an unknown source size never locks the zoom out', () => {
    assert.equal(sourceResolutionZoomLevel({}), DEFAULT_MAX_ZOOM_LEVEL);
    assert.equal(sourceResolutionZoomLevel({
      naturalWidth: 0, naturalHeight: 0, baseWidth: 1200, baseHeight: 675,
    }), DEFAULT_MAX_ZOOM_LEVEL);
  });

  test('the ceiling never exceeds the engine maximum', () => {
    const level = sourceResolutionZoomLevel({
      naturalWidth: 50000, naturalHeight: 50000, baseWidth: 100, baseHeight: 100,
    });
    assert.equal(level, DEFAULT_MAX_ZOOM_LEVEL);
  });
});

describe('double click', () => {
  test('the first double click zooms one level in, the second returns to fit', () => {
    assert.equal(doubleClickZoomLevel(0), 1);
    assert.equal(doubleClickZoomLevel(1), 0);
  });
});

describe('a caller that lays the image out itself', () => {
  // the browser sizes the <img> (max-width / max-height / object-contain),
  // so the base scale is 1 and the layout box must not change
  const laidOut = () => createZoomState({
    containerWidth: 800,
    containerHeight: 600,
    imageWidth: 400,
    imageHeight: 300,
    baseScale: 1,
  });

  test('the base scale is honoured instead of the contain fit', () => {
    const state = laidOut();
    assert.equal(state.scale, 1);
    assert.equal(state.baseScale, 1);
  });

  test('one level doubles the laid out size', () => {
    const zoomed = applyZoom(laidOut(), 1, null);
    assert.equal(zoomed.scale, 2);
    assert.equal(zoomed.imageWidth * zoomed.scale, 800);
  });

  test('the anchor still holds with a laid out base', () => {
    const state = laidOut();
    state.x = 200;
    state.y = 150;
    const anchor = { x: 500, y: 400 };
    const u = (anchor.x - state.x) / state.scale;
    // two levels: the zoomed image is bigger than the box, so there is room
    // to pan and the anchor is not pushed away by the centring clamp
    const zoomed = applyZoom(state, 2, anchor);
    assert.equal(zoomed.x + zoomed.scale * u, anchor.x);
    assert.equal(zoomed.y + zoomed.scale * ((anchor.y - state.y) / state.scale), anchor.y);
  });
});

describe('panning', () => {
  const zoomed = () => applyZoom(
    createZoomState({
      containerWidth: 400,
      containerHeight: 400,
      imageWidth: 200,
      imageHeight: 100,
    }),
    2,
    null,
  );

  test('a drag moves the image', () => {
    const before = zoomed();
    const after = panZoomState(before, -40, -25);
    assert.equal(after.x, before.x - 40);
    assert.equal(after.y, before.y - 25);
  });

  test('the image never drifts off the container', () => {
    const after = panZoomState(zoomed(), 100000, 100000);
    // the image is 4x the fit size, so it may not be pushed past the edge
    assert.ok(after.x <= 0);
    assert.ok(after.y <= 0);
    assert.ok(after.x >= after.containerWidth - after.imageWidth * after.scale);
  });

  test('the transform follows the pan', () => {
    const after = panZoomState(zoomed(), -10, -5);
    assert.match(after.transform, /^translate\(/);
  });
});

// ---------------------------------------------------------------------------
// The zoom minibar (google photos' zoom panel over a zoomed photo).
//
// The minibar draws a miniature of the whole photo with a rectangle on it
// that marks the part of the photo which is on screen, and a bar underneath
// that sets the zoom level. Both need the same geometry the transform uses.
// ---------------------------------------------------------------------------

describe('the zoom minibar viewport rectangle', () => {
  const fitted = () => createZoomState({
    containerWidth: 1000,
    containerHeight: 800,
    imageWidth: 2000,
    imageHeight: 1600,
    baseScale: 1,
  });

  test('at fit the rectangle covers the visible part of the photo', () => {
    const rect = zoomViewportRect(fitted());
    assert.deepEqual(rect, { left: 0.25, top: 0.25, width: 0.5, height: 0.5 });
  });

  test('zooming in halves the rectangle', () => {
    const rect = zoomViewportRect(applyZoom(fitted(), 1, null));
    assert.deepEqual(rect, { left: 0.375, top: 0.375, width: 0.25, height: 0.25 });
  });

  test('the rectangle never leaves the photo', () => {
    const rect = zoomViewportRect(applyZoom(fitted(), 1, { x: 0, y: 0 }));
    assert.ok(rect.left >= 0 && rect.top >= 0);
    assert.ok(rect.left + rect.width <= 1);
    assert.ok(rect.top + rect.height <= 1);
  });

  test('no state, no rectangle', () => {
    assert.equal(zoomViewportRect(null), null);
  });
});

describe('the zoom minibar miniature', () => {
  const fitted = () => createZoomState({
    containerWidth: 1000,
    containerHeight: 800,
    imageWidth: 2000,
    imageHeight: 1600,
    baseScale: 1,
  });

  test('clicking the middle of the miniature keeps the middle of the photo in the middle', () => {
    const zoomed = applyZoom(fitted(), 1, null);
    const after = zoomPanToImagePoint(zoomed, 0.5, 0.5);
    assert.equal(after.x, zoomed.x);
    assert.equal(after.y, zoomed.y);
  });

  test('clicking the top-left of the miniature brings that corner to the edge of the view', () => {
    const zoomed = applyZoom(fitted(), 1, null);
    const after = zoomPanToImagePoint(zoomed, 0, 0);
    assert.equal(after.x, 0);
    assert.equal(after.y, 0);
  });

  test('the photo never drifts off the container', () => {
    const after = zoomPanToImagePoint(applyZoom(fitted(), 1, null), 0.5, 0.5);
    assert.ok(after.x <= 0);
    assert.ok(after.y <= 0);
  });

  test('the transform follows the jump', () => {
    const after = zoomPanToImagePoint(applyZoom(fitted(), 1, null), 0.25, 0.25);
    assert.match(after.transform, /^translate\(/);
  });
});

describe('the zoom minibar bar', () => {
  test('the bar position maps to a zoom level', () => {
    assert.equal(zoomLevelFromSliderRatio(0.5, 3), 1.5);
    assert.equal(zoomLevelFromSliderRatio(0, 3), 0);
    assert.equal(zoomLevelFromSliderRatio(1, 3), 3);
  });

  test('a bar position outside the bar is clamped', () => {
    assert.equal(zoomLevelFromSliderRatio(-2, 3), 0);
    assert.equal(zoomLevelFromSliderRatio(9, 3), 3);
  });

  test('the level maps back to a bar position', () => {
    assert.equal(zoomSliderRatioFromLevel(1.5, 3), 0.5);
    assert.equal(zoomSliderRatioFromLevel(0, 3), 0);
    assert.equal(zoomSliderRatioFromLevel(3, 3), 1);
  });

  test('without a ceiling the bar is at zero', () => {
    assert.equal(zoomSliderRatioFromLevel(2, 0), 0);
    assert.equal(zoomLevelFromSliderRatio(0.5, 0), 0);
  });
});

// ---------------------------------------------------------------------------
// A photo that is shown at (or above) its own pixel size used to have a
// ceiling of ZERO — the zoom was silently dead on exactly those photos.
// ---------------------------------------------------------------------------

describe('the zoom ceiling when the photo has no headroom', () => {
  test('the upscaled allowance is pinned', () => {
    assert.equal(UPSCALED_ZOOM_LEVEL, 1);
  });

  test('an unmeasured photo keeps the caller ceiling', () => {
    assert.equal(effectiveZoomCeiling({ sourceCeiling: null, maxLevel: 3 }), 3);
  });

  test('a photo with headroom stops at its own resolution', () => {
    assert.equal(effectiveZoomCeiling({ sourceCeiling: 2.09, maxLevel: 3 }), 2.09);
    assert.equal(effectiveZoomCeiling({ sourceCeiling: 2.09, maxLevel: 1 }), 1);
  });

  test('a photo with NO headroom still gets a zoom (never a dead gesture)', () => {
    assert.equal(effectiveZoomCeiling({ sourceCeiling: 0, maxLevel: 3 }), UPSCALED_ZOOM_LEVEL);
    assert.ok(UPSCALED_ZOOM_LEVEL > 0, 'the zoom must not be locked to zero');
  });

  test('the upscaled label only shows past the source resolution', () => {
    assert.equal(isZoomUpscaled(0.5, 0), true);
    assert.equal(isZoomUpscaled(0, 0), false);
    assert.equal(isZoomUpscaled(0.5, 2.09), false);
    assert.equal(isZoomUpscaled(2.5, 2.09), true);
    assert.equal(isZoomUpscaled(1, null), false);
  });
});