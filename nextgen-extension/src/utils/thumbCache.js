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

export async function clearAllCachedThumbs() {
  blobUrlMap.clear();
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[thumbCache] clearAll failed', err);
  }
}

export async function dumpCachedThumbs() {
  const db = await openDb();
  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).openCursor();
    const out = [];
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve(out);
      out.push({
        key: cur.key,
        type: cur.value?.blob?.type,
        size: cur.value?.blob?.size,
        cachedAt: cur.value?.cachedAt,
      });
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
  db.close();
  console.table(items);
  return items;
}

if (typeof window !== 'undefined') {
  window.__IMGVAULT_THUMB_DEBUG = true;
  window.imgvaultThumbCache = {
    clear: clearAllCachedThumbs,
    dump: dumpCachedThumbs,
  };
}

const blobUrlMap = new Map();

// Probe whether a blob: URL still renders as a usable image.
// Dead blob URLs (e.g., blobs whose underlying Blob was GC'd after a page
// reload, or blobs revoked elsewhere) fail to decode. Returns true if alive.
async function isBlobUrlAlive(blobUrl) {
  if (typeof blobUrl !== 'string' || !blobUrl.startsWith('blob:')) return false;
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const done = (ok) => {
      if (!settled) { settled = true; resolve(ok); }
    };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = blobUrl;
    setTimeout(() => done(false), 3000);
  });
}

export async function getThumbUrl(key, remoteUrl) {
  if (!key || !remoteUrl) return remoteUrl;
  // Validate in-memory blob URL hasn't gone stale since a previous session.
  if (blobUrlMap.has(key)) {
    const cached = blobUrlMap.get(key);
    if (await isBlobUrlAlive(cached)) return cached;
    blobUrlMap.delete(key);
  }
  const cached = await getCachedThumb(key);
  if (cached) {
    if (isImageBlob(cached)) {
      const url = URL.createObjectURL(cached);
      if (await isBlobUrlAlive(url)) {
        blobUrlMap.set(key, url);
        return url;
      }
      // blob from IndexedDB no longer decodes (corrupted) - prune it
      URL.revokeObjectURL(url).catch?.(() => {});
      deleteCachedThumb(key).catch(() => {});
    } else {
      // bad cached blob (e.g. error HTML page stored earlier) - prune and fall through
      deleteCachedThumb(key).catch(() => {});
    }
  }
  try {
    const res = await fetch(remoteUrl, { credentials: 'omit' });
    if (!res.ok) return remoteUrl;
    const blob = await res.blob();
    if (!isImageBlob(blob)) {
      return remoteUrl;
    }
    setCachedThumb(key, blob);
    const url = URL.createObjectURL(blob);
    blobUrlMap.set(key, url);
    return url;
  } catch {
    return remoteUrl;
  }
}

function isImageBlob(blob) {
  return Boolean(blob && typeof blob === 'object' && typeof blob.type === 'string' && blob.type.startsWith('image/'));
}
