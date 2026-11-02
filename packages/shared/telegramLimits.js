/**
 * @fileoverview Telegram Bot API limits — the single source of truth for every platform.
 * @version 1.0.0
 *
 * WHY THIS EXISTS: the extension and the web app each carried their own copy
 * of these numbers, and they had already drifted:
 *
 *   - the extension knew BOTH caps (sendVideo 50 MB, getFile 20 MB) and the
 *     field decision that picks between them
 *   - the web knew ONLY the getFile cap, so it could never validate a video
 *     upload and would have applied the wrong limit to one
 *   - the byte formatter was duplicated verbatim in both
 *
 * A limit that only one platform knows is a limit one platform enforces and
 * the other does not - which is how a 900 MB file reached Telegram on one
 * platform while the other refused it. Both now read these numbers from here.
 *
 * The Bot API rules themselves:
 *   - sendVideo      : 50 MB
 *   - sendDocument   : reads back through getFile, which stops at 20 MB
 *   - images are ALWAYS documents (byte fidelity beats the recompressed
 *     photo CDN variant - that is the phase-0 image decision)
 */

export const TELEGRAM_UPLOAD_MAX_BYTES = 50 * 1024 * 1024; // ~50 MB sendVideo cap
export const TELEGRAM_GETFILE_MAX_BYTES = 20 * 1024 * 1024; // getFile 20 MB gate
export const TELEGRAM_NATIVE_MAX_BYTES = 2000 * 1024 * 1024; // 2000 MB (2 GB) native MTProto cap

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'avif', 'heic']);

const extensionOf = (filename = '') => {
  try {
    const base = String(filename).split('/').pop().split('?')[0];
    const dot = base.lastIndexOf('.');
    return dot > -1 ? base.slice(dot + 1).toLowerCase() : '';
  } catch (_) {
    return '';
  }
};

/** Human readable size for error messages. Identical on every platform. */
export function formatBytesForError(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown size';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * `video` for the h264/hotlink path, `document` for everything else.
 * only mp4 gets the hotlink path - the spike proved other containers arrive as
 * a `document` with no CDN mp4, so video/webm + .mkv + .mov all stay documents.
 */
export function telegramUploadField(filename = '', mimeType = '') {
  const ext = extensionOf(filename);
  if (ext === 'mp4') return 'video';
  if (IMAGE_EXTENSIONS.has(ext)) return 'document';
  if (String(mimeType || '').toLowerCase() === 'video/mp4') return 'video';
  return 'document';
}

export function telegramUploadMethod(filename = '', mimeType = '') {
  return telegramUploadField(filename, mimeType) === 'video' ? 'sendVideo' : 'sendDocument';
}

/**
 * The cap that applies to this file, in bytes.
 * @param {string} filename
 * @param {string} mimeType
 * @returns {number}
 */
export function telegramUploadSizeCap(filename = '', mimeType = '') {
  return telegramUploadField(filename, mimeType) === 'video'
    ? TELEGRAM_UPLOAD_MAX_BYTES
    : TELEGRAM_GETFILE_MAX_BYTES;
}

/**
 * Gate BEFORE the upload, so an unserveable item is never created.
 *  - sendVideo: 50 MB cap (both failure shapes map to this message)
 *  - sendDocument: 20 MB, because reading it back goes through getFile
 */
export function assertTelegramUploadSize(bytes, filename = '', mimeType = '', hasNativeHost = false) {
  const size = Number(bytes) || 0;
  const field = telegramUploadField(filename, mimeType);
  const max = hasNativeHost
    ? TELEGRAM_NATIVE_MAX_BYTES
    : (field === 'video' ? TELEGRAM_UPLOAD_MAX_BYTES : TELEGRAM_GETFILE_MAX_BYTES);
  if (size <= max) return;

  if (field === 'video') {
    throw new Error(
      `Telegram upload cap: ${formatBytesForError(size)} is over the ${formatBytesForError(max)} ` +
      `Bot API limit (file: ${filename || 'video.mp4'}). Larger videos need another host.`
    );
  }
  throw new Error(
    `Telegram getFile gate: ${formatBytesForError(size)} is over the ${formatBytesForError(max)} ` +
    `getFile limit (file: ${filename || 'file'}), so this upload could never be read back. ` +
    `Keep files at or under 20 MB for Telegram or use another host.`
  );
}
