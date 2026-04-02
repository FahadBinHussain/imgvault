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

const NATIVE_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 60 * 1000;

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
    this.defaultActionIcon = {
      16: 'icons/1-16.png',
      32: 'icons/1-32.png',
      48: 'icons/1-48.png',
      128: 'icons/1-128.png',
    };
    this.supportedVideoActionIcon = {
      16: 'icons/2-16.png',
      32: 'icons/2-32.png',
      48: 'icons/2-48.png',
      128: 'icons/2-128.png',
    };
  }

  isSupportedVideoPage(url = '') {
    try {
      const parsedUrl = new URL(url);
      const host = parsedUrl.hostname.toLowerCase();

      return host === 'youtube.com' ||
        host === 'www.youtube.com' ||
        host === 'm.youtube.com' ||
        host === 'youtu.be';
    } catch (error) {
      return false;
    }
  }

  async updateActionIconForTab(tabId, url) {
    if (!tabId || tabId < 0) {
      return;
    }

    const isSupportedVideo = this.isSupportedVideoPage(url);

    await chrome.action.setIcon({
      tabId,
      path: isSupportedVideo ? this.supportedVideoActionIcon : this.defaultActionIcon,
    });

    await chrome.action.setTitle({
      tabId,
      title: isSupportedVideo
        ? 'ImgVault - Supported video page detected'
        : 'ImgVault - Open Gallery',
    });

    await chrome.action.setBadgeText({
      tabId,
      text: '',
    });
  }

  async refreshActionIconForActiveTab() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!activeTab?.id) {
      return;
    }

    await this.updateActionIconForTab(activeTab.id, activeTab.url || '');
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

      // Add menu item for paused YouTube video frame capture
      chrome.contextMenus.create({
        id: 'saveYouTubeFrameToImgVault',
        title: 'Save YouTube Frame to ImgVault',
        contexts: ['all'],
        documentUrlPatterns: [
          '*://*.youtube.com/*',
          '*://youtube.com/*',
          '*://youtu.be/*'
        ]
      }, () => {
        if (chrome.runtime.lastError) {
          console.log('YouTube frame context menu creation:', chrome.runtime.lastError.message);
        } else {
          console.log('✅ YouTube frame context menu created successfully');
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
    } else if (info.menuItemId === 'saveYouTubeFrameToImgVault') {
      console.log('🎬 YouTube frame context menu clicked!');

      try {
        const frameId = Number.isInteger(info.frameId) ? info.frameId : undefined;
        let response = null;

        try {
          response = await chrome.tabs.sendMessage(
            tab.id,
            { action: 'getYouTubeCaptureImage' },
            frameId !== undefined ? { frameId } : undefined
          );
        } catch (messageError) {
          console.log('⚠️ Content script message failed, trying script injection fallback:', messageError.message);
        }

        // Fallback when content script is unavailable in the clicked frame
        if (!response?.imageUrl) {
          const executionTarget = { tabId: tab.id };
          if (frameId !== undefined && frameId >= 0) {
            executionTarget.frameIds = [frameId];
          }

          const scriptResults = await chrome.scripting.executeScript({
            target: executionTarget,
            func: () => {
              const host = window.location.hostname;
              const isYouTubeMusic = host.includes('music.youtube.com');

              const active = document.activeElement;
              const fromActive =
                active?.tagName === 'VIDEO'
                  ? active
                  : typeof active?.closest === 'function'
                    ? active.closest('video')
                    : null;
              const video = fromActive || document.querySelector('video');

              if (video) {
                if (video.readyState >= 2) {
                  const width = video.videoWidth;
                  const height = video.videoHeight;

                  if (width && height) {
                    try {
                      const canvas = document.createElement('canvas');
                      canvas.width = width;
                      canvas.height = height;
                      const ctx = canvas.getContext('2d');
                      if (ctx) {
                        ctx.drawImage(video, 0, 0, width, height);
                        return { imageUrl: canvas.toDataURL('image/png') };
                      }
                    } catch (error) {
                      console.log('YouTube frame draw failed, trying artwork fallback:', error?.message);
                    }
                  }
                }
              }

              if (isYouTubeMusic) {
                const directArtwork = document.querySelector('yt-img-shadow#thumbnail img#img, ytmusic-player yt-img-shadow#thumbnail img, ytmusic-player-bar yt-img-shadow#thumbnail img, ytmusic-player #thumbnail img#img');
                if (directArtwork?.src) return { imageUrl: directArtwork.src };

                const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
                if (ogImage) return { imageUrl: ogImage };

                const candidates = Array.from(document.querySelectorAll('img[src*="ytimg.com"], img[src]'))
                  .filter((img) => (img.naturalWidth || 0) >= 120 && (img.naturalHeight || 0) >= 120 && !!img.src)
                  .sort((a, b) => ((b.naturalWidth || 0) * (b.naturalHeight || 0)) - ((a.naturalWidth || 0) * (a.naturalHeight || 0)));

                if (candidates.length > 0) {
                  return { imageUrl: candidates[0].src };
                }
              }

              return { imageUrl: null, error: 'No capture source found' };
            }
          });

          response = scriptResults?.[0]?.result || null;
        }

        if (!response?.imageUrl) {
          console.log('❌ No paused YouTube frame available:', response?.error || 'Unknown reason');
          return;
        }

        const pageUrl = info.pageUrl || tab.url;
        const pendingData = {
          srcUrl: response.imageUrl,
          originalSourceUrl: info.srcUrl || pageUrl,
          pageUrl,
          pageTitle: tab.title,
          timestamp: Date.now(),
          isYouTubeFrame: true
        };

        console.log('💾 Storing YouTube frame image data:', pendingData);
        await chrome.storage.local.set({ pendingImage: pendingData });

        chrome.tabs.create({
          url: chrome.runtime.getURL('index.html')
        });
      } catch (error) {
        console.error('❌ Failed to capture YouTube frame:', error);
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

      case 'nativeDownload':
        this.handleNativeDownload(request.url, request.requestId)
          .then(result => sendResponse({
            success: true,
            filePath: result.filePath,
            message: result.message,
            stdout: result.stdout,
            stderr: result.stderr
          }))
          .catch(error => {
            const errorPayload = error && typeof error === 'object'
              ? error
              : { message: error?.message || String(error) };

            sendResponse({
              success: false,
              error: errorPayload.message || 'Download failed',
              stdout: errorPayload.stdout,
              stderr: errorPayload.stderr,
              details: errorPayload
            });
          });
        return true;

      case 'nativeHostCommand':
        this.handleNativeHostCommand(request.command, request.data || {})
          .then(result => sendResponse({ success: true, data: result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'getVideoHostSettings':
        this.getMergedVideoHostSettings()
          .then(settings => sendResponse({ success: true, data: settings }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'saveUploadedVideo':
        this.saveUploadedVideo(request.data)
          .then(result => sendResponse({ success: true, data: result }))
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

  async appendUploadLog(message, type = 'info') {
    const entry = {
      timestamp: new Date().toLocaleTimeString(),
      message,
      type,
    };

    const result = await chrome.storage.local.get(['uploadStatusLogs']);
    const nextLogs = [entry, ...(result.uploadStatusLogs || [])].slice(0, 200);
    await chrome.storage.local.set({ uploadStatusLogs: nextLogs });
  }

  async updateStatusWithLog(message, type = 'info') {
    this.updateStatus(message);
    await this.appendUploadLog(message, type);
  }

  formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) {
      return 'unknown size';
    }

    if (bytes === 0) {
      return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** exponent);
    return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
  }

  async getMergedVideoHostSettings() {
    const syncSettings = await chrome.storage.sync.get(['filemoonApiKey', 'udropKey1', 'udropKey2']);
    const merged = { ...syncSettings };

    if (merged.filemoonApiKey && merged.udropKey1 && merged.udropKey2) {
      return merged;
    }

    try {
      const firebaseSettings = await this.storage.getUserSettings();

      if (!merged.filemoonApiKey && firebaseSettings?.filemoonApiKey) {
        merged.filemoonApiKey = firebaseSettings.filemoonApiKey;
      }

      if (!merged.udropKey1 && firebaseSettings?.udropKey1) {
        merged.udropKey1 = firebaseSettings.udropKey1;
      }

      if (!merged.udropKey2 && firebaseSettings?.udropKey2) {
        merged.udropKey2 = firebaseSettings.udropKey2;
      }

      if (
        (!syncSettings.filemoonApiKey && merged.filemoonApiKey) ||
        (!syncSettings.udropKey1 && merged.udropKey1) ||
        (!syncSettings.udropKey2 && merged.udropKey2)
      ) {
        await chrome.storage.sync.set({
          ...(merged.filemoonApiKey ? { filemoonApiKey: merged.filemoonApiKey } : {}),
          ...(merged.udropKey1 ? { udropKey1: merged.udropKey1 } : {}),
          ...(merged.udropKey2 ? { udropKey2: merged.udropKey2 } : {}),
        });
      }
    } catch (error) {
      console.warn('Failed to hydrate video host settings from Firebase:', error);
    }

    return merged;
  }

  async archiveUploadLogRun(status, summary) {
    const storage = await chrome.storage.local.get(['uploadStatusLogs', 'uploadLogHistory']);
    const run = {
      id: `upload-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toLocaleString(),
      status,
      summary,
      logs: storage.uploadStatusLogs || [],
    };

    const nextHistory = [run, ...(storage.uploadLogHistory || [])].slice(0, 20);
    await chrome.storage.local.set({ uploadLogHistory: nextHistory });
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
      await chrome.storage.local.set({ uploadStatusLogs: [] });
      // Get API keys from storage
      const settings = await chrome.storage.sync.get(['pixvidApiKey', 'imgbbApiKey']);
      
      if (!settings.pixvidApiKey) {
        throw new Error('Pixvid API key not configured. Please set it in the extension settings.');
      }
      
      const hasImgbb = !!settings.imgbbApiKey;

      await this.updateStatusWithLog('📥 Fetching image...');
      
      // Fetch the image
      const imageSource = data.fileBlob instanceof Blob ? data.fileBlob : data.imageUrl;
      const imageBlob = await this.fetchImage(imageSource);
      
      await this.updateStatusWithLog('🔍 Extracting image metadata...');
      
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
        await this.updateStatusWithLog('🔎 Checking for duplicates...');
        
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
        await this.updateStatusWithLog('⚠️ Skipping duplicate check...', 'warning');
      }
      
      // Upload to both APIs in parallel
      await this.updateStatusWithLog(hasImgbb ? '☁️ Uploading to Pixvid and ImgBB...' : '☁️ Uploading to Pixvid...');
      
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
        await this.updateStatusWithLog('⚠️ Pixvid upload successful, ImgBB failed. Saving...', 'warning');
      } else if (imgbbResult) {
        await this.updateStatusWithLog('✅ Both uploads successful! Saving...', 'success');
      }
      
      await this.updateStatusWithLog('💾 Saving to Firebase...');
      
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
      
      await this.updateStatusWithLog('✅ Image saved successfully!', 'success');
      
      await this.archiveUploadLogRun('success', 'Image upload completed successfully.');

      return {
        id: savedId,
        pixvidUrl: pixvidResult.url,
        imgbbUrl: imgbbResult && !imgbbResult.error ? imgbbResult.url : null,
        ...imageMetadata
      };
    } catch (error) {
      console.error('Upload error:', error);
      await this.archiveUploadLogRun('error', error.message || 'Image upload failed.');
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
      await chrome.storage.local.set({ uploadStatusLogs: [] });
      // Get API keys from storage
      const settings = await this.getMergedVideoHostSettings();
      
      const hasFilemoon = !!settings.filemoonApiKey;
      const hasUDrop = settings.udropKey1 && settings.udropKey2;
      
      if (!hasFilemoon && !hasUDrop) {
        throw new Error('No video hosting service configured. Please set Filemoon API key or UDrop API keys in settings.');
      }

      await this.updateStatusWithLog('📥 Fetching video...');
      
      // Fetch the video once
      const videoSource = data.fileBlob instanceof Blob ? data.fileBlob : data.imageUrl;
      const videoBlob = await this.fetchImage(videoSource);
      const expectedSize = Number.isFinite(data.fileSize) ? data.fileSize : null;

      if (!(videoBlob instanceof Blob) || videoBlob.size <= 0) {
        throw new Error('Video payload is empty. Please reload the file and try again.');
      }

      if (expectedSize && videoBlob.size !== expectedSize) {
        await this.appendUploadLog(
          `⚠️ Video payload size mismatch. Expected ${this.formatBytes(expectedSize)}, received ${this.formatBytes(videoBlob.size)}.`,
          'warning'
        );
      } else {
        await this.appendUploadLog(`📦 Video payload ready: ${this.formatBytes(videoBlob.size)}.`);
      }
      
      // Build status message based on available services
      const services = [];
      if (hasFilemoon) services.push('Filemoon');
      if (hasUDrop) services.push('UDrop');
      
      const statusMsg = services.length > 1 
        ? `☁️ Uploading to ${services.join(' and ')}...`
        : `☁️ Uploading to ${services[0]}...`;
      
      await this.updateStatusWithLog(statusMsg);
      
      // Upload to available services sequentially: UDrop first, then Filemoon.
      let udropResult = null;
      let filemoonResult = null;
      const uploadErrors = [];

      if (hasUDrop) {
        await this.appendUploadLog('UDrop: authorizing and starting upload...');
        try {
          udropResult = await this.udropUploader.upload(
            videoBlob,
            settings.udropKey1,
            settings.udropKey2,
            data.fileName || 'video.mp4'
          );
          await this.appendUploadLog(`UDrop: upload completed for ${udropResult.filename || data.fileName || 'video file'}`, 'success');
          await this.appendUploadLog(`UDrop API status: ${udropResult.apiStatus || 'unknown'}`);
          if (udropResult.apiResponse) {
            await this.appendUploadLog(`UDrop API message: ${udropResult.apiResponse}`);
          }
          if (udropResult.fileId) {
            await this.appendUploadLog(`UDrop file_id: ${udropResult.fileId}`);
          }
          if (udropResult.accountId) {
            await this.appendUploadLog(`UDrop account_id: ${udropResult.accountId}`);
          }
          if (udropResult.shortUrl) {
            await this.appendUploadLog(`UDrop short URL: ${udropResult.shortUrl}`);
          }
          if (udropResult.url) {
            await this.appendUploadLog(`UDrop download URL: ${udropResult.url}`);
          }
        } catch (err) {
          console.error('UDrop upload failed:', err);
          uploadErrors.push(`udrop: ${err.message || String(err)}`);
          await this.appendUploadLog(`UDrop failed: ${err.message || String(err)}`, 'error');
        }
      }

      if (hasFilemoon) {
        await this.appendUploadLog('Starting Filemoon upload after UDrop finished...');
        await this.appendUploadLog('Filemoon: requesting upload server...');
        try {
          filemoonResult = await this.filemoonUploader.upload(
            videoBlob,
            settings.filemoonApiKey,
            data.fileName || 'video.mp4'
          );
          await this.appendUploadLog(`Filemoon: upload completed for ${filemoonResult.filename || data.fileName || 'video file'}`, 'success');
        } catch (err) {
          console.error('Filemoon upload failed:', err);
          uploadErrors.push(`filemoon: ${err.message || String(err)}`);
          await this.appendUploadLog(`Filemoon failed: ${err.message || String(err)}`, 'error');
        }
      }

      if (!filemoonResult && !udropResult) {
        await this.appendUploadLog('❌ No video host completed successfully.', 'error');
        throw new Error(uploadErrors.length > 0
          ? `Video upload failed on all configured hosts. ${uploadErrors.join(' | ')}`
          : 'Video upload failed on all configured hosts.');
      }

      if (uploadErrors.length > 0) {
        await this.updateStatusWithLog(`⚠️ Partial upload success. ${uploadErrors.join(' | ')}`, 'warning');
      }
      
      await this.updateStatusWithLog('💾 Saving to Firebase...');
      
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
        duration: Number.isFinite(data.duration) ? data.duration : null,
        width: Number.isFinite(data.width) ? data.width : null,
        height: Number.isFinite(data.height) ? data.height : null,
        tags: data.tags || [],
        description: data.description || '',
        collectionId: data.collectionId || null,
        isVideo: true
      };
      
      // Add Filemoon URLs if uploaded successfully
      if (filemoonResult) {
        videoMetadata.filemoonWatchUrl = filemoonResult.watchUrl || filemoonResult.url || '';
        videoMetadata.filemoonDirectUrl = filemoonResult.directUrl || '';
      }
      
      if (udropResult) {
        videoMetadata.udropWatchUrl = udropResult.watchUrl || udropResult.displayUrl || '';
        videoMetadata.udropDirectUrl = udropResult.directUrl || udropResult.url || '';
      }
      
      if (udropResult) {
        await this.appendUploadLog(`🔐 UDrop authorized, account: ${udropResult.accountId || 'unknown'}`);
        await this.appendUploadLog(`📦 [UDROP] File uploaded successfully`, 'success');
        await this.appendUploadLog(`📦 [UDROP] URL: ${udropResult.displayUrl || udropResult.url || ''}`);
        if (udropResult.shortUrl) {
          await this.appendUploadLog(`📦 [UDROP] Short URL: ${udropResult.shortUrl}`);
        }
        if (udropResult.fileId) {
          await this.appendUploadLog(`📦 [UDROP] File ID: ${udropResult.fileId}`);
        }
        if (udropResult.url) {
          await this.appendUploadLog(`📦 [UDROP] Download URL: ${udropResult.url}`);
        }
      }

      const savedId = await this.storage.saveImage(videoMetadata);
      await this.appendUploadLog(`📊 [SAVE VIDEO] Video metadata size: ${JSON.stringify(videoMetadata).length} bytes`);
      await this.appendUploadLog(`✅ [SAVE VIDEO] Saved successfully with ID: ${savedId}`, 'success');
      
      await this.updateStatusWithLog('Video saved successfully!', 'success');
      
      await this.archiveUploadLogRun(
        uploadErrors.length > 0 ? 'warning' : 'success',
        uploadErrors.length > 0
          ? `Video upload completed with partial success. ${uploadErrors.join(' | ')}`
          : 'Video upload completed successfully.'
      );

      return {
        id: savedId,
        ...videoMetadata
      };
    } catch (error) {
      console.error('Video upload error:', error);
      await this.archiveUploadLogRun('error', error.message || 'Video upload failed.');
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
      
      const response = await fetch(`https://api.byse.sx/images/thumb?key=${apiKey}&file_code=${filecode}`);
      
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
   * Handle native host download via native messaging
   * @param {string} url - URL to download
   * @returns {Promise<Object>} Download result with file path
   */
  async handleNativeDownload(url, requestId = '') {
    try {
      console.log(`📥 [NATIVE] Sending download request for: ${url}`);

      const downloadFolder = await this.resolveNativeDownloadFolder();
      const cookies = await this.getYouTubeCookiesForYtDlp();

      // Generate output path with timestamp
      const timestamp = Date.now();
      const outputPath = `${downloadFolder}\\yt-dlp-${timestamp}.%(ext)s`;
      
      console.log(`📁 [NATIVE] Download folder: ${downloadFolder}`);
      console.log(`📝 [NATIVE] Output path template: ${outputPath}`);
      console.log(`🍪 [NATIVE] Prepared ${cookies.length} cookies for native download`);
      console.log(`🔌 [NATIVE] Attempting to connect to native host: com.imgvault.nativehost`);
      
      // Connect to native messaging host
      let port;
      try {
        port = chrome.runtime.connectNative('com.imgvault.nativehost');
        console.log(`✅ [NATIVE] Port connected successfully`);
      } catch (connectError) {
        console.error(`❌ [NATIVE] Failed to connect:`, connectError);
        throw new Error('Failed to connect to native host: ' + connectError.message);
      }
      
      const activeRequestId = requestId || `native-download-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      return new Promise((resolve, reject) => {
        let responseReceived = false;
        
        // Large yt-dlp jobs can take a long time before the native host replies.
        const timeout = setTimeout(() => {
          if (!responseReceived) {
            console.error(`⏱️ [NATIVE] Timeout waiting for response`);
            port.disconnect();
            reject(new Error('Download timed out while waiting for the native host to finish. The file may still be downloading in the background.'));
          }
        }, NATIVE_DOWNLOAD_TIMEOUT_MS);
        
        port.onMessage.addListener((response) => {
          console.log(`📨 [NATIVE] Response from host:`, response);
          if (response?.event === 'progress') {
            chrome.runtime.sendMessage({
              action: 'nativeDownloadProgress',
              requestId: response.requestId || activeRequestId,
              stream: response.stream || 'stdout',
              line: response.line || '',
            }).catch(() => {});
            return;
          }

          responseReceived = true;
          clearTimeout(timeout);
          
          if (response.success) {
            resolve(response);
          } else {
            reject({
              message: response.message || 'Native host download failed',
              filePath: response.filePath,
              stdout: response.stdout,
              stderr: response.stderr
            });
          }
          
          port.disconnect();
        });
        
        port.onDisconnect.addListener(() => {
          clearTimeout(timeout);
          if (!responseReceived) {
            console.error(`❌ [NATIVE] Port disconnected without response`);
            const error = chrome.runtime.lastError;
            const errorMsg = error ? error.message : 'Native host disconnected unexpectedly. Make sure the native host is registered.';
            console.error(`❌ [NATIVE] Error details:`, errorMsg);
            reject(new Error(errorMsg));
          }
        });
        
        // Send download request
        try {
          port.postMessage({
            action: 'download',
            url: url,
            output_path: outputPath,
            cookies_data: cookies,
            request_id: activeRequestId,
          });
          console.log(`✉️ [NATIVE] Message sent to native host:`, {
            action: 'download',
            url,
            output_path: outputPath,
            cookies_count: cookies.length,
            request_id: activeRequestId,
          });
        } catch (sendError) {
          console.error(`❌ [NATIVE] Failed to send message:`, sendError);
          clearTimeout(timeout);
          reject(new Error('Failed to send message to native host: ' + sendError.message));
        }
      });
    } catch (error) {
      console.error(`❌ [NATIVE] Failed to communicate with native host:`, error);
      throw error;
    }
  }

  async resolveNativeDownloadFolder() {
    const settings = await new Promise((resolve) => {
      chrome.storage.sync.get(['downloadFolder'], (result) => {
        resolve(result);
      });
    });

    const configuredFolder = (settings.downloadFolder || '').trim();
    if (configuredFolder) {
      return configuredFolder;
    }

    const response = await this.handleNativeHostCommand('get_default_video_directory');
    const detectedFolder = (response?.filePath || response?.message || '').trim();

    if (!detectedFolder) {
      throw new Error('Native host did not return a default Videos folder.');
    }

    await chrome.storage.sync.set({ downloadFolder: detectedFolder });
    console.log(`📁 [NATIVE] Auto-detected default video folder: ${detectedFolder}`);
    return detectedFolder;
  }

  async handleNativeHostCommand(command, data = {}) {
    try {
      console.log(`[NATIVE] Sending host command: ${command}`, data);

      let port;
      try {
        port = chrome.runtime.connectNative('com.imgvault.nativehost');
      } catch (connectError) {
        throw new Error('Failed to connect to native host: ' + connectError.message);
      }

      return new Promise((resolve, reject) => {
        let responseReceived = false;

        const timeout = setTimeout(() => {
          if (!responseReceived) {
            port.disconnect();
            reject(new Error('Timeout waiting for native host response'));
          }
        }, 15000);

        port.onMessage.addListener((response) => {
          responseReceived = true;
          clearTimeout(timeout);

          if (response.success) {
            resolve(response);
          } else {
            reject(new Error(response.message || 'Native host command failed'));
          }

          port.disconnect();
        });

        port.onDisconnect.addListener(() => {
          clearTimeout(timeout);
          if (!responseReceived) {
            const error = chrome.runtime.lastError;
            reject(new Error(error ? error.message : 'Native host disconnected unexpectedly.'));
          }
        });

        try {
          port.postMessage({
            action: command,
            ...data
          });
        } catch (sendError) {
          clearTimeout(timeout);
          reject(new Error('Failed to send message to native host: ' + sendError.message));
        }
      });
    } catch (error) {
      console.error('[NATIVE] Failed to send host command:', error);
      throw error;
    }
  }

  async getYouTubeCookiesForYtDlp() {
    const [youtubeCookies, googleCookies] = await Promise.all([
      chrome.cookies.getAll({ domain: '.youtube.com' }),
      chrome.cookies.getAll({ domain: '.google.com' }),
    ]);

    const allCookies = [...youtubeCookies, ...googleCookies];

    return Array.from(
      new Map(
        allCookies.map((cookie) => [
          `${cookie.domain}|${cookie.path}|${cookie.name}|${cookie.storeId ?? ''}`,
          {
            domain: cookie.domain || '',
            host_only: !(cookie.domain || '').startsWith('.'),
            path: cookie.path || '/',
            secure: !!cookie.secure,
            expiration_date:
              typeof cookie.expirationDate === 'number'
                ? Math.floor(cookie.expirationDate)
                : 0,
            name: cookie.name || '',
            value: cookie.value || '',
          },
        ])
      ).values()
    );
  }

  /**
   * Fetch image from URL or data URL
   * @param {string} imageUrl - Image URL or data URL
   * @returns {Promise<Blob>} Image blob
   */
  async fetchImage(imageUrl) {
    if (imageUrl instanceof Blob) {
      return imageUrl;
    }

    if (typeof imageUrl !== 'string') {
      throw new Error('Unsupported media source. Please reload the file and try again.');
    }

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

  async saveUploadedVideo(data) {
    const fileName = this.extractFileName(data);

    let cleanSourceImageUrl = data.originalSourceUrl || data.imageUrl;
    if (cleanSourceImageUrl && cleanSourceImageUrl.startsWith('data:')) {
      cleanSourceImageUrl = '';
    }

    let creationDate = null;
    let creationDateSource = '';

    if (data.fileLastModified) {
      creationDate = new Date(data.fileLastModified).toISOString();
      creationDateSource = 'OS lastModified';
    } else {
      creationDate = new Date().toISOString();
      creationDateSource = 'Current timestamp (no metadata available)';
    }

    const videoMetadata = {
      sourceImageUrl: cleanSourceImageUrl,
      sourcePageUrl: data.pageUrl,
      pageTitle: data.pageTitle,
      fileName,
      fileSize: data.fileSize || 0,
      fileType: data.fileType || data.fileMimeType || '',
      fileTypeSource: 'File object',
      creationDate,
      creationDateSource,
      duration: Number.isFinite(data.duration) ? data.duration : null,
      width: Number.isFinite(data.width) ? data.width : null,
      height: Number.isFinite(data.height) ? data.height : null,
      tags: data.tags || [],
      description: data.description || '',
      collectionId: data.collectionId || null,
      isVideo: true,
      filemoonWatchUrl: data.filemoonResult?.watchUrl || data.filemoonResult?.url || '',
      filemoonDirectUrl: data.filemoonResult?.directUrl || '',
      udropWatchUrl: data.udropResult?.watchUrl || data.udropResult?.displayUrl || '',
      udropDirectUrl: data.udropResult?.directUrl || data.udropResult?.url || '',
    };

    await this.updateStatusWithLog('Saving video metadata...');
    const savedId = await this.storage.saveImage(videoMetadata);
    await this.appendUploadLog(`[SAVE VIDEO] Video metadata size: ${JSON.stringify(videoMetadata).length} bytes`);
    await this.appendUploadLog(`[SAVE VIDEO] Saved successfully with ID: ${savedId}`, 'success');
    await this.updateStatusWithLog('Video saved successfully!', 'success');

    return {
      id: savedId,
      ...videoMetadata
    };
  }
}

// Initialize service worker
const serviceWorker = new ImgVaultServiceWorker();

// Event listeners
chrome.runtime.onInstalled.addListener(() => {
  serviceWorker.init();
  serviceWorker.createContextMenu();
  serviceWorker.refreshActionIconForActiveTab();
});

// Create context menu on browser startup
chrome.runtime.onStartup.addListener(() => {
  serviceWorker.init();
  serviceWorker.createContextMenu();
  serviceWorker.refreshActionIconForActiveTab();
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await serviceWorker.updateActionIconForTab(tabId, tab.url || '');
  } catch (error) {
    console.debug('Failed to update action icon on tab activation:', error);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'complete') {
    return;
  }

  try {
    await serviceWorker.updateActionIconForTab(tabId, changeInfo.url || tab.url || '');
  } catch (error) {
    console.debug('Failed to update action icon on tab update:', error);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  serviceWorker.handleContextMenuClick(info, tab);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  return serviceWorker.handleMessage(request, sender, sendResponse);
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  const currentUrl = tab?.url || '';

  if (serviceWorker.isSupportedVideoPage(currentUrl)) {
    const hostUrl = chrome.runtime.getURL(`index.html#/host?url=${encodeURIComponent(currentUrl)}`);
    chrome.tabs.create({ url: hostUrl });
    return;
  }

  chrome.tabs.create({
    url: chrome.runtime.getURL('index.html')
  });
});

// Export for testing
export default serviceWorker;

