// node:test suite for packages/shared/zoomEngine.js — the cursor-anchored
// zoom math (google photos gesture semantics). Pure functions, no DOM.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAX_ZOOM_LEVEL,
  KEY_ZOOM_STEP,
  PINCH_ZOOM_DIVISOR,
  WHEEL_ZOOM_STEP,
  WHEEL_ZOOM_THROTTLE_MS,
  ZOOM_GESTURE_TYPE,
  applyZoom,
  clampZoomLevel,
  createZoomState,
  doubleClickZoomLevel,
  fitScale,
  isZoomed,
  pinchZoomAmount,
  wheelZoomAmount,
  zoomFactorToLevel,
  zoomLevelToFactor,
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
    assert.match(zoomed.transform, /^translate3d\(-?\d+(\.\d+)?px, -?\d+(\.\d+)?px, 0\) scale\(\d+(\.\d+)?\)$/);
  });
});

describe('double click', () => {
  test('the first double click zooms one level in, the second returns to fit', () => {
    assert.equal(doubleClickZoomLevel(0), 1);
    assert.equal(doubleClickZoomLevel(1), 0);
  });
});
