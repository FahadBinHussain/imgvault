import { DEFAULT_IMAGE_SOURCE, IMAGE_UPLOAD_SERVICES } from './providerCatalog.js';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

const parseObject = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
};

const pickText = (...values) => {
  const found = values.find(hasText);
  return found ? found.trim() : '';
};

export function getImageUploadService(key) {
  const normalized = String(key || '').trim().toLowerCase();
  return IMAGE_UPLOAD_SERVICES.find((service) => service.key === normalized) || null;
}

export function getImageProviderLabel(key) {
  return getImageUploadService(key)?.label || String(key || '').trim();
}

export function getStrictImageProviderLink(item, providerKey, field = 'url') {
  const link = getImageProviderLinks(item)?.[providerKey];
  if (!link) return '';
  if (field === 'thumbnailUrl') return pickText(link.thumbnailUrl, link.thumbUrl);
  return pickText(link[field], link.displayUrl, link.directUrl, link.url);
}

export function getImageProviderLinks(item = {}) {
  item = item && typeof item === 'object' ? item : {};
  const extra = parseObject(item.extraMetadata);
  const fromItem = parseObject(item.imageHosts);
  const fromExtra = parseObject(extra.imageHosts);
  const links = {};

  for (const service of IMAGE_UPLOAD_SERVICES) {
    const saved = {
      ...(fromExtra[service.key] || {}),
      ...(fromItem[service.key] || {}),
    };
    const url = pickText(saved.url, saved.displayUrl, saved.directUrl, item[service.urlField]);
    const displayUrl = pickText(saved.displayUrl, saved.url, item[service.urlField]);
    const directUrl = pickText(saved.directUrl, saved.url, item[service.urlField]);
    const deleteUrl = pickText(saved.deleteUrl, item[service.deleteUrlField]);
    const thumbnailUrl = pickText(saved.thumbnailUrl, saved.thumbUrl, item[service.thumbUrlField]);

    if (url || displayUrl || directUrl || deleteUrl || thumbnailUrl) {
      links[service.key] = {
        ...saved,
        url,
        displayUrl,
        directUrl,
        deleteUrl,
        thumbnailUrl,
      };
    }
  }

  return links;
}

export function getPreferredImageProviderLink(item, preferredProvider = DEFAULT_IMAGE_SOURCE, field = 'url') {
  return getPlayableImageProviderLink(item, preferredProvider, field).url;
}

/**
 * The image link to DISPLAY, playable-first like the video helper
 * (2.19.16): the preferred host is tried first, and only when it has no
 * link does the host that actually holds the file answer — with its name,
 * so the UI can say which host is serving the image instead of silently
 * showing another host's file. Images have no "playable" semantics, so
 * the only adaptation from the video shape is the field fallback
 * (url <- displayUrl <- directUrl); the { url, sourceKey, sourceLabel,
 * isPreferred } contract is identical.
 *
 * @returns {{url: string, sourceKey: string, sourceLabel: string, isPreferred: boolean}}
 */
export function getPlayableImageProviderLink(item, preferredProvider = DEFAULT_IMAGE_SOURCE, field = 'url') {
  const links = getImageProviderLinks(item);
  const preferred = String(preferredProvider || '').trim().toLowerCase();
  const orderedKeys = [
    preferred,
    ...IMAGE_UPLOAD_SERVICES.map((service) => service.key).filter((key) => key !== preferred),
  ];

  for (const key of orderedKeys) {
    if (!key) continue;
    const link = links[key];
    if (!link) continue;
    const value = pickText(
      link[field],
      field === 'thumbnailUrl' ? link.url : '',
      link.displayUrl,
      link.directUrl,
      link.url
    );
    if (!value) continue;
    const service = getImageUploadService(key);
    return {
      url: value,
      sourceKey: key,
      sourceLabel: service?.label || key,
      isPreferred: key === preferred,
    };
  }

  return { url: '', sourceKey: '', sourceLabel: '', isPreferred: false };
}

export function hasImageProviderLink(item, providerKey) {
  const link = getImageProviderLinks(item)[providerKey];
  return Boolean(link?.url || link?.displayUrl || link?.directUrl);
}

export function hasAnyImageProviderLink(item) {
  return Object.values(getImageProviderLinks(item)).some((link) => (
    link?.url || link?.displayUrl || link?.directUrl
  ));
}

export function getMissingImageUploadServices(item) {
  return IMAGE_UPLOAD_SERVICES.filter((service) => !hasImageProviderLink(item, service.key));
}

export function getImageRetrySourceCandidates(item, targetProviderKey) {
  const links = getImageProviderLinks(item);
  const candidates = [];

  for (const service of IMAGE_UPLOAD_SERVICES) {
    if (service.key === targetProviderKey) continue;
    const link = links[service.key];
    if (!link) continue;
    candidates.push(link.directUrl, link.url, link.displayUrl);
  }

  candidates.push(item?.sourceImageUrl);
  return candidates.filter(hasText);
}

export function buildImageProviderLinkFromResult(result = {}) {
  return {
    url: pickText(result.url, result.displayUrl, result.directUrl),
    displayUrl: pickText(result.displayUrl, result.url),
    directUrl: pickText(result.directUrl, result.url),
    deleteUrl: pickText(result.deleteUrl),
    thumbnailUrl: pickText(result.thumbnailUrl, result.thumbUrl),
    fileId: pickText(result.fileId, result.filecode),
    // telegram: the posted message id (delete + integrity listing need it);
    // pickText drops it for hosts that don't set one.
    messageId: pickText(result.messageId, result.message_id),
    filename: pickText(result.filename),
    apiStatus: pickText(result.apiStatus),
    apiMessage: pickText(result.apiMessage, result.apiResponse),
  };
}

export function mergeImageProviderResult(target, providerKey, result = {}) {
  const service = getImageUploadService(providerKey);
  if (!service || !result) return target;

  const next = { ...target };
  const providerLinks = getImageProviderLinks(next);
  const link = buildImageProviderLinkFromResult(result);
  providerLinks[service.key] = {
    ...(providerLinks[service.key] || {}),
    ...link,
  };
  next.imageHosts = providerLinks;

  if (service.urlField) next[service.urlField] = link.url || '';
  if (service.deleteUrlField) next[service.deleteUrlField] = link.deleteUrl || '';
  if (service.thumbUrlField) next[service.thumbUrlField] = link.thumbnailUrl || '';

  return next;
}

export function normalizeImageProviderLinksForStorage(item = {}) {
  const imageHosts = getImageProviderLinks(item);
  return Object.keys(imageHosts).length > 0 ? imageHosts : undefined;
}
