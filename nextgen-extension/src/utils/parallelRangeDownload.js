/**
 * @fileoverview Parallel-Range download for retry sources.
 *
 * A single-connection browser fetch crawls on some hosts (measured
 * 2026-11-18 on the same TeraBox dlink: ~787 KB/s single vs ~2.4 MB/s
 * over 8 parallel ranges, and the resolve Fix's one-thread fetch ran at
 * ~30 KB/s). The retry path downloads the whole file before re-uploading
 * it, so the download is the bottleneck — split the file into N ranges,
 * fetch them concurrently, concatenate in order.
 *
 * This module is deliberately free of chrome.* and of any import, so it
 * can be unit tested in plain node with a mocked fetch
 * (`test/utils-parallel-range.test.mjs`). videoRetryPageSide.js wires it
 * into fetchVideoAsBlob; HLS segments and playlist fetches stay
 * single-connection (small files, probe overhead not worth it).
 */

/** How many ranges a parallel download splits into (measured sweet spot). */
export const PARALLEL_RANGE_PARTS = 8;

/** Files at or under this size stay single-connection — the probe + 8
 * requests cost more than they save. */
export const PARALLEL_RANGE_MIN_BYTES = 8 * 1024 * 1024;

/** Per-part stall timeout — same window as the single-connection path. */
export const PARALLEL_RANGE_STALL_TIMEOUT_MS = 60000;

/** Per-part resume retries before the whole download fails. */
export const PARALLEL_RANGE_MAX_RETRIES = 10;

/**
 * Split a byte total into N contiguous ranges (end inclusive). The last
 * part takes the remainder, so the parts always cover the file exactly.
 * @param {number} total
 * @param {number} [parts]
 * @returns {Array<{start: number, end: number}>}
 */
export function splitByteRanges(total, parts = PARALLEL_RANGE_PARTS) {
  const size = Math.max(Math.floor(Number(total) || 0), 0);
  const count = Math.max(Math.floor(Number(parts) || 1), 1);
  if (size <= 0) return [];
  const width = Math.ceil(size / count);
  const ranges = [];
  for (let start = 0; start < size; start += width) {
    ranges.push({ start, end: Math.min(start + width, size) - 1 });
  }
  return ranges;
}

const buildFetchOpts = (referrer, extra = {}) => {
  const opts = { ...extra };
  if (typeof referrer === 'string' && /^https?:\/\//i.test(referrer)) {
    opts.referrer = referrer;
    opts.referrerPolicy = 'no-referrer-when-downgrade';
  }
  return opts;
};

/**
 * Probe a URL with a tiny Range request to learn its total size, content
 * type and whether the server honors HTTP Range (206). Follows redirects
 * (udrop direct links redirect to a download_token URL) and returns the
 * final URL. A network failure answers status 0 instead of throwing, so
 * the caller can fall back to the single-connection path.
 * @param {string} url
 * @param {string} [referrer]
 * @param {Function} [fetchImpl]
 * @returns {Promise<{supportsRange:boolean,total:number,type:string,finalUrl:string,status:number}>}
 */
export async function probeDownload(url, referrer, fetchImpl = globalThis.fetch) {
  let resp;
  try {
    resp = await fetchImpl(url, buildFetchOpts(referrer, { headers: { Range: 'bytes=0-0' } }));
  } catch (err) {
    return { supportsRange: false, total: 0, type: '', finalUrl: url, status: 0 };
  }
  const contentRange = resp.headers.get('Content-Range') || '';
  const rangeMatch = contentRange.match(/\/(\d+)$/);
  const total = rangeMatch ? Number(rangeMatch[1]) : 0;
  try { await resp.body?.cancel(); } catch (_) { /* free the probe body */ }
  return {
    supportsRange: resp.status === 206 && total > 0,
    total,
    type: resp.headers.get('Content-Type') || '',
    finalUrl: resp.url || url,
    status: resp.status,
  };
}

/**
 * Fetch one byte range with stall detection + resume inside the range.
 * Never returns a short part: a truncated stream retries from the missing
 * offset, and a server that stops honoring Range (200 instead of 206)
 * fails loudly instead of handing back the whole file as one part.
 */
async function fetchRangePart({
  url,
  referrer,
  range,
  fetchImpl,
  stallTimeoutMs,
  maxRetries,
  onPartProgress,
}) {
  const expected = range.end - range.start + 1;
  const chunks = [];
  let loaded = 0;
  let retries = 0;

  for (;;) {
    const controller = new AbortController();
    let stallTimer;
    const resetStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(), stallTimeoutMs);
    };
    resetStall();

    let resp;
    try {
      resp = await fetchImpl(url, buildFetchOpts(referrer, {
        headers: { Range: `bytes=${range.start + loaded}-${range.end}` },
        signal: controller.signal,
      }));
    } catch (err) {
      if (stallTimer) clearTimeout(stallTimer);
      if (retries < maxRetries) {
        retries += 1;
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw new Error(`Range ${range.start}-${range.end} stalled (no data for ${Math.round(stallTimeoutMs / 1000)}s).`);
    }

    if (resp.status !== 206) {
      if (stallTimer) clearTimeout(stallTimer);
      try { await resp.body?.cancel(); } catch (_) { /* free the body */ }
      throw new Error(
        `Range ${range.start}-${range.end} got HTTP ${resp.status} instead of 206 — the server stopped honoring Range requests.`,
      );
    }

    const reader = resp.body.getReader();
    let stalled = false;
    try {
      for (;;) {
        resetStall();
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          loaded += value.byteLength;
          chunks.push(value);
          if (onPartProgress) onPartProgress(loaded);
        }
      }
    } catch (err) {
      stalled = true;
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      // cancel() on an errored stream returns a REJECTED promise — a bare
      // try/catch only catches sync throws, so swallow the rejection
      // explicitly or it surfaces as an unhandled rejection.
      reader.cancel().catch(() => {});
    }

    if (!stalled && loaded >= expected) return chunks;
    // truncated or stalled mid-part: resume from the missing offset
    if (retries < maxRetries) {
      retries += 1;
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    throw new Error(`Range ${range.start}-${range.end} truncated: got ${loaded} of ${expected} bytes.`);
  }
}

/**
 * Download a URL over N parallel Range requests and concatenate the parts
 * in order. Progress reports the aggregate {loaded, total, percent} in the
 * same shape as the single-connection path, plus method: 'parallel-range'.
 * The caller probes first (probeDownload) and only calls this when the
 * server honors Range and the file is big enough to be worth splitting.
 * @param {string} url  Final URL (post-redirect, from the probe)
 * @param {Object} [options]
 * @param {string} [options.referrer]
 * @param {number} options.total  Total size from the probe
 * @param {string} [options.type]  Content-Type from the probe
 * @param {number} [options.parts]
 * @param {Function} [options.fetchImpl]
 * @param {number} [options.stallTimeoutMs]
 * @param {number} [options.maxRetries]
 * @param {Function} [options.onProgress] ({loaded, total, percent, method})
 * @returns {Promise<Blob>}
 */
export async function downloadParallelRanges(url, options = {}) {
  const {
    referrer,
    total,
    type = '',
    parts = PARALLEL_RANGE_PARTS,
    fetchImpl = globalThis.fetch,
    stallTimeoutMs = PARALLEL_RANGE_STALL_TIMEOUT_MS,
    maxRetries = PARALLEL_RANGE_MAX_RETRIES,
    onProgress,
  } = options;
  const ranges = splitByteRanges(total, parts);
  if (ranges.length === 0) throw new Error('Parallel download needs a known total size.');

  const partLoaded = new Array(ranges.length).fill(0);
  const report = () => {
    if (!onProgress) return;
    const loaded = partLoaded.reduce((sum, n) => sum + n, 0);
    onProgress({
      loaded,
      total,
      percent: total > 0 ? Math.round((loaded / total) * 100) : null,
      method: 'parallel-range',
      methodNote: '',
    });
  };
  report();

  const partChunks = await Promise.all(ranges.map((range, index) => fetchRangePart({
    url,
    referrer,
    range,
    fetchImpl,
    stallTimeoutMs,
    maxRetries,
    onPartProgress: (loaded) => {
      partLoaded[index] = loaded;
      report();
    },
  })));

  const chunks = [];
  let got = 0;
  for (let i = 0; i < partChunks.length; i += 1) {
    for (const chunk of partChunks[i]) {
      chunks.push(chunk);
      got += chunk.byteLength;
    }
  }
  if (got !== total) {
    throw new Error(`Parallel download truncated: got ${got} of ${total} bytes.`);
  }
  return new Blob(chunks, { type });
}
