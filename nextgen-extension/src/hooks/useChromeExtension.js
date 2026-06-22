/**
 * @fileoverview Custom React hooks for Chrome Extension APIs
 * @version 2.0.0
 */

import { useState, useEffect, useCallback } from 'react';

const DEBUG_CHROME_MESSAGES = false;
const GALLERY_IMAGES_CACHE_KEY = 'imgvaultGalleryImagesCache';
const GALLERY_IMAGES_CACHE_MAX_AGE = 1000 * 60 * 60 * 24;

const summarizePayload = (payload) => {
  if (Array.isArray(payload)) return `[${payload.length} items]`;
  if (payload && typeof payload === 'object') {
    return Object.fromEntries(Object.entries(payload).map(([key, value]) => [
      key,
      Array.isArray(value) ? `[${value.length} items]` : value,
    ]));
  }
  return payload;
};

const readLocalStorage = (keys) => new Promise((resolve) => {
  chrome.storage.local.get(keys, (result) => resolve(result || {}));
});

const writeGalleryImagesCache = (images) => {
  chrome.storage.local.set({
    [GALLERY_IMAGES_CACHE_KEY]: {
      savedAt: Date.now(),
      images,
    },
  }, () => {
    if (chrome.runtime.lastError && DEBUG_CHROME_MESSAGES) {
      console.warn('[ImgVault] Gallery cache skipped:', chrome.runtime.lastError.message);
    }
  });
};

/**
 * Hook for Chrome storage (sync or local)
 * @param {string} key - Storage key
 * @param {*} defaultValue - Default value
 * @param {'sync'|'local'} area - Storage area
 * @returns {[any, Function, boolean]} [value, setValue, loading]
 */
export function useChromeStorage(key, defaultValue = null, area = 'sync') {
  const [value, setValue] = useState(defaultValue);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load initial value
    chrome.storage[area].get([key], (result) => {
      setValue(result[key] ?? defaultValue);
      setLoading(false);
    });

    // Listen for changes
    const handleChange = (changes, areaName) => {
      if (areaName === area && changes[key]) {
        setValue(changes[key].newValue ?? defaultValue);
      }
    };

    chrome.storage.onChanged.addListener(handleChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleChange);
    };
  }, [key, area, defaultValue]);

  const updateValue = useCallback((newValue) => {
    chrome.storage[area].set({ [key]: newValue });
  }, [key, area]);

  return [value, updateValue, loading];
}

/**
 * Hook for sending messages to background script
 * @returns {Function} sendMessage function
 */
export function useChromeMessage() {
  const sendMessage = useCallback((action, data = {}) => {
    if (DEBUG_CHROME_MESSAGES) {
      console.log('[useChromeMessage] Sending message:', action, summarizePayload(data));
    }
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action, data },
        (response) => {
          if (DEBUG_CHROME_MESSAGES) {
            console.log('[useChromeMessage] Response received:', summarizePayload(response));
          }
          if (chrome.runtime.lastError) {
            console.error('[useChromeMessage] Runtime error:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
          } else if (response?.success) {
            resolve(response.data);
          } else {
            const error = new Error(response?.error || 'Unknown error');
            // Attach duplicate data if present
            if (response?.duplicate) {
              error.duplicate = response.duplicate;
            }
            if (response?.allDuplicates) {
              error.allDuplicates = response.allDuplicates;
            }
            console.error('[useChromeMessage] Error:', error);
            reject(error);
          }
        }
      );
    });
  }, []);

  return sendMessage;
}

/**
 * Hook for uploading image
 * @returns {Object} Upload state and function
 */
export function useImageUpload() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);
  const [history, setHistory] = useState([]);
  const sendMessage = useChromeMessage();

  useEffect(() => {
    chrome.storage.local.get(['uploadStatusLogs', 'uploadLogHistory', 'uploadActive', 'uploadStatus'], (result) => {
      setLogs(result.uploadStatusLogs || []);
      setHistory(result.uploadLogHistory || []);
      setUploading(Boolean(result.uploadActive));
      setProgress(result.uploadStatus || '');
    });

    // Listen for upload status updates
    const handleStorageChange = (changes, area) => {
      if (area !== 'local') {
        return;
      }

      if (changes.uploadStatus) {
        setProgress(changes.uploadStatus.newValue || '');
      }

      if (changes.uploadActive) {
        setUploading(Boolean(changes.uploadActive.newValue));
      }

      if (changes.uploadStatusLogs) {
        setLogs(changes.uploadStatusLogs.newValue || []);
      }

      if (changes.uploadLogHistory) {
        setHistory(changes.uploadLogHistory.newValue || []);
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const uploadImage = useCallback(async (imageData) => {
    setUploading(true);
    setError(null);
    setProgress('Starting upload...');
    setLogs([]);
    chrome.storage.local.set({ uploadStatusLogs: [], uploadActive: true, uploadStatus: 'Starting upload...' });

    try {
      const result = await sendMessage('uploadImage', imageData);
      setProgress('✅ Upload successful!');
      return result;
    } catch (err) {
      setError(err);
      setProgress('');
      throw err;
    } finally {
      setUploading(false);
      chrome.storage.local.set({ uploadActive: false });
    }
  }, [sendMessage]);

  const cancelUpload = useCallback(async () => {
    try {
      await sendMessage('cancelUpload');
    } finally {
      setUploading(false);
      setProgress('');
      chrome.storage.local.set({ uploadActive: false, uploadStatus: '' });
    }
  }, [sendMessage]);

  return {
    uploadImage,
    cancelUpload,
    uploading,
    progress,
    error,
    logs,
    history
  };
}

/**
 * Hook for uploading 3D scenes
 * @returns {Object} Scene upload state and function
 */
export function useSceneUpload() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);
  const sendMessage = useChromeMessage();

  useEffect(() => {
    chrome.storage.local.get(['uploadStatusLogs', 'uploadActive', 'uploadStatus'], (result) => {
      setLogs(result.uploadStatusLogs || []);
      setUploading(Boolean(result.uploadActive));
      setProgress(result.uploadStatus || '');
    });

    const handleStorageChange = (changes, area) => {
      if (area !== 'local') return;
      if (changes.uploadStatus) setProgress(changes.uploadStatus.newValue || '');
      if (changes.uploadActive) setUploading(Boolean(changes.uploadActive.newValue));
      if (changes.uploadStatusLogs) setLogs(changes.uploadStatusLogs.newValue || []);
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  const uploadScene = useCallback(async (sceneData) => {
    setUploading(true);
    setError(null);
    setProgress('Starting scene upload...');
    setLogs([]);
    chrome.storage.local.set({ uploadStatusLogs: [], uploadActive: true, uploadStatus: 'Starting scene upload...' });

    try {
      const result = await sendMessage('uploadScene', sceneData);
      setProgress('✅ Scene uploaded!');
      return result;
    } catch (err) {
      setError(err);
      setProgress('');
      throw err;
    } finally {
      setUploading(false);
      chrome.storage.local.set({ uploadActive: false });
    }
  }, [sendMessage]);

  return {
    uploadScene,
    uploading,
    progress,
    error,
    logs,
  };
}

/**
 * Hook for managing images
 * @returns {Object} Images state and functions
 */
export function useImages() {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const sendMessage = useChromeMessage();

  const loadImages = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);

    try {
      const images = await sendMessage('getImages');
      const nextImages = images || [];
      if (DEBUG_CHROME_MESSAGES) {
        console.log('✅ Loaded gallery images from background:', nextImages.length);
      }
      setImages(nextImages);
      writeGalleryImagesCache(nextImages);
    } catch (err) {
      console.error('Error loading images:', err);
      setError(err);
      if (!silent) setImages([]);
    } finally {
      setLoading(false);
    }
  }, [sendMessage]);

  const deleteImage = useCallback(async (id) => {
    try {
      await sendMessage('deleteImage', { id });
      setImages(prev => {
        const next = prev.filter(img => img.id !== id);
        writeGalleryImagesCache(next);
        return next;
      });
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [sendMessage]);

  useEffect(() => {
    let cancelled = false;

    readLocalStorage([GALLERY_IMAGES_CACHE_KEY]).then((result) => {
      if (cancelled) return;

      const cached = result[GALLERY_IMAGES_CACHE_KEY];
      const cachedImages = Array.isArray(cached?.images) ? cached.images : null;
      const cacheFresh = cachedImages && Date.now() - Number(cached.savedAt || 0) < GALLERY_IMAGES_CACHE_MAX_AGE;

      if (cacheFresh) {
        setImages(cachedImages);
        setLoading(false);
        loadImages({ silent: true });
      } else {
        loadImages();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loadImages]);

  return {
    images,
    loading,
    error,
    reload: loadImages,
    deleteImage
  };
}

/**
 * Hook for managing hidden vault items
 * @returns {Object} Vault state and actions
 */
export function useVault() {
  const [vaultImages, setVaultImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const sendMessage = useChromeMessage();

  const loadVaultImages = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const images = await sendMessage('getVaultImages');
      setVaultImages(images || []);
    } catch (err) {
      console.error('Error loading vault images:', err);
      setError(err);
      setVaultImages([]);
    } finally {
      setLoading(false);
    }
  }, [sendMessage]);

  const moveToVault = useCallback(async (id) => {
    try {
      await sendMessage('moveToVault', { id });
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [sendMessage]);

  const restoreFromVault = useCallback(async (id) => {
    try {
      await sendMessage('restoreFromVault', { id });
      setVaultImages(prev => prev.filter(img => img.id !== id));
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [sendMessage]);

  useEffect(() => {
    loadVaultImages();
  }, [loadVaultImages]);

  return {
    vaultImages,
    loading,
    error,
    reload: loadVaultImages,
    moveToVault,
    restoreFromVault,
  };
}

/**
 * Hook for managing trashed images
 * @returns {Object} Trashed images state and functions
 */
export function useTrash() {
  const [trashedImages, setTrashedImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const sendMessage = useChromeMessage();

  const loadTrashedImages = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const images = await sendMessage('getTrashedImages');
      if (DEBUG_CHROME_MESSAGES) {
        console.log('Loaded trashed images from background:', Array.isArray(images) ? images.length : 0);
      }
      setTrashedImages(images || []);
    } catch (err) {
      console.error('Error loading trashed images:', err);
      setError(err);
      setTrashedImages([]);
    } finally {
      setLoading(false);
    }
  }, [sendMessage]);

  const restoreFromTrash = useCallback(async (id) => {
    try {
      await sendMessage('restoreFromTrash', { id });
      setTrashedImages(prev => prev.filter(img => img.id !== id));
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [sendMessage]);

  const permanentlyDelete = useCallback(async (id) => {
    try {
      await sendMessage('permanentlyDelete', { id });
      setTrashedImages(prev => prev.filter(img => img.id !== id));
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [sendMessage]);

  const emptyTrash = useCallback(async () => {
    try {
      const deletedCount = await sendMessage('emptyTrash');
      setTrashedImages([]);
      return deletedCount;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [sendMessage]);

  useEffect(() => {
    loadTrashedImages();
  }, [loadTrashedImages]);

  return {
    trashedImages,
    loading,
    error,
    reload: loadTrashedImages,
    restoreFromTrash,
    permanentlyDelete,
    emptyTrash
  };
}

/**
 * Hook for pending image data
 * @returns {[Object|null, Function]} [pendingImage, clearPending]
 */
export function usePendingImage() {
  const [pendingImage, setPendingImage] = useChromeStorage('pendingImage', null, 'local');

  const clearPending = useCallback(() => {
    chrome.storage.local.remove('pendingImage');
  }, []);

  return [pendingImage, clearPending];
}

/**
 * Hook for managing collections
 * @returns {Object} Collections state and functions
 */
export function useCollections() {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const sendMessage = useChromeMessage();

  const loadCollections = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const collectionsData = await sendMessage('getCollections');
      if (DEBUG_CHROME_MESSAGES) {
        console.log('Loaded collections from background:', Array.isArray(collectionsData) ? collectionsData.length : 0);
      }
      setCollections(collectionsData || []);
    } catch (err) {
      console.error('Error loading collections:', err);
      setError(err);
      setCollections([]);
    } finally {
      setLoading(false);
    }
  }, [sendMessage]);

  const createCollection = useCallback(async (collectionData) => {
    try {
      const newCollection = await sendMessage('createCollection', collectionData);
      setCollections(prev => [...prev, newCollection]);
      return newCollection;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [sendMessage]);

  const updateCollection = useCallback(async (id, updates) => {
    try {
      const updatedCollection = await sendMessage('updateCollection', { id, updates });
      setCollections(prev => prev.map(c => c.id === id ? updatedCollection : c));
      return updatedCollection;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [sendMessage]);

  const deleteCollection = useCallback(async (id) => {
    try {
      await sendMessage('deleteCollection', { id });
      setCollections(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [sendMessage]);

  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  return {
    collections,
    loading,
    error,
    reload: loadCollections,
    createCollection,
    updateCollection,
    deleteCollection
  };
}
