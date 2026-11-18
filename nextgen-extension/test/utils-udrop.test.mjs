// node:test suite for src/utils/udropApi.js — the UDrop API v2 client.
// All network is mocked (globalThis.fetch stubbed per test); fake tokens
// only. udropApi console.logs its authorize/listing results, so those tests
// run with console.log silenced.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_EXT_RE,
  SCENE_TEXTURE_EXT_RE,
  authorizeUdrop,
  buildUdropFileMap,
  checkSceneIntegrity,
  checkUdropFileExists,
  checkUdropIntegrity,
  deleteUdropFile,
  extractUdropCode,
  is3DSceneFamilyFile,
  listAllUdropFiles,
  listUdropFolder,
} from '../src/utils/udropApi.js';

const FAKE_TOKEN = 'fake-udrop-token';
const FAKE_ACCOUNT = 'fake-account-id';

const jsonResponse = (obj, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => obj,
  text: async () => JSON.stringify(obj),
});
const realFetch = globalThis.fetch;
const realLog = console.log;
let fetchCalls;
let fetchHandler;
beforeEach(() => {
  fetchCalls = [];
  fetchHandler = null;
  console.log = () => {};
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url: String(url), options });
    if (!fetchHandler) throw new Error(`unexpected fetch: ${url}`);
    return fetchHandler(String(url), options);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
});

// A folder-listing mock: folders keyed by folder id ('' = root).
const folderMock = (folders) => (url, options) => {
  const body = options?.body;
  const folderId = body?.get ? (body.get('folder_id') || '') : '';
  const data = folders[folderId];
  if (!data) return jsonResponse({ _status: 'error', response: 'no such folder' });
  return jsonResponse({ _status: 'success', data });
};

describe('extractUdropCode', () => {
  test('extracts from /file/ and bare URLs, query stripped', () => {
    assert.equal(extractUdropCode('https://www.udrop.com/file/abc123'), 'abc123');
    assert.equal(extractUdropCode('https://udrop.com/abc123'), 'abc123');
    assert.equal(extractUdropCode('https://www.udrop.com/file/abc123?x=1'), 'abc123');
    assert.equal(extractUdropCode('https://www.udrop.com/abc123/clip.mp4'), 'abc123');
  });
  test('is case-insensitive on the host', () => {
    assert.equal(extractUdropCode('https://WWW.UDROP.COM/AbC'), 'AbC');
  });
  test('returns null for anything else', () => {
    assert.equal(extractUdropCode('https://example.com/file/abc'), null);
    assert.equal(extractUdropCode('https://udrop.com/'), null);
    assert.equal(extractUdropCode(''), null);
    assert.equal(extractUdropCode(null), null);
  });
});

describe('buildUdropFileMap', () => {
  test('indexes by short_url, file_id, and the code in url', () => {
    const file = { short_url: 'abc', file_id: '42', url: 'https://udrop.com/xyz' };
    const map = buildUdropFileMap([file]);
    assert.strictEqual(map.get('abc'), file);
    assert.strictEqual(map.get('42'), file);
    assert.strictEqual(map.get('xyz'), file);
  });
  test('tolerates missing fields and an empty list', () => {
    assert.equal(buildUdropFileMap([]).size, 0);
    assert.equal(buildUdropFileMap([{}]).size, 0);
    assert.equal(buildUdropFileMap().size, 0);
  });
  test('shortUrl / id aliases work too', () => {
    const file = { shortUrl: 's1', id: '99' };
    const map = buildUdropFileMap([file]);
    assert.strictEqual(map.get('s1'), file);
    assert.strictEqual(map.get('99'), file);
  });
});

describe('3D scene family detection', () => {
  test('MODEL_EXT_RE matches model files', () => {
    for (const name of ['a.spz', 'a.glb', 'a.gltf', 'a.obj', 'a.fbx', 'a.usdz', 'a.blend']) {
      assert.equal(MODEL_EXT_RE.test(name), true, name);
    }
    assert.equal(MODEL_EXT_RE.test('a.mp4'), false);
    assert.equal(MODEL_EXT_RE.test('a.spz.bak'), false);
  });
  test('SCENE_TEXTURE_EXT_RE matches texture images', () => {
    for (const name of ['a.webp', 'a.png', 'a.jpg', 'a.tga', 'a.exr', 'a.hdr']) {
      assert.equal(SCENE_TEXTURE_EXT_RE.test(name), true, name);
    }
    assert.equal(SCENE_TEXTURE_EXT_RE.test('a.mp4'), false);
  });
  test('is3DSceneFamilyFile is the union of both', () => {
    assert.equal(is3DSceneFamilyFile('model.spz'), true);
    assert.equal(is3DSceneFamilyFile('tex.webp'), true);
    assert.equal(is3DSceneFamilyFile('clip.mp4'), false);
    assert.equal(is3DSceneFamilyFile(''), false);
    assert.equal(is3DSceneFamilyFile(null), false);
  });
});

describe('authorizeUdrop', () => {
  test('returns the data on success', async () => {
    fetchHandler = () => jsonResponse({ _status: 'success', data: { access_token: 't', account_id: 'a' } });
    assert.deepEqual(await authorizeUdrop('k1', 'k2'), { access_token: 't', account_id: 'a' });
    assert.match(fetchCalls[0].url, /\/authorize$/);
    assert.equal(fetchCalls[0].options.method, 'POST');
    assert.equal(fetchCalls[0].options.body.get('key1'), 'k1');
    assert.equal(fetchCalls[0].options.body.get('key2'), 'k2');
  });
  test('an HTTP error throws', async () => {
    fetchHandler = () => jsonResponse({}, { ok: false, status: 401 });
    await assert.rejects(() => authorizeUdrop('k1', 'k2'), /Auth failed: 401/);
  });
  test('a non-success _status throws with the API message', async () => {
    fetchHandler = () => jsonResponse({ _status: 'error', response: 'bad keys' });
    await assert.rejects(() => authorizeUdrop('k1', 'k2'), /Auth error: bad keys/);
  });
  test('success without data throws', async () => {
    fetchHandler = () => jsonResponse({ _status: 'success' });
    await assert.rejects(() => authorizeUdrop('k1', 'k2'), /no data returned/);
  });
});

describe('listUdropFolder', () => {
  test('returns files and folders, filtering trash/deleted', async () => {
    fetchHandler = () => jsonResponse({
      _status: 'success',
      data: {
        files: [
          { short_url: 'a', status: 'active' },
          { short_url: 'b', status: 'trash' },
          { short_url: 'c', status: 'deleted' },
          { short_url: 'd' },
        ],
        folders: [{ id: 'f1', name: 'Sub' }],
      },
    });
    const out = await listUdropFolder(FAKE_TOKEN, FAKE_ACCOUNT);
    assert.deepEqual(out.files.map((f) => f.short_url), ['a', 'd']);
    assert.deepEqual(out.folders, [{ id: 'f1', name: 'Sub' }]);
    assert.equal(fetchCalls[0].options.body.get('access_token'), FAKE_TOKEN);
    assert.equal(fetchCalls[0].options.body.get('account_id'), FAKE_ACCOUNT);
    assert.equal(fetchCalls[0].options.body.get('folder_id'), null);
  });
  test('subFolders is accepted as the folders alias', async () => {
    fetchHandler = () => jsonResponse({
      _status: 'success',
      data: { files: [], subFolders: [{ id: 'f2' }] },
    });
    assert.deepEqual((await listUdropFolder(FAKE_TOKEN, FAKE_ACCOUNT)).folders, [{ id: 'f2' }]);
  });
  test('a folder id rides the form and errors name the folder', async () => {
    fetchHandler = () => jsonResponse({}, { ok: false, status: 500 });
    await assert.rejects(
      () => listUdropFolder(FAKE_TOKEN, FAKE_ACCOUNT, 'f9'),
      /UDrop folder\/listing failed: HTTP 500 \(folder f9\)/,
    );
    assert.equal(fetchCalls[0].options.body.get('folder_id'), 'f9');
  });
  test('a non-success _status throws loudly', async () => {
    fetchHandler = () => jsonResponse({ _status: 'error', response: 'bad token' });
    await assert.rejects(() => listUdropFolder(FAKE_TOKEN, FAKE_ACCOUNT), /bad token/);
  });
});

describe('listAllUdropFiles', () => {
  test('recurses into subfolders and tags files with the folder name', async () => {
    fetchHandler = folderMock({
      '': {
        files: [{ short_url: 'root1' }],
        folders: [{ id: 'f1', name: 'Sub' }],
      },
      f1: {
        files: [{ short_url: 'sub1' }],
        folders: [{ id: 'f2', folder_name: 'Deep' }],
      },
      f2: { files: [{ short_url: 'deep1' }], folders: [] },
    });
    const files = await listAllUdropFiles(FAKE_TOKEN, FAKE_ACCOUNT);
    assert.deepEqual(files.map((f) => [f.short_url, f._folderName]), [
      ['root1', 'root'],
      ['sub1', 'Sub'],
      ['deep1', 'Deep'],
    ]);
  });
  test('a folder cycle is visited once', async () => {
    fetchHandler = folderMock({
      '': { files: [], folders: [{ id: 'f1' }] },
      f1: { files: [{ short_url: 'x' }], folders: [{ id: '' }, { id: 'f1' }] },
    });
    const files = await listAllUdropFiles(FAKE_TOKEN, FAKE_ACCOUNT);
    assert.equal(files.length, 1);
    assert.equal(fetchCalls.length, 2);
  });
  test('a folder failure aborts the whole listing', async () => {
    fetchHandler = folderMock({ '': { files: [], folders: [{ id: 'f1' }] } });
    await assert.rejects(() => listAllUdropFiles(FAKE_TOKEN, FAKE_ACCOUNT), /no such folder/);
  });
});

describe('checkUdropFileExists', () => {
  test('a numeric id posts file_id, a code posts short_url', async () => {
    fetchHandler = () => jsonResponse({ _status: 'success', data: { download_url: 'https://cdn.example/a.mp4' } });
    assert.deepEqual(await checkUdropFileExists(FAKE_TOKEN, FAKE_ACCOUNT, '42'), {
      exists: true,
      raw: { download_url: 'https://cdn.example/a.mp4' },
    });
    assert.equal(fetchCalls[0].options.body.get('file_id'), '42');
    assert.equal(fetchCalls[0].options.body.get('short_url'), null);
    await checkUdropFileExists(FAKE_TOKEN, FAKE_ACCOUNT, 'abc');
    assert.equal(fetchCalls[1].options.body.get('short_url'), 'abc');
    assert.equal(fetchCalls[1].options.body.get('file_id'), null);
  });
  test('an HTTP error means not-exists (no throw)', async () => {
    fetchHandler = () => jsonResponse({}, { ok: false, status: 404 });
    assert.deepEqual(await checkUdropFileExists(FAKE_TOKEN, FAKE_ACCOUNT, 'abc'), { exists: false, raw: null });
  });
  test('success without a download_url means not-exists', async () => {
    fetchHandler = () => jsonResponse({ _status: 'success', data: {} });
    const out = await checkUdropFileExists(FAKE_TOKEN, FAKE_ACCOUNT, 'abc');
    assert.equal(out.exists, false);
    assert.deepEqual(out.raw, { _status: 'success', data: {} });
  });
});

describe('deleteUdropFile', () => {
  test('returns true on success', async () => {
    fetchHandler = () => jsonResponse({ _status: 'success' });
    assert.equal(await deleteUdropFile(FAKE_TOKEN, FAKE_ACCOUNT, '42'), true);
    assert.equal(fetchCalls[0].options.body.get('file_id'), '42');
  });
  test('throws on failure', async () => {
    fetchHandler = () => jsonResponse({ _status: 'error', response: 'nope' });
    await assert.rejects(() => deleteUdropFile(FAKE_TOKEN, FAKE_ACCOUNT, '42'), /nope/);
    fetchHandler = () => jsonResponse({}, { ok: false, status: 500 });
    await assert.rejects(() => deleteUdropFile(FAKE_TOKEN, FAKE_ACCOUNT, '42'), /Delete failed: 500/);
  });
});

describe('checkUdropIntegrity', () => {
  test('splits items into found / missing / noUrl and reports extras', async () => {
    fetchHandler = folderMock({
      '': {
        files: [
          { short_url: 'aaa', file_id: '1', name: 'found.mp4' },
          { short_url: 'zzz', file_id: '9', name: 'orphan.mp4' },
        ],
        folders: [],
      },
    });
    const out = await checkUdropIntegrity([
      { id: '1', udropWatchUrl: 'https://udrop.com/aaa' },
      { id: '2', udropWatchUrl: 'https://udrop.com/bbb' },
      { id: '3', fileName: 'no-link.mp4' },
    ], [], FAKE_TOKEN, FAKE_ACCOUNT);
    assert.deepEqual(out.found.map((f) => f.item.id), ['1']);
    assert.deepEqual(out.missing.map((f) => f.item.id), ['2']);
    assert.deepEqual(out.noUrl.map((f) => f.item.id), ['3']);
    assert.deepEqual(out.extra.map((e) => e.file.short_url), ['zzz']);
  });
  test('a match by file_id counts', async () => {
    fetchHandler = folderMock({
      '': { files: [{ short_url: 'aaa', file_id: '1', name: 'f.mp4' }], folders: [] },
    });
    const out = await checkUdropIntegrity(
      [{ id: '1', videoHosts: { udrop: { watchUrl: 'https://udrop.com/1' } } }],
      [], FAKE_TOKEN, FAKE_ACCOUNT,
    );
    assert.equal(out.found.length, 1);
  });
  test('3D scene files never show as video extras', async () => {
    fetchHandler = folderMock({
      '': {
        files: [
          { short_url: 's1', file_id: '1', name: 'model.spz' },
          { short_url: 't1', file_id: '2', name: 'texture.webp' },
          { short_url: 'v1', file_id: '3', name: 'orphan.mp4' },
        ],
        folders: [],
      },
    });
    const out = await checkUdropIntegrity([], [], FAKE_TOKEN, FAKE_ACCOUNT);
    assert.deepEqual(out.extra.map((e) => e.file.short_url), ['v1']);
  });
  test('scene and vault files referenced by allItems are not video extras', async () => {
    fetchHandler = folderMock({
      '': {
        files: [
          { short_url: 'spz', file_id: '1', name: 'model.spz' },
          { short_url: 'bin', file_id: '2', name: 'vault.bin' },
          { short_url: 'v1', file_id: '3', name: 'orphan.mp4' },
        ],
        folders: [],
      },
    });
    const out = await checkUdropIntegrity([], [
      { id: 'scene', spzUrl: 'https://udrop.com/spz' },
      { id: 'vault', encryptedBlobUrl: 'https://udrop.com/bin' },
    ], FAKE_TOKEN, FAKE_ACCOUNT);
    assert.deepEqual(out.extra.map((e) => e.file.short_url), ['v1']);
  });
  test('a listing failure THROWS', async () => {
    fetchHandler = () => jsonResponse({}, { ok: false, status: 500 });
    await assert.rejects(() => checkUdropIntegrity([], [], FAKE_TOKEN, FAKE_ACCOUNT), /HTTP 500/);
  });
});

describe('checkSceneIntegrity', () => {
  test('a scene with both files present is found', async () => {
    fetchHandler = folderMock({
      '': {
        files: [
          { short_url: 'spz1', file_id: '1', name: 'model.spz' },
          { short_url: 'tex1', file_id: '2', name: 'texture.webp' },
        ],
        folders: [],
      },
    });
    const out = await checkSceneIntegrity([
      { id: 's1', spzUrl: 'https://udrop.com/spz1', textureUrl: 'https://udrop.com/tex1' },
    ], [], FAKE_TOKEN, FAKE_ACCOUNT);
    assert.equal(out.found.length, 1);
    assert.equal(out.found[0].spzCode, 'spz1');
    assert.equal(out.found[0].texCode, 'tex1');
    assert.deepEqual(out.missing, []);
  });
  test('a partial scene (one file missing) counts as missing', async () => {
    fetchHandler = folderMock({
      '': { files: [{ short_url: 'spz1', file_id: '1', name: 'model.spz' }], folders: [] },
    });
    const out = await checkSceneIntegrity([
      { id: 's1', spzUrl: 'https://udrop.com/spz1', textureUrl: 'https://udrop.com/tex-gone' },
    ], [], FAKE_TOKEN, FAKE_ACCOUNT);
    assert.equal(out.missing.length, 1);
    assert.ok(out.missing[0].spzMatched);
    assert.equal(out.missing[0].texMatched, null);
  });
  test('a scene with no URLs lands in noUrl', async () => {
    fetchHandler = folderMock({ '': { files: [], folders: [] } });
    const out = await checkSceneIntegrity([{ id: 's1', fileName: 'model.spz' }], [], FAKE_TOKEN, FAKE_ACCOUNT);
    assert.equal(out.noUrl.length, 1);
    assert.equal(out.noUrl[0].spzCode, null);
  });
  test('orphan spz files pair with same-stem textures; lone textures are standalone', async () => {
    fetchHandler = folderMock({
      '': {
        files: [
          { short_url: 'a', file_id: '1', name: 'ceramic.spz' },
          { short_url: 'b', file_id: '2', name: 'ceramic.png' },
          { short_url: 'c', file_id: '3', name: 'lonely.webp' },
          { short_url: 'd', file_id: '4', name: 'video.mp4' },
        ],
        folders: [],
      },
    });
    const out = await checkSceneIntegrity([], [], FAKE_TOKEN, FAKE_ACCOUNT);
    assert.equal(out.extra.length, 2);
    const paired = out.extra.find((e) => e.file.short_url === 'a');
    assert.deepEqual(paired.textureFiles.map((f) => f.short_url), ['b']);
    const lone = out.extra.find((e) => e.file.short_url === 'c');
    assert.equal(lone.standaloneTexture, true);
    assert.deepEqual(lone.textureFiles, []);
  });
  test('video files referenced by allItems never show as scene extras', async () => {
    fetchHandler = folderMock({
      '': { files: [{ short_url: 'v1', file_id: '1', name: 'clip.mp4' }], folders: [] },
    });
    const out = await checkSceneIntegrity(
      [],
      [{ id: 'v', udropWatchUrl: 'https://udrop.com/v1' }],
      FAKE_TOKEN, FAKE_ACCOUNT,
    );
    assert.deepEqual(out.extra, []);
  });
});
