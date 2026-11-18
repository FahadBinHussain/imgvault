// Regression tests mined from the ImgVault bug history (AGENTS.md).
// Area: Suno download resolution (2.19.11-2.19.13).
//
// The legacy test-suno-download-target.mjs script covers the clip API,
// the official-download polling, the Bearer header, and the decrypt
// round trip. This file pins the REGRESSION angles it does not: the
// priority order (video_url beats everything, no download call is even
// made), the no-blind-CDN-guess rule, the loud-failure reason
// enumeration, the encrypted return shape, and the background wiring
// (the encrypted 3rd method, the failure classifiers, the top-frame
// rule). Live tests use an injected fetchImpl; no live network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveSunoDownloadTarget, isSunoUrl, extractSunoSongId } from '../src/utils/sunoApi.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const SONG_ID = '11111111-2222-3333-4444-555555555555';
const SONG_URL = `https://suno.com/song/${SONG_ID}`;
const CLIP_API = `https://studio-api-prod.suno.com/api/clip/${SONG_ID}`;
const DOWNLOAD_API = `https://studio-api-prod.suno.com/api/download/clip/${SONG_ID}?format=mp4`;

const jsonResponse = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
  text: async () => JSON.stringify(data),
});

// ------------------------------------------------------------ priority ---

test('2.19.11 (2026-11-10): video_url wins outright — with a token present the download endpoint is never even called', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === CLIP_API) {
      return jsonResponse({
        video_url: 'https://cdn.suno.example/v.mp4',
        title: 'Test Track', display_name: 'Test Artist',
        media_urls: [{ encoding: '1.0.0', url: 'https://cdn.suno.example/enc.m4a' }],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  const result = await resolveSunoDownloadTarget(SONG_URL, {
    authToken: 'fake-session-token', fetchImpl, sleepImpl: () => Promise.resolve(),
  });
  assert.equal(result.sourceKind, 'video_url');
  assert.equal(result.mediaUrl, 'https://cdn.suno.example/v.mp4');
  assert.equal(result.fileName, `${SONG_ID}.mp4`);
  assert.equal(result.pageTitle, 'Test Track - Test Artist');
  assert.deepEqual(calls, [CLIP_API]);
});

test('2.19.12 (2026-11-10): the official download polls processing -> ready and stops polling once ready', async () => {
  let polls = 0;
  const fetchImpl = async (url) => {
    if (url === CLIP_API) return jsonResponse({ video_url: '', title: 'T' });
    if (url === DOWNLOAD_API) {
      polls += 1;
      return polls < 3
        ? jsonResponse({ ok: true, status: 'processing' })
        : jsonResponse({ ok: true, status: 'ready', download_url: 'https://cdn.suno.example/dl.mp4' });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  const sleeps = [];
  const result = await resolveSunoDownloadTarget(SONG_URL, {
    authToken: 'fake-session-token', fetchImpl,
    sleepImpl: (ms) => { sleeps.push(ms); return Promise.resolve(); },
    maxDownloadPolls: 5, downloadPollIntervalMs: 1500,
  });
  assert.equal(result.sourceKind, 'official_download');
  assert.equal(result.mediaUrl, 'https://cdn.suno.example/dl.mp4');
  assert.equal(polls, 3);
  assert.deepEqual(sleeps, [1500, 1500]);
});

test('2.19.12 (2026-11-10): a 401 from the download endpoint names the expired __session cookie in the loud failure', async () => {
  const fetchImpl = async (url) => {
    if (url === CLIP_API) return jsonResponse({ video_url: '', audio_url: '', title: 'T' });
    if (url === DOWNLOAD_API) return jsonResponse({ detail: 'Unauthorized' }, 401);
    throw new Error(`unexpected fetch: ${url}`);
  };
  await assert.rejects(
    () => resolveSunoDownloadTarget(SONG_URL, {
      authToken: 'fake-session-token', fetchImpl, sleepImpl: () => Promise.resolve(),
    }),
    /official MP4 download endpoint refused: HTTP 401 \(Unauthorized\)/,
  );
});

test('2.19.12 (2026-11-10): a no_permission refusal is carried verbatim into the loud failure', async () => {
  const fetchImpl = async (url) => {
    if (url === CLIP_API) return jsonResponse({ video_url: '', audio_url: '', title: 'T' });
    if (url === DOWNLOAD_API) {
      return jsonResponse({ ok: false, reason: 'no_permission', message: 'Download denied' });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  await assert.rejects(
    () => resolveSunoDownloadTarget(SONG_URL, {
      authToken: 'fake-session-token', fetchImpl, sleepImpl: () => Promise.resolve(),
    }),
    /official MP4 download endpoint refused: Download denied \(no_permission\)/,
  );
});

// ----------------------------------------------------------- encrypted ---

test('2.19.13 (2026-11-10): an encrypted stream returns the decrypt shape — empty mediaUrl, .m4a name, clipId', async () => {
  const fetchImpl = async (url) => {
    if (url === CLIP_API) {
      return jsonResponse({
        video_url: '', audio_url: 'https://studio-api-prod.suno.com/api/forbidden',
        title: 'Enc Track', display_name: 'Enc Artist',
        media_urls: [{ encoding: '1.0.0', url: 'https://cdn.suno.example/enc.m4a' }],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  const result = await resolveSunoDownloadTarget(SONG_URL, { fetchImpl });
  assert.equal(result.sourceKind, 'encrypted_media');
  assert.equal(result.encrypted, true);
  assert.equal(result.mediaUrl, '');
  assert.equal(result.clipId, SONG_ID);
  assert.equal(result.fileName, `${SONG_ID}.m4a`);
  assert.equal(result.pageTitle, 'Enc Track - Enc Artist');
});

test('2.19.13 (2026-11-10): an encrypted entry WITHOUT a url falls through to the loud failure — never a silent empty download', async () => {
  const fetchImpl = async (url) => {
    if (url === CLIP_API) {
      return jsonResponse({
        video_url: '', audio_url: '',
        title: 'Enc No Url',
        media_urls: [{ encoding: '1.0.0' }],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  await assert.rejects(
    () => resolveSunoDownloadTarget(SONG_URL, { fetchImpl }),
    /stream is DRM-protected \(encoding 1\.0\.0\)/,
  );
});

// ------------------------------------------------------- loud failures ---

test('2.19.11 (2026-11-10): no blind CDN guess — a clip API failure throws loudly and never yields a cdn1 URL', async () => {
  const fetchImpl = async () => { throw new Error('fetch failed'); };
  await assert.rejects(
    () => resolveSunoDownloadTarget(SONG_URL, { fetchImpl }),
    new RegExp(`Suno clip API request failed for ${SONG_ID}: fetch failed`),
  );
  const failing = async () => jsonResponse({ detail: 'gone' }, 404);
  await assert.rejects(
    () => resolveSunoDownloadTarget(SONG_URL, { fetchImpl: failing }),
    new RegExp(`Suno clip API returned HTTP 404 for ${SONG_ID}: gone`),
  );
});

test('2.19.13 (2026-11-10): the loud failure enumerates EVERY reason — video_url, forbidden audio, DRM, no session', async () => {
  const fetchImpl = async (url) => {
    if (url === CLIP_API) {
      return jsonResponse({
        video_url: '', audio_url: 'https://studio-api-prod.suno.com/api/forbidden/x',
        title: 'No Hope',
        media_urls: [{ encoding: '1.0.0' }],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  await assert.rejects(
    () => resolveSunoDownloadTarget(SONG_URL, { fetchImpl }),
    /Suno provides no downloadable MP4 for "No Hope".*video_url is empty; audio_url is forbidden \(\/api\/forbidden\); stream is DRM-protected \(encoding 1\.0\.0\); no Suno __session cookie was found in the browser\./s,
  );
});

test('2.19.11 (2026-11-10): a URL without a Suno UUID fails before any fetch', async () => {
  let fetched = false;
  const fetchImpl = async () => { fetched = true; throw new Error('should not fetch'); };
  await assert.rejects(
    () => resolveSunoDownloadTarget('https://suno.com/song/not-a-uuid', { fetchImpl }),
    /Could not extract Suno song UUID from URL/,
  );
  assert.equal(fetched, false);
  assert.equal(isSunoUrl(SONG_URL), true);
  assert.equal(isSunoUrl('https://example.com/song/x'), false);
  assert.equal(extractSunoSongId(SONG_URL), SONG_ID);
});

// ------------------------------------------- source assertions (wiring) ---

test('2.19.13 (2026-11-10): the background resolves Suno through the resolver and handles the encrypted result as the 3rd method, loudly', () => {
  const bg = src('../src/background/background.js');
  assert.ok(bg.includes('const direct = await resolveSunoDownloadTarget(pageUrl, { authToken });'));
  assert.ok(bg.includes('if (direct?.encrypted) {'));
  assert.ok(bg.includes('if (isSuno && resolved?.encrypted) {'));
  assert.ok(bg.includes("Decrypting it through Suno\\'s own playback license endpoint — 3rd method in use."));
  assert.ok(bg.includes('await this.downloadSunoEncryptedClipToFile('));
  assert.ok(bg.includes('async downloadSunoEncryptedClipToFile(clipId, outputPath, activeRequestId) {'));
  assert.ok(bg.includes('const decrypted = await decryptSunoEncryptedClip(clipId, {'));
});

test('2.19.11 (2026-11-10): the background classifies Suno/TeraBox/browser-challenge failures and retries resolved downloads exactly once', () => {
  const bg = src('../src/background/background.js');
  assert.ok(bg.includes('isSunoUnsupportedFailure(url, message) {'));
  assert.ok(bg.includes('isTeraBoxUnsupportedFailure(url, message) {'));
  assert.ok(bg.includes('isBrowserChallengeFailure(message) {'));
  assert.ok(bg.includes('if (!options.isResolvedRetry && (isChallengeFail || isTeraBoxFail || isSunoFail)) {'));
  assert.ok(bg.includes('withResolveTimeout(promise, timeoutMs, label) {'));
  // Top frame only: allFrames appears ONLY in comments explaining why not.
  const allFramesLines = bg.split('\n').filter((line) => line.includes('allFrames'));
  assert.ok(allFramesLines.length > 0);
  assert.ok(allFramesLines.every((line) => line.trim().startsWith('//')));
});
