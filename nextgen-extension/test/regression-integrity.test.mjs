// Regression tests mined from the ImgVault bug history (AGENTS.md).
// Area: integrity checks — UDrop (2.12.78), Filemoon/Byse (2.11.19
// class), scene integrity (2.12.53-2.12.67), the Resolve page
// (2.2.x), and the scene viewer (2.12.62/63).
//
// Live tests use a mocked globalThis.fetch; no live network, no real
// credentials. The Filemoon SPA proof-of-work is CPU-bound, so its
// tests use tiny difficulties and a short budget.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  listUdropFolder,
  listAllUdropFiles,
  checkUdropIntegrity,
  checkSceneIntegrity,
  extractUdropCode,
  is3DSceneFamilyFile,
  MODEL_EXT_RE,
  SCENE_TEXTURE_EXT_RE,
} from '../src/utils/udropApi.js';
import {
  checkTeraBoxSceneIntegrity,
} from '../src/utils/teraBoxApi.js';
import {
  checkTelegramSceneIntegrity,
} from '../src/utils/telegramApi.js';
import {
  listAllFilemoonFiles,
  extractFilemoonFilecode,
} from '../src/utils/filemoonApi.js';
import { solveFilemoonPow } from '../src/utils/filemoonSpa.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const jsonResponse = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
  text: async () => JSON.stringify(data),
});

// ------------------------------------------------------------ udrop ---

test('2.12.78 (2026-09-13): listUdropFolder filters trash/deleted and fails LOUD on HTTP or API errors', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({
    _status: 'success',
    data: {
      files: [
        { short_url: 'a1', file_id: '1', name: 'keep.mp4', status: 'active' },
        { short_url: 'a2', file_id: '2', name: 'trashed.mp4', status: 'trash' },
        { short_url: 'a3', file_id: '3', name: 'gone.mp4', status: 'deleted' },
      ],
      folders: [],
    },
  });
  try {
    const { files, folders } = await listUdropFolder('fake-token', 'fake-account');
    assert.deepEqual(files.map((f) => f.short_url), ['a1']);
    assert.deepEqual(folders, []);
  } finally {
    globalThis.fetch = realFetch;
  }

  globalThis.fetch = async () => jsonResponse({}, 500);
  try {
    await assert.rejects(
      () => listUdropFolder('fake-token', 'fake-account', 'folder9'),
      /UDrop folder\/listing failed: HTTP 500 \(folder folder9\)/,
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  globalThis.fetch = async () => jsonResponse({ _status: 'error', response: 'bad token' });
  try {
    await assert.rejects(
      () => listUdropFolder('fake-token', 'fake-account'),
      /UDrop folder\/listing error: bad token/,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.12.78 (2026-09-13): listAllUdropFiles recurses into subfolders and a mid-recursion failure THROWS (never partial)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const folderId = options?.body?.get?.('folder_id') || '';
    if (folderId === '') {
      return jsonResponse({
        _status: 'success',
        data: {
          files: [{ short_url: 'r1', file_id: '1', name: 'root.mp4', status: 'active' }],
          folders: [{ id: 'sub1', name: 'sub' }],
        },
      });
    }
    return jsonResponse({
      _status: 'success',
      data: {
        files: [{ short_url: 's1', file_id: '2', name: 'sub.mp4', status: 'active' }],
        folders: [],
      },
    });
  };
  try {
    const files = await listAllUdropFiles('fake-token', 'fake-account');
    assert.deepEqual(files.map((f) => f.short_url), ['r1', 's1']);
    assert.equal(files[1]._folderName, 'sub');
  } finally {
    globalThis.fetch = realFetch;
  }

  globalThis.fetch = async (_url, options) => {
    const folderId = options?.body?.get?.('folder_id') || '';
    if (folderId === '') {
      return jsonResponse({
        _status: 'success',
        data: { files: [], folders: [{ id: 'sub1', name: 'sub' }] },
      });
    }
    return jsonResponse({}, 500);
  };
  try {
    await assert.rejects(
      () => listAllUdropFiles('fake-token', 'fake-account'),
      /UDrop folder\/listing failed: HTTP 500 \(folder sub1\)/,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.12.78 (2026-09-13): checkUdropIntegrity buckets found/missing/noUrl and never reports scene files or vault blobs as video orphans', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({
    _status: 'success',
    data: {
      files: [
        { short_url: 'v1', file_id: '1', name: 'found.mp4', status: 'active' },
        { short_url: 'o1', file_id: '2', name: 'orphan.mp4', status: 'active' },
        { short_url: 'sp1', file_id: '3', name: 'scene.spz', status: 'active' },
        { short_url: 'vb1', file_id: '4', name: 'abc123.bin', status: 'active' },
      ],
      folders: [],
    },
  });
  const items = [
    { id: 'A', videoHosts: { udrop: { watchUrl: 'https://www.udrop.com/file/v1' } } },
    { id: 'B', videoHosts: { udrop: { watchUrl: 'https://www.udrop.com/file/zzz' } } },
    { id: 'C' },
  ];
  const allItems = [
    ...items,
    { id: 'V', encryptedBlobUrl: 'https://www.udrop.com/file/vb1' },
    { id: 'S', spzUrl: 'https://www.udrop.com/file/sp1' },
  ];
  try {
    const result = await checkUdropIntegrity(items, allItems, 'fake-token', 'fake-account');
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].item.id, 'A');
    assert.deepEqual(result.found[0].codes, ['v1']);
    assert.equal(result.missing.length, 1);
    assert.equal(result.missing[0].item.id, 'B');
    assert.equal(result.noUrl.length, 1);
    assert.equal(result.noUrl[0].item.id, 'C');
    assert.deepEqual(result.noUrl[0].codes, []);
    assert.deepEqual(result.extra.map((e) => e.file.short_url), ['o1']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.12.58 (2026-09-10): checkSceneIntegrity requires BOTH spz and texture — a partial scene is missing, with both matches reported', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({
    _status: 'success',
    data: {
      files: [
        { short_url: 'spz1', file_id: '1', name: 'whole.spz', status: 'active' },
        { short_url: 'tex1', file_id: '2', name: 'whole.png', status: 'active' },
        { short_url: 'spz2', file_id: '3', name: 'half.spz', status: 'active' },
      ],
      folders: [],
    },
  });
  const items = [
    { id: 'whole', spzUrl: 'https://www.udrop.com/file/spz1', textureUrl: 'https://www.udrop.com/file/tex1' },
    { id: 'half', spzUrl: 'https://www.udrop.com/file/spz2', textureUrl: 'https://www.udrop.com/file/tex-missing' },
    { id: 'none' },
  ];
  try {
    const result = await checkSceneIntegrity(items, items, 'fake-token', 'fake-account');
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].item.id, 'whole');
    assert.equal(result.found[0].spzMatched.short_url, 'spz1');
    assert.equal(result.found[0].texMatched.short_url, 'tex1');
    assert.equal(result.missing.length, 1);
    assert.equal(result.missing[0].item.id, 'half');
    assert.equal(result.missing[0].spzMatched.short_url, 'spz2');
    assert.equal(result.missing[0].texMatched, null);
    assert.equal(result.noUrl.length, 1);
    assert.deepEqual(result.noUrl[0].codes, []);
    assert.equal(result.noUrl[0].spzMatched, null);
    assert.equal(result.noUrl[0].texMatched, null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.12.79 (2026-09-14): scene-family files are the model + texture extension sets', () => {
  assert.equal(is3DSceneFamilyFile('model.spz'), true);
  assert.equal(is3DSceneFamilyFile('model.glb'), true);
  assert.equal(is3DSceneFamilyFile('tex.webp'), true);
  assert.equal(is3DSceneFamilyFile('tex.png'), true);
  assert.equal(is3DSceneFamilyFile('clip.mp4'), false);
  assert.equal(is3DSceneFamilyFile('blob.bin'), false);
  assert.ok(MODEL_EXT_RE.test('a.abc') && SCENE_TEXTURE_EXT_RE.test('a.exr'));
  assert.equal(extractUdropCode('https://www.udrop.com/file/abc123'), 'abc123');
  assert.equal(extractUdropCode('https://www.udrop.com/abc123'), 'abc123');
  assert.equal(extractUdropCode('https://example.com/x'), null);
});

test('2.19.26 (2026-11-20): checkSceneIntegrity matches via sceneFiles.udrop when spzUrl/textureUrl point at telegram — the scene is found, not broken', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({
    _status: 'success',
    data: {
      files: [
        { short_url: 'spz9', file_id: '2625007', name: 'amphi.spz', status: 'active' },
        { short_url: 'tex9', file_id: '2625008', name: 'amphi.webp', status: 'active' },
      ],
      folders: [],
    },
  });
  const items = [
    {
      id: 'amphi',
      spzUrl: '/telegram-media/BQADxxx',
      textureUrl: '/telegram-media/CAADyyy',
      udropWatchUrl: 'https://www.udrop.com/file/spz9',
      extraMetadata: {
        sceneFiles: {
          udrop: {
            spz: { fileId: '2625007', filename: 'amphi.spz' },
            texture: { fileId: '2625008', filename: 'amphi.webp' },
          },
        },
      },
    },
    // control: same telegram pointers, no udrop ref anywhere — no udrop
    // codes at all, so it lands in noUrl, never missing.
    {
      id: 'no-ref',
      spzUrl: '/telegram-media/BQADzzz',
      textureUrl: '/telegram-media/CAADwww',
    },
  ];
  try {
    const result = await checkSceneIntegrity(items, items, 'fake-token', 'fake-account');
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].item.id, 'amphi');
    assert.equal(result.found[0].spzMatched.file_id, '2625007');
    assert.equal(result.found[0].texMatched.file_id, '2625008');
    assert.equal(result.missing.length, 0);
    assert.equal(result.noUrl.length, 1);
    assert.equal(result.noUrl[0].item.id, 'no-ref');
    assert.deepEqual(result.unverified, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.19.26 (2026-11-20): checkTeraBoxSceneIntegrity reads the texture fs_id from sceneFiles.terabox.texture — the old sceneFiles.texture key never existed', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url || '');
    if (u.startsWith('https://www.terabox.com/')) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => '<html></html>' };
    }
    if (u.includes('/api/list')) {
      return jsonResponse({
        errno: 0,
        list: [
          { fs_id: '111', server_filename: 'scene.spz', path: '/scene.spz', size: 1000, isdir: 0 },
          { fs_id: '222', server_filename: 'tex.webp', path: '/tex.webp', size: 100, isdir: 0 },
        ],
      });
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  const items = [
    {
      id: 'ceramic',
      fileName: 'ceramic.spz',
      spzUrl: '/telegram-media/BQADxxx',
      textureUrl: '/telegram-media/CAADyyy',
      extraMetadata: {
        sceneFiles: {
          terabox: {
            spz: { fileId: '111', filename: 'scene.spz' },
            texture: { fileId: '222', filename: 'tex.webp' },
          },
        },
      },
    },
  ];
  try {
    const result = await checkTeraBoxSceneIntegrity(items, items, 'ndus=fake; browserid=fake');
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].item.id, 'ceramic');
    assert.equal(result.found[0].spzMatched.fs_id, '111');
    assert.equal(result.found[0].texMatched.fs_id, '222');
    assert.equal(result.missing.length, 0);
    assert.deepEqual(result.unverified, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.19.26 (2026-11-20): checkTelegramSceneIntegrity reports over-20 MB files as unverified, not broken — and still calls a deleted post broken', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = String(url || '');
    if (!u.includes('/getFile')) throw new Error(`unexpected fetch: ${u}`);
    const fileId = options?.body?.get?.('file_id') || '';
    if (fileId === 'big-spz') {
      // the API itself rejects over-20 MB files from getFile
      return jsonResponse({ ok: false, error_code: 400, description: 'Bad Request: file is too big' });
    }
    if (fileId === 'huge-spz') {
      // the client-side gate: the API returns metadata over the cap
      return jsonResponse({ ok: true, result: { file_id: 'huge-spz', file_path: 'x', file_size: 30 * 1024 * 1024 } });
    }
    if (fileId === 'gone-spz') {
      return jsonResponse({ ok: false, error_code: 400, description: 'Bad Request: invalid file id' });
    }
    return jsonResponse({ ok: true, result: { file_id: fileId, file_path: 'x', file_size: 100 } });
  };
  const sceneItem = (id, spzFileId, texFileId, messageId) => ({
    id,
    fileName: `${id}.spz`,
    extraMetadata: {
      sceneFiles: {
        telegram: {
          spz: { fileId: spzFileId, filename: `${id}.spz`, messageId: String(messageId) },
          texture: { fileId: texFileId, filename: `${id}.webp`, messageId: String(messageId + 1) },
        },
      },
    },
  });
  const items = [
    sceneItem('ceramic', 'big-spz', 'small-tex', 589),
    sceneItem('huge', 'huge-spz', 'small-tex2', 591),
    sceneItem('gone', 'gone-spz', 'small-tex3', 593),
  ];
  try {
    const result = await checkTelegramSceneIntegrity(items, items, { token: 'fake-token', channel: '-1003959088547' });
    assert.equal(result.unverified.length, 2);
    assert.deepEqual(result.unverified.map((e) => e.item.id).sort(), ['ceramic', 'huge']);
    assert.equal(result.missing.length, 1);
    assert.equal(result.missing[0].item.id, 'gone');
    assert.equal(result.found.length, 0);
    assert.ok(result.unverified.map((e) => (e.reasons || []).join(' ')).join(' ').match(/too big/i));
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------------------------------------------------------- filemoon ---

test('2.11.19 (2026-09-19): listAllFilemoonFiles reads results_total (NOT .total) and paginates past 100', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const page = Number(new URL(String(url)).searchParams.get('page'));
    const files = page === 1
      ? Array.from({ length: 100 }, (_, i) => ({ file_code: `f${i}` }))
      : Array.from({ length: 11 }, (_, i) => ({ file_code: `g${i}` }));
    // Deliberately NO `.total` key — the old code read it and stopped at page 1.
    return jsonResponse({ status: 200, result: { files, results_total: 111 } });
  };
  try {
    const files = await listAllFilemoonFiles('fake-key');
    assert.equal(files.length, 111);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.11.19 (2026-09-19): listAllFilemoonFiles stops on a short page and fails loud on HTTP/API errors', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ status: 200, result: { files: [{ file_code: 'only' }], results_total: 500 } });
  };
  try {
    const files = await listAllFilemoonFiles('fake-key');
    assert.equal(files.length, 1);
    assert.equal(calls, 1, 'a short page breaks the loop even when the total promises more');
  } finally {
    globalThis.fetch = realFetch;
  }

  globalThis.fetch = async () => jsonResponse({}, 503);
  try {
    await assert.rejects(() => listAllFilemoonFiles('fake-key'), /Byse \/file\/list HTTP 503/);
  } finally {
    globalThis.fetch = realFetch;
  }

  globalThis.fetch = async () => jsonResponse({ status: 403, msg: 'bad key' });
  try {
    await assert.rejects(() => listAllFilemoonFiles('fake-key'), /bad key/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.10.6 (2026-08-16): extractFilemoonFilecode reads /d/ and /e/ URLs', () => {
  assert.equal(extractFilemoonFilecode('https://filemoon.sx/d/abc123'), 'abc123');
  assert.equal(extractFilemoonFilecode('https://filemoon.sx/e/abc123'), 'abc123');
  assert.equal(extractFilemoonFilecode('https://filemoon.sx/x/abc123'), null);
  assert.equal(extractFilemoonFilecode(''), null);
});

// ------------------------------------------------------------- PoW ---

test('2.12.x (2026-09): solveFilemoonPow returns "0" for a non-positive difficulty and the same smallest counter every time', () => {
  assert.equal(solveFilemoonPow('nonce-a', 0), '0');
  assert.equal(solveFilemoonPow('nonce-a', -5), '0');
  const a = solveFilemoonPow('nonce-b', 4);
  const b = solveFilemoonPow('nonce-b', 4);
  assert.ok(/^\d+$/.test(a));
  assert.equal(a, b, 'the smallest counter is deterministic');
});

test('2.12.x (2026-09): solveFilemoonPow gives up (null) when the budget expires instead of spinning forever', () => {
  const result = solveFilemoonPow('nonce-c', 256, 1);
  assert.equal(result, null);
});

// ------------------------------------------- source assertions (wiring) ---

test('2.12.53-67 (2026-09-09): the terabox scene check matches by fid, then name, then the spz URL fid — and reports both matches', () => {
  const api = src('../src/utils/teraBoxApi.js');
  const fn = api.slice(api.indexOf('checkTeraBoxSceneIntegrity'));
  assert.ok(fn.includes('const hasTeraboxRef = Boolean('));
  assert.ok(fn.includes('if (spzFid) spzMatched = fileMap.get(String(spzFid)) || null;'));
  assert.ok(fn.includes('if (!spzMatched && spzName) spzMatched = fileMap.get(spzName) || null;'));
  assert.ok(fn.includes('if (!spzMatched && item.spzUrl) {'));
  assert.ok(fn.includes('noUrl.push({ item, codes: [], spzFid: spzFid || null, texFid: texFid || null, spzMatched: null, texMatched: null });'));
});

test('2.2.9/2.2.7 (2026-08-04): the Resolve page re-reads fresh items per check, clears stale notices, shows success, and merges vault items into matching', () => {
  const page = src('../src/pages/ResolvePage.jsx');
  assert.equal((page.match(/sendMessage\('getImages'\)/g) || []).length, 7);
  assert.ok((page.match(/setNotice\(null\);/g) || []).length >= 3);
  assert.ok(page.includes("notice.type === 'success'"));
  assert.ok(page.includes('findPendingItemForFile([...(images || []), ...(vaultImages || [])], file)'));
  assert.ok(page.includes('findMatchingItemForFile([...(images || []), ...(vaultImages || [])], file)'));
  assert.ok(page.includes('deleteTeraBoxFiles'));
  assert.ok(page.includes('deleteFilemoonFile'));
  assert.ok(page.includes('deleteTelegramMessage'));
});

test('2.12.65/66 (2026-09-11): scene cards use textureUrl as the thumbnail and refresh stale terabox dm-d texture links', () => {
  const page = src('../src/pages/GalleryPage.jsx');
  assert.ok(page.includes('const [sceneTexThumbs, setSceneTexThumbs] = useState({}); // { sceneId: fresh textureUrl } for terabox scenes'));
  assert.ok(page.includes("if (getMediaItemKind(img) !== 'scene' || !img.textureUrl) return false;"));
  assert.ok(page.includes("return /terabox\\.com/i.test(img.textureUrl);"));
  assert.ok(page.includes('const [is3DMode, setIs3DMode] = useState(false);'));
});

test('2.12.62/63 (2026-09-10): the scene viewer header floats above the canvas and the clear-cache button works even when the module died at 32%', () => {
  const html = src('../scene-viewer.html');
  assert.ok(html.includes('position: fixed; top: 0; left: 0; right: 0; z-index: 30;'));
  assert.ok(html.includes('id="clearCacheBtn" title="Clear cache & reload (fixes stuck 32%)"'));
  assert.ok(html.includes('// Inline fallback so the clear-cache button always works — even if the'));
  assert.ok(html.includes("document.getElementById('clearCacheBtn')?.addEventListener('click', () => {"));
});

test('2.13.4 (2026-09-26): getSceneDirectUrl returns UDrop /file/ URLs UNCHANGED — the 302 self-refreshes, the download API 404s', () => {
  const bg = src('../src/background/background.js');
  const fn = bg.slice(bg.indexOf('async getSceneDirectUrl('));
  assert.ok(fn.includes('// UDrop: NO URL refresh.'));
  assert.ok(fn.includes('302-redirects to the bytes with a token'));
});

// ------------------------------------------------- gap-closing pins ---

test('2.12.57/60 + 2.13.17 (2026-09): scene Fix has a modal + an auto path, and the auto path resolves a FRESH terabox dlink before downloading', () => {
  const page = src('../src/pages/ResolvePage.jsx');
  assert.ok(page.includes('const runSceneFix = async ({ item, host, spzFile, textureFile, configFile }) => {'));
  assert.ok(page.includes('const startSceneFix = async (item, targetHost) => {'));
  assert.ok(page.includes('<SceneFixModal'));
  const auto = page.slice(page.indexOf('const startSceneFix'));
  assert.ok(auto.includes("const fresh = await resolveTeraBoxPlaybackUrl(hostSettings?.teraboxCookie || '', stableFileId, fileName || '');"));
});

test('2.13.4 (2026-09-18): the 3D tab runs ONE check keyed to the resolved default tab — sceneCheckedTab re-syncs when the stored default lands late', () => {
  const page = src('../src/pages/ResolvePage.jsx');
  assert.ok(page.includes("const [sceneCheckedTab, setSceneCheckedTab] = useState('');"));
  assert.ok(page.includes('const sceneUserPickedRef = useRef(false);'));
  assert.ok(page.includes('sceneUserPickedRef.current = true;'));
});

test('2.19.25 (2026-11-19): the filemoon resolve check skips songs without a filemoon link — filemoon is video-only, so a song can never have one and must not sit in noUrl forever offering a Fix that always fails', () => {
  const page = src('../src/pages/ResolvePage.jsx');
  assert.ok(page.includes("import { isAudioMediaItem } from '../utils/audioProviderLinks';"));
  const fn = page.slice(page.indexOf('const runFilemoonIntegrityCheck'));
  assert.ok(fn.includes('if (isAudioMediaItem(item) && !hasFilemoon) return false;'));
});

// --------------------------------------- scene checks, 2.19.26 variants ---
// The 2.19.26 fix made the udrop + terabox scene checks match through
// sceneFiles.<host> (the per-host record) instead of only the spzUrl /
// textureUrl pointers (single-host — a Fix moves them). These variants pin
// every combination of pointer-vs-record so a future refactor cannot
// silently re-break one of them.

const udropListingFetch = (files) => async () => jsonResponse({
  _status: 'success',
  data: { files, folders: [] },
});

test('2.19.26 (2026-11-20): udrop scene check — spz via sceneFiles + texture via the pointer is found', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = udropListingFetch([
    { short_url: 'spz9', file_id: '2625007', name: 'amphi.spz', status: 'active' },
    { short_url: 'tex1', file_id: '2625008', name: 'amphi.webp', status: 'active' },
  ]);
  const items = [{
    id: 'mixed-spz-record',
    spzUrl: '/telegram-media/BQADxxx',
    textureUrl: 'https://www.udrop.com/file/tex1',
    extraMetadata: { sceneFiles: { udrop: { spz: { fileId: '2625007', filename: 'amphi.spz' } } } },
  }];
  try {
    const result = await checkSceneIntegrity(items, items, 'fake-token', 'fake-account');
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].spzMatched.file_id, '2625007');
    assert.equal(result.found[0].texMatched.short_url, 'tex1');
    assert.equal(result.missing.length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.19.26 (2026-11-20): udrop scene check — texture via sceneFiles + spz via the pointer is found', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = udropListingFetch([
    { short_url: 'spz1', file_id: '2625011', name: 'bath.spz', status: 'active' },
    { short_url: 'tex9', file_id: '2625015', name: 'bath.webp', status: 'active' },
  ]);
  const items = [{
    id: 'mixed-tex-record',
    spzUrl: 'https://www.udrop.com/file/spz1',
    textureUrl: '/telegram-media/CAADyyy',
    extraMetadata: { sceneFiles: { udrop: { texture: { fileId: '2625015', filename: 'bath.webp' } } } },
  }];
  try {
    const result = await checkSceneIntegrity(items, items, 'fake-token', 'fake-account');
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].spzMatched.short_url, 'spz1');
    assert.equal(result.found[0].texMatched.file_id, '2625015');
    assert.equal(result.missing.length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.19.26 (2026-11-20): udrop scene check — a sceneFiles spz code missing from the listing is missing, with the texture match still reported', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = udropListingFetch([
    { short_url: 'tex1', file_id: '2625008', name: 'amphi.webp', status: 'active' },
  ]);
  const items = [{
    id: 'spz-gone',
    spzUrl: '/telegram-media/BQADxxx',
    textureUrl: '/telegram-media/CAADyyy',
    extraMetadata: {
      sceneFiles: {
        udrop: {
          spz: { fileId: '2625007', filename: 'amphi.spz' },
          texture: { fileId: '2625008', filename: 'amphi.webp' },
        },
      },
    },
  }];
  try {
    const result = await checkSceneIntegrity(items, items, 'fake-token', 'fake-account');
    assert.equal(result.found.length, 0);
    assert.equal(result.missing.length, 1);
    assert.equal(result.missing[0].spzMatched, null);
    assert.equal(result.missing[0].texMatched.file_id, '2625008');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.19.26 (2026-11-20): udrop scene check — the legacy top-level item.sceneFiles.udrop copy counts when extraMetadata has none', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = udropListingFetch([
    { short_url: 'spz9', file_id: '2625007', name: 'amphi.spz', status: 'active' },
    { short_url: 'tex9', file_id: '2625008', name: 'amphi.webp', status: 'active' },
  ]);
  const items = [{
    id: 'legacy-top-level',
    spzUrl: '/telegram-media/BQADxxx',
    textureUrl: '/telegram-media/CAADyyy',
    sceneFiles: {
      udrop: {
        spz: { fileId: '2625007', filename: 'amphi.spz' },
        texture: { fileId: '2625008', filename: 'amphi.webp' },
      },
    },
  }];
  try {
    const result = await checkSceneIntegrity(items, items, 'fake-token', 'fake-account');
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].item.id, 'legacy-top-level');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.19.26 (2026-11-20): udrop scene check — extraMetadata.sceneFiles.udrop wins over the top-level copy when both exist', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = udropListingFetch([
    { short_url: 'spz9', file_id: '2625007', name: 'amphi.spz', status: 'active' },
    { short_url: 'tex9', file_id: '2625008', name: 'amphi.webp', status: 'active' },
  ]);
  const items = [{
    id: 'extra-wins',
    spzUrl: '/telegram-media/BQADxxx',
    textureUrl: '/telegram-media/CAADyyy',
    extraMetadata: {
      sceneFiles: {
        udrop: {
          spz: { fileId: '2625007', filename: 'amphi.spz' },
          texture: { fileId: '2625008', filename: 'amphi.webp' },
        },
      },
    },
    // stale top-level copy pointing at files that are NOT in the listing —
    // if the check read this one instead, the scene would show broken.
    sceneFiles: {
      udrop: {
        spz: { fileId: '9999999', filename: 'amphi.spz' },
        texture: { fileId: '9999998', filename: 'amphi.webp' },
      },
    },
  }];
  try {
    const result = await checkSceneIntegrity(items, items, 'fake-token', 'fake-account');
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].spzMatched.file_id, '2625007');
    assert.equal(result.missing.length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.19.26 (2026-11-20): udrop scene check — the pointer wins when it IS a udrop URL, even when sceneFiles names a different live file', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = udropListingFetch([
    { short_url: 'ptr1', file_id: '1', name: 'pointer.spz', status: 'active' },
    { short_url: 'spz9', file_id: '2625007', name: 'record.spz', status: 'active' },
    { short_url: 'tex1', file_id: '2', name: 'tex.webp', status: 'active' },
  ]);
  const items = [{
    id: 'pointer-wins',
    spzUrl: 'https://www.udrop.com/file/ptr1',
    textureUrl: 'https://www.udrop.com/file/tex1',
    extraMetadata: { sceneFiles: { udrop: { spz: { fileId: '2625007', filename: 'record.spz' } } } },
  }];
  try {
    const result = await checkSceneIntegrity(items, items, 'fake-token', 'fake-account');
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].spzMatched.short_url, 'ptr1');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.19.26 (2026-11-20): udrop scene check — a texture-only ref (no spz code anywhere) is found when the texture is there', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = udropListingFetch([
    { short_url: 'tex1', file_id: '2', name: 'tex.webp', status: 'active' },
  ]);
  const items = [{
    id: 'tex-only',
    spzUrl: '/telegram-media/BQADxxx',
    textureUrl: 'https://www.udrop.com/file/tex1',
  }];
  try {
    const result = await checkSceneIntegrity(items, items, 'fake-token', 'fake-account');
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].spzMatched, null);
    assert.equal(result.found[0].texMatched.short_url, 'tex1');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.19.26 (2026-11-20): udrop scene check — a listing failure THROWS, never a partial report', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({}, 500);
  try {
    await assert.rejects(
      () => checkSceneIntegrity([{ id: 'x' }], [{ id: 'x' }], 'fake-token', 'fake-account'),
      /UDrop folder\/listing failed: HTTP 500/,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

const teraboxSceneFetch = (list) => async (url) => {
  const u = String(url || '');
  if (u.startsWith('https://www.terabox.com/')) {
    return { ok: true, status: 200, json: async () => ({}), text: async () => '<html></html>' };
  }
  if (u.includes('/api/list')) {
    return jsonResponse({ errno: 0, list });
  }
  throw new Error(`unexpected fetch: ${u}`);
};

test('2.19.26 (2026-11-20): terabox scene check — the spz matches through the videoHosts fileId fallback when sceneFiles has no spz entry', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = teraboxSceneFetch([
    { fs_id: '111', server_filename: 'scene.spz', path: '/scene.spz', size: 1000, isdir: 0 },
    { fs_id: '222', server_filename: 'tex.webp', path: '/tex.webp', size: 100, isdir: 0 },
  ]);
  const items = [{
    id: 'vh-fallback',
    fileName: 'ceramic.spz',
    spzUrl: '/telegram-media/BQADxxx',
    textureUrl: '/telegram-media/CAADyyy',
    // filename deliberately does NOT match the listing — the match must
    // come from the fileId, not the name fallback.
    videoHosts: { terabox: { fileId: '111', filename: 'other-name.spz', watchUrl: 'https://www.terabox.com/sharing/link?surl=x' } },
    extraMetadata: { sceneFiles: { terabox: { texture: { fileId: '222', filename: 'tex.webp' } } } },
  }];
  try {
    const result = await checkTeraBoxSceneIntegrity(items, items, 'ndus=fake; browserid=fake');
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].spzMatched.fs_id, '111');
    assert.equal(result.found[0].texMatched.fs_id, '222');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.19.26 (2026-11-20): terabox scene check — a texture fs_id missing from the listing is missing, with the spz match still reported', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = teraboxSceneFetch([
    { fs_id: '111', server_filename: 'scene.spz', path: '/scene.spz', size: 1000, isdir: 0 },
  ]);
  const items = [{
    id: 'tex-gone',
    fileName: 'ceramic.spz',
    spzUrl: '/telegram-media/BQADxxx',
    textureUrl: '/telegram-media/CAADyyy',
    extraMetadata: {
      sceneFiles: {
        terabox: {
          spz: { fileId: '111', filename: 'scene.spz' },
          texture: { fileId: '999', filename: 'tex.webp' },
        },
      },
    },
  }];
  try {
    const result = await checkTeraBoxSceneIntegrity(items, items, 'ndus=fake; browserid=fake');
    assert.equal(result.found.length, 0);
    assert.equal(result.missing.length, 1);
    assert.equal(result.missing[0].spzMatched.fs_id, '111');
    assert.equal(result.missing[0].texMatched, null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.19.26 (2026-11-20): terabox scene check — a foreign-host scene (telegram pointers, no terabox refs) lands in noUrl, never missing', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = teraboxSceneFetch([
    { fs_id: '111', server_filename: 'scene.spz', path: '/scene.spz', size: 1000, isdir: 0 },
  ]);
  const items = [{
    id: 'telegram-only',
    fileName: 'other.spz',
    spzUrl: '/telegram-media/BQADxxx',
    textureUrl: '/telegram-media/CAADyyy',
  }];
  try {
    const result = await checkTeraBoxSceneIntegrity(items, items, 'ndus=fake; browserid=fake');
    assert.equal(result.found.length, 0);
    assert.equal(result.missing.length, 0);
    assert.equal(result.noUrl.length, 1);
    assert.equal(result.noUrl[0].item.id, 'telegram-only');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.19.26 (2026-11-20): terabox scene check — the spz matches by NAME when no file id is stored anywhere', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = teraboxSceneFetch([
    { fs_id: '111', server_filename: 'scene.spz', path: '/scene.spz', size: 1000, isdir: 0 },
    { fs_id: '222', server_filename: 'tex.webp', path: '/tex.webp', size: 100, isdir: 0 },
  ]);
  const items = [{
    id: 'name-fallback',
    fileName: 'scene.spz',
    spzUrl: '/telegram-media/BQADxxx',
    textureUrl: '/telegram-media/CAADyyy',
    videoHosts: { terabox: { filename: 'scene.spz', watchUrl: 'https://www.terabox.com/sharing/link?surl=x' } },
    extraMetadata: { sceneFiles: { terabox: { texture: { fileId: '222', filename: 'tex.webp' } } } },
  }];
  try {
    const result = await checkTeraBoxSceneIntegrity(items, items, 'ndus=fake; browserid=fake');
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].spzMatched.fs_id, '111');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.19.26 (2026-11-20): terabox scene check — the spz matches by the fid in the spzUrl dlink when nothing else names it', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = teraboxSceneFetch([
    { fs_id: '111', server_filename: 'scene.spz', path: '/scene.spz', size: 1000, isdir: 0 },
    { fs_id: '222', server_filename: 'tex.webp', path: '/tex.webp', size: 100, isdir: 0 },
  ]);
  const items = [{
    id: 'dlink-fallback',
    fileName: 'renamed-locally.spz',
    spzUrl: 'https://d.terabox.com/file/abc123?fid=7-99-111',
    textureUrl: '/telegram-media/CAADyyy',
    extraMetadata: { sceneFiles: { terabox: { texture: { fileId: '222', filename: 'tex.webp' } } } },
  }];
  try {
    const result = await checkTeraBoxSceneIntegrity(items, items, 'ndus=fake; browserid=fake');
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].spzMatched.fs_id, '111');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// FIXED in 2.19.27. The ceramic scene (d1394dbd) had NO spz on TeraBox at
// all: its sceneFiles.terabox held the TEXTURE only (fs_id 589797364224622),
// while videoHosts.terabox.fileId held that SAME texture fs_id mislabeled
// with the spz filename. checkTeraBoxSceneIntegrity used to read the spz id
// from extractTeraBoxFileId(item) FIRST — i.e. from videoHosts — so it
// probed the texture file twice and reported the scene FOUND (the live
// 2.19.26 resolve page showed "7 found" while ceramic's spz was genuinely
// missing). The spz id now comes from sceneFiles.terabox.spz first, and a
// videoHosts fileId equal to the texture fs_id never counts as the spz.
test('2.19.27 (2026-11-20): terabox scene check — a videoHosts fileId holding the TEXTURE fs_id must NOT count as the spz (ceramic masking case)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = teraboxSceneFetch([
    { fs_id: '589797364224622', server_filename: 'ceramic-texture.webp', path: '/ceramic-texture.webp', size: 67104, isdir: 0 },
  ]);
  const items = [{
    id: 'd1394dbd-5c75-4260-ba13-a2b8ca9f81fb',
    fileName: '31b40b75-fa05-403c-9bef-def66948e218_ceramic.spz',
    spzUrl: '/telegram-media/BQADxxx',
    textureUrl: 'https://www.terabox.com/file/tex?fid=1-2-589797364224622',
    videoHosts: {
      terabox: {
        fileId: '589797364224622',
        filename: '31b40b75-fa05-403c-9bef-def66948e218_ceramic.spz',
        watchUrl: 'https://www.terabox.com/sharing/link?surl=x',
      },
    },
    extraMetadata: {
      sceneFiles: {
        terabox: {
          texture: { fileId: '589797364224622', filename: 'ceramic-texture.webp' },
        },
      },
    },
  }];
  try {
    const result = await checkTeraBoxSceneIntegrity(items, items, 'ndus=fake; browserid=fake');
    assert.equal(result.found.length, 0, 'the spz is not on terabox — the scene must not be found');
    assert.equal(result.missing.length, 1);
    assert.equal(result.missing[0].spzMatched, null);
    assert.equal(result.missing[0].texMatched.fs_id, '589797364224622');
  } finally {
    globalThis.fetch = realFetch;
  }
});

const telegramSceneFetch = (byFileId) => async (url, options) => {
  const u = String(url || '');
  if (!u.includes('/getFile')) throw new Error(`unexpected fetch: ${u}`);
  const fileId = options?.body?.get?.('file_id') || '';
  const shape = byFileId[fileId];
  if (shape === 'gate-api') {
    return jsonResponse({ ok: false, error_code: 400, description: 'Bad Request: file is too big' });
  }
  if (shape === 'gate-client') {
    return jsonResponse({ ok: true, result: { file_id: fileId, file_path: 'x', file_size: 30 * 1024 * 1024 } });
  }
  if (shape === 'gone') {
    return jsonResponse({ ok: false, error_code: 400, description: 'Bad Request: invalid file id' });
  }
  if (shape === 'http500') {
    return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' };
  }
  return jsonResponse({ ok: true, result: { file_id: fileId, file_path: 'x', file_size: 100 } });
};

const telegramSceneItem = (id, spzFileId, texFileId, messageId = 500) => ({
  id,
  fileName: `${id}.spz`,
  extraMetadata: {
    sceneFiles: {
      telegram: {
        spz: { fileId: spzFileId, filename: `${id}.spz`, messageId: String(messageId) },
        texture: { fileId: texFileId, filename: `${id}.webp`, messageId: String(messageId + 1) },
      },
    },
  },
});

test('2.19.26 (2026-11-20): telegram scene check — small spz + small texture is found, with both file ids matched', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = telegramSceneFetch({});
  const items = [telegramSceneItem('small', 'spz-small', 'tex-small')];
  try {
    const result = await checkTelegramSceneIntegrity(items, items, { token: 'fake-token', channel: '-1003959088547' });
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].spzMatched.file_id, 'spz-small');
    assert.equal(result.found[0].texMatched.file_id, 'tex-small');
    assert.equal(result.found[0].spzPageUrl, 'https://t.me/c/3959088547/500');
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.unverified, []);
    assert.deepEqual(result.noUrl, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.19.26 (2026-11-20): telegram scene check — the buckets partition the items: found + missing + unverified + noUrl counts every scene exactly once', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = telegramSceneFetch({ 'gone-spz': 'gone', 'big-spz': 'gate-api' });
  const items = [
    telegramSceneItem('found-one', 'spz-a', 'tex-a', 500),
    telegramSceneItem('gone-one', 'gone-spz', 'tex-b', 510),
    telegramSceneItem('gated-one', 'big-spz', 'tex-c', 520),
    { id: 'no-ref-one', fileName: 'no-ref.spz' },
  ];
  try {
    const result = await checkTelegramSceneIntegrity(items, items, { token: 'fake-token', channel: '-1003959088547' });
    assert.deepEqual(result.found.map((e) => e.item.id), ['found-one']);
    assert.deepEqual(result.missing.map((e) => e.item.id), ['gone-one']);
    assert.deepEqual(result.unverified.map((e) => e.item.id), ['gated-one']);
    assert.deepEqual(result.noUrl.map((e) => e.item.id), ['no-ref-one']);
    assert.deepEqual(result.extra, []);
    const total = result.found.length + result.missing.length + result.unverified.length + result.noUrl.length;
    assert.equal(total, items.length);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.19.26 (2026-11-20): telegram scene check — a gated TEXTURE alone (spz fine) is unverified, not broken, and the spz match is kept', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = telegramSceneFetch({ 'big-tex': 'gate-client' });
  const items = [telegramSceneItem('tex-gated', 'spz-ok', 'big-tex')];
  try {
    const result = await checkTelegramSceneIntegrity(items, items, { token: 'fake-token', channel: '-1003959088547' });
    assert.equal(result.unverified.length, 1);
    assert.equal(result.unverified[0].spzMatched.file_id, 'spz-ok');
    assert.equal(result.unverified[0].texMatched, null);
    assert.equal(result.missing.length, 0);
    assert.ok((result.unverified[0].reasons || []).join(' ').match(/too big/i));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.19.26 (2026-11-20): telegram scene check — a 5xx probe failure THROWS (an outage is never reported as data loss)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = telegramSceneFetch({ 'spz-500': 'http500' });
  const items = [telegramSceneItem('outage', 'spz-500', 'tex-ok')];
  try {
    await assert.rejects(
      () => checkTelegramSceneIntegrity(items, items, { token: 'fake-token', channel: '-1003959088547' }),
      /HTTP 500/,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('2.19.26 (2026-11-20): the Resolve page All chip counts unverified scenes, and the Unverified chip names the 20 MB gate', () => {
  const page = src('../src/pages/ResolvePage.jsx');
  assert.ok(page.includes("count: sceneIntegrity.found.length + sceneIntegrity.missing.length + sceneIntegrity.noUrl.length + sceneIntegrity.extra.length + (sceneIntegrity.unverified?.length || 0)"));
  assert.ok(page.includes("{ value: 'unverified', label: 'Unverified', count: sceneIntegrity.unverified?.length || 0"));
  assert.ok(page.includes("the file exceeds Telegram\\'s 20 MB getFile limit, so the probe cannot confirm it"));
});

test('2.19.26 (2026-11-20): unverified scene rows get NO Fix button — re-uploading a file that is probably there would duplicate it', () => {
  const page = src('../src/pages/ResolvePage.jsx');
  // The scene-row Fix button is gated to noUrl + missing only.
  assert.ok(page.includes("{(status === 'noUrl' || status === 'missing') && ("));
  // And the unverified explainer says plainly there is nothing to fix.
  assert.ok(page.includes('this is not a broken link, and there is nothing to fix.'));
});

test('2.19.26 (2026-11-20): the scene notice line names the unverified count and the gate', () => {
  const page = src('../src/pages/ResolvePage.jsx');
  assert.ok(page.includes('unverified (over the 20 MB getFile limit — not broken)'));
});

