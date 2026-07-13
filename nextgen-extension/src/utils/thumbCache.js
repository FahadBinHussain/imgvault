const DB_NAME = 'imgvault-thumb-cache';
const DB_VERSION = 1;
const STORE_NAME = 'thumbs';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

export async function getCachedThumb(key) {
  try {
    const db = await openDb();
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!result) return null;
    if (Date.now() - result.cachedAt > MAX_AGE_MS) return null;
    return result.blob;
  } catch {
    return null;
  }
}

export async function setCachedThumb(key, blob) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ blob, cachedAt: Date.now() }, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {}
}

export async function deleteCachedThumb(key) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {}
}

const blobUrlMap = new Map();

export async function getThumbUrl(key, remoteUrl) {
  if (blobUrlMap.has(key)) return blobUrlMap.get(key);
  const cached = await getCachedThumb(key);
  if (cached) {
    const url = URL.createObjectURL(cached);
    blobUrlMap.set(key, url);
    return url;
  }
  try {
    const res = await fetch(remoteUrl);
    if (!res.ok) return remoteUrl;
    const blob = await res.blob();
    setCachedThumb(key, blob);
    const url = URL.createObjectURL(blob);
    blobUrlMap.set(key, url);
    return url;
  } catch {
    return remoteUrl;
  }
}
