// runtime layer over the shared catalog (platform parity phase 2).
// metadata + pure helpers live in imgvault-shared/providerCatalog.js (single source of
// truth — drift guard: tools/check-shared-twins.mjs). This file ONLY binds extension
// runtime onto the shared entries: uploader classes, upload adapters, vault URL regen.
import { FilemoonUploader, UDropUploader, TeraBoxUploader, TelegramUploader } from '../utils/uploaders.js';
import { resolveTeraBoxPlaybackUrl } from '../utils/teraBoxApi.js';
import {
  DEFAULT_IMAGE_SOURCE,
  DEFAULT_VIDEO_SOURCE,
  DEFAULT_3D_SOURCE,
  DEFAULT_VAULT_BLOB_HOST,
  IMAGE_UPLOAD_SERVICES as IMAGE_UPLOAD_SERVICES_META,
  VIDEO_UPLOAD_SERVICES as VIDEO_UPLOAD_SERVICES_META,
  IMAGE_SOURCE_OPTIONS,
  VIDEO_SOURCE_OPTIONS,
  THREE_D_SOURCE_OPTIONS,
  THREE_D_HOST_KEYS,
  filterUploadServicesByKeys,
  getMissingRequiredImageUploadServices,
  normalizeVaultBlobHostKeys,
  getVaultBlobHostServices as getVaultBlobHostServicesFromCatalog,
  assertVaultBlobHostSizes,
  buildVaultBlobCopy,
  getConfiguredServices,
} from 'imgvault-shared/providerCatalog.js';

// per-host extension runtime. uploaderKey stays in the shared metadata (it names the
// background's uploader instance property); everything here is behavior only.
const hasText = (value) => String(value || '').trim().length > 0;

// telegram needs BOTH settings (token + channel) and a best-available filename:
// image uploads arrive as `data` without fileName, videos always carry it.
const telegramUploadOptions = (settings, data, blob, onProgress, signal) => ({
  token: settings?.telegramBotToken,
  channel: settings?.telegramChannel,
  filename:
    data?.fileName ||
    String(data?.filePath || '').split(/[\\/]/).pop() ||
    (blob?.type?.startsWith('image/') ? 'image' : 'file'),
  mimeType: data?.mimeType || blob?.type || '',
  ...(onProgress ? { onProgress } : {}),
  ...(signal ? { signal } : {}),
});

const RUNTIME_BY_KEY = {
  pixvid: {
    upload: ({ uploader, blob, settings, data, signal }) =>
      uploader.upload(blob, settings.pixvidApiKey, data.imageUrl, signal),
  },
  imgbb: {
    upload: ({ uploader, blob, settings, signal }) =>
      uploader.upload(blob, settings.imgbbApiKey, signal),
  },
  filemoon: {
    uploaderClass: FilemoonUploader,
    upload: ({ uploader, blob, settings, data, signal }) =>
      uploader.upload(blob, settings.filemoonApiKey, data.fileName || 'video.mp4', signal),
    uploadWithProgress: ({ uploader, blob, settings, data, onProgress, signal }) =>
      uploader.uploadWithProgress(blob, settings.filemoonApiKey, data.fileName || 'video.mp4', onProgress, signal),
  },
  udrop: {
    uploaderClass: UDropUploader,
    upload: ({ uploader, blob, settings, data, signal }) =>
      uploader.upload(blob, settings.udropKey1, settings.udropKey2, data.fileName || 'video.mp4', signal),
    uploadWithProgress: ({ uploader, blob, settings, data, onProgress, signal }) =>
      uploader.uploadWithProgress(blob, settings.udropKey1, settings.udropKey2, data.fileName || 'video.mp4', onProgress, signal),
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
  },
  terabox: {
    uploaderClass: TeraBoxUploader,
    upload: ({ uploader, blob, settings, data, signal }) =>
      uploader.upload(blob, settings?.teraboxCookie || '', data.fileName || 'video.mp4', signal),
    uploadWithProgress: ({ uploader, blob, settings, data, onProgress, signal }) =>
      uploader.uploadWithProgress(blob, settings?.teraboxCookie || '', data.fileName || 'video.mp4', onProgress, signal),
    vaultDownloadUrl: async ({ url, fileId, fileName, settings }) => {
      try {
        const fresh = await resolveTeraBoxPlaybackUrl(settings?.teraboxCookie || '', fileId, fileName);
        return fresh || url;
      } catch (_) {
        return url;
      }
    },
  },
  telegram: {
    uploaderClass: TelegramUploader,
    upload: ({ uploader, blob, settings, data, signal }) =>
      uploader.upload(blob, telegramUploadOptions(settings, data, blob, null, signal)),
    uploadWithProgress: ({ uploader, blob, settings, data, onProgress, signal }) =>
      uploader.uploadWithProgress(blob, telegramUploadOptions(settings, data, blob, onProgress, signal)),
  },
};

const attachRuntime = (services) => services.map((service) => (
  RUNTIME_BY_KEY[service.key] ? { ...service, ...RUNTIME_BY_KEY[service.key] } : service
));

export const IMAGE_UPLOAD_SERVICES = attachRuntime(IMAGE_UPLOAD_SERVICES_META);
export const VIDEO_UPLOAD_SERVICES = attachRuntime(VIDEO_UPLOAD_SERVICES_META);

export {
  DEFAULT_IMAGE_SOURCE,
  DEFAULT_VIDEO_SOURCE,
  DEFAULT_3D_SOURCE,
  DEFAULT_VAULT_BLOB_HOST,
  IMAGE_SOURCE_OPTIONS,
  VIDEO_SOURCE_OPTIONS,
  THREE_D_SOURCE_OPTIONS,
  THREE_D_HOST_KEYS,
  filterUploadServicesByKeys,
  getMissingRequiredImageUploadServices,
  normalizeVaultBlobHostKeys,
  assertVaultBlobHostSizes,
  buildVaultBlobCopy,
};

export function getConfiguredImageUploadServices(settings) {
  return getConfiguredServices(IMAGE_UPLOAD_SERVICES, settings);
}

export function getConfiguredVideoUploadServices(settings) {
  return getConfiguredServices(VIDEO_UPLOAD_SERVICES, settings);
}

export function getVaultBlobHostServices() {
  return getVaultBlobHostServicesFromCatalog(VIDEO_UPLOAD_SERVICES);
}

export function getVaultBlobHostOptions() {
  return getVaultBlobHostServices().map(({ key, label }) => ({ key, label }));
}

export function getImageUploadService(key) {
  const normalized = String(key || '').trim().toLowerCase();
  return IMAGE_UPLOAD_SERVICES.find((service) => service.key === normalized) || null;
}

export const getImageProviderLabel = (key) => getImageUploadService(key)?.label || String(key || '').trim();

export function getVideoUploadService(key) {
  const normalized = String(key || '').trim().toLowerCase();
  return VIDEO_UPLOAD_SERVICES.find((service) => service.key === normalized) || null;
}

export const getVideoProviderLabel = (key) => getVideoUploadService(key)?.label || String(key || '').trim();
