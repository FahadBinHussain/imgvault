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
  {
    // telegram images are uploaded as DOCUMENTS (byte-faithful; sendPhoto re-encodes —
    // measured 23122B -> 14074B in the phase-0 spike), so there is no CDN image URL:
    // the stored link is a platform-local `/telegram-media/<fileId>` path served by the
    // extension SW / web route through getFile (token never lands in the row or a URL).
    key: 'telegram',
    label: 'Telegram',
    sourceValue: 'telegram',
    sourceLabel: 'Telegram (Byte-Faithful Document)',
    apiKeyFields: ['telegramBotToken', 'telegramChannel'],
    required: false,
    uploaderKey: 'telegramUploader',
    isConfigured: (settings) => hasText(settings?.telegramBotToken) && hasText(settings?.telegramChannel),
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
    threeDHost: true,
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
    threeDHost: true,
    isConfigured: () => true, // cookie auto-reads from browser session
  },
  {
    // mp4/h264 in -> sendVideo -> public CDN url (spike: ACAO *, Range 206, repeated
    // reads OK, hotlinkable with no token). anything else goes as a document and is
    // served through the same platform-local `/telegram-media/<fileId>` path as images
    // (getFile has a real 20 MB gate -> loud error naming it).
    key: 'telegram',
    label: 'Telegram',
    sourceValue: 'telegram',
    sourceLabel: 'Telegram (mp4 Hotlink)',
    apiKeyFields: ['telegramBotToken', 'telegramChannel'],
    required: false,
    uploaderKey: 'telegramUploader',
    threeDHost: true,
    // scene files upload as documents, so the getFile 20 MB read-back gate is the
    // real scene limit - the label says so instead of reusing the mp4 wording.
    threeDLabel: 'Telegram (≤ 20 MB docs)',
    // phase 3a of plan.md: the encrypted vault .bin is a document too, so the same
    // getFile gate is the vault cap (20 MB read-back, never a silent partial blob).
    vaultBlobHost: true,
    vaultLabel: 'Telegram (≤ 20 MB)',
    vaultMaxBytes: 20 * 1024 * 1024,
    vaultCapNote: 'the Bot API only reads files back through getFile',
    isConfigured: (settings) => hasText(settings?.telegramBotToken) && hasText(settings?.telegramChannel),
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

/** Hosts that can store 3D scene files (.spz + texture). Marketing rule: every
 *  new 3D host opts in here (threeDHost) — no duplicated key lists in the UI. */
export const THREE_D_HOST_KEYS = VIDEO_UPLOAD_SERVICES.filter((s) => s.threeDHost).map((s) => s.key);

export const THREE_D_SOURCE_OPTIONS = VIDEO_UPLOAD_SERVICES.filter((s) => s.threeDHost)
  .map(({ sourceValue, sourceLabel, threeDLabel }) => ({ value: sourceValue, label: threeDLabel || sourceLabel }))
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
 * Hosts with a vault cap (Telegram's 20 MB getFile gate) show it in their picker
 * label via `vaultLabel`, same trick `threeDLabel` plays for 3D.
 * @param {Array} [services] catalog entries (callers with runtime bindings pass their enriched list)
 * @returns {Array} services
 */
export function getVaultBlobHostServices(services = VIDEO_UPLOAD_SERVICES) {
  return services
    .filter((service) => service.vaultBlobHost)
    .map((service) => (service.vaultLabel ? { ...service, label: service.vaultLabel } : service));
}

/**
 * Pre-flight the vault blob size against every selected host BEFORE the first
 * upload, so an over-cap host can never leave half the copies sitting on the
 * other accounts. Fails loudly and names the cap + what to do instead.
 * @param {string[]} hostKeys selected vault hosts
 * @param {number} blobSize size in bytes of the ENCRYPTED blob (not the original)
 * @param {Array} [services] catalog entries
 */
export function assertVaultBlobHostSizes(hostKeys, blobSize, services = VIDEO_UPLOAD_SERVICES) {
  const selected = new Set((hostKeys || []).map((key) => String(key || '').toLowerCase()));
  // raw defs, not the vaultLabel-mapped list — the message states the cap itself
  const over = services.filter(
    (service) =>
      service.vaultBlobHost &&
      service.vaultMaxBytes &&
      selected.has(service.key) &&
      Number(blobSize) > service.vaultMaxBytes
  );
  if (over.length === 0) return;

  const sizeMb = (Number(blobSize) / (1024 * 1024)).toFixed(1);
  throw new Error(
    over
      .map((service) =>
        `${service.label} cannot store this encrypted blob: ${sizeMb} MiB is over its ` +
        `${(service.vaultMaxBytes / (1024 * 1024)).toFixed(0)} MB vault cap ` +
        `(${service.vaultCapNote}). Unselect it in the Vault blob host picker and ` +
        `vault to a host without the cap, or keep the original small enough to fit.`)
      .join('\n')
  );
}

/**
 * Stored copy row for one vault blob host (identical shape on both platforms).
 * `encryptedBlobUrl` is what the readers fetch: Telegram serves BYTES from its
 * platform-local `/telegram-media/<fileId>` route and its watchUrl is an HTML
 * post page, so it takes the direct route; every other host keeps the watch URL
 * and regenerates a signed download URL per read. `encryptedBlobMessageId` is
 * Telegram-only and required for deletes — the Bot API has no file delete, only
 * `deleteMessage` of the post the blob was sent as.
 * @param {string} host
 * @param {Object} result upload result from the host's uploader
 * @returns {{host:string,encryptedBlobUrl:string,encryptedBlobWatchUrl:string,encryptedBlobFileId:string,encryptedBlobMessageId?:string}}
 */
export function buildVaultBlobCopy(host, result = {}) {
  const key = String(host || '').toLowerCase();
  const watchUrl = result.watchUrl || result.displayUrl || result.url || '';
  const copy = {
    host: key,
    encryptedBlobUrl: key === 'telegram' ? (result.directUrl || result.url || '') : watchUrl,
    encryptedBlobWatchUrl: watchUrl,
    encryptedBlobFileId: result.fileId || '',
  };
  if (result.messageId) copy.encryptedBlobMessageId = String(result.messageId);
  return copy;
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
