/**
 * @fileoverview The "pending upload" reservation flags.
 * @version 1.0.0
 *
 * WHY THIS EXISTS: a video upload reserves its gallery row BEFORE the bytes
 * leave the browser (see `createPendingUpload`), so a browser/tab death
 * mid-transfer leaves a row behind that the resolve page can offer to recover
 * from the orphaned host file.
 *
 * The reservation flag has to be cleared the moment the upload is finalised.
 * It used to survive the finalisation, and a stale flag is not cosmetic:
 * the resolve page matches an orphaned host file to a pending row BY NAME, so
 * a finished item that still claims "pending" makes the page offer to "recover"
 * a file that is already linked - which is how one video ended up on TeraBox
 * twice (the duplicate the user had to clean up by hand).
 *
 * The flags live in `extraMetadata`, and every row stores its extra keys
 * TWICE (mirrored top-level + inside extraMetadata). That mirror is why the
 * deletion has to be explicit - see `toMediaDbPayload`'s `extraMetadataDeletes`.
 */

/** The extra-metadata keys that mark a row as a reserved (pending) upload. */
export const PENDING_UPLOAD_EXTRA_KEYS = Object.freeze([
  'pendingUpload',
  'pendingUploadStartedAt',
  'pendingUploadFileName',
]);

/**
 * True when the row is still a reserved (not yet finalised) upload.
 * @param {Object} item
 * @returns {boolean}
 */
export function isPendingUploadItem(item) {
  return Boolean(item && typeof item === 'object' && item.extraMetadata?.pendingUpload);
}

/**
 * A copy of the extra metadata with every pending-upload flag removed.
 * @param {Object} extraMetadata
 * @returns {Object}
 */
export function withoutPendingUploadFlags(extraMetadata = {}) {
  const next = { ...(extraMetadata && typeof extraMetadata === 'object' ? extraMetadata : {}) };
  for (const key of PENDING_UPLOAD_EXTRA_KEYS) {
    delete next[key];
  }
  return next;
}

/**
 * True when the row carries at least one video host link.
 *
 * The finalisation path (`finalizeUploadedVideo`) writes the host links and
 * clears the pending flag in the SAME write, so a row that still claims
 * "pending" while carrying host links is a row whose flag failed to clear -
 * objectively wrong, and safe to repair.
 * @param {Object} item
 * @returns {boolean}
 */
export function hasVideoHostLinks(item) {
  if (!item || typeof item !== 'object') return false;
  const extra = item.extraMetadata && typeof item.extraMetadata === 'object' ? item.extraMetadata : {};
  const videoHosts = item.videoHosts && typeof item.videoHosts === 'object'
    ? item.videoHosts
    : (extra.videoHosts && typeof extra.videoHosts === 'object' ? extra.videoHosts : {});

  if (Object.keys(videoHosts).length > 0) return true;
  return Boolean(
    item.filemoonWatchUrl ||
    item.filemoonDirectUrl ||
    item.filemoonUrl ||
    item.udropWatchUrl ||
    item.udropDirectUrl ||
    item.udropUrl ||
    extra.filemoonWatchUrl ||
    extra.udropWatchUrl
  );
}
