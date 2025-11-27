/**
 * @fileoverview Firestore REST API Storage Manager for ImgVault
 * @description Compatible with Manifest V3 service workers with modern ES6+ patterns
 * @version 2.0.0
 */

/**
 * @typedef {Object} FirebaseConfig
 * @property {string} apiKey - Firebase API key
 * @property {string} authDomain - Firebase auth domain
 * @property {string} projectId - Firebase project ID
 * @property {string} storageBucket - Firebase storage bucket
 * @property {string} messagingSenderId - Firebase messaging sender ID
 * @property {string} appId - Firebase app ID
 * @property {string} [measurementId] - Firebase measurement ID
 */

/**
 * @typedef {Object} ImageData
 * @property {string} pixvidUrl - Pixvid image URL
 * @property {string} pixvidDeleteUrl - Pixvid delete URL
 * @property {string} [imgbbUrl] - ImgBB image URL
 * @property {string} [imgbbDeleteUrl] - ImgBB delete URL
 * @property {string} [imgbbThumbUrl] - ImgBB thumbnail URL
 * @property {string} sourceImageUrl - Original source image URL
 * @property {string} sourcePageUrl - Source page URL
 * @property {string} [pageTitle] - Page title
 * @property {string} [fileName] - File name
 * @property {string} [fileType] - MIME type
 * @property {number} [fileSize] - File size in bytes
 * @property {number} [width] - Image width
 * @property {number} [height] - Image height
 * @property {string} [sha256] - SHA-256 hash
 * @property {string} [pHash] - Perceptual hash
 * @property {string} [aHash] - Average hash
 * @property {string} [dHash] - Difference hash
 * @property {string[]} [tags] - Image tags
 * @property {string} [description] - Image description
 */

/**
 * Storage manager for Firebase Firestore operations
 */
export class StorageManager {
  constructor() {
    /** @type {FirebaseConfig|null} */
    this.config = null;
    /** @type {boolean} */
    this.initialized = false;
    /** @type {string} */
    this.baseUrl = '';
  }

  /**
   * Initialize storage manager with Firebase config
   * @returns {Promise<boolean>} Success status
   */
  async init() {
    console.log('🔵 StorageManager.init() called');
    
    const result = await chrome.storage.sync.get(['firebaseConfig']);
    console.log('🔵 Firebase config from storage:', result.firebaseConfig ? 'found' : 'not found');
    
    if (!result.firebaseConfig) {
      console.warn('⚠️ Firebase not configured');
      return false;
    }

    this.config = result.firebaseConfig;
    this.baseUrl = `https://firestore.googleapis.com/v1/projects/${this.config.projectId}/databases/(default)/documents`;
    this.initialized = true;
    
    console.log('✅ StorageManager initialized with project:', this.config.projectId);
    return true;
  }

  /**
   * Ensure storage is initialized
   * @private
   * @throws {Error} If Firebase not configured
   */
  async ensureInitialized() {
    if (!this.initialized) {
      const success = await this.init();
      if (!success) {
        throw new Error('Firebase not configured. Please set up Firebase in settings.');
      }
    }
  }

  /**
   * Build Firestore API URL
   * @private
   * @param {string} path - Document path
   * @param {Object} [params] - Query parameters
   * @returns {string} Complete URL
   */
  buildUrl(path, params = {}) {
    const url = new URL(`${this.baseUrl}/${path}`);
    url.searchParams.set('key', this.config.apiKey);
    
    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach(v => url.searchParams.append(key, v));
      } else {
        url.searchParams.set(key, value);
      }
    });
    
    return url.toString();
  }

  /**
   * Convert JavaScript object to Firestore document format
   * @private
   * @param {Object} data - JavaScript object
   * @returns {Object} Firestore document
   */
  toFirestoreDoc(data) {
    const fields = {};
    
    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) continue;
      
      if (typeof value === 'string') {
        fields[key] = { stringValue: value };
      } else if (typeof value === 'number') {
        if (Number.isInteger(value)) {
          fields[key] = { integerValue: value };
        } else {
          fields[key] = { doubleValue: value };
        }
      } else if (typeof value === 'boolean') {
        fields[key] = { booleanValue: value };
      } else if (Array.isArray(value)) {
        fields[key] = {
          arrayValue: {
            values: value.map(v => ({ stringValue: String(v) }))
          }
        };
      } else if (value instanceof Date) {
        fields[key] = { timestampValue: value.toISOString() };
      }
    }
    
    return { fields };
  }

  /**
   * Convert Firestore document to JavaScript object
   * @private
   * @param {Object} doc - Firestore document
   * @returns {Object} JavaScript object
   */
  fromFirestoreDoc(doc) {
    const id = doc.name.split('/').pop();
    const fields = doc.fields;
    
    return {
      id,
      pixvidUrl: fields.pixvidUrl?.stringValue || '',
      pixvidDeleteUrl: fields.pixvidDeleteUrl?.stringValue || '',
      imgbbUrl: fields.imgbbUrl?.stringValue || '',
      imgbbDeleteUrl: fields.imgbbDeleteUrl?.stringValue || '',
      imgbbThumbUrl: fields.imgbbThumbUrl?.stringValue || '',
      sourceImageUrl: fields.sourceImageUrl?.stringValue || '',
      sourcePageUrl: fields.sourcePageUrl?.stringValue || '',
      pageTitle: fields.pageTitle?.stringValue || '',
      fileName: fields.fileName?.stringValue || '',
      fileType: fields.fileType?.stringValue || '',
      fileSize: parseInt(fields.fileSize?.integerValue || '0'),
      width: parseInt(fields.width?.integerValue || '0'),
      height: parseInt(fields.height?.integerValue || '0'),
      sha256: fields.sha256?.stringValue || '',
      pHash: fields.pHash?.stringValue || '',
      aHash: fields.aHash?.stringValue || '',
      dHash: fields.dHash?.stringValue || '',
      tags: fields.tags?.arrayValue?.values?.map(v => v.stringValue) || [],
      description: fields.description?.stringValue || '',
      internalAddedTimestamp: fields.internalAddedTimestamp?.timestampValue || ''
    };
  }

  /**
   * Save image metadata to Firestore
   * @param {ImageData} imageData - Image metadata
   * @returns {Promise<string>} Document ID
   */
  async saveImage(imageData) {
    await this.ensureInitialized();

    try {
      // Log the data size before saving
      const dataSize = JSON.stringify(imageData).length;
      console.log('📊 [SAVE IMAGE] Image metadata size:', dataSize, 'bytes');
      
      if (dataSize > 10000000) { // 10MB
        console.warn('⚠️ [SAVE IMAGE] Payload approaching Firebase limit!');
        console.log('📦 [SAVE IMAGE] Data keys:', Object.keys(imageData));
        console.log('📏 [SAVE IMAGE] Field sizes:', 
          Object.entries(imageData).map(([key, val]) => 
            `${key}: ${JSON.stringify(val).length} bytes`
          )
        );
      }
      
      const doc = this.toFirestoreDoc({
        ...imageData,
        internalAddedTimestamp: new Date()
      });

      const url = this.buildUrl('images');
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc)
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ [SAVE IMAGE] Firebase error:', error);
        throw new Error(error.error?.message || 'Failed to save to Firestore');
      }

      const result = await response.json();
      const docId = result.name.split('/').pop();
      console.log('✅ [SAVE IMAGE] Saved successfully with ID:', docId);
      return docId;
    } catch (error) {
      console.error('Error saving to Firestore:', error);
      throw error;
    }
  }

  /**
   * Get all images with full data for duplicate checking
   * @returns {Promise<Array>} Array of images with full metadata
   */
  async getAllImagesForDuplicateCheck() {
    await this.ensureInitialized();

    try {
      console.log('🔍 [DUPLICATE CHECK] Fetching ALL image data (including hashes from active AND trash)...');
      const startTime = performance.now();
      
      // Fetch active images
      const imagesUrl = this.buildUrl('images', { orderBy: 'internalAddedTimestamp desc' });
      const imagesResponse = await fetch(imagesUrl);
      
      if (!imagesResponse.ok) {
        throw new Error('Failed to fetch active images');
      }

      const imagesResult = await imagesResponse.json();
      const activeImages = imagesResult.documents 
        ? imagesResult.documents.map(doc => this.fromFirestoreDoc(doc))
        : [];

      console.log(`🔍 [DUPLICATE CHECK] Found ${activeImages.length} active images`);

      // Fetch trashed images
      const trashUrl = this.buildUrl('trash', { orderBy: 'deletedAt desc' });
      const trashResponse = await fetch(trashUrl);
      
      let trashedImages = [];
      if (trashResponse.ok) {
        const trashResult = await trashResponse.json();
        if (trashResult.documents) {
          trashedImages = trashResult.documents.map(doc => {
            const id = doc.name.split('/').pop();
            const fields = doc.fields;
            
            return {
              id,
              pixvidUrl: fields.pixvidUrl?.stringValue || '',
              imgbbUrl: fields.imgbbUrl?.stringValue || '',
              imgbbThumbUrl: fields.imgbbThumbUrl?.stringValue || '',
              sourceImageUrl: fields.sourceImageUrl?.stringValue || '',
              sha256: fields.sha256?.stringValue || '',
              pHash: fields.pHash?.stringValue || '',
              aHash: fields.aHash?.stringValue || '',
              dHash: fields.dHash?.stringValue || '',
              internalAddedTimestamp: fields.internalAddedTimestamp?.timestampValue || fields.internalAddedTimestamp?.stringValue || '',
              deletedAt: fields.deletedAt?.timestampValue || fields.deletedAt?.stringValue || '',
              _isTrash: true  // Mark as trashed for duplicate error message
            };
          });
        }
      }

      console.log(`🔍 [DUPLICATE CHECK] Found ${trashedImages.length} trashed images`);

      // Combine both active and trashed images
      const allImages = [...activeImages, ...trashedImages];
      
      const endTime = performance.now();
      console.log(`✅ [DUPLICATE CHECK] Loaded ${allImages.length} total images (${activeImages.length} active + ${trashedImages.length} trash) with full hash data in ${(endTime - startTime).toFixed(2)}ms`);
      
      return allImages;
    } catch (error) {
      console.error('Error getting images for duplicate check:', error);
      return [];
    }
  }

  /**
   * Get all images (lightweight data for gallery)
   * @returns {Promise<Array>} Array of images with essential fields
   */
  async getAllImages() {
    await this.ensureInitialized();

    try {
      console.log('📊 [OPTIMIZE] Fetching lightweight gallery data...');
      const startTime = performance.now();
      
      // Only fetch essential fields for gallery view
      const maskFields = [
        'pixvidUrl', 'imgbbUrl', 'imgbbThumbUrl', 'sourceImageUrl',
        'sourcePageUrl', 'pageTitle', 'tags', 'description', 'internalAddedTimestamp'
      ];
      
      const url = this.buildUrl('images', {
        orderBy: 'internalAddedTimestamp desc',
        'mask.fieldPaths': maskFields
      });
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('Failed to fetch images');
      }

      const result = await response.json();
      const endTime = performance.now();
      
      if (!result.documents) {
        console.log('📊 [OPTIMIZE] No images found in gallery');
        return [];
      }

      const images = result.documents.map(doc => this.fromFirestoreDoc(doc));
      
      console.log(`✅ [OPTIMIZE] Loaded ${images.length} images in ${(endTime - startTime).toFixed(2)}ms (lightweight mode)`);
      
      return images;
    } catch (error) {
      console.error('Error getting images:', error);
      return [];
    }
  }

  /**
   * Get image by ID with full details
   * @param {string} id - Image document ID
   * @returns {Promise<Object|null>} Image object or null
   */
  async getImageById(id) {
    await this.ensureInitialized();

    try {
      console.log(`🔍 [LAZY LOAD] Fetching full details for image: ${id}`);
      const startTime = performance.now();
      
      const url = this.buildUrl(`images/${id}`);
      const response = await fetch(url);
      
      if (!response.ok) {
        return null;
      }

      const doc = await response.json();
      const endTime = performance.now();
      
      console.log(`✅ [LAZY LOAD] Full details loaded in ${(endTime - startTime).toFixed(2)}ms`);
      
      return this.fromFirestoreDoc(doc);
    } catch (error) {
      console.error('Error getting image:', error);
      return null;
    }
  }

  /**
   * Move image to trash (soft delete)
   * @param {string} id - Image document ID
   * @returns {Promise<void>}
   */
  async moveToTrash(id) {
    await this.ensureInitialized();

    try {
      console.log('🗑️ [TRASH] Moving image to trash:', id);
      
      // Get the image data from images collection
      const imageData = await this.getImageById(id);
      
      if (!imageData) {
        throw new Error('Image not found');
      }
      
      // Create trash document with all image data plus deletedAt timestamp
      const trashDoc = this.toFirestoreDoc({
        ...imageData,
        originalId: id,
        internalAddedTimestamp: imageData.internalAddedTimestamp ? new Date(imageData.internalAddedTimestamp) : new Date(),
        deletedAt: new Date()
      });

      // Save to trash collection
      const trashUrl = this.buildUrl('trash');
      const trashResponse = await fetch(trashUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trashDoc)
      });

      if (!trashResponse.ok) {
        const error = await trashResponse.json();
        throw new Error(error.error?.message || 'Failed to move to trash');
      }

      // Delete from images collection (but NOT from hosts)
      const deleteUrl = this.buildUrl(`images/${id}`);
      const deleteResponse = await fetch(deleteUrl, {
        method: 'DELETE'
      });

      if (!deleteResponse.ok) {
        throw new Error('Failed to remove from images collection');
      }
      
      console.log('✅ [TRASH] Successfully moved to trash (hosts preserved)');
    } catch (error) {
      console.error('❌ [TRASH] Error moving to trash:', error);
      throw error;
    }
  }

  /**
   * Get all trashed images
   * @returns {Promise<Array>} Array of trashed images
   */
  async getTrashedImages() {
    await this.ensureInitialized();

    try {
      console.log('🗑️ [TRASH] Fetching trashed images...');
      
      const url = this.buildUrl('trash', { orderBy: 'deletedAt desc' });
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('Failed to fetch trashed images');
      }

      const result = await response.json();
      
      if (!result.documents) {
        console.log('🗑️ [TRASH] No trashed images found');
        return [];
      }

      const trashedImages = result.documents.map(doc => {
        const id = doc.name.split('/').pop();
        const fields = doc.fields;
        
        return {
          id,
          originalId: fields.originalId?.stringValue || '',
          pixvidUrl: fields.pixvidUrl?.stringValue || '',
          pixvidDeleteUrl: fields.pixvidDeleteUrl?.stringValue || '',
          imgbbUrl: fields.imgbbUrl?.stringValue || '',
          imgbbDeleteUrl: fields.imgbbDeleteUrl?.stringValue || '',
          imgbbThumbUrl: fields.imgbbThumbUrl?.stringValue || '',
          sourceImageUrl: fields.sourceImageUrl?.stringValue || '',
          sourcePageUrl: fields.sourcePageUrl?.stringValue || '',
          pageTitle: fields.pageTitle?.stringValue || '',
          fileName: fields.fileName?.stringValue || '',
          fileType: fields.fileType?.stringValue || '',
          fileSize: parseInt(fields.fileSize?.integerValue || '0'),
          width: parseInt(fields.width?.integerValue || '0'),
          height: parseInt(fields.height?.integerValue || '0'),
          sha256: fields.sha256?.stringValue || '',
          pHash: fields.pHash?.stringValue || '',
          aHash: fields.aHash?.stringValue || '',
          dHash: fields.dHash?.stringValue || '',
          tags: fields.tags?.arrayValue?.values?.map(v => v.stringValue) || [],
          description: fields.description?.stringValue || '',
          internalAddedTimestamp: fields.internalAddedTimestamp?.timestampValue || fields.internalAddedTimestamp?.stringValue || '',
          deletedAt: fields.deletedAt?.timestampValue || fields.deletedAt?.stringValue || ''
        };
      });
      
      console.log(`✅ [TRASH] Found ${trashedImages.length} trashed images`);
      return trashedImages;
    } catch (error) {
      console.error('❌ [TRASH] Error fetching trashed images:', error);
      return [];
    }
  }

  /**
   * Get single trashed image by ID with full details including hashes
   * @param {string} id - Trash document ID
   * @returns {Promise<Object|null>} Trashed image data with all fields
   */
  async getTrashedImageById(id) {
    await this.ensureInitialized();

    try {
      console.log(`🔍 [TRASH] Fetching full details for trashed image: ${id}`);
      const startTime = performance.now();
      
      const url = this.buildUrl(`trash/${id}`);
      const response = await fetch(url);
      
      if (!response.ok) {
        console.log(`⚠️ [TRASH] Image not found in trash: ${id}`);
        return null;
      }

      const doc = await response.json();
      const fields = doc.fields;
      
      const trashedImage = {
        id,
        originalId: fields.originalId?.stringValue || '',
        pixvidUrl: fields.pixvidUrl?.stringValue || '',
        pixvidDeleteUrl: fields.pixvidDeleteUrl?.stringValue || '',
        imgbbUrl: fields.imgbbUrl?.stringValue || '',
        imgbbDeleteUrl: fields.imgbbDeleteUrl?.stringValue || '',
        imgbbThumbUrl: fields.imgbbThumbUrl?.stringValue || '',
        sourceImageUrl: fields.sourceImageUrl?.stringValue || '',
        sourcePageUrl: fields.sourcePageUrl?.stringValue || '',
        pageTitle: fields.pageTitle?.stringValue || '',
        fileName: fields.fileName?.stringValue || '',
        fileType: fields.fileType?.stringValue || '',
        fileSize: parseInt(fields.fileSize?.integerValue || '0'),
        width: parseInt(fields.width?.integerValue || '0'),
        height: parseInt(fields.height?.integerValue || '0'),
        sha256: fields.sha256?.stringValue || '',
        pHash: fields.pHash?.stringValue || '',
        aHash: fields.aHash?.stringValue || '',
        dHash: fields.dHash?.stringValue || '',
        tags: fields.tags?.arrayValue?.values?.map(v => v.stringValue) || [],
        description: fields.description?.stringValue || '',
        internalAddedTimestamp: fields.internalAddedTimestamp?.timestampValue || fields.internalAddedTimestamp?.stringValue || '',
        deletedAt: fields.deletedAt?.timestampValue || fields.deletedAt?.stringValue || ''
      };
      
      const endTime = performance.now();
      console.log(`✅ [TRASH] Full trashed image details loaded in ${(endTime - startTime).toFixed(2)}ms`);
      
      return trashedImage;
    } catch (error) {
      console.error('❌ [TRASH] Error getting trashed image:', error);
      return null;
    }
  }

  /**
   * Restore image from trash
   * @param {string} trashId - Trash document ID
   * @returns {Promise<void>}
   */
  async restoreFromTrash(trashId) {
    await this.ensureInitialized();

    try {
      console.log('♻️ [RESTORE] Restoring image from trash:', trashId);
      
      // Get the trashed image data
      const trashUrl = this.buildUrl(`trash/${trashId}`);
      const trashResponse = await fetch(trashUrl);
      
      if (!trashResponse.ok) {
        throw new Error('Trashed image not found');
      }

      const trashDoc = await trashResponse.json();
      const fields = trashDoc.fields;
      
      // Prepare image data (remove trash-specific fields)
      const imageData = {
        pixvidUrl: fields.pixvidUrl?.stringValue || '',
        pixvidDeleteUrl: fields.pixvidDeleteUrl?.stringValue || '',
        imgbbUrl: fields.imgbbUrl?.stringValue || '',
        imgbbDeleteUrl: fields.imgbbDeleteUrl?.stringValue || '',
        imgbbThumbUrl: fields.imgbbThumbUrl?.stringValue || '',
        sourceImageUrl: fields.sourceImageUrl?.stringValue || '',
        sourcePageUrl: fields.sourcePageUrl?.stringValue || '',
        pageTitle: fields.pageTitle?.stringValue || '',
        fileName: fields.fileName?.stringValue || '',
        fileType: fields.fileType?.stringValue || '',
        fileSize: parseInt(fields.fileSize?.integerValue || '0'),
        width: parseInt(fields.width?.integerValue || '0'),
        height: parseInt(fields.height?.integerValue || '0'),
        sha256: fields.sha256?.stringValue || '',
        pHash: fields.pHash?.stringValue || '',
        aHash: fields.aHash?.stringValue || '',
        dHash: fields.dHash?.stringValue || '',
        tags: fields.tags?.arrayValue?.values?.map(v => v.stringValue) || [],
        description: fields.description?.stringValue || '',
        internalAddedTimestamp: fields.internalAddedTimestamp?.timestampValue 
          ? new Date(fields.internalAddedTimestamp.timestampValue) 
          : fields.internalAddedTimestamp?.stringValue 
            ? new Date(fields.internalAddedTimestamp.stringValue)
            : new Date()
      };

      // Add back to images collection
      const restoreDoc = this.toFirestoreDoc(imageData);
      const imagesUrl = this.buildUrl('images');
      
      const restoreResponse = await fetch(imagesUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(restoreDoc)
      });

      if (!restoreResponse.ok) {
        const error = await restoreResponse.json();
        throw new Error(error.error?.message || 'Failed to restore image');
      }

      // Delete from trash collection
      const deleteResponse = await fetch(trashUrl, {
        method: 'DELETE'
      });

      if (!deleteResponse.ok) {
        console.warn('⚠️ [RESTORE] Failed to remove from trash collection');
      }
      
      console.log('✅ [RESTORE] Successfully restored from trash');
    } catch (error) {
      console.error('❌ [RESTORE] Error restoring from trash:', error);
      throw error;
    }
  }

  /**
   * Permanently delete image from trash (including from hosts)
   * @param {string} trashId - Trash document ID
   * @returns {Promise<void>}
   */
  async permanentlyDelete(trashId) {
    await this.ensureInitialized();

    try {
      console.log('🔥 [PERMANENT DELETE] Starting permanent deletion for:', trashId);
      
      // Get the trashed image data
      const trashUrl = this.buildUrl(`trash/${trashId}`);
      const trashResponse = await fetch(trashUrl);
      
      if (!trashResponse.ok) {
        throw new Error('Trashed image not found');
      }

      const trashDoc = await trashResponse.json();
      const fields = trashDoc.fields;
      
      const pixvidDeleteUrl = fields.pixvidDeleteUrl?.stringValue;
      const imgbbDeleteUrl = fields.imgbbDeleteUrl?.stringValue;
      
      // Delete from Pixvid if pixvidDeleteUrl exists
      if (pixvidDeleteUrl) {
        console.log('🌐 [PERMANENT DELETE] Deleting from Pixvid...');
        try {
          await fetch(pixvidDeleteUrl, {
            method: 'GET',
            redirect: 'follow'
          });
          console.log('✅ [PERMANENT DELETE] Successfully deleted from Pixvid');
        } catch (pixvidError) {
          console.warn('⚠️ [PERMANENT DELETE] Pixvid deletion failed:', pixvidError);
        }
      }
      
      // Delete from ImgBB if imgbbDeleteUrl exists
      if (imgbbDeleteUrl) {
        console.log('🌐 [PERMANENT DELETE] Deleting from ImgBB...');
        try {
          const deleteUrl = new URL(imgbbDeleteUrl);
          const pathParts = deleteUrl.pathname.split('/').filter(p => p);
          
          if (pathParts.length >= 2) {
            const imageId = pathParts[0];
            const imageHash = pathParts[1];
            
            const formData = new FormData();
            formData.append('pathname', `/${imageId}/${imageHash}`);
            formData.append('action', 'delete');
            formData.append('delete', 'image');
            formData.append('from', 'resource');
            formData.append('deleting[id]', imageId);
            formData.append('deleting[hash]', imageHash);
            
            const response = await fetch('https://ibb.co/json', {
              method: 'POST',
              body: formData
            });
            
            if (response.ok) {
              console.log('✅ [PERMANENT DELETE] Successfully deleted from ImgBB');
            } else {
              throw new Error(`ImgBB returned ${response.status}`);
            }
          } else {
            throw new Error('Invalid ImgBB delete URL format');
          }
        } catch (imgbbError) {
          console.warn('⚠️ [PERMANENT DELETE] ImgBB deletion failed:', imgbbError);
        }
      }
      
      // Delete from trash collection
      const deleteResponse = await fetch(trashUrl, {
        method: 'DELETE'
      });

      if (!deleteResponse.ok) {
        throw new Error('Failed to delete from trash collection');
      }
      
      console.log('✅ [PERMANENT DELETE] Successfully deleted permanently');
    } catch (error) {
      console.error('❌ [PERMANENT DELETE] Error during permanent deletion:', error);
      throw error;
    }
  }

  /**
   * Empty entire trash (permanently delete all trashed items)
   * @returns {Promise<number>} Number of items deleted
   */
  async emptyTrash() {
    await this.ensureInitialized();

    try {
      console.log('🔥 [EMPTY TRASH] Emptying all trash...');
      
      const trashedImages = await this.getTrashedImages();
      
      if (trashedImages.length === 0) {
        console.log('✅ [EMPTY TRASH] Trash is already empty');
        return 0;
      }

      let deletedCount = 0;
      const errors = [];

      for (const item of trashedImages) {
        try {
          await this.permanentlyDelete(item.id);
          deletedCount++;
        } catch (error) {
          console.error(`Failed to delete ${item.id}:`, error);
          errors.push({ id: item.id, error: error.message });
        }
      }

      console.log(`✅ [EMPTY TRASH] Deleted ${deletedCount}/${trashedImages.length} items`);
      
      if (errors.length > 0) {
        console.warn('⚠️ [EMPTY TRASH] Some deletions failed:', errors);
      }

      return deletedCount;
    } catch (error) {
      console.error('❌ [EMPTY TRASH] Error emptying trash:', error);
      throw error;
    }
  }

  /**
   * Update image metadata
   * @param {string} id - Image document ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<boolean>} Success status
   */
  async updateImage(id, updates) {
    await this.ensureInitialized();

    try {
      const fieldPaths = Object.keys(updates);
      const url = this.buildUrl(`images/${id}`, {
        'updateMask.fieldPaths': fieldPaths
      });
      
      const firestoreData = this.toFirestoreDoc(updates);
      
      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(firestoreData)
      });

      if (!response.ok) {
        throw new Error('Failed to update image');
      }
      
      return true;
    } catch (error) {
      console.error('Error updating image:', error);
      throw error;
    }
  }

  /**
   * Search images by query
   * @param {string} query - Search query
   * @returns {Promise<Array>} Matching images
   */
  async searchImages(query) {
    const allImages = await this.getAllImages();
    const lowerQuery = query.toLowerCase();
    
    return allImages.filter(img => 
      img.pageTitle?.toLowerCase().includes(lowerQuery) ||
      img.sourcePageUrl?.toLowerCase().includes(lowerQuery) ||
      img.description?.toLowerCase().includes(lowerQuery) ||
      img.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Save user settings to Firebase
   * @param {Object} settings - User settings
   * @returns {Promise<boolean>} Success status
   */
  async saveUserSettings(settings) {
    await this.ensureInitialized();

    try {
      // Try to get existing document first
      const getUrl = this.buildUrl('userSettings/config');
      const getResponse = await fetch(getUrl);
      
      let existingSettings = {};
      if (getResponse.ok) {
        const doc = await getResponse.json();
        const fields = doc.fields;
        existingSettings = {
          pixvidApiKey: fields.pixvidApiKey?.stringValue || '',
          imgbbApiKey: fields.imgbbApiKey?.stringValue || '',
          defaultGallerySource: fields.defaultGallerySource?.stringValue || 'imgbb'
        };
      }

      // Merge with new settings (only update non-empty values)
      const mergedSettings = { ...existingSettings };
      if (settings.pixvidApiKey) mergedSettings.pixvidApiKey = settings.pixvidApiKey;
      if (settings.imgbbApiKey) mergedSettings.imgbbApiKey = settings.imgbbApiKey;
      if (settings.defaultGallerySource) mergedSettings.defaultGallerySource = settings.defaultGallerySource;

      const doc = this.toFirestoreDoc({
        ...mergedSettings,
        updatedAt: new Date()
      });

      let response;
      if (getResponse.ok) {
        // Document exists, update it
        const patchUrl = this.buildUrl('userSettings/config', {
          'updateMask.fieldPaths': Object.keys(mergedSettings).concat(['updatedAt'])
        });
        
        response = await fetch(patchUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(doc)
        });
      } else {
        // Document doesn't exist, create it
        const createUrl = this.buildUrl('userSettings', {
          documentId: 'config'
        });
        
        response = await fetch(createUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(doc)
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to save settings: ${errorText}`);
      }

      return true;
    } catch (error) {
      console.error('Error saving settings:', error);
      throw error;
    }
  }

  /**
   * Get user settings from Firebase
   * @returns {Promise<Object|null>} User settings or null
   */
  async getUserSettings() {
    await this.ensureInitialized();

    try {
      const url = this.buildUrl('userSettings/config');
      const response = await fetch(url);
      
      if (!response.ok) {
        if (response.status === 404) {
          return null; // No settings saved yet
        }
        throw new Error('Failed to fetch settings');
      }

      const doc = await response.json();
      const fields = doc.fields;
      
      return {
        pixvidApiKey: fields.pixvidApiKey?.stringValue || '',
        imgbbApiKey: fields.imgbbApiKey?.stringValue || '',
        defaultGallerySource: fields.defaultGallerySource?.stringValue || 'imgbb',
        updatedAt: fields.updatedAt?.timestampValue || ''
      };
    } catch (error) {
      console.error('Error fetching settings:', error);
      return null;
    }
  }
}
