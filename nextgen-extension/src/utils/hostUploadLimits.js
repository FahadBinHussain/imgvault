/**
 * @fileoverview Per-host file size ceilings, checked BEFORE the first byte goes out.
 * @version 1.0.0
 *
 * WHY THIS EXISTS: Telegram's Bot API reads a file back through `getFile`,
 * and that call stops at 20 MB (the send cap for videos is 50 MB). A 900 MB
 * `.mkv` can therefore NEVER be served by this Telegram host - the upload
 * itself is fine, but the copy would be unreadable.
 *
 * The old behaviour was to discover this at the END of the upload: the other
 * host had already taken the file, the Telegram attempt died with "getFile
 * gate: 900.5 MB is over the 20.0 MB getFile limit", and the user was left
 * guessing why. A resume did not help either - it hits the very same gate.
 *
 * So the cap is checked up front:
 *   - a host that cannot take the file is SKIPPED, loudly (log + toast +
 *     recorded in the item's upload errors), and the remaining hosts run
 *   - when NO selected host can take the file, the upload fails immediately
 *     with the cap named, before a single byte is transferred
 */

import {
  TELEGRAM_GETFILE_MAX_BYTES,
  TELEGRAM_UPLOAD_MAX_BYTES,
  formatBytesForError,
  telegramUploadField,
} from './telegramApi.js';

/**
 * The size ceiling of a host, or null when the host has none.
 *
 * @param {string} hostKey - catalog key, e.g. 'telegram'
 * @param {{fileName?: string, mimeType?: string}} [options]
 * @returns {{hostKey: string, maxBytes: number, field: string, note: string}|null}
 */
export function describeHostUploadLimit(hostKey, { fileName = '', mimeType = '' } = {}) {
  const key = String(hostKey || '').toLowerCase();
  if (key !== 'telegram') {
    return null;
  }
  // The SAME field decision the uploader makes, so the pre-flight and the
  // real upload can never disagree about the cap.
  const field = telegramUploadField(fileName, mimeType);
  const maxBytes = field === 'video' ? TELEGRAM_UPLOAD_MAX_BYTES : TELEGRAM_GETFILE_MAX_BYTES;
  return {
    hostKey: key,
    maxBytes,
    field,
    note: field === 'video'
      ? 'the Bot API refuses videos over 50 MB'
      : 'the Bot API reads files back through getFile, which stops at 20 MB',
  };
}

/**
 * Split the selected hosts into the ones that can take this file and the ones
 * that physically cannot.
 *
 * @param {Array} services - selected upload services
 * @param {{bytes?: number, fileName?: string, mimeType?: string}} [options]
 * @returns {{accepted: Array, rejected: Array<{service: Object, limit: Object, reason: string}>}}
 */
export function partitionHostsByUploadLimit(services, { bytes = 0, fileName = '', mimeType = '' } = {}) {
  const size = Number(bytes) || 0;
  const accepted = [];
  const rejected = [];
  for (const service of services || []) {
    const limit = describeHostUploadLimit(service?.key, { fileName, mimeType });
    if (limit && size > limit.maxBytes) {
      const label = service?.label || service?.key || 'host';
      rejected.push({
        service,
        limit,
        reason: `${label} cannot take this file: ${formatBytesForError(size)} is over its `
          + `${formatBytesForError(limit.maxBytes)} limit (${limit.note}).`,
      });
    } else {
      accepted.push(service);
    }
  }
  return { accepted, rejected };
}
