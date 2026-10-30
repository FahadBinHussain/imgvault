// Server-side resolution of encrypted vault blobs for the web app.
//
// The extension resolves these with its own privileges (udrop keys, and for
// terabox a hidden-tab jsToken scrape). A server cannot scrape terabox's token
// (no chrome.tabs/scripting), so only hosts with a pure-HTTP resolve are
// readable here — everything else fails loudly with the host named.
//
// Stored `encryptedBlobUrl` is the durable *watch* URL (serves HTML), so a
// signed download URL must be regenerated from the file id for every read.
// Telegram is the exception: its copies store the platform-local byte route and
// the read is a Bot API getFile of the file id (20 MB read-back cap, plan 3a).

import {
  getTelegramFileInfo,
  redactTelegramToken,
  telegramFileBytesUrl,
} from './telegramServerApi'

const UDROP_API = 'https://www.udrop.com/api/v2'
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export const WEB_READABLE_VAULT_HOSTS = ['udrop', 'telegram']

export function vaultBlobCopies(extra) {
  const list = Array.isArray(extra?.encryptedBlobHosts) && extra.encryptedBlobHosts.length > 0
    ? extra.encryptedBlobHosts
    : (extra?.encryptedBlobUrl
      ? [{
          host: extra.vaultHost || 'udrop',
          encryptedBlobUrl: extra.encryptedBlobUrl,
          encryptedBlobFileId: extra.encryptedBlobFileId || '',
        }]
      : [])

  return list.map((copy) => ({
    host: String(copy?.host || extra?.vaultHost || 'udrop').toLowerCase(),
    url: copy?.encryptedBlobUrl || copy?.url || '',
    fileId: copy?.encryptedBlobFileId || copy?.fileId || '',
  }))
}

async function resolveUdropDownloadUrl(fileId, key1, key2) {
  if (!fileId) throw new Error('udrop copy has no file id')
  if (!key1 || !key2) throw new Error('udrop keys are not configured in Settings')

  const authBody = new FormData()
  authBody.append('key1', key1)
  authBody.append('key2', key2)
  const authRes = await fetch(`${UDROP_API}/authorize`, { method: 'POST', body: authBody, cache: 'no-store' })
  if (!authRes.ok) throw new Error(`udrop authorize failed (HTTP ${authRes.status})`)
  const authJson = await authRes.json()
  if (authJson?._status !== 'success' || !authJson?.data?.access_token) {
    throw new Error(`udrop authorize rejected: ${authJson?.response || 'no access token'}`)
  }

  const dlBody = new FormData()
  dlBody.append('access_token', authJson.data.access_token)
  dlBody.append('account_id', authJson.data.account_id)
  dlBody.append('file_id', String(fileId))
  const dlRes = await fetch(`${UDROP_API}/file/download`, { method: 'POST', body: dlBody, cache: 'no-store' })
  if (!dlRes.ok) throw new Error(`udrop download-url request failed (HTTP ${dlRes.status})`)
  const dlJson = await dlRes.json()
  if (dlJson?._status !== 'success' || !dlJson?.data?.download_url) {
    throw new Error(`udrop download-url rejected: ${dlJson?.response || 'no download_url'}`)
  }
  return dlJson.data.download_url
}

async function resolveCopyUrl(copy, settings) {
  if (copy.host === 'udrop') {
    return resolveUdropDownloadUrl(copy.fileId, settings?.udropKey1, settings?.udropKey2)
  }
  if (copy.host === 'telegram') {
    const token = String(settings?.telegramBotToken || '').trim()
    if (!token) throw new Error('telegram vault copy needs the bot token in Settings → API Keys')
    if (!copy.fileId) throw new Error('telegram copy has no file id')
    // getFile hands out a short-lived bytes url that embeds the token: it is
    // fetched immediately by the caller and never stored, returned, or logged.
    // Over 20 MB getTelegramFileInfo throws naming the cap (plan 3a limit).
    const info = await getTelegramFileInfo(token, copy.fileId)
    return telegramFileBytesUrl(token, info.file_path)
  }
  if (copy.host === 'terabox') {
    throw new Error('terabox vault copies need the extension (its hidden-tab token scrape cannot run on the server)')
  }
  throw new Error(`vault host "${copy.host}" has no server-side reader`)
}

/**
 * Open a byte range of the encrypted blob. Tries every stored copy in order
 * (the vault stores a copy per selected host) and throws with each host's
 * failure named — never a silent empty body.
 *
 * @returns {Promise<{body: ReadableStream, status: number, contentLength: number,
 *   total: number|null, host: string, primaryHost: string, copyIndex: number,
 *   failures: string[]}>} `copyIndex > 0` = the primary copy failed and a
 *   secondary one served the read.
 */
export async function openVaultCiphertext({ extra, settings, start = null, end = null }) {
  const copies = vaultBlobCopies(extra)
  if (copies.length === 0) throw new Error('Vault item has no encrypted blob copies')

  const primaryHost = copies[0].host
  const failures = []
  // a telegram read failure can carry the token-bearing file url in its message,
  // so every failure string recorded here is scrubbed before it can reach a
  // response header or error body.
  const telegramToken = String(settings?.telegramBotToken || '').trim()
  const noteFailure = (text) => failures.push(redactTelegramToken(text, telegramToken))
  for (let copyIndex = 0; copyIndex < copies.length; copyIndex += 1) {
    const copy = copies[copyIndex]
    let url
    try {
      url = await resolveCopyUrl(copy, settings)
    } catch (error) {
      noteFailure(`${copy.host}: ${error.message}`)
      continue
    }

    const headers = { 'User-Agent': BROWSER_UA, Accept: '*/*' }
    const ranged = Number.isInteger(start) && Number.isInteger(end)
    if (ranged) headers.Range = `bytes=${start}-${end}`
    // never forward cookies: terabox's CDN throttles to ~30KB/s when the
    // session cookie is present (tsl=30) vs ~2MB/s without it (tsl=2000).
    if (copy.host === 'terabox') headers.Referer = 'https://www.terabox.com/'

    let res
    try {
      res = await fetch(url, { headers, cache: 'no-store', redirect: 'follow' })
    } catch (error) {
      noteFailure(`${copy.host}: fetch failed (${error.message})`)
      continue
    }

    if (!res.ok || !res.body) {
      noteFailure(`${copy.host}: HTTP ${res.status}`)
      continue
    }

    const contentLength = Number(res.headers.get('content-length') || 0)
    const contentRange = res.headers.get('content-range')
    const totalFromRange = contentRange ? Number(contentRange.split('/')[1]) : null
    // `copyIndex > 0` means the shipped primary copy could not serve this read —
    // the callers must label that loudly instead of pretending it is normal.
    const served = { copyIndex, primaryHost, host: copy.host, failures }

    if (!ranged) {
      return { body: res.body, status: 200, contentLength, total: totalFromRange, ...served }
    }

    if (res.status === 206) {
      return { body: res.body, status: 206, contentLength, total: totalFromRange, ...served }
    }

    // host ignored Range and is sending the whole blob — slice the requested
    // window out of the stream and stop reading past it.
    const wanted = end - start + 1
    return {
      body: sliceStream(res.body, start, wanted),
      status: 206,
      contentLength: wanted,
      total: contentLength || totalFromRange,
      ...served,
    }
  }

  throw new Error(`No readable vault blob copy (${failures.join('; ')})`)
}

function sliceStream(body, skip, length) {
  const reader = body.getReader()
  let skipped = 0
  let sent = 0
  let finished = false
  return new ReadableStream({
    async pull(controller) {
      while (sent < length && !finished) {
        const { done, value } = await reader.read()
        if (done) {
          finished = true
          break
        }
        let chunk = value
        if (skipped < skip) {
          const drop = Math.min(skip - skipped, chunk.byteLength)
          skipped += drop
          chunk = chunk.subarray(drop)
          if (chunk.byteLength === 0) continue
        }
        const remaining = length - sent
        if (chunk.byteLength > remaining) chunk = chunk.subarray(0, remaining)
        sent += chunk.byteLength
        controller.enqueue(chunk)
      }
      if (sent >= length) {
        controller.close()
        reader.cancel().catch(() => {})
        return
      }
      if (finished) {
        controller.error(new Error(`vault blob ended after ${sent} of ${length} requested bytes`))
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {})
    },
  })
}
