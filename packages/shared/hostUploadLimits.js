/**
 * @fileoverview Per-host file size ceilings, checked BEFORE the first byte goes out.
 * @version 1.0.0
 *
 * WHY THIS EXISTS: Telegram's Bot API reads a file back through `getFile`, and
 * that call stops at 20 MB (the sendVideo cap for mp4 is 50 MB). A 900 MB
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
 *
 * The caps themselves live in the shared catalog (packages/shared), so the
 * extension and the web read the SAME numbers.
 */

import { VIDEO_UPLOAD_SERVICES } from './providerCatalog.js';
import { formatBytesForError, telegramUploadField } from './telegramLimits.js';

const catalogEntryFor = (hostKey) => {
  const key = String(hostKey || '').toLowerCase();
  return VIDEO_UPLOAD_SERVICES.find((service) => service.key === key) || null;
};

/**
 * The size ceiling of a host, or null when the host has none.
 *
 * @param {string} hostKey - catalog key, e.g. 'telegram'
 * @param {{fileName?: string, mimeType?: string}} [options]
 * @returns {{hostKey: string, maxBytes: number, note: string, label: string}|null}
 */
export function describeHostUploadLimit(hostKey, { fileName = '', mimeType = '', hasNativeHost = false } = {}) {
  const key = String(hostKey || '').toLowerCase();
  const service = catalogEntryFor(key);
  if (!service || !service.videoMaxBytes) {
    return null;
  }
  // Telegram is the only host whose cap depends on the FILE TYPE: an mp4 goes
  // out as sendVideo (50 MB), everything else as a document (20 MB read-back
  // gate). With native host available, Telegram can handle up to 2 GB.
  const asVideo = key === 'telegram' && telegramUploadField(fileName, mimeType) === 'video';
  const maxBytes = key === 'telegram' && hasNativeHost
    ? (2000 * 1024 * 1024)
    : (asVideo ? (service.videoMp4MaxBytes || service.videoMaxBytes) : service.videoMaxBytes);
  return {
    hostKey: key,
    maxBytes,
    note: key === 'telegram' && hasNativeHost
      ? 'Native host MTProto upload enabled up to 2 GB'
      : (service.videoCapNote || ''),
    label: service.label || key,
  };
}

/**
 * Split the selected hosts into the ones that can take this file and the ones
 * that physically cannot.
 *
 * @param {Array} services - selected upload services (runtime bound)
 * @param {{bytes?: number, fileName?: string, mimeType?: string}} [options]
 * @returns {{accepted: Array, rejected: Array<{service: Object, limit: Object, reason: string}>}}
 */
export function partitionHostsByUploadLimit(services, { bytes = 0, fileName = '', mimeType = '', hasNativeHost = false } = {}) {
  const size = Number(bytes) || 0;
  const accepted = [];
  const rejected = [];
  for (const service of services || []) {
    const limit = describeHostUploadLimit(service?.key, { fileName, mimeType, hasNativeHost });
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
