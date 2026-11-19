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
