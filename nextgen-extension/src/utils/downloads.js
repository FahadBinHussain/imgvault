import {
  getDownloadTarget,
  getDownloadFileName,
  isHtmlContentType,
} from '@shared/downloadTargets.js'

// Extension transport: host_permissions exempt these fetches from CORS, so we
// hit the host directly (the web app goes through its /api/media proxy instead
// - pixvid sends no CORS headers). Filemoon/UDrop "direct" URLs serve HTML
// download pages, so they fail loudly per item in bulk runs: no tab spam, no
// silent skip, the failed ids stay selected for retry.

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

/** Resolve (strict settings source) + fetch directly + save; returns the filename. */
export async function downloadItemDirect(item, prefs = {}) {
  const target = getDownloadTarget(item, prefs)

  const res = await fetch(target.url)
  if (!res.ok) {
    throw new Error(`${target.sourceLabel} responded ${res.status}`)
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase()
  if (isHtmlContentType(contentType)) {
    throw new Error('the URL served an HTML download page, not file bytes - open the host page instead')
  }

  const blob = await res.blob()
  if (!blob.size) {
    throw new Error(`${target.sourceLabel} returned an empty response`)
  }

  const fileName = getDownloadFileName(item, target.url, blob.type || contentType)
  saveBlobAsFile(blob, fileName)
  return fileName
}
