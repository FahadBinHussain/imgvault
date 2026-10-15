// Telegram media serving route (plan-telegram-host.md phase 1, chunk 3).
//
// Rows store the platform-local relative path `/telegram-media/<fileId>?mt=<mime>`
// (extension SW serves the same path from its fetch listener, background.js
// handleTelegramMediaRequest). This is the web twin of that handler:
//   - the bot token is read SERVER-SIDE from public.settings at fetch time and
//     never appears in a stored URL, a response, or a log line;
//   - getFile runs on EVERY request (file_path expires, so it is never cached);
//   - server-side proxy only - never a 302 (a redirect would leak the token URL);
//   - Range passes through so non-mp4 video documents still seek;
//   - `mt` wins for Content-Type (the Bot API answers text/plain for documents);
//   - failures are loud plain-text statuses, never a silent empty body.
import { db } from '@/db'
import { settings as settingsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'

export const maxDuration = 60

const TELEGRAM_API = 'https://api.telegram.org'
const TELEGRAM_GETFILE_MAX_BYTES = 20 * 1024 * 1024 // getFile 20 MB gate
const TELEGRAM_TIMEOUT_MS = 60000

const MIME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*$/

function formatBytesForError(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown size'
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

// The token rides the internal file URL, so a raw fetch error could echo it.
function redactToken(message, token) {
  const text = String(message || 'unknown error')
  return token ? text.split(token).join('[redacted]') : text
}

function textResponse(status, message) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

/** POST a Bot API method (getFile here). Throws loudly with method + description. */
async function telegramCallApi(token, method, body) {
  const url = `${TELEGRAM_API}/bot${token}/${method}`
  let response
  try {
    response = await fetch(url, { method: 'POST', body, cache: 'no-store', credentials: 'omit' })
  } catch (err) {
    throw new Error(`Telegram ${method}: network error - ${err.message || String(err)}`)
  }

  if (!response.ok) {
    const text = (await response.text()).slice(0, 300)
    throw new Error(`Telegram ${method}: HTTP ${response.status} - ${text}`)
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
async function getTelegramFileInfo(token, fileId) {
  const form = new FormData()
  form.append('file_id', fileId)

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
 * Resolve a fileId to bytes right now (file_path expires, so it is never cached
 * beyond this request). Range is passed through for video seeking.
 */
async function fetchTelegramFile(token, fileId, { range = null } = {}) {
  const info = await getTelegramFileInfo(token, fileId)

  // Internal only - this URL carries the token and must never leave this function.
  const url = `${TELEGRAM_API}/file/bot${token}/${info.file_path}`

  let response
  try {
    const headers = range ? { Range: range } : {}
    response = await fetch(url, { headers, cache: 'no-store', credentials: 'omit' })
  } catch (err) {
    throw new Error(`Telegram file fetch failed: ${err.message || String(err)}`)
  }
  if (!response.ok && response.status !== 206) {
    throw new Error(
      `Telegram file fetch failed: HTTP ${response.status} ` +
        `(the file_path from getFile can expire - refetch getFile before retrying)`
    )
  }
  return response
}

async function readTelegramToken() {
  if (!db) {
    return {
      error: 'Database unavailable (DATABASE_URL not set) - cannot read the Telegram bot token.',
    }
  }

  let token
  try {
    const [row] = await db
      .select({ token: settingsTable.telegramBotToken })
      .from(settingsTable)
      .where(eq(settingsTable.id, 'config'))
    token = String(row?.token || '').trim()
  } catch (error) {
    return {
      error: `Telegram media settings read failed: ${redactToken(error?.message, '')}`,
    }
  }

  if (!token) {
    return {
      error:
        'Telegram bot token is not configured - save it in Settings -> API Keys ' +
        '(both the web settings page and the extension write public.settings.telegram_bot_token).',
    }
  }
  return { token }
}

export async function GET(request, { params }) {
  const resolvedParams = await params
  const fileId = typeof resolvedParams?.fileId === 'string' ? resolvedParams.fileId.trim() : ''
  if (!fileId) {
    return textResponse(400, 'Missing Telegram file id')
  }
  if (fileId.length > 1024) {
    return textResponse(400, `Telegram file id is too long (${fileId.length} chars)`)
  }

  const { token: maybeToken, error: tokenError } = await readTelegramToken()
  if (tokenError) {
    return textResponse(500, tokenError)
  }
  const token = maybeToken

  const range = request.headers.get('Range')

  let response
  let timer = null
  try {
    response = await Promise.race([
      fetchTelegramFile(token, fileId, { range }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('getFile + file fetch timed out after 60s')),
          TELEGRAM_TIMEOUT_MS
        )
      }),
    ])
  } catch (error) {
    const message = redactToken(error?.message, token)
    console.error('[telegram-media] serve failed:', message)
    return textResponse(502, `Telegram media fetch failed: ${message}`)
  } finally {
    if (timer) clearTimeout(timer)
  }

  const { searchParams } = new URL(request.url)
  const rawMime = String(searchParams.get('mt') || '').trim()
  if (rawMime && !MIME_PATTERN.test(rawMime)) {
    return textResponse(400, `Invalid mt parameter: ${rawMime.slice(0, 120)}`)
  }

  const upstreamType = String(response.headers.get('content-type') || '')
  const contentType =
    rawMime ||
    (upstreamType.includes('/') && !upstreamType.startsWith('text/plain')
      ? upstreamType
      : 'application/octet-stream')

  const headers = new Headers()
  headers.set('Content-Type', contentType)
  headers.set('Cache-Control', 'private, max-age=3600')
  const acceptRanges = response.headers.get('accept-ranges')
  if (acceptRanges) headers.set('Accept-Ranges', acceptRanges)
  const contentLength = response.headers.get('content-length')
  if (contentLength) headers.set('Content-Length', contentLength)
  const contentRange = response.headers.get('content-range')
  if (contentRange) headers.set('Content-Range', contentRange)

  return new Response(response.body, { status: response.status, headers })
}
