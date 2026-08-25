export const MEDIA_KIND_IMAGE = 'image';
export const MEDIA_KIND_VIDEO = 'video';
export const MEDIA_KIND_LINK = 'link';
export const MEDIA_KIND_SCENE = 'scene';
export const MEDIA_KIND_SYSTEM = 'system';

export const VAULT_CONFIG_ITEM_ID = '__imgvault_vault_config__';
export const VAULT_CONFIG_SYSTEM_TYPE = 'secretVaultConfig';

const IMAGE_BASE_FIELD_KEYS = [
  'pixvidUrl',
  'pixvidDeleteUrl',
  'imgbbUrl',
  'imgbbDeleteUrl',
  'imgbbThumbUrl',
  'imageHosts',
  'sourceImageUrl',
  'sourcePageUrl',
  'pageTitle',
  'fileName',
  'fileSize',
  'width',
  'height',
  'fileType',
  'fileTypeSource',
  'creationDate',
  'creationDateSource',
  'internalAddedTimestamp',
  'tags',
  'description',
  'collectionId',
];

const VIDEO_BASE_FIELD_KEYS = [
  'sourceImageUrl',
  'sourcePageUrl',
  'pageTitle',
  'fileName',
  'fileSize',
  'fileType',
  'fileTypeSource',
  'creationDate',
  'creationDateSource',
  'internalAddedTimestamp',
  'duration',
  'width',
  'height',
  'tags',
  'description',
  'collectionId',
  'isVideo',
  'videoHosts',
  'filemoonWatchUrl',
  'filemoonDirectUrl',
  'udropWatchUrl',
  'udropDirectUrl',
];

const LINK_BASE_FIELD_KEYS = [
  'linkUrl',
  'pageTitle',
  'description',
  'tags',
  'collectionId',
  'internalAddedTimestamp',
  'faviconUrl',
  'linkPreviewImageUrl',
  'lastVisitedAt',
  'isLink',
];

const SCENE_BASE_FIELD_KEYS = [
  'spzUrl',
  'spzFileSize',
  'textureUrl',
  'textureFileSize',
  'configJson',
  'sourcePageUrl',
  'pageTitle',
  'fileName',
  'fileSize',
  'fileType',
  'fileTypeSource',
  'creationDate',
  'creationDateSource',
  'internalAddedTimestamp',
  'tags',
  'description',
  'collectionId',
];

const TECHNICAL_FIELD_KEYS = [
  'sha256',
  'pHash',
  'aHash',
  'dHash',
  'exifMetadata',
];

const SYSTEM_FIELD_KEYS = [
  'id',
  'kind',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'linkUrlCanonical',
  'extraMetadata',
  'isVaulted',
  'vaultMode',
  'vaultedAt',
  '_isTrash',
];

const AI_METADATA_FIELD_KEYS = [
  'schemaVersion',
  'status',
  'generatedAt',
  'provider',
  'model',
  'promptVersion',
  'confidence',
  'analysis',
];

const AI_ANALYSIS_FIELD_KEYS = [
  'caption',
  'description',
  'objects',
  'dominantObjects',
  'scene',
  'tags',
  'tagsConfidence',
  'containsPeople',
  'peopleCount',
  'possibleActivity',
  'mood',
  'weather',
  'orientation',
  'estimatedLocation',
  'timeOfDay',
  'colors',
  'photoQuality',
  'ocr',
  'safety',
];

export const MEDIA_FIELD_REGISTRY = Object.freeze({
  [MEDIA_KIND_IMAGE]: Object.freeze({
    label: 'Image',
    base: Object.freeze([...IMAGE_BASE_FIELD_KEYS]),
  }),
  [MEDIA_KIND_VIDEO]: Object.freeze({
    label: 'Video',
    base: Object.freeze([...VIDEO_BASE_FIELD_KEYS]),
  }),
  [MEDIA_KIND_LINK]: Object.freeze({
    label: 'Link',
    base: Object.freeze([...LINK_BASE_FIELD_KEYS]),
  }),
  [MEDIA_KIND_SCENE]: Object.freeze({
    label: '3D Scene',
    base: Object.freeze([...SCENE_BASE_FIELD_KEYS]),
  }),
  technical: Object.freeze({
    label: 'Technical',
    base: Object.freeze([...TECHNICAL_FIELD_KEYS]),
  }),
  system: Object.freeze({
    label: 'System',
    base: Object.freeze([...SYSTEM_FIELD_KEYS]),
  }),
  ai: Object.freeze({
    label: 'AI',
    namespace: 'extraMetadata.ai',
    base: Object.freeze([...AI_METADATA_FIELD_KEYS]),
    analysis: Object.freeze([...AI_ANALYSIS_FIELD_KEYS]),
  }),
});

const isPlainObject = (value) => (
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value)
);

const EXPLICIT_MEDIA_KINDS = new Set([
  MEDIA_KIND_IMAGE,
  MEDIA_KIND_VIDEO,
  MEDIA_KIND_LINK,
  MEDIA_KIND_SCENE,
  MEDIA_KIND_SYSTEM,
]);

export function getExtraMetadata(item = {}) {
  return isPlainObject(item?.extraMetadata) ? item.extraMetadata : {};
}

export function isTruthyFlag(value) {
  if (value === true || value === 1 || value === '1') return true;
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

export function hasAnyVideoProviderLink(item = {}) {
  const safeItem = item && typeof item === 'object' ? item : {};
  const extra = getExtraMetadata(safeItem);
  const videoHosts = isPlainObject(safeItem.videoHosts)
    ? safeItem.videoHosts
    : (isPlainObject(extra.videoHosts) ? extra.videoHosts : {});

  return Boolean(
    safeItem.filemoonWatchUrl ||
    safeItem.filemoonDirectUrl ||
    safeItem.filemoonUrl ||
    safeItem.udropWatchUrl ||
    safeItem.udropDirectUrl ||
    safeItem.udropUrl ||
    Object.values(videoHosts).some((host) => (
      isPlainObject(host) &&
      (host.watchUrl || host.directUrl)
    ))
  );
}

export function getMediaItemKind(item = {}) {
  if (isSystemMediaItem(item)) return MEDIA_KIND_SYSTEM;
  const explicitKind = typeof item?.kind === 'string' ? item.kind.trim().toLowerCase() : '';
  const fileType = typeof item?.fileType === 'string' ? item.fileType.trim().toLowerCase() : '';
  const hasVideoLinks = hasAnyVideoProviderLink(item);

  if (explicitKind === MEDIA_KIND_LINK || explicitKind === MEDIA_KIND_SYSTEM) return explicitKind;
  if (explicitKind === MEDIA_KIND_IMAGE) return MEDIA_KIND_IMAGE;
  if (explicitKind === MEDIA_KIND_SCENE) return MEDIA_KIND_SCENE;
  if (explicitKind === MEDIA_KIND_VIDEO) {
    return fileType.startsWith('image/') && !hasVideoLinks
      ? MEDIA_KIND_IMAGE
      : MEDIA_KIND_VIDEO;
  }

  if (isTruthyFlag(item?.isLink) || item?.linkUrl) return MEDIA_KIND_LINK;
  if (item?.spzUrl) return MEDIA_KIND_SCENE;
  if (fileType.startsWith('image/') && !hasVideoLinks) return MEDIA_KIND_IMAGE;
  if (
    isTruthyFlag(item?.isVideo) ||
    fileType.startsWith('video/') ||
    item?.duration ||
    hasVideoLinks
  ) {
    return MEDIA_KIND_VIDEO;
  }
  return MEDIA_KIND_IMAGE;
}

export function getBaseFieldKeys(kindOrItem = MEDIA_KIND_IMAGE) {
  const kind = typeof kindOrItem === 'string'
    ? kindOrItem
    : getMediaItemKind(kindOrItem);

  return MEDIA_FIELD_REGISTRY[kind]?.base
    ? [...MEDIA_FIELD_REGISTRY[kind].base]
    : [...MEDIA_FIELD_REGISTRY[MEDIA_KIND_IMAGE].base];
}

export function getAllBaseFieldKeys() {
  return [
    ...MEDIA_FIELD_REGISTRY[MEDIA_KIND_IMAGE].base,
    ...MEDIA_FIELD_REGISTRY[MEDIA_KIND_VIDEO].base,
    ...MEDIA_FIELD_REGISTRY[MEDIA_KIND_LINK].base,
    ...MEDIA_FIELD_REGISTRY[MEDIA_KIND_SCENE].base,
  ];
}

export function getTechnicalFieldKeys() {
  return [...MEDIA_FIELD_REGISTRY.technical.base];
}

export function getSystemFieldKeys() {
  return [...MEDIA_FIELD_REGISTRY.system.base];
}

export function getAiMetadataFieldKeys() {
  return [...MEDIA_FIELD_REGISTRY.ai.base];
}

export function getAiAnalysisFieldKeys() {
  return [...MEDIA_FIELD_REGISTRY.ai.analysis];
}

export function isSystemMediaItem(item = {}) {
  const extra = getExtraMetadata(item);
  return (
    item?.id === VAULT_CONFIG_ITEM_ID ||
    String(item?.id || '').startsWith('__imgvault_') ||
    item?.systemType === VAULT_CONFIG_SYSTEM_TYPE ||
    extra.systemType === VAULT_CONFIG_SYSTEM_TYPE
  );
}

export function hasRenderableFieldValue(value) {
  if (value === false) return false;
  return value !== undefined && value !== null && value !== '';
}

export function getTechnicalMetadataEntries(item = {}, options = {}) {
  const {
    omittedFields = [],
    includeExtraMetadata = false,
    includeAi = false,
  } = options;
  const omitted = new Set(omittedFields);
  const excluded = new Set([
    ...getAllBaseFieldKeys(),
    ...getSystemFieldKeys(),
    ...(includeExtraMetadata ? [] : ['extraMetadata']),
    ...(includeAi ? [] : ['ai']),
  ]);

  return Object.entries(item || {})
    .filter(([key, value]) => key !== 'id')
    .filter(([key]) => !excluded.has(key))
    .filter(([key]) => !omitted.has(key))
    .filter(([, value]) => hasRenderableFieldValue(value))
    .sort(([a], [b]) => a.localeCompare(b));
}

export function getDisplayFieldKeys(item = {}, options = {}) {
  const { omittedFields = [] } = options;
  const omitted = new Set(omittedFields);
  return getBaseFieldKeys(item).filter((field) => !omitted.has(field));
}

const parseNestedObject = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
};

const getNestedHosts = (item = {}, key) => {
  const extra = parseNestedObject(item.extraMetadata);
  const merged = {
    ...parseNestedObject(extra[key]),
    ...parseNestedObject(item[key]),
  };
  return Object.fromEntries(
    Object.entries(merged).filter(([, saved]) => (
      saved && typeof saved === 'object' && !Array.isArray(saved)
    ))
  );
};

// Overview rows for the details panel: base registry fields present on the
// item, plus provider URLs that only live nested (imageHosts / videoHosts /
// legacy filemoonUrl-udropUrl) so every item surfaces its URL even when the
// top-level mirror fields are missing. extraKeys lets callers add page-specific
// fields (deletedAt, vaultedAt, ...).
export function getOverviewEntries(item = {}, options = {}) {
  const { extraKeys = [] } = options;
  const itemObj = item && typeof item === 'object' ? item : {};
  const entries = [];
  const seen = new Set();
  const baseKeys = [...new Set([...getBaseFieldKeys(itemObj), ...extraKeys])];

  for (const key of baseKeys) {
    if (Object.prototype.hasOwnProperty.call(itemObj, key)) {
      entries.push({ key, value: itemObj[key] });
      seen.add(key);
    }
  }

  const normalizedOwnFields = new Set(
    Object.keys(itemObj).map((key) => key.toLowerCase().replace(/\./g, ''))
  );
  const add = (key, value) => {
    if (typeof value !== 'string' || !value.trim()) return;
    if (seen.has(key)) return;
    // Skip nested URLs whose top-level mirror field already exists
    // (e.g. videoHosts.filemoon.watchUrl vs filemoonWatchUrl).
    if (key.includes('.') && normalizedOwnFields.has(key.toLowerCase().replace(/\./g, ''))) return;
    seen.add(key);
    entries.push({ key, value: value.trim() });
  };

  for (const [provider, saved] of Object.entries(getNestedHosts(itemObj, 'imageHosts'))) {
    add(`${provider}.url`, saved.url || saved.displayUrl || saved.directUrl);
    add(`${provider}.thumbnailUrl`, saved.thumbnailUrl || saved.thumbUrl);
    add(`${provider}.deleteUrl`, saved.deleteUrl);
  }
  for (const [provider, saved] of Object.entries(getNestedHosts(itemObj, 'videoHosts'))) {
    add(`${provider}.watchUrl`, saved.watchUrl || saved.displayUrl || saved.url);
    add(`${provider}.directUrl`, saved.directUrl || saved.downloadUrl);
    add(`${provider}.thumbnailUrl`, saved.thumbnailUrl || saved.thumbUrl);
    add(`${provider}.deleteUrl`, saved.deleteUrl);
  }
  add('filemoonUrl', itemObj.filemoonUrl);
  add('udropUrl', itemObj.udropUrl);
  add('linkUrl', itemObj.linkUrl);

  return entries;
}

export function stripKnownTopLevelMediaFields(value = {}) {
  if (!isPlainObject(value)) return {};

  const extraManagedSystemFields = new Set([
    'isVaulted',
    'vaultMode',
    'vaultedAt',
    'systemType',
    'secretVaultConfig',
  ]);
  const known = new Set([
    ...getAllBaseFieldKeys(),
    ...getTechnicalFieldKeys(),
    ...getSystemFieldKeys(),
    'ai',
  ]);

  return Object.fromEntries(
    Object.entries(value).filter(([key]) => (
      extraManagedSystemFields.has(key) || !known.has(key)
    ))
  );
}
