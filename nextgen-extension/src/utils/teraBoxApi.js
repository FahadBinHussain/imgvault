/**
 * @fileoverview TeraBox API v2 client for the resolve-page integrity check.
 * @description Lists all files on the TeraBox account via /api/list (recursing
 *              into folders) and cross-checks against DB video items by fs_id
 *              or filename. Auth is the session cookie (ndus + browserid +
 *              lang); the cookie can be provided explicitly or read live from
 *              the browser session via chrome.cookies.
 */

const TERABOX_API_BASE = 'https://dm.terabox.com';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

const userAgent = () =>
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function resolveCookie(explicitCookie) {
  const trimmed = String(explicitCookie || '').trim();
  if (trimmed) return trimmed;
  if (typeof chrome !== 'undefined' && chrome.cookies?.getAll) {
    const all = await chrome.cookies.getAll({ domain: 'terabox.com' });
    const wanted = new Set(['ndus', 'browserid', 'lang', 'bdstoken', 'PANWEB', 'cuid']);
    const parts = all
      .filter((c) => wanted.has(c.name))
      .map((c) => `${c.name}=${c.value}`);
    if (parts.length > 0) return parts.join('; ');
  }
  return '';
}

async function fetchJsToken(cookie) {
  const res = await fetch(`${TERABOX_API_BASE}/`, {
    headers: { 'Cookie': cookie, 'User-Agent': userAgent(), 'Referer': `${TERABOX_API_BASE}/` },
  });
  const html = await res.text();
  const m = html.match(/function%20fn%28a%29%7Bwindow\.jsToken%20%3D%20a%7D%3Bfn%28%22([^%"]+)%22%29/);
  return m?.[1] || '';
}

/**
 * Authorize with TeraBox: resolve the cookie and a fresh jsToken.
 * @returns {Promise<{cookie:string, jsToken:string}|null>} null when no cookie
 */
export async function authorizeTeraBox(explicitCookie) {
  const cookie = await resolveCookie(explicitCookie);
  if (!cookie) return null;
  const jsToken = await fetchJsToken(cookie);
  return { cookie, jsToken };
}

async function request(cookie, jsToken, pathname, params = {}, retried = false) {
  const qp = new URLSearchParams({
    app_id: '250528',
    web: '1',
    channel: 'dubox',
    clienttype: '0',
    ...(jsToken ? { jsToken } : {}),
    ...params,
  });
  const res = await fetch(`${TERABOX_API_BASE}${pathname}?${qp}`, {
    method: 'GET',
    headers: {
      'Cookie': cookie,
      'Accept': 'application/json, text/plain, */*',
      'Referer': `${TERABOX_API_BASE}/`,
      'User-Agent': userAgent(),
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  let json;
  try {
    json = await res.json();
  } catch {
    return null;
  }
  if (json.errno === 4000023 && !retried) {
    const fresh = await fetchJsToken(cookie);
    if (fresh) return request(cookie, fresh, pathname, params, true);
  }
  return json;
}

/**
 * List the contents of a single TeraBox folder.
 * @returns {Promise<Array>} files, or [] on error
 */
async function listTeraBoxFolder(cookie, jsToken, dir = '/') {
  const json = await request(cookie, jsToken, '/api/list', {
    dir,
    order: 'time',
    desc: '1',
    showempty: '0',
    web_tt: '1',
    num: '100',
    page: '1',
  });
  if (!json || json.errno !== 0 || !Array.isArray(json.list)) return [];
  return json.list;
}

/**
 * Recursively list ALL files across every folder.
 * @returns {Promise<Array<{fs_id, path, server_filename, size, isdir, _folder}>>}
 */
export async function listAllTeraBoxFiles(explicitCookie) {
  const auth = await authorizeTeraBox(explicitCookie);
  if (!auth) throw new Error('No TeraBox cookie. Log in to TeraBox or set the cookie in Settings.');

  const allFiles = [];
  const queue = [{ dir: '/', folder: 'root' }];
  const visited = new Set();

  while (queue.length > 0) {
    const { dir, folder } = queue.shift();
    if (visited.has(dir)) continue;
    visited.add(dir);

    const entries = await listTeraBoxFolder(auth.cookie, auth.jsToken, dir);
    for (const entry of entries) {
      if (entry.isdir === 1) {
        const subDir = String(entry.path || `${dir}${dir.endsWith('/') ? '' : '/'}${entry.server_filename}`);
        if (!visited.has(subDir)) {
          queue.push({ dir: subDir, folder: entry.server_filename || subDir });
        }
      } else {
        allFiles.push({
          fs_id: String(entry.fs_id),
          path: String(entry.path || ''),
          server_filename: String(entry.server_filename || ''),
          size: Number(entry.size || 0),
          isdir: 0,
          _folder: folder,
          // aliases for the resolve-page match helpers (file.name / filename)
          name: String(entry.server_filename || ''),
          filename: String(entry.server_filename || ''),
          title: String(entry.server_filename || ''),
          file_name: String(entry.server_filename || ''),
        });
      }
    }
  }

  return allFiles;
}

/**
 * Extract a TeraBox file id from an item's stored terabox links.
 */
export function extractTeraBoxFileId(item = {}) {
  const links = item?.videoHosts?.terabox || {};
  const raw = String(links.fileId || links.fs_id || item.teraboxFileId || '');
  return raw.trim();
}

/**
 * Full TeraBox integrity check.
 * @param {Array} items - DB media items (live + vaulted merged)
 * @param {string} cookie
 * @returns {Promise<{found:[],missing:[],noUrl:[],extra:[]}>}
 */
export async function checkTeraBoxIntegrity(items, cookie) {
  const found = [];
  const missing = [];
  const noUrl = [];
  const extra = [];

  let files = [];
  let listingSucceeded = false;
  try {
    files = await listAllTeraBoxFiles(cookie);
    listingSucceeded = true;
    console.log(`[teraBoxApi] Listed ${files.length} TeraBox files.`);
  } catch (err) {
    console.warn('[teraBoxApi] list failed:', err.message);
  }

  const fileMap = new Map();
  for (const f of files) {
    if (f.fs_id) fileMap.set(f.fs_id, f);
    if (f.server_filename) fileMap.set(f.server_filename, f);
  }

  const dbIds = new Set();
  const dbNames = new Set();

  for (const item of items) {
    if (!item) continue;
    const links = item?.videoHosts?.terabox || {};
    const hasLink = Boolean(
      links.watchUrl || links.directUrl || links.url ||
      item.teraboxWatchUrl || item.teraboxDirectUrl || item.teraboxUrl
    );
    const fileId = extractTeraBoxFileId(item);
    const fileName = String(links.filename || item.teraboxFileName || item.fileName || '').trim();

    if (!hasLink && !fileId) {
      noUrl.push({ item });
      continue;
    }

    let matchedFile = null;
    if (listingSucceeded) {
      matchedFile = (fileId && fileMap.get(fileId)) || (fileName && fileMap.get(fileName)) || null;
    }

    if (fileId) dbIds.add(fileId);
    if (fileName) dbNames.add(fileName);

    if (matchedFile) {
      found.push({ item, matchedFile });
    } else {
      missing.push({ item });
    }
  }

  if (listingSucceeded) {
    for (const file of files) {
      if (file.fs_id && dbIds.has(file.fs_id)) continue;
      if (file.server_filename && dbNames.has(file.server_filename)) continue;
      extra.push({ file });
    }
  }

  return { found, missing, noUrl, extra };
}
