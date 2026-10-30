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
// The Bot API calls themselves live in @/lib/telegramServerApi (shared with the
// vault blob reader, which runs the same getFile + Range path).
import { db } from '@/db'
import { settings as settingsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { fetchTelegramFile, redactTelegramToken } from '@/lib/telegramServerApi'

export const maxDuration = 60

const MIME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*$/

function textResponse(status, message) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
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
      error: `Telegram media settings read failed: ${redactTelegramToken(error?.message, '')}`,
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
  try {
    response = await fetchTelegramFile(token, fileId, { range })
  } catch (error) {
    const message = redactTelegramToken(error?.message, token)
    console.error('[telegram-media] serve failed:', message)
    return textResponse(502, `Telegram media fetch failed: ${message}`)
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
