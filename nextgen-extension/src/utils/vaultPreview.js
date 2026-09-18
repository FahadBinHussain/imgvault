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
 *
 * Remote tier (2.12.83): after a local miss the card also checks the
 * server-side store `media_item_previews`, which holds the SAME preview
 * encrypted with the vault key (Neon only ever sees ciphertext). It is fetched
 * lazily per visible card — getVaultImages never joins that table, so vault
 * payloads stay byte-identical to before. A clean install now restores a
 * preview with one ~60KB round-trip instead of an 8MiB chunk through a
 * throttled CDN. A decrypt failure is LOUD (warn + re-derive); the preview is
 * also (re)written after every successful derivation so the store self-heals.
 */

/**
 * Read a preview from the server-side encrypted store. Returns an object URL
 * or null when nothing usable is stored. Loud on a bad row — never returns a
 * fake frame and never silently masks a wrong-key condition.
 */
async function getRemoteVaultPreview(item, sendMessage) {
  if (typeof sendMessage !== 'function') return null;
  const masterKey = getVaultMasterKey();
  if (!masterKey) return null;
  let b64 = '';
  try {
    b64 = await sendMessage('getVaultPreview', { id: item.id });
  } catch (err) {
    console.warn(`[VaultPreview] remote fetch failed for ${item.id}: ${err.message || err}`);
    return null;
  }
  if (!b64) return null;
  try {
    const bytes = await decryptPreviewBytes(masterKey, b64);
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    if (blob.size < 64) throw new Error(`implausibly small payload (${blob.size}B)`);
    return blob;
  } catch (err) {
    // Ciphertext that won't decrypt means a stale row from another vault key
    // (passcode change) or a corrupt write. Re-deriving is the correct primary
    // path, and the derivation below overwrites the bad row — but say it.
    console.warn(`[VaultPreview] stored preview unusable for ${item.id}: ${err.message || err} — re-deriving`);
    return null;
  }
}

/**
 * Persist a freshly derived preview to the server-side store. Best-effort by
 * design: the card already holds the local copy, so a failed write is a loud
 * warning, never a broken tile.
 */
async function persistRemoteVaultPreview(item, blob, sendMessage) {
  if (typeof sendMessage !== 'function') return;
  const masterKey = getVaultMasterKey();
  if (!masterKey) return;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const b64 = await encryptPreviewBytes(masterKey, bytes);
    await sendMessage('saveVaultPreview', { id: item.id, data: b64 });
  } catch (err) {
    console.warn(`[VaultPreview] remote persist failed for ${item.id}: ${err.message || err}`);
  }
}

import { getCachedThumb, setCachedThumb } from './thumbCache.js';
import { encryptPreviewBytes, decryptPreviewBytes } from './vaultCrypto.js';
import { getVaultMasterKey } from './vaultSession.js';
import { locateVideoFrame, buildSingleFrameMp4, findMoov, findBox } from './mp4MinFrame.js';

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
// One remote backfill check per item per session (2.12.84): a warm local cache
// means no derivation runs, so the persist inside runExtraction never fires and
// the server-side tier would stay empty on existing installs until the 365-day
// local TTL expired. A local hit therefore checks the remote store once and
// writes the preview up if it is missing.
const remoteBackfilled = new Set();
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

/**
 * Identify the container from the first bytes of the plaintext. The locator
 * below only speaks ISO-BMFF; Matroska/WebM is EBML and has no moov at all, so
 * detecting it up front avoids a pointless head+tail search.
 */
function detectContainer(bytes) {
  if (!bytes || bytes.length < 8) return 'unknown';
  const type = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  if (type === 'ftyp') return 'iso-bmff';
  // EBML header magic — Matroska (.mkv) and WebM share it.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'matroska';
  return 'unknown';
}

async function runExtraction(item, getStreamUrl, sendMessage) {
  const key = previewKey(item);
  const host = primaryHost(item);
  const timeouts = HOST_TIMEOUTS[host] || DEFAULT_HOST_TIMEOUTS;

  const cached = await getCachedThumb(key, PREVIEW_MAX_AGE_MS);
  if (cached) {
    const url = URL.createObjectURL(cached);
    objectUrlMap.set(key, url);
    return url;
  }

  // Remote tier: a clean install (or a cleared site-data IndexedDB) still has
  // the preview server-side, encrypted with the vault key. ~60KB instead of an
  // 8MiB chunk fetch. Backfills the local cache so later views stay free.
  const remote = await getRemoteVaultPreview(item, sendMessage);
  if (remote) {
    await setCachedThumb(key, remote);
    const url = URL.createObjectURL(remote);
    objectUrlMap.set(key, url);
    return url;
  }

  const src = await getStreamUrl(item);
  if (!src) throw new Error('no stream URL (resolve failed or vault locked)');

  // ONE FRAME ONLY (2.12.88): a preview is a spec of a moment. Parse moov,
  // locate the sync frame nearest the middle, range-fetch just that frame's
  // bytes, and decode it from a tiny synthetic MP4. Never mounts a <video> on
  // the streaming endpoint, so there is no moov-probe churn and no 8MiB+
  // chunk cascade — the whole derivation costs ~16MiB on a 143MiB file.
  const copies = await resolveCopiesForPreview(item, src, sendMessage);

  // moov sits near the start for faststart files, at the end otherwise.
  // Read the head first; only if moov is absent there read the tail.
  const probe = await sendMessage('vaultProbeBlobFormat', {
    id: item.id,
    url: copies[0]?.encryptedBlobUrl || item.encryptedBlobUrl,
    fileId: copies[0]?.encryptedBlobFileId || item.encryptedBlobFileId || '',
    chunks: item.encryptedBlobChunks || [],
    vaultHost: copies[0]?.host || item.vaultHost || 'udrop',
    hostCopies: copies,
  });
  if (!probe?.chunked) {
    throw new Error('legacy (non-chunked) blob — single-frame preview unavailable');
  }
  const { total, chunkSize } = probe;
  console.log(`[VaultPreview] ${item.id}: layout total=${total} chunkSize=${chunkSize} (faststart=${total > 0 ? 'checking' : '?'})`);

  const MOOV_MAX_WINDOW = 32 * 1024 * 1024;

  // Matroska (MKV/WebM) is EBML, not ISO-BMFF — there is no moov at all. Its
  // header is tiny and sits at the very start, and the seek index (Cues) may
  // live at the far end, so the moov search below reads head AND tail and
  // finds nothing (observed on 1327ea6b, video/matroska). Identify the
  // container from one head chunk and branch before paying for that.
  const headFirst = await fetchPlain(0, Math.min(chunkSize, total) - 1);
  const container = detectContainer(headFirst);
  console.log(`[VaultPreview] ${item.id}: container=${container}`);
  if (container === 'matroska') {
    let head = headFirst;
    for (let n = 1; n * chunkSize <= MOOV_MAX_WINDOW;) {
      const res = await decodeMatroskaHead(head, total, timeouts);
      if (res) {
        if (!res.usable) {
          console.warn(`[VaultPreview] ${item.id}: matroska candidates looked black/fade (mean ${res.mean.toFixed(1)}, sd ${res.sd.toFixed(1)}) — using the most detailed one`);
        }
        await setCachedThumb(key, res.blob);
        persistRemoteVaultPreview(item, res.blob, sendMessage);
        const url = URL.createObjectURL(res.blob);
        objectUrlMap.set(key, url);
        return url;
      }
      const next = n * 2;
      if (next * chunkSize > MOOV_MAX_WINDOW) break;
      console.log(`[VaultPreview] ${item.id}: matroska head (${head.length}B) did not decode — growing to ${next} chunks`);
      head = await fetchPlain(0, Math.min(next * chunkSize, total) - 1);
      n = next;
    }
    throw new Error('matroska: head window did not decode (unsupported variants?)');
  }
  if (container !== 'iso-bmff') {
    throw new Error(`unsupported container "${container}" — cannot locate a frame`);
  }

  // moov sits near the start for faststart files, at the end otherwise. Its
  // size is not bounded by the chunk size: a long video's sample tables (stsz/
  // stsc/stss/stco, one entry per frame) can run to tens of MiB. A window that
  // cuts moov in half makes the box walk read past the real tables into
  // unrelated bytes and yields a plausible-looking but GARBAGE sample size —
  // observed on this very item as a "67MiB frame" that blew the 64MiB message
  // cap. So the window GROWS until moov fits completely: read a chunk, look
  // for a complete moov, read another chunk if it is truncated. Bounded, and
  // loud if it never fits.
  // chrome.runtime.sendMessage caps the response at 64MiB. An 8MiB Uint8Array
  // SHOULD fit, but Chrome's structured-clone overhead for typed arrays can
  // push it over (observed: an 8MiB head fetch blew the cap on 9cc25ea7).
  // So large ranges are split into 1MiB messages and reassembled here. The
  // background's chunk cache makes the extra round-trips cheap — the same
  // 8MiB encrypted chunk is fetched once and the slices are served from
  // memory.
  const PLAIN_FETCH_CHUNK = 1 * 1024 * 1024;
  const normalizeBytes = (part) => {
    if (part instanceof Uint8Array) return part;
    if (part instanceof ArrayBuffer) return new Uint8Array(part);
    if (Array.isArray(part)) return new Uint8Array(part);
    if (part && typeof part === 'object') {
      // structured-clone may deliver a plain object with numeric keys
      const vals = Object.values(part);
      if (vals.length && typeof vals[0] === 'number') return new Uint8Array(vals);
    }
    return part;
  };
  const fetchPlain = async (start, end) => {
    const len = end - start + 1;
    if (len <= PLAIN_FETCH_CHUNK) {
      console.log(`[VaultPreview] ${item.id}: fetching range ${start}-${end} (${len}B)`);
      const oneRaw = await sendMessage('vaultFetchPlaintextRange', {
        id: item.id, copies, fileName: item.encryptedFileName || '',
        start, end,
      });
      const one = normalizeBytes(oneRaw);
      console.log(`[VaultPreview] ${item.id}: received ${one?.length || 0}B for ${start}-${end} (raw type ${Object.prototype.toString.call(oneRaw)})`);
      return one;
    }
    console.log(`[VaultPreview] ${item.id}: chunked fetch ${start}-${end} (${len}B) in ${Math.ceil(len / PLAIN_FETCH_CHUNK)} parts`);
    const out = new Uint8Array(len);
    let off = 0;
    for (let s = start; s <= end; s += PLAIN_FETCH_CHUNK) {
      const e = Math.min(s + PLAIN_FETCH_CHUNK - 1, end);
      const partRaw = await sendMessage('vaultFetchPlaintextRange', {
        id: item.id, copies, fileName: item.encryptedFileName || '',
        start: s, end: e,
      });
      console.log(`[VaultPreview] ${item.id}: chunk ${s}-${e} raw type=${Object.prototype.toString.call(partRaw)} len=${partRaw?.length} byteLen=${partRaw?.byteLength} keys=${partRaw && typeof partRaw === 'object' ? Object.keys(partRaw).length : 'n/a'} sampleKeys=${partRaw && typeof partRaw === 'object' ? Object.keys(partRaw).slice(0,3).join(',') : ''}`);
      const part = normalizeBytes(partRaw);
      console.log(`[VaultPreview] ${item.id}: chunk ${s}-${e} normalized ${part?.length || 0}B type=${Object.prototype.toString.call(part)}`);
      if (!part || !part.length) {
        console.error(`[VaultPreview] ${item.id}: chunk ${s}-${e} returned no bytes — raw:`, partRaw);
        throw new Error(`chunk ${s}-${e} returned no bytes (expected ${e - s + 1}) — got ${Object.prototype.toString.call(partRaw)} len=${partRaw?.length} keys=${partRaw && typeof partRaw === 'object' ? Object.keys(partRaw).length : 0}`);
      }
      out.set(part, off);
      off += part.length;
    }
    return out;
  };

  // 32MiB is generous (a 2-hour 30fps video's moov is ~1-2MiB) while still
  // bounded — a file whose moov is bigger than this is not a normal video.
  let moovBytes = null;
  let moovWhere = '';

  // head first (faststart), then tail (moov-at-end)
  for (const side of ['head', 'tail']) {
    let windowChunks = 1;
    while (windowChunks * chunkSize <= MOOV_MAX_WINDOW) {
      const winLen = Math.min(windowChunks * chunkSize, total);
      const start = side === 'head' ? 0 : Math.max(0, total - winLen);
      const end = side === 'head' ? winLen - 1 : total - 1;
      const win = await fetchPlain(start, end);
      if (!win || !win.length) throw new Error(`plaintext ${side} range returned no bytes`);
      const moov = findMoov(win);
      if (moov && moov.off + moov.size <= win.length) {
        // complete moov — its tables are fully inside the window
        moovBytes = win;
        moovWhere = `${side} (${windowChunks} chunk${windowChunks > 1 ? 's' : ''}, moov ${moov.size}B)`;
        break;
      }
      if (moov) {
        // truncated: moov is real but bigger than the window so far. Grow.
        console.log(`[VaultPreview] ${item.id}: moov in ${side} needs ${moov.size}B, window is ${win.length}B — growing`);
        windowChunks += 1;
        continue;
      }
      // no moov at all in this window: for the head that means moov-at-end
      // (fall through to the tail side); for the tail it means it is absent.
      break;
    }
    if (moovBytes) break;
  }
  if (!moovBytes) {
    throw new Error('moov not found or did not fit in a 32MiB head/tail window — cannot locate a frame');
  }
  console.log(`[VaultPreview] ${item.id}: moov found in ${moovWhere}`);

  // Fragmented MP4 (dash) stores samples in moof boxes, not in moov's stbl.
  // locateVideoFrame correctly rejects it (mvex). For a preview we don't need
  // the middle — the first fragment's first frame is a keyframe and the head
  // window (8MiB) already contains moov + sidx + first moof/mdat. The browser
  // decodes a truncated fMP4 prefix fine, so try that directly.
  const moovBox = findMoov(moovBytes);
  const isFragmented = moovBox && (() => {
    try { return !!findBox(moovBytes, 'mvex', moovBox.dataOff, moovBox.dataEnd); } catch { return false; }
  })();
  if (isFragmented) {
    console.log(`[VaultPreview] ${item.id}: fragmented MP4 (mvex) — trying direct decode of head window (${moovBytes.length}B)`);
    const frag = await decodeFragmentedHead(moovBytes, timeouts);
    if (frag) {
      console.log(`[VaultPreview] ${item.id}: fragmented head decoded (mean ${frag.mean.toFixed(1)}, sd ${frag.sd.toFixed(1)})`);
      await setCachedThumb(key, frag.blob);
      persistRemoteVaultPreview(item, frag.blob, sendMessage);
      const url = URL.createObjectURL(frag.blob);
      objectUrlMap.set(key, url);
      return url;
    }
    console.warn(`[VaultPreview] ${item.id}: fragmented head decode failed — no preview`);
    throw new Error('fragmented MP4: head window did not decode (unsupported fragmentation?)');
  }

  let best = null;
  for (const ratio of CANDIDATE_RATIOS) {
    const info = locateVideoFrame(moovBytes, ratio);
    if (!info) {
      console.warn(`[VaultPreview] ${item.id}: frame at ratio ${ratio} could not be located (unsupported container?)`);
      continue;
    }
    console.log(`[VaultPreview] ${item.id}: frame@${ratio} -> offset ${info.offset} size ${info.size} (${info.width}x${info.height})`);
    const frameBytes = await sendMessage('vaultFetchPlaintextRange', {
      id: item.id, copies, fileName: item.encryptedFileName || '',
      start: info.offset, end: info.offset + info.size - 1,
    });
    if (!frameBytes || frameBytes.length !== info.size) {
      console.warn(`[VaultPreview] ${item.id}: frame range at ratio ${ratio} returned ${frameBytes?.length || 0}B, expected ${info.size}`);
      continue;
    }
    const mp4 = buildSingleFrameMp4(info, frameBytes);
    const decoded = await decodeSingleFrameMp4(mp4, timeouts, `frame@${ratio}`);
    if (!decoded) continue;
    const { mean, sd, blob } = decoded;
    const usable = mean >= MIN_MEAN_LUMA && sd >= MIN_LUMA_SD;
    if (usable || !best || sd > best.sd) best = { mean, sd, usable, blob };
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
  persistRemoteVaultPreview(item, best.blob, sendMessage);
  const url = URL.createObjectURL(best.blob);
  objectUrlMap.set(key, url);
  return url;
}

/**
 * Decode the tiny single-frame MP4 and rasterize it to a scored JPEG. The
 * synthetic file holds exactly one sample, so there is nothing to seek —
 * 'loadeddata' means the frame is on screen.
 */
async function decodeSingleFrameMp4(mp4Bytes, timeouts, label) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const url = URL.createObjectURL(new Blob([mp4Bytes], { type: 'video/mp4' }));
  try {
    video.src = url;
    await waitForEvent(video, 'loadeddata', timeouts.seek, `preview decode (${label})`);
    const { mean, sd } = scoreFrame(video);
    const blob = await drawFrame(video);
    if (!blob) return null;
    return { mean, sd, blob };
  } finally {
    releaseVideo(video);
    URL.revokeObjectURL(url);
  }
}

/**
 * Fragmented MP4: the head window (moov + sidx + first moof/mdat) is itself a
 * valid truncated fMP4. The browser decodes its first fragment's first frame
 * without needing a rebuilt stbl — just feed the window as-is.
 */
async function decodeFragmentedHead(headBytes, timeouts) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const url = URL.createObjectURL(new Blob([headBytes], { type: 'video/mp4' }));
  try {
    video.src = url;
    await waitForEvent(video, 'loadeddata', timeouts.seek, 'fragmented head');
    const { mean, sd } = scoreFrame(video);
    const blob = await drawFrame(video);
    if (!blob) return null;
    return { mean, sd, blob };
  } catch (err) {
    console.warn(`[VaultPreview] fragmented head decode error: ${err.message || err}`);
    return null;
  } finally {
    releaseVideo(video);
    URL.revokeObjectURL(url);
  }
}

/**
 * Matroska/WebM: the head window is a valid truncated prefix (EBML header +
 * SegmentInfo + Tracks + first clusters). The element reports the FULL
 * duration even though only the first seconds are present, so duration-based
 * seeking stalls past the available data — probe early seconds instead and
 * keep the most detailed frame (the first frame of a fade-in is often black).
 */
async function decodeMatroskaHead(headBytes, totalBytes, timeouts) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const url = URL.createObjectURL(new Blob([headBytes], { type: 'video/webm' }));
  let best = null;
  try {
    video.src = url;
    await waitForEvent(video, 'loadeddata', timeouts.seek, 'matroska head');
    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const est = totalBytes > 0 ? dur * (headBytes.length / totalBytes) : 0;
    const times = [0];
    if (est > 1) times.push(Math.min(est * 0.5, 60), Math.min(est * 0.9, 120));
    else times.push(2, 5);
    for (const t of times) {
      if (t > 0) {
        if (dur > 0 && t >= dur) continue;
        try {
          video.currentTime = dur > 0 ? Math.min(t, dur - 0.1) : t;
          await waitForEvent(video, 'seeked', 3000, `matroska seek ${t.toFixed(1)}s`);
        } catch (err) {
          console.log(`[VaultPreview] matroska seek ${t.toFixed(1)}s unavailable (${err.message}) — stopping probe`);
          break;
        }
      }
      const { mean, sd } = scoreFrame(video);
      const blob = await drawFrame(video);
      if (!blob) continue;
      const usable = mean >= MIN_MEAN_LUMA && sd >= MIN_LUMA_SD;
      if (!best || sd > best.sd) best = { mean, sd, usable, blob };
      if (usable) break;
    }
  } catch (err) {
    console.warn(`[VaultPreview] matroska head decode error: ${err.message || err}`);
    return null;
  } finally {
    releaseVideo(video);
    URL.revokeObjectURL(url);
  }
  return best;
}

/**
 * The stream URL carries resolved copies in its query string (the SW serves
 * ranges from them without a DB read). Reuse those same copies for the
 * plaintext-range messages so no second resolve round-trip is paid.
 */
async function resolveCopiesForPreview(item, streamUrl, sendMessage) {
  try {
    const q = new URL(streamUrl).searchParams.get('copies');
    if (q) {
      const arr = JSON.parse(q);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch { /* fall through to the item's own copies */ }
  return preferredPreviewCopies(item);
}

/**
 * Extract (or reuse) a thumbnail for an encrypted vault video.
 * Deduped per item, serialized through a per-host concurrency queue.
 * @param {object} item vault item with encryptedBlobUrl
 * @param {{ getStreamUrl: (item) => Promise<string>, sendMessage?: (action: string, data?: object) => Promise<any> }} opts
 *   page-supplied stream-URL builder (it must pre-resolve fresh host URLs
 *   first) and the SW message bridge used by the remote preview tier.
 * @returns {Promise<string>} object URL of a JPEG preview
 */
export function requestVaultPreview(item, { getStreamUrl, sendMessage }) {
  const key = previewKey(item);
  if (inflight.has(key)) return inflight.get(key);
  const task = enqueueForHost(primaryHost(item), () => runExtraction(item, getStreamUrl, sendMessage))
    .catch((err) => {
      console.warn(`[VaultPreview] preview failed for ${item.id}: ${err.message || String(err)}`);
      throw err;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

/** Cheap check for an already-cached preview (no decryption, no fetch). */
export async function getCachedVaultPreview(item, sendMessage) {
  const key = previewKey(item);
  if (objectUrlMap.has(key)) return objectUrlMap.get(key);
  const blob = await getCachedThumb(key, PREVIEW_MAX_AGE_MS);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrlMap.set(key, url);
  // Backfill the server-side tier from the local copy (2.12.84): without a
  // derivation there is no persist, so a warm IndexedDB would leave the remote
  // store empty for a year. One check per item per session, fire-and-forget —
  // the card already has its URL, this only feeds the OTHER machines.
  if (typeof sendMessage === 'function' && !remoteBackfilled.has(key)) {
    remoteBackfilled.add(key);
    (async () => {
      try {
        const existing = await sendMessage('getVaultPreview', { id: item.id });
        if (existing) return;
        await persistRemoteVaultPreview(item, blob, sendMessage);
      } catch (err) {
        // Do not poison the session flag on a transient failure — retry next
        // session. Say it, never silence it.
        remoteBackfilled.delete(key);
        console.warn(`[VaultPreview] remote backfill failed for ${item.id}: ${err.message || err}`);
      }
    })().catch((err) => console.warn(`[VaultPreview] backfill error for ${item.id}: ${err.message || err}`));
  }
  return url;
}
