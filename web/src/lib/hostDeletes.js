/**
 * Server-side host file cleanup for web trash actions (parity with the
 * extension's deleteFromImgbb / udropApi delete / teraBoxApi delete +
 * background.deleteVaultBlobFiles).
 *
 * The extension scrapes TeraBox write tokens through a hidden chrome tab; the
 * web server has no browser, so it does plain fetches instead:
 *   - jsToken  = bare UA fetch of www.terabox.com (NO cookie, NO Referer — a
 *     cookie or www Referer redirects to the simple-verify captcha page which
 *     has no jsToken; proven in the extension, AGENTS.md 2.11.x)
 *   - bdstoken/dp-logid = cookie'd fetch of www.terabox.com/main, same regexes
 *     the hidden tab scrapes (filemanager rejects write calls without them,
 *     errno -6)
 *
 * NO FALLBACKS: every failure throws loud with the host + cause in the message
 * so the trashed row (and its blob fields) survives and the action is
 * retryable — a blob is never orphaned silently.
 */

import { DEFAULT_VAULT_BLOB_HOST } from 'imgvault-shared/providerCatalog.js'
import { getImageProviderLinks } from '@/lib/image-provider-links'
import { getVideoProviderLinks } from '@/lib/video-provider-links'

const UDROP_API_BASE = 'https://www.udrop.com/api/v2'
const TERABOX_API_BASE = 'https://dm.terabox.com'
// Only the dm homepage moved to a captcha gate (breaks jsToken scraping), so
// the token/page scrape uses www while all /api/* calls stay on dm (where the
// PCS API actually works) — same split as the extension (2.11.8).
const TERABOX_TOKEN_BASE = 'https://www.terabox.com'

const userAgent = () =>
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * ImgBB has no documented REST delete endpoint; the upload response gives a
 * browser delete_url whose id/hash can be posted to the site JSON endpoint.
 * Port of storage.js deleteFromImgbb — returns true only when an endpoint
 * confirmed the deletion.
 */
export async function deleteImgbbByDeleteUrl(imgbbDeleteUrl) {
  if (!imgbbDeleteUrl) return false

  const postDelete = async (endpoint, imageId, imageHash) => {
    const formData = new FormData()
    formData.append('pathname', `/${imageId}/${imageHash}`)
    formData.append('action', 'delete')
    formData.append('delete', 'image')
    formData.append('from', 'resource')
    formData.append('deleting[id]', imageId)
    formData.append('deleting[hash]', imageHash)

    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData,
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new Error(`ImgBB delete endpoint returned ${response.status}`)
    }

    const text = await response.text()
    if (!text) return true

    try {
      const payload = JSON.parse(text)
      if (
        payload?.error ||
        payload?.status_txt === 'error' ||
        Number(payload?.status_code || payload?.status) >= 400
      ) {
        throw new Error(
          payload?.error?.message || payload?.status_txt || 'ImgBB delete endpoint rejected request'
        )
      }
    } catch (parseError) {
      // non-JSON body = the delete confirmation page; the delete landed
      if (parseError instanceof SyntaxError) return true
      throw parseError
    }

    return true
  }

  try {
    const deleteUrl = new URL(imgbbDeleteUrl)
    const pathParts = deleteUrl.pathname.split('/').filter(Boolean)
    if (pathParts.length >= 2) {
      const imageId = pathParts[0]
      const imageHash = pathParts[1]
      try {
        return await postDelete('https://ibb.co/json', imageId, imageHash)
      } catch (ibbError) {
        console.warn('[imgbb-delete] ibb.co/json failed:', ibbError)
      }
      return await postDelete('https://imgbb.com/json', imageId, imageHash)
    }
  } catch (parseError) {
    console.warn('[imgbb-delete] could not parse delete URL:', parseError)
  }

  // last path: hit the delete URL directly (unverified — never a success)
  try {
    const response = await fetch(imgbbDeleteUrl, {
      method: 'GET',
      redirect: 'follow',
    })
    if (!response.ok) throw new Error(`ImgBB delete URL returned ${response.status}`)
    console.warn('[imgbb-delete] direct delete URL loaded, but deletion was not verified.')
  } catch (directError) {
    console.warn('[imgbb-delete] direct delete URL failed:', directError)
  }
  return false
}

/**
 * Pixvid delete is best-effort by established extension semantics — a failure
 * warns loudly but never blocks the row delete (its delete_url has no
 * confirmable response).
 */
export async function deletePixvidByDeleteUrl(deleteUrl) {
  if (!deleteUrl) return false
  try {
    const response = await fetch(deleteUrl, { method: 'GET', redirect: 'follow' })
    if (!response.ok) {
      console.warn(`[pixvid-delete] delete URL returned ${response.status} — not verified`)
      return false
    }
    return true
  } catch (error) {
    console.warn('[pixvid-delete] request failed:', error)
    return false
  }
}

/** Port of udropApi.authorizeUdrop — pure fetch, works server-side. */
export async function authorizeUdrop(key1, key2) {
  const formData = new FormData()
  formData.append('key1', key1)
  formData.append('key2', key2)

  const resp = await fetch(`${UDROP_API_BASE}/authorize`, {
    method: 'POST',
    body: formData,
  })

  if (!resp.ok) throw new Error(`Auth failed: ${resp.status}`)
  const result = await resp.json()
  if (result._status !== 'success') {
    throw new Error(
      `Auth error: ${result.response || result.msg || result.message || JSON.stringify(result)}`
    )
  }
  if (!result.data) throw new Error('Auth succeeded but no data returned.')
  return result.data
}

/** Port of udropApi.deleteUdropFile. */
export async function deleteUdropFile(accessToken, accountId, fileId) {
  const formData = new FormData()
  formData.append('access_token', accessToken)
  formData.append('account_id', accountId)
  formData.append('file_id', String(fileId))

  const resp = await fetch(`${UDROP_API_BASE}/file/delete`, {
    method: 'POST',
    body: formData,
  })

  if (!resp.ok) throw new Error(`Delete failed: ${resp.status}`)
  const result = await resp.json()
  if (result._status !== 'success') {
    throw new Error(result.response || result.msg || result.message || 'Delete failed')
  }
  return true
}

/**
 * Scrape jsToken from the www homepage with a BARE fetch — no cookie, no
 * Referer (either one redirects to the simple-verify captcha page that has no
 * jsToken). Returns '' when the gate holds; callers then fail loudly at the
 * API layer instead of silently proceeding.
 */
async function teraboxFetchJsToken() {
  try {
    const res = await fetch(`${TERABOX_TOKEN_BASE}/`, {
      headers: { 'User-Agent': userAgent() },
      redirect: 'follow',
    })
    const html = await res.text()
    const encoded = html.match(
      /function%20fn%28a%29%7Bwindow\.jsToken%20%3D%20a%7D%3Bfn%28%22([^%"]+)%22%29/
    )?.[1]
    if (encoded) return encoded
    return html.match(/fn\("([A-Za-z0-9]{10,})"\)/)?.[1] || ''
  } catch (error) {
    console.warn('[terabox-delete] jsToken scrape failed:', error)
    return ''
  }
}

/**
 * Page-context tokens for write ops (filemanager delete): jsToken + bdstoken
 * + dp-logid, scraped from the /main page HTML — the server-side equivalent of
 * the extension's hidden-tab scrape (same regexes). Returns a partial context
 * on failure; the delete itself then fails loudly with a param-presence trace.
 */
async function teraboxFetchPageContext(cookie) {
  const empty = { jsToken: '', bdstoken: '', dpLogid: '' }
  try {
    const res = await fetch(`${TERABOX_TOKEN_BASE}/main`, {
      headers: {
        Cookie: cookie,
        'User-Agent': userAgent(),
        Referer: `${TERABOX_TOKEN_BASE}/`,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    })
    const html = (await res.text()).slice(0, 400000)
    return {
      jsToken:
        html.match(/fn\("([A-Za-z0-9]{10,})"\)/)?.[1] ||
        html.match(/window\.jsToken\s*=\s*"([^"]+)"/)?.[1] ||
        '',
      bdstoken: html.match(/"bdstoken"\s*:\s*"([^"]+)"/)?.[1] || '',
      dpLogid: html.match(/dp-logid[=:]([^&"'\s<>]+)/)?.[1] || '',
    }
  } catch (error) {
    console.warn('[terabox-delete] /main page-context scrape failed:', error)
    return empty
  }
}

async function teraboxRequest(cookie, jsToken, pathname, params = {}, retried = false) {
  const qp = new URLSearchParams({
    app_id: '250528',
    web: '1',
    channel: 'dubox',
    clienttype: '0',
    ...(jsToken ? { jsToken } : {}),
    ...params,
  })
  const res = await fetch(`${TERABOX_API_BASE}${pathname}?${qp}`, {
    method: 'GET',
    headers: {
      Cookie: cookie,
      Accept: 'application/json, text/plain, */*',
      Referer: `${TERABOX_API_BASE}/`,
      'User-Agent': userAgent(),
      'X-Requested-With': 'XMLHttpRequest',
    },
  })
  let json
  try {
    json = await res.json()
  } catch {
    return null
  }
  if (json.errno === 4000023 && !retried) {
    // stale/invalid jsToken (or need-verify) → fresh token from the bare
    // scrape and retry once (server-side twin of the hidden-tab force-fresh)
    const fresh = await teraboxFetchJsToken()
    if (fresh) return teraboxRequest(cookie, fresh, pathname, params, true)
  }
  return json
}

/**
 * Resolve the cookie + jsToken pair for API calls. The web has no live
 * browser session (the extension falls back to chrome.cookies), so the
 * settings cookie is REQUIRED here — fail loud with the remediation path.
 */
async function teraboxAuthorize(cookie) {
  const resolved = String(cookie || '').trim()
  if (!resolved) {
    throw new Error(
      'No TeraBox cookie. Set it in Settings → API Keys → TeraBox Cookie (the web has no browser session to read).'
    )
  }
  const jsToken = await teraboxFetchJsToken()
  return { cookie: resolved, jsToken }
}

/**
 * List one TeraBox folder, paginating past the 100-per-page cap. Throws on
 * any page/errno failure — a partial listing must never masquerade as a
 * healthy/complete one (2.12.78 bug class).
 */
async function teraboxListFolder(cookie, jsToken, dir = '/') {
  const num = 100
  const all = []
  let page = 1
  for (;;) {
    const json = await teraboxRequest(cookie, jsToken, '/api/list', {
      dir,
      order: 'time',
      desc: '1',
      showempty: '0',
      web_tt: '1',
      num: String(num),
      page: String(page),
    })
    if (!json) throw new Error(`TeraBox /api/list returned no response for ${dir} page ${page}.`)
    if (json.errno !== 0 || !Array.isArray(json.list)) {
      throw new Error(
        `TeraBox /api/list failed for ${dir} page ${page}: errno=${json.errno}${
          json.errmsg ? ` (${String(json.errmsg).slice(0, 80)})` : ''
        }`
      )
    }
    all.push(...json.list)
    if (json.list.length < num) break
    page += 1
    if (page > 100) {
      throw new Error(
        `TeraBox /api/list exceeded 100 pages for ${dir} — aborting rather than using a truncated listing.`
      )
    }
  }
  return all
}

/** Root-only fast path; errors swallow to '' (the recursive search throws). */
async function teraboxResolveRootPath(auth, fsId, fileName) {
  try {
    const entries = await teraboxListFolder(auth.cookie, auth.jsToken, '/')
    const hit = entries.find((entry) => entry.isdir !== 1 && String(entry.fs_id) === String(fsId))
    if (hit) return String(hit.path || '')
    if (fileName) {
      const byName = entries.find(
        (entry) => entry.isdir !== 1 && String(entry.server_filename || '') === String(fileName)
      )
      if (byName) return String(byName.path || '')
    }
  } catch (error) {
    console.warn(`[terabox-delete] root listing failed in resolver: ${error.message}`)
  }
  return ''
}

/**
 * Recursively list ALL files across every folder. Throws on any listing
 * failure (never returns [] for an error — a broken listing can never look
 * like "file already gone").
 */
export async function listAllTeraBoxFiles(cookie) {
  const auth = await teraboxAuthorize(cookie)

  const allFiles = []
  const queue = [{ dir: '/', folder: 'root' }]
  const visited = new Set()

  while (queue.length > 0) {
    const { dir, folder } = queue.shift()
    if (visited.has(dir)) continue
    visited.add(dir)

    const entries = await teraboxListFolder(auth.cookie, auth.jsToken, dir)
    for (const entry of entries) {
      if (entry.isdir === 1) {
        const subDir = String(
          entry.path || `${dir}${dir.endsWith('/') ? '' : '/'}${entry.server_filename}`
        )
        if (!visited.has(subDir)) {
          queue.push({ dir: subDir, folder: entry.server_filename || subDir })
        }
      } else {
        allFiles.push({
          fs_id: String(entry.fs_id),
          path: String(entry.path || ''),
          server_filename: String(entry.server_filename || ''),
          size: Number(entry.size || 0),
          isdir: 0,
          _folder: folder,
        })
      }
    }
  }

  return allFiles
}

/**
 * TeraBox dlinks embed the file id: ?fid=<vuk>-<app>-<fs_id> — the trailing
 * numeric segment IS the fs_id (DB-verified 2026-09-09).
 */
export const teraBoxFsIdFromUrl = (u) => {
  try {
    const m = String(u || '').match(/[?&]fid=([^&#]+)/)
    if (!m) return ''
    const parts = decodeURIComponent(m[1]).split('-')
    const last = parts[parts.length - 1]
    return /^\d+$/.test(last || '') ? last : ''
  } catch {
    return ''
  }
}

/**
 * Delete files on TeraBox by EXACT full path (moves to recycle bin —
 * recoverable by design; nothing is ever hard-wiped from here).
 * Port of teraBoxApi.deleteTeraBoxFiles minus the chrome hidden tab: write ops
 * get bdstoken/dp-logid from the cookie'd /main scrape instead. Retries dm
 * base → fresh context → www base, always with the SAME paths, then throws
 * with a sanitized trace (param presence + errno, no secrets).
 */
export async function deleteTeraBoxFiles(cookie, paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).map((s) => String(s || '')).filter(Boolean)
  if (list.length === 0) throw new Error('No TeraBox paths to delete.')
  if (list.length > 10) {
    throw new Error(`Refusing to delete ${list.length} files at once (cap 10 — delete groups one by one).`)
  }
  for (const p of list) {
    if (!p.startsWith('/')) throw new Error(`Refusing to delete non-absolute path: ${p}`)
    if (p === '/') throw new Error('Refusing to delete root.')
  }
  const auth = await teraboxAuthorize(cookie)
  const trace = []
  const postDelete = async (base, ctx) => {
    const qp = new URLSearchParams({
      app_id: '250528',
      web: '1',
      channel: 'dubox',
      clienttype: '0',
      ...(ctx.jsToken ? { jsToken: ctx.jsToken } : {}),
      ...(ctx.bdstoken ? { bdstoken: ctx.bdstoken } : {}),
      ...(ctx.dpLogid ? { 'dp-logid': ctx.dpLogid } : {}),
      onnest: 'fail',
      opera: 'delete',
    })
    const body = new URLSearchParams({ filelist: JSON.stringify(list) })
      .toString()
      .replace(/\+/g, '%20')
    const res = await fetch(`${base}/api/filemanager?${qp}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: auth.cookie,
        Accept: 'application/json, text/plain, */*',
        Referer: `${base}/`,
        'User-Agent': userAgent(),
        'X-Requested-With': 'XMLHttpRequest',
      },
      body,
    })
    if (!res.ok) throw new Error(`TeraBox delete HTTP ${res.status} on ${base}`)
    const json = await res.json()
    // Sanitized trace: param presence + server errno only, no secrets.
    trace.push(
      `${base.replace('https://', '')} errno=${json?.errno ?? '?'}${
        json?.errmsg ? ` (${String(json.errmsg).slice(0, 80)})` : ''
      } [jsToken:${ctx.jsToken ? 'y' : 'n'} bdstoken:${ctx.bdstoken ? 'y' : 'n'} dp-logid:${
        ctx.dpLogid ? 'y' : 'n'
      }]`
    )
    console.log(`[terabox-delete] attempt: ${trace[trace.length - 1]}`)
    return json
  }

  const pageCtx = await teraboxFetchPageContext(auth.cookie)
  const baseCtx = {
    jsToken: pageCtx.jsToken || auth.jsToken,
    bdstoken: pageCtx.bdstoken,
    dpLogid: pageCtx.dpLogid,
  }
  let json = await postDelete(TERABOX_API_BASE, baseCtx)
  if (json && json.errno !== 0) {
    const freshCtx = await teraboxFetchPageContext(auth.cookie)
    const retryCtx = {
      jsToken: freshCtx.jsToken || (await teraboxFetchJsToken()) || baseCtx.jsToken,
      bdstoken: freshCtx.bdstoken || baseCtx.bdstoken,
      dpLogid: freshCtx.dpLogid || baseCtx.dpLogid,
    }
    json = await postDelete(TERABOX_API_BASE, retryCtx)
    if (json && json.errno !== 0) {
      const fallback = await postDelete(TERABOX_TOKEN_BASE, retryCtx)
      if (fallback && fallback.errno === 0) return true
      throw new Error(
        `TeraBox delete failed (${trace.join(' | ')}). Nothing deleted — files are untouched. ` +
          'If the trace shows bdstoken:n, fetch www.terabox.com/main with the session cookie again or refresh the cookie in Settings.'
      )
    }
  }
  if (!json || json.errno !== 0) {
    throw new Error(`TeraBox delete error: errno=${json?.errno ?? '?'}. Nothing deleted.`)
  }
  return true
}

/**
 * Delete the encrypted vault blob copies of a trashed row from their host(s),
 * BEFORE the row is dropped. Port of background.deleteVaultBlobFiles with the
 * same rules:
 *   - missing fileId / credentials → THROW (row stays, error names the host)
 *   - TeraBox: root path fast path → recursive search → file verifiably absent
 *     from the account = loud warn + release (2.13.3), a listing error = throw
 * @param {object} extra - the row's extra_metadata (blob fields live here)
 * @param {{udropKey1?: string, udropKey2?: string, teraboxCookie?: string}} settings
 */
export async function deleteVaultBlobCopies(extra, settings) {
  const meta = extra && typeof extra === 'object' ? extra : {}
  const copies =
    Array.isArray(meta.encryptedBlobHosts) && meta.encryptedBlobHosts.length > 0
      ? meta.encryptedBlobHosts
      : meta.encryptedBlobUrl
        ? [
            {
              host: meta.vaultHost || DEFAULT_VAULT_BLOB_HOST,
              encryptedBlobUrl: meta.encryptedBlobUrl,
              encryptedBlobFileId: meta.encryptedBlobFileId || '',
            },
          ]
        : []
  if (copies.length === 0) return // plain gallery item — no blob to clean up

  const fileName = meta.encryptedFileName || ''

  for (const copy of copies) {
    const host = String(copy.host || '').toLowerCase()
    const url = copy.encryptedBlobUrl || ''
    const fileId = copy.encryptedBlobFileId || ''
    try {
      if (host === 'udrop') {
        if (!fileId) throw new Error('item has no encryptedBlobFileId — cannot delete without it')
        if (!settings?.udropKey1 || !settings?.udropKey2) {
          throw new Error('UDrop API keys not configured (Settings → API Keys)')
        }
        const auth = await authorizeUdrop(settings.udropKey1, settings.udropKey2)
        await deleteUdropFile(auth.access_token, auth.account_id, fileId)
        console.log(`[vault-delete] udrop blob ${fileId} deleted`)
      } else if (host === 'terabox') {
        const fsId = fileId || teraBoxFsIdFromUrl(url)
        if (!fsId) {
          throw new Error(
            'no fs_id (encryptedBlobFileId or ?fid= in the dlink) to resolve the path'
          )
        }
        const cookie = String(settings?.teraboxCookie || '')
        const auth = await teraboxAuthorize(cookie)
        // Fast path: vault uploads land in the root folder, so the root-only
        // resolver usually hits.
        let path = await teraboxResolveRootPath(auth, fsId, fileName)
        if (!path) {
          // Root miss: the file may sit in a subfolder — search RECURSIVELY
          // (throws on a real listing failure, so a broken listing can never
          // masquerade as "file already gone").
          console.log(`[vault-delete] terabox fs_id ${fsId} not in root — searching all folders`)
          const all = await listAllTeraBoxFiles(cookie)
          const hit =
            all.find((f) => String(f.fs_id) === String(fsId)) ||
            (fileName ? all.find((f) => f.server_filename === fileName) : null)
          path = String(hit?.path || '')
        }
        if (!path) {
          // Listing complete, file nowhere: already deleted (recycle bin
          // cleared / manual delete / upload never finished). Nothing left to
          // remove — release the row loudly instead of trapping it forever.
          console.warn(
            `[vault-delete] terabox fs_id ${fsId} (${fileName || 'unnamed'}) absent from the account listing — already deleted, no host cleanup needed`
          )
          continue
        }
        await deleteTeraBoxFiles(cookie, [path])
        console.log(`[vault-delete] terabox blob ${path} deleted (moved to recycle bin)`)
      } else {
        throw new Error(`unsupported vault blob host "${host}" — cannot delete the blob`)
      }
    } catch (err) {
      throw new Error(
        `Vault blob delete failed on ${host}: ${err.message || err}. Item kept in trash — fix the host issue and retry.`
      )
    }
  }
}

// ---- Telegram channel posts (Bot API deleteMessage) ----

/**
 * Bot API chat_id: channel usernames must be @-prefixed (a bare username
 * answers "chat not found"); explicit ids (-100…/numeric) pass through.
 * @param {string} channel - channel username from settings
 * @returns {string}
 */
function telegramChatId(channel) {
  const clean = String(channel || '').trim()
  if (!clean) return ''
  return clean.startsWith('-') || /^\d+$/.test(clean) ? clean : `@${clean}`
}

/** The bot token rides the request URL — it must never reach error text. */
function redactTelegramToken(text, token) {
  const value = String(text || '')
  return token ? value.split(token).join('[redacted]') : value
}

/**
 * Delete one channel message. Returns:
 *   'deleted'      - Telegram confirmed the delete
 *   'already-gone' - Telegram reports the message no longer exists (verifiable
 *                    absence → caller releases the row loudly, 2.13.3 rule)
 * Anything else throws loud with the token redacted.
 */
async function telegramDeleteMessage(token, chatId, messageId) {
  let response
  try {
    const form = new FormData()
    form.append('chat_id', chatId)
    form.append('message_id', String(messageId))
    response = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: 'POST',
      body: form,
      cache: 'no-store',
      credentials: 'omit',
    })
  } catch (error) {
    throw new Error(
      `Telegram deleteMessage: network error - ${redactTelegramToken(error.message || error, token)}`
    )
  }

  const text = await response.text()

  let payload = null
  try {
    payload = JSON.parse(text)
  } catch {
    payload = null
  }

  // Telegram answers logical errors with BOTH a non-2xx status and a JSON
  // body (proven live: HTTP 400 carrying "message to delete not found"), so
  // the release classification must run on the parsed body BEFORE the status
  // check — otherwise an already-deleted post could never release its row.
  if (payload?.ok) return 'deleted'
  if (payload && /message to delete not found/i.test(String(payload.description || ''))) {
    return 'already-gone'
  }

  if (!response.ok) {
    throw new Error(
      `Telegram deleteMessage: HTTP ${response.status} - ${redactTelegramToken(text.slice(0, 300), token)}`
    )
  }
  if (!payload) {
    throw new Error(
      `Telegram deleteMessage: invalid JSON response - ${redactTelegramToken(text.slice(0, 200), token)}`
    )
  }
  throw new Error(
    `Telegram deleteMessage: ${payload.error_code || 'error'} ${payload.description || 'unknown error'}`
  )
}

/**
 * Delete the channel message(s) a trashed row posted to Telegram — the image
 * and video host copies each carry their own messageId in extra_metadata.
 * Port of background.deleteTelegramPosts with the same rules:
 *   - no messageId → no-op (the row never touched the channel)
 *   - token/channel missing → THROW (row stays; the message ids die with it)
 *   - Telegram "message to delete not found" = verifiable absence → loud warn
 *     + release, so an already-deleted post can never trap the row forever
 *   - anything else → THROW (row stays, retryable; a channel post is never
 *     orphaned silently — the Bot API also refuses its own posts once they
 *     age out of its delete window, so the error names that path too)
 * @param {object} row - raw media_items row (hosts ride extra_metadata)
 * @param {{telegramBotToken?: string, telegramChannel?: string}} settings
 * @returns {Promise<{checked: number, deleted: number, alreadyGone: number}>}
 */
export async function deleteTelegramPostsForItem(row, settings) {
  const imageLink = getImageProviderLinks(row)?.telegram
  const videoLink = getVideoProviderLinks(row)?.telegram
  const messageIds = [
    ...new Set(
      [imageLink?.messageId, videoLink?.messageId]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    ),
  ]
  if (messageIds.length === 0) return { checked: 0, deleted: 0, alreadyGone: 0 }

  const token = String(settings?.telegramBotToken || '').trim()
  const channel = String(settings?.telegramChannel || '').trim()
  if (!token || !channel) {
    throw new Error(
      `Telegram post delete needs the bot token and channel in Settings (missing ${
        !token ? 'telegram_bot_token' : 'telegram_channel'
      }). Item kept in trash so the message ids are not lost.`
    )
  }

  const chatId = telegramChatId(channel)
  let deleted = 0
  let alreadyGone = 0
  for (const messageId of messageIds) {
    try {
      const outcome = await telegramDeleteMessage(token, chatId, messageId)
      if (outcome === 'already-gone') {
        alreadyGone += 1
        console.warn(
          `[telegram-delete] message ${messageId} already gone from ${chatId} — releasing the row`
        )
      } else {
        deleted += 1
        console.log(`[telegram-delete] message ${messageId} deleted from ${chatId}`)
      }
    } catch (error) {
      throw new Error(
        `Telegram post delete failed for message ${messageId}: ${error.message || error}. ` +
          'Item kept in trash — fix the issue and retry (if the post predates Telegram\'s bot-delete window, delete it manually in the channel, then retry).'
      )
    }
  }
  return { checked: messageIds.length, deleted, alreadyGone }
}
