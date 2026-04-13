/**
 * @fileoverview Firestore REST API Storage Manager for ImgVault
 * @description Compatible with Manifest V3 service workers with modern ES6+ patterns
 * @version 2.0.0
 */

import { neon } from '@neondatabase/serverless';

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
 * @property {string} [filemoonUrl] - Filemoon video URL
 * @property {string} [filemoonThumbUrl] - Filemoon video thumbnail URL
 * @property {string} [udropUrl] - UDrop video URL
 * @property {string} [udropShortUrl] - UDrop short URL
 * @property {string} [udropFileId] - UDrop file ID
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
 * @property {Object} [exifMetadata] - Complete EXIF metadata from exifr
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
    /** @type {'firestore'|'neon'|null} */
    this.backend = null;
    /** @type {Function|null} */
    this.neonSql = null;
  }

  /**
   * Initialize storage manager with Firebase config
   * @returns {Promise<boolean>} Success status
   */
  async init() {
    console.log('🔵 StorageManager.init() called');
    
    const result = await chrome.storage.sync.get(['firebaseConfig', 'neonDatabaseUrl']);
    const neonDatabaseUrl = String(result.neonDatabaseUrl || '').trim();
    if (neonDatabaseUrl) {
      this.backend = 'neon';
      this.neonSql = neon(neonDatabaseUrl);
      this.initialized = true;
      console.log('StorageManager initialized with backend: neon');
      return true;
    }
    console.log('🔵 Firebase config from storage:', result.firebaseConfig ? 'found' : 'not found');
    
    if (!result.firebaseConfig) {
      console.warn('⚠️ Firebase not configured');
      return false;
    }

    this.backend = 'firestore';
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
        throw new Error('No database configured. Set Neon DB URL or Firebase config in settings.');
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
   * Fetch all Firestore list pages for a collection path
   * @private
   * @param {string} path
   * @param {Object} [params]
   * @returns {Promise<Array>} Raw Firestore documents
   */
  async fetchAllDocuments(path, params = {}) {
    const allDocuments = [];
    let pageToken = null;

    do {
      const requestParams = { ...params };
      if (pageToken) {
        requestParams.pageToken = pageToken;
      }

      const url = this.buildUrl(path, requestParams);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch documents for ${path}`);
      }

      const result = await response.json();
      if (result.documents?.length) {
        allDocuments.push(...result.documents);
      }

      pageToken = result.nextPageToken || null;
    } while (pageToken);

    return allDocuments;
  }

  /**
   * Build Firestore API URL using absolute REST path suffix
   * @private
   * @param {string} suffix - Path suffix after /v1/
   * @param {Object} [params]
   * @returns {string}
   */
  buildApiUrl(suffix, params = {}) {
    const cleanSuffix = String(suffix || '').replace(/^\/+/, '');
    const url = new URL(`https://firestore.googleapis.com/v1/${cleanSuffix}`);
    url.searchParams.set('key', this.config.apiKey);

    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach(v => url.searchParams.append(key, v));
      } else if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    });

    return url.toString();
  }

  /**
   * Extract Firestore document path from fully-qualified document name
   * Example: projects/x/databases/(default)/documents/images/abc -> images/abc
   * @private
   * @param {string} fullName
   * @returns {string}
   */
  extractDocPath(fullName = '') {
    const marker = '/documents/';
    const index = String(fullName).indexOf(marker);
    if (index < 0) return '';
    return String(fullName).slice(index + marker.length);
  }

  /**
   * Convert Firestore Value to plain JS value (generic, type-safe for export)
   * @private
   * @param {Object} value
   * @returns {*}
   */
  firestoreValueToJs(value = {}) {
    if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) return null;
    if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
    if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return value.booleanValue;
    if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) return Number(value.integerValue);
    if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return value.doubleValue;
    if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) return value.timestampValue;
    if (Object.prototype.hasOwnProperty.call(value, 'referenceValue')) return value.referenceValue;
    if (Object.prototype.hasOwnProperty.call(value, 'geoPointValue')) return value.geoPointValue;
    if (Object.prototype.hasOwnProperty.call(value, 'bytesValue')) return value.bytesValue;

    if (value.arrayValue) {
      const items = value.arrayValue.values || [];
      return items.map(item => this.firestoreValueToJs(item));
    }

    if (value.mapValue) {
      const mapFields = value.mapValue.fields || {};
      const out = {};
      Object.entries(mapFields).forEach(([k, v]) => {
        out[k] = this.firestoreValueToJs(v);
      });
      return out;
    }

    return null;
  }

  /**
   * Convert Firestore "fields" object to plain JS object
   * @private
   * @param {Object} fields
   * @returns {Object}
   */
  firestoreFieldsToJs(fields = {}) {
    const out = {};
    Object.entries(fields || {}).forEach(([key, value]) => {
      out[key] = this.firestoreValueToJs(value);
    });
    return out;
  }

  /**
   * List subcollection IDs for a document path (or root when empty)
   * @private
   * @param {string} [parentDocPath]
   * @returns {Promise<string[]>}
   */
  async listCollectionIds(parentDocPath = '') {
    const collectionIds = [];
    let pageToken = null;

    do {
      const suffix = parentDocPath
        ? `projects/${this.config.projectId}/databases/(default)/documents/${parentDocPath}:listCollectionIds`
        : `projects/${this.config.projectId}/databases/(default)/documents:listCollectionIds`;

      const url = this.buildApiUrl(suffix);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageSize: 1000,
          ...(pageToken ? { pageToken } : {})
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed listing collections for "${parentDocPath || '(root)'}": ${errorText}`);
      }

      const result = await response.json();
      collectionIds.push(...(result.collectionIds || []));
      pageToken = result.nextPageToken || null;
    } while (pageToken);

    return collectionIds;
  }

  /**
   * Export one collection path recursively with all subcollections
   * @private
   * @param {string} collectionPath
   * @returns {Promise<Object>}
   */
  async exportCollectionRecursive(collectionPath) {
    const docs = await this.fetchAllDocuments(collectionPath);
    const exportedDocs = [];

    for (const doc of docs) {
      const docPath = this.extractDocPath(doc.name);
      const subcollections = {};

      try {
        const subCollectionIds = await this.listCollectionIds(docPath);
        for (const subCollectionId of subCollectionIds) {
          const childPath = `${docPath}/${subCollectionId}`;
          subcollections[subCollectionId] = await this.exportCollectionRecursive(childPath);
        }
      } catch (error) {
        subcollections.__error = error.message;
      }

      exportedDocs.push({
        id: docPath.split('/').pop(),
        name: doc.name,
        path: docPath,
        createTime: doc.createTime || null,
        updateTime: doc.updateTime || null,
        fieldsRaw: doc.fields || {},
        data: this.firestoreFieldsToJs(doc.fields || {}),
        subcollections
      });
    }

    return {
      path: collectionPath,
      documentCount: exportedDocs.length,
      documents: exportedDocs
    };
  }

  /**
   * Export full Firestore database (all root collections + nested subcollections)
   * @returns {Promise<Object>}
   */
  async exportFullDatabase() {
    await this.ensureInitialized();

    if (this.backend === 'neon') {
      const { firebaseConfig } = await chrome.storage.sync.get(['firebaseConfig']);
      if (!firebaseConfig) {
        throw new Error('Firebase config not set. Firestore backup requires Firebase config.');
      }
      this.config = firebaseConfig;
      this.baseUrl = `https://firestore.googleapis.com/v1/projects/${this.config.projectId}/databases/(default)/documents`;
    }

    const startedAt = new Date().toISOString();
    const errors = [];
    let rootCollectionIds = [];

    try {
      rootCollectionIds = await this.listCollectionIds('');
    } catch (error) {
      // Fallback to known root collections if listCollectionIds is blocked by rules/permissions
      errors.push(`Root collection discovery failed: ${error.message}`);
      rootCollectionIds = ['images', 'trash', 'collections', 'userSettings'];
    }

    const collections = {};
    for (const rootCollectionId of rootCollectionIds) {
      try {
        collections[rootCollectionId] = await this.exportCollectionRecursive(rootCollectionId);
      } catch (error) {
        errors.push(`Collection "${rootCollectionId}" export failed: ${error.message}`);
      }
    }

    const finishedAt = new Date().toISOString();
    return {
      backupVersion: 1,
      source: 'firestore',
      projectId: this.config.projectId,
      exportedAt: finishedAt,
      startedAt,
      rootCollectionsAttempted: rootCollectionIds,
      collections,
      errors
    };
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
      if (value === undefined) continue;
      
      // Special handling for exifMetadata - flatten it into individual fields
      if (key === 'exifMetadata' && value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [exifKey, exifValue] of Object.entries(value)) {
          if (exifValue === null || exifValue === undefined) continue;
          
          if (typeof exifValue === 'string') {
            fields[exifKey] = { stringValue: exifValue };
          } else if (typeof exifValue === 'number') {
            if (Number.isInteger(exifValue)) {
              fields[exifKey] = { integerValue: exifValue };
            } else {
              fields[exifKey] = { doubleValue: exifValue };
            }
          } else if (typeof exifValue === 'boolean') {
            fields[exifKey] = { booleanValue: exifValue };
          } else if (exifValue instanceof Date) {
            fields[exifKey] = { timestampValue: exifValue.toISOString() };
          } else if (typeof exifValue === 'object' || Array.isArray(exifValue)) {
            // Complex nested objects - store as JSON string
            fields[exifKey] = { stringValue: JSON.stringify(exifValue) };
          }
        }
        continue; // Skip the exifMetadata field itself
      }
      
      if (value === null) {
        fields[key] = { nullValue: null };
      } else if (typeof value === 'string') {
        fields[key] = { stringValue: value };
      } else if (typeof value === 'number') {
        if (Number.isInteger(value)) {
          fields[key] = { integerValue: value };
        } else {
          fields[key] = { doubleValue: value };
        }
      } else if (typeof value === 'boolean') {
        fields[key] = { booleanValue: value };
      } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/.test(value)) {
        fields[key] = { timestampValue: value };
      } else if (Array.isArray(value)) {
        fields[key] = {
          arrayValue: {
            values: value.map(v => ({ stringValue: String(v) }))
          }
        };
      } else if (value instanceof Date) {
        fields[key] = { timestampValue: value.toISOString() };
      } else if (typeof value === 'object') {
        // Handle other nested objects
        fields[key] = { stringValue: JSON.stringify(value) };
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
    
    // Build result object dynamically from all fields
    const result = { id };
    
    for (const [key, value] of Object.entries(fields)) {
      if (value.stringValue !== undefined) {
        result[key] = value.stringValue;
      } else if (value.integerValue !== undefined) {
        result[key] = parseInt(value.integerValue);
      } else if (value.doubleValue !== undefined) {
        result[key] = parseFloat(value.doubleValue);
      } else if (value.booleanValue !== undefined) {
        result[key] = value.booleanValue;
      } else if (value.timestampValue !== undefined) {
        result[key] = value.timestampValue;
      } else if (value.arrayValue !== undefined) {
        result[key] = value.arrayValue.values?.map(v => v.stringValue) || [];
      } else if (value.nullValue !== undefined) {
        result[key] = null; // Handle null values explicitly
      }
    }
    
    // Ensure required fields have defaults
    if (!result.tags) result.tags = [];
    if (!result.description) result.description = '';
    if (!result.pixvidUrl) result.pixvidUrl = '';
    if (!result.sourceImageUrl) result.sourceImageUrl = '';
    if (!result.sourcePageUrl) result.sourcePageUrl = '';
    if (!result.faviconUrl) result.faviconUrl = '';
    if (!result.linkPreviewImageUrl) result.linkPreviewImageUrl = '';
    if (!result.pageTitle) result.pageTitle = '';
    if (!result.fileName) result.fileName = '';
    if (!Object.prototype.hasOwnProperty.call(result, 'collectionId')) result.collectionId = null;
    
    return result;
  }

  /**
   * Save image metadata to Firestore
   * @param {ImageData} imageData - Image metadata
   * @returns {Promise<string>} Document ID
   */
  async saveImage(imageData) {
    await this.ensureInitialized();
    if (this.backend === 'neon') {
      return this.saveImageNeon(imageData);
    }

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
        collectionId: Object.prototype.hasOwnProperty.call(imageData, 'collectionId') ? imageData.collectionId : null,
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
      
      // Update collection imageCount if image has a collectionId
      if (imageData.collectionId) {
        try {
          await this.incrementCollectionCount(imageData.collectionId, 1);
        } catch (error) {
          console.warn('⚠️ Failed to update collection count:', error);
          // Don't fail the whole operation if collection count update fails
        }
      }
      
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
    if (this.backend === 'neon') {
      return this.getAllImagesForDuplicateCheckNeon();
    }

    try {
      console.log('🔍 [DUPLICATE CHECK] Fetching ALL image data (including hashes from active AND trash)...');
      const startTime = performance.now();
      
      // Fetch active images
      const activeDocs = await this.fetchAllDocuments('images', { orderBy: 'internalAddedTimestamp desc' });
      const activeImages = activeDocs.map(doc => this.fromFirestoreDoc(doc));

      console.log(`🔍 [DUPLICATE CHECK] Found ${activeImages.length} active images`);

      // Fetch trashed images
      let trashedImages = [];
      const trashDocs = await this.fetchAllDocuments('trash', { orderBy: 'deletedAt desc' });
      trashedImages = trashDocs.map(doc => {
        const id = doc.name.split('/').pop();
        const fields = doc.fields;
        
        return {
          id,
          pixvidUrl: fields.pixvidUrl?.stringValue || '',
          imgbbUrl: fields.imgbbUrl?.stringValue || '',
          imgbbThumbUrl: fields.imgbbThumbUrl?.stringValue || '',
          filemoonUrl: fields.filemoonUrl?.stringValue || '',
          sourceImageUrl: fields.sourceImageUrl?.stringValue || '',
          sha256: fields.sha256?.stringValue || '',
          pHash: fields.pHash?.stringValue || '',
          aHash: fields.aHash?.stringValue || '',
          dHash: fields.dHash?.stringValue || '',
          internalAddedTimestamp: fields.internalAddedTimestamp?.timestampValue || fields.internalAddedTimestamp?.stringValue || '',
          deletedAt: fields.deletedAt?.timestampValue || fields.deletedAt?.stringValue || '',
          _isTrash: true
        };
      });

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
    if (this.backend === 'neon') {
      return this.getAllImagesNeon();
    }

    try {
      console.log('📊 [OPTIMIZE] Fetching lightweight gallery data...');
      const startTime = performance.now();
      
      // Only fetch essential fields for gallery view
      const maskFields = [
        'pixvidUrl',
        'imgbbUrl',
        'imgbbThumbUrl',
        'filemoonWatchUrl',
        'filemoonDirectUrl',
        'udropWatchUrl',
        'udropDirectUrl',
        'linkUrl',
        'faviconUrl',
        'linkPreviewImageUrl',
        'sourcePageUrl',
        'pageTitle',
        'tags',
        'description',
        'internalAddedTimestamp',
        'collectionId',
        'fileType',
        'isVideo',
        'isLink'
      ];
      
      const requestParams = {
        orderBy: 'internalAddedTimestamp desc',
        'mask.fieldPaths': maskFields
      };
      const docs = await this.fetchAllDocuments('images', requestParams);
      const endTime = performance.now();

      if (!docs.length) {
        console.log('📊 [OPTIMIZE] No images found in gallery');
        return [];
      }

      const images = docs.map(doc => this.fromFirestoreDoc(doc));
      
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
    if (this.backend === 'neon') {
      return this.getImageByIdNeon(id);
    }

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

  async hasSavedLinkByUrl(pageUrl) {
    await this.ensureInitialized();
    if (this.backend === 'neon') {
      return this.hasSavedLinkByUrlNeon(pageUrl);
    }

    const target = String(pageUrl || '').trim();
    if (!target) return false;
    const canonicalTarget = this.canonicalizeLinkUrl(target);

    try {
      const docs = await this.fetchAllDocuments('images', {
        'mask.fieldPaths': ['isLink', 'linkUrl', 'sourcePageUrl']
      });

      return docs.some((doc) => {
        const fields = doc?.fields || {};
        if (fields?.isLink?.booleanValue !== true) return false;
        const linkUrl = fields?.linkUrl?.stringValue || '';
        const sourcePageUrl = fields?.sourcePageUrl?.stringValue || '';
        const canonicalLinkUrl = this.canonicalizeLinkUrl(linkUrl);
        const canonicalSourcePageUrl = this.canonicalizeLinkUrl(sourcePageUrl);
        return (
          canonicalLinkUrl === canonicalTarget ||
          canonicalSourcePageUrl === canonicalTarget ||
          linkUrl === target ||
          sourcePageUrl === target
        );
      });
    } catch (error) {
      console.error('Error checking saved link URL:', error);
      return false;
    }
  }

  canonicalizeLinkUrl(inputUrl) {
    const raw = String(inputUrl || '').trim();
    if (!raw) return '';

    try {
      const parsed = new URL(raw);
      parsed.hash = '';
      parsed.hostname = parsed.hostname.toLowerCase();

      // Drop common tracking params while preserving meaningful query keys.
      const dropParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
      for (const key of dropParams) {
        parsed.searchParams.delete(key);
      }

      // Normalize default ports.
      if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) {
        parsed.port = '';
      }

      // Normalize trailing slash for non-root paths.
      if (parsed.pathname.length > 1) {
        parsed.pathname = parsed.pathname.replace(/\/+$/, '');
      }

      return parsed.toString();
    } catch (error) {
      return raw;
    }
  }

  /**
   * Move image to trash (soft delete)
   * @param {string} id - Image document ID
   * @returns {Promise<void>}
   */
  async moveToTrash(id) {
    await this.ensureInitialized();
    if (this.backend === 'neon') {
      return this.moveToTrashNeon(id);
    }

    try {
      console.log('🗑️ [TRASH] Moving image to trash:', id);
      
      // Get the image data from images collection with ALL fields
      const imageData = await this.getImageById(id);
      
      if (!imageData) {
        throw new Error('Image not found');
      }
      
      console.log('📋 [TRASH] Preserving all fields:', Object.keys(imageData));
      console.log('📋 [TRASH] Total fields count:', Object.keys(imageData).length);
      
      // Store collectionId before moving to trash (for count decrement)
      const collectionId = imageData.collectionId;
      
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
      
      // Decrement collection count if image had a collectionId
      if (collectionId) {
        try {
          await this.incrementCollectionCount(collectionId, -1);
        } catch (error) {
          console.warn('⚠️ Failed to decrement collection count:', error);
        }
      }
      
      console.log('✅ [TRASH] Successfully moved to trash with 100% field preservation (hosts preserved)');
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
    if (this.backend === 'neon') {
      return this.getTrashedImagesNeon();
    }

    try {
      console.log('🗑️ [TRASH] Fetching trashed images...');
      
      const docs = await this.fetchAllDocuments('trash', { orderBy: 'deletedAt desc' });

      if (!docs.length) {
        console.log('🗑️ [TRASH] No trashed images found');
        return [];
      }

      const trashedImages = docs.map(doc => {
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
          filemoonUrl: fields.filemoonUrl?.stringValue || '',
          udropUrl: fields.udropUrl?.stringValue || '',
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
    if (this.backend === 'neon') {
      return this.getTrashedImageByIdNeon(id);
    }

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
      
      // Use fromFirestoreDoc to extract ALL fields automatically (100% field preservation)
      const trashedImage = this.fromFirestoreDoc(doc);
      
      const endTime = performance.now();
      console.log(`✅ [TRASH] Full trashed image details loaded with ${Object.keys(trashedImage).length} fields in ${(endTime - startTime).toFixed(2)}ms`);
      console.log(`📋 [TRASH] Fields present:`, Object.keys(trashedImage));
      
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
    if (this.backend === 'neon') {
      return this.restoreFromTrashNeon(trashId);
    }

    try {
      console.log('♻️ [RESTORE] Restoring image from trash:', trashId);
      
      // Get the trashed image data
      const trashUrl = this.buildUrl(`trash/${trashId}`);
      const trashResponse = await fetch(trashUrl);
      
      if (!trashResponse.ok) {
        throw new Error('Trashed image not found');
      }

      const trashDoc = await trashResponse.json();
      
      // Use fromFirestoreDoc to extract ALL fields automatically (100% field preservation)
      const trashedData = this.fromFirestoreDoc(trashDoc);
      
      // Remove trash-specific fields (id, originalId, deletedAt)
      const { id, originalId, deletedAt, _isTrash, ...imageData } = trashedData;
      
      console.log('📋 [RESTORE] Preserving all fields:', Object.keys(imageData));
      console.log('📋 [RESTORE] Total fields count:', Object.keys(imageData).length);
      
      // Store collectionId before restoring (for count increment)
      const collectionId = imageData.collectionId;
      
      // Convert internalAddedTimestamp back to Date object if it's a string
      if (imageData.internalAddedTimestamp && typeof imageData.internalAddedTimestamp === 'string') {
        imageData.internalAddedTimestamp = new Date(imageData.internalAddedTimestamp);
      }

      // Add back to images collection with ALL original fields preserved
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
      
      // Increment collection count if image had a collectionId
      if (collectionId) {
        try {
          await this.incrementCollectionCount(collectionId, 1);
        } catch (error) {
          console.warn('⚠️ Failed to increment collection count:', error);
        }
      }
      
      console.log('✅ [RESTORE] Successfully restored from trash with 100% field preservation');
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
    if (this.backend === 'neon') {
      return this.permanentlyDeleteNeon(trashId);
    }

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

      if (imgbbDeleteUrl) {
        try {
          await this.deleteFromImgbb(imgbbDeleteUrl);
        } catch (imgbbPrimaryDeleteError) {
          console.warn('[PERMANENT DELETE] Primary ImgBB delete helper failed:', imgbbPrimaryDeleteError);
        }
      }
      
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
      if (false && imgbbDeleteUrl) {
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
   * Update a trashed image's fields
   * @param {string} trashId - Trash document ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<void>}
   */
  async updateTrashedImage(trashId, updates) {
    await this.ensureInitialized();
    if (this.backend === 'neon') {
      return this.updateTrashedImageNeon(trashId, updates);
    }

    try {
      console.log('✏️ [UPDATE TRASH] Updating trash item:', trashId, updates);
      
      const url = this.buildUrl(`trash/${trashId}`);
      
      // Get current document
      const getResponse = await fetch(url);
      if (!getResponse.ok) {
        throw new Error('Trashed image not found');
      }
      
      const doc = await getResponse.json();
      const fields = doc.fields;
      
      // Build update payload
      const updateFields = {};
      for (const [key, value] of Object.entries(updates)) {
        if (key === 'creationDate') {
          updateFields[key] = { timestampValue: value };
        } else {
          updateFields[key] = { stringValue: String(value) };
        }
      }
      
      // Update the document
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            ...fields,
            ...updateFields
          }
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to update trashed image');
      }
      
      console.log('✅ [UPDATE TRASH] Successfully updated trash item');
    } catch (error) {
      console.error('❌ [UPDATE TRASH] Error updating trashed image:', error);
      throw error;
    }
  }

  /**
   * Empty entire trash (permanently delete all trashed items)
   * @returns {Promise<number>} Number of items deleted
   */
  async emptyTrash() {
    await this.ensureInitialized();
    if (this.backend === 'neon') {
      return this.emptyTrashNeon();
    }

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
    if (this.backend === 'neon') {
      return this.updateImageNeon(id, updates);
    }

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
    if (this.backend === 'neon') {
      return this.saveUserSettingsNeon(settings);
    }

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
          filemoonApiKey: fields.filemoonApiKey?.stringValue || '',
          udropKey1: fields.udropKey1?.stringValue || '',
          udropKey2: fields.udropKey2?.stringValue || '',
          defaultGallerySource: fields.defaultGallerySource?.stringValue || 'imgbb',
          defaultVideoSource: fields.defaultVideoSource?.stringValue || 'filemoon'
        };
      }

      // Merge with new settings (only update non-empty values)
      const mergedSettings = { ...existingSettings };
      if (settings.pixvidApiKey) mergedSettings.pixvidApiKey = settings.pixvidApiKey;
      if (settings.imgbbApiKey) mergedSettings.imgbbApiKey = settings.imgbbApiKey;
      if (settings.filemoonApiKey) mergedSettings.filemoonApiKey = settings.filemoonApiKey;
      if (settings.udropKey1) mergedSettings.udropKey1 = settings.udropKey1;
      if (settings.udropKey2) mergedSettings.udropKey2 = settings.udropKey2;
      if (settings.defaultGallerySource) mergedSettings.defaultGallerySource = settings.defaultGallerySource;
      if (settings.defaultVideoSource) mergedSettings.defaultVideoSource = settings.defaultVideoSource;

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
    if (this.backend === 'neon') {
      return this.getUserSettingsNeon();
    }

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
        filemoonApiKey: fields.filemoonApiKey?.stringValue || '',
        udropKey1: fields.udropKey1?.stringValue || '',
        udropKey2: fields.udropKey2?.stringValue || '',
        defaultGallerySource: fields.defaultGallerySource?.stringValue || 'imgbb',
        defaultVideoSource: fields.defaultVideoSource?.stringValue || 'filemoon',
        updatedAt: fields.updatedAt?.timestampValue || ''
      };
    } catch (error) {
      console.error('Error fetching settings:', error);
      return null;
    }
  }

  /**
   * Create a new collection
   * @param {Object} collectionData - Collection data
   * @param {string} collectionData.name - Collection name
   * @param {string} [collectionData.description] - Collection description
   * @param {string} [collectionData.color] - Collection color (hex)
   * @returns {Promise<Object>} Created collection with ID
   */
  async createCollection(collectionData) {
    await this.ensureInitialized();
    if (this.backend === 'neon') {
      return this.createCollectionNeon(collectionData);
    }

    try {
      const docId = `collection_${Date.now()}`;
      const doc = this.toFirestoreDoc({
        ...collectionData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        imageCount: 0
      });

      const url = this.buildUrl(`collections/${docId}`);
      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to create collection');
      }

      const result = await response.json();
      return this.fromFirestoreDoc(result);
    } catch (error) {
      console.error('Error creating collection:', error);
      throw error;
    }
  }

  /**
   * Get all collections
   * @returns {Promise<Array>} Array of collections
   */
  async getCollections() {
    await this.ensureInitialized();
    if (this.backend === 'neon') {
      return this.getCollectionsNeon();
    }

    try {
      const url = this.buildUrl('collections', { orderBy: 'name asc' });
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          return []; // No collections yet
        }
        throw new Error('Failed to fetch collections');
      }

      const result = await response.json();
      return result.documents 
        ? result.documents.map(doc => this.fromFirestoreDoc(doc))
        : [];
    } catch (error) {
      console.error('Error fetching collections:', error);
      return [];
    }
  }

  /**
   * Update a collection
   * @param {string} collectionId - Collection ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated collection
   */
  async updateCollection(collectionId, updates) {
    await this.ensureInitialized();
    if (this.backend === 'neon') {
      return this.updateCollectionNeon(collectionId, updates);
    }

    try {
      // First get the current collection to preserve all fields
      const currentUrl = this.buildUrl(`collections/${collectionId}`);
      const currentResponse = await fetch(currentUrl);
      
      if (!currentResponse.ok) {
        throw new Error('Collection not found');
      }
      
      const currentDoc = await currentResponse.json();
      const currentData = this.fromFirestoreDoc(currentDoc);
      
      // Only keep valid collection fields
      const validCollectionFields = {
        name: currentData.name,
        description: currentData.description || '',
        color: currentData.color || '',
        imageCount: currentData.imageCount || 0,
        createdAt: currentData.createdAt
      };
      
      // Merge updates with valid collection data
      const mergedData = {
        ...validCollectionFields,
        ...updates,
        updatedAt: new Date().toISOString()
      };
      
      const doc = this.toFirestoreDoc(mergedData);

      const url = this.buildUrl(`collections/${collectionId}`);
      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to update collection');
      }

      const result = await response.json();
      return this.fromFirestoreDoc(result);
    } catch (error) {
      console.error('Error updating collection:', error);
      throw error;
    }
  }

  /**
   * Delete a collection
   * @param {string} collectionId - Collection ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteCollection(collectionId) {
    await this.ensureInitialized();
    if (this.backend === 'neon') {
      return this.deleteCollectionNeon(collectionId);
    }

    try {
      const url = this.buildUrl(`collections/${collectionId}`);
      const response = await fetch(url, {
        method: 'DELETE'
      });

      if (!response.ok && response.status !== 404) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to delete collection');
      }

      return true;
    } catch (error) {
      console.error('Error deleting collection:', error);
      throw error;
    }
  }

  /**
   * Get images in a specific collection
   * @param {string} collectionId - Collection ID
   * @returns {Promise<Array>} Array of images
   */
  async getImagesByCollection(collectionId) {
    await this.ensureInitialized();
    if (this.backend === 'neon') {
      return this.getImagesByCollectionNeon(collectionId);
    }

    try {
      // Note: Firestore REST API doesn't support complex queries like "where collectionId ==",
      // so we fetch all images and filter client-side
      const docs = await this.fetchAllDocuments('images', { orderBy: 'internalAddedTimestamp desc' });
      const allImages = docs.map(doc => this.fromFirestoreDoc(doc));

      // Filter by collectionId
      return allImages.filter(img => img.collectionId === collectionId);
    } catch (error) {
      console.error('Error fetching images by collection:', error);
      return [];
    }
  }

  /**
   * Increment or decrement the image count for a collection
   * @param {string} collectionId - Collection ID
   * @param {number} delta - Change in count (positive or negative)
   * @returns {Promise<void>}
   */
  async incrementCollectionCount(collectionId, delta) {
    await this.ensureInitialized();
    if (this.backend === 'neon') {
      return this.incrementCollectionCountNeon(collectionId, delta);
    }

    try {
      // First, get the current collection data
      const url = this.buildUrl(`collections/${collectionId}`);
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          console.warn(`Collection ${collectionId} not found for count update`);
          return;
        }
        throw new Error('Failed to fetch collection');
      }

      const doc = await response.json();
      const collection = this.fromFirestoreDoc(doc);
      const currentCount = collection.imageCount || 0;
      const newCount = Math.max(0, currentCount + delta);

      // Update the collection with new count
      await this.updateCollection(collectionId, { imageCount: newCount });
    } catch (error) {
      console.error('Error updating collection count:', error);
      throw error;
    }
  }

  // ----------------------------
  // Neon backend implementation
  // ----------------------------
  ensureNeonReady() {
    if (!this.neonSql) {
      throw new Error('Neon DB not configured.');
    }
    return this.neonSql;
  }

  async deleteFromImgbb(imgbbDeleteUrl) {
    if (!imgbbDeleteUrl) return false;

    // Official ImgBB deletion uses delete_url returned from upload response.
    try {
      const response = await fetch(imgbbDeleteUrl, {
        method: 'GET',
        redirect: 'follow',
        cache: 'no-store',
        credentials: 'omit'
      });
      if (!response.ok) {
        throw new Error(`ImgBB delete URL returned ${response.status}`);
      }
      return true;
    } catch (directError) {
      console.warn('⚠️ [IMGBB] Direct delete URL failed, falling back:', directError);
    }

    // 2) Fallback: legacy JSON endpoints with extracted pathname/hash
    try {
      const deleteUrl = new URL(imgbbDeleteUrl);
      const pathParts = deleteUrl.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2) {
        const imageId = pathParts[0];
        const imageHash = pathParts[1];
        try {
          return await tryPostDelete('https://ibb.co/json', imageId, imageHash);
        } catch (ibbError) {
          console.warn('⚠️ [IMGBB] ibb.co/json fallback failed:', ibbError);
        }
        return await tryPostDelete('https://imgbb.com/json', imageId, imageHash);
      }
    } catch (parseError) {
      console.warn('⚠️ [IMGBB] Could not parse delete URL:', parseError);
    }

    return false;
  }

  generateDocId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `img_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  toNeonMediaPayload(imageData = {}, existing = {}) {
    const merged = { ...existing, ...imageData };
    const isVideo = Boolean(merged.isVideo);
    const isLink = Boolean(merged.isLink);
    const kind = isLink ? 'link' : (isVideo ? 'video' : 'image');
    const canonicalLink = this.canonicalizeLinkUrl(merged.linkUrl || merged.sourcePageUrl || '');

    return {
      kind,
      isVideo,
      isLink,
      pageTitle: merged.pageTitle || '',
      description: merged.description || '',
      tags: Array.isArray(merged.tags) ? merged.tags : [],
      collectionId: Object.prototype.hasOwnProperty.call(merged, 'collectionId') ? merged.collectionId : null,
      internalAddedTimestamp: merged.internalAddedTimestamp || new Date().toISOString(),
      sourceImageUrl: merged.sourceImageUrl || '',
      sourcePageUrl: merged.sourcePageUrl || '',
      fileName: merged.fileName || '',
      fileSize: Number.isFinite(Number(merged.fileSize)) ? Number(merged.fileSize) : null,
      width: Number.isFinite(Number(merged.width)) ? Number(merged.width) : null,
      height: Number.isFinite(Number(merged.height)) ? Number(merged.height) : null,
      duration: Number.isFinite(Number(merged.duration)) ? Number(merged.duration) : null,
      fileType: merged.fileType || '',
      fileTypeSource: merged.fileTypeSource || '',
      creationDate: merged.creationDate || null,
      creationDateSource: merged.creationDateSource || '',
      sha256: merged.sha256 || '',
      pHash: merged.pHash || '',
      aHash: merged.aHash || '',
      dHash: merged.dHash || '',
      pixvidUrl: merged.pixvidUrl || '',
      pixvidDeleteUrl: merged.pixvidDeleteUrl || '',
      imgbbUrl: merged.imgbbUrl || '',
      imgbbDeleteUrl: merged.imgbbDeleteUrl || '',
      imgbbThumbUrl: merged.imgbbThumbUrl || '',
      filemoonWatchUrl: merged.filemoonWatchUrl || '',
      filemoonDirectUrl: merged.filemoonDirectUrl || '',
      udropWatchUrl: merged.udropWatchUrl || '',
      udropDirectUrl: merged.udropDirectUrl || '',
      linkUrl: merged.linkUrl || '',
      linkUrlCanonical: canonicalLink,
      linkPreviewImageUrl: merged.linkPreviewImageUrl || '',
      faviconUrl: merged.faviconUrl || '',
      lastVisitedAt: merged.lastVisitedAt || null,
      deletedAt: merged.deletedAt || null,
      exifMetadata: merged.exifMetadata || null,
      extraMetadata: merged,
    };
  }

  fromNeonMediaRow(row = {}) {
    const extra = row.extra_metadata && typeof row.extra_metadata === 'object' ? row.extra_metadata : {};
    return {
      ...extra,
      id: row.id,
      isVideo: row.is_video,
      isLink: row.is_link,
      pageTitle: row.page_title || extra.pageTitle || '',
      description: row.description || extra.description || '',
      tags: Array.isArray(row.tags) ? row.tags : (Array.isArray(extra.tags) ? extra.tags : []),
      collectionId: row.collection_id ?? (Object.prototype.hasOwnProperty.call(extra, 'collectionId') ? extra.collectionId : null),
      internalAddedTimestamp: row.internal_added_timestamp || extra.internalAddedTimestamp || '',
      sourceImageUrl: row.source_image_url || extra.sourceImageUrl || '',
      sourcePageUrl: row.source_page_url || extra.sourcePageUrl || '',
      fileName: row.file_name || extra.fileName || '',
      fileSize: row.file_size ?? extra.fileSize ?? null,
      width: row.width ?? extra.width ?? null,
      height: row.height ?? extra.height ?? null,
      duration: row.duration ?? extra.duration ?? null,
      fileType: row.file_type || extra.fileType || '',
      fileTypeSource: row.file_type_source || extra.fileTypeSource || '',
      creationDate: row.creation_date || extra.creationDate || null,
      creationDateSource: row.creation_date_source || extra.creationDateSource || '',
      sha256: row.sha256 || extra.sha256 || '',
      pHash: row.p_hash || extra.pHash || '',
      aHash: row.a_hash || extra.aHash || '',
      dHash: row.d_hash || extra.dHash || '',
      pixvidUrl: row.pixvid_url || extra.pixvidUrl || '',
      pixvidDeleteUrl: row.pixvid_delete_url || extra.pixvidDeleteUrl || '',
      imgbbUrl: row.imgbb_url || extra.imgbbUrl || '',
      imgbbDeleteUrl: row.imgbb_delete_url || extra.imgbbDeleteUrl || '',
      imgbbThumbUrl: row.imgbb_thumb_url || extra.imgbbThumbUrl || '',
      filemoonWatchUrl: row.filemoon_watch_url || extra.filemoonWatchUrl || '',
      filemoonDirectUrl: row.filemoon_direct_url || extra.filemoonDirectUrl || '',
      udropWatchUrl: row.udrop_watch_url || extra.udropWatchUrl || '',
      udropDirectUrl: row.udrop_direct_url || extra.udropDirectUrl || '',
      linkUrl: row.link_url || extra.linkUrl || '',
      linkPreviewImageUrl: row.link_preview_image_url || extra.linkPreviewImageUrl || '',
      faviconUrl: row.favicon_url || extra.faviconUrl || '',
      lastVisitedAt: row.last_visited_at || extra.lastVisitedAt || null,
      exifMetadata: row.exif_metadata || extra.exifMetadata || null,
      deletedAt: row.deleted_at || null,
    };
  }

  async upsertMediaRowNeon(id, payload) {
    const sql = this.ensureNeonReady();
    const p = payload;
    await sql`
      insert into public.media_items (
        id, kind, is_video, is_link, page_title, description, tags, collection_id,
        internal_added_timestamp, source_image_url, source_page_url, file_name, file_size, width, height, duration,
        file_type, file_type_source, creation_date, creation_date_source, sha256, p_hash, a_hash, d_hash,
        pixvid_url, pixvid_delete_url, imgbb_url, imgbb_delete_url, imgbb_thumb_url,
        filemoon_watch_url, filemoon_direct_url, udrop_watch_url, udrop_direct_url,
        link_url, link_url_canonical, link_preview_image_url, favicon_url, last_visited_at,
        deleted_at, exif_metadata, extra_metadata, updated_at
      ) values (
        ${id}, ${p.kind}, ${p.isVideo}, ${p.isLink}, ${p.pageTitle}, ${p.description}, ${JSON.stringify(p.tags)}::jsonb, ${p.collectionId},
        ${p.internalAddedTimestamp}, ${p.sourceImageUrl}, ${p.sourcePageUrl}, ${p.fileName}, ${p.fileSize}, ${p.width}, ${p.height}, ${p.duration},
        ${p.fileType}, ${p.fileTypeSource}, ${p.creationDate}, ${p.creationDateSource}, ${p.sha256}, ${p.pHash}, ${p.aHash}, ${p.dHash},
        ${p.pixvidUrl}, ${p.pixvidDeleteUrl}, ${p.imgbbUrl}, ${p.imgbbDeleteUrl}, ${p.imgbbThumbUrl},
        ${p.filemoonWatchUrl}, ${p.filemoonDirectUrl}, ${p.udropWatchUrl}, ${p.udropDirectUrl},
        ${p.linkUrl}, ${p.linkUrlCanonical}, ${p.linkPreviewImageUrl}, ${p.faviconUrl}, ${p.lastVisitedAt},
        ${p.deletedAt}, ${p.exifMetadata ? JSON.stringify(p.exifMetadata) : null}::jsonb, ${JSON.stringify(p.extraMetadata || {})}::jsonb, now()
      )
      on conflict (id) do update set
        kind = excluded.kind,
        is_video = excluded.is_video,
        is_link = excluded.is_link,
        page_title = excluded.page_title,
        description = excluded.description,
        tags = excluded.tags,
        collection_id = excluded.collection_id,
        internal_added_timestamp = excluded.internal_added_timestamp,
        source_image_url = excluded.source_image_url,
        source_page_url = excluded.source_page_url,
        file_name = excluded.file_name,
        file_size = excluded.file_size,
        width = excluded.width,
        height = excluded.height,
        duration = excluded.duration,
        file_type = excluded.file_type,
        file_type_source = excluded.file_type_source,
        creation_date = excluded.creation_date,
        creation_date_source = excluded.creation_date_source,
        sha256 = excluded.sha256,
        p_hash = excluded.p_hash,
        a_hash = excluded.a_hash,
        d_hash = excluded.d_hash,
        pixvid_url = excluded.pixvid_url,
        pixvid_delete_url = excluded.pixvid_delete_url,
        imgbb_url = excluded.imgbb_url,
        imgbb_delete_url = excluded.imgbb_delete_url,
        imgbb_thumb_url = excluded.imgbb_thumb_url,
        filemoon_watch_url = excluded.filemoon_watch_url,
        filemoon_direct_url = excluded.filemoon_direct_url,
        udrop_watch_url = excluded.udrop_watch_url,
        udrop_direct_url = excluded.udrop_direct_url,
        link_url = excluded.link_url,
        link_url_canonical = excluded.link_url_canonical,
        link_preview_image_url = excluded.link_preview_image_url,
        favicon_url = excluded.favicon_url,
        last_visited_at = excluded.last_visited_at,
        deleted_at = excluded.deleted_at,
        exif_metadata = excluded.exif_metadata,
        extra_metadata = excluded.extra_metadata,
        updated_at = now()
    `;
  }

  async saveImageNeon(imageData) {
    const id = imageData.id || this.generateDocId();
    const payload = this.toNeonMediaPayload(imageData);
    await this.upsertMediaRowNeon(id, payload);
    if (payload.collectionId) {
      await this.incrementCollectionCountNeon(payload.collectionId, 1);
    }
    return id;
  }

  async getAllImagesNeon() {
    const sql = this.ensureNeonReady();
    const rows = await sql`select * from public.media_items where deleted_at is null order by internal_added_timestamp desc`;
    return rows.map((r) => this.fromNeonMediaRow(r));
  }

  async getAllImagesForDuplicateCheckNeon() {
    const sql = this.ensureNeonReady();
    const rows = await sql`select * from public.media_items order by internal_added_timestamp desc`;
    return rows.map((r) => {
      const item = this.fromNeonMediaRow(r);
      if (r.deleted_at) item._isTrash = true;
      return item;
    });
  }

  async getImageByIdNeon(id) {
    const sql = this.ensureNeonReady();
    const rows = await sql`select * from public.media_items where id = ${id} and deleted_at is null limit 1`;
    if (!rows.length) return null;
    return this.fromNeonMediaRow(rows[0]);
  }

  async getTrashedImageByIdNeon(id) {
    const sql = this.ensureNeonReady();
    const rows = await sql`select * from public.media_items where id = ${id} and deleted_at is not null limit 1`;
    if (!rows.length) return null;
    return { ...this.fromNeonMediaRow(rows[0]), _isTrash: true };
  }

  async hasSavedLinkByUrlNeon(pageUrl) {
    const target = String(pageUrl || '').trim();
    if (!target) return false;
    const canonicalTarget = this.canonicalizeLinkUrl(target);
    const sql = this.ensureNeonReady();
    const rows = await sql`select link_url, source_page_url, link_url_canonical from public.media_items where is_link = true and deleted_at is null`;
    return rows.some((row) => {
      const a = this.canonicalizeLinkUrl(row.link_url || '');
      const b = this.canonicalizeLinkUrl(row.source_page_url || '');
      return a === canonicalTarget || b === canonicalTarget || row.link_url_canonical === canonicalTarget;
    });
  }

  async moveToTrashNeon(id) {
    const current = await this.getImageByIdNeon(id);
    if (!current) return false;
    const sql = this.ensureNeonReady();
    await sql`update public.media_items set deleted_at = now(), updated_at = now() where id = ${id}`;
    if (current.collectionId) {
      await this.incrementCollectionCountNeon(current.collectionId, -1);
    }
    return true;
  }

  async getTrashedImagesNeon() {
    const sql = this.ensureNeonReady();
    const rows = await sql`select * from public.media_items where deleted_at is not null order by deleted_at desc`;
    return rows.map((r) => ({ ...this.fromNeonMediaRow(r), _isTrash: true }));
  }

  async restoreFromTrashNeon(id) {
    const current = await this.getTrashedImageByIdNeon(id);
    if (!current) return false;
    const sql = this.ensureNeonReady();
    await sql`update public.media_items set deleted_at = null, updated_at = now() where id = ${id}`;
    if (current.collectionId) {
      await this.incrementCollectionCountNeon(current.collectionId, 1);
    }
    return true;
  }

  async permanentlyDeleteNeon(id) {
    const current = await this.getTrashedImageByIdNeon(id);
    if (!current) return false;
    const pixvidDeleteUrl = current.pixvidDeleteUrl;
    const imgbbDeleteUrl = current.imgbbDeleteUrl;
    if (imgbbDeleteUrl) {
      try { await this.deleteFromImgbb(imgbbDeleteUrl); } catch {}
    }
    if (pixvidDeleteUrl) {
      try { await fetch(pixvidDeleteUrl, { method: 'GET' }); } catch {}
    }
    if (false && imgbbDeleteUrl) {
      try {
        const deleteUrl = new URL(imgbbDeleteUrl);
        const pathParts = deleteUrl.pathname.split('/').filter(p => p);
        if (pathParts.length >= 2) {
          const imageId = pathParts[0];
          const imageHash = pathParts[1];
          const formData = new FormData();
          formData.append('pathname', `/${imageId}/${imageHash}`);
          await fetch('https://imgbb.com/json', { method: 'POST', body: formData });
        }
      } catch {}
    }
    const sql = this.ensureNeonReady();
    await sql`delete from public.media_items where id = ${id}`;
    return true;
  }

  async emptyTrashNeon() {
    const trashed = await this.getTrashedImagesNeon();
    for (const item of trashed) {
      await this.permanentlyDeleteNeon(item.id);
    }
    return trashed.length;
  }

  async updateTrashedImageNeon(id, updates) {
    const sql = this.ensureNeonReady();
    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    if (updates.creationDate !== undefined) {
      setClauses.push(`creation_date = $${paramIndex}`);
      params.push(new Date(updates.creationDate));
      paramIndex++;
    }

    if (setClauses.length === 0) {
      return;
    }

    setClauses.push(`updated_at = now()`);
    
    const query = `UPDATE public.media_items SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`;
    params.push(id);
    
    await sql`${sql.unsafe(query)}`.bind(...params);
    return true;
  }

  async updateImageNeon(id, updates) {
    const sql = this.ensureNeonReady();
    const rows = await sql`select * from public.media_items where id = ${id} limit 1`;
    if (!rows.length) throw new Error('Image not found');
    const existing = this.fromNeonMediaRow(rows[0]);
    const payload = this.toNeonMediaPayload({ ...existing, ...updates });
    await this.upsertMediaRowNeon(id, payload);
    return true;
  }

  async saveUserSettingsNeon(settings) {
    const current = await this.getUserSettingsNeon();
    const merged = { ...(current || {}), ...settings };
    const sql = this.ensureNeonReady();
    await sql`
      insert into public.settings (
        id, pixvid_api_key, imgbb_api_key, filemoon_api_key, udrop_key1, udrop_key2,
        default_gallery_source, default_video_source, updated_at
      ) values (
        'config', ${merged.pixvidApiKey || ''}, ${merged.imgbbApiKey || ''}, ${merged.filemoonApiKey || ''},
        ${merged.udropKey1 || ''}, ${merged.udropKey2 || ''}, ${merged.defaultGallerySource || 'imgbb'},
        ${merged.defaultVideoSource || 'filemoon'}, now()
      )
      on conflict (id) do update set
        pixvid_api_key = excluded.pixvid_api_key,
        imgbb_api_key = excluded.imgbb_api_key,
        filemoon_api_key = excluded.filemoon_api_key,
        udrop_key1 = excluded.udrop_key1,
        udrop_key2 = excluded.udrop_key2,
        default_gallery_source = excluded.default_gallery_source,
        default_video_source = excluded.default_video_source,
        updated_at = now()
    `;
    return true;
  }

  async getUserSettingsNeon() {
    const sql = this.ensureNeonReady();
    const rows = await sql`select * from public.settings where id = 'config' limit 1`;
    if (!rows.length) return null;
    const row = rows[0];
    return {
      pixvidApiKey: row.pixvid_api_key || '',
      imgbbApiKey: row.imgbb_api_key || '',
      filemoonApiKey: row.filemoon_api_key || '',
      udropKey1: row.udrop_key1 || '',
      udropKey2: row.udrop_key2 || '',
      defaultGallerySource: row.default_gallery_source || 'imgbb',
      defaultVideoSource: row.default_video_source || 'filemoon',
      updatedAt: row.updated_at || ''
    };
  }

  async createCollectionNeon(collectionData) {
    const sql = this.ensureNeonReady();
    const id = `collection_${Date.now()}`;
    await sql`
      insert into public.collections (id, name, description, color, image_count, created_at, updated_at)
      values (${id}, ${collectionData.name}, ${collectionData.description || ''}, ${collectionData.color || ''}, 0, now(), now())
    `;
    return {
      id,
      name: collectionData.name,
      description: collectionData.description || '',
      color: collectionData.color || '',
      imageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  async getCollectionsNeon() {
    const sql = this.ensureNeonReady();
    const rows = await sql`select * from public.collections order by name asc`;
    return rows.map((r) => ({
      id: r.id,
      name: r.name || '',
      description: r.description || '',
      color: r.color || '',
      imageCount: Number(r.image_count || 0),
      createdAt: r.created_at || '',
      updatedAt: r.updated_at || '',
    }));
  }

  async updateCollectionNeon(collectionId, updates) {
    const sql = this.ensureNeonReady();
    const rows = await sql`select * from public.collections where id = ${collectionId} limit 1`;
    if (!rows.length) throw new Error('Collection not found');
    const current = rows[0];
    const merged = {
      name: updates.name ?? current.name,
      description: updates.description ?? current.description,
      color: updates.color ?? current.color,
      imageCount: updates.imageCount ?? current.image_count
    };
    await sql`
      update public.collections
      set name = ${merged.name}, description = ${merged.description}, color = ${merged.color},
          image_count = ${Number(merged.imageCount || 0)}, updated_at = now()
      where id = ${collectionId}
    `;
    return {
      id: collectionId,
      name: merged.name,
      description: merged.description,
      color: merged.color,
      imageCount: Number(merged.imageCount || 0),
      createdAt: current.created_at,
      updatedAt: new Date().toISOString()
    };
  }

  async deleteCollectionNeon(collectionId) {
    const sql = this.ensureNeonReady();
    await sql`delete from public.collections where id = ${collectionId}`;
    await sql`update public.media_items set collection_id = null, updated_at = now() where collection_id = ${collectionId}`;
    return true;
  }

  async getImagesByCollectionNeon(collectionId) {
    const sql = this.ensureNeonReady();
    const rows = await sql`
      select * from public.media_items
      where collection_id = ${collectionId} and deleted_at is null
      order by internal_added_timestamp desc
    `;
    return rows.map((r) => this.fromNeonMediaRow(r));
  }

  async incrementCollectionCountNeon(collectionId, delta) {
    const sql = this.ensureNeonReady();
    await sql`
      update public.collections
      set image_count = greatest(0, image_count + ${Number(delta || 0)}), updated_at = now()
      where id = ${collectionId}
    `;
  }
}
