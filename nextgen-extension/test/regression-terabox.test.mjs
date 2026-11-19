// Regression tests mined from the ImgVault bug history (AGENTS.md).
// Area: TeraBox — the tab-burst cooldown (2.19.1), the token cache +
// single-flight guards (2.16.9), the fs_id matching (2.12.54), the
// 100-per-page pagination (2.11.19), and the integrity check that fails
// loud instead of flipping healthy items to "broken" (2.12.79).
//
// Live tests use an in-memory chrome.storage.local stub and a mocked
// globalThis.fetch; no live network, no real credentials. The legacy
// test-terabox-orphan-matching.mjs covers classifyTeraBoxFiles itself,
// so this file pins the seams around it (collect, list, integrity).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  hasTeraBoxSessionCookie,
  teraBoxFsIdFromUrl,
  baseNameOfTeraBoxUrl,
  collectTeraBoxRefs,
  authorizeTeraBox,
  fetchTeraBoxPageContext,
  listAllTeraBoxFiles,
  checkTeraBoxIntegrity,
  deleteTeraBoxFiles,
} from '../src/utils/teraBoxApi.js';
import { createTeraBoxRefIndex, isTeraBoxFileReferenced } from '../../packages/shared/teraboxRefs.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const COOKIE = 'ndus=fake-session; browserid=fake-browser';
const HOUR = 60 * 60 * 1000;

function installChrome(initial = {}) {
  const store = { ...initial };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          if (typeof keys === 'string') return { [keys]: store[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, store[k]]));
          return { ...store };
        },
        set: async (items) => { Object.assign(store, items); },
        remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
      },
    },
    // Deliberately NO tabs/cookies: any test that would open a tab fails
    // by falling through to the (mocked) bare fetch instead.
  };
  return store;
}

function uninstallChrome() {
  delete globalThis.chrome;
}

const jsonResponse = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
  text: async () => JSON.stringify(data),
});

// A dm /api/list mock: pages[`${dir}|${page}`] = array of entries.
function listMock(pages, onCall) {
  return async (url) => {
    const u = new URL(String(url));
    onCall?.(u);
    if (u.hostname === 'www.terabox.com') {
      return { ok: true, status: 200, text: async () => '<html>no token here</html>', json: async () => ({}) };
    }
    const dir = u.searchParams.get('dir') || '/';
    const page = u.searchParams.get('page') || '1';
    const list = pages[`${dir}|${page}`];
    if (list === undefined) return jsonResponse({ errno: 0, list: [] });
    if (list && list.__error) return jsonResponse({ errno: list.__error, errmsg: list.__errmsg || '' });
    return jsonResponse({ errno: 0, list });
  };
}

const fileEntry = (fs_id, server_filename, extra = {}) => ({
  fs_id, server_filename, path: `/${server_filename}`, size: 1000, isdir: 0, ...extra,
});

// ------------------------------------------------------------- cookie ---

test('2.19.1 (2026-11-03): hasTeraBoxSessionCookie only trusts a real ndus= entry', () => {
  assert.equal(hasTeraBoxSessionCookie('ndus=abc; browserid=x'), true);
  assert.equal(hasTeraBoxSessionCookie('browserid=x; ndus=abc'), true);
  assert.equal(hasTeraBoxSessionCookie('browserid=x; lang=en'), false);
  assert.equal(hasTeraBoxSessionCookie('xndus=abc'), false);
  assert.equal(hasTeraBoxSessionCookie(''), false);
  assert.equal(hasTeraBoxSessionCookie(null), false);
});

// ------------------------------------------------------------- fs_id ---

test('2.12.54 (2026-09-09): teraBoxFsIdFromUrl takes the TRAILING segment of ?fid=<vuk>-<app>-<fs_id>', () => {
  assert.equal(teraBoxFsIdFromUrl('https://dm.terabox.com/file/abc?fid=123-456-789012'), '789012');
  assert.equal(teraBoxFsIdFromUrl('https://dm.terabox.com/file/opaquehash?fid=1-2-42&x=1'), '42');
  assert.equal(teraBoxFsIdFromUrl('https://dm.terabox.com/file/opaquehash'), '');
  assert.equal(teraBoxFsIdFromUrl('https://dm.terabox.com/file/x?fid=1-2-notnumeric'), '');
  assert.equal(teraBoxFsIdFromUrl(''), '');
  assert.equal(baseNameOfTeraBoxUrl('https://dm.terabox.com/file/my%20clip.mp4?fid=1-2-3'), 'my clip.mp4');
});

// -------------------------------------------------------------- refs ---

test('2.19.4 (2026-11-03): collectTeraBoxRefs gathers refs from links, dlinks, scenes, and the vault blob', () => {
  const item = {
    fileName: 'clip.mp4',
    videoHosts: { terabox: { watchUrl: 'https://dm.terabox.com/file/a?fid=1-2-1001', filename: 'clip.mp4' } },
    spzUrl: 'https://dm.terabox.com/file/s.spz?fid=1-2-2002',
    textureUrl: 'https://dm.terabox.com/file/t.png?fid=1-2-3003',
    encryptedBlobUrl: 'https://dm.terabox.com/file/b.bin?fid=1-2-4004',
    encryptedBlobFileId: '4004',
    extraMetadata: { sceneFiles: { spz: { fileId: '2002', filename: 's.spz' } } },
  };
  // Without a ref index the legacy sets are populated.
  const ids = new Set();
  const names = new Set();
  collectTeraBoxRefs(item, ids, names, null);
  for (const id of ['1001', '2002', '3003', '4004']) {
    assert.ok(ids.has(id), `id ${id} collected`);
  }
  assert.ok(names.has('clip.mp4'));
  // With a ref index the index is the source of truth (the sets stay empty
  // by design — addPair writes the index OR the sets, never both).
  const refIndex = createTeraBoxRefIndex();
  collectTeraBoxRefs(item, new Set(), new Set(), refIndex);
  assert.ok(isTeraBoxFileReferenced({ fs_id: '2002', server_filename: 's.spz' }, refIndex));
  assert.ok(isTeraBoxFileReferenced({ fs_id: '4004', server_filename: 'b.bin' }, refIndex));
  assert.ok(!isTeraBoxFileReferenced({ fs_id: '9999', server_filename: 'nope.mp4' }, refIndex));
});

// -------------------------------------------------------------- auth ---

test('2.16.9 (2026-10-26): authorizeTeraBox serves the fresh 12h token cache with no tab and no fetch', async () => {
  installChrome({ teraboxJsToken: 'cached-token', teraboxJsTokenAt: Date.now() });
  const realFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches += 1; throw new Error('must not fetch'); };
  try {
    const auth = await authorizeTeraBox(COOKIE);
    assert.deepEqual(auth, { cookie: COOKIE, jsToken: 'cached-token' });
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = realFetch;
    uninstallChrome();
  }
});

test('2.16.9 (2026-10-26): authorizeTeraBox merges a tab cookie in — new names added, ndus never overwritten', async () => {
  installChrome({
    teraboxJsToken: 'cached-token', teraboxJsTokenAt: Date.now(),
    teraboxTabCookie: 'verify=abc123', teraboxTabCookieAt: Date.now(),
  });
  try {
    const auth = await authorizeTeraBox('ndus=fake-session');
    assert.equal(auth.jsToken, 'cached-token');
    assert.equal(auth.cookie, 'ndus=fake-session; verify=abc123');
  } finally {
    uninstallChrome();
  }

  // A tab ndus must never overwrite the explicit one.
  installChrome({
    teraboxJsToken: 'cached-token', teraboxJsTokenAt: Date.now(),
    teraboxTabCookie: 'ndus=tab-value', teraboxTabCookieAt: Date.now(),
  });
  try {
    const auth = await authorizeTeraBox('ndus=fake-session');
    assert.equal(auth.cookie, 'ndus=fake-session');
  } finally {
    uninstallChrome();
  }
});

// FIXED 2.19.23: the tab-cookie merge used to corrupt every cookie
// segment after the first — `i` was computed on the raw segment (with
// its leading space) but the name and value were sliced from `s.trim()`,
// so the name gained a '=' and the value lost its first character
// (measured 2026-11-18: 'ndus=fake-session; browserid=fake-browser' +
// 'ndus=tab-value; verify=abc123' merged to
// 'ndus=fake-session; browserid==ake-browser; verify==bc123'). The
// segment is trimmed BEFORE computing `i` now. The single-segment
// cases above passed because the first segment has no leading space —
// this is the multi-segment case that actually broke.
test('2.19.23: authorizeTeraBox merges multi-segment tab cookies without garbling them', async () => {
  installChrome({
    teraboxJsToken: 'cached-token', teraboxJsTokenAt: Date.now(),
    teraboxTabCookie: 'ndus=tab-value; verify=abc123', teraboxTabCookieAt: Date.now(),
  });
  try {
    const auth = await authorizeTeraBox('ndus=fake-session; browserid=fake-browser');
    assert.equal(auth.jsToken, 'cached-token');
    assert.equal(auth.cookie, 'ndus=fake-session; browserid=fake-browser; verify=abc123');
  } finally {
    uninstallChrome();
  }
});

test('2.16.9 (2026-10-26): authorizeTeraBox with no cookie at all returns null instead of a half-auth', async () => {
  installChrome({});
  try {
    assert.equal(await authorizeTeraBox(''), null);
  } finally {
    uninstallChrome();
  }
});

test('2.16.9 (2026-10-26): authorizeTeraBox falls back to a bare www fetch and caches the scraped token', async () => {
  const store = installChrome({});
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).startsWith('https://www.terabox.com/'));
    return {
      ok: true, status: 200,
      text: async () => 'function%20fn%28a%29%7Bwindow.jsToken%20%3D%20a%7D%3Bfn%28%22scraped-token-9%22%29',
      json: async () => ({}),
    };
  };
  try {
    const auth = await authorizeTeraBox(COOKIE);
    assert.equal(auth.jsToken, 'scraped-token-9');
    assert.equal(store.teraboxJsToken, 'scraped-token-9');
    assert.ok(store.teraboxJsTokenAt > 0);
  } finally {
    globalThis.fetch = realFetch;
    uninstallChrome();
  }
});

// ---------------------------------------------------------- page ctx ---

test('2.16.9 (2026-10-26): fetchTeraBoxPageContext serves the fresh 12h cache and returns empty on a stale cache with no tabs', async () => {
  installChrome({
    teraboxPageCtx: { jsToken: 'ctx-token', bdstoken: 'ctx-bd', dpLogid: 'ctx-log' },
    teraboxPageCtxAt: Date.now(),
  });
  try {
    const ctx = await fetchTeraBoxPageContext(COOKIE);
    assert.equal(ctx.jsToken, 'ctx-token');
    assert.equal(ctx.bdstoken, 'ctx-bd');
    assert.equal(ctx.dpLogid, 'ctx-log');
  } finally {
    uninstallChrome();
  }

  installChrome({
    teraboxPageCtx: { jsToken: 'old', bdstoken: 'old', dpLogid: 'old' },
    teraboxPageCtxAt: Date.now() - 13 * HOUR,
  });
  try {
    const ctx = await fetchTeraBoxPageContext(COOKIE);
    assert.deepEqual(ctx, { jsToken: '', bdstoken: '', dpLogid: '', tabCookie: '' });
  } finally {
    uninstallChrome();
  }
});

test('2.19.1 (2026-11-03): a failed scrape inside the 5-minute backoff returns empty without scraping again', async () => {
  installChrome({ teraboxTokenScrapeFailedAt: Date.now() });
  const realFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches += 1; throw new Error('must not fetch'); };
  try {
    const ctx = await fetchTeraBoxPageContext(COOKIE);
    assert.deepEqual(ctx, { jsToken: '', bdstoken: '', dpLogid: '', tabCookie: '' });
    assert.equal(fetches, 0);
    const auth = await authorizeTeraBox(COOKIE);
    assert.equal(auth.jsToken, '');
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = realFetch;
    uninstallChrome();
  }
});

// ----------------------------------------------------------- listing ---

test('2.11.19 (2026-09-19): listAllTeraBoxFiles paginates past 100 and recurses into folders', async () => {
  installChrome({ teraboxJsToken: 'cached-token', teraboxJsTokenAt: Date.now() });
  const realFetch = globalThis.fetch;
  const page1 = Array.from({ length: 100 }, (_, i) => fileEntry(String(1000 + i), `f${i}.mp4`));
  const page2 = Array.from({ length: 10 }, (_, i) => fileEntry(String(2000 + i), `g${i}.mp4`));
  page2.push({ fs_id: '9000', server_filename: 'gh-mirror', path: '/gh-mirror', size: 0, isdir: 1 });
  globalThis.fetch = listMock({
    '/|1': page1,
    '/|2': page2,
    '/gh-mirror|1': [fileEntry('3000', 'bundle.zip')],
  });
  const phases = [];
  try {
    const files = await listAllTeraBoxFiles(COOKIE, (p) => phases.push(p.phase));
    assert.equal(files.length, 111);
    assert.equal(files.filter((f) => f._folder === 'root').length, 110);
    const bundle = files.find((f) => f.fs_id === '3000');
    assert.equal(bundle._folder, 'gh-mirror');
    assert.ok(phases.includes('token'));
    assert.ok(phases.includes('list'));
  } finally {
    globalThis.fetch = realFetch;
    uninstallChrome();
  }
});

test('2.12.79 (2026-09-14): a listing failure THROWS loudly — a partial listing must never flip healthy items to "broken"', async () => {
  installChrome({ teraboxJsToken: 'cached-token', teraboxJsTokenAt: Date.now() });
  const realFetch = globalThis.fetch;
  globalThis.fetch = listMock({ '/|1': { __error: -6, __errmsg: 'no permission' } });
  try {
    await assert.rejects(
      () => listAllTeraBoxFiles(COOKIE),
      /TeraBox \/api\/list failed for \/ page 1: errno=-6 \(no permission\)/,
    );
  } finally {
    globalThis.fetch = realFetch;
    uninstallChrome();
  }
});

test('2.19.1 (2026-11-03): errno 4000023 inside the force-refresh cooldown does NOT retry and does NOT open a tab', async () => {
  installChrome({
    teraboxJsToken: 'cached-token', teraboxJsTokenAt: Date.now(),
    teraboxTokenForceRefreshAt: Date.now(),
  });
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = listMock({ '/|1': { __error: 4000023, __errmsg: 'need verify' } }, (u) => calls.push(u.href));
  try {
    await assert.rejects(
      () => listAllTeraBoxFiles(COOKIE),
      /errno=4000023/,
    );
    assert.equal(calls.length, 1, 'exactly one list call — no forced-refresh retry');
    assert.ok(calls[0].includes('dm.terabox.com/api/list'));
  } finally {
    globalThis.fetch = realFetch;
    uninstallChrome();
  }
});

// --------------------------------------------------------- integrity ---

test('2.12.79 (2026-09-14): checkTeraBoxIntegrity buckets found/missing/noUrl (all with codes: []) and skips scenes + non-root files from extra', async () => {
  installChrome({ teraboxJsToken: 'cached-token', teraboxJsTokenAt: Date.now() });
  const realFetch = globalThis.fetch;
  globalThis.fetch = listMock({
    '/|1': [
      fileEntry('1001', 'a.mp4'),
      fileEntry('2000', 'orphan.mp4'),
      fileEntry('3000', 'a.mp4'),
      fileEntry('4000', 'model.spz'),
      { fs_id: '9000', server_filename: 'gh-mirror', path: '/gh-mirror', size: 0, isdir: 1 },
    ],
    '/gh-mirror|1': [fileEntry('5000', 'bundle.zip')],
  });
  const items = [
    { id: 'A', fileName: 'a.mp4', videoHosts: { terabox: { fileId: '1001', watchUrl: 'https://dm.terabox.com/file/a?fid=1-2-1001' } } },
    { id: 'B', fileName: 'missing.mp4', videoHosts: { terabox: { fileId: '9999' } } },
    { id: 'C', fileName: 'nolink.mp4' },
  ];
  try {
    const result = await checkTeraBoxIntegrity(items, items, COOKIE);
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].item.id, 'A');
    assert.deepEqual(result.found[0].codes, []);
    assert.equal(result.missing.length, 1);
    assert.equal(result.missing[0].item.id, 'B');
    assert.deepEqual(result.missing[0].codes, []);
    assert.equal(result.noUrl.length, 1);
    assert.equal(result.noUrl[0].item.id, 'C');
    assert.deepEqual(result.noUrl[0].codes, []);
    const extraIds = result.extra.map((e) => e.file.fs_id).sort();
    assert.deepEqual(extraIds, ['2000', '3000']);
  } finally {
    globalThis.fetch = realFetch;
    uninstallChrome();
  }
});

// ------------------------------------------------------------ delete ---

test('2.12.79 (2026-09-14): deleteTeraBoxFiles refuses empty, non-absolute, root, and >10-path deletes before any network', async () => {
  installChrome({});
  try {
    await assert.rejects(() => deleteTeraBoxFiles(COOKIE, []), /No TeraBox paths to delete/);
    await assert.rejects(() => deleteTeraBoxFiles(COOKIE, ['relative.mp4']), /Refusing to delete non-absolute path/);
    await assert.rejects(() => deleteTeraBoxFiles(COOKIE, ['/']), /Refusing to delete root/);
    await assert.rejects(
      () => deleteTeraBoxFiles(COOKIE, Array.from({ length: 11 }, (_, i) => `/f${i}.mp4`)),
      /Refusing to delete 11 files at once \(cap 10/,
    );
  } finally {
    uninstallChrome();
  }
});

// ------------------------------------------- source assertions (wiring) ---

test('2.11.8 (2026-09-19): API calls stay on dm, token scraping on www — the dm homepage is captcha-gated', () => {
  const api = src('../src/utils/teraBoxApi.js');
  assert.ok(api.includes("const TERABOX_API_BASE = 'https://dm.terabox.com';"));
  assert.ok(api.includes("const TERABOX_TOKEN_BASE = 'https://www.terabox.com';"));
  assert.ok(api.includes('`${TERABOX_API_BASE}${pathname}?${qp}`'));
});

test('2.19.1 (2026-11-03): the tab-burst guards are 5-minute backoff + 5-minute force-refresh cooldown + single-flight', () => {
  const api = src('../src/utils/teraBoxApi.js');
  assert.ok(api.includes('const JS_TOKEN_SCRAPE_BACKOFF_MS = 5 * 60 * 1000;'));
  assert.ok(api.includes('const JS_TOKEN_FORCE_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;'));
  assert.ok(api.includes("const TOKEN_SCRAPE_FAILED_AT_KEY = 'teraboxTokenScrapeFailedAt';"));
  assert.ok(api.includes("const TOKEN_FORCE_REFRESH_AT_KEY = 'teraboxTokenForceRefreshAt';"));
  assert.ok(api.includes('let _jsTokenScrapeInFlight = null;'));
  assert.ok(api.includes('let _pageCtxScrapeInFlight = null;'));
});

test('2.16.9 (2026-10-26): thumbnail resolution caches the root listing for 60s — one gallery open is one listing, not N', () => {
  const api = src('../src/utils/teraBoxApi.js');
  assert.ok(api.includes('const TERABOX_THUMB_LISTING_TTL_MS = 60 * 1000;'));
  assert.ok(api.includes('if (cached && Date.now() - cached.at < TERABOX_THUMB_LISTING_TTL_MS) {'));
});

test('2.12.79 (2026-09-14): deleteTeraBoxFiles never calls clearRecycleBin — deletes are recoverable', () => {
  const api = src('../src/utils/teraBoxApi.js');
  const lines = api.split('\n').filter((line) => line.includes('clearRecycleBin'));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].trim().startsWith('* Never calls clearRecycleBin'));
});

// ------------------------------------------------- gap-closing pins ---

test('2.13.1/2.12.15 (2026-09): resolveTeraBoxFilePath is shared by playback and delete, and fs_id -> path is cached for the SW session', () => {
  const api = src('../src/utils/teraBoxApi.js');
  assert.ok(api.includes('const _teraBoxFsPathCache = new Map();'));
  assert.ok(api.includes('export async function resolveTeraBoxFilePath(explicitCookie, fsId, fileName = \'\') {'));
  assert.ok(api.includes('if (_teraBoxFsPathCache.has(target)) {'));
  assert.ok((api.match(/await resolveTeraBoxFilePath\(/g) || []).length >= 3);
});

test('2.16.9 (2026-10-30): uploadChunk retries network drops (retries = 2) instead of failing a multi-gigabyte upload on one blip', () => {
  const uploaders = src('../src/utils/uploaders.js');
  assert.ok(uploaders.includes('async uploadChunk(host, path, uploadid, partseq, chunkBlob, filename, signal, retries = 2) {'));
});

test('2.19.7 (2026-11-02): the terabox result reads the thumbnail payload (url3/url2/url1/icon) at upload time', () => {
  const uploaders = src('../src/utils/uploaders.js');
  assert.ok(uploaders.includes("thumbUrl = meta?.thumbs?.url3 || meta?.thumbs?.url2 || meta?.thumbs?.url1 || meta?.thumbs?.icon || '';"));
});

test('2.19.5/2.16.1/2.19.11 (2026-10/11): yt-dlp failure classifiers exist for all three 2nd-method routes and the switch is logged LOUDLY', () => {
  const bg = src('../src/background/background.js');
  assert.ok(bg.includes('isBrowserChallengeFailure(message) {'));
  assert.ok(bg.includes('isTeraBoxUnsupportedFailure(url, message) {'));
  assert.ok(bg.includes('isSunoUnsupportedFailure(url, message) {'));
  assert.ok(bg.includes('async resolveTeraBoxMediaUrl(pageUrl, activeRequestId) {'));
  assert.ok(bg.includes("'yt-dlp has no native extractor for TeraBox (Unsupported URL). Switching to the 2nd method: resolve the direct media URL via TeraBox API.',"));
  assert.ok(bg.includes("'yt-dlp has no native extractor for Suno (Liability/Unsupported URL). Switching to the 2nd method: resolve the direct media URL via Suno API.',"));
  assert.ok(bg.includes("'yt-dlp was blocked by a browser challenge (HTTP 403 on the page fetch). Switching to the 2nd method: resolve the direct media URL from the rendered page.',"));
});
