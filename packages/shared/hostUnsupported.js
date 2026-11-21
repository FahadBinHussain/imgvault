/**
 * @fileoverview Per-item "this host will not take this file" flags.
 * @description A host can reject a file for a reason that will never change
 * on retry — filemoon rejects over-long videos with "video is too long", a
 * duration cap, not a size cap (proven live 2026-11-20: a 905 MB / 11h55m
 * mp4 was rejected twice while a 1.12 GB file uploaded fine). Retrying such
 * an upload is pure waste, and leaving the item as a plain no-url gap means
 * the resolve page keeps resurfacing it as an issue forever.
 *
 * The flag lives in `extraMetadata.hostUnsupported`, a map keyed by host so
 * other hosts can be flagged the same way later. Shape per host:
 *
 *   { reason, durationSeconds, recordedAt, dismissedAt }
 *
 * `dismissedAt` is null until the user dismisses the flag on the resolve
 * page; a dismissed flag stays dismissed (it never resurfaces as an issue)
 * but the row is still visible under the Dismissed filter.
 *
 * Reads check `extraMetadata` first and fall back to the top-level mirror
 * (`fromNeonMediaRow` mirrors every extra key top-level). Writes go through
 * `extraMetadata` only — the 2.18.2 payload fix means a fresh extra write
 * wins over the stale mirror. There is deliberately NO delete here: removing
 * a key from extraMetadata alone resurrects it from the mirror (the
 * pendingUpload lesson), and a flag that later gains a link is simply inert
 * — the integrity check judges a present URL first, flag or not.
 */

export const HOST_UNSUPPORTED_EXTRA_KEY = 'hostUnsupported';

export const FILEMOON_HOST_KEY = 'filemoon';

/** The exact reason string filemoon returns for an over-long video. */
export const FILEMOON_TOO_LONG_REASON = 'video is too long';

/** Matches the filemoon duration rejection inside any wrapped error text. */
export const FILEMOON_TOO_LONG_PATTERN = /video is too long/i;

/** Matches an upload-errors entry that came from the filemoon service. */
export const FILEMOON_ERROR_ENTRY_PATTERN = /^filemoon\s*:/i;

/**
 * Read one host's flag from an item. Tolerates a missing item, a missing
 * map, and malformed entries (a non-object or an object without a reason
 * string is not a flag).
 * @param {Object} item
 * @param {string} host - e.g. 'filemoon'
 * @returns {Object|null} the flag, or null when the host is not flagged
 */
export function getHostUnsupportedFlag(item, host) {
  const key = String(host || '').trim().toLowerCase();
  if (!item || !key) return null;
  const fromExtra = item.extraMetadata?.[HOST_UNSUPPORTED_EXTRA_KEY]?.[key];
  const fromTop = item[HOST_UNSUPPORTED_EXTRA_KEY]?.[key];
  const raw = fromExtra ?? fromTop;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.reason !== 'string' || !raw.reason.trim()) return null;
  return raw;
}

/**
 * True when the host is flagged for this item and the flag is NOT dismissed.
 */
export function isHostUnsupported(item, host) {
  const flag = getHostUnsupportedFlag(item, host);
  return Boolean(flag && !flag.dismissedAt);
}

/**
 * True when the host is flagged for this item and the flag IS dismissed.
 */
export function isHostUnsupportedDismissed(item, host) {
  const flag = getHostUnsupportedFlag(item, host);
  return Boolean(flag && flag.dismissedAt);
}

/**
 * Build a normalized flag object. durationSeconds is a finite number of
 * seconds or null when unknown; recordedAt defaults to now.
 */
export function buildHostUnsupportedFlag({ reason, durationSeconds = null, recordedAt = null, dismissedAt = null } = {}) {
  return {
    reason: String(reason || '').trim(),
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    recordedAt: typeof recordedAt === 'string' && recordedAt ? recordedAt : new Date().toISOString(),
    dismissedAt: dismissedAt || null,
  };
}

/**
 * Return a NEW extraMetadata object with this host's flag set (other hosts'
 * flags and every other key are preserved). Pure — the caller spreads the
 * result into its updateImage call.
 */
export function withHostUnsupportedFlag(extraMetadata, host, flagFields) {
  const key = String(host || '').trim().toLowerCase();
  const base = extraMetadata && typeof extraMetadata === 'object' ? extraMetadata : {};
  const map = base[HOST_UNSUPPORTED_EXTRA_KEY] && typeof base[HOST_UNSUPPORTED_EXTRA_KEY] === 'object'
    ? base[HOST_UNSUPPORTED_EXTRA_KEY]
    : {};
  return {
    ...base,
    [HOST_UNSUPPORTED_EXTRA_KEY]: {
      ...map,
      [key]: buildHostUnsupportedFlag(flagFields),
    },
  };
}

/**
 * Return a NEW extraMetadata object with this host's flag dismissed. No-op
 * (same content, new object) when the host has no flag.
 */
export function withHostUnsupportedDismissed(extraMetadata, host, dismissedAt = null) {
  const key = String(host || '').trim().toLowerCase();
  const base = extraMetadata && typeof extraMetadata === 'object' ? extraMetadata : {};
  const map = base[HOST_UNSUPPORTED_EXTRA_KEY] && typeof base[HOST_UNSUPPORTED_EXTRA_KEY] === 'object'
    ? base[HOST_UNSUPPORTED_EXTRA_KEY]
    : {};
  const flag = map[key];
  if (!flag || typeof flag !== 'object') return { ...base };
  return {
    ...base,
    [HOST_UNSUPPORTED_EXTRA_KEY]: {
      ...map,
      [key]: {
        ...flag,
        dismissedAt: typeof dismissedAt === 'string' && dismissedAt ? dismissedAt : new Date().toISOString(),
      },
    },
  };
}

/**
 * Return a NEW extraMetadata object with this host's flag un-dismissed
 * (dismissedAt back to null). No-op when the host has no flag.
 */
export function withHostUnsupportedUndismissed(extraMetadata, host) {
  const key = String(host || '').trim().toLowerCase();
  const base = extraMetadata && typeof extraMetadata === 'object' ? extraMetadata : {};
  const map = base[HOST_UNSUPPORTED_EXTRA_KEY] && typeof base[HOST_UNSUPPORTED_EXTRA_KEY] === 'object'
    ? base[HOST_UNSUPPORTED_EXTRA_KEY]
    : {};
  const flag = map[key];
  if (!flag || typeof flag !== 'object') return { ...base };
  return {
    ...base,
    [HOST_UNSUPPORTED_EXTRA_KEY]: {
      ...map,
      [key]: { ...flag, dismissedAt: null },
    },
  };
}

/**
 * True when an error (Error, string, anything with a message) is the
 * filemoon duration rejection. The uploader preserves the raw API status
 * in the message, so the signal survives the "Failed to upload to
 * Filemoon: ..." wrapping.
 */
export function isFilemoonTooLongError(error) {
  const message = typeof error === 'string'
    ? error
    : String(error?.message || error || '');
  return FILEMOON_TOO_LONG_PATTERN.test(message);
}

/**
 * Find the filemoon duration rejection inside an upload-errors list
 * (entries shaped `${service.label}: ${message}`). The entry must be a
 * filemoon entry AND carry the rejection — a too-long error from another
 * host must not flag filemoon.
 * @param {Array<string>} uploadErrors
 * @returns {string|null} the matching entry, or null
 */
export function findFilemoonTooLongError(uploadErrors) {
  if (!Array.isArray(uploadErrors)) return null;
  for (const entry of uploadErrors) {
    if (typeof entry !== 'string') continue;
    if (FILEMOON_ERROR_ENTRY_PATTERN.test(entry) && FILEMOON_TOO_LONG_PATTERN.test(entry)) {
      return entry;
    }
  }
  return null;
}

/**
 * Format a duration in seconds for display: 42900 -> "11h 55m",
 * 2530 -> "42m 10s", 90 -> "90s". Null/unknown -> ''.
 */
export function formatVideoDuration(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) return '';
  const total = Math.round(durationSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * The upload-time warning decision, pure so it is unit-testable: given an
 * upload's error list and the video's duration, return the warning to show
 * in the upload UI, or null when filemoon did not reject this upload for
 * duration. The caller renders the returned message LOUDLY, right then —
 * this is what stops a doomed upload from failing silently and resurfacing
 * days later as a no-url gap on the resolve page.
 * @param {Array<string>} uploadErrors
 * @param {number|null} durationSeconds
 * @returns {{ host: string, reason: string, durationSeconds: number|null, message: string }|null}
 */
export function getFilemoonTooLongWarning(uploadErrors, durationSeconds = null) {
  if (!findFilemoonTooLongError(uploadErrors)) return null;
  const duration = Number.isFinite(durationSeconds) ? durationSeconds : null;
  const durationLabel = formatVideoDuration(duration);
  return {
    host: FILEMOON_HOST_KEY,
    reason: FILEMOON_TOO_LONG_REASON,
    durationSeconds: duration,
    message: durationLabel
      ? `Filemoon rejected this video: "video is too long" (duration ${durationLabel}). Filemoon caps video length, so this file will never upload there — it stays on your other hosts, and the resolve page records it so it won't keep coming up as a missing link.`
      : `Filemoon rejected this video: "video is too long". Filemoon caps video length, so this file will never upload there — it stays on your other hosts, and the resolve page records it so it won't keep coming up as a missing link.`,
  };
}
