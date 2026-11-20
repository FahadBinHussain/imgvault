// node:test suite for src/utils/filemoonApi.js + src/utils/filemoonSpa.js.
// All network is mocked (globalThis.fetch stubbed per test); fake API keys
// only. The PoW solver runs for real, with tiny difficulties so it is fast.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkFilemoonIntegrity,
  deleteFilemoonFile,
  extractFilemoonFilecode,
  getFilemoonDirectLink,
  getFilemoonFileInfo,
  getFilemoonHlsLink,
  listAllFilemoonFiles,
} from '../src/utils/filemoonApi.js';
import { getFilemoonStreamSource, solveFilemoonPow } from '../src/utils/filemoonSpa.js';

const FAKE_KEY = 'fake-byse-key-for-tests-only';

// --- fetch mock ----------------------------------------------------------
const jsonResponse = (obj, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => obj,
  text: async () => JSON.stringify(obj),
});
const realFetch = globalThis.fetch;
let fetchCalls;
let fetchHandler;
beforeEach(() => {
  fetchCalls = [];
  fetchHandler = null;
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url: String(url), options });
    if (!fetchHandler) throw new Error(`unexpected fetch: ${url}`);
    return fetchHandler(String(url), options);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('extractFilemoonFilecode', () => {
  test('extracts from /d/ and /e/ URLs', () => {
    assert.equal(extractFilemoonFilecode('https://filemoon.sx/d/abc123'), 'abc123');
    assert.equal(extractFilemoonFilecode('https://filemoon.sx/e/xyz789'), 'xyz789');
    assert.equal(extractFilemoonFilecode('https://filemoon.sx/d/abc123/clip.mp4'), 'abc123');
  });
  test('is case-insensitive on the host and path letter', () => {
    assert.equal(extractFilemoonFilecode('https://FILEMOON.SX/D/AbC123'), 'AbC123');
  });
  test('returns null for anything else', () => {
    assert.equal(extractFilemoonFilecode('https://example.com/d/abc'), null);
    assert.equal(extractFilemoonFilecode('https://filemoon.sx/abc'), null);
    assert.equal(extractFilemoonFilecode(''), null);
    assert.equal(extractFilemoonFilecode(null), null);
  });
});

describe('listAllFilemoonFiles', () => {
  test('pages through results_total', async () => {
    fetchHandler = (url) => {
      const page = Number(new URL(url).searchParams.get('page'));
      const files = page === 1
        ? Array.from({ length: 100 }, (_, i) => ({ file_code: `f${i}` }))
        : Array.from({ length: 50 }, (_, i) => ({ file_code: `g${i}` }));
      return jsonResponse({ status: 200, result: { files, results_total: 150 } });
    };
    const files = await listAllFilemoonFiles(FAKE_KEY);
    assert.equal(files.length, 150);
    assert.equal(fetchCalls.length, 2);
    assert.match(fetchCalls[0].url, /\/file\/list\?key=fake-byse-key-for-tests-only&per_page=100&page=1/);
  });
  test('stops early when a page comes back short', async () => {
    fetchHandler = () => jsonResponse({
      status: 200,
      result: { files: [{ file_code: 'a' }], results_total: 500 },
    });
    const files = await listAllFilemoonFiles(FAKE_KEY);
    assert.equal(files.length, 1);
    assert.equal(fetchCalls.length, 1);
  });
  test('falls back to .total and then to the fetched count', async () => {
    fetchHandler = () => jsonResponse({
      status: 200,
      result: { files: [{ file_code: 'a' }], total: 1 },
    });
    assert.equal((await listAllFilemoonFiles(FAKE_KEY)).length, 1);
    fetchHandler = () => jsonResponse({ status: 200, result: { files: [] } });
    assert.deepEqual(await listAllFilemoonFiles(FAKE_KEY), []);
  });
  test('an HTTP error throws with the status', async () => {
    fetchHandler = () => jsonResponse({}, { ok: false, status: 500 });
    await assert.rejects(() => listAllFilemoonFiles(FAKE_KEY), /Byse \/file\/list HTTP 500/);
  });
  test('a non-200 API status throws with the API message', async () => {
    fetchHandler = () => jsonResponse({ status: 403, msg: 'bad key' });
    await assert.rejects(() => listAllFilemoonFiles(FAKE_KEY), /bad key/);
    fetchHandler = () => jsonResponse({ status: 500 });
    await assert.rejects(() => listAllFilemoonFiles(FAKE_KEY), /Byse API error/);
  });
});

describe('getFilemoonHlsLink', () => {
  test('returns null without an api key or filecode, without fetching', async () => {
    assert.equal(await getFilemoonHlsLink('', 'abc'), null);
    assert.equal(await getFilemoonHlsLink(FAKE_KEY, ''), null);
    assert.equal(fetchCalls.length, 0);
  });
  test('prefers link, then url, hls, m3u8, file_url', async () => {
    for (const [field, value] of [
      ['link', 'https://cdn.example/a.m3u8'],
      ['url', 'https://cdn.example/b.m3u8'],
      ['hls', 'https://cdn.example/c.m3u8'],
      ['m3u8', 'https://cdn.example/d.m3u8'],
      ['file_url', 'https://cdn.example/e.m3u8'],
    ]) {
      fetchHandler = () => jsonResponse({ status: 200, result: { [field]: value } });
      assert.equal(await getFilemoonHlsLink(FAKE_KEY, 'abc'), value, field);
    }
  });
  test('returns null when the result has no link field', async () => {
    fetchHandler = () => jsonResponse({ status: 200, result: {} });
    assert.equal(await getFilemoonHlsLink(FAKE_KEY, 'abc'), null);
  });
  test('throws on HTTP errors and API rejections', async () => {
    fetchHandler = () => jsonResponse({}, { ok: false, status: 404 });
    await assert.rejects(() => getFilemoonHlsLink(FAKE_KEY, 'abc'), /Byse \/hls\/link HTTP 404/);
    fetchHandler = () => jsonResponse({ status: 400, msg: 'no such file' });
    await assert.rejects(() => getFilemoonHlsLink(FAKE_KEY, 'abc'), /Byse \/hls\/link rejected: no such file/);
  });
});

describe('getFilemoonFileInfo', () => {
  test('returns the result object on success', async () => {
    fetchHandler = () => jsonResponse({ status: 200, result: { file_code: 'abc', title: 'Clip' } });
    assert.deepEqual(await getFilemoonFileInfo(FAKE_KEY, 'abc'), { file_code: 'abc', title: 'Clip' });
  });
  test('returns null on a non-200 API status (no throw)', async () => {
    fetchHandler = () => jsonResponse({ status: 404, msg: 'gone' });
    assert.equal(await getFilemoonFileInfo(FAKE_KEY, 'abc'), null);
  });
  test('throws on HTTP errors', async () => {
    fetchHandler = () => jsonResponse({}, { ok: false, status: 500 });
    await assert.rejects(() => getFilemoonFileInfo(FAKE_KEY, 'abc'), /Byse \/file\/info HTTP 500/);
  });
  test('a 200 envelope whose inner result carries status 404 comes back as-is — /file/info CANNOT prove a file is alive', async () => {
    // Real shape, proven live 2026-11-20 (item ad7c1a53, code 39s1pwul65lm):
    // /file/info answers HTTP 200 with an inner [{status: 404}] payload for
    // a dead code. Any caller that trusts the envelope (or the HTTP status)
    // calls a dead file alive — which is why checkFilemoonIntegrity matches
    // ONLY against the /file/list listing and never consults /file/info.
    fetchHandler = () => jsonResponse({
      status: 200,
      result: [{ status: 404, file_code: '39s1pwul65lm' }],
    });
    assert.deepEqual(await getFilemoonFileInfo(FAKE_KEY, '39s1pwul65lm'), [
      { status: 404, file_code: '39s1pwul65lm' },
    ]);
  });
});

describe('getFilemoonDirectLink', () => {
  test('returns null without an api key or filecode, without fetching', async () => {
    assert.equal(await getFilemoonDirectLink('', 'abc'), null);
    assert.equal(await getFilemoonDirectLink(FAKE_KEY, ''), null);
    assert.equal(fetchCalls.length, 0);
  });
  test('accepts an array result or a single object', async () => {
    fetchHandler = () => jsonResponse({ status: 200, result: [{ file_url: 'https://cdn.example/a.mp4' }] });
    assert.equal(await getFilemoonDirectLink(FAKE_KEY, 'abc'), 'https://cdn.example/a.mp4');
    fetchHandler = () => jsonResponse({ status: 200, result: { file_url: 'https://cdn.example/b.mp4' } });
    assert.equal(await getFilemoonDirectLink(FAKE_KEY, 'abc'), 'https://cdn.example/b.mp4');
  });
  test('throws when no file_url is returned', async () => {
    fetchHandler = () => jsonResponse({ status: 200, result: [{}] });
    await assert.rejects(() => getFilemoonDirectLink(FAKE_KEY, 'abc'), /returned no file_url/);
  });
  test('throws on API rejection', async () => {
    fetchHandler = () => jsonResponse({ status: 403, msg: 'direct links disabled' });
    await assert.rejects(() => getFilemoonDirectLink(FAKE_KEY, 'abc'), /direct links disabled/);
  });
});

describe('deleteFilemoonFile', () => {
  test('returns true on success', async () => {
    fetchHandler = () => jsonResponse({ status: 200 });
    assert.equal(await deleteFilemoonFile(FAKE_KEY, 'abc'), true);
    assert.match(fetchCalls[0].url, /\/file\/delete\?key=.*&file_code=abc/);
  });
  test('throws on failure', async () => {
    fetchHandler = () => jsonResponse({ status: 400, msg: 'cannot delete' });
    await assert.rejects(() => deleteFilemoonFile(FAKE_KEY, 'abc'), /cannot delete/);
    fetchHandler = () => jsonResponse({}, { ok: false, status: 500 });
    await assert.rejects(() => deleteFilemoonFile(FAKE_KEY, 'abc'), /Byse \/file\/delete HTTP 500/);
  });
});

describe('checkFilemoonIntegrity', () => {
  const listing = (files) => () => jsonResponse({ status: 200, result: { files, results_total: files.length } });
  test('splits items into found / missing / noUrl and reports extras', async () => {
    fetchHandler = listing([
      { file_code: 'aaa', title: 'Found' },
      { file_code: 'zzz', title: 'Orphan' },
    ]);
    const out = await checkFilemoonIntegrity([
      { id: '1', filemoonWatchUrl: 'https://filemoon.sx/d/aaa' },
      { id: '2', filemoonWatchUrl: 'https://filemoon.sx/d/bbb' },
      { id: '3', fileName: 'no-link.mp4' },
    ], FAKE_KEY);
    assert.deepEqual(out.found.map((f) => f.item.id), ['1']);
    assert.equal(out.found[0].matchedFile.title, 'Found');
    assert.deepEqual(out.missing.map((f) => f.item.id), ['2']);
    assert.deepEqual(out.missing[0].codes, ['bbb']);
    assert.deepEqual(out.noUrl.map((f) => f.item.id), ['3']);
    assert.deepEqual(out.extra.map((e) => e.file.file_code), ['zzz']);
  });
  test('reads codes from videoHosts and extraMetadata filemoonLinks too', async () => {
    fetchHandler = listing([{ file_code: 'aaa' }, { file_code: 'ccc' }]);
    const out = await checkFilemoonIntegrity([
      { id: '1', videoHosts: { filemoon: { watchUrl: 'https://filemoon.sx/d/aaa' } } },
      { id: '2', extraMetadata: { filemoonLinks: [{ directUrl: 'https://filemoon.sx/e/ccc' }] } },
    ], FAKE_KEY);
    assert.deepEqual(out.found.map((f) => f.item.id), ['1', '2']);
    assert.deepEqual(out.missing, []);
  });
  test('a listing failure THROWS — never a partial report', async () => {
    fetchHandler = () => jsonResponse({}, { ok: false, status: 500 });
    await assert.rejects(() => checkFilemoonIntegrity([], FAKE_KEY), /Byse \/file\/list HTTP 500/);
  });
  test('duplicate codes on one item dedupe', async () => {
    fetchHandler = listing([{ file_code: 'aaa' }]);
    const out = await checkFilemoonIntegrity([
      {
        id: '1',
        filemoonWatchUrl: 'https://filemoon.sx/d/aaa',
        filemoonDirectUrl: 'https://filemoon.sx/d/aaa',
        videoHosts: { filemoon: { watchUrl: 'https://filemoon.sx/d/aaa' } },
      },
    ], FAKE_KEY);
    assert.deepEqual(out.found[0].codes, ['aaa']);
  });
  test('a code absent from the listing is broken — the check NEVER asks /file/info, which answers HTTP 200 for dead codes', async () => {
    // Real case, proven live 2026-11-20: item ad7c1a53 (dreamcore mkv) was
    // uploaded to filemoon at 00:08 and verified, then filemoon dropped it
    // within ~11 h. Code 39s1pwul65lm is gone from /file/list while
    // /file/info still answers HTTP 200 with an inner status 404 — so the
    // listing is the only liveness signal, and the check must not fall back
    // to a per-file probe that would call the dead file alive.
    fetchHandler = (url) => {
      assert.ok(!url.includes('/file/info'), 'the check must never call /file/info');
      return listing([{ file_code: 'other' }])(url);
    };
    const out = await checkFilemoonIntegrity([
      { id: 'ad7c1a53', videoHosts: { filemoon: { watchUrl: 'https://filemoon.sx/d/39s1pwul65lm' } } },
    ], FAKE_KEY);
    assert.deepEqual(out.found, []);
    assert.deepEqual(out.missing.map((f) => f.item.id), ['ad7c1a53']);
    assert.deepEqual(out.missing[0].codes, ['39s1pwul65lm']);
    assert.ok(fetchCalls.every((c) => c.url.includes('/file/list')));
  });
  test('one dead code + one live code on the same item is found (the live code carries it)', async () => {
    // Real case, proven live 2026-11-20: the Night Drive dup (9095a102)
    // carries dead code 5zz1b16cxcxh AND live code s7u2tp9euktn — the
    // resolve check finds it via the live one.
    fetchHandler = listing([{ file_code: 's7u2tp9euktn', title: 'Night Drive By Visualdon 4K 60fps' }]);
    const out = await checkFilemoonIntegrity([
      {
        id: '9095a102',
        videoHosts: { filemoon: { watchUrl: 'https://filemoon.sx/d/5zz1b16cxcxh' } },
        extraMetadata: { filemoonLinks: [{ watchUrl: 'https://filemoon.sx/d/s7u2tp9euktn' }] },
      },
    ], FAKE_KEY);
    assert.deepEqual(out.found.map((f) => f.item.id), ['9095a102']);
    assert.equal(out.found[0].matchedFile.file_code, 's7u2tp9euktn');
    assert.deepEqual(out.found[0].codes, ['5zz1b16cxcxh', 's7u2tp9euktn']);
    assert.deepEqual(out.missing, []);
  });
  test('an /e/ embed URL and a /d/ watch URL on the same item both resolve to the one code', async () => {
    fetchHandler = listing([{ file_code: 'aaa' }]);
    const out = await checkFilemoonIntegrity([
      {
        id: '1',
        filemoonWatchUrl: 'https://filemoon.sx/d/aaa',
        filemoonDirectUrl: 'https://filemoon.sx/e/aaa',
      },
    ], FAKE_KEY);
    assert.deepEqual(out.found.map((f) => f.item.id), ['1']);
    assert.deepEqual(out.found[0].codes, ['aaa']);
  });
});

describe('solveFilemoonPow', () => {
  test('difficulty 0 (or negative) solves immediately as "0"', () => {
    assert.equal(solveFilemoonPow('nonce', 0), '0');
    assert.equal(solveFilemoonPow('nonce', -5), '0');
  });
  test('a small difficulty solves deterministically', () => {
    const a = solveFilemoonPow('test-nonce-1', 1);
    const b = solveFilemoonPow('test-nonce-1', 1);
    assert.equal(typeof a, 'string');
    assert.equal(a, b);
  });
  test('an impossible difficulty within budget returns null', () => {
    assert.equal(solveFilemoonPow('test-nonce-2', 200, 1), null);
  });
});

// --- filemoonSpa getFilemoonStreamSource ---------------------------------
// Build a real AES-GCM playback payload in the test so the decrypt path is
// exercised end to end (key = two 16-byte parts concatenated, version out of
// the 1..20 selection range so ALL parts are used).
const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function buildPlayback(sources) {
  const partA = crypto.getRandomValues(new Uint8Array(16));
  const partB = crypto.getRandomValues(new Uint8Array(16));
  const keyBytes = new Uint8Array(32);
  keyBytes.set(partA, 0);
  keyBytes.set(partB, 16);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ sources }));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return {
    key_parts: [b64url(partA), b64url(partB)],
    version: '99',
    iv: b64url(iv),
    payload: b64url(new Uint8Array(cipher)),
  };
}

describe('getFilemoonStreamSource', () => {
  const sources = [
    { url: 'https://cdn.example/720.m3u8', label: '720p', mime_type: 'application/x-mpegURL', bitrate_kbps: 2500, height: 720 },
    { url: 'https://cdn.example/1080.m3u8', label: '1080p', mime_type: 'application/x-mpegURL', bitrate_kbps: 5000, height: 1080 },
  ];

  test('runs the full captcha -> pow -> verify -> playback flow and picks the tallest source', async () => {
    const playback = await buildPlayback(sources);
    fetchHandler = (url) => {
      if (url.endsWith('/captcha')) {
        return jsonResponse({ pow_token: 'tok', pow_nonce: 'spa-nonce', pow_difficulty: 1 });
      }
      if (url.endsWith('/captcha/verify')) {
        return jsonResponse({ status: 'ok', token: 'play-token' });
      }
      if (url.endsWith('/playback')) {
        return jsonResponse({ playback });
      }
      throw new Error(`unexpected spa url: ${url}`);
    };
    const out = await getFilemoonStreamSource('abc123');
    assert.deepEqual(out, {
      url: 'https://cdn.example/1080.m3u8',
      label: '1080p',
      mimeType: 'application/x-mpegURL',
      bitrateKbps: 5000,
    });
    assert.equal(fetchCalls.length, 3);
    // the playback call carries the captcha token header
    assert.equal(fetchCalls[2].options.headers['X-Captcha-Token'], 'play-token');
  });
  test('a captcha response without pow fields returns null', async () => {
    fetchHandler = () => jsonResponse({ pow_token: 'tok' });
    assert.equal(await getFilemoonStreamSource('abc123'), null);
  });
  test('a failed pow verify throws', async () => {
    fetchHandler = (url) => {
      if (url.endsWith('/captcha')) {
        return jsonResponse({ pow_token: 'tok', pow_nonce: 'spa-nonce', pow_difficulty: 1 });
      }
      return jsonResponse({ status: 'bad', reason: 'wrong solution' });
    };
    await assert.rejects(() => getFilemoonStreamSource('abc123'), /filemoon pow verify failed: wrong solution/);
  });
  test('a playback payload without key_parts throws', async () => {
    fetchHandler = (url) => {
      if (url.endsWith('/captcha')) {
        return jsonResponse({ pow_token: 'tok', pow_nonce: 'spa-nonce', pow_difficulty: 1 });
      }
      if (url.endsWith('/captcha/verify')) {
        return jsonResponse({ status: 'ok', token: 'play-token' });
      }
      return jsonResponse({ playback: { iv: 'x', payload: 'y' } });
    };
    await assert.rejects(() => getFilemoonStreamSource('abc123'), /filemoon playback payload missing/);
  });
  test('an empty sources list returns null', async () => {
    const playback = await buildPlayback([]);
    fetchHandler = (url) => {
      if (url.endsWith('/captcha')) {
        return jsonResponse({ pow_token: 'tok', pow_nonce: 'spa-nonce', pow_difficulty: 1 });
      }
      if (url.endsWith('/captcha/verify')) {
        return jsonResponse({ status: 'ok', token: 'play-token' });
      }
      return jsonResponse({ playback });
    };
    assert.equal(await getFilemoonStreamSource('abc123'), null);
  });
  test('an HTTP error on any step throws with the path', async () => {
    fetchHandler = () => jsonResponse({}, { ok: false, status: 403 });
    await assert.rejects(() => getFilemoonStreamSource('abc123'), /filemoon SPA .* HTTP 403/);
  });
});
