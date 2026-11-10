/**
 * @fileoverview Suno API client for video downloads and metadata resolution.
 * @description yt-dlp refuses Suno URLs due to AI generation liability policies.
 *              This utility extracts the song UUID from Suno URLs (suno.com / suno.ai)
 *              and resolves metadata + direct streamable MP4 URLs via Suno's
 *              studio clip API or the authenticated sanctioned download endpoint.
 *              Never guesses CDN URLs when `video_url` is absent and never attempts
 *              DRM circumvention.
 */

export const SUNO_DOMAINS_RE = /(^|\.)(suno\.(?:com|ai)|sunoai\.ai)$/i;

export function isSunoHost(hostname = '') {
  return SUNO_DOMAINS_RE.test(String(hostname || '').trim());
}

export function extractSunoSongId(url = '') {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    if (!isSunoHost(parsed.hostname)) return null;

    // 1. Path pattern: /song/<uuid>, /s/<uuid>, /embed/<uuid>, /clip/<uuid>
    const match = parsed.pathname.match(/\/(?:song|s|embed|clip)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (match) return match[1].toLowerCase();

    // 2. Query param: ?clipId=<uuid> or ?id=<uuid>
    const clipIdParam = parsed.searchParams.get('clipId') || parsed.searchParams.get('id');
    if (clipIdParam && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clipIdParam)) {
      return clipIdParam.toLowerCase();
    }

    // 3. Direct filename: /<uuid>.mp4 or /<uuid>.mp3
    const fileMatch = parsed.pathname.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(?:mp4|mp3|m4a|webm|wav)/i);
    if (fileMatch) return fileMatch[1].toLowerCase();

    // 4. Any 36-char hex UUID in pathname
    const fallbackMatch = parsed.pathname.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (fallbackMatch) return fallbackMatch[1].toLowerCase();

    return null;
  } catch (_) {
    return null;
  }
}

export function isSunoUrl(url = '') {
  if (!url || typeof url !== 'string') return false;
  return extractSunoSongId(url) !== null;
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function isUsableSunoMediaUrl(value) {
  return isHttpUrl(value) && !/\/api\/forbidden(?:[/?#]|$)/i.test(value.trim());
}

function buildSunoPageTitle(data, songId) {
  const title = String(data?.title || '').trim();
  const artist = String(data?.display_name || data?.handle || '').trim();
  if (title && artist) return `${title} - ${artist}`;
  if (title) return title;
  return `Suno [${songId}]`;
}

async function readErrorDetail(res) {
  try {
    if (typeof res?.text === 'function') {
      const text = await res.text();
      if (!text) return '';
      try {
        const parsed = JSON.parse(text);
        return String(parsed?.detail || parsed?.message || parsed?.reason || '').trim();
      } catch (_) {
        return text.trim().slice(0, 160);
      }
    }
    if (typeof res?.json === 'function') {
      const parsed = await res.json();
      return String(parsed?.detail || parsed?.message || parsed?.reason || '').trim();
    }
    return '';
  } catch (_) {
    return '';
  }
}

/**
 * Resolve Suno song URL to a direct MP4 media link and metadata.
 * Fails loudly when neither `video_url` nor Suno's sanctioned MP4 download
 * endpoint yields a downloadable file (never guesses CDN URLs).
 *
 * @param {string} url - Suno page URL (e.g. https://suno.com/song/<uuid>)
 * @param {number|Object} [optionsOrTimeout={}] - Timeout in ms or resolver options
 * @returns {Promise<{ mediaUrl: string, fileName: string, pageTitle: string, fsId: string, thumbnailUrl: string, sourceKind: 'video_url'|'official_download' }>}
 */
export async function resolveSunoDownloadTarget(url, optionsOrTimeout = {}) {
  const songId = extractSunoSongId(url);
  if (!songId) {
    throw new Error(`Could not extract Suno song UUID from URL: ${url}`);
  }

  const options = typeof optionsOrTimeout === 'number'
    ? { timeoutMs: optionsOrTimeout }
    : (optionsOrTimeout || {});

  const {
    timeoutMs = 8000,
    authToken = '',
    fetchImpl = fetch,
    sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    maxDownloadPolls = 5,
    downloadPollIntervalMs = 1500,
  } = options;

  const normalizedToken = String(authToken || '').trim();

  const fetchWithTimeout = async (endpoint, extraOptions = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(extraOptions.headers || {}),
      };
      return await fetchImpl(endpoint, {
        ...extraOptions,
        signal: controller.signal,
        headers,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  const clipHeaders = normalizedToken
    ? { 'Authorization': `Bearer ${normalizedToken}` }
    : {};

  let clipRes;
  try {
    clipRes = await fetchWithTimeout(`https://studio-api-prod.suno.com/api/clip/${songId}`, {
      headers: clipHeaders,
    });
  } catch (err) {
    throw new Error(`Suno clip API request failed for ${songId}: ${err?.message || err}`);
  }

  if (!clipRes.ok) {
    const detail = await readErrorDetail(clipRes);
    throw new Error(`Suno clip API returned HTTP ${clipRes.status} for ${songId}${detail ? `: ${detail}` : ''}`);
  }

  let data;
  try {
    data = await clipRes.json();
  } catch (err) {
    throw new Error(`Suno clip API returned invalid JSON for ${songId}: ${err?.message || err}`);
  }

  if (!data || typeof data !== 'object') {
    throw new Error(`Suno clip API returned an empty payload for ${songId}`);
  }

  const pageTitle = buildSunoPageTitle(data, songId);
  const thumbnailUrl = isHttpUrl(data.image_large_url)
    ? data.image_large_url.trim()
    : (isHttpUrl(data.image_url) ? data.image_url.trim() : '');

  // 1. Sanctioned public/authorized clip video stream
  if (isUsableSunoMediaUrl(data.video_url)) {
    return {
      mediaUrl: data.video_url.trim(),
      fileName: `${songId}.mp4`,
      pageTitle,
      fsId: songId,
      thumbnailUrl,
      sourceKind: 'video_url',
    };
  }

  // 2. Sanctioned authenticated Suno download endpoint (only when signed in)
  let downloadRefusal = '';
  if (normalizedToken) {
    const endpoint = `https://studio-api-prod.suno.com/api/download/clip/${songId}?format=mp4`;
    const polls = Math.max(1, Number(maxDownloadPolls) || 1);
    for (let attempt = 0; attempt < polls; attempt += 1) {
      let dlRes;
      try {
        dlRes = await fetchWithTimeout(endpoint, {
          headers: { 'Authorization': `Bearer ${normalizedToken}` },
        });
      } catch (err) {
        downloadRefusal = `request failed (${err?.message || err})`;
        break;
      }

      if (!dlRes.ok) {
        const detail = await readErrorDetail(dlRes);
        downloadRefusal = dlRes.status === 401
          ? `HTTP 401 (${detail || 'Unauthorized — Suno __session cookie may be expired'})`
          : `HTTP ${dlRes.status}${detail ? `: ${detail}` : ''}`;
        break;
      }

      let dlData;
      try {
        dlData = await dlRes.json();
      } catch (err) {
        downloadRefusal = `invalid JSON response (${err?.message || err})`;
        break;
      }

      if (dlData?.ok && dlData?.status === 'ready' && isUsableSunoMediaUrl(dlData.download_url)) {
        return {
          mediaUrl: dlData.download_url.trim(),
          fileName: `${songId}.mp4`,
          pageTitle,
          fsId: songId,
          thumbnailUrl,
          sourceKind: 'official_download',
        };
      }

      if (dlData?.ok && dlData?.status === 'processing') {
        if (attempt < polls - 1) {
          await sleepImpl(downloadPollIntervalMs);
          continue;
        }
        downloadRefusal = 'Suno is still rendering the MP4 download (status: processing); retry in a few seconds';
        break;
      }

      const reasonMsg = [dlData?.message, dlData?.detail].filter(Boolean).join(' ').trim();
      const reasonCode = dlData?.reason ? ` (${dlData.reason})` : '';
      downloadRefusal = `${reasonMsg || 'Download denied'}${reasonCode}`.trim();
      break;
    }
  }

  // 3. No downloadable MP4 found — fail loudly with exact diagnostic details
  const mediaEntries = Array.isArray(data.media_urls) ? data.media_urls : [];
  const encodings = Array.from(new Set(mediaEntries.map((entry) => entry?.encoding).filter(Boolean)));
  const hasForbiddenAudio = !data.audio_url || /\/api\/forbidden(?:[/?#]|$)/i.test(String(data.audio_url));

  const reasons = ['video_url is empty'];
  if (hasForbiddenAudio) {
    reasons.push('audio_url is forbidden (/api/forbidden)');
  } else if (isUsableSunoMediaUrl(data.audio_url)) {
    reasons.push('audio_url exists without an MP4 video stream');
  }
  if (encodings.length > 0) {
    reasons.push(`stream is DRM-protected (encoding ${encodings.join(', ')})`);
  }
  if (downloadRefusal) {
    reasons.push(`official MP4 download endpoint refused: ${downloadRefusal}`);
  } else if (!normalizedToken) {
    reasons.push('no Suno __session cookie was found in the browser');
  }

  throw new Error(`Suno provides no downloadable MP4 for "${pageTitle}" (${songId}): ${reasons.join('; ')}.`);
}
