/**
 * @fileoverview TeraBox API v2 client for the resolve-page integrity check.
 * @description Lists all files on the TeraBox account via /api/list (recursing
 *              into folders) and cross-checks against DB video items by fs_id
 *              or filename. Auth is the session cookie (ndus + browserid +
 *              lang); the cookie can be provided explicitly or read live from
 *              the browser session via chrome.cookies.
 */

const TERABOX_API_BASE = 'https://dm.terabox.com';
// Only the dm homepage moved to a captcha gate (breaks jsToken scraping), so
// the token is scraped from www while all /api/* calls stay on dm (which is
// where the PCS API actually works). Fixed in 2.11.8.
const TERABOX_TOKEN_BASE = 'https://www.terabox.com';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

const userAgent = () =>
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
async function listTeraBoxFolder(cookie, jsToken, dir = '/') {
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
    if (!json || json.errno !== 0 || !Array.isArray(json.list)) break;
    all.push(...json.list);
    if (json.list.length < num) break;
    page += 1;
    if (page > 100) break; // safety: never loop forever
  }
  return all;
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
  const entries = await listTeraBoxFolder(auth.cookie, auth.jsToken, '/');
  for (const entry of entries) {
    if (entry.isdir === 1) continue;
    if (String(entry.fs_id) !== target) continue;
    const thumbs = entry.thumbs && typeof entry.thumbs === 'object' ? entry.thumbs : {};
    return String(thumbs.url3 || thumbs.url2 || thumbs.url1 || thumbs.icon || '');
  }
  return '';
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
    const entries = await listTeraBoxFolder(auth.cookie, auth.jsToken, '/');
    const hit = entries.find((entry) => entry.isdir !== 1 && String(entry.fs_id) === target);
    path = String(hit?.path || '');
    if (!path && fileName) {
      const byName = entries.find((entry) => entry.isdir !== 1 && String(entry.server_filename || '') === String(fileName));
      path = String(byName?.path || '');
    }
  } else if (fileName) {
    const entries = await listTeraBoxFolder(auth.cookie, auth.jsToken, '/');
    const byName = entries.find((entry) => entry.isdir !== 1 && String(entry.server_filename || '') === String(fileName));
    path = String(byName?.path || '');
  }
  if (!path) return '';

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
