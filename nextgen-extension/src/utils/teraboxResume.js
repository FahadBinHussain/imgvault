/**
 * @fileoverview Pure helpers for the TeraBox (PCS superfile2) resumable upload.
 * @version 1.0.0
 *
 * The TeraBox upload is a chunked protocol: `precreate` opens a server-side
 * session (`uploadid`), every accepted chunk answers with its md5, and
 * `create` finalises the file with the list of chunk hashes. Both the
 * session id and the hash list used to live in memory only, so a crash left
 * the bytes on the server orphaned and the extension with no way back.
 *
 * These helpers are deliberately free of chrome.* and of any import, so they
 * can be unit tested in plain node (`test-upload-resume.mjs`) and reused by
 * the uploader without dragging the whole catalog in.
 */

/**
 * @typedef {Object} TeraBoxResumeState
 * @property {string} uploadid - Server-side upload session id (PCS session key).
 * @property {string} path - Remote destination path (e.g. `/video.mp4`).
 * @property {number} size - Size of the file in bytes when the session was opened.
 * @property {number} chunkSize - Chunk size the session's blocks were cut with.
 * @property {Array<string|undefined>} blockList - md5 per chunk index; empty entry = never uploaded.
 */

/** The md5 the PCS API uses as the "block is absent" sentinel. */
export const ABSENT_BLOCK_MD5 = '5910a591dd8fc18c32a8f3df4fdc1761';

/**
 * Chunk size for a file. 4 MB, doubling per 4 GB threshold.
 * Pure so the resume helpers and the uploader always agree on the block
 * boundaries of a session.
 *
 * @param {number} streamSize - Size of the file in bytes
 * @returns {number} chunk size in bytes
 */
export function calculateTeraBoxChunkSize(streamSize) {
  let chunkSize = 4 * 1024 * 1024;
  let threshold = 4 * 1024 * 1024 * 1024;
  if (streamSize < chunkSize) return Math.max(streamSize, 1);
  while (streamSize > threshold) {
    chunkSize <<= 1;
    threshold <<= 1;
  }
  return chunkSize;
}

/**
 * Human readable byte count for error messages.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytesForError(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let scaled = value;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  const decimals = scaled >= 100 || index === 0 ? 0 : 1;
  return `${scaled.toFixed(decimals)} ${units[index]}`;
}

/**
 * Validate + normalise a resume state against the file being uploaded.
 *
 * Fails LOUDLY: when the state does not belong to this file the uploader
 * refuses to run - the CALLER decides whether to restart from zero. A silent
 * "restart from zero" here would throw away the blocks the server already
 * holds without telling anyone.
 *
 * @param {TeraBoxResumeState} resumeState - State of an interrupted attempt
 * @param {string} path - Remote path this upload writes to
 * @param {number} size - Size of the blob being uploaded
 * @param {number} defaultChunkSize - Chunk size this build would use
 * @returns {{ uploadid: string, chunkSize: number, chunkCount: number, blockList: Array<string|undefined>, presentBytes: number }}
 */
export function prepareResumeState(resumeState, path, size, defaultChunkSize) {
  const uploadid = String(resumeState?.uploadid || '').trim();
  if (!uploadid) {
    throw new Error('TeraBox resume state has no uploadid - cannot resume this upload.');
  }

  const expectedSize = Number(resumeState?.size);
  if (!Number.isFinite(expectedSize) || expectedSize !== Number(size)) {
    throw new Error(
      `TeraBox resume state does not match this file (expected ${formatBytesForError(resumeState?.size)}, got ${formatBytesForError(size)}).`
    );
  }

  if (String(resumeState?.path || '') !== path) {
    throw new Error(
      `TeraBox resume state does not match this file (expected path ${resumeState?.path || '(none)'}, got ${path}).`
    );
  }

  const raw = resumeState?.blockList;
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) {
    throw new Error('TeraBox resume state has an invalid blockList - expected an array of md5 hashes.');
  }

  // The persisted chunk size owns the block boundaries of the live server
  // session, so it wins over the freshly computed one.
  const persistedChunkSize = Number(resumeState?.chunkSize);
  const chunkSize = Number.isFinite(persistedChunkSize) && persistedChunkSize > 0
    ? persistedChunkSize
    : defaultChunkSize;
  const chunkCount = Math.max(1, Math.ceil(size / chunkSize));

  const persisted = Array.isArray(raw) ? raw : [];
  if (persisted.length > chunkCount) {
    throw new Error(
      `TeraBox resume state does not match this file (expected ${chunkCount} blocks, got ${persisted.length}).`
    );
  }

  const blockList = new Array(chunkCount).fill(undefined);
  let presentBytes = 0;
  for (let i = 0; i < persisted.length; i++) {
    const md5 = typeof persisted[i] === 'string' ? persisted[i].trim() : '';
    // empty entry = never uploaded; the sentinel also means "absent"
    if (!md5 || md5 === ABSENT_BLOCK_MD5) continue;
    blockList[i] = md5;
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, size);
    presentBytes += Math.max(0, end - start);
  }

  return { uploadid, chunkSize, chunkCount, blockList, presentBytes };
}

/**
 * The PCS `create` call must carry a COMPLETE block list: a real md5 for
 * every block, never the "absent" sentinel. Fail loudly rather than create
 * a broken file.
 *
 * @param {Array<string|undefined>} blockList - md5 per chunk index
 * @param {number} chunkCount - Number of blocks the file is cut into
 * @returns {string[]} the complete block list
 */
export function assertCompleteBlockList(blockList, chunkCount) {
  const complete = [];
  for (let i = 0; i < chunkCount; i++) {
    const md5 = typeof blockList[i] === 'string' ? blockList[i].trim() : '';
    if (!md5) {
      throw new Error(`TeraBox upload is missing block ${i + 1} of ${chunkCount} - the file cannot be created.`);
    }
    if (md5 === ABSENT_BLOCK_MD5) {
      throw new Error(`TeraBox upload block ${i + 1} of ${chunkCount} is still marked absent - the file cannot be created.`);
    }
    complete.push(md5);
  }
  return complete;
}
