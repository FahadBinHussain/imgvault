/**
 * @fileoverview Next-Gen Service Worker for ImgVault Extension
 * @description Handles context menu, image uploads, and storage with modern ES6+ patterns
 * @version 2.0.0
 */

import { StorageManager } from '../utils/storage.js';
import { DuplicateDetector } from '../utils/duplicate-detector.js';
import { URLNormalizer } from '../utils/url-normalizer.js';
import { PixvidUploader, ImgbbUploader, FilemoonUploader, UDropUploader } from '../utils/uploaders.js';
import { sitesConfig, isWarningSite, isGoodQualitySite, getSiteDisplayName } from '../config/sitesConfig.js';

/**
 * @typedef {Object} ImageData
 * @property {string} imageUrl - The image URL or data URL
 * @property {string} pageUrl - The source page URL
 * @property {string} [pageTitle] - The page title
 * @property {string} [originalSourceUrl] - Original source URL before replacement
 * @property {string} [fileName] - The file name
 * @property {string[]} [tags] - Image tags
 * @property {string} [description] - Image description
 * @property {boolean} [ignoreDuplicate] - Whether to skip duplicate check
 */

class ImgVaultServiceWorker {
  constructor() {
    this.storage = new StorageManager();
    this.duplicateDetector = new DuplicateDetector();
    this.pixvidUploader = new PixvidUploader();
    this.imgbbUploader = new ImgbbUploader();
    this.filemoonUploader = new FilemoonUploader();
    this.udropUploader = new UDropUploader();
    this.initialized = false;
  }

  /**
   * Initialize the service worker
   */
  async init() {
    try {
      await this.storage.init();
      this.initialized = true;
      console.log('✅ ImgVault Service Worker initialized');
    } catch (error) {
      console.error('❌ Failed to initialize storage:', error);
    }
  }

  /**
   * Create context menu
   */
  createContextMenu() {
    // Remove existing menu items first to avoid duplicates
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'saveToImgVault',
        title: 'Save to ImgVault',
        contexts: ['image']
      }, () => {
        if (chrome.runtime.lastError) {
          console.log('Context menu creation:', chrome.runtime.lastError.message);
        } else {
          console.log('✅ Context menu created successfully');
        }
      });
      
      // Add menu item for background images (rajce.idnes.cz and similar sites)
      chrome.contextMenus.create({
        id: 'saveBackgroundToImgVault',
        title: 'Save Background Image to ImgVault',
        contexts: ['all'],
        documentUrlPatterns: [
          '*://*.rajce.idnes.cz/*',
          '*://*.flickr.com/*'
        ]
      }, () => {
        if (chrome.runtime.lastError) {
          console.log('Background context menu creation:', chrome.runtime.lastError.message);
        } else {
          console.log('✅ Background context menu created successfully');
        }
      });
    });
  }

  /**
   * Handle context menu click
   * @param {chrome.contextMenus.OnClickData} info - Menu click info
   * @param {chrome.tabs.Tab} tab - Active tab
   */
  async handleContextMenuClick(info, tab) {
    if (info.menuItemId === 'saveToImgVault') {
      console.log('🎯 Context menu clicked!');
      console.log('📸 info.srcUrl:', info.srcUrl);
      console.log('📍 Page URL:', info.pageUrl || tab.url);
      
      const pageUrl = info.pageUrl || tab.url;
      const isWarning = isWarningSite(pageUrl);
      const warningSite = getSiteDisplayName(pageUrl, sitesConfig.warningSites);
      const isGood = isGoodQualitySite(pageUrl);
      const goodSite = getSiteDisplayName(pageUrl, sitesConfig.goodQualitySites);
      
      // Check if image is base64
      const isBase64 = info.srcUrl && info.srcUrl.startsWith('data:image');
      console.log('🔍 Is Base64?', isBase64);
      
      const pendingData = {
        srcUrl: info.srcUrl,
        pageUrl,
        pageTitle: tab.title,
        timestamp: Date.now(),
        isWarningSite: isWarning,
        warningSiteName: warningSite,
        isGoodQualitySite: isGood,
        goodQualitySiteName: goodSite,
        isBase64
      };
      
      console.log('💾 Storing pending image data:', pendingData);
      
      await chrome.storage.local.set({
        pendingImage: pendingData
      });
      
      console.log('✅ Pending image stored!');
      
      // Open the gallery page instead of popup
      chrome.tabs.create({
        url: chrome.runtime.getURL('index.html')
      });
    } else if (info.menuItemId === 'saveBackgroundToImgVault') {
      console.log('🎯 Background image context menu clicked!');
      
      // Try to get the image URL from storage (set by content script on right-click)
      const storageData = await chrome.storage.local.get(['lastRightClickImageUrl', 'lastRightClickTimestamp']);
      
      let imageUrl = null;
      
      // Check if we have a recent right-click image (within 2 seconds)
      if (storageData.lastRightClickImageUrl && 
          storageData.lastRightClickTimestamp && 
          Date.now() - storageData.lastRightClickTimestamp < 2000) {
        imageUrl = storageData.lastRightClickImageUrl;
        console.log('🎨 Using stored right-click image URL:', imageUrl);
      }
      
      // If no stored URL, try content script
      if (!imageUrl) {
        try {
          const response = await chrome.tabs.sendMessage(tab.id, {
            action: 'getBackgroundImage',
            x: info.x || 0,
            y: info.y || 0
          });
          
          if (response && response.imageUrl) {
            imageUrl = response.imageUrl;
            console.log('🎨 Got image from content script:', imageUrl);
          }
        } catch (error) {
          console.log('⚠️ Content script not responding:', error.message);
        }
      }
      
      // If still no URL, try inline script as fallback
      if (!imageUrl) {
        console.log('⚠️ No stored URL, using inline script fallback...');
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              // Try to find elements with background images
              const elements = document.querySelectorAll('[data-cover-image-url-set], [style*="background-image"]');
              
              for (const el of elements) {
                const coverImageUrlSet = el.getAttribute('data-cover-image-url-set');
                if (coverImageUrlSet) {
                  const urls = coverImageUrlSet.split(',').map(s => s.trim().split(' ')[0]);
                  return urls[0];
                }
                
                const style = el.getAttribute('style');
                if (style && style.includes('background-image')) {
                  const match = style.match(/background-image:\s*url\(['"]?(.+?)['"]?\)/);
                  if (match) return match[1];
                }
              }
              
              return null;
            }
          });
          
          if (results && results[0] && results[0].result) {
            imageUrl = results[0].result;
            console.log('🎨 Found image with inline script:', imageUrl);
          }
        } catch (error) {
          console.error('❌ Inline script failed:', error);
        }
      }
      
      if (imageUrl) {
        const pageUrl = info.pageUrl || tab.url;
        
        const pendingData = {
          srcUrl: imageUrl,
          pageUrl,
          pageTitle: tab.title,
          timestamp: Date.now(),
          isBackgroundImage: true
        };
        
        console.log('💾 Storing background image data:', pendingData);
        
        await chrome.storage.local.set({
          pendingImage: pendingData
        });
        
        // Clear the stored right-click URL
        await chrome.storage.local.remove(['lastRightClickImageUrl', 'lastRightClickTimestamp']);
        
        console.log('✅ Background image stored!');
        
        chrome.tabs.create({
          url: chrome.runtime.getURL('index.html')
        });
      } else {
        console.log('❌ No background image found');
      }
    }
  }

  /**
   * Handle runtime messages
   * @param {Object} request - Message request
   * @param {chrome.runtime.MessageSender} sender - Message sender
   * @param {Function} sendResponse - Response callback
   * @returns {boolean} - Keep message channel open
   */
  handleMessage(request, sender, sendResponse) {
    const { action } = request;

    switch (action) {
      case 'uploadImage':
        this.handleImageUpload(request.data)
          .then(result => sendResponse({ success: true, data: result }))
          .catch(error => sendResponse({ 
            success: false, 
            error: error.message,
            duplicate: error.duplicate || null,
            allDuplicates: error.allDuplicates || null
          }));
        return true;

      case 'getImages':
        this.storage.getAllImages()
          .then(images => sendResponse({ success: true, data: images }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'getImageById':
        this.storage.getImageById(request.data.id)
          .then(image => sendResponse({ success: true, data: image }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'updateImage':
        this.storage.updateImage(request.data.id, request.data)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'deleteImage':
        this.storage.moveToTrash(request.data?.id || request.id)
          .then(() => sendResponse({ success: true, data: null }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'getTrashedImages':
        this.storage.getTrashedImages()
          .then(images => sendResponse({ success: true, data: images }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'getTrashedImageById':
        this.storage.getTrashedImageById(request.data.id)
          .then(image => sendResponse({ success: true, data: image }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'restoreFromTrash':
        this.storage.restoreFromTrash(request.data.id)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'permanentlyDelete':
        this.storage.permanentlyDelete(request.data.id)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'emptyTrash':
        this.storage.emptyTrash()
          .then(count => sendResponse({ success: true, data: count }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'extractMetadata':
        this.extractMetadataOnly(request.imageUrl, request.pageUrl, request.fileName, request.fileMimeType, request.fileLastModified)
          .then(metadata => sendResponse({ success: true, metadata }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'createCollection':
        this.storage.createCollection(request.data)
          .then(collection => sendResponse({ success: true, data: collection }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'getCollections':
        this.storage.getCollections()
          .then(collections => sendResponse({ success: true, data: collections }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'updateCollection':
        this.storage.updateCollection(request.data.id, request.data.updates)
          .then(collection => sendResponse({ success: true, data: collection }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'deleteCollection':
        this.storage.deleteCollection(request.data.id)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'getImagesByCollection':
        this.storage.getImagesByCollection(request.data.collectionId)
          .then(images => sendResponse({ success: true, data: images }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'getFilemoonThumbnail':
        this.getFilemoonThumbnail(request.filecode)
          .then(thumbnailUrl => sendResponse({ success: true, thumbnailUrl }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'updateFilemoonThumbnail':
        this.storage.updateImage(request.imageId, { filemoonThumbUrl: request.thumbnailUrl })
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      default:
        console.warn('Unknown action:', action);
        return false;
    }
  }

  /**
   * Update upload status
   * @param {string} message - Status message
   */
  updateStatus(message) {
    chrome.storage.local.set({ uploadStatus: message });
  }

  /**
   * Handle image upload
   * @param {ImageData} data - Image data to upload
   * @returns {Promise<Object>} Upload result
   */
  async handleImageUpload(data) {
    // Check if it's a video upload
    if (data.isVideo) {
      return this.handleVideoUpload(data);
    }
    
    try {
      // Get API keys from storage
      const settings = await chrome.storage.sync.get(['pixvidApiKey', 'imgbbApiKey']);
      
      if (!settings.pixvidApiKey) {
        throw new Error('Pixvid API key not configured. Please set it in the extension settings.');
      }
      
      const hasImgbb = !!settings.imgbbApiKey;

      this.updateStatus('📥 Fetching image...');
      
      // Fetch the image
      const imageBlob = await this.fetchImage(data.imageUrl);
      
      this.updateStatus('🔍 Extracting image metadata...');
      
      // Extract comprehensive metadata
      const metadata = await this.duplicateDetector.extractMetadata(
        imageBlob, 
        data.imageUrl, 
        data.pageUrl
      );
      
      // Compute file type (prefer File object from data, verify against EXIF if present)
      const exifFileType = metadata.exifMetadata?.MIMEType || metadata.exifMetadata?.FileType;
      let fileType = data.fileMimeType || imageBlob.type;
      let fileTypeSource = '';
      
      if (!data.fileMimeType && !exifFileType) {
        // No File object, no EXIF - use blob type (web image)
        fileTypeSource = 'Blob type (web image)';
      } else if (!data.fileMimeType && exifFileType) {
        // No File object but EXIF available - use EXIF (web image with metadata)
        fileType = exifFileType;
        fileTypeSource = 'EXIF (web image)';
      } else if (data.fileMimeType && !exifFileType) {
        // File object but no EXIF
        fileTypeSource = 'File object';
      } else {
        // Both File object and EXIF available
        if (exifFileType !== fileType) {
          console.warn(`⚠️ File type mismatch! File: ${fileType}, EXIF: ${exifFileType}`);
          fileTypeSource = `File object (verified with EXIF: ${exifFileType})`;
        } else {
          fileTypeSource = 'File object (verified with EXIF ✓)';
        }
      }
      
      // Compute creation date (prefer EXIF, fallback to OS lastModified)
      const exifDate = metadata.exifMetadata?.DateTimeOriginal || 
                       metadata.exifMetadata?.DateTime || 
                       metadata.exifMetadata?.CreateDate;
      let creationDate = null;
      let creationDateSource = '';
      
      if (exifDate) {
        creationDate = new Date(exifDate).toISOString();
        creationDateSource = 'EXIF (DateTimeOriginal)';
      } else if (data.fileLastModified) {
        creationDate = new Date(data.fileLastModified).toISOString();
        creationDateSource = 'OS lastModified (fallback)';
      } else {
        // No EXIF date, no file date - use current timestamp
        creationDate = new Date().toISOString();
        creationDateSource = 'Current timestamp (no metadata available)';
      }
      
      console.log('Extracted metadata:', {
        sha256: metadata.sha256.substring(0, 16) + '...',
        pHash: metadata.pHash.substring(0, 32) + '...',
        width: metadata.width,
        height: metadata.height,
        size: metadata.size,
        fileType,
        fileTypeSource,
        creationDate,
        creationDateSource
      });
      
      // Check for duplicates unless user wants to ignore
      if (!data.ignoreDuplicate) {
        this.updateStatus('🔎 Checking for duplicates...');
        
        const existingImages = await this.storage.getAllImagesForDuplicateCheck();
        
        console.log(`Checking against ${existingImages.length} existing images`);
        
        const duplicateCheck = await this.duplicateDetector.checkDuplicates(
          metadata, 
          existingImages,
          (progressMsg) => this.updateStatus(`🔎 ${progressMsg}`)
        );
        
        if (duplicateCheck.isDuplicate) {
          const error = this.buildDuplicateError(duplicateCheck);
          this.updateStatus('');
          throw error;
        }
      } else {
        console.log('⚠️ Duplicate check SKIPPED - User chose to ignore duplicates');
        this.updateStatus('⚠️ Skipping duplicate check...');
      }
      
      // Upload to both APIs in parallel
      this.updateStatus(hasImgbb ? '☁️ Uploading to Pixvid and ImgBB...' : '☁️ Uploading to Pixvid...');
      
      const uploadPromises = [
        this.pixvidUploader.upload(imageBlob, settings.pixvidApiKey, data.imageUrl)
          .then(result => ({ type: 'pixvid', ...result }))
          .catch(error => ({ type: 'pixvid', error: error.message }))
      ];
      
      if (hasImgbb) {
        uploadPromises.push(
          this.imgbbUploader.upload(imageBlob, settings.imgbbApiKey)
            .then(result => ({ type: 'imgbb', ...result }))
            .catch(error => ({ type: 'imgbb', error: error.message }))
        );
      }
      
      const uploadResults = await Promise.all(uploadPromises);
      
      // Process results
      const pixvidResult = uploadResults.find(r => r.type === 'pixvid');
      const imgbbResult = uploadResults.find(r => r.type === 'imgbb');
      
      if (pixvidResult.error) {
        throw new Error(`Pixvid upload failed: ${pixvidResult.error}`);
      }
      
      if (imgbbResult && imgbbResult.error) {
        console.warn('ImgBB upload failed:', imgbbResult.error);
        this.updateStatus('⚠️ Pixvid upload successful, ImgBB failed. Saving...');
      } else if (imgbbResult) {
        this.updateStatus('✅ Both uploads successful! Saving...');
      }
      
      this.updateStatus('💾 Saving to Firebase...');
      
      // Extract filename if not provided
      const fileName = this.extractFileName(data);
      
      // Clean sourceImageUrl - don't save base64 data URLs to Firebase
      let cleanSourceImageUrl = data.originalSourceUrl || data.imageUrl;
      
      // If it's a data URL (base64), it was uploaded via context menu - no real source URL
      if (cleanSourceImageUrl && cleanSourceImageUrl.startsWith('data:')) {
        console.log('⚠️ [SAVE] Source is base64 data URL (context menu upload), setting source URL to empty');
        cleanSourceImageUrl = '';
      }
      
      // Save metadata to Firebase
      const imageMetadata = {
        pixvidUrl: pixvidResult.url,
        pixvidDeleteUrl: pixvidResult.deleteUrl,
        imgbbUrl: imgbbResult && !imgbbResult.error ? imgbbResult.url : null,
        imgbbDeleteUrl: imgbbResult && !imgbbResult.error ? imgbbResult.deleteUrl : null,
        imgbbThumbUrl: imgbbResult && !imgbbResult.error ? imgbbResult.thumbUrl : null,
        sourceImageUrl: cleanSourceImageUrl,
        sourcePageUrl: data.pageUrl,
        pageTitle: data.pageTitle,
        fileName,
        fileSize: imageBlob.size, // Always include file size from blob
        width: metadata.width, // Image width
        height: metadata.height, // Image height
        sha256: metadata.sha256,
        pHash: metadata.pHash,
        aHash: metadata.aHash,
        dHash: metadata.dHash,
        fileType: // File type from File object or EXIF
        fileTypeSource, // Source of file type (for debugging)
        creationDate, // Creation date from EXIF or file metadata
        creationDateSource, // Source of creation date (for debugging)
        tags: data.tags || [],
        description: data.description || '',
        exifMetadata: metadata.exifMetadata || null,
        collectionId: data.collectionId || null
      };
      
      const savedId = await this.storage.saveImage(imageMetadata);
      
      this.updateStatus('✅ Image saved successfully!');
      
      return {
        id: savedId,
        pixvidUrl: pixvidResult.url,
        imgbbUrl: imgbbResult && !imgbbResult.error ? imgbbResult.url : null,
        ...imageMetadata
      };
    } catch (error) {
      console.error('Upload error:', error);
      throw error;
    }
  }

  /**
   * Handle video upload to both Filemoon and UDrop
   * @param {Object} data - Video data to upload
   * @returns {Promise<Object>} Upload result
   */
  async handleVideoUpload(data) {
    try {
      // Get API keys from storage
      const settings = await chrome.storage.sync.get(['filemoonApiKey', 'udropKey1', 'udropKey2']);
      
      const hasFilemoon = !!settings.filemoonApiKey;
      const hasUDrop = settings.udropKey1 && settings.udropKey2;
      
      if (!hasFilemoon && !hasUDrop) {
        throw new Error('No video hosting service configured. Please set Filemoon API key or UDrop API keys in settings.');
      }

      this.updateStatus('📥 Fetching video...');
      
      // Fetch the video once
      const videoBlob = await this.fetchImage(data.imageUrl);
      
      // Upload to available services in parallel
      const uploadPromises = [];
      
      if (hasFilemoon) {
        this.updateStatus('☁️ Uploading to Filemoon...');
        uploadPromises.push(
          this.filemoonUploader.upload(
            videoBlob, 
            settings.filemoonApiKey, 
            data.fileName || 'video.mp4'
          ).catch(err => {
            console.error('Filemoon upload failed:', err);
            return null; // Don't fail entire upload if one service fails
          })
        );
      }
      
      if (hasUDrop) {
        this.updateStatus('☁️ Uploading to UDrop...');
        uploadPromises.push(
          this.udropUploader.upload(
            videoBlob, 
            settings.udropKey1, 
            settings.udropKey2, 
            data.fileName || 'video.mp4'
          ).catch(err => {
            console.error('UDrop upload failed:', err);
            return null; // Don't fail entire upload if one service fails
          })
        );
      }
      
      const [filemoonResult, udropResult] = await Promise.all(uploadPromises);
      
      this.updateStatus('💾 Saving to Firebase...');
      
      // Extract filename if not provided
      const fileName = this.extractFileName(data);
      
      // Clean sourceImageUrl
      let cleanSourceImageUrl = data.originalSourceUrl || data.imageUrl;
      
      if (cleanSourceImageUrl && cleanSourceImageUrl.startsWith('data:')) {
        console.log('⚠️ [SAVE] Source is base64 data URL (manual upload), setting source URL to empty');
        cleanSourceImageUrl = '';
      }
      
      // Compute creation date
      let creationDate = null;
      let creationDateSource = '';
      
      if (data.fileLastModified) {
        creationDate = new Date(data.fileLastModified).toISOString();
        creationDateSource = 'OS lastModified';
      } else {
        creationDate = new Date().toISOString();
        creationDateSource = 'Current timestamp (no metadata available)';
      }
      
      // Save metadata to Firebase with both URLs
      const videoMetadata = {
        sourceImageUrl: cleanSourceImageUrl,
        sourcePageUrl: data.pageUrl,
        pageTitle: data.pageTitle,
        fileName,
        fileSize: videoBlob.size,
        fileType: data.fileType || data.fileMimeType || videoBlob.type,
        fileTypeSource: 'File object',
        creationDate,
        creationDateSource,
        tags: data.tags || [],
        description: data.description || '',
        collectionId: data.collectionId || null,
        isVideo: true
      };
      
      // Add Filemoon URLs if uploaded successfully
      if (filemoonResult) {
        videoMetadata.filemoonUrl = filemoonResult.url;
        videoMetadata.filemoonThumbUrl = filemoonResult.thumbUrl || '';
      }
      
      // Add UDrop URLs if uploaded successfully
      if (udropResult) {
        videoMetadata.udropUrl = udropResult.url;
        videoMetadata.udropShortUrl = udropResult.shortUrl;
        videoMetadata.udropFileId = udropResult.fileId;
      }
      
      const savedId = await this.storage.saveImage(videoMetadata);
      
      this.updateStatus('✅ Video saved successfully!');
      
      return {
        id: savedId,
        ...videoMetadata
      };
    } catch (error) {
      console.error('Video upload error:', error);
      throw error;
    }
  }

  /**
   * Get Filemoon video thumbnail
   * @param {string} filecode - Filemoon file code
   * @returns {Promise<string|null>} Thumbnail URL or null
   */
  async getFilemoonThumbnail(filecode) {
    try {
      const settings = await this.storage.getUserSettings();
      const apiKey = settings?.filemoonApiKey;
      
      if (!apiKey) {
        throw new Error('Filemoon API key not configured');
      }
      
      console.log(`📸 [FILEMOON] Fetching thumbnail for filecode: ${filecode}`);
      
      const response = await fetch(`https://filemoonapi.com/api/images/thumb?key=${apiKey}&file_code=${filecode}`);
      
      if (!response.ok) {
        throw new Error(`Thumbnail API returned ${response.status}`);
      }
      
      const result = await response.json();
      console.log(`📸 [FILEMOON] Thumbnail API response:`, result);
      
      if (result.status === 200 && result.result?.thumbnail) {
        console.log(`✅ [FILEMOON] Thumbnail URL: ${result.result.thumbnail}`);
        return result.result.thumbnail;
      }
      
      console.warn(`⚠️ [FILEMOON] Thumbnail not available yet for filecode: ${filecode}`);
      return null;
    } catch (error) {
      console.error(`❌ [FILEMOON] Failed to get thumbnail:`, error);
      throw error;
    }
  }

  /**
   * Fetch image from URL or data URL
   * @param {string} imageUrl - Image URL or data URL
   * @returns {Promise<Blob>} Image blob
   */
  async fetchImage(imageUrl) {
    if (imageUrl.startsWith('data:')) {
      const response = await fetch(imageUrl);
      return response.blob();
    } else {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error('Failed to fetch image');
      }
      return response.blob();
    }
  }

  /**
   * Extract filename from data
   * @param {ImageData} data - Image data
   * @returns {string} Filename
   */
  extractFileName(data) {
    let fileName = data.fileName || '';
    
    if (!fileName && data.imageUrl && !data.imageUrl.startsWith('data:')) {
      try {
        const urlPath = new URL(data.imageUrl).pathname;
        fileName = urlPath.split('/').pop().split('?')[0] || '';
      } catch (e) {
        console.log('Could not extract filename from URL:', e);
      }
    }
    
    return fileName;
  }

  /**
   * Extract metadata only without uploading
   * @param {string} imageUrl - Image data URL
   * @param {string} pageUrl - Page URL
   * @param {string} fileName - File name
   * @param {string} fileMimeType - MIME type from File object
   * @param {number} fileLastModified - lastModified timestamp from File object
   * @returns {Promise<Object>} Metadata object
   */
  async extractMetadataOnly(imageUrl, pageUrl, fileName, fileMimeType, fileLastModified) {
    try {
      console.log('🔍 Extracting metadata only...');
      
      // Fetch image
      const response = await fetch(imageUrl);
      const imageBlob = await response.blob();
      
      // Extract metadata using duplicate detector
      const metadata = await this.duplicateDetector.extractMetadata(
        imageBlob,
        imageUrl,
        pageUrl
      );
      
      // Compute file type (prefer File object, verify against EXIF if present)
      const exifFileType = metadata.exifMetadata?.MIMEType || metadata.exifMetadata?.FileType;
      let fileType = fileMimeType || imageBlob.type;
      let fileTypeSource = '';
      
      if (!fileMimeType && !exifFileType) {
        // No File object, no EXIF - use blob type (web image)
        fileTypeSource = 'Blob type (web image)';
      } else if (!fileMimeType && exifFileType) {
        // No File object but EXIF available - use EXIF (web image with metadata)
        fileType = exifFileType;
        fileTypeSource = 'EXIF (web image)';
      } else if (fileMimeType && !exifFileType) {
        // File object but no EXIF
        fileTypeSource = 'File object';
      } else {
        // Both File object and EXIF available
        if (exifFileType !== fileType) {
          console.warn(`⚠️ File type mismatch! File: ${fileType}, EXIF: ${exifFileType}`);
          fileTypeSource = `File object (verified with EXIF: ${exifFileType})`;
        } else {
          fileTypeSource = 'File object (verified with EXIF ✓)';
        }
      }
      
      // Compute creation date (prefer EXIF, fallback to OS lastModified)
      const exifDate = metadata.exifMetadata?.DateTimeOriginal || 
                       metadata.exifMetadata?.DateTime || 
                       metadata.exifMetadata?.CreateDate;
      let creationDate = null;
      let creationDateSource = '';
      
      if (exifDate) {
        creationDate = new Date(exifDate).toISOString();
        creationDateSource = 'EXIF (DateTimeOriginal)';
      } else if (fileLastModified) {
        creationDate = new Date(fileLastModified).toISOString();
        creationDateSource = 'OS lastModified (fallback)';
      } else {
        // No EXIF date, no file date - use current timestamp
        creationDate = new Date().toISOString();
        creationDateSource = 'Current timestamp (no metadata available)';
      }
      
      console.log('✅ Metadata extracted:', metadata);
      console.log('📋 File Type:', fileType, '(', fileTypeSource, ')');
      console.log('📅 Creation Date:', creationDate, '(', creationDateSource, ')');
      
      return {
        ...metadata,
        fileType,
        fileTypeSource,
        creationDate,
        creationDateSource
      };
    } catch (error) {
      console.error('❌ Metadata extraction failed:', error);
      throw error;
    }
  }

  /**
   * Build duplicate error with details
   * @param {Object} duplicateCheck - Duplicate check result
   * @returns {Error} Error with duplicate details
   */
  buildDuplicateError(duplicateCheck) {
    const totalMatches = duplicateCheck.allMatches?.length || 0;
    let errorMsg = `Duplicate image detected! (${totalMatches} match${totalMatches !== 1 ? 'es' : ''} found)\n\n`;
    let duplicateData = null;
    
    if (totalMatches > 0) {
      // Group matches by type
      const contextMatches = duplicateCheck.allMatches.filter(m => m.matchType === 'context');
      const exactMatches = duplicateCheck.allMatches.filter(m => m.matchType === 'exact');
      const visualMatches = duplicateCheck.allMatches.filter(m => m.matchType === 'visual');
      
      // Show context matches
      if (contextMatches.length > 0) {
        errorMsg += `🔗 Context Matches (${contextMatches.length}):\n`;
        contextMatches.slice(0, 3).forEach((match, i) => {
          errorMsg += `  ${i + 1}. Same source URL + page URL\n`;
        });
        if (contextMatches.length > 3) {
          errorMsg += `  ... and ${contextMatches.length - 3} more\n`;
        }
        errorMsg += '\n';
      }
      
      // Show exact matches
      if (exactMatches.length > 0) {
        errorMsg += `🔐 Exact Matches (${exactMatches.length}):\n`;
        exactMatches.slice(0, 3).forEach((match, i) => {
          errorMsg += `  ${i + 1}. Identical file (SHA-256)\n`;
        });
        if (exactMatches.length > 3) {
          errorMsg += `  ... and ${exactMatches.length - 3} more\n`;
        }
        errorMsg += '\n';
      }
      
      // Show visual matches
      if (visualMatches.length > 0) {
        errorMsg += `👁️ Visual Matches (${visualMatches.length}):\n`;
        visualMatches.slice(0, 3).forEach((match, i) => {
          const similarity = match.similarity || '0';
          const matchCount = match.matchCount || 0;
          const hashResults = match.hashResults || {};
          
          const matchedHashes = [];
          if (hashResults.pHash?.match) matchedHashes.push('pHash');
          if (hashResults.aHash?.match) matchedHashes.push('aHash');
          if (hashResults.dHash?.match) matchedHashes.push('dHash');
          
          const matchedHashesStr = matchedHashes.length > 0 ? matchedHashes.join(', ') : 'unknown';
          errorMsg += `  ${i + 1}. ${similarity}% similar (${matchCount}/3 hashes: ${matchedHashesStr})\n`;
        });
        if (visualMatches.length > 3) {
          errorMsg += `  ... and ${visualMatches.length - 3} more\n`;
        }
      }
      
      // Use the first match for duplicate data (maintain backward compatibility)
      duplicateData = duplicateCheck.contextMatch || duplicateCheck.exactMatch || duplicateCheck.visualMatch;
    } else {
      // Fallback to old behavior if allMatches is not available
      if (duplicateCheck.contextMatch) {
        errorMsg += '✗ Same image from same page already exists';
        duplicateData = duplicateCheck.contextMatch;
      } else if (duplicateCheck.exactMatch) {
        errorMsg += '✗ Identical file already exists (SHA-256 match)';
        duplicateData = duplicateCheck.exactMatch;
      } else if (duplicateCheck.visualMatch) {
        const similarity = duplicateCheck.visualMatch.similarity || '0';
        const matchCount = duplicateCheck.visualMatch.matchCount || 0;
        const hashResults = duplicateCheck.visualMatch.hashResults || {};
        
        const matchedHashes = [];
        if (hashResults.pHash?.match) matchedHashes.push('pHash');
        if (hashResults.aHash?.match) matchedHashes.push('aHash');
        if (hashResults.dHash?.match) matchedHashes.push('dHash');
        
        const matchedHashesStr = matchedHashes.length > 0 ? matchedHashes.join(', ') : 'unknown';
        errorMsg += `✗ Visually similar image found (${similarity}% similar, ${matchCount}/3 hashes matched: ${matchedHashesStr})`;
        duplicateData = duplicateCheck.visualMatch;
      }
    }
    
    const error = new Error(errorMsg);
    error.duplicate = duplicateData;
    error.allDuplicates = duplicateCheck.allMatches;  // Include all matches
    return error;
  }
}

// Initialize service worker
const serviceWorker = new ImgVaultServiceWorker();

// Event listeners
chrome.runtime.onInstalled.addListener(() => {
  serviceWorker.init();
  serviceWorker.createContextMenu();
});

// Create context menu on browser startup
chrome.runtime.onStartup.addListener(() => {
  serviceWorker.init();
  serviceWorker.createContextMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  serviceWorker.handleContextMenuClick(info, tab);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  return serviceWorker.handleMessage(request, sender, sendResponse);
});

// Handle extension icon click - open gallery
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('index.html')
  });
});

// Export for testing
export default serviceWorker;
