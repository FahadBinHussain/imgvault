/**
 * @fileoverview Durable vault-upload intent record (2.19.40).
 *
 * Why this exists: the page that uploads a vault blob can die mid-transfer
 * (tab frozen/discarded by Edge sleeping tabs, extension reload, crash).
 * The encrypted blob lives on the hosts by then, but the save inputs —
 * which host legs finished, the encrypted metadata — lived only in the
 * page's closures, so a completed upload could never be saved and the run
 * stayed "running" forever (2026-11-24: a 381 MB vault upload stuck at
 * 74% — the Telegram post landed as msg 701, the page never saw the
 * result, no vault item was ever saved).
 *
 * The intent persists the save inputs to chrome.storage.local BEFORE the
 * host loop starts and records each host leg as it lands, so the worker's
 * stale-run reconciliation can finish the save from the upload journal +
 * intent without the page. The encrypted metadata stored here is
 * ciphertext (AES-GCM, vault key) — persisting it is no weaker than the
 * vault row itself, which stores the same value.
 *
 * Imported by BOTH the service worker and the extension pages, so it must
 * stay free of DOM and node-only APIs (same rule as uploadRun.js).
 */

export const VAULT_UPLOAD_INTENT_KEY = 'vaultUploadIntent';

/**
 * Build a fresh intent record. Pure — no storage touched.
 * @param {Object} init
 * @param {string} init.runId - the upload-run id this intent belongs to
 * @param {string} init.fileName
 * @param {number} init.blobSize - plaintext size (what saveVaultedUpload stores as fileSize)
 * @param {string} init.opaqueName - the random .bin name the blob was uploaded under
 * @param {string} init.encryptedMetadata - base64 AES-GCM metadata ciphertext
 * @param {string} init.encryptedMimeType - plaintext mime type
 * @param {Object} init.uploadData - the plain save inputs saveVaultedUpload reads
 *   (isAudio/kind/isVideo/fileName/fileLastModified/collectionId/fileSize) —
 *   never the blob itself
 * @param {string[]} init.vaultHostKeys - host legs this upload targets, in order
 * @param {string} [init.telegramChannel] - channel id/name for the Telegram leg
 * @returns {Object} the intent record
 */
export function createVaultUploadIntent({
  runId = '',
  fileName = '',
  blobSize = 0,
  opaqueName = '',
  encryptedMetadata = '',
  encryptedMimeType = '',
  uploadData = {},
  vaultHostKeys = [],
  telegramChannel = '',
} = {}) {
  const now = Date.now();
  return {
    runId: String(runId || ''),
    fileName: String(fileName || ''),
    blobSize: Number(blobSize) || 0,
    opaqueName: String(opaqueName || ''),
    encryptedMetadata: String(encryptedMetadata || ''),
    encryptedMimeType: String(encryptedMimeType || ''),
    uploadData: {
      isAudio: Boolean(uploadData.isAudio || uploadData.kind === 'audio'),
      kind: String(uploadData.kind || ''),
      isVideo: Boolean(uploadData.isVideo || uploadData.kind === 'video'),
      fileName: String(uploadData.fileName || ''),
      fileLastModified: uploadData.fileLastModified || null,
      collectionId: uploadData.collectionId || null,
      fileSize: Number(uploadData.fileSize) || 0,
    },
    vaultHostKeys: Array.isArray(vaultHostKeys) ? vaultHostKeys.filter(Boolean) : [],
    telegramChannel: String(telegramChannel || ''),
    telegramRequestId: '',
    hostResults: {},
    createdAt: now,
    updatedAt: now,
  };
}

/** @returns {Promise<Object|null>} the stored intent, or null */
export async function getVaultUploadIntent() {
  const stored = await chrome.storage.local.get(VAULT_UPLOAD_INTENT_KEY);
  const intent = stored?.[VAULT_UPLOAD_INTENT_KEY];
  return intent && typeof intent === 'object' ? intent : null;
}

/** Persist an intent record wholesale. */
export async function saveVaultUploadIntent(intent) {
  if (!intent || typeof intent !== 'object') {
    throw new Error('saveVaultUploadIntent needs an intent object.');
  }
  await chrome.storage.local.set({
    [VAULT_UPLOAD_INTENT_KEY]: { ...intent, updatedAt: Date.now() },
  });
  return intent;
}

/**
 * Merge a patch into the stored intent. Returns the updated intent, or
 * null when no intent is stored (a patch must never resurrect one).
 */
export async function updateVaultUploadIntent(patch = {}) {
  const intent = await getVaultUploadIntent();
  if (!intent) return null;
  const next = { ...intent, ...patch, updatedAt: Date.now() };
  await chrome.storage.local.set({ [VAULT_UPLOAD_INTENT_KEY]: next });
  return next;
}

/** Record one finished host leg (a buildVaultBlobCopy output) on the intent. */
export async function recordVaultUploadHostResult(hostKey, copy) {
  const key = String(hostKey || '').toLowerCase();
  if (!key || !copy || typeof copy !== 'object') return null;
  const intent = await getVaultUploadIntent();
  if (!intent) return null;
  return updateVaultUploadIntent({
    hostResults: { ...(intent.hostResults || {}), [key]: copy },
  });
}

/** Drop the intent — the save completed (or the upload genuinely failed). */
export async function clearVaultUploadIntent() {
  await chrome.storage.local.remove(VAULT_UPLOAD_INTENT_KEY);
}

/**
 * Build the `encrypted` object saveVaultedUpload stores, from finished
 * host copies. Single source of truth — the page's vault flow and the
 * worker's journal recovery both build through here, so a recovered save
 * is byte-identical in shape to a live one.
 *
 * Shape mirrors the page's inline build: the FIRST copy is the primary
 * (its URL/file id/message id are mirrored top-level), every copy is
 * listed in encryptedBlobHosts, and vaultHost is the primary's host.
 * @param {Object} input
 * @param {Array} input.copies - buildVaultBlobCopy outputs, in host order
 * @param {string} input.encryptedMetadata
 * @param {string} input.encryptedMimeType
 * @param {string} input.encryptedFileName - the opaque .bin name
 * @param {string} [input.defaultVaultHost] - fallback when no copy exists
 * @returns {Object} the encrypted payload for saveVaultedUpload
 */
export function buildVaultEncryptedPayload({
  copies = [],
  encryptedMetadata = '',
  encryptedMimeType = '',
  encryptedFileName = '',
  defaultVaultHost = 'terabox',
} = {}) {
  const list = Array.isArray(copies) ? copies.filter(Boolean) : [];
  const primary = list[0] || {};
  return {
    encryptedBlobUrl: primary.encryptedBlobUrl || '',
    encryptedBlobWatchUrl: primary.encryptedBlobWatchUrl || '',
    encryptedBlobFileId: primary.encryptedBlobFileId || '',
    // telegram deletes its copy by post id; the mirrored top-level field
    // keeps a legacy single-copy read (no encryptedBlobHosts) deletable.
    encryptedBlobMessageId: primary.encryptedBlobMessageId || '',
    encryptedBlobHosts: list,
    encryptedMetadata: String(encryptedMetadata || ''),
    encryptedMimeType: String(encryptedMimeType || 'application/octet-stream'),
    encryptedFileName: String(encryptedFileName || ''),
    vaultHost: primary.host || defaultVaultHost,
    vaultHosts: list.map((copy) => copy.host),
  };
}

/**
 * Decide what the worker's stale-run reconciliation can do with a
 * completed Telegram upload journal + the stored intent. Pure — no
 * storage, no network, so the decision itself is unit-testable and the
 * worker method stays a thin wrapper around it.
 *
 * @param {Object} input
 * @param {Object|null} input.intent - the stored intent (or null)
 * @param {Object|null} input.telegramCopy - buildVaultBlobCopy output for
 *   the Telegram leg, rebuilt from the journal RESULT (or null when the
 *   run had no Telegram leg)
 * @returns {{action: 'save'|'report', encrypted: Object|null,
 *   uploadData: Object|null, blobSize: number, missingLegs: string[],
 *   telegramCopy: Object|null}}
 *   'save' — every targeted leg is recorded; the caller can finish the
 *   save with `encrypted` + `uploadData` + `blobSize`.
 *   'report' — the save cannot complete (no intent, or legs missing);
 *   the caller settles the run with a LOUD summary naming the recovered
 *   Telegram copy and the missing legs instead of silently dropping it.
 */
export function decideVaultUploadRecovery({ intent = null, telegramCopy = null } = {}) {
  if (!intent || typeof intent !== 'object') {
    return {
      action: 'report',
      encrypted: null,
      uploadData: null,
      blobSize: 0,
      missingLegs: [],
      telegramCopy: telegramCopy || null,
    };
  }
  const hostResults = { ...(intent.hostResults || {}) };
  if (telegramCopy && typeof telegramCopy === 'object') {
    hostResults.telegram = telegramCopy;
  }
  const targetLegs = Array.isArray(intent.vaultHostKeys) && intent.vaultHostKeys.length > 0
    ? intent.vaultHostKeys
    : Object.keys(hostResults);
  const missingLegs = targetLegs.filter((key) => !hostResults[String(key).toLowerCase()]);
  if (missingLegs.length > 0) {
    return {
      action: 'report',
      encrypted: null,
      uploadData: null,
      blobSize: Number(intent.blobSize) || 0,
      missingLegs,
      telegramCopy: telegramCopy || null,
    };
  }
  const copies = targetLegs.map((key) => hostResults[String(key).toLowerCase()]);
  return {
    action: 'save',
    encrypted: buildVaultEncryptedPayload({
      copies,
      encryptedMetadata: intent.encryptedMetadata || '',
      encryptedMimeType: intent.encryptedMimeType || '',
      encryptedFileName: intent.opaqueName || '',
      defaultVaultHost: copies[0]?.host || 'terabox',
    }),
    uploadData: intent.uploadData || {},
    blobSize: Number(intent.blobSize) || 0,
    missingLegs: [],
    telegramCopy: telegramCopy || null,
  };
}
