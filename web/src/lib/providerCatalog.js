export const DEFAULT_IMAGE_SOURCE = 'imgbb'

export const IMAGE_UPLOAD_SERVICES = [
  {
    key: 'pixvid',
    label: 'Pixvid',
    sourceValue: 'pixvid',
    sourceLabel: 'Pixvid (Compressed Quality)',
    urlField: 'pixvidUrl',
    deleteUrlField: 'pixvidDeleteUrl',
  },
  {
    key: 'imgbb',
    label: 'ImgBB',
    sourceValue: 'imgbb',
    sourceLabel: 'ImgBB (Original Quality)',
    urlField: 'imgbbUrl',
    deleteUrlField: 'imgbbDeleteUrl',
    thumbUrlField: 'imgbbThumbUrl',
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

export const DEFAULT_VIDEO_SOURCE = 'filemoon'

export const VIDEO_UPLOAD_SERVICES = [
  {
    key: 'filemoon',
    label: 'Filemoon',
    sourceValue: 'filemoon',
    sourceLabel: 'Filemoon',
    watchUrlField: 'filemoonWatchUrl',
    directUrlField: 'filemoonDirectUrl',
    aliasWatchUrlField: 'filemoonUrl',
  },
  {
    key: 'udrop',
    label: 'UDrop',
    sourceValue: 'udrop',
    sourceLabel: 'UDrop',
    watchUrlField: 'udropWatchUrl',
    directUrlField: 'udropDirectUrl',
    aliasWatchUrlField: 'udropUrl',
  },
]

export const VIDEO_SOURCE_OPTIONS = [
  ...VIDEO_UPLOAD_SERVICES.map(({ sourceValue, sourceLabel }) => ({ value: sourceValue, label: sourceLabel })),
]
