import { getVideoRetrySourceCandidates, getVideoUploadService, mergeVideoProviderResult } from './videoProviderLinks.js';
import { extractFilemoonFilecode, getFilemoonDirectLink, getFilemoonHlsLink } from './filemoonApi.js';
import { getFilemoonStreamSource } from './filemoonSpa.js';
import { FilemoonUploader, UDropUploader, TeraBoxUploader } from './uploaders.js';

const absolute = (url, base) => new URL(url, base).toString();

const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value.trim());

const createVideoUploader = (service) => {
  if (service?.uploaderKey === 'filemoonUploader') return new FilemoonUploader();
  if (service?.uploaderKey === 'udropUploader') return new UDropUploader();
  if (service?.uploaderKey === 'teraboxUploader') return new TeraBoxUploader();
  return null;
};

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`;
};

// A download can legitimately take a long time (large files on slow hosts),
// so there is NO total-time cap — only a stall timeout that aborts when no
// bytes arrive for a while. Any file size will complete as long as the
// connection keeps streaming.
const STALL_TIMEOUT_MS = 60000;
const RESUME_MAX_RETRIES = 10;

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
 * final URL. Used to refresh a download token mid-stream.
 * @param {string} url
 * @param {string} [referrer]
 * @returns {Promise<{supportsRange:boolean,total:number,type:string,finalUrl:string,status:number}>}
 */
async function probeDownload(url, referrer) {
  let resp;
  try {
    resp = await fetch(url, buildFetchOpts(referrer, { headers: { Range: 'bytes=0-0' } }));
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
 * Stream a URL into a Blob while reporting download progress. Follows
 * redirects automatically (udrop direct links redirect to a download_token
 * URL that serves the actual file). udrop throttles a single connection
 * over time, so when the stream stalls we fetch a fresh download token
 * and resume from the last byte using HTTP Range (`bytes={loaded}-`).
 * This effectively resets the throttle window and keeps the download
 * moving regardless of file size or host speed. There is no total-time
 * cap — only stall timeouts — so any file size will complete.
 * @param {string} url  Source URL (pre-redirect, e.g. udrop /file/…)
 * @param {string} [referrer]
 * @param {Function} [onProgress] ({loaded, total, percent})
 * @returns {Promise<Blob>}
 */
async function fetchVideoAsBlob(url, referrer, onProgress) {
  const chunks = [];
  let loaded = 0;
  let total = 0;
  let type = '';
  let retries = 0;

  for (;;) {
    // On retries, re-probe the source URL to get a fresh redirect — udrop
    // issues a new download_token each time, which resets the throttle.
    let fetchUrl = url;
    if (retries > 0) {
      try {
        const probe = await probeDownload(url, referrer);
        if (!probe.supportsRange || probe.total <= 0) {
          throw new Error('Refresh failed: server no longer supports range requests.');
        }
        fetchUrl = probe.finalUrl;
        // If the server reports a different total (shouldn't), use the
        // original — the file hasn't changed.
        type = probe.type || type;
      } catch (refreshErr) {
        if (retries >= RESUME_MAX_RETRIES) {
          throw new Error('Download stalled (no data for 60s). The connection may be blocked.');
        }
        retries += 1;
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
    }

    const headers = {};
    if (loaded > 0) headers.Range = `bytes=${loaded}-`;

    const controller = new AbortController();
    let stallTimer;
    const resetStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
    };
    resetStall();

    let resp;
    try {
      resp = await fetch(fetchUrl, buildFetchOpts(referrer, { headers, signal: controller.signal }));
    } catch (err) {
      if (loaded > 0 && retries < RESUME_MAX_RETRIES) {
        retries += 1;
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw new Error('Download stalled (no data for 60s). The connection may be blocked.');
    }

    if (loaded > 0) {
      if (resp.status !== 206) {
        if (retries < RESUME_MAX_RETRIES) {
          retries += 1;
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        throw new Error(`Download stalled (unexpected HTTP ${resp.status} on resume).`);
      }
    } else {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      total = Number(resp.headers.get('Content-Length')) || 0;
      type = resp.headers.get('Content-Type') || '';
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
        }
        if (onProgress) {
          onProgress({
            loaded,
            total,
            percent: total > 0 ? Math.round((loaded / total) * 100) : null,
          });
        }
      }
    } catch (err) {
      stalled = true;
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      try { reader.cancel(); } catch (_) { /* already done */ }
    }

    if (!stalled) return new Blob(chunks, { type });

    if (loaded > 0 && retries < RESUME_MAX_RETRIES) {
      retries += 1;
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    throw new Error('Download stalled (no data for 60s). The connection may be blocked.');
  }
}

async function fetchText(url, referrer) {
  const blob = await fetchVideoAsBlob(url, referrer);
  return blob.text();
}

async function downloadHlsAsVideoBlob(m3u8Url, onProgress) {
  let playlistUrl = m3u8Url;
  let playlist = await fetchText(playlistUrl, 'https://filemoon.sx/');

  if (/#EXT-X-STREAM-INF/i.test(playlist)) {
    const lines = playlist.split(/\r?\n/);
    let rendition = '';
    for (let i = 0; i < lines.length; i += 1) {
      if (/^#EXT-X-STREAM-INF/i.test(lines[i])) {
        const next = lines[i + 1];
        if (next && !next.startsWith('#')) rendition = next;
      }
    }
    if (!rendition) throw new Error('HLS master playlist had no renditions');
    playlistUrl = absolute(rendition.trim(), m3u8Url);
    playlist = await fetchText(playlistUrl, 'https://filemoon.sx/');
  }

  const lines = playlist.split(/\r?\n/);
  const segmentUris = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^#EXTINF/i.test(lines[i])) {
      const next = lines[i + 1];
      if (next && !next.startsWith('#')) segmentUris.push(absolute(next.trim(), playlistUrl));
    }
  }
  if (segmentUris.length === 0) throw new Error('HLS playlist had no segments');

  const parts = [];
  for (let i = 0; i < segmentUris.length; i += 1) {
    if (onProgress) {
      onProgress({
        loaded: i + 1,
        total: segmentUris.length,
        percent: Math.round(((i + 1) / segmentUris.length) * 100),
        segment: true,
      });
    }
    const blob = await fetchVideoAsBlob(segmentUris[i], 'https://filemoon.sx/');
    if (!(blob instanceof Blob) || blob.size === 0) throw new Error('HLS segment fetch returned empty data');
    parts.push(await blob.arrayBuffer());
  }
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (total === 0) return null;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(new Uint8Array(part), offset);
    offset += part.byteLength;
  }
  return new Blob([merged], { type: 'video/mp4' });
}

/**
 * Page-side video retry. Runs entirely in the page/tab context (no SW
 * lifetime limits), so large video downloads can take as long as needed.
 * Downloads are streamed (no total-time cap, only a stall timeout) and
 * progress is reported for both the download and the upload.
 * @param {Object} item     Full item from the DB
 * @param {string} targetHost  e.g. 'filemoon'
 * @param {Object} settings Host settings (from getVideoHostSettings message)
 * @param {Object} [options]
 * @param {Function} [options.onProgress] ({phase, message, loaded, total, percent})
 * @returns {Promise<Object>} updates { videoHosts, watchUrl, … }
 */
export async function retryVideoHostPageSide(item, targetHost, settings, options = {}) {
  const { onProgress } = options;
  const report = (phase, message, extra = {}) => {
    if (typeof onProgress === 'function') {
      onProgress({ phase, message, ...extra });
    }
  };

  const host = String(targetHost || '').trim().toLowerCase();
  const service = getVideoUploadService(host);

  if (!item) throw new Error('Missing video item for retry.');
  if (!service) throw new Error('Choose a configured video host to retry.');
  if (!item.isVideo && !String(item.fileType || '').startsWith('video/')) {
    throw new Error('Only saved videos can retry video hosts.');
  }
  if (!service.isConfigured(settings)) {
    throw new Error(`${service.label} API settings are not configured.`);
  }

  const sourceCandidates = getVideoRetrySourceCandidates(item, host);
  const httpCandidates = sourceCandidates.filter(isHttpUrl);
  if (httpCandidates.length === 0) {
    throw new Error(`No existing hosted video URL is available to retry ${service.label}.`);
  }

  let videoBlob = null;
  let sourceUrl = '';
  const fetchErrors = [];

  for (const candidate of httpCandidates) {
    let fetchTarget = candidate;
    let referrer = item.sourcePageUrl || candidate;

    const filemoonCode = extractFilemoonFilecode(candidate);
    if (filemoonCode) {
      if (settings.filemoonApiKey) {
        try {
          const directFileUrl = await getFilemoonDirectLink(settings.filemoonApiKey, filemoonCode);
          if (directFileUrl) {
            fetchTarget = directFileUrl;
            referrer = 'https://filemoon.sx/';
          }
        } catch (apiError) {
          fetchErrors.push(`${candidate} -> direct link API: ${apiError.message || apiError}`);
        }
      } else {
        fetchErrors.push(`${candidate} -> filemoonApiKey not available`);
      }
    }

    try {
      report('download', `Downloading from ${new URL(fetchTarget).hostname}...`);
      const blob = await fetchVideoAsBlob(fetchTarget, referrer, (p) => {
        const label = p.total > 0
          ? `Downloading ${formatBytes(p.loaded)} / ${formatBytes(p.total)}`
          : `Downloading ${formatBytes(p.loaded)}...`;
        report('download', label, { loaded: p.loaded, total: p.total, percent: p.percent });
      });
      const isVideoBlob = (
        blob instanceof Blob &&
        blob.size > 0 &&
        (
          !blob.type ||
          blob.type.startsWith('video/') ||
          blob.type === 'application/octet-stream' ||
          blob.type === 'binary/octet-stream'
        )
      );
      if (isVideoBlob) {
        videoBlob = blob;
        sourceUrl = candidate;
        break;
      }
      fetchErrors.push(`${candidate} -> not a video (${blob?.type || 'empty'})`);
    } catch (fetchError) {
      const isTimeout = fetchError?.name === 'AbortError' || /aborted|stalled/i.test(fetchError?.message || '');
      fetchErrors.push(`${candidate} -> ${isTimeout ? 'download stalled (no data for 60s)' : fetchError.message || fetchError}`);
    }

    if (filemoonCode && settings.filemoonApiKey) {
      try {
        const hlsM3u8 = await getFilemoonHlsLink(settings.filemoonApiKey, filemoonCode);
        if (!hlsM3u8) {
          fetchErrors.push(`${candidate} -> hls link API: no m3u8 returned`);
        } else {
          report('download', 'Downloading HLS stream...');
          const hlsBlob = await downloadHlsAsVideoBlob(hlsM3u8, (p) => {
            report('download', `Downloading HLS segment ${p.loaded} / ${p.total}`, {
              loaded: p.loaded,
              total: p.total,
              percent: p.percent,
            });
          });
          if (hlsBlob && hlsBlob.size > 0) {
            videoBlob = hlsBlob;
            sourceUrl = candidate;
            break;
          }
          fetchErrors.push(`${candidate} -> hls produced an empty blob`);
        }
      } catch (hlsError) {
        fetchErrors.push(`${candidate} -> hls: ${hlsError.message || hlsError}`);
      }
    }

    if (filemoonCode && !videoBlob) {
      try {
        const stream = await getFilemoonStreamSource(filemoonCode);
        if (!stream || !stream.url) {
          fetchErrors.push(`${candidate} -> player flow returned no stream`);
        } else {
          report('download', 'Downloading HLS stream...');
          const hlsBlob = await downloadHlsAsVideoBlob(stream.url, (p) => {
            report('download', `Downloading HLS segment ${p.loaded} / ${p.total}`, {
              loaded: p.loaded,
              total: p.total,
              percent: p.percent,
            });
          });
          if (hlsBlob && hlsBlob.size > 0) {
            videoBlob = hlsBlob;
            sourceUrl = candidate;
            break;
          }
          fetchErrors.push(`${candidate} -> player flow produced an empty blob`);
        }
      } catch (spaError) {
        fetchErrors.push(`${candidate} -> player flow: ${spaError.message || spaError}`);
      }
    }
  }

  if (!videoBlob) {
    const details = fetchErrors.length > 0 ? ` Tried: ${fetchErrors.join('; ')}` : '';
    throw new Error(`No retry source returned a video file.${details}`);
  }

  const fileName = item.fileName || sourceUrl.split('/').pop() || 'video.mp4';
  const uploader = createVideoUploader(service);
  if (!uploader) throw new Error(`${service.label} uploader is not available.`);

  report('upload', `Uploading ${formatBytes(videoBlob.size)} to ${service.label}...`);
  const result = await service.uploadWithProgress({
    uploader,
    blob: videoBlob,
    settings,
    data: { ...item, fileName },
    onProgress: ({ loaded, total, percent }) => {
      const label = total > 0
        ? `Uploading ${formatBytes(loaded)} / ${formatBytes(total)} to ${service.label}`
        : `Uploading ${formatBytes(loaded)} to ${service.label}...`;
      report('upload', label, { loaded, total, percent });
    },
  });

  report('save', 'Saving host URLs...');
  const mergedUpdates = mergeVideoProviderResult(item, host, result);
  return {
    videoHosts: mergedUpdates.videoHosts,
    ...(service.watchUrlField ? { [service.watchUrlField]: mergedUpdates[service.watchUrlField] || '' } : {}),
    ...(service.directUrlField ? { [service.directUrlField]: mergedUpdates[service.directUrlField] || '' } : {}),
    ...(service.aliasWatchUrlField ? { [service.aliasWatchUrlField]: mergedUpdates[service.aliasWatchUrlField] || '' } : {}),
  };
}