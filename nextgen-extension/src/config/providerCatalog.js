import { FilemoonUploader, UDropUploader, TeraBoxUploader } from '../utils/uploaders.js';
import { resolveTeraBoxPlaybackUrl } from '../utils/teraBoxApi.js';

const hasText = (value) => String(value || '').trim().length > 0

export const DEFAULT_IMAGE_SOURCE = 'imgbb'
export const DEFAULT_VIDEO_SOURCE = 'filemoon'
export const DEFAULT_VAULT_BLOB_HOST = 'udrop'
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
    uploaderClass: FilemoonUploader,
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
    uploaderClass: UDropUploader,
    watchUrlField: 'udropWatchUrl',
    directUrlField: 'udropDirectUrl',
    aliasWatchUrlField: 'udropUrl',
    vaultBlobHost: true,
    vaultDownloadUrl: async ({ url, fileId, settings }) => {
      if (!fileId) return url;
      if (!hasText(settings?.udropKey1) || !hasText(settings?.udropKey2)) return url;
      const uploader = new UDropUploader();
      const auth = await uploader.authorize(settings.udropKey1, settings.udropKey2);
      const formData = new FormData();
      formData.append('access_token', auth.access_token);
      formData.append('account_id', auth.account_id);
      formData.append('file_id', String(fileId));
      const resp = await fetch('https://www.udrop.com/api/v2/file/download', {
        method: 'POST',
        body: formData,
      });
      if (!resp.ok) return url;
      const result = await resp.json();
      if (result._status === 'success' && result.data?.download_url) {
        return result.data.download_url;
      }
      return url;
    },
    isConfigured: (settings) => hasText(settings?.udropKey1) && hasText(settings?.udropKey2),
    upload: ({ uploader, blob, settings, data, signal }) =>
      uploader.upload(blob, settings.udropKey1, settings.udropKey2, data.fileName || 'video.mp4', signal),
    uploadWithProgress: ({ uploader, blob, settings, data, onProgress, signal }) =>
      uploader.uploadWithProgress(blob, settings.udropKey1, settings.udropKey2, data.fileName || 'video.mp4', onProgress, signal),
  },
  {
    key: 'terabox',
    label: 'TeraBox',
    sourceValue: 'terabox',
    sourceLabel: 'TeraBox',
    apiKeyFields: ['teraboxCookie'],
    required: false,
    uploaderKey: 'teraboxUploader',
    uploaderClass: TeraBoxUploader,
    watchUrlField: 'teraboxWatchUrl',
    directUrlField: 'teraboxDirectUrl',
    aliasWatchUrlField: 'teraboxUrl',
    vaultBlobHost: true,
    vaultDownloadUrl: async ({ url, fileId, fileName, settings }) => {
      try {
        const fresh = await resolveTeraBoxPlaybackUrl(settings?.teraboxCookie || '', fileId, fileName);
        return fresh || url;
      } catch (_) {
        return url;
      }
    },
    isConfigured: () => true, // cookie auto-reads from browser session
    upload: ({ uploader, blob, settings, data, signal }) =>
      uploader.upload(blob, settings?.teraboxCookie || '', data.fileName || 'video.mp4', signal),
    uploadWithProgress: ({ uploader, blob, settings, data, onProgress, signal }) =>
      uploader.uploadWithProgress(blob, settings?.teraboxCookie || '', data.fileName || 'video.mp4', onProgress, signal),
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

/**
 * Video upload services that can store the encrypted vault `.bin` blob.
 * Marked via `vaultBlobHost: true` on the service def. Filemoon is a video-only
 * host and rejects `.bin` files, so it is NOT a vault blob host — only hosts
 * that accept the opaque encrypted blob are eligible.
 * @returns {Array} services
 */
export function getVaultBlobHostServices() {
  return VIDEO_UPLOAD_SERVICES.filter((service) => service.vaultBlobHost)
}

/**
 * Selectable options (key + label) for the vault blob host picker, derived from
 * the catalog so future vault-capable hosts show up automatically.
 * @returns {Array<{key:string,label:string}>}
 */
export function getVaultBlobHostOptions() {
  return getVaultBlobHostServices().map(({ key, label }) => ({ key, label }))
}
