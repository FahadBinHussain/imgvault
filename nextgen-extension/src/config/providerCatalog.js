const hasText = (value) => String(value || '').trim().length > 0

export const DEFAULT_IMAGE_SOURCE = 'imgbb'
export const DEFAULT_VIDEO_SOURCE = 'filemoon'

export const IMAGE_UPLOAD_SERVICES = [
  {
    key: 'pixvid',
    label: 'Pixvid',
    sourceValue: 'pixvid',
    sourceLabel: 'Pixvid (Compressed Quality)',
    apiKeyFields: ['pixvidApiKey'],
    required: false,
    uploaderKey: 'pixvidUploader',
    urlField: 'pixvidUrl',
    deleteUrlField: 'pixvidDeleteUrl',
    isConfigured: (settings) => hasText(settings?.pixvidApiKey),
    upload: ({ uploader, blob, settings, data, signal }) =>
      uploader.upload(blob, settings.pixvidApiKey, data.imageUrl, signal),
  },
  {
    key: 'imgbb',
    label: 'ImgBB',
    sourceValue: 'imgbb',
    sourceLabel: 'ImgBB (Original Quality)',
    apiKeyFields: ['imgbbApiKey'],
    required: false,
    uploaderKey: 'imgbbUploader',
    urlField: 'imgbbUrl',
    deleteUrlField: 'imgbbDeleteUrl',
    thumbUrlField: 'imgbbThumbUrl',
    isConfigured: (settings) => hasText(settings?.imgbbApiKey),
    upload: ({ uploader, blob, settings, signal }) =>
      uploader.upload(blob, settings.imgbbApiKey, signal),
  },
]

export const VIDEO_UPLOAD_SERVICES = [
  {
    key: 'filemoon',
    label: 'Filemoon',
    sourceValue: 'filemoon',
    sourceLabel: 'Filemoon',
    apiKeyFields: ['filemoonApiKey'],
    required: false,
    uploaderKey: 'filemoonUploader',
    watchUrlField: 'filemoonWatchUrl',
    directUrlField: 'filemoonDirectUrl',
    aliasWatchUrlField: 'filemoonUrl',
    isConfigured: (settings) => hasText(settings?.filemoonApiKey),
    upload: ({ uploader, blob, settings, data, signal }) =>
      uploader.upload(blob, settings.filemoonApiKey, data.fileName || 'video.mp4', signal),
    uploadWithProgress: ({ uploader, blob, settings, data, onProgress, signal }) =>
      uploader.uploadWithProgress(blob, settings.filemoonApiKey, data.fileName || 'video.mp4', onProgress, signal),
  },
  {
    key: 'udrop',
    label: 'UDrop',
    sourceValue: 'udrop',
    sourceLabel: 'UDrop',
    apiKeyFields: ['udropKey1', 'udropKey2'],
    required: false,
    uploaderKey: 'udropUploader',
    watchUrlField: 'udropWatchUrl',
    directUrlField: 'udropDirectUrl',
    aliasWatchUrlField: 'udropUrl',
    isConfigured: (settings) => hasText(settings?.udropKey1) && hasText(settings?.udropKey2),
    upload: ({ uploader, blob, settings, data, signal }) =>
      uploader.upload(blob, settings.udropKey1, settings.udropKey2, data.fileName || 'video.mp4', signal),
    uploadWithProgress: ({ uploader, blob, settings, data, onProgress, signal }) =>
      uploader.uploadWithProgress(blob, settings.udropKey1, settings.udropKey2, data.fileName || 'video.mp4', onProgress, signal),
  },
]

export const IMAGE_SOURCE_OPTIONS = IMAGE_UPLOAD_SERVICES.map(({ sourceValue, sourceLabel }) => ({
  value: sourceValue,
  label: sourceLabel,
})).sort((a, b) => {
  if (a.value === DEFAULT_IMAGE_SOURCE) return -1
  if (b.value === DEFAULT_IMAGE_SOURCE) return 1
  return a.label.localeCompare(b.label)
})

export const VIDEO_SOURCE_OPTIONS = VIDEO_UPLOAD_SERVICES.map(({ sourceValue, sourceLabel }) => ({
  value: sourceValue,
  label: sourceLabel,
})).sort((a, b) => {
  if (a.value === DEFAULT_VIDEO_SOURCE) return -1
  if (b.value === DEFAULT_VIDEO_SOURCE) return 1
  return a.label.localeCompare(b.label)
})

export function getConfiguredImageUploadServices(settings) {
  return IMAGE_UPLOAD_SERVICES.filter((service) => service.isConfigured(settings))
}

export function filterUploadServicesByKeys(services = [], selectedKeys) {
  if (!Array.isArray(selectedKeys)) {
    return services
  }

  const selected = new Set(
    selectedKeys
      .map((key) => String(key || '').trim().toLowerCase())
      .filter(Boolean)
  )

  if (selected.size === 0) {
    return []
  }

  return services.filter((service) => selected.has(service.key))
}

export function getMissingRequiredImageUploadServices(settings) {
  return IMAGE_UPLOAD_SERVICES.filter((service) => service.required && !service.isConfigured(settings))
}
