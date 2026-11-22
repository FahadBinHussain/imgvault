// Live tests for the image snapshot extractor (2.19.33): the canvas
// downscale used by the vault image upload-time snapshot AND the vault
// image on-demand derivation — one implementation, one output contract
// (max width 480, JPEG 0.75). Node has no DOM, so createImageBitmap +
// document are stubbed per test and restored afterwards.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureImageSnapshotBlob } from '../src/utils/imageSnapshot.js';

function installDomStubs({ width = 1000, height = 500, bitmapError = null } = {}) {
  const calls = { drawImage: [], toBlob: [], fillRect: [] };
  const fakeCtx = {
    fillStyle: '',
    fillRect(x, y, w, h) { calls.fillRect.push([x, y, w, h]); },
    drawImage(...args) { calls.drawImage.push(args); },
  };
  const fakeCanvas = {
    width: 0,
    height: 0,
    getContext: () => fakeCtx,
    toBlob(cb, type, quality) {
      calls.toBlob.push([type, quality]);
      cb(new Blob([new Uint8Array(100).fill(7)], { type: 'image/jpeg' }));
    },
  };
  const prevBitmap = globalThis.createImageBitmap;
  const prevDocument = globalThis.document;
  globalThis.createImageBitmap = bitmapError
    ? async () => { throw bitmapError; }
    : async () => ({ width, height, close() {} });
  globalThis.document = {
    createElement: (tag) => {
      assert.equal(tag, 'canvas');
      return fakeCanvas;
    },
  };
  return {
    calls,
    fakeCanvas,
    restore() {
      if (prevBitmap === undefined) delete globalThis.createImageBitmap;
      else globalThis.createImageBitmap = prevBitmap;
      if (prevDocument === undefined) delete globalThis.document;
      else globalThis.document = prevDocument;
    },
  };
}

test('2.19.33 (2026-11-22): a 1000x500 image downscales to a 480x240 JPEG at 0.75, on a white ground', async () => {
  const stubs = installDomStubs({ width: 1000, height: 500 });
  try {
    const out = await captureImageSnapshotBlob(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    assert.equal(out.type, 'image/jpeg');
    assert.equal(stubs.fakeCanvas.width, 480);
    assert.equal(stubs.fakeCanvas.height, 240);
    assert.deepEqual(stubs.calls.toBlob, [['image/jpeg', 0.75]]);
    // White ground first (transparent PNG/WebP would come out on black),
    // then the bitmap drawn at the canvas size.
    assert.equal(stubs.calls.fillRect.length, 1);
    assert.deepEqual(stubs.calls.fillRect[0], [0, 0, 480, 240]);
    assert.equal(stubs.calls.drawImage.length, 1);
    assert.deepEqual(stubs.calls.drawImage[0].slice(1), [0, 0, 480, 240]);
  } finally {
    stubs.restore();
  }
});

test('2.19.33 (2026-11-22): a small image is never upscaled', async () => {
  const stubs = installDomStubs({ width: 200, height: 100 });
  try {
    await captureImageSnapshotBlob(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }));
    assert.equal(stubs.fakeCanvas.width, 200);
    assert.equal(stubs.fakeCanvas.height, 100);
  } finally {
    stubs.restore();
  }
});

test('2.19.33 (2026-11-22): an empty blob or a non-Blob throws loudly (never a fake thumbnail)', async () => {
  await assert.rejects(() => captureImageSnapshotBlob(new Blob([])), /non-empty Blob/);
  await assert.rejects(() => captureImageSnapshotBlob('not a blob'), /non-empty Blob/);
  await assert.rejects(() => captureImageSnapshotBlob(null), /non-empty Blob/);
});

test('2.19.33 (2026-11-22): no image decoder in the environment throws loudly instead of hanging', async () => {
  assert.equal(typeof globalThis.createImageBitmap, 'undefined');
  assert.equal(typeof globalThis.Image, 'undefined');
  // document exists here only if a previous test leaked it — it must not.
  assert.equal(typeof globalThis.document, 'undefined');
  await assert.rejects(
    () => captureImageSnapshotBlob(new Blob([new Uint8Array([1])], { type: 'image/png' })),
    /no DOM|no image decoder/,
  );
});

test('2.19.33 (2026-11-22): when createImageBitmap fails, the <img> fallback decodes instead', async () => {
  const stubs = installDomStubs({ bitmapError: new Error('bitmap decode unsupported') });
  const prevImage = globalThis.Image;
  globalThis.Image = class {
    constructor() {
      this.width = 800;
      this.height = 400;
      this.onload = null;
      this.onerror = null;
    }
    set src(_value) {
      setTimeout(() => this.onload && this.onload(), 0);
    }
  };
  try {
    const out = await captureImageSnapshotBlob(new Blob([new Uint8Array([1])], { type: 'image/avif' }));
    assert.equal(out.type, 'image/jpeg');
    assert.equal(stubs.fakeCanvas.width, 480);
    assert.equal(stubs.fakeCanvas.height, 240);
  } finally {
    if (prevImage === undefined) delete globalThis.Image;
    else globalThis.Image = prevImage;
    stubs.restore();
  }
});

test('2.19.33 (2026-11-22): the decode is bounded — a hung decoder times out instead of spinning forever', async () => {
  const src = (await import('node:fs')).readFileSync(
    new URL('../src/utils/imageSnapshot.js', import.meta.url), 'utf8',
  );
  assert.ok(src.includes('const DECODE_TIMEOUT_MS = 15000;'));
  assert.ok(src.includes('withTimeout(createImageBitmap(blob), DECODE_TIMEOUT_MS'));
  assert.ok(src.includes("timed out after ${Math.round(ms / 1000)}s"));
});
