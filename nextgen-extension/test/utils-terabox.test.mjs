// node:test suite for src/utils/teraBoxApi.js — the TeraBox API client.
// All network is mocked (globalThis.fetch stubbed per test); the jsToken
// cache is seeded through a chrome.storage.local stub, so no hidden-tab
// scrape is ever attempted. Fake cookies only.
//
// NOTE: teraBoxApi keeps module-level caches (thumbnail listings keyed by
// cookie, fs_id -> path). Tests that touch them use a distinct cookie /
// fs_id each, so no test can see another test's cached listing.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  TERABOX_DOMAINS_RE,
  authorizeTeraBox,
  baseNameOfTeraBoxUrl,
  checkTeraBoxIntegrity,
  checkTeraBoxSceneIntegrity,
  collectTeraBoxRefs,
  deleteTeraBoxFiles,
  extractTeraBoxFileId,
  fetchTeraBoxPageContext,
  hasTeraBoxSessionCookie,
  isTeraBoxHost,
  isTeraBoxUrl,
  listAllTeraBoxFiles,
  resolveTeraBoxDownloadTarget,
  resolveTeraBoxFilePath,
  resolveTeraBoxPlaybackUrl,
  resolveTeraBoxThumbnail,
  teraBoxFsIdFromUrl,
} from '../src/utils/teraBoxApi.js';
import { createTeraBoxRefIndex } from '../../packages/shared/teraboxRefs.js';

const COOKIE = 'ndus=fake-session; browserid=fake-browser; lang=en';
const TOKEN = 'fake-js-token';

const jsonResponse = (obj, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => obj,
  text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)),
});
const realFetch = globalThis.fetch;
const realLog = console.log;
let fetchCalls;
let fetchHandler;
let store;
beforeEach(() => {
  fetchCalls = [];
  fetchHandler = null;
  store = new Map([
    ['teraboxJsToken', TOKEN],
    ['teraboxJsTokenAt', Date.now()],
  ]);
  console.log = () => {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const wanted = Array.isArray(keys)
            ? keys
            : (typeof keys === 'string' ? [keys] : [...store.keys()]);
          const out = {};
          for (const key of wanted) {
            if (store.has(key)) out[key] = store.get(key);
          }
          return out;
        },
        set: async (obj) => {
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
        remove: async (key) => { store.delete(key); },
      },
    },
  };
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url: String(url), options });
    if (!fetchHandler) throw new Error(`unexpected fetch: ${url}`);
    return fetchHandler(String(url), options);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  delete globalThis.chrome;
});

// --- pure helpers --------------------------------------------------------
describe('hasTeraBoxSessionCookie', () => {
  test('detects ndus= at the start or after a semicolon', () => {
    assert.equal(hasTeraBoxSessionCookie('ndus=abc'), true);
    assert.equal(hasTeraBoxSessionCookie('browserid=x; ndus=abc'), true);
    assert.equal(hasTeraBoxSessionCookie('browserid=x;ndus=abc'), true);
  });
  test('rejects cookies without an ndus session token', () => {
    assert.equal(hasTeraBoxSessionCookie('browserid=x'), false);
    assert.equal(hasTeraBoxSessionCookie('andusb=abc'), false);
    assert.equal(hasTeraBoxSessionCookie(''), false);
    assert.equal(hasTeraBoxSessionCookie(null), false);
  });
});

describe('TERABOX_DOMAINS_RE / isTeraBoxHost / isTeraBoxUrl', () => {
  test('all known TeraBox domains match, subdomains included', () => {
    for (const host of [
      'terabox.com', 'dm.terabox.com', 'www.terabox.com',
      '1024tera.com', 'teraboxapp.com', 'freeterabox.com',
      'tibibox.com', '4funbox.com', 'mirrobox.com', 'nephobox.com',
    ]) {
      assert.equal(isTeraBoxHost(host), true, host);
    }
  });
  test('lookalikes do not match', () => {
    assert.equal(isTeraBoxHost('terabox.com.evil.com'), false);
    assert.equal(isTeraBoxHost('noterabox.com'), false);
    assert.equal(isTeraBoxHost('terabox.co'), false);
    assert.equal(isTeraBoxHost(''), false);
  });
  test('isTeraBoxUrl parses the hostname, invalid URLs are false', () => {
    assert.equal(isTeraBoxUrl('https://dm.terabox.com/play/video?x=1'), true);
    assert.equal(isTeraBoxUrl('https://example.com/'), false);
    assert.equal(isTeraBoxUrl('not a url'), false);
    assert.equal(isTeraBoxUrl(''), false);
  });
  test('the regex itself is exported', () => {
    assert.ok(TERABOX_DOMAINS_RE instanceof RegExp);
  });
});

describe('baseNameOfTeraBoxUrl', () => {
  test('takes the last path segment, query stripped, decoded', () => {
    assert.equal(baseNameOfTeraBoxUrl('https://example.com/a/b/clip%20one.mp4?token=x'), 'clip one.mp4');
    assert.equal(baseNameOfTeraBoxUrl('https://example.com/file.bin'), 'file.bin');
    assert.equal(baseNameOfTeraBoxUrl(''), '');
    assert.equal(baseNameOfTeraBoxUrl(null), '');
  });
});

describe('teraBoxFsIdFromUrl', () => {
  test('the trailing numeric segment of ?fid= IS the fs_id', () => {
    assert.equal(teraBoxFsIdFromUrl('https://d.terabox.com/file/abc?fid=12345-250528-900100200300'), '900100200300');
    assert.equal(teraBoxFsIdFromUrl('https://d.terabox.com/file/abc?x=1&fid=1-2-3&y=4'), '3');
  });
  test('a non-numeric trailing segment yields nothing', () => {
    assert.equal(teraBoxFsIdFromUrl('https://d.terabox.com/file/abc?fid=12345-abc'), '');
    assert.equal(teraBoxFsIdFromUrl('https://d.terabox.com/file/abc?fid='), '');
  });
  test('no fid param yields nothing', () => {
    assert.equal(teraBoxFsIdFromUrl('https://d.terabox.com/file/abc'), '');
    assert.equal(teraBoxFsIdFromUrl(''), '');
    assert.equal(teraBoxFsIdFromUrl(null), '');
  });
});

describe('extractTeraBoxFileId', () => {
  test('reads fileId / fs_id from videoHosts, extra, and legacy columns', () => {
    assert.equal(extractTeraBoxFileId({ videoHosts: { terabox: { fileId: '111' } } }), '111');
    assert.equal(extractTeraBoxFileId({ videoHosts: { terabox: { fs_id: '222' } } }), '222');
    assert.equal(
      extractTeraBoxFileId({ extraMetadata: { videoHosts: { terabox: { fileId: '333' } } } }),
      '333',
    );
    assert.equal(extractTeraBoxFileId({ teraboxFileId: '444' }), '444');
    assert.equal(extractTeraBoxFileId({}), '');
    assert.equal(extractTeraBoxFileId(), '');
  });
  test('trims whitespace', () => {
    assert.equal(extractTeraBoxFileId({ videoHosts: { terabox: { fileId: ' 111 ' } } }), '111');
  });
});

describe('collectTeraBoxRefs', () => {
  test('with an index, the index is the only thing filled (the sets stay for index-less callers)', () => {
    const ids = new Set();
    const names = new Set();
    const index = createTeraBoxRefIndex();
    collectTeraBoxRefs({
      fileName: 'clip.mp4',
      videoHosts: { terabox: { fileId: '111', filename: 'clip.mp4' } },
    }, ids, names, index);
    assert.ok(index.ids.has('111'));
    assert.ok(index.names.has('clip.mp4'));
    assert.ok(index.idsByName.get('clip.mp4').has('111'));
    assert.equal(ids.size, 0);
    assert.equal(names.size, 0);
  });
  test('without an index, the sets are filled', () => {
    const ids = new Set();
    const names = new Set();
    collectTeraBoxRefs({
      fileName: 'clip.mp4',
      videoHosts: { terabox: { fileId: '111', filename: 'clip.mp4' } },
    }, ids, names, null);
    assert.ok(ids.has('111'));
    assert.ok(names.has('clip.mp4'));
  });
  test('extracts fs_ids from dlink URLs', () => {
    const ids = new Set();
    collectTeraBoxRefs({
      teraboxDirectUrl: 'https://d.terabox.com/file/x?fid=1-2-777',
    }, ids, new Set(), null);
    assert.ok(ids.has('777'));
  });
  test('collects sceneFiles spz/texture refs and the vault blob', () => {
    const ids = new Set();
    const names = new Set();
    collectTeraBoxRefs({
      encryptedBlobUrl: 'https://d.terabox.com/file/x?fid=1-2-888',
      extraMetadata: {
        sceneFiles: {
          spz: { fileId: '555', filename: 'model.spz' },
          texture: { fileId: '556', filename: 'tex.webp' },
        },
      },
    }, ids, names, null);
    assert.ok(ids.has('888'));
    assert.ok(ids.has('555'));
    assert.ok(ids.has('556'));
    assert.ok(names.has('model.spz'));
    assert.ok(names.has('tex.webp'));
  });
  test('a null item is a no-op', () => {
    assert.doesNotThrow(() => collectTeraBoxRefs(null, new Set(), new Set(), null));
  });
});

// --- auth ----------------------------------------------------------------
describe('fetchTeraBoxPageContext', () => {
  test('returns the cached context when fresh', async () => {
    store.set('teraboxPageCtx', { jsToken: 'jt', bdstoken: 'bd', dpLogid: 'dp', tabCookie: 'tc' });
    store.set('teraboxPageCtxAt', Date.now());
    const ctx = await fetchTeraBoxPageContext(COOKIE);
    assert.deepEqual(ctx, { jsToken: 'jt', bdstoken: 'bd', dpLogid: 'dp', tabCookie: 'tc' });
  });
  test('without chrome.tabs and without a cache it returns empty', async () => {
    store.delete('teraboxJsToken');
    const ctx = await fetchTeraBoxPageContext(COOKIE);
    assert.deepEqual(ctx, { jsToken: '', bdstoken: '', dpLogid: '', tabCookie: '' });
  });
  test('without chrome at all it returns empty', async () => {
    const saved = globalThis.chrome;
    delete globalThis.chrome;
    try {
      const ctx = await fetchTeraBoxPageContext(COOKIE);
      assert.deepEqual(ctx, { jsToken: '', bdstoken: '', dpLogid: '', tabCookie: '' });
    } finally {
      globalThis.chrome = saved;
    }
  });
});

describe('authorizeTeraBox', () => {
  test('an explicit cookie + cached token authorizes', async () => {
    const auth = await authorizeTeraBox(COOKIE);
    assert.deepEqual(auth, { cookie: COOKIE, jsToken: TOKEN });
  });
  test('no cookie and no browser cookies returns null', async () => {
    assert.equal(await authorizeTeraBox(''), null);
    assert.equal(await authorizeTeraBox(undefined), null);
  });
  test('a cached tab cookie merges in without overwriting ndus', async () => {
    store.set('teraboxTabCookie', 'verify=abc123; ndus=tab-should-not-win');
    store.set('teraboxTabCookieAt', Date.now());
    const auth = await authorizeTeraBox(COOKIE);
    assert.match(auth.cookie, /ndus=fake-session/);
    assert.match(auth.cookie, /verify=abc123/);
    assert.doesNotMatch(auth.cookie, /tab-should-not-win/);
    assert.equal(auth.jsToken, TOKEN);
  });
  test('a stale tab cookie is ignored', async () => {
    store.set('teraboxTabCookie', 'verify=abc123');
    store.set('teraboxTabCookieAt', Date.now() - 13 * 60 * 60 * 1000);
    const auth = await authorizeTeraBox(COOKIE);
    assert.equal(auth.cookie, COOKIE);
  });
});

// --- listing -------------------------------------------------------------
// A /api/list mock: pages keyed by `${dir}|${page}`.
const listMock = (pages, filemetas = {}) => (url) => {
  const parsed = new URL(url);
  if (parsed.pathname === '/api/list') {
    const dir = parsed.searchParams.get('dir');
    const page = parsed.searchParams.get('page');
    const list = pages[`${dir}|${page}`];
    if (list === undefined) return jsonResponse({ errno: -9, errmsg: 'no such page' });
    return jsonResponse({ errno: 0, list });
  }
  if (parsed.pathname === '/api/filemetas') {
    const target = JSON.parse(parsed.searchParams.get('target') || '[]')[0];
    const info = filemetas[target];
    if (!info) return jsonResponse({ errno: 0, info: [] });
    return jsonResponse({ errno: 0, info: [info] });
  }
  if (parsed.hostname === 'www.terabox.com') {
    return jsonResponse('<html>no token here</html>');
  }
  throw new Error(`unexpected url ${url}`);
};
const entry = (fs_id, server_filename, path, extra = {}) => ({
  fs_id, server_filename, path, size: 1000, isdir: 0, ...extra,
});

describe('listAllTeraBoxFiles', () => {
  test('lists the root folder and recurses into subfolders', async () => {
    fetchHandler = listMock({
      '/|1': [
        entry('111', 'clip.mp4', '/clip.mp4'),
        { fs_id: '900', server_filename: 'gh-mirror', path: '/gh-mirror', isdir: 1 },
      ],
      '/gh-mirror|1': [entry('222', 'repo.bundle', '/gh-mirror/repo.bundle')],
    });
    const files = await listAllTeraBoxFiles(COOKIE);
    assert.deepEqual(files.map((f) => [f.fs_id, f._folder]), [
      ['111', 'root'],
      ['222', 'gh-mirror'],
    ]);
    assert.equal(files[0].name, 'clip.mp4');
    assert.equal(files[0].filename, 'clip.mp4');
  });
  test('paginates past the 100-per-page cap', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => entry(`p1-${i}`, `f${i}.mp4`, `/f${i}.mp4`));
    const page2 = [entry('p2-0', 'last.mp4', '/last.mp4')];
    fetchHandler = listMock({ '/|1': page1, '/|2': page2 });
    const files = await listAllTeraBoxFiles(COOKIE);
    assert.equal(files.length, 101);
  });
  test('throws without a cookie', async () => {
    await assert.rejects(() => listAllTeraBoxFiles(''), /No TeraBox cookie/);
  });
  test('a listing error throws loudly (never a partial list)', async () => {
    fetchHandler = () => jsonResponse({ errno: -6, errmsg: 'bad token' });
    await assert.rejects(
      () => listAllTeraBoxFiles(COOKIE),
      /TeraBox \/api\/list failed for \/ page 1: errno=-6/,
    );
  });
  test('an errno 4000023 surfaces after the forced-refresh attempt finds no token', async () => {
    fetchHandler = (url) => {
      if (url.includes('/api/list')) return jsonResponse({ errno: 4000023, errmsg: 'need verify' });
      return jsonResponse('<html>no token here</html>');
    };
    await assert.rejects(
      () => listAllTeraBoxFiles(COOKIE),
      /errno=4000023/,
    );
  });
});

describe('resolveTeraBoxThumbnail / resolveTeraBoxFilePath / resolveTeraBoxPlaybackUrl', () => {
  const thumbEntry = entry('111', 'clip.mp4', '/clip.mp4', {
    thumbs: { icon: 'https://th.example/icon', url1: 'https://th.example/1', url2: 'https://th.example/2', url3: 'https://th.example/3' },
  });
  test('resolveTeraBoxThumbnail picks url3, then url2/url1/icon', async () => {
    fetchHandler = listMock({ '/|1': [thumbEntry] });
    assert.equal(await resolveTeraBoxThumbnail(`${COOKIE}; t=1`, '111'), 'https://th.example/3');
    fetchHandler = listMock({ '/|1': [entry('112', 'c.mp4', '/c.mp4', { thumbs: { icon: 'https://th.example/i' } })] });
    assert.equal(await resolveTeraBoxThumbnail(`${COOKIE}; t=2`, '112'), 'https://th.example/i');
  });
  test('resolveTeraBoxThumbnail returns empty when the file or thumbs are missing', async () => {
    fetchHandler = listMock({ '/|1': [thumbEntry] });
    assert.equal(await resolveTeraBoxThumbnail(`${COOKIE}; t=3`, '999'), '');
    assert.equal(await resolveTeraBoxThumbnail(`${COOKIE}; t=3`, ''), '');
  });
  test('the thumbnail listing is cached for a minute per cookie', async () => {
    fetchHandler = listMock({ '/|1': [thumbEntry] });
    await resolveTeraBoxThumbnail(`${COOKIE}; t=cache`, '111');
    await resolveTeraBoxThumbnail(`${COOKIE}; t=cache`, '111');
    assert.equal(fetchCalls.filter((c) => c.url.includes('/api/list')).length, 1);
  });
  test('resolveTeraBoxFilePath finds by fs_id, then by name', async () => {
    fetchHandler = listMock({ '/|1': [entry('211', 'clip.mp4', '/clip.mp4')] });
    assert.equal(await resolveTeraBoxFilePath(COOKIE, '211'), '/clip.mp4');
    assert.equal(await resolveTeraBoxFilePath(COOKIE, '', 'clip.mp4'), '/clip.mp4');
    assert.equal(await resolveTeraBoxFilePath(COOKIE, '999'), '');
    assert.equal(await resolveTeraBoxFilePath(COOKIE, '999', 'nope.mp4'), '');
  });
  test('resolveTeraBoxPlaybackUrl returns the fresh dlna dlink', async () => {
    fetchHandler = listMock(
      { '/|1': [entry('311', 'clip.mp4', '/clip.mp4')] },
      { '/clip.mp4': { fs_id: '311', server_filename: 'clip.mp4', path: '/clip.mp4', dlink: 'https://dlink.example/f?fid=1-2-311' } },
    );
    assert.equal(
      await resolveTeraBoxPlaybackUrl(COOKIE, '311'),
      'https://dlink.example/f?fid=1-2-311',
    );
  });
  test('resolveTeraBoxPlaybackUrl returns empty when no dlink comes back', async () => {
    fetchHandler = listMock(
      { '/|1': [entry('312', 'clip.mp4', '/clip.mp4')] },
      { '/clip.mp4': { fs_id: '312', server_filename: 'clip.mp4', path: '/clip.mp4' } },
    );
    assert.equal(await resolveTeraBoxPlaybackUrl(COOKIE, '312'), '');
    assert.equal(await resolveTeraBoxPlaybackUrl(COOKIE, '999'), '');
  });
});

describe('resolveTeraBoxDownloadTarget', () => {
  test('returns null for non-strings and unparseable URLs', async () => {
    assert.equal(await resolveTeraBoxDownloadTarget(null), null);
    assert.equal(await resolveTeraBoxDownloadTarget(42), null);
    assert.equal(await resolveTeraBoxDownloadTarget('not a url'), null);
  });
  test('returns null when no path or id can be found', async () => {
    assert.equal(await resolveTeraBoxDownloadTarget('https://dm.terabox.com/'), null);
    assert.equal(await resolveTeraBoxDownloadTarget('https://dm.terabox.com/s/abc'), null);
  });
  test('resolves a ?path= URL to a dlink + metadata', async () => {
    fetchHandler = listMock(
      {},
      { '/clip.mp4': { fs_id: '411', server_filename: 'clip.mp4', path: '/clip.mp4', size: 123456, dlink: 'https://dlink.example/f' } },
    );
    const out = await resolveTeraBoxDownloadTarget('https://dm.terabox.com/play/video?path=%2Fclip.mp4', COOKIE);
    assert.deepEqual(out, {
      mediaUrl: 'https://dlink.example/f',
      fileName: 'clip.mp4',
      pageTitle: 'clip',
      fsId: '411',
      size: 123456,
      path: '/clip.mp4',
    });
  });
  test('resolves a ?fidlist= URL by finding the path first', async () => {
    fetchHandler = listMock(
      { '/|1': [entry('412', 'movie.mkv', '/movie.mkv')] },
      { '/movie.mkv': { fs_id: '412', server_filename: 'movie.mkv', path: '/movie.mkv', size: 999, dlink: 'https://dlink.example/g' } },
    );
    const out = await resolveTeraBoxDownloadTarget(
      'https://dm.terabox.com/play/video?fidlist=%5B412%5D',
      COOKIE,
    );
    assert.equal(out.fsId, '412');
    assert.equal(out.mediaUrl, 'https://dlink.example/g');
    assert.equal(out.pageTitle, 'movie');
  });
  test('a filemetas failure throws naming the errno and path', async () => {
    fetchHandler = listMock({}, {});
    await assert.rejects(
      () => resolveTeraBoxDownloadTarget('https://dm.terabox.com/play/video?path=%2Fgone.mp4', COOKIE),
      /TeraBox \/api\/filemetas returned no dlink \(errno=0\) for path: \/gone\.mp4/,
    );
  });
});

describe('checkTeraBoxIntegrity', () => {
  const files = [
    entry('111', 'clip.mp4', '/clip.mp4'),
    entry('222', 'clip.mp4', '/clip.mp4'), // duplicate: same name, other fs_id
    entry('333', 'orphan.mp4', '/orphan.mp4'),
    entry('444', 'model.spz', '/model.spz'),
  ];
  test('splits into found / missing / noUrl / extra, duplicates as extra', async () => {
    fetchHandler = listMock({ '/|1': files });
    const out = await checkTeraBoxIntegrity([
      { id: '1', videoHosts: { terabox: { fileId: '111', watchUrl: 'https://terabox.example/s/a' } }, fileName: 'clip.mp4' },
      { id: '2', videoHosts: { terabox: { fileId: '999', watchUrl: 'https://terabox.example/s/b' } }, fileName: 'gone.mp4' },
      { id: '3', fileName: 'no-link.mp4' },
    ], [], COOKIE);
    assert.deepEqual(out.found.map((f) => f.item.id), ['1']);
    assert.deepEqual(out.missing.map((f) => f.item.id), ['2']);
    assert.deepEqual(out.noUrl.map((f) => f.item.id), ['3']);
    // the duplicate copy + the true orphan; the scene file belongs to the 3D tab
    assert.deepEqual(out.extra.map((e) => e.file.fs_id).sort(), ['222', '333']);
  });
  test('files outside the vault root are never extras', async () => {
    fetchHandler = listMock({
      '/|1': [
        entry('111', 'clip.mp4', '/clip.mp4'),
        { fs_id: '900', server_filename: 'gh-mirror', path: '/gh-mirror', isdir: 1 },
      ],
      '/gh-mirror|1': [entry('901', 'repo.bundle', '/gh-mirror/repo.bundle')],
    });
    const out = await checkTeraBoxIntegrity(
      [{ id: '1', videoHosts: { terabox: { fileId: '111', watchUrl: 'https://terabox.example/s/a' } } }],
      [], COOKIE,
    );
    assert.deepEqual(out.extra, []);
  });
  test('a listing failure THROWS', async () => {
    fetchHandler = () => jsonResponse({ errno: -6 });
    await assert.rejects(() => checkTeraBoxIntegrity([], [], COOKIE), /errno=-6/);
  });
});

describe('checkTeraBoxSceneIntegrity', () => {
  const sceneFiles = [
    entry('511', 'model.spz', '/model.spz'),
    entry('512', 'texture.webp', '/texture.webp'),
    entry('513', 'orphan.spz', '/orphan.spz'),
    entry('514', 'orphan.png', '/orphan.png'),
    entry('515', 'clip.mp4', '/clip.mp4'),
  ];
  const sceneItem = (id, spzUrl, textureUrl) => ({
    id, fileName: 'model.spz', kind: 'scene', spzUrl, textureUrl,
  });
  test('a scene with both files present is found', async () => {
    fetchHandler = listMock({ '/|1': sceneFiles });
    const out = await checkTeraBoxSceneIntegrity([
      sceneItem('s1', 'https://d.terabox.com/file/x?fid=1-2-511', 'https://d.terabox.com/file/y?fid=1-2-512'),
    ], [], COOKIE);
    assert.equal(out.found.length, 1);
    assert.equal(out.found[0].spzFid, '511');
    assert.equal(out.found[0].texFid, '512');
    assert.deepEqual(out.missing, []);
  });
  test('a partial scene is missing', async () => {
    fetchHandler = listMock({ '/|1': sceneFiles });
    const out = await checkTeraBoxSceneIntegrity([
      sceneItem('s1', 'https://d.terabox.com/file/x?fid=1-2-511', 'https://d.terabox.com/file/y?fid=1-2-999'),
    ], [], COOKIE);
    assert.equal(out.missing.length, 1);
    assert.ok(out.missing[0].spzMatched);
    assert.equal(out.missing[0].texMatched, null);
  });
  test('a foreign-host scene (no terabox ref) lands in noUrl, not missing', async () => {
    // Names must NOT match any terabox file: matching falls back to name,
    // so a same-named foreign scene would (correctly) read as found.
    fetchHandler = listMock({ '/|1': sceneFiles });
    const out = await checkTeraBoxSceneIntegrity([
      {
        id: 's1', fileName: 'other-model.spz', kind: 'scene',
        spzUrl: 'https://udrop.com/spz1/other-model.spz',
        textureUrl: 'https://udrop.com/tex1/other-texture.webp',
      },
    ], [], COOKIE);
    assert.equal(out.noUrl.length, 1);
    assert.deepEqual(out.missing, []);
    assert.deepEqual(out.found, []);
  });
  test('orphan scenes pair by stem; videos never show as scene orphans', async () => {
    fetchHandler = listMock({ '/|1': sceneFiles });
    const out = await checkTeraBoxSceneIntegrity([], [], COOKIE);
    const paired = out.extra.find((e) => e.file.fs_id === '513');
    assert.deepEqual(paired.textureFiles.map((f) => f.fs_id), ['514']);
    assert.ok(!out.extra.some((e) => e.file.fs_id === '515'));
    // the referenced scene files are orphans too when no item claims them
    assert.ok(out.extra.some((e) => e.file.fs_id === '511'));
  });
});

describe('deleteTeraBoxFiles', () => {
  test('guards: empty, too many, relative, and root paths throw before any fetch', async () => {
    await assert.rejects(() => deleteTeraBoxFiles(COOKIE, []), /No TeraBox paths to delete/);
    await assert.rejects(
      () => deleteTeraBoxFiles(COOKIE, Array.from({ length: 11 }, (_, i) => `/f${i}.mp4`)),
      /Refusing to delete 11 files at once/,
    );
    await assert.rejects(() => deleteTeraBoxFiles(COOKIE, ['relative.mp4']), /Refusing to delete non-absolute path/);
    await assert.rejects(() => deleteTeraBoxFiles(COOKIE, ['/']), /Refusing to delete root/);
    assert.equal(fetchCalls.length, 0);
  });
  test('a single string path is accepted as a one-element list', async () => {
    fetchHandler = (url) => {
      assert.match(url, /dm\.terabox\.com\/api\/filemanager/);
      return jsonResponse({ errno: 0 });
    };
    assert.equal(await deleteTeraBoxFiles(COOKIE, '/clip.mp4'), true);
  });
  test('success on the first dm attempt returns true', async () => {
    fetchHandler = (url, options) => {
      assert.match(url, /dm\.terabox\.com\/api\/filemanager/);
      assert.equal(options.method, 'POST');
      assert.match(options.body, /filelist=%5B%22%2Fclip\.mp4%22%5D/);
      return jsonResponse({ errno: 0 });
    };
    assert.equal(await deleteTeraBoxFiles(COOKIE, ['/clip.mp4']), true);
    assert.equal(fetchCalls.length, 1);
  });
  test('a dm failure retries dm, then falls back to www', async () => {
    let calls = 0;
    fetchHandler = (url) => {
      calls += 1;
      if (url.startsWith('https://www.terabox.com/api/filemanager')) {
        return jsonResponse({ errno: 0 });
      }
      if (url.startsWith('https://www.terabox.com/')) {
        return jsonResponse('<html>no token here</html>');
      }
      return jsonResponse({ errno: -6, errmsg: 'dm says no' });
    };
    assert.equal(await deleteTeraBoxFiles(COOKIE, ['/clip.mp4']), true);
    assert.ok(calls >= 3);
  });
  test('all attempts failing throws with the trace and a nothing-deleted promise', async () => {
    fetchHandler = (url) => {
      if (url.includes('/api/filemanager')) return jsonResponse({ errno: -6, errmsg: 'still no' });
      return jsonResponse('<html>no token here</html>');
    };
    await assert.rejects(
      () => deleteTeraBoxFiles(COOKIE, ['/clip.mp4']),
      (err) => err.message.includes('TeraBox delete failed')
        && err.message.includes('Nothing deleted')
        && err.message.includes('errno=-6'),
    );
  });
  test('no cookie throws before any fetch', async () => {
    await assert.rejects(() => deleteTeraBoxFiles('', ['/clip.mp4']), /No TeraBox cookie/);
    assert.equal(fetchCalls.length, 0);
  });
});
