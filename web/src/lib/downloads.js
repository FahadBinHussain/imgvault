import {
  getDownloadTarget,
  getDownloadFileName,
  isHtmlContentType,
} from 'imgvault-shared/downloadTargets.js'

// Downloads go through the same-origin /api/media proxy: pixvid sends no
// CORS headers, so a direct browser fetch would fail for that host while
// imgbb allows it — one transport for every host, no per-host branching.

export async function fetchFileViaProxy(url) {
  const res = await fetch(`/api/media?url=${encodeURIComponent(url)}`)

  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 200)
    } catch (_) {
      // body already gone; status alone carries the failure
    }
    throw new Error(`media proxy responded ${res.status}${detail ? ` (${detail})` : ''}`)
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase()
  if (isHtmlContentType(contentType)) {
    throw new Error('the URL served an HTML download page, not file bytes - fetch it from the host site')
  }

  const blob = await res.blob()
  if (!blob.size) {
    throw new Error('the proxy returned an empty response')
  }

  return { blob, contentType }
}

export function saveBlobAsFile(blob, fileName) {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60000)
}

/** Resolve (strict settings source) + fetch + save; returns the saved filename. */
export async function downloadItemViaProxy(item, prefs = {}) {
  const target = getDownloadTarget(item, prefs)
  const { blob, contentType } = await fetchFileViaProxy(target.url)
  const fileName = getDownloadFileName(item, target.url, blob.type || contentType)
  saveBlobAsFile(blob, fileName)
  return fileName
}

/** Per-field download: fetch exactly the URL the field shows. */
export async function downloadFieldViaProxy(item, url) {
  const { blob, contentType } = await fetchFileViaProxy(url)
  const fileName = getDownloadFileName(item, url, blob.type || contentType)
  saveBlobAsFile(blob, fileName)
  return fileName
}
