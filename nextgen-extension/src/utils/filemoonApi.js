/**
 * @fileoverview Filemoon / Byse API client for extension use
 * @description Uses /file/list to list all videos, then cross-checks
 *              against DB items by filecode.
 */

const BYSE_API_BASE = 'https://api.byse.sx';

/**
 * Extract filecode from a Filemoon URL.
 * @param {string} url
 * @returns {string|null}
 */
export function extractFilemoonFilecode(url) {
  if (!url) return null;
  const match = String(url).match(/filemoon\.sx\/(?:d|e)\/([a-zA-Z0-9]+)/i);
  return match ? match[1] : null;
}

/**
 * List all files from Byse API.
 * @param {string} apiKey
 * @returns {Promise<Array>}
 */
export async function listAllFilemoonFiles(apiKey) {
  const allFiles = [];
  let page = 1;
  const perPage = 100;
  let totalPages = 1;

  while (page <= totalPages) {
    const resp = await fetch(`${BYSE_API_BASE}/file/list?key=${apiKey}&per_page=${perPage}&page=${page}`);
    if (!resp.ok) throw new Error(`Byse /file/list HTTP ${resp.status}`);
    const result = await resp.json();
    if (result.status !== 200) {
      throw new Error(result.msg || 'Byse API error');
    }

    const files = result.result?.files || [];
    allFiles.push(...files);

    // The byse API names the total count `results_total` (and also reports
    // `pages`/`results`). The old code read `.total`, which the API never
    // sends, so pagination stopped at page 1 — files beyond the first 100
    // were invisible to integrity checks and healthy videos were reported
    // as broken once the account grew past 100 files.
    const reportedTotal = parseInt(
      result.result?.results_total ?? result.result?.total ?? '0',
      10
    );
    const knownTotal = reportedTotal > 0 ? reportedTotal : allFiles.length;
    totalPages = Math.max(1, Math.ceil(knownTotal / perPage));
    page++;

    // Safety net: never loop forever if the API ever stops reporting totals.
    if (files.length < perPage) break;
  }

  return allFiles;
}

/**
 * Resolve a Filemoon file to its HLS streaming playlist URL via the API.
 * The player streams through HLS, and /hls/link is the endpoint that maps
 * a file code to the m3u8. Falls back to this when /file/direct_link is
 * rejected for the account.
 * @param {string} apiKey
 * @param {string} filecode
 * @returns {Promise<string|null>} m3u8 URL or null when unavailable
 */
export async function getFilemoonHlsLink(apiKey, filecode) {
  if (!apiKey || !filecode) return null;
  const resp = await fetch(`${BYSE_API_BASE}/hls/link?key=${apiKey}&file_code=${filecode}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`Byse /hls/link HTTP ${resp.status}`);
  const result = await resp.json();
  if (result.status !== 200) {
    throw new Error(`Byse /hls/link rejected: ${result.msg || result.status}`);
  }
  const data = result.result && typeof result.result === 'object' ? result.result : {};
  return data.link || data.url || data.hls || data.m3u8 || data.file_url || null;
}

/**
 * Get info for a single file by filecode.
 * @param {string} apiKey
 * @param {string} filecode
 * @returns {Promise<Object|null>}
 */
export async function getFilemoonFileInfo(apiKey, filecode) {
  const resp = await fetch(`${BYSE_API_BASE}/file/info?key=${apiKey}&file_code=${filecode}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`Byse /file/info HTTP ${resp.status}`);
  const result = await resp.json();
  if (result.status !== 200) return null;
  return result.result || null;
}

/**
 * Resolve a Filemoon file to its real direct file URL via the API.
 * The /d/ and /e/ pages only serve HTML, so retries need the raw file URL.
 * @param {string} apiKey
 * @param {string} filecode
 * @returns {Promise<string|null>} Direct file URL or null when unavailable
 */
export async function getFilemoonDirectLink(apiKey, filecode) {
  if (!apiKey || !filecode) return null;
  const resp = await fetch(`${BYSE_API_BASE}/file/direct_link?key=${apiKey}&file_code=${filecode}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`Byse /file/direct_link HTTP ${resp.status}`);
  const result = await resp.json();
  if (result.status !== 200) {
    throw new Error(`Byse /file/direct_link rejected: ${result.msg || result.status}`);
  }
  // Some Byse responses return an array, others a single object.
  const entries = Array.isArray(result.result) ? result.result : [result.result];
  const directFileUrl = entries.map((entry) => entry?.file_url).find(Boolean) || null;
  if (!directFileUrl) {
    throw new Error('Byse /file/direct_link returned no file_url');
  }
  return directFileUrl;
}

/**
 * Delete a file on Filemoon via Byse API.
 * @param {string} apiKey
 * @param {string} filecode
 * @returns {Promise<boolean>}
 */
export async function deleteFilemoonFile(apiKey, filecode) {
  const resp = await fetch(`${BYSE_API_BASE}/file/delete?key=${apiKey}&file_code=${filecode}`);
  if (!resp.ok) throw new Error(`Byse /file/delete HTTP ${resp.status}`);
  const result = await resp.json();
  if (result.status !== 200) {
    throw new Error(result.msg || 'Delete failed');
  }
  return true;
}

/**
 * Full Filemoon integrity check.
 * @param {Array} items - DB media items with filemoonUrl/filemoonWatchUrl/filemoonDirectUrl
 * @param {string} apiKey
 * @returns {Promise<{found:[],missing:[],noUrl:[],extra:[]}>}
 */
export async function checkFilemoonIntegrity(items, apiKey) {
  const found = [];
  const missing = [];
  const noUrl = [];
  const extra = [];

  let filemoonFiles = [];
  let filemoonMap = new Map();
  let listingSucceeded = false;

  try {
    filemoonFiles = await listAllFilemoonFiles(apiKey);
    for (const f of filemoonFiles) {
      const code = f.file_code || f.filecode || '';
      if (code) filemoonMap.set(code, f);
    }
    listingSucceeded = true;
    console.log(`[filemoonApi] Listed ${filemoonFiles.length} Filemoon files.`);
  } catch (err) {
    console.warn('[filemoonApi] /file/list failed, falling back to per-file checks:', err.message);
  }

  const dbCodes = new Set();

  for (const item of items) {
    const urls = [
      item.filemoonWatchUrl,
      item.filemoonDirectUrl,
      item.filemoonUrl,
    ].filter(Boolean);

    const codes = urls.map(extractFilemoonFilecode).filter(Boolean);
    const uniqueCodes = [...new Set(codes)];

    if (!uniqueCodes.length) {
      noUrl.push({ item, codes: [] });
      continue;
    }

    uniqueCodes.forEach((c) => dbCodes.add(c));

    let matchedFile = null;
    if (listingSucceeded) {
      matchedFile = uniqueCodes.map((code) => filemoonMap.get(code)).find(Boolean) || null;
    }

    if (!matchedFile && !listingSucceeded) {
      for (const code of uniqueCodes) {
        const info = await getFilemoonFileInfo(apiKey, code);
        if (info) {
          matchedFile = { file_code: code, ...info };
          break;
        }
      }
    }

    if (matchedFile) {
      found.push({ item, codes: uniqueCodes, matchedFile });
    } else {
      missing.push({ item, codes: uniqueCodes });
    }
  }

  if (listingSucceeded) {
    for (const file of filemoonFiles) {
      const code = file.file_code || file.filecode || '';
      if (code && !dbCodes.has(code)) {
        extra.push({ file });
      }
    }
  }

  return { found, missing, noUrl, extra };
}
