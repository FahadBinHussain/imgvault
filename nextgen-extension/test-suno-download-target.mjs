// unit tests for Suno download resolution & host detection
//
// run: node test-suno-download-target.mjs
//
import crypto from 'node:crypto';
import {
  isSunoHost,
  isSunoUrl,
  extractSunoSongId,
  resolveSunoDownloadTarget,
  decryptSunoEncryptedClip,
} from './src/utils/sunoApi.js';

const { subtle } = crypto.webcrypto;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// --- host detection ---
check('suno.com is suno host', isSunoHost('suno.com'));
check('www.suno.com is suno host', isSunoHost('www.suno.com'));
check('app.suno.com is suno host', isSunoHost('app.suno.com'));
check('suno.ai is suno host', isSunoHost('suno.ai'));
check('cdn1.suno.ai is suno host', isSunoHost('cdn1.suno.ai'));
check('youtube.com is not suno', !isSunoHost('youtube.com'));
check('empty host is not suno', !isSunoHost(''));

// --- song id extraction ---
const sampleUuid = '41f6d542-1a2b-496f-9bce-f2b6c9907683';
check('extracts from /song/<uuid>', extractSunoSongId(`https://suno.com/song/${sampleUuid}`) === sampleUuid);
check('extracts from /song/<uuid>/ with trailing slash', extractSunoSongId(`https://suno.com/song/${sampleUuid}/`) === sampleUuid);
check('extracts from /s/<uuid>', extractSunoSongId(`https://suno.com/s/${sampleUuid}`) === sampleUuid);
check('extracts from /embed/<uuid>', extractSunoSongId(`https://suno.com/embed/${sampleUuid}`) === sampleUuid);
check('extracts from app.suno.ai', extractSunoSongId(`https://app.suno.ai/song/${sampleUuid}`) === sampleUuid);
check('extracts from cdn1.suno.ai .mp4 file link', extractSunoSongId(`https://cdn1.suno.ai/${sampleUuid}.mp4`) === sampleUuid);
check('extracts from query parameter ?clipId=', extractSunoSongId(`https://suno.com/me?clipId=${sampleUuid}`) === sampleUuid);
check('non-suno url returns null', extractSunoSongId(`https://example.com/song/${sampleUuid}`) === null);
check('invalid url returns null', extractSunoSongId('not-a-url') === null);

// --- url detection ---
check('isSunoUrl is true for song page', isSunoUrl(`https://suno.com/song/${sampleUuid}`));
check('isSunoUrl is false for homepage', !isSunoUrl('https://suno.com/'));
check('isSunoUrl is false for youtube', !isSunoUrl('https://youtube.com/watch?v=123'));

// --- mocked resolver tests (deterministic: no DRM bypass, no guessed CDN) ---
const makeJsonResponse = (ok, status, body) => ({
  ok,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

// 1. Private clip with an encrypted stream: no plain MP4 exists, so the
//    resolver must report the encrypted playback stream (never guess a CDN
//    mp4, never pretend the track is DRM-locked).
{
  const blockedId = '867071b3-a848-427c-a544-1929ae6b5611';
  const calls = [];
  const fetchMock = async (endpoint) => {
    calls.push(endpoint);
    return makeJsonResponse(true, 200, {
      id: blockedId,
      title: 'horror ambience',
      display_name: 'Swordfish9',
      video_url: '',
      audio_url: 'https://studio-api.prod.suno.com/api/forbidden',
      media_urls: [{
        url: `https://d2lwuy8qc234o3.cloudfront.net/2/clip/${blockedId}.m4a`,
        content_type: 'm4a-opus',
        delivery: 'progressive',
        encoding: '1.0.0',
      }],
    });
  };

  const resolved = await resolveSunoDownloadTarget(`https://suno.com/song/${blockedId}`, { fetchImpl: fetchMock });
  check('encrypted clip resolves to the encrypted playback stream', resolved?.encrypted === true);
  check('encrypted clip sets sourceKind=encrypted_media', resolved?.sourceKind === 'encrypted_media');
  check('encrypted clip carries no mediaUrl (there is no plain file)', !resolved?.mediaUrl);
  check('encrypted clip keeps the clip id for the license request', resolved?.clipId === blockedId);
  check('only called clip API when unauthenticated', calls.length === 1);
}

// 1b. Decrypt round trip: build an encrypted payload with the site's own
//     scheme and check the client returns the exact plaintext.
{
  const clipId = '44444444-5555-6666-7777-888888888888';
  const glt = 'guest-token-for-the-unit-test';
  const plain = new Uint8Array(4096);
  plain.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp at offset 4
  plain.set([0x69, 0x73, 0x6f, 0x6d], 8); // isom
  for (let i = 16; i < plain.length; i += 1) plain[i] = i % 251;

  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(glt));
  const gcmKey = await subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);
  const ctrKey = crypto.randomBytes(16);
  const ctrIv = crypto.randomBytes(16);
  const aad = new TextEncoder().encode(clipId);
  const wrap = async (bytes) => {
    const iv = crypto.randomBytes(12);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, gcmKey, bytes));
    return Buffer.concat([Buffer.from(iv), Buffer.from(ct)]).toString('base64');
  };
  const ctrCryptoKey = await subtle.importKey('raw', ctrKey, { name: 'AES-CTR' }, false, ['encrypt']);
  const encrypted = new Uint8Array(
    await subtle.encrypt({ name: 'AES-CTR', counter: ctrIv, length: 128 }, ctrCryptoKey, plain)
  );
  const rights = { key: await wrap(ctrKey), iv: await wrap(ctrIv), glt };

  const fetchMock = async (endpoint) => {
    if (endpoint.includes('/api/clip/')) {
      return makeJsonResponse(true, 200, {
        id: clipId,
        title: 'Encrypted Fixture',
        media_urls: [{ url: 'https://cdn.example/clip.m4a', content_type: 'm4a-opus', encoding: '1.0.0' }],
      });
    }
    if (endpoint.includes('/api/mango/rights')) {
      return makeJsonResponse(true, 200, rights);
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => encrypted.buffer.slice(encrypted.byteOffset, encrypted.byteOffset + encrypted.byteLength),
    };
  };

  const decrypted = await decryptSunoEncryptedClip(clipId, { fetchImpl: fetchMock });
  check('decrypt returns the same byte length', decrypted.byteLength === plain.length, `${decrypted.byteLength}`);
  check('decrypt returns the exact plaintext', Buffer.compare(Buffer.from(decrypted.bytes), Buffer.from(plain)) === 0);
  check('decrypt reports sourceKind=encrypted_media', decrypted.sourceKind === 'encrypted_media');
}

// 1c. A broken payload must fail loudly instead of writing garbage
{
  const clipId = '55555555-6666-7777-8888-999999999999';
  const fetchMock = async (endpoint) => {
    if (endpoint.includes('/api/clip/')) {
      return makeJsonResponse(true, 200, {
        id: clipId,
        media_urls: [{ url: 'https://cdn.example/clip.m4a', content_type: 'm4a-opus', encoding: '1.0.0' }],
      });
    }
    if (endpoint.includes('/api/mango/rights')) {
      return makeJsonResponse(true, 200, { key: 'AAAAAAAAAAAAAAAAAAAAAA==', iv: 'AAAAAAAAAAAAAAAAAAAAAA==', glt: 'g' });
    }
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer };
  };
  let thrown = null;
  try {
    await decryptSunoEncryptedClip(clipId, { fetchImpl: fetchMock });
  } catch (err) {
    thrown = err;
  }
  check('a broken license/ciphertext fails loudly', Boolean(thrown), thrown?.message);
}

// 2. Official download API resolves processing -> ready when authorized
{
  const ownedId = '11111111-2222-3333-4444-555555555555';
  const calls = [];
  let dlAttempt = 0;
  const fetchMock = async (endpoint, init) => {
    calls.push({ endpoint, auth: init?.headers?.Authorization });
    if (endpoint.includes('/api/clip/')) {
      return makeJsonResponse(true, 200, {
        id: ownedId,
        title: 'My Track',
        display_name: 'Creator',
        video_url: '',
        audio_url: 'https://studio-api.prod.suno.com/api/forbidden',
        image_large_url: `https://cdn2.suno.ai/${ownedId}.jpeg`,
      });
    }
    dlAttempt += 1;
    if (dlAttempt === 1) {
      return makeJsonResponse(true, 200, { ok: true, status: 'processing', download_url: null });
    }
    return makeJsonResponse(true, 200, {
      ok: true,
      status: 'ready',
      download_url: `https://dl.suno.com/${ownedId}.mp4?token=abc`,
    });
  };

  const resolved = await resolveSunoDownloadTarget(`https://suno.com/song/${ownedId}`, {
    authToken: 'test-session-jwt',
    fetchImpl: fetchMock,
    sleepImpl: async () => {},
    maxDownloadPolls: 3,
  });
  check('official download polls processing -> ready', dlAttempt === 2);
  check('official download sends Bearer token', calls.every((c) => c.auth === 'Bearer test-session-jwt'));
  check('official download returns download_url', resolved.mediaUrl === `https://dl.suno.com/${ownedId}.mp4?token=abc`);
  check('official download sets sourceKind=official_download', resolved.sourceKind === 'official_download');
}

// 3. Official download API no_permission refusal surfaces verbatim in thrown error
{
  const restrictedId = '22222222-3333-4444-5555-666666666666';
  const fetchMock = async (endpoint) => {
    if (endpoint.includes('/api/clip/')) {
      return makeJsonResponse(true, 200, {
        id: restrictedId,
        title: 'Other Track',
        display_name: 'OtherUser',
        video_url: '',
        audio_url: 'https://studio-api.prod.suno.com/api/forbidden',
        media_urls: [{ encoding: '1.0.0' }],
      });
    }
    return makeJsonResponse(true, 200, {
      ok: false,
      reason: 'no_permission',
      message: "You don't have permission to download in Studio.",
    });
  };

  let thrown = null;
  try {
    await resolveSunoDownloadTarget(`https://suno.com/song/${restrictedId}`, {
      authToken: 'test-session-jwt',
      fetchImpl: fetchMock,
    });
  } catch (err) {
    thrown = err;
  }
  check(
    'official download no_permission refusal included loudly',
    Boolean(
      thrown
      && /You don't have permission to download in Studio\./i.test(thrown.message)
      && /no_permission/i.test(thrown.message)
    ),
    thrown?.message
  );
}

// 4. Clip API HTTP error must fail loudly (never guess CDN URL)
{
  const missingId = '33333333-4444-5555-6666-777777777777';
  const fetchMock = async () => makeJsonResponse(false, 404, { detail: 'Clip not found' });
  let thrown = null;
  try {
    await resolveSunoDownloadTarget(`https://suno.com/song/${missingId}`, { fetchImpl: fetchMock });
  } catch (err) {
    thrown = err;
  }
  check('clip API 404 throws loudly with HTTP status', Boolean(thrown && /HTTP 404/i.test(thrown.message)), thrown?.message);
}

// --- live API resolution tests ---
try {
  const target = await resolveSunoDownloadTarget(`https://suno.com/song/${sampleUuid}`);
  check('resolves mediaUrl', Boolean(target?.mediaUrl && target.mediaUrl.includes(sampleUuid)));
  check('resolves real song title', Boolean(target?.pageTitle && /Synth wars/i.test(target.pageTitle)), target?.pageTitle);
  check('resolves fsId', target?.fsId === sampleUuid);
  check('resolves fileName with mp4 extension', target?.fileName === `${sampleUuid}.mp4`);
  check('sets sourceKind=video_url on public clip', target?.sourceKind === 'video_url');
} catch (err) {
  check('live API resolution failed', false, err.message);
}

try {
  const secondWorkingId = 'f8d2be1e-ac1e-4548-95a7-4e9c8bdd9567';
  const target = await resolveSunoDownloadTarget(`https://suno.com/song/${secondWorkingId}`);
  check('live second working clip resolves video_url', Boolean(target?.mediaUrl && target.mediaUrl.includes(secondWorkingId)));
} catch (err) {
  check('live second working clip failed', false, err.message);
}

try {
  const blockedLiveId = '867071b3-a848-427c-a544-1929ae6b5611';
  const target = await resolveSunoDownloadTarget(`https://suno.com/song/${blockedLiveId}`);
  check(
    'live encrypted clip resolves to the encrypted playback stream',
    target?.encrypted === true && target?.sourceKind === 'encrypted_media',
    `sourceKind=${target?.sourceKind}`
  );
} catch (err) {
  check('live encrypted clip failed', false, err.message);
}

try {
  const encryptedLiveId = '867071b3-a848-427c-a544-1929ae6b5611';
  const decrypted = await decryptSunoEncryptedClip(encryptedLiveId);
  const box = String.fromCharCode(
    decrypted.bytes[4], decrypted.bytes[5], decrypted.bytes[6], decrypted.bytes[7]
  );
  check('live decrypt produces an mp4 container', box === 'ftyp', `box=${box}`);
  check('live decrypt returns a full-length audio file', decrypted.byteLength > 500000, `${decrypted.byteLength} bytes`);
  check('live decrypt reports encrypted_media', decrypted.sourceKind === 'encrypted_media');
} catch (err) {
  check('live decrypt failed', false, err.message);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  process.exit(1);
}
