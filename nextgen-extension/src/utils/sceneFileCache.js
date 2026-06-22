/**
 * @fileoverview IndexedDB cache for scene file bytes (spz + texture).
 * @description Stores raw file bytes so the scene viewer doesn't depend on
 *              expiring UDrop download URLs. Kept separate from the main
 *              storage manager to avoid coupling.
 */

const DB_NAME = 'imgvault-scene-cache';
const DB_VERSION = 1;
const STORE_NAME = 'files';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Cache scene file bytes for a media item.
 * @param {string} mediaId - The media item ID (used as key).
 * @param {{ spzBytes: ArrayBuffer, textureBytes: ArrayBuffer }} files
 */
export async function cacheSceneFiles(mediaId, { spzBytes, textureBytes }) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ spzBytes, textureBytes, cachedAt: Date.now() }, mediaId);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Read cached scene file bytes.
 * @param {string} mediaId
 * @returns {Promise<{ spzBytes: ArrayBuffer, textureBytes: ArrayBuffer }|null>}
 */
export async function getCachedSceneFiles(mediaId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(mediaId);
    req.onsuccess = () => { db.close(); resolve(req.result || null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/**
 * Delete cached scene files.
 * @param {string} mediaId
 */
export async function deleteCachedSceneFiles(mediaId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(mediaId);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
