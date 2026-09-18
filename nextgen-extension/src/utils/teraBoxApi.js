/**
 * @fileoverview TeraBox API v2 client for the resolve-page integrity check.
 * @description Lists all files on the TeraBox account via /api/list (recursing
 *              into folders) and cross-checks against DB video items by fs_id
 *              or filename. Auth is the session cookie (ndus + browserid +
 *              lang); the cookie can be provided explicitly or read live from
 *              the browser session via chrome.cookies.
 */

import { getVideoProviderLinks } from './videoProviderLinks.js';
import { MODEL_EXT_RE, SCENE_TEXTURE_EXT_RE } from './udropApi.js';

const TERABOX_API_BASE = 'https://dm.terabox.com';
// Only the dm homepage moved to a captcha gate (breaks jsToken scraping), so
// the token is scraped from www while all /api/* calls stay on dm (which is
// where the PCS API actually works). Fixed in 2.11.8.
const TERABOX_TOKEN_BASE = 'https://www.terabox.com';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

const userAgent = () =>
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// fs_id -> path cache for dlna dlink resolution. `resolveTeraBoxPlaybackUrl`
// paginates the ENTIRE root folder to find the target file's path before
// /api/filemetas; vault streaming needs a fresh dlink per 8MiB range read and
// re-paginating the folder every time would make each chunk fetch take seconds
// of API churn. the vault blob file doesn't move, so the path is stable for the
// life of the SW. cleared never (session-scoped) — a file move is rare and the
// fallback re-paginates when the dlink comes back empty.
const _teraBoxFsPathCache = new Map();

async function resolveCookie(explicitCookie) {
  const trimmed = String(explicitCookie || '').trim();
  if (trimmed) return trimmed;
  if (typeof chrome !== 'undefined' && chrome.cookies?.getAll) {
    const all = await chrome.cookies.getAll({ domain: 'terabox.com' });
    // include ALL terabox cookies — captcha solve may set a verification
    // cookie that the old wanted-set filter would drop. fixed 2.11.15.
    const parts = all.map((c) => `${c.name}=${c.value}`);
    if (parts.length > 0) return parts.join('; ');
  }
  return '';
}

async function fetchJsTokenViaHiddenTab(timeoutMs = 15000) {
  if (typeof chrome === 'undefined' || !chrome.tabs?.create || !chrome.scripting?.executeScript) return '';
  let tabId = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hardCap = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs + 20000));
  const work = (async () => {
    try {
      const tab = await chrome.tabs.create({ url: `${TERABOX_TOKEN_BASE}/`, active: false, pinned: false });
      tabId = tab.id;
      const loaded = await new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
          let done = false;
          try {
            chrome.tabs.get(tabId, (t) => {
              done = true;
              if (chrome.runtime.lastError || !t) return resolve(false);
              if (t.status === 'complete') return resolve(true);
              if (Date.now() - start > timeoutMs) return resolve(false);
              setTimeout(check, 300);
            });
          } catch (_) {}
          if (!done && Date.now() - start > timeoutMs) resolve(false);
        };
        check();
      });
      if (!loaded) await sleep(800);
      try {
        const hasCaptcha = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => !!document.getElementById('canvas') && !!document.getElementById('input'),
        });
        if (hasCaptcha?.[0]?.result) {
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              try {
                const c = typeof code !== 'undefined' ? code : '';
                const input = document.getElementById('input');
                if (input && c) input.value = c;
                const btn = document.getElementById('confirm');
                if (btn) btn.click();
              } catch (_) {}
            },
          });
          await new Promise((resolve) => {
            const start2 = Date.now();
            const check2 = () => {
              let done = false;
              try {
                chrome.tabs.get(tabId, (t) => {
                  done = true;
                  if (chrome.runtime.lastError || !t) return resolve(false);
                  if (t.status === 'complete' && t.url && !t.url.includes('simple-verify')) return resolve(true);
                  if (Date.now() - start2 > 8000) return resolve(false);
                  setTimeout(check2, 300);
                });
              } catch (_) {}
              if (!done && Date.now() - start2 > 8000) resolve(false);
            };
            setTimeout(() => check2(), 600);
          });
          await sleep(1000);
        }
      } catch (_) {}
      let token = '';
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => window.jsToken || '',
          });
          if (results?.[0]?.result) { token = results[0].result; break; }
        } catch (_) {}
        await sleep(500);
      }
      let tabCookie = '';
      try {
        const cookieResults = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => document.cookie,
        });
        if (cookieResults?.[0]?.result) tabCookie = cookieResults[0].result;
      } catch (_) {}
      if (token) {
        try {
          await chrome.storage.local.set({
            teraboxJsToken: token, teraboxJsTokenAt: Date.now(),
            teraboxTabCookie: tabCookie, teraboxTabCookieAt: Date.now(),
          });
        } catch (_) {}
        if (tabCookie) return `${token}|${tabCookie}`;
        return token;
      }
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => document.documentElement.outerHTML,
        });
        const html = results?.[0]?.result || '';
        const m = html.match(/function%20fn%28a%29%7Bwindow\.jsToken%20%3D%20a%7D%3Bfn%28%22([^%"]+)%22%29/);
        if (m?.[1]) {
          try {
            await chrome.storage.local.set({
              teraboxJsToken: m[1], teraboxJsTokenAt: Date.now(),
              teraboxTabCookie: tabCookie, teraboxTabCookieAt: Date.now(),
            });
          } catch (_) {}
          if (tabCookie) return `${m[1]}|${tabCookie}`;
          return m[1];
        }
      } catch (_) {}
      return '';
    } catch (_) {
      return '';
    } finally {
      if (tabId != null) {
        try { await chrome.tabs.remove(tabId); } catch (_) {}
      }
    }
  })();
  const result = await Promise.race([work, hardCap]);
  if (tabId != null) {
    try { await chrome.tabs.remove(tabId); } catch (_) {}
  }
  return result === false ? '' : (result || '');
}

/**
 * Fetch page-context tokens for write ops (filemanager delete): jsToken +
 * bdstoken + dp-logid, scraped from the /main page's templateData in a hidden
 * tab. Read-only /api/list works with jsToken alone, but filemanager rejects
 * calls without bdstoken (errno -6). Cached ~12h like jsToken.
 * @returns {Promise<{jsToken:string,bdstoken:string,dpLogid:string}>}
 */
async function fetchTeraBoxPageContext(cookie, forceFresh = false) {
  const empty = { jsToken: '', bdstoken: '', dpLogid: '' };
  if (!forceFresh) {
    try {
      const cached = await chrome.storage.local.get(['teraboxPageCtx', 'teraboxPageCtxAt']);
      if (cached?.teraboxPageCtx && Date.now() - (cached.teraboxPageCtxAt || 0) < 1000 * 60 * 60 * 12) {
        return { ...empty, ...cached.teraboxPageCtx };
      }
    } catch (_) {}
  }
  if (typeof chrome === 'undefined' || !chrome.tabs?.create || !chrome.scripting?.executeScript) return empty;
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url: `${TERABOX_TOKEN_BASE}/main`, active: false, pinned: false });
    tabId = tab.id;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let ready = false;
    for (let i = 0; i < 50 && !ready; i++) {
      await sleep(300);
      try {
        const done = await new Promise((resolve) => {
          chrome.tabs.get(tabId, (t) => {
            if (chrome.runtime.lastError || !t) return resolve(false);
            resolve(t.status === 'complete');
          });
        });
        if (done) ready = true;
      } catch (_) {}
    }
    if (!ready) await sleep(800);
    let ctx = empty;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          jsToken: window.jsToken || '',
          html: document.documentElement.outerHTML.slice(0, 200000),
        }),
      });
      const payload = results?.[0]?.result || {};
      const html = String(payload.html || '');
      const js = String(payload.jsToken || '');
      const bd = html.match(/"bdstoken"\s*:\s*"([^"]+)"/)?.[1] || '';
      const dp = html.match(/dp-logid[=:]([^&"'\s<>]+)/)?.[1] || '';
      const fnTok = html.match(/fn\("([A-Za-z0-9]{10,})"\)/)?.[1] || '';
      ctx = { jsToken: js || fnTok, bdstoken: bd, dpLogid: dp };
    } catch (_) {}
    if (ctx.jsToken || ctx.bdstoken) {
      try { await chrome.storage.local.set({ teraboxPageCtx: ctx, teraboxPageCtxAt: Date.now() }); } catch (_) {}
    }
    return ctx;
  } catch (_) {
    return empty;
  } finally {
    if (tabId != null) {
      try { await chrome.tabs.remove(tabId); } catch (_) {}
    }
  }
}

async function fetchJsToken(cookie, forceFresh = false) {
  // hidden tab avoids Sec-Fetch-* gate. fetch() from a chrome-extension page
  // always sends Sec-Fetch-Site: cross-site etc. and TeraBox redirects that
  // to /simple-verify (no jsToken). a real navigation via chrome.tabs.create
  // is silent (active:false) and gets the landing page. 2.11.13.
  // cached token + tab cookie (valid ~hours) unless forceFresh (e.g. after a
  // 4000023 need-verify — the cached token may itself be stale).
  if (!forceFresh) {
    try {
      const cached = await chrome.storage.local.get([
        'teraboxJsToken', 'teraboxJsTokenAt', 'teraboxTabCookie', 'teraboxTabCookieAt',
      ]);
      if (cached?.teraboxJsToken && Date.now() - (cached.teraboxJsTokenAt || 0) < 1000 * 60 * 60 * 12) {
        if (cached.teraboxTabCookie && Date.now() - (cached.teraboxTabCookieAt || 0) < 1000 * 60 * 60 * 12) {
          return `${cached.teraboxJsToken}|${cached.teraboxTabCookie}`;
        }
        return cached.teraboxJsToken;
      }
    } catch (_) {}
  }
  let token = await fetchJsTokenViaHiddenTab();
  if (token) return token;
  // last resort: bare fetch (may still hit simple-verify, but try)
  let res;
  try {
    res = await fetch(`${TERABOX_TOKEN_BASE}/`, {
      credentials: 'omit',
      headers: { 'User-Agent': userAgent() },
    });
  } catch (_) {
    return '';
  }
  const html = await res.text();
  const m = html.match(/function%20fn%28a%29%7Bwindow\.jsToken%20%3D%20a%7D%3Bfn%28%22([^%"]+)%22%29/);
  if (m?.[1]) {
    try { await chrome.storage.local.set({ teraboxJsToken: m[1], teraboxJsTokenAt: Date.now() }); } catch (_) {}
    return m[1];
  }
  return '';
}

/**
 * Authorize with TeraBox: resolve the cookie and a fresh jsToken.
 * fetchJsToken may return "token|cookie" when the hidden tab captured a fresh
 * session cookie after captcha verify — prefer that cookie for API calls so
 * any verification cookie is included (fixes errno 4000023 need verify).
 * @returns {Promise<{cookie:string, jsToken:string}|null>} null when no cookie
 */
export async function authorizeTeraBox(explicitCookie) {
  const resolvedCookie = await resolveCookie(explicitCookie);
  if (!resolvedCookie) return null;
  const jsTokenOrBoth = await fetchJsToken(resolvedCookie);
  let jsToken = jsTokenOrBoth;
  let cookie = resolvedCookie;
  if (typeof jsTokenOrBoth === 'string' && jsTokenOrBoth.includes('|')) {
    const idx = jsTokenOrBoth.indexOf('|');
    jsToken = jsTokenOrBoth.slice(0, idx);
    const tabCookie = jsTokenOrBoth.slice(idx + 1);
    if (tabCookie) {
      // merge tab cookie into resolvedCookie — document.cookie excludes
      // httpOnly cookies like ndus, so we must not overwrite, only add
      // extra cookie names the tab picked up (verify cookie, etc.)
      const map = new Map();
      resolvedCookie.split(';').filter(Boolean).forEach((s) => {
        const i = s.indexOf('=');
        const name = i > 0 ? s.trim().slice(0, i).trim() : '';
        if (name) map.set(name, i > 0 ? s.trim().slice(i + 1) : '');
      });
      tabCookie.split(';').filter(Boolean).forEach((s) => {
        const i = s.indexOf('=');
        const name = i > 0 ? s.trim().slice(0, i).trim() : '';
        if (name && !map.has(name)) map.set(name, i > 0 ? s.trim().slice(i + 1) : '');
      });
      cookie = Array.from(map, ([n, v]) => `${n}=${v}`).join('; ');
    }
  }
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
    // stale/invalid jsToken (or need-verify) → force a fresh token from the
    // hidden tab (bypass cache) and retry once (driver behaviour).
    const fresh = await fetchJsToken(cookie, true);
    if (fresh) return request(cookie, fresh, pathname, params, true);
  }
  return json;
}

/**
 * List the contents of a single TeraBox folder, paginating past the 100-per-
 * page cap. The old code only fetched page 1 (`num:100, page:1`) so once the
 * account passed 100 files every file beyond the first page showed up as
 * "broken" on the resolve integrity check (same bug class as the byse
 * file/list 100-cap). Loop pages until a page returns fewer than `num`.
 * @returns {Promise<Array>} files, or [] on error
 */
async function listTeraBoxFolder(cookie, jsToken, dir = '/', onPage) {
  const num = 100;
  const all = [];
  let page = 1;
  for (;;) {
    const json = await request(cookie, jsToken, '/api/list', {
      dir,
      order: 'time',
      desc: '1',
      showempty: '0',
      web_tt: '1',
      num: String(num),
      page: String(page),
    });
    // Partial/failed listings are never usable for integrity counts — every
    // file beyond the failure point would flip healthy items to "broken"
    // (same failure mode as the 2.12.78 udrop storm). Fail loud instead.
    if (!json) throw new Error(`TeraBox /api/list returned no response for ${dir} page ${page}.`);
    if (json.errno !== 0 || !Array.isArray(json.list)) {
      throw new Error(`TeraBox /api/list failed for ${dir} page ${page}: errno=${json.errno}${json.errmsg ? ` (${String(json.errmsg).slice(0, 80)})` : ''}`);
    }
    all.push(...json.list);
    try { onPage?.({ dir, page, pageCount: all.length }); } catch (_) {}
    if (json.list.length < num) break;
    page += 1;
    if (page > 100) throw new Error(`TeraBox /api/list exceeded 100 pages for ${dir} — aborting with no counts rather than a truncated listing.`);
  }
  return all;
}

/**
 * Root-folder list for the RESOLVER helpers (thumbnail/playback URL refresh).
 * These run in the vault-stream hot path where the established contract is
 * "return '' when unavailable" and the failure surfaces loudly upstream, so
 * a listing error here must not throw — integrity checks use
 * listAllTeraBoxFiles, which propagates failures on purpose.
 */
async function listTeraBoxFolderSafe(auth) {
  try {
    return await listTeraBoxFolder(auth.cookie, auth.jsToken, '/');
  } catch (err) {
    console.warn(`[teraBoxApi] root listing failed in resolver: ${err.message}`);
    return [];
  }
}

/**
 * Recursively list ALL files across every folder.
 * @returns {Promise<Array<{fs_id, path, server_filename, size, isdir, _folder}>>}
 */
export async function listAllTeraBoxFiles(explicitCookie, onProgress) {
  try { onProgress?.({ phase: 'token' }); } catch (_) {}
  const auth = await authorizeTeraBox(explicitCookie);
  if (!auth) throw new Error('No TeraBox cookie. Log in to TeraBox or set the cookie in Settings.');

  const allFiles = [];
  const queue = [{ dir: '/', folder: 'root' }];
  const visited = new Set();

  while (queue.length > 0) {
    const { dir, folder } = queue.shift();
    if (visited.has(dir)) continue;
    visited.add(dir);

    const entries = await listTeraBoxFolder(auth.cookie, auth.jsToken, dir, () => {
      try { onProgress?.({ phase: 'list', folder, files: allFiles.length, foldersLeft: queue.length }); } catch (_) {}
    });
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
    try { onProgress?.({ phase: 'list', folder, files: allFiles.length, foldersLeft: queue.length }); } catch (_) {}
  }

  return allFiles;
}

/**
 * Extract a TeraBox file id from an item's stored terabox links.
 */
export function extractTeraBoxFileId(item = {}) {
  let links = item?.videoHosts?.terabox || {};
  try {
    const merged = getVideoProviderLinks(item || {})?.terabox || {};
    links = { ...merged, ...links };
  } catch (_) {}
  const extraLinks = item?.extraMetadata?.videoHosts?.terabox || {};
  const raw = String(links.fileId || links.fs_id || extraLinks.fileId || extraLinks.fs_id || item.teraboxFileId || '');
  return raw.trim();
}

/**
 * Resolve a TeraBox video thumbnail URL for a file (fs_id). The /api/list
 * response carries `thumbs.{icon,url1,url2,url3}`; pick the largest usable
 * size (url3 ≈ 850px). Returns '' when no thumbnail is available yet.
 * @param {string} explicitCookie - optional explicit session cookie
 * @param {string|number} fsId
 * @returns {Promise<string>}
 */
export async function resolveTeraBoxThumbnail(explicitCookie, fsId) {
  const target = String(fsId || '');
  if (!target) return '';
  let auth;
  try {
    auth = await authorizeTeraBox(explicitCookie);
  } catch (_) {
    return '';
  }
  if (!auth) return '';
  const entries = await listTeraBoxFolderSafe(auth);
  for (const entry of entries) {
    if (entry.isdir === 1) continue;
    if (String(entry.fs_id) !== target) continue;
    const thumbs = entry.thumbs && typeof entry.thumbs === 'object' ? entry.thumbs : {};
    return String(thumbs.url3 || thumbs.url2 || thumbs.url1 || thumbs.icon || '');
  }
  return '';
}

/**
 * Resolve the TeraBox full path for a file (fs_id or filename). Vault blobs
 * are deleted by PATH (filemanager), not fs_id, so the delete flow needs this
 * separately from the dlink. Shares the fs_id -> path cache with the playback
 * resolver. Returns '' when the file is not found in the listing.
 * @param {string} explicitCookie - optional explicit session cookie
 * @param {string|number} fsId
 * @param {string} [fileName] - fallback match by name when fsId lookup misses
 * @returns {Promise<string>}
 */
export async function resolveTeraBoxFilePath(explicitCookie, fsId, fileName = '') {
  const target = String(fsId || '');
  let auth;
  try {
    auth = await authorizeTeraBox(explicitCookie);
  } catch (_) {
    return '';
  }
  if (!auth) return '';

  let path = '';
  if (target) {
    if (_teraBoxFsPathCache.has(target)) {
      path = _teraBoxFsPathCache.get(target);
    } else {
      const entries = await listTeraBoxFolderSafe(auth);
      const hit = entries.find((entry) => entry.isdir !== 1 && String(entry.fs_id) === target);
      path = String(hit?.path || '');
      if (!path && fileName) {
        const byName = entries.find((entry) => entry.isdir !== 1 && String(entry.server_filename || '') === String(fileName));
        path = String(byName?.path || '');
      }
      if (path) _teraBoxFsPathCache.set(target, path);
    }
  } else if (fileName) {
    const entries = await listTeraBoxFolderSafe(auth);
    const byName = entries.find((entry) => entry.isdir !== 1 && String(entry.server_filename || '') === String(fileName));
    path = String(byName?.path || '');
  }
  return path;
}

/**
 * Resolve a fresh, currently-valid TeraBox download link (dlink) for a file.
 * Stored dlinks carry an 8h expiry, so playback must refresh it at open time
 * via /api/filemetas (crack dlna mode). Returns '' when unavailable.
 * @param {string} explicitCookie - optional explicit session cookie
 * @param {string|number} fsId
 * @param {string} [fileName] - fallback match by name when fsId lookup misses
 * @returns {Promise<string>}
 */
export async function resolveTeraBoxPlaybackUrl(explicitCookie, fsId, fileName = '') {
  const path = await resolveTeraBoxFilePath(explicitCookie, fsId, fileName);
  if (!path) return '';

  let auth;
  try {
    auth = await authorizeTeraBox(explicitCookie);
  } catch (_) {
    return '';
  }
  if (!auth) return '';

  const json = await request(auth.cookie, auth.jsToken, '/api/filemetas', {
    target: JSON.stringify([path]),
    dlink: '1',
    origin: 'dlna',
  });
  if (!json || json.errno !== 0 || !Array.isArray(json.info) || !json.info[0]?.dlink) {
    return '';
  }
  return String(json.info[0].dlink);
}

/**
 * Every way an item can point at a TeraBox file: provider links (incl. the
 * nested extraMetadata copy), legacy columns, dlink ?fid= segments, scene
 * spz/texture refs, sceneFiles records, and the vault encrypted blob.
 * Shared by both integrity passes so a file counts as referenced in the
 * video tab exactly when the scene/vault tab considers it linked.
 */
export const baseNameOfTeraBoxUrl = (u) => {
  try {
    const s = String(u || '').split('?')[0];
    const b = s.split('/').pop();
    return b ? decodeURIComponent(b) : '';
  } catch (_) { return ''; }
};
// TeraBox dlinks embed the file id: ?fid=<vuk>-<app>-<fs_id> — the trailing
// numeric segment IS the fs_id (verified against the DB 2026-09-09). Exact,
// unlike basename matching on opaque /file/<hash> dlink paths.
export const teraBoxFsIdFromUrl = (u) => {
  try {
    const m = String(u || '').match(/[?&]fid=([^&#]+)/);
    if (!m) return '';
    const parts = decodeURIComponent(m[1]).split('-');
    const last = parts[parts.length - 1];
    return /^\d+$/.test(last || '') ? last : '';
  } catch (_) { return ''; }
};
export function collectTeraBoxRefs(item, idSet, nameSet) {
  if (!item) return;
  let links = {};
  try {
    links = getVideoProviderLinks(item)?.terabox || {};
  } catch (_) {}
  if (item?.videoHosts?.terabox) links = { ...links, ...item.videoHosts.terabox };
  const extraLinks = item?.extraMetadata?.videoHosts?.terabox || {};
  const addId = (v) => { if (v) idSet.add(String(v)); };
  const addName = (v) => { if (v) nameSet.add(String(v)); };
  addId(links.fileId || links.fs_id || extraLinks.fileId || extraLinks.fs_id || item.teraboxFileId || item.textureFileId || item.encryptedBlobFileId);
  addName(links.filename || extraLinks.filename || item.teraboxFileName || item.fileName);
  for (const u of [
    links.watchUrl, links.directUrl, links.url,
    extraLinks.watchUrl, extraLinks.directUrl, extraLinks.url,
    item.teraboxWatchUrl, item.teraboxDirectUrl, item.teraboxUrl,
    item.spzUrl, item.textureUrl,
    item.encryptedBlobUrl, item.extraMetadata?.encryptedBlobUrl,
  ]) {
    addId(teraBoxFsIdFromUrl(u));
    addName(baseNameOfTeraBoxUrl(u));
  }
  const sf = item?.extraMetadata?.sceneFiles || {};
  for (const part of [sf.spz, sf.texture]) {
    if (!part) continue;
    addId(part.fileId);
    addName(part.filename);
  }
}

/**
 * Full TeraBox integrity check (video tab).
 * Listing failures THROW — a partial/empty listing flips every healthy video
 * to "broken" (the 2.12.78 udrop failure mode). 3D scene files (.spz +
 * textures) and every file referenced by any DB item (videos, scenes, link
 * items, vault blobs) are excluded from the extra list — 3D items are
 * integrity-tracked on the 3D Scene Hosts tab only (2.12.79).
 * @param {Array} items - video DB items (live + vaulted merged, scenes excluded by caller)
 * @param {Array} allItems - every DB item, for the referenced set
 * @param {string} cookie
 * @returns {Promise<{found:[],missing:[],noUrl:[],extra:[]}>}
 */
export async function checkTeraBoxIntegrity(items, allItems, cookie, onProgress) {
  const found = [];
  const missing = [];
  const noUrl = [];
  const extra = [];

  const files = await listAllTeraBoxFiles(cookie, onProgress);
  console.log(`[teraBoxApi] Listed ${files.length} TeraBox files.`);

  const fileMap = new Map();
  for (const f of files) {
    if (f.fs_id) fileMap.set(f.fs_id, f);
    if (f.server_filename) fileMap.set(f.server_filename, f);
  }

  const dbIds = new Set();
  const dbNames = new Set();

  for (const item of items) {
    if (!item) continue;
    let links = item?.videoHosts?.terabox || {};
    try {
      const merged = getVideoProviderLinks(item || {})?.terabox || {};
      links = { ...merged, ...links };
    } catch (_) {}
    const extraLinks = item?.extraMetadata?.videoHosts?.terabox || {};
    const hasLink = Boolean(
      links.watchUrl || links.directUrl || links.url ||
      extraLinks.watchUrl || extraLinks.directUrl || extraLinks.url ||
      item.teraboxWatchUrl || item.teraboxDirectUrl || item.teraboxUrl
    );
    const fileId = extractTeraBoxFileId(item);
    const fileName = String(links.filename || extraLinks.filename || item.teraboxFileName || item.fileName || '').trim();

    if (!hasLink && !fileId) {
      noUrl.push({ item, codes: [] });
      continue;
    }

    const matchedFile = (fileId && fileMap.get(String(fileId))) || (fileName && fileMap.get(fileName)) || null;

    if (fileId) dbIds.add(String(fileId));
    if (fileName) dbNames.add(fileName);

    if (matchedFile) {
      found.push({ item, codes: [], matchedFile });
    } else {
      missing.push({ item, codes: [] });
    }
  }

  const referencedIds = new Set();
  const referencedNames = new Set();
  for (const item of allItems || []) collectTeraBoxRefs(item, referencedIds, referencedNames);
  dbIds.forEach((id) => referencedIds.add(id));
  dbNames.forEach((nm) => referencedNames.add(nm));

  for (const file of files) {
    const name = String(file.server_filename || '');
    if (MODEL_EXT_RE.test(name) || SCENE_TEXTURE_EXT_RE.test(name)) continue;
    if (file.fs_id && referencedIds.has(String(file.fs_id))) continue;
    if (name && referencedNames.has(name)) continue;
    extra.push({ file });
  }

  return { found, missing, noUrl, extra };
}

/**
 * Delete files on TeraBox by EXACT full path (move to recycle bin, recoverable).
 * Safety guards — refuses to delete anything but the given paths:
 * - paths must be absolute (`/…`), never root `/`, never empty
 * - max 10 paths per call (a scene group is 1 .spz + a few textures)
 * - callers must pass `file.path` values from the same listing that produced
 *   the orphan entry — never reconstruct a path from a bare filename
 *   (filenames collide across folders, paths don't).
 * Never calls clearRecycleBin — nothing is permanently wiped from here.
 * @param {string} explicitCookie
 * @param {Array<string>} paths - exact TeraBox full paths (e.g. `/ceramic.spz`)
 * @returns {Promise<boolean>}
 */
export async function deleteTeraBoxFiles(explicitCookie, paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).map((s) => String(s || '')).filter(Boolean);
  if (list.length === 0) throw new Error('No TeraBox paths to delete.');
  if (list.length > 10) throw new Error(`Refusing to delete ${list.length} files at once (cap 10 — delete groups one by one).`);
  for (const p of list) {
    if (!p.startsWith('/')) throw new Error(`Refusing to delete non-absolute path: ${p}`);
    if (p === '/') throw new Error('Refusing to delete root.');
  }
  const auth = await authorizeTeraBox(explicitCookie);
  if (!auth) throw new Error('No TeraBox cookie. Log in to TeraBox or set the cookie in Settings.');
  // NOTE: /api/list only works on the dm base for this account (www returns
  // errno -6 — verified 2.11.8). filemanager is tried on dm first, www as
  // fallback. same paths every attempt, so retries can never touch a
  // different file. write ops additionally send bdstoken + dp-logid from the
  // /main page context — filemanager rejects calls without them (errno -6).
  const trace = [];
  const postDelete = async (base, ctx) => {
    const qp = new URLSearchParams({
      app_id: '250528',
      web: '1',
      channel: 'dubox',
      clienttype: '0',
      ...(ctx.jsToken ? { jsToken: ctx.jsToken } : {}),
      ...(ctx.bdstoken ? { bdstoken: ctx.bdstoken } : {}),
      ...(ctx.dpLogid ? { 'dp-logid': ctx.dpLogid } : {}),
      onnest: 'fail',
      opera: 'delete',
    });
    const body = new URLSearchParams({ filelist: JSON.stringify(list) }).toString().replace(/\+/g, '%20');
    const res = await fetch(`${base}/api/filemanager?${qp}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': auth.cookie,
        'Accept': 'application/json, text/plain, */*',
        'Referer': `${base}/`,
        'User-Agent': userAgent(),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body,
    });
    if (!res.ok) throw new Error(`TeraBox delete HTTP ${res.status} on ${base}`);
    const json = await res.json();
    // Sanitized trace: param presence + server errno only, no secrets.
    trace.push(`${base.replace('https://', '')} errno=${json?.errno ?? '?'}${json?.errmsg ? ` (${String(json.errmsg).slice(0, 80)})` : ''} [jsToken:${ctx.jsToken ? 'y' : 'n'} bdstoken:${ctx.bdstoken ? 'y' : 'n'} dp-logid:${ctx.dpLogid ? 'y' : 'n'}]`);
    try { console.log(`[teraBoxApi] delete attempt: ${trace[trace.length - 1]}`); } catch (_) {}
    return json;
  };
  const stripToken = (t) => (typeof t === 'string' && t.includes('|') ? t.slice(0, t.indexOf('|')) : t);
  const cachedCtx = await fetchTeraBoxPageContext(auth.cookie, false);
  const baseCtx = {
    jsToken: cachedCtx.jsToken || stripToken(auth.jsToken),
    bdstoken: cachedCtx.bdstoken,
    dpLogid: cachedCtx.dpLogid,
  };
  let json = await postDelete(TERABOX_API_BASE, baseCtx);
  if (json && json.errno !== 0) {
    const freshCtx = await fetchTeraBoxPageContext(auth.cookie, true);
    const retryCtx = {
      jsToken: freshCtx.jsToken || stripToken(await fetchJsToken(auth.cookie, true)) || baseCtx.jsToken,
      bdstoken: freshCtx.bdstoken || baseCtx.bdstoken,
      dpLogid: freshCtx.dpLogid || baseCtx.dpLogid,
    };
    json = await postDelete(TERABOX_API_BASE, retryCtx);
    if (json && json.errno !== 0) {
      const fallback = await postDelete(TERABOX_TOKEN_BASE, retryCtx);
      if (fallback && fallback.errno === 0) return true;
      throw new Error(`TeraBox delete failed (${trace.join(' | ')}). Nothing deleted — files are untouched. If this persists, paste the console lines starting with [teraBoxApi].`);
    }
  }
  if (!json || json.errno !== 0) throw new Error(`TeraBox delete error: errno=${json?.errno ?? '?'}. Nothing deleted.`);
  return true;
}

/**
 * TeraBox 3D scene integrity check — symmetric to UDrop checkSceneIntegrity.
 * Scenes are .spz files; video files must never show as scene orphans.
 * Listing failures THROW — never report health from a partial/empty listing.
 * @param {Array} items – scene DB items (filtered)
 * @param {Array} allItems – every DB item; their terabox ids/names are excluded
 *                           from the extra list so videos don't show as scene orphans
 * @param {string} cookie
 * @returns {Promise<{found:[],missing:[],noUrl:[],extra:[]}>}
 */
export async function checkTeraBoxSceneIntegrity(items, allItems, cookie, onProgress) {
  const found = [];
  const missing = [];
  const noUrl = [];
  const extra = [];

  const files = await listAllTeraBoxFiles(cookie, onProgress);
  console.log(`[teraBoxApi] Scene check: listed ${files.length} TeraBox files.`);

  const fileMap = new Map();
  for (const f of files) {
    if (f.fs_id) fileMap.set(String(f.fs_id), f);
    if (f.server_filename) fileMap.set(String(f.server_filename), f);
  }

  // Ids/names referenced by ANY item (videos and vault blobs included) never
  // count as scene orphans. Scene uploads store the companion texture ONLY as
  // textureUrl (+ sizes) or sceneFiles refs, so those must count too (2.12.53).
  const referencedIds = new Set();
  const referencedNames = new Set();
  for (const item of allItems || []) collectTeraBoxRefs(item, referencedIds, referencedNames);

  const dbIds = new Set();
  const dbNames = new Set();

  for (const item of items || []) {
    if (!item) continue;
    let links = item?.videoHosts?.terabox || {};
    try {
      const merged = getVideoProviderLinks(item || {})?.terabox || {};
      links = { ...merged, ...links };
    } catch (_) {}
    const extraLinks = item?.extraMetadata?.videoHosts?.terabox || {};
    // Both files are part of 1 scene — treat spz + texture as a pair (2.12.58)
    const spzFid = extractTeraBoxFileId(item) || teraBoxFsIdFromUrl(item.spzUrl) || String(item.extraMetadata?.sceneFiles?.terabox?.spz?.fileId || '').trim();
    const texFid = teraBoxFsIdFromUrl(item.textureUrl) || String(item.textureFileId || item.extraMetadata?.sceneFiles?.texture?.fileId || '').trim();
    const spzName = String(links.filename || extraLinks.filename || item.teraboxFileName || item.fileName || '').trim();
    const texName = baseNameOfTeraBoxUrl(item.textureUrl);
    // Also consider sceneFiles for texture names
    const sceneTexName = String(item.extraMetadata?.sceneFiles?.texture?.filename || '').trim();
    const effectiveTexName = texName || sceneTexName;
    // Keep legacy single-file vars for dbSets
    const fileId = spzFid;
    const fileName = spzName;
    collectTeraBoxRefs(item, dbIds, dbNames);
    if (texFid) dbIds.add(String(texFid));
    if (effectiveTexName) dbNames.add(effectiveTexName);
    if (spzFid) dbIds.add(String(spzFid));
    if (spzName) dbNames.add(spzName);

    const hasLink = Boolean(
      links.watchUrl || links.directUrl || links.url ||
      extraLinks.watchUrl || extraLinks.directUrl || extraLinks.url ||
      item.teraboxWatchUrl || item.teraboxDirectUrl || item.teraboxUrl ||
      item.spzUrl || item.textureUrl
    );
    // Host-specific ref: generic spzUrl/textureUrl also match foreign-host scenes,
    // which must land in noUrl (never uploaded HERE), not missing.
    const hasTeraboxRef = Boolean(
      links.watchUrl || links.directUrl || links.url ||
      extraLinks.watchUrl || extraLinks.directUrl || extraLinks.url ||
      item.teraboxWatchUrl || item.teraboxDirectUrl || item.teraboxUrl ||
      spzFid || texFid
    );

    if (!hasLink && !spzFid && !texFid && !spzName && !effectiveTexName) {
      noUrl.push({ item, codes: [], spzFid: spzFid || null, texFid: texFid || null, spzMatched: null, texMatched: null });
      continue;
    }

    let spzMatched = null;
    let texMatched = null;
    if (spzFid) spzMatched = fileMap.get(String(spzFid)) || null;
    if (!spzMatched && spzName) spzMatched = fileMap.get(spzName) || null;
    if (!spzMatched && item.spzUrl) {
      const fidFromSpzUrl = teraBoxFsIdFromUrl(item.spzUrl);
      if (fidFromSpzUrl) spzMatched = fileMap.get(String(fidFromSpzUrl)) || spzMatched;
    }
    if (texFid) texMatched = fileMap.get(String(texFid)) || null;
    if (!texMatched && effectiveTexName) texMatched = fileMap.get(effectiveTexName) || null;
    if (!texMatched && item.textureUrl) {
      const fidFromTexUrl = teraBoxFsIdFromUrl(item.textureUrl);
      if (fidFromTexUrl) texMatched = fileMap.get(String(fidFromTexUrl)) || texMatched;
    }

    const needsSpz = Boolean(spzFid || spzName || item.spzUrl);
    const needsTex = Boolean(texFid || effectiveTexName || item.textureUrl);
    const spzOk = !needsSpz || Boolean(spzMatched);
    const texOk = !needsTex || Boolean(texMatched);
    const allOk = spzOk && texOk;
    const anyOk = Boolean(spzMatched || texMatched);
    const matchedFile = spzMatched || texMatched || null;

    if (allOk && anyOk) {
      found.push({ item, matchedFile, codes: [], spzFid: spzFid || null, texFid: texFid || null, spzMatched, texMatched });
    } else if (hasTeraboxRef) {
      missing.push({ item, codes: [], spzFid: spzFid || null, texFid: texFid || null, spzMatched, texMatched });
    } else {
      noUrl.push({ item, codes: [], spzFid: spzFid || null, texFid: texFid || null, spzMatched, texMatched });
    }
  }

  const stemOf = (name) => String(name || '').split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
  const coreOf = (stem) => String(stem || '').split('_').pop().split('-').pop();
  const isOrphanFile = (file) => {
    const fid = String(file.fs_id || '');
    const name = String(file.server_filename || file.name || '');
    if ((fid && (dbIds.has(fid) || referencedIds.has(fid))) || (name && (dbNames.has(name) || referencedNames.has(name)))) return false;
    return true;
  };
  const spzOrphans = [];
  const textureOrphans = [];
  for (const file of files) {
    if (!isOrphanFile(file)) continue;
    const name = String(file.server_filename || file.name || '');
    if (MODEL_EXT_RE.test(name)) spzOrphans.push(file);
    else if (SCENE_TEXTURE_EXT_RE.test(name)) textureOrphans.push(file);
  }
  const usedTextureIdx = new Set();
  for (const spzFile of spzOrphans) {
    const spzStem = stemOf(spzFile.server_filename || spzFile.name || '');
    const spzCore = coreOf(spzStem);
    const mates = [];
    textureOrphans.forEach((texFile, idx) => {
      if (usedTextureIdx.has(idx)) return;
      const texStem = stemOf(texFile.server_filename || texFile.name || '');
      if (texStem === spzStem || texStem === spzCore || spzStem.endsWith(`_${texStem}`) || spzStem.endsWith(`-${texStem}`) || texStem.endsWith(`_${spzCore}`)) {
        mates.push(texFile);
        usedTextureIdx.add(idx);
      }
    });
    extra.push({ file: spzFile, textureFiles: mates });
  }
  textureOrphans.forEach((texFile, idx) => {
    if (usedTextureIdx.has(idx)) return;
    extra.push({ file: texFile, textureFiles: [], standaloneTexture: true });
  });

  return { found, missing, noUrl, extra };
}
