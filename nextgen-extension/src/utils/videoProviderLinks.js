import { DEFAULT_VIDEO_SOURCE, VIDEO_UPLOAD_SERVICES } from '../config/providerCatalog.js';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

const pickText = (...values) => {
  const found = values.find(hasText);
  return found ? found.trim() : '';
};

export function getVideoUploadService(key) {
  const normalized = String(key || '').trim().toLowerCase();
  return VIDEO_UPLOAD_SERVICES.find((service) => service.key === normalized) || null;
}

export function getVideoProviderLabel(key) {
  return getVideoUploadService(key)?.label || String(key || '').trim();
}

export function getConfiguredVideoUploadServices(settings) {
  return VIDEO_UPLOAD_SERVICES.filter((service) => service.isConfigured(settings));
}

export function getVideoProviderLinks(item = {}) {
  item = item && typeof item === 'object' ? item : {};
  const extra = item.extraMetadata && typeof item.extraMetadata === 'object' ? item.extraMetadata : {};
  const fromItem = item.videoHosts && typeof item.videoHosts === 'object' ? item.videoHosts : {};
  const fromExtra = extra.videoHosts && typeof extra.videoHosts === 'object' ? extra.videoHosts : {};
  const links = {};

  for (const service of VIDEO_UPLOAD_SERVICES) {
    const saved = {
      ...(fromExtra[service.key] || {}),
      ...(fromItem[service.key] || {}),
    };
    const watchUrl = pickText(saved.watchUrl, saved.displayUrl, saved.url, item[service.watchUrlField], item[service.aliasWatchUrlField]);
    const directUrl = pickText(saved.directUrl, saved.downloadUrl, item[service.directUrlField]);
    const deleteUrl = pickText(saved.deleteUrl);
    const thumbnailUrl = pickText(saved.thumbnailUrl, saved.thumbUrl);

    if (watchUrl || directUrl || deleteUrl || thumbnailUrl) {
      links[service.key] = {
        ...saved,
        watchUrl,
        directUrl,
        deleteUrl,
        thumbnailUrl,
      };
    }
  }

  return links;
}

export function hasVideoProviderLink(item, providerKey) {
  const link = getVideoProviderLinks(item)[providerKey];
  return Boolean(link?.watchUrl || link?.directUrl);
}

export function hasAnyVideoProviderLink(item) {
  return Object.values(getVideoProviderLinks(item)).some((link) => link.watchUrl || link.directUrl);
}

export function getPreferredVideoProviderLink(item, preferredProvider = DEFAULT_VIDEO_SOURCE, field = 'watchUrl') {
  const links = getVideoProviderLinks(item);
  const orderedKeys = [
    preferredProvider,
    ...VIDEO_UPLOAD_SERVICES.map((service) => service.key).filter((key) => key !== preferredProvider),
  ];

  for (const key of orderedKeys) {
    const link = links[key];
    if (!link) continue;
    const value = pickText(link[field], field === 'watchUrl' ? link.directUrl : link.watchUrl);
    if (value) return value;
  }

  return '';
}

export function getMissingVideoUploadServices(item) {
  return VIDEO_UPLOAD_SERVICES.filter((service) => !hasVideoProviderLink(item, service.key));
}

export function getVideoRetrySourceCandidates(item, targetProviderKey) {
  const links = getVideoProviderLinks(item);
  const candidates = [];

  for (const service of VIDEO_UPLOAD_SERVICES) {
    if (service.key === targetProviderKey) continue;
    const link = links[service.key];
    if (!link) continue;
    candidates.push(link.directUrl, link.watchUrl);
  }

  candidates.push(item?.sourceImageUrl);
  return candidates.filter(hasText);
}

export function buildVideoProviderLinkFromResult(result = {}) {
  return {
    watchUrl: pickText(result.watchUrl, result.displayUrl, result.url),
    directUrl: pickText(result.directUrl, result.downloadUrl),
    deleteUrl: pickText(result.deleteUrl),
    thumbnailUrl: pickText(result.thumbnailUrl, result.thumbUrl),
    fileId: pickText(result.fileId, result.filecode),
    shortUrl: pickText(result.shortUrl),
    accountId: pickText(result.accountId),
    filename: pickText(result.filename),
    apiStatus: pickText(result.apiStatus),
    apiMessage: pickText(result.apiMessage, result.apiResponse),
  };
}

export function mergeVideoProviderResult(target, providerKey, result = {}) {
  const service = getVideoUploadService(providerKey);
  if (!service || !result) return target;

  const next = { ...target };
  const providerLinks = getVideoProviderLinks(next);
  const link = buildVideoProviderLinkFromResult(result);
  providerLinks[service.key] = {
    ...(providerLinks[service.key] || {}),
    ...link,
  };
  next.videoHosts = providerLinks;

  if (service.watchUrlField) next[service.watchUrlField] = link.watchUrl || '';
  if (service.directUrlField) next[service.directUrlField] = link.directUrl || '';
  if (service.aliasWatchUrlField) next[service.aliasWatchUrlField] = link.watchUrl || '';

  return next;
}

export function normalizeVideoProviderLinksForStorage(item = {}) {
  const videoHosts = getVideoProviderLinks(item);
  return Object.keys(videoHosts).length > 0 ? videoHosts : undefined;
}
