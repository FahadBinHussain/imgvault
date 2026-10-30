// Server-side Telegram Bot API reader (web twin of the extension's
// nextgen-extension/src/utils/telegramApi.js — the extension module cannot be
// imported here because it is browser/SW code).
//
// The Bot API answers getFile with a `file_path` that is only fetchable for a
// short window (~1 h) and the bytes URL embeds the BOT TOKEN in its path, so:
//   - the token URL is built inside fetchTelegramFile and never leaves it;
//   - nothing here stores, returns, or logs it, and every error thrown out of
//     this module goes through redactTelegramToken first;
//   - getFile runs on every read — a cached file_path would 404.
//
// Used by the /telegram-media route (gallery + vault copies served to the
// browser) and by vaultBlobSource (encrypted vault blob range reads).
const TELEGRAM_API = 'https://api.telegram.org';

export const TELEGRAM_GETFILE_MAX_BYTES = 20 * 1024 * 1024; // getFile read-back gate
export const TELEGRAM_TIMEOUT_MS = 60000;

export function formatBytesForError(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown size';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** The token rides the request URL — it must never reach error text. */
export function redactTelegramToken(text, token) {
  const value = String(text || '')
  return token ? value.split(token).join('[redacted]') : value
}

/** POST a Bot API method. Throws loudly with method + description (token redacted). */
export async function telegramCallApi(token, method, body) {
  const url = `${TELEGRAM_API}/bot${token}/${method}`
  let response
  try {
    response = await fetch(url, { method: 'POST', body, cache: 'no-store', credentials: 'omit' })
  } catch (err) {
    throw new Error(`Telegram ${method}: network error - ${redactTelegramToken(err.message || err, token)}`)
  }

  if (!response.ok) {
    const text = (await response.text()).slice(0, 300)
    throw new Error(`Telegram ${method}: HTTP ${response.status} - ${redactTelegramToken(text, token)}`)
  }

  let json
  try {
    json = await response.json()
  } catch (err) {
    throw new Error(`Telegram ${method}: invalid JSON response - ${err.message}`)
  }
  if (!json?.ok) {
    throw new Error(
      `Telegram ${method}: ${json?.error_code || 'error'} ${json?.description || 'unknown error'}`
    )
  }
  return json.result
}

/** getFile -> { file_size, file_path } with the 20 MB gate enforced loudly. */
export async function getTelegramFileInfo(token, fileId) {
  const cleanFileId = String(fileId || '').trim()
  if (!cleanFileId) throw new Error('Telegram getFile: missing file id')

  const form = new FormData()
  form.append('file_id', cleanFileId)

  const info = await telegramCallApi(token, 'getFile', form)

  if (!info?.file_path) throw new Error('Telegram getFile: no file_path in response')
  if (Number(info.file_size) > TELEGRAM_GETFILE_MAX_BYTES) {
    throw new Error(
      `Telegram getFile gate: ${formatBytesForError(info.file_size)} is over the ` +
        `${formatBytesForError(TELEGRAM_GETFILE_MAX_BYTES)} limit (400 file is too big).`
    )
  }
  return info
}

/**
 * Internal only: the bytes URL for a resolved file_path. It embeds the bot token,
 * so callers must fetch it immediately and never store, return, or log it.
 */
export function telegramFileBytesUrl(token, filePath) {
  return `${TELEGRAM_API}/file/bot${token}/${filePath}`
}

/**
 * Resolve a fileId to bytes right now (file_path expires, so it is never cached
 * beyond this request). Range passes through — spike-verified: the cloud getFile
 * url answers 206 for a byte window.
 * @returns {Promise<Response>} caller owns the body stream
 */
export async function fetchTelegramFile(token, fileId, { range = null, timeoutMs = TELEGRAM_TIMEOUT_MS } = {}) {
  let timer = null
  try {
    return await Promise.race([
      (async () => {
        const info = await getTelegramFileInfo(token, fileId)
        // internal only - this url carries the token and must never leave here.
        const url = telegramFileBytesUrl(token, info.file_path)
        const headers = range ? { Range: range } : {}
        let response
        try {
          response = await fetch(url, { headers, cache: 'no-store', credentials: 'omit' })
        } catch (err) {
          throw new Error(`Telegram file fetch failed: ${redactTelegramToken(err.message || err, token)}`)
        }
        if (!response.ok && response.status !== 206) {
          throw new Error(
            `Telegram file fetch failed: HTTP ${response.status} ` +
              '(the file_path from getFile can expire - refetch getFile before retrying)'
          )
        }
        return response
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`getFile + file fetch timed out after ${Math.round(timeoutMs / 1000)}s`)),
          timeoutMs
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
