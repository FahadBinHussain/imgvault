import {
  MEDIA_KIND_IMAGE,
  MEDIA_KIND_SYSTEM,
  stripKnownTopLevelMediaFields,
} from './mediaFieldRegistry.js';
import {
  normalizeImageHosts,
  normalizeMediaItem,
  normalizeVideoHosts,
} from './mediaItemNormalizer.js';

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

export function asText(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

export function asNullableText(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

export function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

export function asInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function asFloat(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function asIsoOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function asTags(value) {
  return Array.isArray(value) ? value.map((tag) => String(tag)) : [];
}

export function canonicalizeLinkUrl(input = '') {
  const raw = String(input || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const params = new URLSearchParams(url.search);
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid']) {
      params.delete(key);
    }
    const query = params.toString();
    return `${url.protocol}//${host}${url.pathname}${query ? `?${query}` : ''}`;
  } catch (_) {
    return raw;
  }
}

// Which side of the row did this write actually touch? `fromNeonMediaRow` mirrors
// every stored extra key top-level AND hands `extraMetadata` back, so both copies
// always ride along in `source` and neither presence alone means "the caller
// changed it". The caller has to pass the row it read as `existing` for the delta
// to mean anything; with no `existing` (create paths) every key is new anyway.
function getTopLevelWrites(source, existing) {
  return new Set(
    Object.keys(source).filter(
      (key) => key !== 'extraMetadata' && source[key] !== existing[key]
    )
  );
}

function getExtraWrites(source, existing) {
  const sourceExtra = parseObject(source.extraMetadata);
  const existingExtra = parseObject(existing.extraMetadata);
  const topLevelWrites = getTopLevelWrites(source, existing);
  const writes = {};

  for (const [key, value] of Object.entries(sourceExtra)) {
    // a write on the top-level field itself still wins over the extra copy
    // (2.12.1: `isVaulted: false` has to clear the stale extra flag)
    if (topLevelWrites.has(key)) continue;
    if (value === existingExtra[key]) continue;
    writes[key] = value;
  }

  return writes;
}

function buildExtraSeed(source, existing) {
  const mergedWithoutExtra = { ...existing, ...source };
  delete mergedWithoutExtra.extraMetadata;

  // A changed extra key wins over the untouched top-level mirror, or the stale
  // mirror silently eats the write (bit videoHosts, sceneFiles,
  // encryptedBlobMessageId).
  return {
    ...parseObject(existing.extraMetadata),
    ...mergedWithoutExtra,
    ...getExtraWrites(source, existing),
  };
}

export function toMediaDbPayload(source = {}, options = {}) {
  const {
    existing = {},
    fallbackTimestamp = null,
    forceDeleted = false,
    ensureExtraMetadata = null,
  } = options;
  const merged = { ...existing, ...source };
  const extraSeed = buildExtraSeed(source, existing);
  const extraWrites = getExtraWrites(source, existing);

  // the host maps merge against the row's mirrored map field-by-field, so a
  // freshly written map must replace that mirror too. The top-level provider
  // columns still merge back in inside normalize*Hosts.
  for (const key of ['imageHosts', 'videoHosts']) {
    if (Object.prototype.hasOwnProperty.call(extraWrites, key)) merged[key] = extraWrites[key];
  }

  const normalized = normalizeMediaItem({
    ...merged,
    extraMetadata: extraSeed,
  });
  const isSystem = normalized.kind === MEDIA_KIND_SYSTEM;
  const dbKind = isSystem ? MEDIA_KIND_IMAGE : normalized.kind;
  const linkUrl = asText(normalized.linkUrl);
  const imageHosts = normalizeImageHosts(normalized, extraSeed);
  const videoHosts = normalizeVideoHosts(normalized, extraSeed);
  const deletedAtFromSource = asIsoOrNull(normalized.deletedAt);
  const deletedAt = forceDeleted
    ? (deletedAtFromSource || fallbackTimestamp || new Date().toISOString())
    : deletedAtFromSource;
  const internalAddedTimestamp =
    asIsoOrNull(normalized.internalAddedTimestamp) ||
    fallbackTimestamp ||
    new Date().toISOString();
  const normalizedExtra = isPlainObject(normalized.extraMetadata)
    ? normalized.extraMetadata
    : {};

  let extraMetadata = {
    ...stripKnownTopLevelMediaFields(normalizedExtra),
    ...(isPlainObject(normalizedExtra.ai) ? { ai: normalizedExtra.ai } : {}),
    ...(Object.keys(imageHosts).length > 0 ? { imageHosts } : {}),
    ...(Object.keys(videoHosts).length > 0 ? { videoHosts } : {}),
  };

  if (typeof ensureExtraMetadata === 'function') {
    extraMetadata = ensureExtraMetadata(extraMetadata, {
      kind: isSystem ? MEDIA_KIND_SYSTEM : dbKind,
      dbKind,
      isSystem,
    });
  }

  return {
    kind: dbKind,
    isVideo: isSystem ? false : dbKind === 'video',
    isLink: isSystem ? false : dbKind === 'link',
    pageTitle: asText(normalized.pageTitle),
    description: asText(normalized.description),
    tags: asTags(normalized.tags),
    collectionId: Object.prototype.hasOwnProperty.call(normalized, 'collectionId')
      ? asNullableText(normalized.collectionId)
      : null,
    internalAddedTimestamp,
    sourceImageUrl: asText(normalized.sourceImageUrl),
    sourcePageUrl: asText(normalized.sourcePageUrl),
    fileName: asText(normalized.fileName),
    fileSize: asInt(normalized.fileSize),
    width: asInt(normalized.width),
    height: asInt(normalized.height),
    duration: asFloat(normalized.duration),
    fileType: asText(normalized.fileType),
    fileTypeSource: asText(normalized.fileTypeSource),
    creationDate: asIsoOrNull(normalized.creationDate),
    creationDateSource: asText(normalized.creationDateSource),
    sha256: asText(normalized.sha256),
    pHash: asText(normalized.pHash),
    aHash: asText(normalized.aHash),
    dHash: asText(normalized.dHash),
    exifMetadata: isPlainObject(normalized.exifMetadata) ? normalized.exifMetadata : null,
    extraMetadata,
    pixvidUrl: asText(normalized.pixvidUrl),
    pixvidDeleteUrl: asText(normalized.pixvidDeleteUrl),
    imgbbUrl: asText(normalized.imgbbUrl),
    imgbbDeleteUrl: asText(normalized.imgbbDeleteUrl),
    imgbbThumbUrl: asText(normalized.imgbbThumbUrl),
    filemoonWatchUrl: asText(normalized.filemoonWatchUrl),
    filemoonDirectUrl: asText(normalized.filemoonDirectUrl),
    udropWatchUrl: asText(normalized.udropWatchUrl),
    udropDirectUrl: asText(normalized.udropDirectUrl),
    spzUrl: asText(normalized.spzUrl),
    spzFileSize: asInt(normalized.spzFileSize),
    textureUrl: asText(normalized.textureUrl),
    textureFileSize: asInt(normalized.textureFileSize),
    configJson: asText(normalized.configJson),
    linkUrl,
    linkUrlCanonical: asText(normalized.linkUrlCanonical) || canonicalizeLinkUrl(linkUrl || normalized.sourcePageUrl || ''),
    linkPreviewImageUrl: asText(normalized.linkPreviewImageUrl),
    faviconUrl: asText(normalized.faviconUrl),
    lastVisitedAt: asIsoOrNull(normalized.lastVisitedAt),
    deletedAt,
  };
}
