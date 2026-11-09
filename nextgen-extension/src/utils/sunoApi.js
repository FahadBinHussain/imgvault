/**
 * @fileoverview Suno API client for audio/video downloads and metadata resolution.
 * @description yt-dlp refuses Suno URLs due to AI generation liability policies.
 *              This utility extracts the song UUID from Suno URLs (suno.com / suno.ai)
 *              and resolves metadata + direct streamable media URLs via Suno's
 *              public studio clip/oembed APIs or CDN endpoints.
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

/**
 * Resolve Suno song URL to direct CDN media link and metadata.
 * @param {string} url - Suno page URL (e.g. https://suno.com/song/<uuid>)
 * @param {number} [timeoutMs=8000] - Fetch timeout in ms
 * @returns {Promise<{ mediaUrl: string, fileName: string, pageTitle: string, fsId: string, thumbnailUrl?: string }>}
 */
export async function resolveSunoDownloadTarget(url, timeoutMs = 8000) {
  const songId = extractSunoSongId(url);
  if (!songId) {
    throw new Error(`Could not extract Suno song UUID from URL: ${url}`);
  }

  const defaultMediaUrl = `https://cdn1.suno.ai/${songId}.mp4`;
  let pageTitle = `Suno [${songId}]`;
  let mediaUrl = defaultMediaUrl;
  let thumbnailUrl = `https://cdn2.suno.ai/${songId}.jpeg`;

  const fetchWithTimeout = async (endpoint) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(endpoint, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
    } finally {
      clearTimeout(timer);
    }
  };

  // 1. Try public studio clip API (rich metadata: title, artist, video_url)
  try {
    const res = await fetchWithTimeout(`https://studio-api-prod.suno.com/api/clip/${songId}`);
    if (res.ok) {
      const data = await res.json();
      if (data) {
        const title = (data.title || '').trim();
        const artist = (data.display_name || data.handle || '').trim();
        if (title && artist) {
          pageTitle = `${title} - ${artist}`;
        } else if (title) {
          pageTitle = title;
        }
        if (data.video_url) {
          mediaUrl = data.video_url;
        }
        if (data.image_large_url || data.image_url) {
          thumbnailUrl = data.image_large_url || data.image_url;
        }
        return {
          mediaUrl,
          fileName: `${songId}.mp4`,
          pageTitle,
          fsId: songId,
          thumbnailUrl,
        };
      }
    }
  } catch (_) {
    // Clip API failed, fallback to oembed
  }

  // 2. Try oembed API
  try {
    const oembedUrl = `https://studio-api-prod.suno.com/api/oembed?url=${encodeURIComponent(`https://suno.com/song/${songId}`)}`;
    const res = await fetchWithTimeout(oembedUrl);
    if (res.ok) {
      const data = await res.json();
      if (data?.title) {
        pageTitle = data.title.trim();
      }
    }
  } catch (_) {
    // Fallback to default
  }

  return {
    mediaUrl,
    fileName: `${songId}.mp4`,
    pageTitle,
    fsId: songId,
    thumbnailUrl,
  };
}
