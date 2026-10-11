// single source of truth for provider/host metadata + pure helpers (platform parity phase 2).
// RUNTIME bindings (uploaderClass, upload, uploadWithProgress, vaultDownloadUrl) live in each
// app's catalog layer — the extension binds them in nextgen-extension/src/config/providerCatalog.js;
// the web re-exports this file as-is (web/src/lib/providerCatalog.js).

const hasText = (value) => String(value || '').trim().length > 0;

export const DEFAULT_IMAGE_SOURCE = 'imgbb';
export const DEFAULT_VIDEO_SOURCE = 'filemoon';
export const DEFAULT_3D_SOURCE = 'udrop';
export const DEFAULT_VAULT_BLOB_HOST = 'udrop';

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
  },
];

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
    vaultBlobHost: true,
    isConfigured: (settings) => hasText(settings?.udropKey1) && hasText(settings?.udropKey2),
  },
  {
    key: 'terabox',
    label: 'TeraBox',
    sourceValue: 'terabox',
    sourceLabel: 'TeraBox',
    apiKeyFields: ['teraboxCookie'],
    required: false,
    uploaderKey: 'teraboxUploader',
    watchUrlField: 'teraboxWatchUrl',
    directUrlField: 'teraboxDirectUrl',
    aliasWatchUrlField: 'teraboxUrl',
    vaultBlobHost: true,
    isConfigured: () => true, // cookie auto-reads from browser session
  },
];

export const IMAGE_SOURCE_OPTIONS = IMAGE_UPLOAD_SERVICES.map(({ sourceValue, sourceLabel }) => ({
  value: sourceValue,
  label: sourceLabel,
})).sort((a, b) => {
  if (a.value === DEFAULT_IMAGE_SOURCE) return -1;
  if (b.value === DEFAULT_IMAGE_SOURCE) return 1;
  return a.label.localeCompare(b.label);
});

export const VIDEO_SOURCE_OPTIONS = VIDEO_UPLOAD_SERVICES.map(({ sourceValue, sourceLabel }) => ({
  value: sourceValue,
  label: sourceLabel,
})).sort((a, b) => {
  if (a.value === DEFAULT_VIDEO_SOURCE) return -1;
  if (b.value === DEFAULT_VIDEO_SOURCE) return 1;
  return a.label.localeCompare(b.label);
});

export const THREE_D_SOURCE_OPTIONS = VIDEO_UPLOAD_SERVICES.filter(
  (s) => s.key === 'udrop' || s.key === 'terabox'
).map(({ sourceValue, sourceLabel }) => ({ value: sourceValue, label: sourceLabel }))
  .sort((a, b) => {
    if (a.value === DEFAULT_3D_SOURCE) return -1;
    if (b.value === DEFAULT_3D_SOURCE) return 1;
    return a.label.localeCompare(b.label);
  });

export function getConfiguredServices(services, settings) {
  return services.filter((service) => service.isConfigured(settings));
}

export function filterUploadServicesByKeys(services = [], selectedKeys) {
  if (!Array.isArray(selectedKeys)) {
    return services;
  }

  const selected = new Set(
    selectedKeys
      .map((key) => String(key || '').trim().toLowerCase())
      .filter(Boolean)
  );

  if (selected.size === 0) {
    return [];
  }

  return services.filter((service) => selected.has(service.key));
}

export function getMissingRequiredImageUploadServices(settings) {
  return IMAGE_UPLOAD_SERVICES.filter((service) => service.required && !service.isConfigured(settings));
}

/**
 * Video upload services that can store the encrypted vault `.bin` blob.
 * Marked via `vaultBlobHost: true` on the service def. Filemoon is a video-only
 * host and rejects `.bin` files, so it is NOT a vault blob host — only hosts
 * that accept the opaque encrypted blob are eligible.
 * @param {Array} [services] catalog entries (callers with runtime bindings pass their enriched list)
 * @returns {Array} services
 */
export function getVaultBlobHostServices(services = VIDEO_UPLOAD_SERVICES) {
  return services.filter((service) => service.vaultBlobHost);
}

/**
 * Normalize user-selected vault blob host keys (possibly from legacy single
 * `selectedVaultHost`) into a valid, non-empty array of selectable hosts.
 * @param {string|string[]|undefined} selected
 * @returns {string[]}
 */
export function normalizeVaultBlobHostKeys(selected) {
  const available = getVaultBlobHostServices().map((service) => service.key);
  if (available.length === 0) return [];

  const raw = Array.isArray(selected)
    ? selected
    : selected
      ? [String(selected).toLowerCase()]
      : [];

  const keys = raw
    .map((key) => String(key || '').trim().toLowerCase())
    .filter((key) => available.includes(key));

  return keys.length > 0 ? keys : [DEFAULT_VAULT_BLOB_HOST];
}

/**
 * Selectable options (key + label) for the vault blob host picker, derived from
 * the catalog so future vault-capable hosts show up automatically.
 * @param {Array} [services] catalog entries
 * @returns {Array<{key:string,label:string}>}
 */
export function getVaultBlobHostOptions(services = VIDEO_UPLOAD_SERVICES) {
  return getVaultBlobHostServices(services).map(({ key, label }) => ({ key, label }));
}
