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

export const TELEGRAM_UPLOAD_MAX_BYTES = 50 * 1024 * 1024; // ~50 MB send cap
export const TELEGRAM_GETFILE_MAX_BYTES = 20 * 1024 * 1024; // getFile 20 MB gate
export const TELEGRAM_LOCAL_MEDIA_PREFIX = '/telegram-media/';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'avif', 'heic']);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const extensionOf = (filename = '') => {
  const base = String(filename).split('/').pop().split('?')[0];
  const dot = base.lastIndexOf('.');
  return dot > -1 ? base.slice(dot + 1).toLowerCase() : '';
};

export function formatBytesForError(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown size';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

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
  // the Bot API wants `@channelusername`; chat ids are never stored anywhere.
  return clean.startsWith('-') ? clean : `@${clean}`;
}

export function telegramApiBase(token) {
  return `${TELEGRAM_API}/bot${requireTelegramToken(token)}`;
}

/**
 * `video` for the h264/hotlink path, `document` for everything else.
 * images are ALWAYS documents - byte fidelity wins over the recompressed
 * photo CDN variant (that is the whole phase-0 image decision).
 */
export function telegramUploadField(filename = '', mimeType = '') {
  const ext = extensionOf(filename);
  if (ext === 'mp4') return 'video';
  if (IMAGE_EXTENSIONS.has(ext)) return 'document';
  // only mp4 gets the hotlink path - the spike proved other containers arrive as
  // a `document` with no CDN mp4, so video/webm + .mkv + .mov all stay documents.
  if (String(mimeType || '').toLowerCase() === 'video/mp4') return 'video';
  return 'document';
}

export function telegramUploadMethod(filename = '', mimeType = '') {
  return telegramUploadField(filename, mimeType) === 'video' ? 'sendVideo' : 'sendDocument';
}

/**
 * Gate BEFORE the upload, so an unserveable item is never created.
 *  - sendVideo: 50 MB cap (both failure shapes map to this message)
 *  - sendDocument: 20 MB, because reading it back goes through getFile
 */
export function assertTelegramUploadSize(bytes, filename = '', mimeType = '') {
  const size = Number(bytes) || 0;
  const field = telegramUploadField(filename, mimeType);
  const max = field === 'video' ? TELEGRAM_UPLOAD_MAX_BYTES : TELEGRAM_GETFILE_MAX_BYTES;
  if (size <= max) return;

  if (field === 'video') {
    throw new Error(
      `Telegram upload cap: ${formatBytesForError(size)} is over the ${formatBytesForError(max)} ` +
      `Bot API limit (file: ${filename || 'video.mp4'}). Larger videos need another host.`
    );
  }
  throw new Error(
    `Telegram getFile gate: ${formatBytesForError(size)} is over the ${formatBytesForError(max)} ` +
    `getFile limit (file: ${filename || 'file'}), so this upload could never be read back. ` +
    `Keep files at or under 20 MB for Telegram or use another host.`
  );
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
  const cleanChannel = String(channel || '').trim().replace(/^@+/, '');
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
    const mp4 = urls.find((url) => url.includes('.mp4'));
    if (wantMp4) {
      if (mp4) return mp4;
      lastReason = urls.length ? `post has media but no .mp4 among ${urls.length} cdn url(s)` : 'no cdn url in post segment';
      continue;
    }
    if (urls[0]) return urls[0];
    lastReason = 'no cdn url in post segment';
  }

  throw new Error(
    `Telegram scrape: no CDN url for ${cleanChannel}/${messageId} after ${attempts} attempt(s) ` +
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
