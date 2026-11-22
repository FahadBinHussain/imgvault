// Telegram Bot API client for the telegram host (plan-telegram-host.md).
// Rules baked in from the phase-0 spike:
//   - images go as DOCUMENTS (sendPhoto re-encodes: measured 23 122 B -> 14 074 B),
//     so the only way to read them back is getFile -> bytes. that gate is REAL:
//     fetching a file_url over 20 MB returns `400 file is too big`.
//   - uploads top out around 50 MB and the cap surfaces EITHER as a connection
//     reset OR as HTTP 413 - both mean the same cap.
//   - mp4/h264 in -> sendVideo -> public CDN url (ACAO *, Range 206, repeated reads
//     OK). the CDN url is scraped from the public channel page, never from the API
//     response, so no token ever rides a media URL.
//   - the token lives only in settings: it is never written to a media row and
//     never put in a stored URL (the file_url form `.../file/bot<TOKEN>/...` is
//     built at fetch time and thrown away).
const TELEGRAM_API = 'https://api.telegram.org';

// The limits themselves live in packages/shared (the web app reads the SAME
// numbers from there - a cap only one platform knows is a cap only one
// platform enforces). This module owns the browser-side API calls.
import {
  TELEGRAM_GETFILE_MAX_BYTES,
  TELEGRAM_UPLOAD_MAX_BYTES,
  TELEGRAM_NATIVE_MAX_BYTES,
  assertTelegramUploadSize,
  formatBytesForError,
  telegramUploadField,
  telegramUploadMethod,
  telegramUploadSizeCap,
} from 'imgvault-shared/telegramLimits.js';

export {
  TELEGRAM_GETFILE_MAX_BYTES,
  TELEGRAM_UPLOAD_MAX_BYTES,
  TELEGRAM_NATIVE_MAX_BYTES,
  assertTelegramUploadSize,
  formatBytesForError,
  telegramUploadField,
  telegramUploadMethod,
  telegramUploadSizeCap,
};

export const TELEGRAM_LOCAL_MEDIA_PREFIX = '/telegram-media/';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function requireTelegramToken(token) {
  const clean = String(token || '').trim();
  if (!clean) {
    throw new Error('Telegram bot token is not configured. Set it in Settings -> API Keys.');
  }
  return clean;
}

export function telegramChatId(channel) {
  const clean = String(channel || '').trim().replace(/^@+/, '');
  if (!clean) {
    throw new Error('Telegram channel is not configured. Set it in Settings -> API Keys.');
  }
  // The Bot API wants `@channelusername` for public channels and the full
  // `-100…` id for private ones. A bare numeric id is a USER id to the Bot
  // API, never the channel, so it gets the -100 prefix here.
  if (clean.startsWith('-')) return clean;
  if (/^\d+$/.test(clean)) return `-100${clean}`;
  return `@${clean}`;
}

/**
 * A channel stored as a number (bare `3959088547` or `-1003959088547`) is a
 * PRIVATE channel: it has no username, no public t.me/s page, and its post
 * links use the `t.me/c/<bare-id>/<messageId>` form. Usernames stay on the
 * public `t.me/<username>/<messageId>` form.
 */
export function isNumericTelegramChannel(channel) {
  const clean = String(channel || '').trim().replace(/^@+/, '');
  return /^-?\d+$/.test(clean);
}

/** Bare numeric id for a numeric channel (`-1003959088547` -> `3959088547`). */
export function telegramChannelBareId(channel) {
  const clean = String(channel || '').trim().replace(/^@+/, '');
  if (!/^-?\d+$/.test(clean)) return '';
  return clean.replace(/^-100/, '').replace(/^-/, '');
}

export function telegramApiBase(token) {
  return `${TELEGRAM_API}/bot${requireTelegramToken(token)}`;
}

function formFromEntries(entries) {
  const form = new FormData();
  for (const [key, value] of entries) {
    if (value !== undefined && value !== null) form.append(key, value);
  }
  return form;
}

/** POST (or GET) a Bot API method. Throws loudly with method + description. */
export async function telegramCallApi(token, method, { body, signal, timeoutMs = 0 } = {}) {
  const url = `${telegramApiBase(token)}/${method}`;
  let response;
  let timer = null;
  try {
    const options = { method: body ? 'POST' : 'GET', body, signal, credentials: 'omit' };
    if (timeoutMs > 0) {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);
      options.signal = controller.signal;
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }
    response = await fetch(url, options);
  } catch (err) {
    if (signal?.aborted) throw new Error(`Telegram ${method}: upload aborted`);
    throw new Error(`Telegram ${method}: network error - ${err.message || String(err)}`);
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response.ok) {
    const text = (await response.text()).slice(0, 300);
    throw new Error(`Telegram ${method}: HTTP ${response.status} - ${text}`);
  }

  let json;
  try {
    json = await response.json();
  } catch (err) {
    throw new Error(`Telegram ${method}: invalid JSON response - ${err.message}`);
  }
  if (!json?.ok) {
    throw new Error(`Telegram ${method}: ${json?.error_code || 'error'} ${json?.description || 'unknown error'}`);
  }
  return json.result;
}

/**
 * Send the blob. Returns the raw message object; callers shape it into a
 * provider link with `buildTelegramLink`.
 */
export async function sendTelegramFile({ token, channel, blob, filename, mimeType, method, signal }) {
  const field = method === 'sendVideo' ? 'video' : 'document';
  const chatId = telegramChatId(channel);
  const form = formFromEntries([
    ['chat_id', chatId],
    ['disable_notification', 'true'],
    ...(field === 'video' ? [['supports_streaming', 'true']] : []),
  ]);
  form.append(field, blob, filename || (field === 'video' ? 'video.mp4' : 'file.bin'));

  return telegramCallApi(token, method, { body: form, signal, timeoutMs: 0 });
}

/** getFile -> { file_size, file_path } with the 20 MB gate enforced loudly. */
export async function getTelegramFileInfo(token, fileId, signal) {
  const cleanFileId = String(fileId || '').trim();
  if (!cleanFileId) throw new Error('Telegram getFile: missing file id');

  const info = await telegramCallApi(token, 'getFile', {
    body: formFromEntries([['file_id', cleanFileId]]),
    signal,
  });

  if (!info?.file_path) throw new Error('Telegram getFile: no file_path in response');
  if (Number(info.file_size) > TELEGRAM_GETFILE_MAX_BYTES) {
    throw new Error(
      `Telegram getFile gate: ${formatBytesForError(info.file_size)} is over the ` +
      `${formatBytesForError(TELEGRAM_GETFILE_MAX_BYTES)} limit (400 file is too big).`
    );
  }
  return info;
}

/** Internal only - this URL carries the token and must never be stored or returned. */
export function telegramFileBytesUrl(token, filePath) {
  return `${TELEGRAM_API}/file/bot${requireTelegramToken(token)}/${filePath}`;
}

/**
 * Resolve a fileId to bytes right now (file_path expires, so it is never cached
 * beyond the caller's request). Pass through Range for video seeking.
 */
export async function fetchTelegramFile(token, fileId, { range = null, signal } = {}) {
  const info = await getTelegramFileInfo(token, fileId, signal);
  const url = telegramFileBytesUrl(token, info.file_path);
  let response;
  try {
    const headers = range ? { Range: range } : {};
    response = await fetch(url, { headers, credentials: 'omit', signal });
  } catch (err) {
    throw new Error(`Telegram file fetch failed: ${err.message || String(err)}`);
  }
  if (!response.ok && response.status !== 206) {
    throw new Error(
      `Telegram file fetch failed: HTTP ${response.status} ` +
      `(the file_path from getFile can expire - refetch getFile before retrying)`
    );
  }
  return response;
}

/**
 * Scrape the public channel post page for the CDN url (spike-proven shape:
 * `https://t.me/s/<channel>/<messageId>` + `data-post="<channel>/<id>"` marker +
 * `https://cdn*.telesco.pe/...` urls inside that post). Retries because the CDN
 * url takes a moment to appear after sendVideo; if it never appears this THROWS
 * - there is no silent fallback to a token URL.
 */
export async function scrapeTelegramPostUrl(channel, messageId, { wantMp4 = true, attempts = 4, signal } = {}) {
  const media = await scrapeTelegramPostMedia(channel, messageId, { attempts, signal });
  if (wantMp4) {
    if (media.mp4Url) return media.mp4Url;
    throw new Error(
      `Telegram scrape: no MP4 CDN url for ${channel}/${messageId} after ${attempts} attempt(s)`
    );
  }
  return media.mp4Url || media.posterUrl || '';
}

/**
 * Scrapes both video stream URL and poster thumbnail URL from a Telegram channel post.
 * Returns { mp4Url: string, posterUrl: string }
 */
export async function scrapeTelegramPostMedia(channel, messageId, { attempts = 4, signal } = {}) {
  const cleanChannel = String(channel || '').trim().replace(/^@+/, '');
  // A private channel has no public t.me/s page at all — fail fast with the
  // cause named instead of burning 4 attempts on a page that cannot exist.
  if (isNumericTelegramChannel(cleanChannel)) {
    throw new Error(
      `Telegram scrape: channel ${cleanChannel} is private (numeric id) — it has no public t.me/s page, so no CDN url can be scraped for message ${messageId}`
    );
  }
  const marker = `data-post="${cleanChannel}/${messageId}"`;
  const pageUrl = `https://t.me/s/${cleanChannel}/${messageId}`;
  let lastReason = 'not fetched';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await delay(2000);
    let response;
    try {
      response = await fetch(pageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        credentials: 'omit',
        signal,
      });
    } catch (err) {
      lastReason = err.message || String(err);
      continue;
    }
    if (!response.ok) {
      lastReason = `HTTP ${response.status}`;
      continue;
    }

    const html = await response.text();
    const start = html.indexOf(marker);
    if (start === -1) {
      lastReason = `marker ${marker} not in page yet`;
      continue;
    }
    const end = html.indexOf('data-post=', start + marker.length);
    const segment = html.slice(start, end > start ? end : html.length);
    const urls = segment.match(/https:\/\/cdn\d*\.telesco\.pe\/[^\s"'<>\\]+/g) || [];
    const mp4Url = urls.find((url) => url.includes('.mp4')) || '';
    // Telegram video preview posters are images on telesco.pe (without .mp4) or background-image styles
    const posterUrl = urls.find((url) => !url.includes('.mp4')) || '';

    if (mp4Url || posterUrl) {
      return { mp4Url, posterUrl };
    }
    lastReason = 'no cdn urls found in post segment';
  }

  throw new Error(
    `Telegram scrape: no media CDN url for ${cleanChannel}/${messageId} after ${attempts} attempt(s) ` +
    `(${pageUrl}). last reason: ${lastReason}`
  );
}

export async function deleteTelegramMessage({ token, channel, messageId, signal }) {
  const chatId = telegramChatId(channel);
  const form = formFromEntries([
    ['chat_id', chatId],
    ['message_id', String(messageId)],
  ]);
  return telegramCallApi(token, 'deleteMessage', { body: form, signal });
}

/** Platform-local media path. Works on BOTH platforms: the extension SW serves
 *  it same-origin and the web app serves it as a Next route - one stored URL,
 *  no token, no expiry. The mime rides the query string (`mt`) so the serving
 *  route can set a real Content-Type without a per-request database read. */
export function telegramLocalMediaUrl(fileId, mimeType = '') {
  const id = encodeURIComponent(String(fileId || '').trim());
  const mime = String(mimeType || '').trim();
  return mime
    ? `${TELEGRAM_LOCAL_MEDIA_PREFIX}${id}?mt=${encodeURIComponent(mime)}`
    : `${TELEGRAM_LOCAL_MEDIA_PREFIX}${id}`;
}

/**
 * Enumerate every MEDIA post of the public channel by walking the `t.me/s/`
 * preview pages (`?before=<oldest id>` walks backward; each post is marked
 * `data-post="<channel>/<id>"` — the phase-0-proven scrape marker; message-id
 * attributes do not exist there and silently misreport). Service posts
 * (joins, "channel created") carry no media and are skipped: an integrity
 * listing of a MEDIA host must contain media only.
 *
 * FAILS LOUD on HTTP/network errors and on the page cap — a truncated listing
 * would misreport older posts as missing/extra, so it is never cut short
 * silently. `fresh=` rides every URL because fastly serves `t.me/s/` stale
 * right after a post (live-learned during the chunk-2 test).
 *
 * @returns {Promise<Array<{messageId: string}>>} ascending by message id
 */
export async function listTelegramPosts(token, channel, { maxPages = 400, signal, onProgress } = {}) {
  if (!token) throw new Error('Telegram bot token is not configured. Set it in Settings -> API Keys.');
  const cleanChannel = String(channel || '').trim().replace(/^@+/, '');
  if (!cleanChannel) throw new Error('Telegram channel is not configured. Set it in Settings -> API Keys.');
  // A private channel has no public t.me/s page to walk — fail fast with the
  // cause named instead of a confusing HTTP error from the listing fetch.
  if (isNumericTelegramChannel(cleanChannel)) {
    throw new Error(
      `Telegram channel listing: channel ${cleanChannel} is private (numeric id) — it has no public t.me/s page to enumerate`
    );
  }

  const prefix = `data-post="${cleanChannel}/`;
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ids = new Set();
  let before = '';
  let exhausted = false;

  for (let page = 1; page <= maxPages; page += 1) {
    if (signal?.aborted) throw new Error('Telegram channel listing: aborted');
    const url = `https://t.me/s/${cleanChannel}?${before ? `before=${before}&` : ''}fresh=${Date.now()}`;

    let response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache' },
        credentials: 'omit',
        cache: 'no-store',
        signal,
      });
    } catch (err) {
      throw new Error(`Telegram channel listing: network error - ${err.message || String(err)}`);
    }
    if (!response.ok) {
      throw new Error(
        `Telegram channel listing: HTTP ${response.status} for t.me/s/${cleanChannel} (channel missing, renamed, or not public?)`
      );
    }

    const html = await response.text();
    const matches = [];
    const re = new RegExp(`${escapedPrefix}(\\d+)"`, 'g');
    for (const m of html.matchAll(re)) matches.push({ id: Number(m[1]), index: m.index });
    if (matches.length === 0) {
      exhausted = true;
      break;
    }

    let pageOldest = null;
    for (let i = 0; i < matches.length; i += 1) {
      const segEnd = i + 1 < matches.length ? matches[i + 1].index : html.length;
      const segment = html.slice(matches[i].index, segEnd);
      const isMedia =
        /tgme_widget_message_(photo|video|document|animation|sticker|voice)/.test(segment) ||
        /cdn\d*\.telesco\.pe/.test(segment);
      if (pageOldest === null || matches[i].id < pageOldest) pageOldest = matches[i].id;
      if (!isMedia) continue; // service post — not a media host file
      ids.add(matches[i].id);
    }
    if (onProgress) onProgress({ page, posts: ids.size });

    // `before` is a strict upper bound, so pageOldest must keep decreasing;
    // a repeat page (server ignored the cursor) means the history is done.
    if (pageOldest === null || (before !== '' && pageOldest >= Number(before))) {
      exhausted = true;
      break;
    }
    before = String(pageOldest);
  }

  if (!exhausted) {
    throw new Error(
      `Telegram channel listing hit the ${maxPages}-page cap with more history to read — refusing to return a truncated ` +
        'integrity list (it would misreport older posts). Raise maxPages or use a dedicated media channel.'
    );
  }

  return [...ids].sort((a, b) => a - b).map((id) => ({ messageId: String(id) }));
}

/** Public post page for a channel message (the only token-free link to it).
 * Numeric (private) channels use the `t.me/c/<bare-id>/<id>` form. */
export function telegramPostPageUrl(channel, messageId) {
  const clean = String(channel || '').trim().replace(/^@+/, '');
  const id = String(messageId || '').trim();
  if (!clean || !id) return '';
  if (isNumericTelegramChannel(clean)) {
    return `https://t.me/c/${telegramChannelBareId(clean)}/${id}`;
  }
  return `https://t.me/${clean}/${id}`;
}

/** fileId out of a platform-local `/telegram-media/<fileId>?mt=` url. */
export function telegramFileIdFromLocalUrl(url) {
  const match = String(url || '').match(/^\/telegram-media\/([^/?#]+)/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch (_) {
    return match[1];
  }
}

const isTelegramLocalUrl = (url) => /^\/telegram-media\//.test(String(url || ''));

/**
 * Telegram scene refs for one item. Telegram stores scenes as two DOCUMENT
 * posts (spz + texture) whose readable URL is `/telegram-media/<fileId>`; the
 * ids live in `extraMetadata.sceneFiles.telegram` (written by the scene upload
 * and the scene Fix), with `videoHosts.telegram` as the legacy spz-only shape.
 */
const pickTelegramSceneRefs = (item) => {
  const extra = item?.extraMetadata && typeof item.extraMetadata === 'object' ? item.extraMetadata : {};
  const scene = extra.sceneFiles?.telegram && typeof extra.sceneFiles.telegram === 'object'
    ? extra.sceneFiles.telegram
    : {};
  const vh = {
    ...(extra.videoHosts?.telegram && typeof extra.videoHosts.telegram === 'object' ? extra.videoHosts.telegram : {}),
    ...(item?.videoHosts?.telegram && typeof item.videoHosts.telegram === 'object' ? item.videoHosts.telegram : {}),
  };
  const spz = scene.spz && typeof scene.spz === 'object' ? scene.spz : {};
  const texture = scene.texture && typeof scene.texture === 'object' ? scene.texture : {};
  const spzFileId = String(spz.fileId || telegramFileIdFromLocalUrl(item?.spzUrl) || '').trim();
  const texFileId = String(texture.fileId || telegramFileIdFromLocalUrl(item?.textureUrl) || '').trim();
  return {
    spzFileId,
    texFileId,
    spzMessageId: String(spz.messageId || vh.messageId || '').trim(),
    texMessageId: String(texture.messageId || '').trim(),
    spzName: String(spz.filename || vh.filename || item?.fileName || ''),
    texName: String(texture.filename || ''),
    // host-specific ref: a udrop/terabox scene must land in noUrl here, not missing.
    hasRef: Boolean(
      scene.spz || scene.texture ||
      spzFileId || texFileId ||
      isTelegramLocalUrl(item?.spzUrl) || isTelegramLocalUrl(item?.textureUrl) ||
      vh.messageId || vh.watchUrl || vh.url
    ),
  };
};

/**
 * Is this probe failure the Bot API getFile 20 MB gate — i.e. the file is
 * too big to verify, not gone? Two shapes: the API itself answers 400
 * "file is too big", and our own getTelegramFileInfo throws a "getFile
 * gate" error when the API does return metadata over the cap. A deleted
 * post says "invalid file id" instead and must stay broken.
 */
const isGetFileGateError = (message) => /file is too big|getFile gate/i.test(String(message || ''));

/**
 * 3D scene integrity check against Telegram — symmetric to the UDrop/TeraBox
 * scene checks. Two documents per scene (spz + texture) are probed with
 * getFile: a deleted post is a broken link, while a network/5xx failure
 * THROWS (an outage is never reported as data loss). An over-20 MB file
 * gets a second opinion from the native host's Telethon session (2.19.30),
 * which CAN read the post: found only on an exact size match against the
 * stored size, broken on a size mismatch, and UNVERIFIED when the native
 * verify is unavailable (host down, no message id, no stored size) — never
 * broken on the gate alone (2.19.26: the 30 MB ceramic spz sat in "broken"
 * for a file that was right there on Telegram).
 *
 * The channel is enumerable through `t.me/s/` (message ids only), so "extra"
 * is per POST, not per scene: a healthy scene contributes two posts.
 *
 * @param {Array} items – scene DB items
 * @param {Array} allItems – every DB item; any telegram post they reference is
 *                           excluded from the extra list
 * @returns {Promise<{found:[],missing:[],noUrl:[],extra:[],unverified:[]}>}
 */
export async function checkTelegramSceneIntegrity(items, allItems, { token, channel, onProgress } = {}) {
  if (!token) throw new Error('Telegram bot token is not configured. Set it in Settings -> API Keys.');
  const cleanChannel = String(channel || '').trim().replace(/^@+/, '');
  if (!cleanChannel) throw new Error('Telegram channel is not configured. Set it in Settings -> API Keys.');

  const refsByItem = new Map();
  const fileIds = new Set();
  for (const item of items || []) {
    if (!item) continue;
    const refs = pickTelegramSceneRefs(item);
    refsByItem.set(item.id, refs);
    if (refs.spzFileId) fileIds.add(refs.spzFileId);
    if (refs.texFileId) fileIds.add(refs.texFileId);
  }

  const probe = new Map();
  const ids = [...fileIds];
  for (let i = 0; i < ids.length; i += 1) {
    if (onProgress) onProgress({ phase: 'files', done: i, total: ids.length });
    const fileId = ids[i];
    try {
      const info = await getTelegramFileInfo(token, fileId);
      probe.set(fileId, { ok: true, info });
    } catch (err) {
      const message = err?.message || String(err);
      // 4xx = the host refusing THIS file id (deleted post, invalid id, over
      // the getFile gate). Anything else (network, 5xx) aborts the check.
      if (!/(HTTP )?4\d\d/.test(message)) throw err;
      console.warn(`[telegram] scene file ${fileId} is not readable: ${message}`);
      probe.set(fileId, { ok: false, reason: message });
    }
  }
  if (onProgress) onProgress({ phase: 'files', done: ids.length, total: ids.length });

  const found = [];
  const missing = [];
  const noUrl = [];
  const unverified = [];
  for (const item of items || []) {
    if (!item) continue;
    const refs = refsByItem.get(item.id);
    if (!refs || !refs.hasRef) {
      noUrl.push({ item, codes: [], spzCode: null, texCode: null, spzMatched: null, texMatched: null });
      continue;
    }
    const spzProbe = refs.spzFileId ? probe.get(refs.spzFileId) : null;
    const texProbe = refs.texFileId ? probe.get(refs.texFileId) : null;
    let spzMatched = spzProbe?.ok ? { name: refs.spzName || 'scene.spz', file_id: refs.spzFileId } : null;
    let texMatched = texProbe?.ok ? { name: refs.texName || 'texture.webp', file_id: refs.texFileId } : null;
    const needsSpz = Boolean(refs.spzFileId);
    const needsTex = Boolean(refs.texFileId);
    // The getFile gate is distinguishable from a genuinely missing file:
    // the API answers 400 "file is too big" for a file that exists, and
    // our own getTelegramFileInfo throws the same verdict client-side when
    // the API does return metadata. A deleted post says "invalid file id"
    // instead. Gate-blocked is UNVERIFIED, never broken.
    const spzGate = Boolean(spzProbe && !spzProbe.ok && isGetFileGateError(spzProbe.reason));
    const texGate = Boolean(texProbe && !texProbe.ok && isGetFileGateError(texProbe.reason));
    let spzBroken = Boolean(spzProbe && !spzProbe.ok && !spzGate);
    let texBroken = Boolean(texProbe && !texProbe.ok && !texGate);
    // A gate-hit file is not gone — the Bot API just refuses to describe
    // files over 20 MB. The native host's Telethon session CAN read the
    // post, so verify through it: found ONLY on an exact size match
    // against the stored size. A mismatch means the post is not the file
    // the DB expects (broken); a failed verify leaves the file
    // unverified with the reason named. A genuinely missing file (4xx,
    // not the gate) never reaches the native host.
    const nativeReasons = [];
    for (const [which, gate, messageId] of [
      ['spz', spzGate, refs.spzMessageId],
      ['tex', texGate, refs.texMessageId],
    ]) {
      if (!gate || !messageId) continue;
      const label = which === 'spz' ? 'SPZ' : 'Image';
      const verdict = await verifyGateHitSceneFile({
        messageId,
        channel: cleanChannel,
        expectedSize: expectedSceneFileSize(item, which),
      });
      if (verdict.status === 'matched') {
        if (which === 'spz') {
          spzMatched = { name: refs.spzName || 'scene.spz', file_id: refs.spzFileId, nativeVerified: true };
        } else {
          texMatched = { name: refs.texName || 'texture.webp', file_id: refs.texFileId, nativeVerified: true };
        }
      } else if (verdict.status === 'mismatched') {
        if (which === 'spz') spzBroken = true;
        else texBroken = true;
        nativeReasons.push(`${label} native verify: ${verdict.reason}`);
      } else {
        nativeReasons.push(`${label} native verify unavailable: ${verdict.reason}`);
      }
    }
    const spzOk = !needsSpz || Boolean(spzMatched);
    const texOk = !needsTex || Boolean(texMatched);
    const reasons = [
      // A native-verified file drops its stale gate reason — the file IS
      // verified now, and "file is too big" next to a found row would lie.
      spzProbe && !spzProbe.ok && !(spzGate && spzMatched) ? `SPZ: ${spzProbe.reason}` : '',
      texProbe && !texProbe.ok && !(texGate && texMatched) ? `Image: ${texProbe.reason}` : '',
      !needsSpz && !needsTex ? 'no file id stored for this scene post' : '',
      ...nativeReasons,
    ].filter(Boolean);
    const entry = {
      item,
      codes: [refs.spzFileId, refs.texFileId].filter(Boolean),
      spzCode: refs.spzFileId || null,
      texCode: refs.texFileId || null,
      spzMatched,
      texMatched,
      spzFileName: refs.spzName || '',
      texFileName: refs.texName || '',
      spzPageUrl: telegramPostPageUrl(cleanChannel, refs.spzMessageId),
      texPageUrl: telegramPostPageUrl(cleanChannel, refs.texMessageId),
      reasons,
    };
    if (spzOk && texOk && (spzMatched || texMatched)) found.push(entry);
    else if (spzBroken || texBroken) missing.push(entry);
    else if (spzGate || texGate) unverified.push(entry);
    else missing.push(entry); // has refs but no file ids at all — nothing to probe
  }

  // Every telegram post referenced by ANY item (image, video, scene) is never
  // an orphan — scenes are excluded from the video tab's ref set, so their two
  // posts must be collected here.
  const referencedMessageIds = new Set();
  const addRef = (value) => {
    const id = Number(value);
    if (Number.isFinite(id)) referencedMessageIds.add(id);
  };
  for (const item of allItems || []) {
    if (!item) continue;
    const extra = item?.extraMetadata && typeof item.extraMetadata === 'object' ? item.extraMetadata : {};
    const scene = extra.sceneFiles?.telegram && typeof extra.sceneFiles.telegram === 'object'
      ? extra.sceneFiles.telegram
      : {};
    addRef(scene.spz?.messageId);
    addRef(scene.texture?.messageId);
    for (const bucket of ['videoHosts', 'imageHosts']) {
      addRef(extra?.[bucket]?.telegram?.messageId);
      addRef(item?.[bucket]?.telegram?.messageId);
    }
  }

  // A private channel has no public listing to walk, so extras are unknown
  // there — the getFile probes above still verify every referenced file, and
  // an empty extra list must never be read as "no orphans". Public channels
  // keep the listing-based extra computation.
  const posts = isNumericTelegramChannel(cleanChannel)
    ? []
    : await listTelegramPosts(token, cleanChannel, {
      onProgress: (p) => {
        if (onProgress) onProgress({ phase: 'listing', page: p.page, posts: p.posts });
      },
    });
  const extra = posts
    .filter((post) => !referencedMessageIds.has(Number(post.messageId)))
    .map((post) => ({
      messageId: String(post.messageId),
      pageUrl: telegramPostPageUrl(cleanChannel, post.messageId),
    }));

  return { found, missing, noUrl, extra, unverified };
}

/**
 * Is the native host reachable right now? The pre-flight asks this ONLY when
 * a picked file is over the Bot API cap with no disk path - the one case
 * where the answer changes whether Telegram can take the file.
 *
 * The worker owns the native-host command route, and it reads `command`
 * FLAT off the message (background.js `nativeHostCommand` case) - so this
 * sends the raw shape HostPage uses. useChromeMessage wraps everything in
 * {action, data}, which would bury `command` where the worker never looks
 * (the same class of bug as the resolveImagePreview shape saga).
 *
 * Never throws: {ok:false, error} is a normal answer (host not installed,
 * worker busy), and the caller logs it loudly instead of crashing.
 */
export async function probeNativeHost({ timeoutMs = 15000 } = {}) {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    return { ok: false, error: 'extension runtime unavailable' };
  }
  try {
    const data = await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`native host ping timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      chrome.runtime.sendMessage(
        { action: 'nativeHostCommand', command: 'ping', data: {} },
        (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'native host ping failed'));
          } else if (response?.success) {
            resolve(response.data);
          } else {
            reject(new Error(response?.error || 'Native host unreachable'));
          }
        }
      );
    });
    return { ok: true, message: data?.message || 'Native host reachable' };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

// 512 KiB of bytes -> ~700 KiB of base64 on the wire, under Chrome's 1 MiB
// native-message cap (the same chunk the worker's file writer uses).
const STAGE_CHUNK_BYTES = 512 * 1024;

const toBase64 = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

// One native-host port speaking sequential request/response: each message
// gets exactly one `complete` answer, in order, so the next chunk only goes
// out after the previous one was acknowledged.
function openNativePort() {
  let port;
  try {
    port = chrome.runtime.connectNative('com.imgvault.nativehost');
  } catch (error) {
    throw new Error(`Failed to connect to native host: ${error.message}`);
  }
  const pending = [];
  let dead = null;
  port.onMessage.addListener((response) => {
    const next = pending.shift();
    if (!next) return;
    if (response?.success) next.resolve(response);
    else next.reject(new Error(response?.message || 'Native host operation failed.'));
  });
  port.onDisconnect.addListener(() => {
    const error = new Error(chrome.runtime.lastError?.message || 'Native host disconnected.');
    dead = error;
    while (pending.length) pending.shift().reject(error);
  });
  const request = (message, timeoutMs = 120000) => {
    if (dead) return Promise.reject(dead);
    return new Promise((resolve, reject) => {
      const entry = {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      };
      const timer = setTimeout(() => {
        const at = pending.indexOf(entry);
        if (at >= 0) pending.splice(at, 1);
        entry.reject(new Error(`Native host timed out after ${timeoutMs / 1000}s on ${message.action}.`));
      }, timeoutMs);
      pending.push(entry);
      try {
        port.postMessage(message);
      } catch (error) {
        entry.reject(error);
      }
    });
  };
  return {
    request,
    disconnect: () => { try { port.disconnect(); } catch (_) {} },
  };
}

/**
 * Stage a picked file onto disk through the native host so the MTProto
 * uploader gets a real path. A browser File has no disk path, so without
 * this the native route is unreachable for every picked file - which is
 * exactly why Telegram kept skipping >50 MB uploads.
 *
 * The host picks the temp path (%TEMP%/imgvault-tg-stage/<session>/<name>,
 * original filename kept so Telethon derives the right mime type) and
 * returns it; the caller deletes it after the upload. A failed or aborted
 * stage deletes its own partial file instead of leaving hundreds of MB
 * behind.
 *
 * @returns {Promise<string>} the staged file's disk path
 */
export async function stageBlobForNativeUpload(blob, filename, { onProgress, signal } = {}) {
  const size = blob?.size || 0;
  if (!size) throw new Error('Cannot stage an empty file for the native Telegram upload.');
  if (typeof chrome === 'undefined' || !chrome.runtime?.connectNative) {
    throw new Error('Native host staging needs the extension runtime (chrome.runtime.connectNative).');
  }
  const cleanName = String(filename || 'video.mp4');
  const sessionId = `tg-stage-${crypto.randomUUID()}`;
  const port = openNativePort();
  let stagedPath = '';
  try {
    if (signal?.aborted) throw new Error('Telegram native upload aborted.');
    let started;
    try {
      started = await port.request({
        action: 'file_write_start',
        request_id: sessionId,
        output_path: '',
        file_name: cleanName,
      });
    } catch (error) {
      throw new Error(
        `Staging failed at file_write_start: ${error.message} `
        + 'If ImgVault-Native-Host.exe predates this extension version, reinstall it from the latest release.'
      );
    }
    stagedPath = started?.filePath || '';
    if (!stagedPath) throw new Error('Native host staged the file but returned no path.');
    let staged = 0;
    for (let offset = 0; offset < size; offset += STAGE_CHUNK_BYTES) {
      if (signal?.aborted) throw new Error('Telegram native upload aborted.');
      const slice = blob.slice(offset, Math.min(offset + STAGE_CHUNK_BYTES, size));
      const bytes = new Uint8Array(await slice.arrayBuffer());
      await port.request({ action: 'file_write_chunk', request_id: sessionId, data: toBase64(bytes) });
      staged += bytes.length;
      onProgress?.({
        loaded: staged,
        current: staged,
        total: size,
        percent: size ? Math.round((staged / size) * 100) : 0,
        phase: 'staging',
        text: `Staging ${cleanName} for Telegram...`,
      });
    }
    const finished = await port.request({ action: 'file_write_finish', request_id: sessionId });
    const writtenSize = Number(finished?.message);
    if (Number.isFinite(writtenSize) && writtenSize !== size) {
      throw new Error(`Staged file size mismatch: wrote ${writtenSize} bytes, expected ${size}.`);
    }
    return finished?.filePath || stagedPath;
  } catch (error) {
    if (stagedPath) await deleteNativeTempFile(stagedPath).catch(() => {});
    throw error;
  } finally {
    port.disconnect();
  }
}

/**
 * Delete a staged temp file on the native host. The host only deletes files
 * under %TEMP% carrying the imgvault- marker, so a wrong path can never eat
 * a user file. Returns false when the file was already gone.
 */
export async function deleteNativeTempFile(filePath) {
  const target = String(filePath || '').trim();
  if (!target) return false;
  const port = openNativePort();
  try {
    const response = await port.request({ action: 'file_delete', file_path: target }, 15000);
    return response?.message !== 'already gone';
  } finally {
    port.disconnect();
  }
}

/**
 * Upload a large file directly via MTProto through the Rust native host (ImgVault-Native-Host).
 * Used when a video exceeds Telegram's standard 50 MB Bot API ceiling (up to 2,000 MB).
 */
export async function uploadTelegramNative({ filePath, channel, caption = '', onProgress, signal } = {}) {
  if (!filePath) throw new Error('Telegram native upload requires a local filePath.');
  const cleanChannel = String(channel || '').trim().replace(/^@+/, '');
  if (!cleanChannel) throw new Error('Telegram native upload requires a valid channel.');

  return new Promise((resolve, reject) => {
    let settled = false;
    let port;
    try {
      port = chrome.runtime.connectNative('com.imgvault.nativehost');
    } catch (err) {
      return reject(new Error(`Failed to connect to native host: ${err.message}`));
    }

    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      port.disconnect();
      fn(val);
    };

    if (signal) {
      if (signal.aborted) finish(reject, new Error('Telegram native upload aborted.'));
      else signal.addEventListener('abort', () => finish(reject, new Error('Telegram native upload aborted.')), { once: true });
    }

    port.onMessage.addListener((res) => {
      if (res?.event === 'progress') {
        if (onProgress && res.line) {
          const parts = res.line.split(':');
          if (parts.length >= 4) {
            const current = parseInt(parts[1], 10) || 0;
            const total = parseInt(parts[2], 10) || 0;
            const percent = parseFloat(parts[3]) || 0;
            // `loaded` is what the gallery progress handler reads; without
            // it the native upload showed no byte count at all.
            onProgress({ current, loaded: current, total, percent, phase: 'uploading', text: res.message });
          }
        }
        return;
      }

      if (res?.success) {
        let parsed = {};
        try {
          parsed = JSON.parse(res.stdout || '{}');
        } catch (_) {}
        finish(resolve, {
          ok: true,
          messageId: parsed.messageId,
          size: parsed.size,
          date: parsed.date,
          // the uploader warns when it could not read video dimensions
          // (mp4 posted as a document) — surfaced by the caller, never
          // dropped silently.
          warning: parsed.warning || '',
          videoAttributes: parsed.videoAttributes === true,
        });
      } else {
        finish(reject, new Error(res?.message || 'Native Telegram upload failed.'));
      }
    });

    port.onDisconnect.addListener(() => {
      if (!settled) {
        const err = chrome.runtime.lastError;
        finish(reject, new Error(err?.message || 'Native host disconnected unexpectedly during Telegram upload.'));
      }
    });

    port.postMessage({
      action: 'telegram_upload',
      file_path: filePath,
      channel: cleanChannel,
      caption,
    });
  });
}

/**
 * Verify one Telegram channel file through the native host's Telethon
 * session — the only reader that can see a file the Bot API getFile gate
 * refuses (> 20 MB). The host reads the post by message id and returns
 * the live file's size + name; the CALLER compares the size against the
 * stored size (exact match = found, anything else is not a pass).
 *
 * Throws when the host is unreachable, the script fails, or the message
 * has no document — the scene check treats all of those as "unverified",
 * never as found or broken.
 *
 * @returns {Promise<{messageId: string, size: number, name: string}>}
 */
export async function verifyTelegramFileNative({ messageId, channel, timeoutMs = 60000 } = {}) {
  const cleanId = String(messageId || '').trim();
  if (!cleanId) throw new Error('Telegram native verify requires a message id.');
  const cleanChannel = String(channel || '').trim().replace(/^@+/, '');
  if (!cleanChannel) throw new Error('Telegram native verify requires a valid channel.');
  if (typeof chrome === 'undefined' || !chrome.runtime?.connectNative) {
    throw new Error('Telegram native verify needs the extension runtime (chrome.runtime.connectNative).');
  }
  const port = openNativePort();
  try {
    const response = await port.request(
      { action: 'telegram_verify', message_id: cleanId, channel: cleanChannel },
      timeoutMs,
    );
    let parsed = null;
    try {
      parsed = JSON.parse(response?.stdout || '');
    } catch (_) {
      throw new Error('Telegram native verify returned unreadable output (no RESULT json).');
    }
    const size = Number(parsed?.size);
    if (!parsed?.ok || !Number.isFinite(size) || size < 0) {
      throw new Error(parsed?.error || 'Telegram native verify returned no file size.');
    }
    return { messageId: String(parsed.messageId ?? cleanId), size, name: String(parsed.name || '') };
  } finally {
    port.disconnect();
  }
}

const fromBase64 = (b64) => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/**
 * A Telethon-uploaded Telegram file has no Bot API file_id at all, so the
 * extension stores `native-<messageId>` as its fileId — every read of one
 * must branch to the native host instead of getFile (which would 400 on
 * the shape alone, and refuses any file over 20 MB anyway).
 */
export function isNativeTelegramFileId(fileId) {
  return String(fileId || '').startsWith('native-');
}

/** The channel message id behind a `native-<messageId>` fileId, or '' when the id is not native-shaped. */
export function nativeTelegramMessageId(fileId) {
  const raw = String(fileId || '');
  if (!raw.startsWith('native-')) return '';
  const id = raw.slice('native-'.length).trim();
  return /^\d+$/.test(id) ? id : '';
}

/**
 * Download a byte range of one Telegram channel file through the native
 * host's Telethon session — the only reader for a file the Bot API can
 * never serve: a Telethon-uploaded file has no Bot API file_id (see
 * isNativeTelegramFileId), and getFile refuses any file over 20 MB
 * anyway. The host streams DATA lines (<=512 KiB of bytes each,
 * base64) and finishes with a RESULT json; the caller gets the exact
 * requested bytes, verified against the RESULT length.
 *
 * Length 0 means "to end of file". Throws when the host is unreachable,
 * the script fails, or the bytes served do not match the RESULT length.
 *
 * @returns {Promise<Uint8Array>}
 */
export async function downloadTelegramFileNative({ messageId, channel, offset = 0, length = 0, timeoutMs = 300000, onProgress } = {}) {
  const cleanId = String(messageId || '').trim();
  if (!cleanId) throw new Error('Telegram native download requires a message id.');
  const cleanChannel = String(channel || '').trim().replace(/^@+/, '');
  if (!cleanChannel) throw new Error('Telegram native download requires a valid channel.');
  if (typeof chrome === 'undefined' || !chrome.runtime?.connectNative) {
    throw new Error('Telegram native download needs the extension runtime (chrome.runtime.connectNative).');
  }
  const start = Number(offset) || 0;
  const wanted = Number(length) || 0;
  if (start < 0) throw new Error(`Telegram native download: offset ${start} is negative.`);
  if (wanted < 0) throw new Error(`Telegram native download: length ${wanted} is negative.`);

  return new Promise((resolve, reject) => {
    let settled = false;
    let port;
    try {
      port = chrome.runtime.connectNative('com.imgvault.nativehost');
    } catch (err) {
      reject(new Error(`Failed to connect to native host: ${err.message}`));
      return;
    }

    const chunks = [];
    let received = 0;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { port.disconnect(); } catch (_) {}
      fn(val);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error(`Telegram native download timed out after ${timeoutMs / 1000}s (message ${cleanId}).`));
    }, timeoutMs);

    port.onMessage.addListener((res) => {
      if (res?.event === 'data' && typeof res.line === 'string' && res.line.startsWith('DATA:')) {
        try {
          const bytes = fromBase64(res.line.slice(5));
          chunks.push(bytes);
          received += bytes.length;
          onProgress?.({ loaded: received, total: wanted || null, phase: 'downloading' });
        } catch (err) {
          finish(reject, new Error(`Telegram native download got an unreadable data line: ${err.message}`));
        }
        return;
      }

      if (res?.success) {
        let parsed = {};
        try {
          parsed = JSON.parse(res.stdout || '{}');
        } catch (_) {}
        const served = Number(parsed?.length);
        if (!parsed?.ok || !Number.isFinite(served)) {
          finish(reject, new Error(parsed?.error || 'Telegram native download returned no RESULT.'));
          return;
        }
        if (served !== received) {
          finish(reject, new Error(`Telegram native download short: served ${received} bytes, RESULT says ${served}.`));
          return;
        }
        const out = new Uint8Array(received);
        let at = 0;
        for (const part of chunks) {
          out.set(part, at);
          at += part.length;
        }
        finish(resolve, out);
        return;
      }

      if (res?.event === 'complete' || res?.success === false) {
        finish(reject, new Error(res?.message || 'Telegram native download failed.'));
      }
      // progress events (if any) are ignored — a download emits data, not progress.
    });

    port.onDisconnect.addListener(() => {
      if (!settled) {
        const err = chrome.runtime.lastError;
        finish(reject, new Error(err?.message || 'Native host disconnected unexpectedly during Telegram download.'));
      }
    });

    port.postMessage({
      action: 'telegram_download',
      message_id: cleanId,
      channel: cleanChannel,
      offset: start,
      max_bytes: wanted,
    });
  });
}

// The size a scene file is expected to have, from the stored fields
// (all strings in the DB — '30361257', not 30361257). Null when nothing
// usable is stored: without an expectation there is nothing to compare
// a native verify against, so the file stays unverified.
const expectedSceneFileSize = (item, which) => {
  const raw = which === 'spz' ? (item?.spzFileSize ?? item?.fileSize) : item?.textureFileSize;
  const size = Number(raw);
  return Number.isFinite(size) && size > 0 ? size : null;
};

// Native-verify one gate-hit scene file. 'matched' ONLY when Telethon
// reads the post AND its size equals the stored size exactly — a gate
// error alone never counts as found (that would pass a wrong file).
// 'mismatched' means the post is not the file the DB expects (broken);
// 'unverifiable' covers a missing host, a missing message, and a missing
// stored size — all stay unverified, never broken.
async function verifyGateHitSceneFile({ messageId, channel, expectedSize }) {
  if (!Number.isFinite(expectedSize) || expectedSize <= 0) {
    return { status: 'unverifiable', reason: 'no stored size to compare against' };
  }
  try {
    const live = await verifyTelegramFileNative({ messageId, channel });
    if (live.size === expectedSize) return { status: 'matched', size: live.size };
    return {
      status: 'mismatched',
      size: live.size,
      reason: `Telegram has ${live.size} bytes, expected ${expectedSize}`,
    };
  } catch (err) {
    return { status: 'unverifiable', reason: err?.message || String(err) };
  }
}

