/**
 * @fileoverview Next-Gen Service Worker for ImgVault Extension
 * @description Handles context menu, image uploads, and storage with modern ES6+ patterns
 * @version 2.0.0
 */

import { StorageManager } from '../utils/storage.js';
import { DuplicateDetector } from '../utils/duplicate-detector.js';
import { URLNormalizer } from '../utils/url-normalizer.js';
import { PixvidUploader, ImgbbUploader } from '../utils/uploaders.js';

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
    chrome.contextMenus.create({
      id: 'saveToImgVault',
      title: 'Save to ImgVault',
      contexts: ['image']
    });
  }

  /**
   * Handle context menu click
   * @param {chrome.contextMenus.OnClickData} info - Menu click info
   * @param {chrome.tabs.Tab} tab - Active tab
   */
  async handleContextMenuClick(info, tab) {
    if (info.menuItemId === 'saveToImgVault') {
      const pageUrl = info.pageUrl || tab.url;
      const isGoogleDrive = pageUrl.includes('drive.google.com');
      
      await chrome.storage.local.set({
        pendingImage: {
          srcUrl: info.srcUrl,
          pageUrl,
          pageTitle: tab.title,
          timestamp: Date.now(),
          isGoogleDrive
        }
      });
      
      // Open the popup
      chrome.action.openPopup();
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
            duplicate: error.duplicate || null
          }));
        return true;

      case 'getImages':
        this.storage.getAllImages()
          .then(images => sendResponse({ success: true, images }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'deleteImage':
        this.storage.deleteImage(request.id)
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
      
      console.log('Extracted metadata:', {
        sha256: metadata.sha256.substring(0, 16) + '...',
        pHash: metadata.pHash.substring(0, 32) + '...',
        width: metadata.width,
        height: metadata.height,
        size: metadata.size
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
      
      // Save metadata to Firebase
      const imageMetadata = {
        pixvidUrl: pixvidResult.url,
        pixvidDeleteUrl: pixvidResult.deleteUrl,
        imgbbUrl: imgbbResult && !imgbbResult.error ? imgbbResult.url : null,
        imgbbDeleteUrl: imgbbResult && !imgbbResult.error ? imgbbResult.deleteUrl : null,
        imgbbThumbUrl: imgbbResult && !imgbbResult.error ? imgbbResult.thumbUrl : null,
        sourceImageUrl: data.originalSourceUrl || data.imageUrl,
        sourcePageUrl: data.pageUrl,
        pageTitle: data.pageTitle,
        fileName,
        fileType: imageBlob.type,
        fileSize: imageBlob.size,
        width: metadata.width,
        height: metadata.height,
        sha256: metadata.sha256,
        pHash: metadata.pHash,
        aHash: metadata.aHash,
        dHash: metadata.dHash,
        tags: data.tags || [],
        description: data.description || ''
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
   * Build duplicate error with details
   * @param {Object} duplicateCheck - Duplicate check result
   * @returns {Error} Error with duplicate details
   */
  buildDuplicateError(duplicateCheck) {
    let errorMsg = 'Duplicate image detected!\n';
    let duplicateData = null;
    
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
    
    const error = new Error(errorMsg);
    error.duplicate = duplicateData;
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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  serviceWorker.handleContextMenuClick(info, tab);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  return serviceWorker.handleMessage(request, sender, sendResponse);
});

// Export for testing
export default serviceWorker;
