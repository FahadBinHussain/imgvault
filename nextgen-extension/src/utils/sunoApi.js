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

export const SUNO_STUDIO_API = 'https://studio-api-prod.suno.com';
export const SUNO_RIGHTS_PATH = '/api/mango/rights';
export const SUNO_ENCRYPTED_ENCODING = '1.0.0';

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
 * Read the Suno clip metadata and pick the media entry that carries audio.
 * @param {string} songId
 * @param {Object} options
 */
async function fetchSunoClip(songId, { fetchImpl = fetch, timeoutMs = 8000, authToken = '' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { 'Accept': 'application/json' };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetchImpl(`${SUNO_STUDIO_API}/api/clip/${songId}`, { headers, signal: controller.signal });
    if (!res.ok) {
      const detail = await readErrorDetail(res);
      throw new Error(`Suno clip API returned HTTP ${res.status} for ${songId}${detail ? `: ${detail}` : ''}`);
    }
    const data = await res.json();
    if (!data || typeof data !== 'object') {
      throw new Error(`Suno clip API returned an empty payload for ${songId}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function pickSunoAudioMedia(data) {
  const entries = Array.isArray(data?.media_urls) ? data.media_urls : [];
  const encrypted = entries.find((entry) => String(entry?.encoding || '') === SUNO_ENCRYPTED_ENCODING);
  if (encrypted) return { media: encrypted, encrypted: true };
  const plain = entries.find((entry) => isHttpUrl(entry?.url));
  return { media: plain || null, encrypted: false };
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/**
 * Decrypt an encrypted Suno audio stream.
 *
 * Suno serves the audio of many clips as an AES-CTR encrypted blob and hands
 * the browser a key through its own playback license endpoint
 * (`POST /api/mango/rights`). That endpoint answers ANONYMOUS callers with a
 * guest token, so no account is needed:
 *
 *   1. key material  = SHA-256(guest token)  -> AES-GCM key
 *   2. rights.key / rights.iv are base64 blobs shaped
 *      [12-byte gcm iv][gcm ciphertext]; decrypt them with AES-GCM using
 *      aad = utf8(clip id) -> the 16-byte AES-CTR key and the 16-byte iv
 *   3. the cdn blob is AES-CTR encrypted with that key, the counter being the
 *      128-bit big-endian value of the iv, incremented per 16-byte block
 *
 * The result is a normal .m4a (ftyp box at offset 4).
 *
 * @param {string} songId - Suno clip UUID
 * @param {Object} [options]
 * @param {Function} [options.fetchImpl=fetch]
 * @param {number} [options.timeoutMs=30000]
 * @param {string} [options.authToken] - session token, used only as fallback
 *        key material when the license server does not issue a guest token
 * @param {Function} [options.onProgress] - progress reporter
 * @returns {Promise<{ bytes: Uint8Array, byteLength: number, contentType: string, sourceKind: string }>}
 */
export async function decryptSunoEncryptedClip(songId, options = {}) {
  const {
    fetchImpl = fetch,
    timeoutMs = 30000,
    authToken = '',
    onProgress = null,
  } = options;

  const report = (message) => {
    if (typeof onProgress === 'function') {
      try { onProgress(message); } catch (_) { /* progress must never break the download */ }
    }
  };

  report('reading clip metadata');
  const data = await fetchSunoClip(songId, { fetchImpl, timeoutMs: Math.min(timeoutMs, 8000), authToken });
  const { media, encrypted } = pickSunoAudioMedia(data);
  if (!media?.url) {
    throw new Error(`Suno clip ${songId} exposes no downloadable audio stream.`);
  }
  if (!encrypted) {
    throw new Error(`Suno clip ${songId} does not use the encrypted stream format.`);
  }

  report('requesting the playback license');
  const rightsController = new AbortController();
  const rightsTimer = setTimeout(() => rightsController.abort(), Math.min(timeoutMs, 15000));
  let rights;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const rightsRes = await fetchImpl(`${SUNO_STUDIO_API}${SUNO_RIGHTS_PATH}`, {
      method: 'POST',
      headers,
      credentials: 'include',
      signal: rightsController.signal,
      body: JSON.stringify({
        content_params: { content_id: songId, content_type: 'clip' },
      }),
    });
    if (!rightsRes.ok) {
      const detail = await readErrorDetail(rightsRes);
      throw new Error(`Suno license endpoint returned HTTP ${rightsRes.status}${detail ? `: ${detail}` : ''}`);
    }
    rights = await rightsRes.json();
  } catch (err) {
    throw new Error(`Suno license request failed for ${songId}: ${err?.message || err}`);
  } finally {
    clearTimeout(rightsTimer);
  }

  // The license server issues a guest token for anonymous playback. A signed-in
  // caller may get no guest token, in which case the key material is derived
  // from the session token instead - same as the site's own player.
  const material = rights?.glt || String(authToken || '').trim();
  if (!material) {
    throw new Error('Suno license response carried no guest token and no session token was available.');
  }

  const materialBytes = new TextEncoder().encode(material);
  const digest = await crypto.subtle.digest('SHA-256', materialBytes);
  const gcmKey = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);

  const additionalData = new TextEncoder().encode(songId);
  const unwrap = async (blob) => {
    const data2 = base64ToBytes(blob);
    const iv = data2.subarray(0, 12);
    const ciphertext = data2.subarray(12);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData },
      gcmKey,
      ciphertext,
    );
    return new Uint8Array(plain);
  };

  const ctrKey = await unwrap(rights.key);
  const ctrIv = await unwrap(rights.iv);
  if (ctrKey.length !== 16 || ctrIv.length !== 16) {
    throw new Error(`Suno license unwrap returned unexpected sizes (key ${ctrKey.length}, iv ${ctrIv.length}).`);
  }

  report('downloading the encrypted stream');
  const blobController = new AbortController();
  const blobTimer = setTimeout(() => blobController.abort(), timeoutMs);
  let encryptedBytes;
  try {
    const blobRes = await fetchImpl(media.url, { signal: blobController.signal });
    if (!blobRes.ok) {
      throw new Error(`Suno media CDN returned HTTP ${blobRes.status}`);
    }
    encryptedBytes = new Uint8Array(await blobRes.arrayBuffer());
  } catch (err) {
    throw new Error(`Suno media download failed for ${songId}: ${err?.message || err}`);
  } finally {
    clearTimeout(blobTimer);
  }

  report('decrypting');
  const ctrCryptoKey = await crypto.subtle.importKey('raw', ctrKey, { name: 'AES-CTR' }, false, ['decrypt']);
  const decrypted = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-CTR', counter: ctrIv, length: 128 },
    ctrCryptoKey,
    encryptedBytes,
  ));

  const box = String.fromCharCode(decrypted[4], decrypted[5], decrypted[6], decrypted[7]);
  if (box !== 'ftyp') {
    throw new Error(`Suno decryption produced no MP4 container (expected a ftyp box at offset 4, got "${box}").`);
  }

  report(`decrypted ${decrypted.length} bytes`);
  return {
    bytes: decrypted,
    byteLength: decrypted.length,
    contentType: media.content_type || 'audio/mp4',
    sourceKind: 'encrypted_media',
  };
}

export { bytesToBase64 };

/**
 * Resolve Suno song URL to a direct MP4 media link and metadata.
 * Fails loudly when neither `video_url` nor Suno's sanctioned MP4 download
 * endpoint yields a downloadable file (never guesses CDN URLs).
 *
 * Tracks whose audio is served encrypted are reported with
 * `sourceKind: 'encrypted_media'` and `encrypted: true` - the caller then
 * decrypts them with `decryptSunoEncryptedClip`.
 *
 * @param {string} url - Suno page URL (e.g. https://suno.com/song/<uuid>)
 * @param {number|Object} [optionsOrTimeout={}] - Timeout in ms or resolver options
 * @returns {Promise<{ mediaUrl: string, fileName: string, pageTitle: string, fsId: string, thumbnailUrl: string, sourceKind: 'video_url'|'official_download'|'encrypted_media' }>}
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

  // 3. Encrypted audio stream — Suno serves these through its playback
  //    license endpoint. The caller decrypts them locally.
  const { media: encryptedMedia, encrypted } = pickSunoAudioMedia(data);
  if (encrypted && encryptedMedia?.url) {
    return {
      mediaUrl: '',
      encrypted: true,
      clipId: songId,
      fileName: `${songId}.m4a`,
      pageTitle,
      fsId: songId,
      thumbnailUrl,
      sourceKind: 'encrypted_media',
    };
  }

  // 4. No downloadable MP4 found — fail loudly with exact diagnostic details
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
