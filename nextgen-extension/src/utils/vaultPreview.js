/**
 * Vault video previews (2.12.74).
 *
 * Encrypted vault videos have no thumbnail anywhere — the only copy of the
 * media is the encrypted blob. This module derives a thumbnail ON DEMAND after
 * unlock by mounting a detached <video> against the existing
 * `vault-stream/<id>` service-worker endpoint (HTTP Range + per-chunk decrypt,
 * same plumbing the detail player uses), seeking to the MIDDLE of the video,
 * scoring the frame for black/fade (industry practice: never trust frame 0),
 * and retrying at 25%/75% until a usable frame is found.
 *
 * Nothing is fetched "at upload" and nothing about the video is stored except
 * the final small JPEG in the shared IndexedDB thumb cache — so vault videos
 * that already exist get previews too, and the passcode still guards every
 * byte (a locked vault never runs any of this).
 *
 * Host-aware queue: TeraBox CDN throttles the whole account (~0.68MB/s), so
 * previews run ONE video at a time there; UDrop gets 3. Every unique byte
 * range a video element pulls costs a fresh TeraBox dlink + chunk fetch, so
 * timeouts are generous and results are cached permanently (per machine).
 */

import { getCachedThumb, setCachedThumb } from './thumbCache.js';

const CANDIDATE_RATIOS = [0.5, 0.25, 0.75];
// frame passes the "usable" test when it is neither black (mean luma) nor a
// flat fade (luma stddev). Values are on the 0-255 Rec.601 luma scale.
const MIN_MEAN_LUMA = 18;
const MIN_LUMA_SD = 8;
const THUMB_WIDTH = 480;
const THUMB_QUALITY = 0.75;

// terabox is ~0.68MB/s PER dlink connection (tsl=2000 is a per-URL cap,
// verified with rclone multistream), so a few previews may run side by side;
// udrop is fast enough for 3. (2.12.76: terabox was 1 — whole-library warm
// crawled at one-video-at-a-time.)
const HOST_CONCURRENCY = { terabox: 3, udrop: 3 };
const HOST_TIMEOUTS = {
  // terabox: header resolve + 8MiB chunk at ~0.68MB/s ≈ 15-30s per read.
  terabox: { metadata: 180000, seek: 150000 },
  udrop: { metadata: 40000, seek: 30000 },
};
const DEFAULT_HOST_TIMEOUTS = { metadata: 60000, seek: 45000 };
// Vault blobs are immutable once uploaded, so a derived preview NEVER goes
// stale the way a remote gallery thumbnail can — outlive the shared 7-day
// thumb TTL (2.12.76: re-deriving terabox previews weekly on terabox is
// minutes of chunk fetches for a frame that cannot change).
const PREVIEW_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function previewKey(item) {
  return `vault-preview-${item.id}`;
}

/**
 * The copies a preview should actually READ (2.12.76 speed-up): vault items
 * can live on several hosts; every host holds the same IVG1 bytes, so when a
 * fast host (udrop) has a copy we resolve and read ONLY that one — a udrop
 * derivation is seconds instead of minutes, and we never pay terabox's
 * slow per-copy dlink resolve for reads we won't do. No fallback: if the
 * chosen fast copy fails, that preview fails loudly (never silently
 * re-routes through the slow host).
 */
export function preferredPreviewCopies(item) {
  const copies = Array.isArray(item?.encryptedBlobHosts) && item.encryptedBlobHosts.length > 0
    ? item.encryptedBlobHosts
    : [{
      host: item?.vaultHost || 'udrop',
      encryptedBlobUrl: item?.encryptedBlobUrl || '',
      encryptedBlobFileId: item?.encryptedBlobFileId || '',
    }];
  const fast = copies.filter((c) => String(c.host || 'udrop').toLowerCase() !== 'terabox');
  return fast.length > 0 ? fast : copies;
}

function primaryHost(item) {
  const host = (preferredPreviewCopies(item)[0]?.host || 'udrop').toLowerCase();
  return host;
}

const objectUrlMap = new Map();
const inflight = new Map();
const hostState = new Map();
// Global suspend switch (2.12.75): while the vault detail modal is open, no
// NEW job may start — its range reads would race the player for terabox's
// single-use dlink resolves. pumpHost checks this on every drain.
let paused = false;

export function setVaultPreviewPaused(next) {
  paused = Boolean(next);
  if (!paused) hostState.forEach((_state, host) => pumpHost(host));
}

function pumpHost(host) {
  const st = hostState.get(host);
  if (!st || paused) return;
  const limit = HOST_CONCURRENCY[host] ?? 2;
  while (st.running < limit && st.queue.length > 0) {
    const job = st.queue.shift();
    st.running += 1;
    Promise.resolve()
      .then(job.fn)
      .then(
        (value) => { st.running -= 1; job.resolve(value); },
        (err) => { st.running -= 1; job.reject(err); }
      )
      .finally(() => pumpHost(host));
  }
}

function enqueueForHost(host, fn) {
  if (!hostState.has(host)) hostState.set(host, { running: 0, queue: [] });
  return new Promise((resolve, reject) => {
    hostState.get(host).queue.push({ fn, resolve, reject });
    pumpHost(host);
  });
}

function waitForEvent(target, event, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      target.removeEventListener(event, ok);
      target.removeEventListener('error', bad);
      clearTimeout(timer);
    };
    const ok = () => { if (!settled) { settled = true; cleanup(); resolve(); } };
    const bad = () => {
      if (!settled) {
        settled = true;
        cleanup();
        const code = target.error?.code;
        reject(new Error(`${label} failed (video error code ${code ?? 'unknown'})`));
      }
    };
    const timer = setTimeout(() => {
      if (!settled) { settled = true; cleanup(); reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)); }
    }, timeoutMs);
    target.addEventListener(event, ok, { once: true });
    target.addEventListener('error', bad, { once: true });
  });
}

// Decode a small frame from the video element and score it for usability.
function scoreFrame(video) {
  const w = 48;
  const ratio = video.videoWidth && video.videoHeight ? video.videoHeight / video.videoWidth : 9 / 16;
  const h = Math.max(1, Math.round(w * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const n = w * h;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i += 1) {
    const y = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    sum += y;
    sumSq += y * y;
  }
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  return { mean, sd };
}

function drawFrame(video) {
  const vw = video.videoWidth || THUMB_WIDTH;
  const vh = video.videoHeight || Math.round((THUMB_WIDTH * 9) / 16);
  const scale = Math.min(1, THUMB_WIDTH / vw);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(vw * scale));
  canvas.height = Math.max(2, Math.round(vh * scale));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('preview encode failed'));
    }, 'image/jpeg', THUMB_QUALITY);
  });
}

function releaseVideo(video) {
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch { /* detached element, nothing to clean */ }
}

async function runExtraction(item, getStreamUrl) {
  const key = previewKey(item);
  const host = primaryHost(item);
  const timeouts = HOST_TIMEOUTS[host] || DEFAULT_HOST_TIMEOUTS;

  const cached = await getCachedThumb(key, PREVIEW_MAX_AGE_MS);
  if (cached) {
    const url = URL.createObjectURL(cached);
    objectUrlMap.set(key, url);
    return url;
  }

  const src = await getStreamUrl(item);
  if (!src) throw new Error('no stream URL (resolve failed or vault locked)');

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';

  try {
    video.src = src;
    await waitForEvent(video, 'loadedmetadata', timeouts.metadata, `preview metadata (${host})`);
    const duration = Number(video.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`unseekable duration (${video.duration})`);
    }

    let best = null;
    for (const ratio of CANDIDATE_RATIOS) {
      const t = duration <= 1 ? 0 : Math.min(Math.max(duration * ratio, 0.05), duration - 0.05);
      const seeked = new Promise((resolve, reject) => {
        const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
        video.addEventListener('seeked', onSeeked, { once: true });
        setTimeout(() => {
          video.removeEventListener('seeked', onSeeked);
          reject(new Error(`seek to ${(duration * ratio).toFixed(1)}s timed out after ${Math.round(timeouts.seek / 1000)}s`));
        }, timeouts.seek);
      });
      video.currentTime = t;
      try {
        await seeked;
      } catch (err) {
        if (!best) throw err;
        break;
      }
      const { mean, sd } = scoreFrame(video);
      const usable = mean >= MIN_MEAN_LUMA && sd >= MIN_LUMA_SD;
      if (usable || !best || sd > best.sd) {
        const blob = await drawFrame(video);
        if (blob) best = { mean, sd, usable, blob };
      }
      if (usable) break;
    }

    if (!best) throw new Error('no decodable frame at any candidate position');
    if (!best.usable) {
      console.warn(
        `[VaultPreview] ${item.id}: all ${CANDIDATE_RATIOS.length} candidates looked black/fade ` +
        `(mean ${best.mean.toFixed(1)}, sd ${best.sd.toFixed(1)}) — using the most detailed one`
      );
    }

    await setCachedThumb(key, best.blob);
    const url = URL.createObjectURL(best.blob);
    objectUrlMap.set(key, url);
    return url;
  } finally {
    releaseVideo(video);
  }
}

/**
 * Extract (or reuse) a thumbnail for an encrypted vault video.
 * Deduped per item, serialized through a per-host concurrency queue.
 * @param {object} item vault item with encryptedBlobUrl
 * @param {{ getStreamUrl: (item) => Promise<string> }} opts page-supplied
 *   stream-URL builder (it must pre-resolve fresh host URLs first).
 * @returns {Promise<string>} object URL of a JPEG preview
 */
export function requestVaultPreview(item, { getStreamUrl }) {
  const key = previewKey(item);
  if (inflight.has(key)) return inflight.get(key);
  const task = enqueueForHost(primaryHost(item), () => runExtraction(item, getStreamUrl))
    .catch((err) => {
      console.warn(`[VaultPreview] preview failed for ${item.id}: ${err.message || String(err)}`);
      throw err;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

/** Cheap check for an already-cached preview (no decryption, no fetch). */
export async function getCachedVaultPreview(item) {
  const key = previewKey(item);
  if (objectUrlMap.has(key)) return objectUrlMap.get(key);
  const blob = await getCachedThumb(key, PREVIEW_MAX_AGE_MS);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrlMap.set(key, url);
  return url;
}
