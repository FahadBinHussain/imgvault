/**
 * Anonymous filemoon.sx player-flow client.
 *
 * The /d/ and /e/ pages are a JS SPA; the actual stream URL comes from a
 * chained API flow that the SPA runs in the browser:
 *
 *   1. POST /api/videos/{code}/captcha          -> { pow_nonce, pow_difficulty, pow_token }
 *   2. solve proof-of-work hashcash locally     -> solution
 *   3. POST /api/videos/{code}/captcha/verify   -> { status: "ok", token }  (playback token)
 *   4. POST /api/videos/{code}/playback         -> AES-256-GCM encrypted sources
 *   5. decrypt with key parts selected by version
 *
 * The PoW hash is a custom ARX construction built on SHA-256 constants
 * (ported verbatim from the site's pow-*.js bundle), and the encrypted
 * payload is decrypted client-side, so no secret keys are needed.
 */

const SPA_BASE = 'https://filemoon.sx';
const POW_BUDGET_MS = 25000;

const re = (t, e) => ((t << e) | (t >>> (32 - e))) >>> 0;
const imul = (t, e) => Math.imul(t, e) >>> 0;

function powRound(state) {
  state[0] = (state[0] + state[1]) >>> 0;
  state[3] = re(state[3] ^ state[0], 16);
  state[2] = (state[2] + state[3]) >>> 0;
  state[1] = re(state[1] ^ state[2], 12);
  state[0] = (state[0] + state[1]) >>> 0;
  state[3] = re(state[3] ^ state[0], 8);
  state[2] = (state[2] + state[3]) >>> 0;
  state[1] = re(state[1] ^ state[2], 7);
}

function powHash(bytes) {
  const state = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762]);
  for (let i = 0; i < bytes.length; i += 1) {
    state[0] = (state[0] + bytes[i]) >>> 0;
    state[0] = re(state[0], 7);
    powRound(state);
  }
  for (let i = 0; i < 8; i += 1) powRound(state);

  const words = new Uint32Array(512);
  for (let i = 0; i < 512; i += 1) {
    powRound(state);
    words[i] = (state[0] ^ state[2]) >>> 0;
  }

  for (let i = 0; i < 2; i += 1) {
    for (let s = 0; s < 512; s += 1) {
      const idx = words[s] & 511;
      let c = (words[s] + words[idx]) >>> 0;
      c = re(c, 13);
      c = (c ^ imul(words[s + 1 & 511], 2654435761)) >>> 0;
      words[s] = c;
      state[0] = (state[0] ^ c) >>> 0;
      powRound(state);
    }
  }

  const out = new Uint32Array(8);
  for (let i = 0; i < 8; i += 1) {
    powRound(state);
    let acc = state[0];
    const base = i * 64;
    for (let c = 0; c < 64; c += 1) {
      const d = words[base + c];
      acc = (acc + d) >>> 0;
      acc = re(acc, 5);
      acc = (acc ^ imul(d, 2246822519)) >>> 0;
    }
    out[i] = (acc ^ state[2]) >>> 0;
  }
  return out;
}

function leadingZeroBits(words) {
  let total = 0;
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (w === 0) {
      total += 32;
      continue;
    }
    return total + Math.clz32(w);
  }
  return total;
}

/**
 * Solve the hashcash challenge: find the smallest counter where
 * powHash(`${nonce}:${counter}`) has at least `difficulty` leading zero bits.
 * @param {string} nonce
 * @param {number} difficulty
 * @param {number} budgetMs
 * @returns {string|null}
 */
export function solveFilemoonPow(nonce, difficulty, budgetMs = POW_BUDGET_MS) {
  if (difficulty <= 0) return '0';
  const prefix = `${nonce}:`;
  const start = Date.now();
  let counter = 0;
  for (;;) {
    for (let batch = 0; batch < 1024; batch += 1) {
      const input = `${prefix}${counter}`;
      const bytes = new Uint8Array(input.length);
      for (let i = 0; i < input.length; i += 1) bytes[i] = input.charCodeAt(i) & 255;
      if (leadingZeroBits(powHash(bytes)) >= difficulty) return String(counter);
      counter += 1;
    }
    if (Date.now() - start > budgetMs) return null;
  }
}

function base64UrlToBytes(value) {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function spaPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Captcha-Token'] = token;
  const resp = await fetch(`${SPA_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`filemoon SPA ${path} HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.error) throw new Error(`filemoon SPA ${path}: ${json.error}`);
  return json;
}

/**
 * Fetch the stream source list for a file code through the anonymous
 * player flow (captcha + pow + playback + decrypt).
 * @param {string} filecode
 * @returns {Promise<{ url: string, label: string, mimeType: string, bitrateKbps: number }|null>}
 */
export async function getFilemoonStreamSource(filecode) {
  const captcha = await spaPost(`/api/videos/${encodeURIComponent(filecode)}/captcha`);
  if (!captcha.pow_token || !captcha.pow_nonce || typeof captcha.pow_difficulty !== 'number') {
    return null;
  }

  const solution = solveFilemoonPow(captcha.pow_nonce, captcha.pow_difficulty);
  if (solution === null) throw new Error('filemoon pow timed out');

  const verify = await spaPost(
    `/api/videos/${encodeURIComponent(filecode)}/captcha/verify`,
    { pow_token: captcha.pow_token, solution }
  );
  if (verify.status !== 'ok' || !verify.token) {
    throw new Error(`filemoon pow verify failed: ${verify.reason || verify.status || 'unknown'}`);
  }

  const playback = await spaPost(
    `/api/videos/${encodeURIComponent(filecode)}/playback`,
    { fingerprint: { token: 't', viewer_id: 'v', device_id: 'd', confidence: 0 } },
    verify.token
  );
  if (!playback.playback || !Array.isArray(playback.playback.key_parts)) {
    throw new Error('filemoon playback payload missing');
  }

  const sources = await decryptFilemoonPlayback(playback.playback);
  if (!Array.isArray(sources) || sources.length === 0) return null;

  const best = sources.reduce((prev, cur) => (
    (cur.height || 0) > (prev.height || 0) ? cur : prev
  ), sources[0]);
  return {
    url: best.url,
    label: best.label,
    mimeType: best.mime_type,
    bitrateKbps: best.bitrate_kbps,
  };
}

/**
 * Decrypt the AES-256-GCM playback payload. Key = concatenation of the
 * base64 key_parts selected by the version map (n -> [n, 31-n], out of
 * range means all parts).
 * @param {object} playback { algorithm, iv, payload, key_parts, version }
 * @returns {Promise<Array>} decrypted sources array
 */
async function decryptFilemoonPlayback(playback) {
  const parts = Array.isArray(playback.key_parts) ? playback.key_parts : [];
  const version = typeof playback.version === 'string' ? Number(playback.version) : NaN;

  let selected = parts;
  if (Number.isInteger(version) && version >= 1 && version <= 20) {
    const a = version;
    const b = 31 - version;
    if (a >= 1 && b >= 1 && a <= parts.length && b <= parts.length) {
      selected = [parts[a - 1], parts[b - 1]].filter((x) => typeof x === 'string' && x.length > 0);
    }
  }
  if (selected.length === 0) throw new Error('filemoon playback has no key parts');

  const keyBytes = [];
  for (const part of selected) keyBytes.push(...base64UrlToBytes(part));
  const key = new Uint8Array(keyBytes);
  const iv = base64UrlToBytes(playback.iv);
  const payload = base64UrlToBytes(playback.payload);

  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, payload);
  const parsed = JSON.parse(new TextDecoder().decode(plain));
  return Array.isArray(parsed.sources) ? parsed.sources : [];
}
