import { DEFAULT_VIDEO_SOURCE, VIDEO_UPLOAD_SERVICES } from './providerCatalog'

const hasText = (value) => typeof value === 'string' && value.trim().length > 0

const pickText = (...values) => {
  const found = values.find(hasText)
  return found ? found.trim() : ''
}

export function getVideoProviderLinks(item = {}) {
  item = item && typeof item === 'object' ? item : {}
  const extra = item.extraMetadata && typeof item.extraMetadata === 'object' ? item.extraMetadata : {}
  const fromItem = item.videoHosts && typeof item.videoHosts === 'object' ? item.videoHosts : {}
  const fromExtra = extra.videoHosts && typeof extra.videoHosts === 'object' ? extra.videoHosts : {}
  const links = {}

  for (const service of VIDEO_UPLOAD_SERVICES) {
    const saved = {
      ...(fromExtra[service.key] || {}),
      ...(fromItem[service.key] || {}),
    }
    const watchUrl = pickText(saved.watchUrl, saved.displayUrl, saved.url, item[service.watchUrlField], item[service.aliasWatchUrlField])
    const directUrl = pickText(saved.directUrl, saved.downloadUrl, item[service.directUrlField])
    const deleteUrl = pickText(saved.deleteUrl)
    const thumbnailUrl = pickText(saved.thumbnailUrl, saved.thumbUrl)

    if (watchUrl || directUrl || deleteUrl || thumbnailUrl) {
      links[service.key] = {
        ...saved,
        watchUrl,
        directUrl,
        deleteUrl,
        thumbnailUrl,
      }
    }
  }

  return links
}

export function hasAnyVideoProviderLink(item) {
  return Object.values(getVideoProviderLinks(item)).some((link) => link.watchUrl || link.directUrl)
}

export function getPreferredVideoProviderLink(item, preferredProvider = DEFAULT_VIDEO_SOURCE, field = 'watchUrl') {
  const links = getVideoProviderLinks(item)
  const orderedKeys = [
    preferredProvider,
    ...VIDEO_UPLOAD_SERVICES.map((service) => service.key).filter((key) => key !== preferredProvider),
  ]

  for (const key of orderedKeys) {
    const link = links[key]
    if (!link) continue
    const value = pickText(link[field], field === 'watchUrl' ? link.directUrl : link.watchUrl)
    if (value) return value
  }

  return ''
}
