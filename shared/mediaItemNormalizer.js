import {
  MEDIA_KIND_IMAGE,
  MEDIA_KIND_LINK,
  MEDIA_KIND_VIDEO,
  getMediaItemKind,
  stripKnownTopLevelMediaFields,
} from './mediaFieldRegistry.js';

const isPlainObject = (value) => (
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value)
);

const parseObject = (value) => {
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return {};

  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
};

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

const pickText = (...values) => {
  const found = values.find(hasText);
  return found ? found.trim() : '';
};

const hasValue = (value) => value !== undefined && value !== null && value !== '';

const hasMeaningfulValue = (value) => {
  if (!hasValue(value)) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
};

const compactObject = (value) => Object.fromEntries(
  Object.entries(value).filter(([, entryValue]) => hasValue(entryValue))
);

const mergeProviderMaps = (...maps) => {
  const merged = {};

  for (const map of maps) {
    const source = parseObject(map);
    for (const [key, value] of Object.entries(source)) {
      merged[key] = {
        ...(merged[key] || {}),
        ...parseObject(value),
      };
    }
  }

  return merged;
};

const mergeProviderLink = (links, providerKey, values) => {
  const existing = parseObject(links[providerKey]);
  const next = {
    ...existing,
    ...compactObject(values),
  };

  if (Object.keys(next).length > 0) {
    links[providerKey] = next;
  }
};

export function normalizeImageHosts(item = {}, extra = parseObject(item.extraMetadata)) {
  const links = mergeProviderMaps(extra.imageHosts, item.imageHosts);

  mergeProviderLink(links, 'pixvid', {
    url: pickText(links.pixvid?.url, links.pixvid?.displayUrl, links.pixvid?.directUrl, item.pixvidUrl, extra.pixvidUrl),
    displayUrl: pickText(links.pixvid?.displayUrl, links.pixvid?.url, item.pixvidUrl, extra.pixvidUrl),
    directUrl: pickText(links.pixvid?.directUrl, links.pixvid?.url, item.pixvidUrl, extra.pixvidUrl),
    deleteUrl: pickText(links.pixvid?.deleteUrl, item.pixvidDeleteUrl, extra.pixvidDeleteUrl),
  });

  mergeProviderLink(links, 'imgbb', {
    url: pickText(links.imgbb?.url, links.imgbb?.displayUrl, links.imgbb?.directUrl, item.imgbbUrl, extra.imgbbUrl),
    displayUrl: pickText(links.imgbb?.displayUrl, links.imgbb?.url, item.imgbbUrl, extra.imgbbUrl),
    directUrl: pickText(links.imgbb?.directUrl, links.imgbb?.url, item.imgbbUrl, extra.imgbbUrl),
    deleteUrl: pickText(links.imgbb?.deleteUrl, item.imgbbDeleteUrl, extra.imgbbDeleteUrl),
    thumbnailUrl: pickText(links.imgbb?.thumbnailUrl, links.imgbb?.thumbUrl, item.imgbbThumbUrl, extra.imgbbThumbUrl),
  });

  return links;
}

export function normalizeVideoHosts(item = {}, extra = parseObject(item.extraMetadata)) {
  const links = mergeProviderMaps(extra.videoHosts, item.videoHosts);

  mergeProviderLink(links, 'filemoon', {
    watchUrl: pickText(links.filemoon?.watchUrl, links.filemoon?.displayUrl, links.filemoon?.url, item.filemoonWatchUrl, item.filemoonUrl, extra.filemoonWatchUrl, extra.filemoonUrl),
    directUrl: pickText(links.filemoon?.directUrl, links.filemoon?.downloadUrl, item.filemoonDirectUrl, extra.filemoonDirectUrl),
    deleteUrl: pickText(links.filemoon?.deleteUrl, item.filemoonDeleteUrl, extra.filemoonDeleteUrl),
    thumbnailUrl: pickText(links.filemoon?.thumbnailUrl, links.filemoon?.thumbUrl, item.filemoonThumbUrl, extra.filemoonThumbUrl),
  });

  mergeProviderLink(links, 'udrop', {
    watchUrl: pickText(links.udrop?.watchUrl, links.udrop?.displayUrl, links.udrop?.url, item.udropWatchUrl, item.udropUrl, extra.udropWatchUrl, extra.udropUrl),
    directUrl: pickText(links.udrop?.directUrl, links.udrop?.downloadUrl, item.udropDirectUrl, extra.udropDirectUrl),
    deleteUrl: pickText(links.udrop?.deleteUrl, item.udropDeleteUrl, extra.udropDeleteUrl),
    thumbnailUrl: pickText(links.udrop?.thumbnailUrl, links.udrop?.thumbUrl, item.udropThumbUrl, extra.udropThumbUrl),
  });

  return links;
}

const applyLegacyProviderAliases = (item) => {
  const next = { ...item };
  const imageHosts = parseObject(next.imageHosts);
  const videoHosts = parseObject(next.videoHosts);

  const pixvid = parseObject(imageHosts.pixvid);
  next.pixvidUrl = pickText(next.pixvidUrl, pixvid.url, pixvid.displayUrl, pixvid.directUrl);
  next.pixvidDeleteUrl = pickText(next.pixvidDeleteUrl, pixvid.deleteUrl);

  const imgbb = parseObject(imageHosts.imgbb);
  next.imgbbUrl = pickText(next.imgbbUrl, imgbb.url, imgbb.displayUrl, imgbb.directUrl);
  next.imgbbDeleteUrl = pickText(next.imgbbDeleteUrl, imgbb.deleteUrl);
  next.imgbbThumbUrl = pickText(next.imgbbThumbUrl, imgbb.thumbnailUrl, imgbb.thumbUrl);

  const filemoon = parseObject(videoHosts.filemoon);
  next.filemoonWatchUrl = pickText(next.filemoonWatchUrl, filemoon.watchUrl, filemoon.displayUrl, filemoon.url);
  next.filemoonDirectUrl = pickText(next.filemoonDirectUrl, filemoon.directUrl, filemoon.downloadUrl);
  next.filemoonUrl = pickText(next.filemoonUrl, next.filemoonWatchUrl);

  const udrop = parseObject(videoHosts.udrop);
  next.udropWatchUrl = pickText(next.udropWatchUrl, udrop.watchUrl, udrop.displayUrl, udrop.url);
  next.udropDirectUrl = pickText(next.udropDirectUrl, udrop.directUrl, udrop.downloadUrl);
  next.udropUrl = pickText(next.udropUrl, next.udropWatchUrl);

  return next;
};

export function normalizeMediaItem(item = {}, options = {}) {
  const { preserveLegacyAliases = true } = options;
  const raw = isPlainObject(item) ? item : {};
  const extra = parseObject(raw.extraMetadata);
  const normalized = {
    ...extra,
    ...raw,
  };

  for (const [key, value] of Object.entries(extra)) {
    if (!hasMeaningfulValue(raw[key]) && hasMeaningfulValue(value)) {
      normalized[key] = value;
    }
  }

  const ai = parseObject(raw.ai || extra.ai);
  delete normalized.ai;

  normalized.imageHosts = normalizeImageHosts(normalized, extra);
  normalized.videoHosts = normalizeVideoHosts(normalized, extra);

  if (Object.keys(normalized.imageHosts).length === 0) {
    delete normalized.imageHosts;
  }
  if (Object.keys(normalized.videoHosts).length === 0) {
    delete normalized.videoHosts;
  }

  const kind = getMediaItemKind(normalized);
  normalized.kind = kind;
  if (kind === MEDIA_KIND_VIDEO) normalized.isVideo = true;
  if (kind === MEDIA_KIND_LINK) normalized.isLink = true;
  if (kind === MEDIA_KIND_IMAGE && !hasValue(normalized.isVideo)) normalized.isVideo = false;
  if (kind !== MEDIA_KIND_LINK && !hasValue(normalized.isLink)) normalized.isLink = false;

  if (!Array.isArray(normalized.tags)) {
    normalized.tags = Array.isArray(extra.tags) ? extra.tags : [];
  }
  if (!Object.prototype.hasOwnProperty.call(normalized, 'collectionId')) {
    normalized.collectionId = null;
  }

  const normalizedExtra = stripKnownTopLevelMediaFields(extra);
  if (Object.keys(ai).length > 0) {
    normalizedExtra.ai = ai;
  }
  normalized.extraMetadata = normalizedExtra;

  return preserveLegacyAliases
    ? applyLegacyProviderAliases(normalized)
    : normalized;
}

export function normalizeMediaItems(items = [], options = {}) {
  return Array.isArray(items)
    ? items.map((item) => normalizeMediaItem(item, options))
    : [];
}
