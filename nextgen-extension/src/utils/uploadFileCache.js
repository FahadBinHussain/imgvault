/**
 * @fileoverview IndexedDB cache for upload source files.
 * @description A picked File/Blob dies with the page that holds it: close the
 *              browser mid-upload and the bytes are gone, so the upload can
 *              never be retried. This module copies the picked file into an
 *              IndexedDB store so the run survives a restart and the upload
 *              can be resumed later.
 *
 *              Shape of the store:
 *                database  imgvault-upload-cache (version 1)
 *                store     files, keyPath 'runId'
 *                record    { runId, fileName, mimeType, bytes, cachedAt, blob }
 *
 *              The `blob` field holds the File/Blob itself. File objects are
 *              structured-cloneable, so `name`, `type` and `lastModified`
 *              survive the round trip and a resumed upload gets the very same
 *              file back - not a stripped-down copy.
 *
 *              This module runs in an EXTENSION PAGE (the gallery page), where
 *              IndexedDB is available. It deliberately uses no chrome.* API and
 *              no service-worker-only assumption, so it stays importable from
 *              the worker later on.
 *
 *              Failure policy: NOTHING is swallowed here. If the browser
 *              refuses to persist the file (quota exhausted, private mode,
 *              file too large) the write REJECTS with the underlying reason,
 *              and the caller learns that resume is impossible instead of
 *              being handed a fake success.
 * @version 1.0.0
 */

const DB_NAME = 'imgvault-upload-cache';
const DB_VERSION = 1;
const STORE_NAME = 'files';

/**
 * Open (and if needed create) the upload file cache database.
 * @returns {Promise<IDBDatabase>}
 * @throws {Error} when IndexedDB is unavailable or the database cannot be opened
 */
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      reject(new Error('IndexedDB is not available in this context, the upload file cache cannot be used.'));
      return;
    }

    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'runId' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Never hold the connection hostage: a later schema bump must not be
      // blocked by this tab keeping the old version open.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('The upload file cache database is blocked by another open tab.'));
  });
}

/**
 * True when the value can be stored as a blob payload.
 * Duck-typing keeps a File that came from another realm usable.
 * @param {*} value
 * @returns {boolean}
 */
function isBlobLike(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return true;
  }
  return typeof value.size === 'number'
    && typeof value.type === 'string'
    && typeof value.slice === 'function';
}

/**
 * Describe a storage failure in a way that names the actual reason.
 * @param {*} error
 * @returns {string}
 */
function describeError(error) {
  if (!error) {
    return 'unknown storage error';
  }
  if (error.name && error.message) {
    return `${error.name}: ${error.message}`;
  }
  return error.message || error.name || String(error);
}

/**
 * Wrap a storage failure into a loud, self-describing error.
 * The original error is kept on `cause`, and its `name` is mirrored (for
 * example 'QuotaExceededError') so a caller can tell a quota refusal apart
 * from any other storage failure.
 * @param {string} prefix - what was being attempted
 * @param {*} error - the underlying failure
 * @returns {Error}
 */
function wrapFailure(prefix, error) {
  const wrapped = new Error(`${prefix}: ${describeError(error)}`);
  if (error && error.name) {
    wrapped.name = error.name;
  }
  if (error) {
    wrapped.cause = error;
  }
  return wrapped;
}

/**
 * Store a picked file so the upload can be resumed after a browser restart.
 *
 * The write is real or it throws - there is no `{ cached: false }` outcome.
 * A browser that refuses to persist the file (quota, private mode, file too
 * large) rejects with the underlying reason, so the caller can tell the user
 * that this upload cannot be resumed.
 *
 * @param {File|Blob} file - the picked file, stored as-is so name/type/lastModified survive
 * @param {Object} [options]
 * @param {string} options.runId - the upload run id this file belongs to (required)
 * @param {string} [options.fileName] - display name, defaults to the file's own name
 * @returns {Promise<{cached: boolean, runId: string, fileName: string, bytes: number, cachedAt: number}>}
 * @throws {Error} 'No file to cache for upload resume.' when the file is missing, not a File/Blob or empty
 * @throws {Error} 'A runId is required to cache an upload file.' when no runId is given
 * @throws {Error} when the browser refuses to persist the file
 */
export async function cacheUploadFile(file, { runId, fileName } = {}) {
  if (!isBlobLike(file) || Number(file.size) === 0) {
    throw new Error('No file to cache for upload resume.');
  }

  const id = String(runId || '').trim();
  if (!id) {
    throw new Error('A runId is required to cache an upload file.');
  }

  const record = {
    runId: id,
    fileName: String(fileName || file.name || '').trim() || 'upload-file',
    mimeType: file.type || '',
    bytes: Number(file.size) || 0,
    cachedAt: Date.now(),
    blob: file,
  };

  let db = null;
  try {
    db = await openDb();
    await new Promise((resolve, reject) => {
      let failure = null;
      const capture = (error) => {
        if (error && !failure) {
          failure = error;
        }
      };

      let tx;
      try {
        tx = db.transaction(STORE_NAME, 'readwrite');
      } catch (error) {
        reject(error);
        return;
      }

      tx.oncomplete = () => resolve();
      tx.onerror = (event) => {
        capture(tx.error || (event && event.target ? event.target.error : null));
        reject(failure || tx.error);
      };
      tx.onabort = () => {
        capture(tx.error);
        reject(failure || tx.error);
      };

      const request = tx.objectStore(STORE_NAME).put(record);
      request.onerror = (event) => {
        // The request error is the most specific reason we get (quota, size).
        capture((event && event.target ? event.target.error : null) || request.error);
      };
    });
  } catch (error) {
    throw wrapFailure('Failed to cache upload file for resume', error);
  } finally {
    if (db) {
      db.close();
    }
  }

  return {
    cached: true,
    runId: record.runId,
    fileName: record.fileName,
    bytes: record.bytes,
    cachedAt: record.cachedAt,
  };
}

/**
 * Read back a cached file for a run.
 * @param {string} runId - the upload run id
 * @returns {Promise<File|Blob|null>} the stored file, or null when nothing is cached for that run
 * @throws {Error} when the cache itself cannot be read
 */
export async function getCachedUploadFile(runId) {
  const id = String(runId || '').trim();
  if (!id) {
    return null;
  }

  let db = null;
  try {
    db = await openDb();
    const record = await new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(STORE_NAME, 'readonly');
      } catch (error) {
        reject(error);
        return;
      }

      const request = tx.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = (event) => reject((event && event.target ? event.target.error : null) || request.error);
      tx.onabort = () => reject(tx.error);
    });

    return (record && record.blob) || null;
  } catch (error) {
    throw wrapFailure('Failed to read cached upload file for resume', error);
  } finally {
    if (db) {
      db.close();
    }
  }
}

/**
 * Drop the cached file of a run once the upload finished (or was abandoned).
 * Safe to call when nothing is cached for that run.
 * @param {string} runId - the upload run id
 * @returns {Promise<boolean>} true when an entry was actually removed, false when nothing was cached
 * @throws {Error} when the cache cannot be written to
 */
export async function removeCachedUploadFile(runId) {
  const id = String(runId || '').trim();
  if (!id) {
    return false;
  }

  let db = null;
  try {
    db = await openDb();
    return await new Promise((resolve, reject) => {
      let existed = false;
      let tx;
      try {
        tx = db.transaction(STORE_NAME, 'readwrite');
      } catch (error) {
        reject(error);
        return;
      }

      tx.oncomplete = () => resolve(existed);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);

      const store = tx.objectStore(STORE_NAME);
      const lookup = store.get(id);
      lookup.onsuccess = () => {
        existed = Boolean(lookup.result);
        if (existed) {
          store.delete(id);
        }
      };
      lookup.onerror = () => reject(lookup.error);
    });
  } catch (error) {
    throw wrapFailure('Failed to remove cached upload file for resume', error);
  } finally {
    if (db) {
      db.close();
    }
  }
}

/**
 * List every cached file, newest first.
 * The blob payload is deliberately left out - this is metadata for the UI.
 * @returns {Promise<Array<{runId: string, fileName: string, mimeType: string, bytes: number, cachedAt: number}>>}
 * @throws {Error} when the cache cannot be read
 */
export async function listCachedUploadFiles() {
  let db = null;
  try {
    db = await openDb();
    const entries = await new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(STORE_NAME, 'readonly');
      } catch (error) {
        reject(error);
        return;
      }

      const out = [];
      const request = tx.objectStore(STORE_NAME).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        const record = cursor.value || {};
        out.push({
          runId: record.runId || cursor.key || '',
          fileName: record.fileName || '',
          mimeType: record.mimeType || '',
          bytes: Number(record.bytes) || 0,
          cachedAt: Number(record.cachedAt) || 0,
        });
        cursor.continue();
      };
      request.onerror = (event) => reject((event && event.target ? event.target.error : null) || request.error);
      tx.onabort = () => reject(tx.error);
    });

    return entries.sort((a, b) => (b.cachedAt - a.cachedAt) || String(a.runId).localeCompare(String(b.runId)));
  } catch (error) {
    throw wrapFailure('Failed to list cached upload files for resume', error);
  } finally {
    if (db) {
      db.close();
    }
  }
}
