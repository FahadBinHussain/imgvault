// Lightweight image snapshot extractor (at upload time + vault image preview
// derivation). Downscales an image Blob to a compact JPEG thumbnail on a
// canvas — no video element needed, unlike captureVideoSnapshotBlob.
//
// Same output contract as the video preview path (vaultPreview.js): max
// width 480, JPEG quality 0.75, so a snapshot and an on-demand derivation
// produce interchangeable bytes under the same `vault-preview-<id>` key.

const SNAPSHOT_WIDTH = 480;
const SNAPSHOT_QUALITY = 0.75;
const DECODE_TIMEOUT_MS = 15000;

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// Decode via createImageBitmap first (fast, no DOM events; animated GIF
// yields its first frame — fine for a thumbnail). Falls back to an <img>
// element for decoders createImageBitmap does not cover (older AVIF paths).
async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await withTimeout(createImageBitmap(blob), DECODE_TIMEOUT_MS, 'image decode');
    } catch (err) {
      // Fall through to the <img> path — it decodes a wider set than
      // createImageBitmap on some builds. A failure there throws loudly.
      if (typeof Image === 'undefined') throw err;
    }
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('no image decoder available (neither createImageBitmap nor Image)');
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    const loaded = new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image decode failed (<img> error)'));
    });
    img.src = url;
    return await withTimeout(loaded, DECODE_TIMEOUT_MS, 'image decode');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Downscale an image Blob to a small JPEG thumbnail.
 * @param {Blob} imageBlob - The image file (JPEG/PNG/WebP/AVIF/GIF)
 * @param {{ maxWidth?: number, quality?: number }} [options]
 * @returns {Promise<Blob>} JPEG Blob, max width 480 (never upscaled)
 */
export async function captureImageSnapshotBlob(imageBlob, { maxWidth = SNAPSHOT_WIDTH, quality = SNAPSHOT_QUALITY } = {}) {
  if (!(imageBlob instanceof Blob) || imageBlob.size <= 0) {
    throw new Error('captureImageSnapshotBlob: expected a non-empty Blob');
  }
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new Error('captureImageSnapshotBlob: no DOM (canvas unavailable)');
  }
  const bitmap = await decodeImage(imageBlob);
  try {
    const w = bitmap.width || maxWidth;
    const h = bitmap.height || Math.round((maxWidth * 9) / 16);
    const scale = Math.min(1, maxWidth / w);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(w * scale));
    canvas.height = Math.max(2, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2D context unavailable');
    // JPEG has no alpha channel: a transparent PNG/WebP drawn on a blank
    // canvas comes out on BLACK. White is the standard thumbnail ground —
    // the video path never hits this (video frames are opaque).
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas snapshot encode failed'));
      }, 'image/jpeg', quality);
    });
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}
