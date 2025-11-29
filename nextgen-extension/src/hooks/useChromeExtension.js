/**
 * @fileoverview Custom React hooks for Chrome Extension APIs
 * @version 2.0.0
 */

import { useState, useEffect, useCallback } from 'react';

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
    console.log('[useChromeMessage] Sending message:', action, data);
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action, data },
        (response) => {
          console.log('[useChromeMessage] Response received:', response);
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
  const sendMessage = useChromeMessage();

  useEffect(() => {
    // Listen for upload status updates
    const handleStorageChange = (changes, area) => {
      if (area === 'local' && changes.uploadStatus) {
        setProgress(changes.uploadStatus.newValue || '');
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
    }
  }, [sendMessage]);

  return {
    uploadImage,
    uploading,
    progress,
    error
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

  const loadImages = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const images = await sendMessage('getImages');
      console.log('✅ Loaded images from background:', images);
      console.log('🔍 First image collectionId check:', images[0]?.collectionId, 'Type:', typeof images[0]?.collectionId);
      setImages(images || []);
    } catch (err) {
      console.error('Error loading images:', err);
      setError(err);
      setImages([]);
    } finally {
      setLoading(false);
    }
  }, [sendMessage]);

  const deleteImage = useCallback(async (id) => {
    try {
      await sendMessage('deleteImage', { id });
      setImages(prev => prev.filter(img => img.id !== id));
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [sendMessage]);

  useEffect(() => {
    loadImages();
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
      console.log('Loaded trashed images from background:', images);
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
      console.log('Loaded collections from background:', collectionsData);
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
