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
import {
  filterUploadServicesByKeys,
  getConfiguredImageUploadServices,
  getMissingRequiredImageUploadServices,
} from '../config/providerCatalog.js';
import {
  getImageRetrySourceCandidates,
  getImageUploadService,
  mergeImageProviderResult,
} from '../utils/imageProviderLinks.js';
import { extractFilemoonFilecode, getFilemoonDirectLink, getFilemoonHlsLink } from '../utils/filemoonApi.js';
import { getFilemoonStreamSource } from '../utils/filemoonSpa.js';
import {
  getConfiguredVideoUploadServices,
  getVideoProviderLabel,
  getVideoRetrySourceCandidates,
  getVideoUploadService,
  mergeVideoProviderResult,
} from '../utils/videoProviderLinks.js';
import {
  encryptBlob,
  encryptMetadata,
  hashVaultPasscode,
  unwrapMasterKey,
  createVaultConfig,
} from '../utils/vaultCrypto.js';

const NATIVE_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const TAB_NOT_FOCUSED_NOTIFICATION_ID = 'imgvault-native-tab-not-focused';
const TAB_FOCUSED_NOTIFICATION_ID = 'imgvault-native-tab-focused';
const ACTIVE_NATIVE_DOWNLOAD_KEY = 'activeNativeDownload';

function joinNames(items = []) {
  const names = items.filter(Boolean)
  if (names.length <= 1) return names[0] || ''
  if (names.length === 2) return names.join(' and ')
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

// Helper function to sanitize data for Neon database
function sanitizeForNeon(data) {
  if (typeof data === 'string') {
    // Remove all Unicode characters that might cause issues
    return data
      .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '') // Control chars, zero-width chars
      .replace(/[\uD800-\uDFFF]/g, '') // Surrogate pairs
      .replace(/[\uFFF0-\uFFFF]/g, '') // Special Unicode
      .substring(0, 1000); // Limit length
  }
  if (Array.isArray(data)) {
    return data.map(item => sanitizeForNeon(item));
  }
  if (typeof data === 'object' && data !== null) {
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      sanitized[key] = sanitizeForNeon(value);
    }
    return sanitized;
  }
  return data;
}

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
    this.activeUploadController = null;
    this.activeNativeDownloadPorts = new Map();
    this.vaultMasterKey = null;
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

  getAppUrl(route = '/gallery', { reload = false } = {}) {
    const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
    const reloadToken = reload ? `?open=${Date.now()}` : '';
    return chrome.runtime.getURL(`index.html${reloadToken}#${normalizedRoute}`);
  }

  async findExistingAppTab() {
    const appBaseUrl = chrome.runtime.getURL('index.html');
    const tabs = await chrome.tabs.query({});
    return tabs.find((candidate) => (
      typeof candidate?.url === 'string' &&
      candidate.url.startsWith(appBaseUrl)
    )) || null;
  }

  async openOrFocusApp(route = '/gallery', { reload = false } = {}) {
    const targetUrl = this.getAppUrl(route, { reload });
    const routeFragment = `#${route.startsWith('/') ? route : `/${route}`}`;
    const existingTab = await this.findExistingAppTab();

    if (existingTab?.id) {
      const shouldNavigate = reload || !String(existingTab.url || '').includes(routeFragment);
      try {
        await chrome.tabs.update(existingTab.id, {
          active: true,
          ...(shouldNavigate ? { url: targetUrl } : {}),
        });

        if (existingTab.windowId) {
          await chrome.windows.update(existingTab.windowId, { focused: true });
        }

        return existingTab.id;
      } catch (error) {
        console.warn('[ImgVault] Existing app tab could not be focused. Opening a fresh gallery tab.', error);
      }
    }

    const tab = await chrome.tabs.create({ url: targetUrl, active: true });
    return tab?.id || null;
  }

  isSupportedVideoPage(url = '') {
    try {
      const parsedUrl = new URL(url);
      const host = parsedUrl.hostname.toLowerCase();
      const path = parsedUrl.pathname || '';
      const isYouTubeHost =
        host === 'youtube.com' ||
        host === 'www.youtube.com' ||
        host === 'm.youtube.com';
      const isFacebookHost =
        host === 'facebook.com' ||
        host === 'www.facebook.com' ||
        host === 'm.facebook.com';

      if (host === 'youtu.be') {
        const videoId = parsedUrl.pathname.replace(/^\/+/, '').split('/')[0];
        return Boolean(videoId);
      }

      if (isYouTubeHost) {
        const isWatchPath = parsedUrl.pathname === '/watch';
        const videoId = parsedUrl.searchParams.get('v') || '';
        return isWatchPath && Boolean(videoId);
      }

      if (host === 'fb.watch') {
        const shortId = path.replace(/^\/+/, '').split('/')[0];
        return Boolean(shortId);
      }

      if (isFacebookHost) {
        const watchVideoId = parsedUrl.searchParams.get('v') || '';
        const isWatchPath = path === '/watch' || path === '/watch/';
        const isReelPath = path.startsWith('/reel/');
        const isVideosPath = path.includes('/videos/');
        return (isWatchPath && Boolean(watchVideoId)) || isReelPath || isVideosPath;
      }

      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return false;
      }

      if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')) {
        return false;
      }

      if (path === '/' || path === '') {
        return false;
      }

      return true;
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

    const hasSavedLink = await this.storage.hasSavedLinkByUrl(url);
    await chrome.action.setBadgeText({
      tabId,
      text: hasSavedLink ? 'L' : '',
    });
    if (hasSavedLink) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#16a34a' });
    }
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
      await this.setupDeclarativeNetRules();
      this.initialized = true;
      // console.log('✅ ImgVault Service Worker initialized');
    } catch (error) {
      console.error('❌ Failed to initialize storage or rules:', error);
    }
  }

  async setupDeclarativeNetRules() {
    try {
      if (!chrome.declarativeNetRequest) {
        console.warn('declarativeNetRequest API not available.');
        return;
      }
      
      const pximgRule = {
        id: 1,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Referer', operation: 'set', value: 'https://www.pixiv.net/' }
          ]
        },
        condition: {
          urlFilter: '||pximg.net*',
          resourceTypes: ['xmlhttprequest', 'image', 'other']
        }
      };

      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [1],
        addRules: [pximgRule]
      });
      // console.log('✅ DeclarativeNetRequest rules updated for Pixiv');
    } catch (e) {
      console.error('❌ Failed to update DNR rules:', e);
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
          // console.log('Context menu creation:', chrome.runtime.lastError.message);
        } else {
          // console.log('✅ Context menu created successfully');
        }
      });

      chrome.contextMenus.create({
        id: 'saveWrappedMediaToImgVault',
        title: 'Save to ImgVault',
        contexts: ['all'],
        documentUrlPatterns: [
          'https://www.behance.net/*',
          'https://behance.net/*',
          'https://www.instagram.com/*',
          'https://instagram.com/*',
          'https://www.skidrowreloaded.com/*',
          'https://skidrowreloaded.com/*'
        ]
      }, () => {
        if (chrome.runtime.lastError) {
          // console.log('Wrapped media context menu creation:', chrome.runtime.lastError.message);
        } else {
          // console.log('✅ Wrapped media context menu created successfully');
        }
      });
      


      chrome.contextMenus.create({
        id: 'saveLinkToImgVault',
        title: 'Save Link to ImgVault',
        contexts: ['page', 'link']
      }, () => {
        if (chrome.runtime.lastError) {
          // console.log('Save link context menu creation:', chrome.runtime.lastError.message);
        } else {
          // console.log('✅ Save link context menu created successfully');
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
          // console.log('YouTube frame context menu creation:', chrome.runtime.lastError.message);
        } else {
          // console.log('✅ YouTube frame context menu created successfully');
        }
      });
    });
  }

  extractMetaImageFromHtml(html = '', baseUrl = '') {
    const patterns = [
      /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+property=["']og:image:url["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+name=["']twitter:image:src["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["'][^>]*>/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      const raw = (match?.[1] || '').trim();
      if (!raw) continue;
      try {
        return new URL(raw, baseUrl).toString();
      } catch (error) {
        continue;
      }
    }

    // Fallback: first meaningful image from HTML
    const imgMatches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)];
    for (const m of imgMatches) {
      const raw = String(m?.[1] || '').trim();
      if (!raw) continue;
      if (raw.startsWith('data:')) continue;
      if (/sprite|icon|logo|avatar|emoji/i.test(raw)) continue;
      try {
        return new URL(raw, baseUrl).toString();
      } catch (error) {
        continue;
      }
    }

    return '';
  }

  async getLinkPreviewFromTab(tabId, targetUrl = '') {
    if (!tabId) return '';
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (url) => {
          try {
            const currentHref = window.location.href || '';
            if (url && currentHref && url !== currentHref) {
              // If link target differs from current page, this DOM may not match.
              // Still continue because some menu actions use page URL.
            }

            const fromMeta = (selector, attr = 'content') => {
              const el = document.querySelector(selector);
              const v = el?.getAttribute(attr)?.trim();
              return v || '';
            };

            const candidates = [
              fromMeta('meta[property="og:image:secure_url"]'),
              fromMeta('meta[property="og:image:url"]'),
              fromMeta('meta[property="og:image"]'),
              fromMeta('meta[name="twitter:image:src"]'),
              fromMeta('meta[name="twitter:image"]'),
              fromMeta('meta[itemprop="image"]'),
              fromMeta('link[rel="image_src"]', 'href'),
            ].filter(Boolean);

            // JSON-LD image fallback
            if (!candidates.length) {
              const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
              for (const s of ldScripts) {
                try {
                  const parsed = JSON.parse(s.textContent || '{}');
                  const entries = Array.isArray(parsed) ? parsed : [parsed];
                  for (const entry of entries) {
                    const image = entry?.image;
                    const imageUrl = Array.isArray(image) ? image[0] : image;
                    if (typeof imageUrl === 'string' && imageUrl.trim()) {
                      candidates.push(imageUrl.trim());
                      break;
                    }
                  }
                } catch {}
                if (candidates.length) break;
              }
            }

            if (candidates.length) {
              const resolved = new URL(candidates[0], document.baseURI).toString();
              return resolved;
            }

            // Last resort: biggest likely content image
            const imgs = Array.from(document.images || []);
            const ranked = imgs
              .map((img) => ({
                src: img.currentSrc || img.src || '',
                area: (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0),
              }))
              .filter((x) => x.src && !x.src.startsWith('data:') && x.area > 15000)
              .sort((a, b) => b.area - a.area);

            if (ranked.length) {
              return new URL(ranked[0].src, document.baseURI).toString();
            }

            return '';
          } catch (e) {
            return '';
          }
        },
        args: [targetUrl]
      });

      return String(result || '');
    } catch (error) {
      return '';
    }
  }

  async fetchLinkPreviewImage(linkUrl = '', tabId = null) {
    const target = String(linkUrl || '').trim();
    if (!target) return '';

    // Best source: page DOM directly (works on JS-rendered pages).
    const tabPreview = await this.getLinkPreviewFromTab(tabId, target);
    if (tabPreview) {
      return tabPreview;
    }

    try {
      const response = await fetch(target, { redirect: 'follow' });
      if (!response.ok) return '';
      const finalUrl = response.url || target;
      const html = await response.text();
      return this.extractMetaImageFromHtml(html, finalUrl);
    } catch (error) {
      console.warn('⚠️ Failed to fetch link preview image:', error?.message || error);
      return '';
    }
  }

  /**
   * Handle context menu click
   * @param {chrome.contextMenus.OnClickData} info - Menu click info
   * @param {chrome.tabs.Tab} tab - Active tab
   */
  async handleContextMenuClick(info, tab) {
    console.log('[ImgVault][ContextMenu] Click received', {
      menuItemId: info?.menuItemId,
      srcUrl: info?.srcUrl || null,
      pageUrl: info?.pageUrl || null,
      linkUrl: info?.linkUrl || null,
      x: info?.x ?? null,
      y: info?.y ?? null,
      tabId: tab?.id ?? null,
      tabUrl: tab?.url || null,
    });

    if (info.menuItemId === 'saveLinkToImgVault') {
      console.log('[ImgVault][ContextMenu] Handling saveLinkToImgVault');
      const targetUrl = (info.linkUrl || info.pageUrl || tab?.url || '').trim();
      if (!targetUrl) {
        console.warn('[ImgVault][ContextMenu] No target URL for saveLinkToImgVault');
        return;
      }

      let faviconUrl = '';
      try {
        const parsed = new URL(targetUrl);
        faviconUrl = `${parsed.origin}/favicon.ico`;
      } catch (error) {
        faviconUrl = '';
      }

      const previewImageUrl = await this.fetchLinkPreviewImage(targetUrl, tab?.id || null);

      const alreadySaved = await this.storage.hasSavedLinkByUrl(targetUrl);
      if (alreadySaved) {
        if (tab?.id) {
          await this.updateActionIconForTab(tab.id, tab.url || targetUrl);
        }
        return;
      }

      await this.storage.saveImage({
        isLink: true,
        linkUrl: targetUrl,
        pageTitle: tab?.title || targetUrl,
        description: '',
        tags: [],
        collectionId: null,
        faviconUrl,
        linkPreviewImageUrl: previewImageUrl,
        lastVisitedAt: new Date().toISOString(),
      });

      if (tab?.id) {
        await this.updateActionIconForTab(tab.id, tab.url || targetUrl);
      }

      console.log('[ImgVault][ContextMenu] Link saved, opening gallery tab');
      await this.openOrFocusApp('/gallery', { reload: true });
      return;
    }

    if (info.menuItemId === 'saveToImgVault') {
      console.log('[ImgVault][ContextMenu] Handling saveToImgVault');
      // console.log('🎯 Context menu clicked!');
      // console.log('📸 info.srcUrl:', info.srcUrl);
      // console.log('📍 Page URL:', info.pageUrl || tab.url);

      const pageUrl = info.pageUrl || tab.url;
      let isWarning = isWarningSite(pageUrl);
      const warningSite = getSiteDisplayName(pageUrl, sitesConfig.warningSites);
      const isGood = isGoodQualitySite(pageUrl);
      const goodSite = getSiteDisplayName(pageUrl, sitesConfig.goodQualitySites);

      // Keep full media/data URLs intact. Truncating data URLs corrupts captured frames.
      const sanitizeText = (str, maxLength = 500) =>
        (str || '').replace(/[\u200B-\u200D\uFEFF]/g, '').substring(0, maxLength);
      const sanitizeUrl = (str) => {
        const cleaned = (str || '').replace(/[\u200B-\u200D\uFEFF]/g, '');
        return cleaned.startsWith('data:') ? cleaned : cleaned.substring(0, 4000);
      };

      const pendingData = {
        srcUrl: sanitizeUrl(info.srcUrl),
        originalSourceUrl: sanitizeUrl(info.srcUrl),
        pageUrl: sanitizeUrl(pageUrl),
        pageTitle: sanitizeText(tab.title),
        timestamp: Date.now(),
        isWarningSite: isWarning,
        warningSiteName: warningSite,
        isGoodQualitySite: isGood,
        goodQualitySiteName: goodSite
      };

      console.log('[ImgVault][ContextMenu] Prepared pending image data for saveToImgVault', {
        hasSrcUrl: Boolean(pendingData.srcUrl),
        srcUrlPreview: pendingData.srcUrl ? pendingData.srcUrl.substring(0, 200) : null,
        pageUrl: pendingData.pageUrl,
        pageTitle: pendingData.pageTitle,
      });

      // console.log('💾 Storing pending image data:', pendingData);

      await chrome.storage.local.set({
        pendingImage: pendingData
      });

      console.log('[ImgVault][ContextMenu] Stored pending image for saveToImgVault, opening gallery');

      // console.log('✅ Pending image stored!');
      
      // Open the gallery page instead of popup
      await this.openOrFocusApp('/gallery', { reload: true });
    } else if (info.menuItemId === 'saveWrappedMediaToImgVault') {
      console.log('[ImgVault][ContextMenu] Handling saveWrappedMediaToImgVault');
      let resolvedImageUrl = '';

      const storageData = await chrome.storage.local.get([
        'lastRightClickImageUrl',
        'lastRightClickTimestamp'
      ]);

      console.log('[ImgVault][ContextMenu] Stored right-click media lookup', {
        hasStoredUrl: Boolean(storageData.lastRightClickImageUrl),
        storedUrlPreview: storageData.lastRightClickImageUrl
          ? String(storageData.lastRightClickImageUrl).substring(0, 200)
          : null,
        ageMs: storageData.lastRightClickTimestamp
          ? Date.now() - storageData.lastRightClickTimestamp
          : null,
      });

      if (
        storageData.lastRightClickImageUrl &&
        storageData.lastRightClickTimestamp &&
        Date.now() - storageData.lastRightClickTimestamp < 5000
      ) {
        resolvedImageUrl = storageData.lastRightClickImageUrl;
        console.log('[ImgVault][ContextMenu] Using stored right-click media URL');
      }

      if (!resolvedImageUrl) {
        try {
          const response = await chrome.tabs.sendMessage(tab.id, {
            action: 'getClickedMedia',
            x: info.x || 0,
            y: info.y || 0
          });
          resolvedImageUrl = response?.imageUrl || '';
          console.log('[ImgVault][ContextMenu] Content script fallback response', {
            hasImageUrl: Boolean(resolvedImageUrl),
            imageUrlPreview: resolvedImageUrl ? resolvedImageUrl.substring(0, 200) : null,
          });
        } catch (error) {
          console.warn('[ImgVault][ContextMenu] Failed to resolve wrapped media from content script', error);
        }
      }

      if (!resolvedImageUrl) {
        try {
          const executionTarget = {
            tabId: tab.id,
            ...(typeof info.frameId === 'number' ? { frameIds: [info.frameId] } : {}),
          };

          const scriptResults = await chrome.scripting.executeScript({
            target: executionTarget,
            func: (pageHref) => {
              const getImageUrl = (img) =>
                img?.currentSrc || img?.src || img?.getAttribute?.('src') || '';

              const parseCarouselIndex = () => {
                try {
                  const parsedUrl = new URL(pageHref || window.location.href);
                  const rawIndex = parsedUrl.searchParams.get('img_index');
                  const numericIndex = Number.parseInt(rawIndex || '', 10);
                  return Number.isFinite(numericIndex) && numericIndex > 0 ? numericIndex - 1 : -1;
                } catch (_) {
                  return -1;
                }
              };

              const carouselIndex = parseCarouselIndex();

              const getVisibleArea = (element) => {
                const rect = element.getBoundingClientRect();
                return rect.width * rect.height;
              };

              const getInstagramCarouselCandidates = () =>
                Array.from(document.querySelectorAll('main article li[tabindex="-1"] ._aagv img, main article ._aagv img'))
                  .filter((img) => {
                    const rect = img.getBoundingClientRect();
                    return rect.width > 120 && rect.height > 120;
                  });

              const carouselCandidates = getInstagramCarouselCandidates();
              if (carouselIndex >= 0 && carouselCandidates[carouselIndex]) {
                const exactCarouselUrl = getImageUrl(carouselCandidates[carouselIndex]);
                if (exactCarouselUrl) {
                  return exactCarouselUrl;
                }
              }

              const selectors = [
                'main article li[tabindex="-1"] ._aagv img',
                'main article ._aagv img',
                'main article img[crossorigin="anonymous"]',
                'article ._aagv img',
                'img[crossorigin="anonymous"]',
              ];

              for (const selector of selectors) {
                const matches = Array.from(document.querySelectorAll(selector));
                const visibleMatch = matches.find((img) => {
                  const rect = img.getBoundingClientRect();
                  return rect.width > 120 && rect.height > 120;
                });
                const url = getImageUrl(visibleMatch || matches[0]);
                if (url) {
                  return url;
                }
              }

              const allImages = Array.from(document.images || [])
                .filter((img) => {
                  const rect = img.getBoundingClientRect();
                  return rect.width > 120 && rect.height > 120;
                })
                .sort((a, b) => getVisibleArea(b) - getVisibleArea(a));

              return getImageUrl(allImages[0]) || '';
            },
            args: [info.pageUrl || tab.url || ''],
          });

          resolvedImageUrl = scriptResults?.[0]?.result || '';
          console.log('[ImgVault][ContextMenu] Script injection fallback response', {
            hasImageUrl: Boolean(resolvedImageUrl),
            imageUrlPreview: resolvedImageUrl ? resolvedImageUrl.substring(0, 200) : null,
            frameId: typeof info.frameId === 'number' ? info.frameId : null,
          });
        } catch (error) {
          console.warn('[ImgVault][ContextMenu] Script injection fallback failed for wrapped media', error);
        }
      }

      if (!resolvedImageUrl) {
        console.warn('[ImgVault][ContextMenu] No wrapped media URL resolved, aborting');
        return;
      }

      const pageUrl = info.pageUrl || tab.url;
      const isWarning = isWarningSite(pageUrl);
      const warningSite = getSiteDisplayName(pageUrl, sitesConfig.warningSites);
      const isGood = isGoodQualitySite(pageUrl);
      const goodSite = getSiteDisplayName(pageUrl, sitesConfig.goodQualitySites);

      const sanitizeText = (str, maxLength = 500) =>
        (str || '').replace(/[\u200B-\u200D\uFEFF]/g, '').substring(0, maxLength);
      const sanitizeUrl = (str) =>
        (str || '').replace(/[\u200B-\u200D\uFEFF]/g, '').substring(0, 4000);

      const pendingData = {
        srcUrl: sanitizeUrl(resolvedImageUrl),
        originalSourceUrl: sanitizeUrl(resolvedImageUrl),
        pageUrl: sanitizeUrl(pageUrl),
        pageTitle: sanitizeText(tab.title),
        timestamp: Date.now(),
        isWarningSite: isWarning,
        warningSiteName: warningSite,
        isGoodQualitySite: isGood,
        goodQualitySiteName: goodSite
      };

      console.log('[ImgVault][ContextMenu] Prepared pending image data for saveWrappedMediaToImgVault', {
        hasSrcUrl: Boolean(pendingData.srcUrl),
        srcUrlPreview: pendingData.srcUrl ? pendingData.srcUrl.substring(0, 200) : null,
        pageUrl: pendingData.pageUrl,
        pageTitle: pendingData.pageTitle,
      });

      await chrome.storage.local.set({
        pendingImage: pendingData
      });

      console.log('[ImgVault][ContextMenu] Stored pending image for wrapped media');

      await chrome.storage.local.remove(['lastRightClickImageUrl', 'lastRightClickTimestamp']);
      console.log('[ImgVault][ContextMenu] Cleared right-click media cache, opening gallery');

      await this.openOrFocusApp('/gallery', { reload: true });
    } else if (info.menuItemId === 'saveBackgroundToImgVault') {
      console.log('[ImgVault][ContextMenu] Handling saveBackgroundToImgVault');
      // console.log('🎯 Background image context menu clicked!');

      // Try to get the image URL from storage (set by content script on right-click)
      const storageData = await chrome.storage.local.get(['lastRightClickImageUrl', 'lastRightClickTimestamp']);

      let imageUrl = null;

      // Check if we have a recent right-click image (within 2 seconds)
      if (storageData.lastRightClickImageUrl &&
          storageData.lastRightClickTimestamp &&
          Date.now() - storageData.lastRightClickTimestamp < 2000) {
        imageUrl = storageData.lastRightClickImageUrl;
        console.log('[ImgVault][ContextMenu] Using stored background image URL', {
          imageUrlPreview: String(imageUrl).substring(0, 200)
        });
        // console.log('🎨 Using stored right-click image URL:', imageUrl);
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
            console.log('[ImgVault][ContextMenu] Content script resolved background image URL', {
              imageUrlPreview: String(imageUrl).substring(0, 200)
            });
            // console.log('🎨 Got image from content script:', imageUrl);
          }
        } catch (error) {
          console.warn('[ImgVault][ContextMenu] Content script did not resolve background image', error);
          // console.log('⚠️ Content script not responding:', error.message);
        }
      }

      // If still no URL, try inline script as fallback
      if (!imageUrl) {
        // console.log('⚠️ No stored URL, using inline script fallback...');
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
            console.log('[ImgVault][ContextMenu] Inline script fallback resolved background image URL', {
              imageUrlPreview: String(imageUrl).substring(0, 200)
            });
            // console.log('🎨 Found image with inline script:', imageUrl);
          }
        } catch (error) {
          console.warn('[ImgVault][ContextMenu] Inline script fallback failed for background image', error);
          // console.error('❌ Inline script failed:', error);
        }
      }

      if (imageUrl) {
        const pageUrl = info.pageUrl || tab.url;
        const isWarning = isWarningSite(pageUrl);
        const warningSite = getSiteDisplayName(pageUrl, sitesConfig.warningSites);
        const isGood = isGoodQualitySite(pageUrl);
        const goodSite = getSiteDisplayName(pageUrl, sitesConfig.goodQualitySites);

        // Sanitize all string data to avoid Unicode issues
        const sanitizeString = (str) => (str || '').replace(/[\u200B-\u200D\uFEFF]/g, '').substring(0, 500);

        const pendingData = {
          srcUrl: sanitizeString(imageUrl),
          pageUrl: sanitizeString(pageUrl),
          pageTitle: sanitizeString(tab.title),
          timestamp: Date.now(),
          isBackgroundImage: true,
          isWarningSite: isWarning,
          warningSiteName: warningSite,
          isGoodQualitySite: isGood,
          goodQualitySiteName: goodSite
        };

        // console.log('💾 Storing background image data:', pendingData);

        await chrome.storage.local.set({
          pendingImage: pendingData
        });

        console.log('[ImgVault][ContextMenu] Stored pending image for background image, opening gallery', {
          hasSrcUrl: Boolean(pendingData.srcUrl),
          srcUrlPreview: pendingData.srcUrl ? pendingData.srcUrl.substring(0, 200) : null,
        });

        // Clear the stored right-click URL
        await chrome.storage.local.remove(['lastRightClickImageUrl', 'lastRightClickTimestamp']);

        // console.log('✅ Background image stored!');

        await this.openOrFocusApp('/gallery', { reload: true });
      } else {
        console.warn('[ImgVault][ContextMenu] No background image found after all fallbacks');
        // console.log('❌ No background image found');
      }
    } else if (info.menuItemId === 'saveYouTubeFrameToImgVault') {
      // console.log('🎬 YouTube frame context menu clicked!');

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
          // console.log('⚠️ Content script message failed, trying script injection fallback:', messageError.message);
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
                      // console.log('YouTube frame draw failed, trying artwork fallback:', error?.message);
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
          // console.log('❌ No paused YouTube frame available:', response?.error || 'Unknown reason');
          return;
        }

        const pageUrl = info.pageUrl || tab.url;
        const isWarning = isWarningSite(pageUrl);
        const warningSite = getSiteDisplayName(pageUrl, sitesConfig.warningSites);
        const isGood = isGoodQualitySite(pageUrl);
        const goodSite = getSiteDisplayName(pageUrl, sitesConfig.goodQualitySites);

        // Keep full media/data URLs intact. Truncating data URLs corrupts captured frames.
        const sanitizeText = (str, maxLength = 500) =>
          (str || '').replace(/[\u200B-\u200D\uFEFF]/g, '').substring(0, maxLength);
        const sanitizeUrl = (str) => {
          const cleaned = (str || '').replace(/[\u200B-\u200D\uFEFF]/g, '');
          return cleaned.startsWith('data:') ? cleaned : cleaned.substring(0, 4000);
        };
        const inferredFileName = response.imageUrl?.startsWith('data:')
          ? 'youtube-frame.png'
          : '';

        const pendingData = {
          srcUrl: sanitizeUrl(response.imageUrl),
          originalSourceUrl: sanitizeUrl(info.srcUrl || pageUrl),
          pageUrl: sanitizeUrl(pageUrl),
          pageTitle: sanitizeText(tab.title),
          fileName: inferredFileName,
          timestamp: Date.now(),
          isYouTubeFrame: true,
          isWarningSite: isWarning,
          warningSiteName: warningSite,
          isGoodQualitySite: isGood,
          goodQualitySiteName: goodSite
        };

        // console.log('💾 Storing YouTube frame image data:', pendingData);
        await chrome.storage.local.set({ pendingImage: pendingData });

        await this.openOrFocusApp('/gallery', { reload: true });
      } catch (error) {
        console.error('❌ Failed to capture YouTube frame:', error);
      }
    }
  }

  /**
   * Set the in-memory vault master key (imported from raw bytes sent by the page).
   * Only holds while the vault is unlocked; cleared on vaultClearMasterKey.
   */
  async setVaultMasterKey(keyB64) {
    if (!keyB64) {
      this.vaultMasterKey = null;
      return;
    }
    const raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
    this.vaultMasterKey = await crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Vault status for the UI: configured? currently unlocked?
   */
  async getVaultStatus() {
    const config = await this.storage.getVaultConfig().catch(() => null);
    return {
      configured: Boolean(config?.wrappedMasterKey || config?.passHash),
      encryptionCapable: Boolean(config?.wrappedMasterKey),
      unlocked: Boolean(this.vaultMasterKey),
    };
  }

  /**
   * Unlock the vault from a passcode (used by the gallery upload flow when the
   * user turns on "Upload to Secret Vault" while the vault is locked).
   * Verifies the passcode, unwraps the master key, holds it in memory.
   * Returns true on success, throws a clear error otherwise.
   */
  async unlockVaultWithPasscode(passcode) {
    const config = await this.storage.getVaultConfig().catch(() => null);
    if (!config) {
      throw new Error('Secret Vault is not set up yet. Open the Vault page to create a passcode first.');
    }

    if (config.wrappedMasterKey) {
      const passHash = await hashVaultPasscode(passcode, config.salt);
      if (passHash !== config.passHash) {
        throw new Error('Wrong passcode.');
      }
      const masterKey = await unwrapMasterKey(config, passcode);
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', masterKey));
      const keyB64 = btoa(String.fromCharCode(...raw));
      await this.setVaultMasterKey(keyB64);
      return { keyB64 };
    }

    // Legacy vault (no wrapped key yet): verify passcode and upgrade it in place.
    const passHash = await hashVaultPasscode(passcode, config.salt);
    if (passHash !== config.passHash) {
      throw new Error('Wrong passcode.');
    }
    const upgraded = await createVaultConfig(passcode);
    const newConfig = {
      ...config,
      kdfSalt: upgraded.kdfSalt,
      kdfIterations: upgraded.kdfIterations,
      wrappedMasterKey: upgraded.wrappedMasterKey,
      vaultVersion: upgraded.vaultVersion,
    };
    const masterKey = await unwrapMasterKey(newConfig, passcode);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', masterKey));
    const keyB64 = btoa(String.fromCharCode(...raw));
    await this.setVaultMasterKey(keyB64);
    await this.storage.saveVaultConfig(newConfig);
    return { keyB64 };
  }

  /**
   * Encrypt a media blob for a vaulted item and upload it to udrop as a flat
   * opaque blob. Requires the vault to be unlocked (master key in memory).
   * @returns {Promise<{encryptedBlobUrl:string, encryptedBlobFileId:string, encryptedMetadata:string, encryptedMimeType:string, encryptedFileName:string}>}
   */
   async encryptAndUploadVaultedBlob(blob, metadata = {}, onProgress) {
    if (!this.vaultMasterKey) {
      throw new Error('Secret Vault is locked. Unlock it before saving encrypted items.');
    }

    if (typeof onProgress === 'function') {
      onProgress({ loaded: 0, total: 1, percent: 0, stage: 'encrypt' });
    }

    const encryptedBlob = await encryptBlob(this.vaultMasterKey, blob, (p) => {
      if (typeof onProgress === 'function') {
        onProgress({ ...p, stage: 'encrypt' });
      }
    });
    const encryptedMetadata = await encryptMetadata(this.vaultMasterKey, metadata);

    const settings = await chrome.storage.sync.get(['udropKey1', 'udropKey2']);
    if (!settings.udropKey1 || !settings.udropKey2) {
      throw new Error('UDrop keys are not configured. Encrypted vault items need a UDrop account.');
    }

    if (typeof onProgress === 'function') {
      onProgress({ loaded: 0, total: 1, percent: 50, stage: 'upload' });
    }

    // NOTE: must use the fetch-based upload() here — XHR is not available in
    // the MV3 service worker context (uploadWithProgress uses XMLHttpRequest).
    const uploader = new UDropUploader();
    const opaqueName = `${Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0')).join('')}.bin`;
    const result = await uploader.upload(encryptedBlob, settings.udropKey1, settings.udropKey2, opaqueName);

    if (typeof onProgress === 'function') {
      onProgress({ loaded: 1, total: 1, percent: 95, stage: 'saving' });
    }

    return {
      // Durable short URL (watchUrl/displayUrl) as the primary blob URL; the
      // signed direct download_url can expire, so decrypt always regenerates it
      // from encryptedBlobFileId when the stored URL 404s.
      encryptedBlobUrl: result.watchUrl || result.displayUrl || result.url || '',
      encryptedBlobWatchUrl: result.watchUrl || result.displayUrl || result.url || '',
      encryptedBlobFileId: result.fileId || '',
      encryptedMetadata,
      encryptedMimeType: blob.type || 'application/octet-stream',
      encryptedFileName: opaqueName,
    };
  }

  /**
   * Resolve a fresh, unexpired udrop download URL for a file id.
   * Falls back to the stored URL if regeneration fails.
   */
  async resolveUdropDownloadUrl(url, fileId) {
    if (!fileId) return url;
    try {
      const settings = await chrome.storage.sync.get(['udropKey1', 'udropKey2']);
      if (!settings.udropKey1 || !settings.udropKey2) return url;
      const uploader = new UDropUploader();
      const auth = await uploader.authorize(settings.udropKey1, settings.udropKey2);
      const formData = new FormData();
      formData.append('access_token', auth.access_token);
      formData.append('account_id', auth.account_id);
      formData.append('file_id', String(fileId));
      const resp = await fetch('https://www.udrop.com/api/v2/file/download', {
        method: 'POST',
        body: formData,
      });
      if (!resp.ok) return url;
      const result = await resp.json();
      if (result._status === 'success' && result.data?.download_url) {
        return result.data.download_url;
      }
    } catch (err) {
      console.warn('[Vault] udrop download URL regeneration failed:', err.message);
    }
    return url;
  }

  /**
   * Decrypt a vaulted blob (fetched from the encrypted blob URL) and return the
   * plaintext Blob. Requires unlocked vault. Regenerates the udrop download URL
   * if the stored one is stale.
   * @param {string} url - primary encrypted blob URL (first chunk)
   * @param {string} mimeType
   * @param {string} fileId
   * @param {Array<{url:string,fileId:string,size:number}>} [chunks] - optional
   *   full chunk list; when present, fetch all chunks in parallel and join.
   */
  async decryptVaultBlob(url, mimeType = 'application/octet-stream', fileId = '', chunks = []) {
    if (!this.vaultMasterKey) {
      throw new Error('Secret Vault is locked. Unlock it before viewing encrypted items.');
    }
    if (!url) {
      throw new Error('Encrypted item has no blob URL.');
    }
    const { decryptBlob } = await import('../utils/vaultCrypto.js');

    const effectiveChunks = Array.isArray(chunks) && chunks.length > 0
      ? chunks
      : [{ url, fileId, size: 0 }];

    const fetchOne = async (chunk, index) => {
      let fetchUrl = chunk.url;
      let resp;
      try {
        resp = await fetch(fetchUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      } catch (_) {
        const fresh = await this.resolveUdropDownloadUrl(chunk.url, chunk.fileId);
        if (fresh && fresh !== chunk.url) {
          resp = await fetch(fresh);
          if (!resp.ok) throw new Error(`Failed to fetch regenerated chunk: HTTP ${resp.status}`);
        } else {
          throw new Error(`Failed to fetch encrypted chunk ${index} from ${chunk.url}`);
        }
      }
      return resp.blob();
    };

    let encryptedBlob;
    if (effectiveChunks.length === 1) {
      encryptedBlob = await fetchOne(effectiveChunks[0], 0);
    } else {
      const blobs = await Promise.all(effectiveChunks.map((c, i) => fetchOne(c, i)));
      const total = blobs.reduce((n, b) => n + b.size, 0);
      encryptedBlob = new Blob(blobs, { type: 'application/octet-stream' });
      void total;
    }

    return decryptBlob(this.vaultMasterKey, encryptedBlob, mimeType);
  }

  /**
   * Move an item to the Secret Vault.
   * - Encrypted path (vault unlocked): fetch original blob from its current
   *   provider, encrypt, re-upload as flat udrop blob, update the row with the
   *   encrypted fields, and blank the plaintext provider URLs.
   * - Legacy path (vault locked / no config): keep the existing flag-only
   *   behavior (hidden but unencrypted) so pre-existing flows keep working.
   */
  async moveItemToVault(id) {
    const current = await this.storage.getImageById(id);
    if (!current) {
      throw new Error('Item not found');
    }
    if (this.storage.isVaultedItem(current)) {
      return true;
    }

    // Encrypted path: vault unlocked.
    if (this.vaultMasterKey) {
      try {
        const providerLinks = current.imageHosts || current.videoHosts || {};
        const isVideo = current.isVideo || String(current.fileType || '').startsWith('video/');
        const sourceUrl = isVideo
          ? (current.udropDirectUrl || current.filemoonDirectUrl || current.udropWatchUrl || '')
          : (current.imgbbUrl || current.imgbbThumbUrl || current.pixvidUrl || current.sourceImageUrl || '');

        if (!sourceUrl) {
          throw new Error('No source URL available to encrypt this item.');
        }

        const blob = await this.fetchImage(sourceUrl, AbortSignal.timeout(60000), current.sourcePageUrl);

        const encrypted = await this.encryptAndUploadVaultedBlob(blob, {
          kind: current.kind || (isVideo ? 'video' : 'image'),
          isVideo,
          pageTitle: current.pageTitle || '',
          description: current.description || '',
          tags: Array.isArray(current.tags) ? current.tags : [],
          fileName: current.fileName || '',
          fileType: current.fileType || blob.type || '',
          sourceImageUrl: current.sourceImageUrl || '',
          sourcePageUrl: current.sourcePageUrl || '',
          creationDate: current.creationDate || null,
          width: current.width || null,
          height: current.height || null,
          duration: current.duration || null,
        });

        await this.storage.updateImage(id, {
          isVaulted: true,
          vaultMode: 'hidden',
          vaultedAt: new Date().toISOString(),
          ...encrypted,
          pixvidUrl: '',
          pixvidDeleteUrl: '',
          imgbbUrl: '',
          imgbbDeleteUrl: '',
          imgbbThumbUrl: '',
          filemoonWatchUrl: '',
          filemoonDirectUrl: '',
          udropWatchUrl: '',
          udropDirectUrl: '',
          sourceImageUrl: '',
          imageHosts: null,
          videoHosts: null,
        });

        if (current.collectionId) {
          await this.storage.incrementCollectionCount(current.collectionId, -1);
        }
        return true;
      } catch (error) {
        console.error('[Vault] Encrypted move failed, falling back to legacy flag-only:', error.message);
        // fall through to legacy path
      }
    }

    // Vault has encryption support but is locked → tell the user.
    const vaultConfig = await this.storage.getVaultConfig().catch(() => null);
    if (vaultConfig?.wrappedMasterKey && !this.vaultMasterKey) {
      throw new Error('Secret Vault is locked. Unlock it first so this item can be encrypted.');
    }
    // Legacy vault (no wrapping) or no vault → plain flag-only move is fine.

    return this.storage.moveToVault(id);
  }

  /**
   * Restore an item from the Secret Vault.
   * - Encrypted path: decrypt the blob, re-upload through the normal providers,
   *   and un-vault. Falls back to legacy flag-only restore when unencrypted.
   */
  async restoreFromVault(id) {
    const current = await this.storage.getImageById(id);
    if (!current) {
      throw new Error('Vault item not found');
    }

    if (current.encryptedBlobUrl && this.vaultMasterKey) {
      try {
        const blob = await this.decryptVaultBlob(current.encryptedBlobUrl, current.encryptedMimeType, current.encryptedBlobFileId, current.encryptedBlobChunks);
        const { decryptMetadata } = await import('../utils/vaultCrypto.js');
        const meta = await decryptMetadata(this.vaultMasterKey, current.encryptedMetadata);
        const isVideo = Boolean(meta.isVideo || current.isVideo || String(meta.fileType || '').startsWith('video/'));
        const fileName = meta.fileName || current.encryptedFileName || (isVideo ? 'video.mp4' : 'image.jpg');

        let restored = {
          pageTitle: meta.pageTitle || '',
          description: meta.description || '',
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          fileName,
          fileType: meta.fileType || blob.type || '',
          sourceImageUrl: meta.sourceImageUrl || '',
          sourcePageUrl: meta.sourcePageUrl || '',
          creationDate: meta.creationDate || null,
          width: meta.width || null,
          height: meta.height || null,
          duration: meta.duration || null,
        };

        if (isVideo) {
          const settings = await this.getMergedVideoHostSettings();
          const configured = getConfiguredVideoUploadServices(settings);
          const selected = filterUploadServicesByKeys(configured, current.selectedHostKeys || null);
          const services = selected.length > 0 ? selected : configured;
          if (services.length === 0) {
            throw new Error('No video host configured to restore into.');
          }
          const uploadResults = {};
          const errors = [];
          for (const service of services) {
            const uploader = this[service.uploaderKey];
            if (!uploader) continue;
            try {
              const result = await service.upload({
                uploader,
                blob,
                settings,
                data: { ...current, fileName },
              });
              uploadResults[service.key] = result;
            } catch (err) {
              errors.push(`${service.label}: ${err.message || String(err)}`);
            }
          }
          if (Object.keys(uploadResults).length === 0) {
            throw new Error(`Restore upload failed. ${errors.join(' | ')}`);
          }
          for (const [providerKey, result] of Object.entries(uploadResults)) {
            restored = mergeVideoProviderResult(restored, providerKey, result);
          }
          restored.isVideo = true;
        } else {
          const settings = await chrome.storage.sync.get(['pixvidApiKey', 'imgbbApiKey']);
          const configured = getConfiguredImageUploadServices(settings);
          const selected = filterUploadServicesByKeys(configured, current.selectedHostKeys || null);
          const services = selected.length > 0 ? selected : configured;
          if (services.length === 0) {
            throw new Error('No image host configured to restore into.');
          }
          const uploadResults = [];
          for (const service of services) {
            const uploader = this[service.uploaderKey];
            if (!uploader) continue;
            try {
              const result = await service.upload({
                uploader,
                blob,
                settings,
                data: { ...current, imageUrl: current.sourcePageUrl },
              });
              uploadResults.push({ type: service.key, ...result });
            } catch (err) {
              console.warn(`${service.label} restore failed:`, err.message);
            }
          }
          const successful = uploadResults.filter((r) => r && !r.error && r.url);
          if (successful.length === 0) {
            throw new Error('Restore upload failed on all image hosts.');
          }
          for (const result of successful) {
            const service = getImageUploadService(result.type);
            restored = mergeImageProviderResult(restored, service?.key || result.type, result);
          }
        }

        await this.storage.updateImage(id, {
          ...restored,
          isVaulted: false,
          vaultMode: '',
          vaultedAt: '',
          encryptedBlobUrl: '',
          encryptedBlobWatchUrl: '',
          encryptedBlobFileId: '',
          encryptedBlobChunks: [],
          encryptedMetadata: '',
          encryptedMimeType: '',
          encryptedFileName: '',
        });

        if (current.collectionId) {
          await this.storage.incrementCollectionCount(current.collectionId, 1);
        }
        return true;
      } catch (error) {
        console.error('[Vault] Encrypted restore failed, falling back to legacy flag-only:', error.message);
        // fall through to legacy restore
      }
    }

    return this.storage.restoreFromVault(id);
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

      case 'cancelUpload':
        this.cancelActiveUpload()
          .then(result => sendResponse({ success: true, data: result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'getImages':
        this.storage.getAllImages()
          .then(images => sendResponse({ success: true, data: images }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'getVaultImages':
        this.storage.getVaultImages()
          .then(images => sendResponse({ success: true, data: images }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'getVaultConfig':
        this.storage.getVaultConfig()
          .then(config => sendResponse({ success: true, data: config }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'saveVaultConfig':
        this.storage.saveVaultConfig(request.data?.config || request.config)
          .then(() => sendResponse({ success: true, data: null }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'vaultSetMasterKey':
        this.setVaultMasterKey(request.data?.keyB64)
          .then(() => sendResponse({ success: true, data: null }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'vaultClearMasterKey':
        this.vaultMasterKey = null;
        sendResponse({ success: true, data: null });
        return false;

      case 'getVaultStatus':
        this.getVaultStatus()
          .then((status) => sendResponse({ success: true, data: status }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'vaultUnlockWithPasscode':
        this.unlockVaultWithPasscode(request.data?.passcode)
          .then((result) => sendResponse({ success: true, data: result || null }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'vaultDecryptBlob':
        this.decryptVaultBlob(request.data?.url, request.data?.mimeType, request.data?.fileId, request.data?.chunks)
          .then((blob) => sendResponse({ success: true, data: { blob } }))
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

      case 'linkProviderFileToItem':
        this.storage.linkProviderFileToItem(request.data.id, request.data.providerKey, request.data.link)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'deleteImage':
        this.storage.moveToTrash(request.data?.id || request.id)
          .then(() => sendResponse({ success: true, data: null }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'moveToVault':
        this.moveItemToVault(request.data?.id || request.id)
          .then(() => sendResponse({ success: true, data: null }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'restoreFromVault':
        this.restoreFromVault(request.data?.id || request.id)
          .then(() => sendResponse({ success: true, data: null }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'deleteFromVault':
        this.storage.deleteVaultItem(request.data?.id || request.id)
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

      case 'updateTrashedImage':
        this.storage.updateTrashedImage(request.data.id, request.data.updates)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'extractMetadata':
        this.extractMetadataOnly(request.imageUrl, request.pageUrl, request.fileName, request.fileMimeType, request.fileLastModified)
          .then(metadata => sendResponse({ success: true, metadata }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'resolveImagePreview':
        this.fetchImageAsDataUrl(request.imageUrl, request.pageUrl)
          .then(dataUrl => sendResponse({ success: true, dataUrl }))
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

      case 'exportFirestoreBackup':
        this.storage.exportFullDatabase()
          .then(backup => sendResponse({ success: true, data: backup }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'getFilemoonThumbnail':
        this.getFilemoonThumbnail(request.filecode)
          .then(thumbnailUrl => sendResponse({ success: true, data: thumbnailUrl }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'updateFilemoonThumbnail':
        this.storage.updateImage(request.imageId, { filemoonThumbUrl: request.thumbnailUrl })
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'nativeDownload':
        this.handleNativeDownload(request.url, request.requestId, request.format)
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

      case 'cancelNativeDownload':
        this.cancelNativeDownload(request.requestId)
          .then(result => sendResponse({ success: true, data: result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'nativeHostCommand':
        this.handleNativeHostCommand(request.command, request.data || {})
          .then(result => sendResponse({ success: true, data: result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'checkNativeDownloadJournal':
        this.checkNativeDownloadJournal(request.requestId || '')
          .then(result => sendResponse({ success: true, data: result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'reconcileStaleNativeDownload':
        this.reconcileStaleNativeDownload()
          .then(() => sendResponse({ success: true }))
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

      case 'saveVaultedUpload':
        this.saveVaultedUpload(request.data)
          .then(result => sendResponse({ success: true, data: result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'createPendingUpload':
        this.createPendingUpload(request.data)
          .then(result => sendResponse({ success: true, data: result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'finalizeUploadedVideo':
        this.finalizeUploadedVideo(request.data)
          .then(result => sendResponse({ success: true, data: result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'retryVideoHostUpload':
        this.retryVideoHostUpload(request.data)
          .then(result => sendResponse({ success: true, data: result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'retryImageHostUpload':
        this.retryImageHostUpload(request.data)
          .then(result => sendResponse({ success: true, data: result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'uploadScene':
        this.handleSceneUpload(request.data)
          .then(result => sendResponse({ success: true, data: result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'fetchFile':
        this.handleFetchFile({ mediaId: request.mediaId, url: request.url })
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

  buildNativeDownloadLogEntry(message, type = 'info', stream = '') {
    return {
      timestamp: new Date().toLocaleTimeString(),
      createdAt: Date.now(),
      message,
      type,
      stream,
    };
  }

  summarizeNativeDownloadMessage(message, fallback = '') {
    const raw = String(message || '').trim();
    if (!raw) {
      return fallback;
    }

    if (/yt-dlp failed/i.test(raw)) {
      const details = raw
        .split(/\r?\n/)
        .filter((line) => !/^\s*\[debug\]/i.test(line) && !/^\s*\[\w+\] Extracting URL/i.test(line))
        .join('\n');

      if (/raise_login_required|log in for access|may not be comfortable for some audiences/i.test(details)) {
        return 'yt-dlp failed. This post is restricted and needs a logged-in session for that site.';
      }
      if (/unable to extract universal data for rehydration/i.test(details)) {
        return 'yt-dlp failed. The site returned a page it could not read. This is usually temporary, so try again.';
      }
      if (/googlevideo.*403|403.*googlevideo|HTTP Error 403.*fragment/i.test(details)) {
        return '[RETRY_WITH_BEST_FORMAT]yt-dlp failed with HTTP 403 on video CDN. This video may have higher format restrictions. Click "Retry with best" to try single-stream format instead.';
      }
      if (/HTTP Error 403/i.test(details)) {
        return 'yt-dlp failed. The site refused the request before the download started.';
      }
      if (/sign in to confirm your age/i.test(details)) {
        return 'yt-dlp failed. The video appears to require an age-confirmed session.';
      }
      if (/sign in to confirm you[\'’]?re not a bot/i.test(raw)) {
        return 'yt-dlp failed. The site is asking for a logged-in session.';
      }
      if (/unable to open for writing/i.test(raw)) {
        return 'yt-dlp failed. The output file could not be created.';
      }
      if (/cookie (?:file|jar)? ?(?:not found|is empty|expired|invalid|rejected)|failed to (?:load|parse|read) cookies|no cookies found/i.test(details)) {
        return 'yt-dlp failed. The cookie file could not be used for this download.';
      }
      return 'yt-dlp failed. Check the logs below for the full output.';
    }

    if (/native host disconnected unexpectedly/i.test(raw)) {
      return 'Native host disconnected unexpectedly.';
    }

    if (/download timed out/i.test(raw)) {
      return 'Download timed out while waiting for the native host.';
    }

    return raw.split(/\r?\n/)[0].slice(0, 220);
  }

  async getActiveNativeDownloadRecord() {
    const result = await chrome.storage.local.get(ACTIVE_NATIVE_DOWNLOAD_KEY);
    return result?.[ACTIVE_NATIVE_DOWNLOAD_KEY] || null;
  }

  async setActiveNativeDownloadRecord(record) {
    await chrome.storage.local.set({
      [ACTIVE_NATIVE_DOWNLOAD_KEY]: record,
    });
  }

  async appendNativeDownloadLog(requestId, message, type = 'info', stream = '') {
    const current = await this.getActiveNativeDownloadRecord();
    if (!current || current.requestId !== requestId) {
      return;
    }

    const entry = this.buildNativeDownloadLogEntry(message, type, stream);
    const settlesCancellation =
      current.status === 'cancelling' &&
      /yt-dlp failed|download stopped|stop signal sent|native host disconnected unexpectedly|native host download failed/i.test(
        String(message || '')
      );

    await this.setActiveNativeDownloadRecord({
      ...current,
      status: settlesCancellation ? 'cancelled' : current.status,
      updatedAt: Date.now(),
      completedAt: settlesCancellation ? Date.now() : current.completedAt,
      lastMessage: settlesCancellation ? 'Download stopped.' : message,
      logs: [entry, ...(current.logs || [])].slice(0, 300),
    });
  }

  async updateActiveNativeDownload(requestId, updates = {}) {
    const current = await this.getActiveNativeDownloadRecord();
    if (!current || current.requestId !== requestId) {
      return;
    }

    await this.setActiveNativeDownloadRecord({
      ...current,
      ...updates,
      updatedAt: Date.now(),
    });
  }

  async startActiveNativeDownload(requestId, url) {
    const startMessage = `Sending native download request: ${url}`;
    await this.setActiveNativeDownloadRecord({
      requestId,
      url,
      status: 'running',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      lastMessage: startMessage,
      logs: [this.buildNativeDownloadLogEntry(startMessage)],
    });
  }

  async finishActiveNativeDownload(requestId, updates = {}) {
    const current = await this.getActiveNativeDownloadRecord();
    if (!current || current.requestId !== requestId) {
      return;
    }

    await this.setActiveNativeDownloadRecord({
      ...current,
      ...updates,
      updatedAt: Date.now(),
      completedAt: Date.now(),
    });
  }

  async getActiveNativeDownloadStatus(requestId) {
    const current = await this.getActiveNativeDownloadRecord();
    if (!current || current.requestId !== requestId) {
      return '';
    }

    return String(current.status || '');
  }

  async cancelNativeDownload(requestId = '') {
    const activeRequestId = String(requestId || '').trim();
    if (!activeRequestId) {
      throw new Error('Missing native download request id.');
    }

    await this.updateActiveNativeDownload(activeRequestId, {
      status: 'cancelling',
      lastMessage: 'Stopping native download...',
    });
    await this.appendNativeDownloadLog(activeRequestId, 'Stopping native download...', 'warning', 'system');

    try {
      const result = await this.handleNativeHostCommand('cancel_download', {
        request_id: activeRequestId,
      });

      await this.finishActiveNativeDownload(activeRequestId, {
        status: 'cancelled',
        lastMessage: result?.message || 'Download stopped.',
        error: '',
      });
      await this.appendNativeDownloadLog(
        activeRequestId,
        result?.message || 'Download stopped.',
        'warning',
        'system'
      );

      return result;
    } catch (error) {
      await this.updateActiveNativeDownload(activeRequestId, {
        status: 'failed',
        lastMessage: error?.message || 'Failed to stop native download.',
      });
      await this.appendNativeDownloadLog(
        activeRequestId,
        error?.message || 'Failed to stop native download.',
        'error',
        'system'
      );
      throw error;
    }
  }

  // Shared completion settle: persists the pending auto-upload (so the file
  // flows into the upload flow exactly like a normal completion), finishes the
  // active download record and logs the result. Used by the live native host
  // response and by journal adoption after an extension reload.
  async settleNativeDownloadCompleted(activeRequestId, url, filePath, message = 'Download complete') {
    const focused = await this.isExtensionUiFocused();
    const pendingAutoUpload = {
      autoOpenUpload: true,
      downloadFilePath: filePath || '',
      downloadSourceUrl: url,
      createdAt: Date.now(),
      pausedUntilFocus: !focused,
    };

    await chrome.storage.local.set({ pendingAutoUpload });
    await this.finishActiveNativeDownload(activeRequestId, {
      status: 'completed',
      filePath: filePath || '',
      lastMessage: message,
    });
    await this.appendNativeDownloadLog(
      activeRequestId,
      filePath ? `Downloaded to: ${filePath}` : message,
      'success',
      'system'
    );
    if (!focused) {
      await this.notifyTabNotFocused();
    }
  }

  // The host persists a per-request completion journal in the temp dir (see
  // the native host). Because the host keeps downloading even after the
  // extension port dies, the journal lets the extension adopt the real
  // outcome after a reload instead of marking the download interrupted.
  async checkNativeDownloadJournal(requestId = '') {
    const activeRequestId = String(requestId || '').trim();
    if (!activeRequestId) return { status: 'unreachable' };

    try {
      const result = await this.handleNativeHostCommand('read_download_journal', {
        request_id: activeRequestId,
      }, 3000);

      const journalStatus = String(result?.message || '');
      if (journalStatus === 'completed' || journalStatus === 'failed') {
        let journal = {};
        try {
          journal = JSON.parse(result?.stdout || '{}');
        } catch (_) {
          journal = {};
        }
        const current = await this.getActiveNativeDownloadRecord();
        if (current && current.requestId === activeRequestId) {
          if (journalStatus === 'completed') {
            await this.settleNativeDownloadCompleted(
              activeRequestId,
              current.url || '',
              journal?.file_path || result?.filePath || '',
              journal?.message || 'Download complete (recovered after extension reload)'
            );
          } else {
            const failedMessage = journal?.message || 'Native host download failed after extension reload';
            await this.finishActiveNativeDownload(activeRequestId, {
              status: 'failed',
              error: failedMessage,
              filePath: journal?.file_path || '',
              lastMessage: this.summarizeNativeDownloadMessage(
                failedMessage,
                'Native host download failed after extension reload'
              ),
            });
            await this.appendNativeDownloadLog(activeRequestId, failedMessage, 'error', 'system');
          }
        }
        await this.cleanupNativeDownloadJournal(activeRequestId);
        return { status: journalStatus };
      }

      // "missing" means the host that answered never saw this request — the
      // original host process is still busy downloading and will write the
      // journal when it finishes.
      return { status: journalStatus === 'missing' ? 'running' : journalStatus };
    } catch (error) {
      return { status: 'unreachable' };
    }
  }

  async cleanupNativeDownloadJournal(requestId = '') {
    const activeRequestId = String(requestId || '').trim();
    if (!activeRequestId) return;
    try {
      await this.handleNativeHostCommand('delete_download_journal', {
        request_id: activeRequestId,
      }, 3000);
    } catch (_) {
      // Best effort — stale temp files are harmless.
    }
  }

  // The service worker restarts whenever the extension reloads or the browser
  // kills an idle worker, and the native messaging port dies with the old
  // context — no onDisconnect fires and nothing ever settles the record, so
  // the UI would show a download stuck at "running" forever. Recover the real
  // outcome from the host's completion journal instead:
  //   - journal completed/failed -> adopt the result (normal completion flow
  //     including the pending auto-upload, or failure state)
  //   - no journal yet -> the host process is still downloading in the
  //     background; keep the record running and let the UI poll for the
  //     journal until it settles
  //   - host unreachable -> mark interrupted (the host died too)
  async reconcileStaleNativeDownload() {
    try {
      const current = await this.getActiveNativeDownloadRecord();
      if (!current) return;

      const status = String(current.status || '');
      if (status !== 'running' && status !== 'cancelling') return;

      // A fresh service worker never has in-flight ports; if one exists for
      // this request, it's a live download and we must not touch it.
      if (this.activeNativeDownloadPorts.has(current.requestId)) return;

      const journalResult = await this.checkNativeDownloadJournal(current.requestId);
      if (journalResult.status === 'completed' || journalResult.status === 'failed') {
        return;
      }

      if (journalResult.status === 'unreachable') {
        const interruptedMessage =
          'Extension reloaded while the download was in progress and the native host connection was lost. The download may still have finished in the background — check the download folder before retrying.';
        await this.setActiveNativeDownloadRecord({
          ...current,
          status: 'interrupted',
          completedAt: Date.now(),
          updatedAt: Date.now(),
          lastMessage: interruptedMessage,
          logs: [
            this.buildNativeDownloadLogEntry(interruptedMessage, 'warning', 'system'),
            ...(current.logs || []),
          ].slice(0, 300),
        });
        return;
      }

      // Journal missing -> the original host is still busy downloading. Keep
      // the record running and let the UI poll for the journal.
      const recoveredMessage =
        'Extension reloaded while the download was in progress — the native host kept downloading in the background. Progress will settle automatically when it finishes.';
      await this.setActiveNativeDownloadRecord({
        ...current,
        status: 'running',
        recoveredFromReload: true,
        updatedAt: Date.now(),
        lastMessage: recoveredMessage,
        logs: [
          this.buildNativeDownloadLogEntry(recoveredMessage, 'info', 'system'),
          ...(current.logs || []),
        ].slice(0, 300),
      });
    } catch (error) {
      console.debug('Failed to reconcile stale native download:', error);
    }
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

  async appendVideoProviderResultLog(service, result = {}) {
    await this.appendUploadLog(`${service.label}: upload completed for ${result.filename || 'video file'}`, 'success');

    const detailRows = [
      ['API status', result.apiStatus],
      ['API message', result.apiMessage || result.apiResponse],
      ['File ID', result.fileId || result.filecode],
      ['Account ID', result.accountId],
      ['Short URL', result.shortUrl],
      ['Watch URL', result.watchUrl || result.displayUrl || result.url],
      ['Direct URL', result.directUrl || result.url],
    ];

    for (const [label, value] of detailRows) {
      if (value) {
        await this.appendUploadLog(`${service.label} ${label}: ${value}`);
      }
    }
  }

  async getMergedVideoHostSettings() {
    const syncSettings = await chrome.storage.sync.get(['filemoonApiKey', 'udropKey1', 'udropKey2', 'teraboxCookie']);
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

      if (!merged.teraboxCookie && firebaseSettings?.teraboxCookie) {
        merged.teraboxCookie = firebaseSettings.teraboxCookie;
      }

      if (
        (!syncSettings.filemoonApiKey && merged.filemoonApiKey) ||
        (!syncSettings.udropKey1 && merged.udropKey1) ||
        (!syncSettings.udropKey2 && merged.udropKey2) ||
        (!syncSettings.teraboxCookie && merged.teraboxCookie)
      ) {
        await chrome.storage.sync.set({
          ...(merged.filemoonApiKey ? { filemoonApiKey: merged.filemoonApiKey } : {}),
          ...(merged.udropKey1 ? { udropKey1: merged.udropKey1 } : {}),
          ...(merged.udropKey2 ? { udropKey2: merged.udropKey2 } : {}),
          ...(merged.teraboxCookie ? { teraboxCookie: merged.teraboxCookie } : {}),
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

  async isExtensionUiFocused() {
    try {
      const extensionOrigin = chrome.runtime.getURL('');
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!activeTab?.url?.startsWith(extensionOrigin)) {
        return false;
      }

      const win = await chrome.windows.get(activeTab.windowId);
      return Boolean(win?.focused);
    } catch (error) {
      return false;
    }
  }

  async notifyTabNotFocused() {
    if (!chrome.notifications?.create) return;
    try {
      await chrome.notifications.create(TAB_NOT_FOCUSED_NOTIFICATION_ID, {
        type: 'basic',
        iconUrl: 'icons/1.png',
        title: 'ImgVault',
        message: 'Tab not in focus. Auto-upload is paused and will resume when you focus the extension.',
        priority: 2,
        requireInteraction: true,
      });
    } catch (error) {
      console.debug('Failed to show tab-not-focused notification:', error);
    }
  }

  async notifyTabFocusedResuming() {
    if (!chrome.notifications?.create) return;
    try {
      await chrome.notifications.clear(TAB_NOT_FOCUSED_NOTIFICATION_ID);
      await chrome.notifications.create(TAB_FOCUSED_NOTIFICATION_ID, {
        type: 'basic',
        iconUrl: 'icons/1.png',
        title: 'ImgVault',
        message: 'Tab focused. Resuming auto-upload handoff.',
        priority: 1,
      });
    } catch (error) {
      console.debug('Failed to show tab-focused notification:', error);
    }
  }

  async resumePendingAutoUploadOnFocus() {
    try {
      const { pendingAutoUpload } = await chrome.storage.local.get('pendingAutoUpload');
      if (!pendingAutoUpload?.autoOpenUpload || !pendingAutoUpload?.pausedUntilFocus) {
        return;
      }

      const focused = await this.isExtensionUiFocused();
      if (!focused) {
        return;
      }

      const nextPending = {
        ...pendingAutoUpload,
        pausedUntilFocus: false,
        resumedAt: Date.now(),
      };
      await chrome.storage.local.set({ pendingAutoUpload: nextPending });
      await this.notifyTabFocusedResuming();
    } catch (error) {
      console.debug('Failed to resume pending auto upload on focus:', error);
    }
  }

  async cancelActiveUpload() {
    if (!this.activeUploadController) {
      await chrome.storage.local.set({ uploadActive: false, uploadStatus: '' });
      return { cancelled: false };
    }

    this.activeUploadController.abort();
    this.activeUploadController = null;
    await this.updateStatusWithLog('Upload cancelled.', 'warning');
    await chrome.storage.local.set({ uploadActive: false, uploadStatus: '' });
    return { cancelled: true };
  }

  /**
   * Encrypted vaulted upload: fetch blob, encrypt, upload flat opaque blob to
   * udrop, save the item with encrypted metadata + encrypted blob URL and
   * isVaulted set. No plaintext metadata or provider URLs are stored.
   * @param {Object} data
   * @param {'image'|'video'} kind
   * @returns {Promise<Object>} saved item
   */
  async handleVaultedUpload(data, kind) {
    const uploadController = new AbortController();
    this.activeUploadController = uploadController;

    try {
      await chrome.storage.local.set({ uploadStatusLogs: [] });

      if (!this.vaultMasterKey) {
        throw new Error('Secret Vault is locked. Unlock it before saving encrypted items.');
      }

      await this.updateStatusWithLog('🔒 Fetching media for Secret Vault...');

      const source = data.fileBlob instanceof Blob ? data.fileBlob : data.imageUrl;
      const blob = await this.fetchImage(source, uploadController.signal, data.pageUrl);
      if (!(blob instanceof Blob) || blob.size <= 0) {
        throw new Error('Media payload is empty. Please reload the file and try again.');
      }

      const fileName = this.extractFileName(data) || (kind === 'video' ? 'video.mp4' : 'image.jpg');
      const creationDate = data.fileLastModified ? new Date(data.fileLastModified).toISOString() : null;

      const metadata = {
        kind,
        isVideo: kind === 'video',
        pageTitle: data.pageTitle || '',
        description: data.description || '',
        tags: Array.isArray(data.tags) ? data.tags : [],
        fileName,
        fileType: data.fileMimeType || data.fileType || blob.type || '',
        sourceImageUrl: data.originalSourceUrl || '',
        sourcePageUrl: data.pageUrl || '',
        creationDate,
        width: Number.isFinite(data.width) ? data.width : null,
        height: Number.isFinite(data.height) ? data.height : null,
        duration: kind === 'video' && Number.isFinite(data.duration) ? data.duration : null,
      };

      const encrypted = await this.encryptAndUploadVaultedBlob(blob, metadata, (progress) => {
        if (progress.stage === 'encrypt') {
          this.updateStatusWithLog(`🔒 Encrypting ${this.formatBytes(blob.size)}... ${progress.percent}%`)
            .catch(() => {});
        } else if (progress.stage === 'upload') {
          this.updateStatusWithLog(`🔒 Uploading encrypted blob to udrop (${this.formatBytes(blob.size)})...`)
            .catch(() => {});
        } else if (progress.stage === 'saving') {
          this.updateStatusWithLog('🔒 Saving encrypted item...')
            .catch(() => {});
        }
      });

      const mediaMetadata = {
        kind,
        isVideo: kind === 'video',
        pageTitle: '',   // kept blank in plaintext; lives in encryptedMetadata
        description: '',
        tags: [],
        collectionId: data.collectionId || null,
        fileName: encrypted.encryptedFileName,
        fileSize: blob.size,
        fileType: 'application/octet-stream',
        fileTypeSource: 'Encrypted vault item',
        creationDate,
        creationDateSource: data.fileLastModified ? 'OS lastModified' : 'Current timestamp',
        internalAddedTimestamp: new Date().toISOString(),
        isVaulted: true,
        vaultMode: 'hidden',
        vaultedAt: new Date().toISOString(),
        ...encrypted,
      };

      const sanitized = sanitizeForNeon(mediaMetadata);
      const savedId = await this.storage.saveImage(sanitized);
      await this.updateStatusWithLog('🔒 Encrypted item saved to Secret Vault.', 'success');

      await this.archiveUploadLogRun('success', 'Encrypted vault upload completed.');

      return { id: savedId, ...mediaMetadata };
    } catch (error) {
      console.error('Vaulted upload error:', error);
      await this.archiveUploadLogRun('error', error.message || 'Encrypted vault upload failed.');
      throw error;
    } finally {
      this.activeUploadController = null;
    }
  }

  /**
   * Save a vaulted item that was encrypted and uploaded in the page (where
   * XHR progress is available). Called by the gallery page after the udrop
   * upload completes.
   * @param {Object} data - { uploadData, encrypted: {encryptedBlobUrl, ...}, udropResult, blobSize }
   */
  async saveVaultedUpload(data) {
    const { uploadData, encrypted, udropResult, blobSize } = data;
    const kind = (uploadData.isVideo || uploadData.kind === 'video') ? 'video' : 'image';
    const fileName = uploadData.fileName || (kind === 'video' ? 'video.mp4' : 'image.jpg');
    const creationDate = uploadData.fileLastModified ? new Date(uploadData.fileLastModified).toISOString() : null;

    const mediaMetadata = {
      kind,
      isVideo: kind === 'video',
      pageTitle: '',
      description: '',
      tags: [],
      collectionId: uploadData.collectionId || null,
      fileName: encrypted.encryptedFileName,
      fileSize: blobSize || uploadData.fileSize || null,
      fileType: 'application/octet-stream',
      fileTypeSource: 'Encrypted vault item',
      creationDate,
      creationDateSource: uploadData.fileLastModified ? 'OS lastModified' : 'Current timestamp',
      internalAddedTimestamp: new Date().toISOString(),
      isVaulted: true,
      vaultMode: 'hidden',
      vaultedAt: new Date().toISOString(),
      ...encrypted,
    };

    const sanitized = sanitizeForNeon(mediaMetadata);
    const savedId = await this.storage.saveImage(sanitized);
    return { id: savedId, ...mediaMetadata };
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

    // Encrypted vaulted upload path: skip pixvid/imgbb, store flat encrypted blob.
    if (data.isVaulted) {
      return this.handleVaultedUpload(data, 'image');
    }

    const uploadController = new AbortController();
    this.activeUploadController = uploadController;

    try {
      await chrome.storage.local.set({ uploadStatusLogs: [] });
      // Get API keys from storage
      const settings = await chrome.storage.sync.get(['pixvidApiKey', 'imgbbApiKey']);
      const configuredImageServices = getConfiguredImageUploadServices(settings);
      const missingRequiredImageServices = getMissingRequiredImageUploadServices(settings);

      await this.updateStatusWithLog('📥 Fetching image...');
      
      // Fetch the image
      const imageSource = data.fileBlob instanceof Blob ? data.fileBlob : data.imageUrl;
      const imageBlob = await this.fetchImage(imageSource, uploadController.signal, data.pageUrl);
      
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
      const isSvgImage =
        metadata.exifMetadata?.FileType === 'SVG' ||
        /image\/svg\+xml|svg/i.test(String(fileType || imageBlob.type || ''));

      if (isSvgImage) {
        await this.updateStatusWithLog(
          '⚠️ SVG upload blocked to preserve the original file.',
          'warning'
        );
        throw new Error('SVG uploads need raw-file storage. Pixvid does not list SVG as supported, and ImgBB rasterizes SVG to JPG, which breaks animation.');
      }

      if (missingRequiredImageServices.length > 0) {
        const missingNames = joinNames(missingRequiredImageServices.map((service) => service.label));
        throw new Error(
          `${missingNames} API key${missingRequiredImageServices.length > 1 ? 's are' : ' is'} not configured. Please set ${missingRequiredImageServices.length > 1 ? 'them' : 'it'} in the extension settings.`
        );
      }
      
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
      
      // console.log('Extracted metadata:', {
      //   sha256: metadata.sha256.substring(0, 16) + '...',
      //   pHash: metadata.pHash.substring(0, 32) + '...',
      //   width: metadata.width,
      //   height: metadata.height,
      //   size: metadata.size,
      //   fileType,
      //   fileTypeSource,
      //   creationDate,
      //   creationDateSource
      // });
      
      // Check for duplicates unless user wants to ignore
      if (!data.ignoreDuplicate) {
        await this.updateStatusWithLog('🔎 Checking for duplicates...');
        
        const existingImages = await this.storage.getAllImagesForDuplicateCheck();
        
        // console.log(`Checking against ${existingImages.length} existing images`);
        
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
        // console.log('⚠️ Duplicate check SKIPPED - User chose to ignore duplicates');
        await this.updateStatusWithLog('⚠️ Skipping duplicate check...', 'warning');
      }
      
      if (configuredImageServices.length === 0) {
        throw new Error('No image hosting service configured. Please set at least one image host in the extension settings.');
      }

      const selectedImageServices = filterUploadServicesByKeys(configuredImageServices, data.selectedHostKeys);

      if (selectedImageServices.length === 0) {
        throw new Error('Select at least one configured image host.');
      }

      await this.updateStatusWithLog(`☁️ Uploading to ${joinNames(selectedImageServices.map((service) => service.label))}...`);

      const uploadResults = await Promise.all(
        selectedImageServices.map((service) => {
          const uploader = this[service.uploaderKey];

          if (!uploader) {
            return Promise.resolve({
              type: service.key,
              error: `${service.label} uploader is unavailable`,
            });
          }

          return service
            .upload({
              uploader,
              blob: imageBlob,
              settings,
              data,
              signal: uploadController.signal,
            })
            .then((result) => ({ type: service.key, ...result }))
            .catch((error) => ({ type: service.key, error: error.message || String(error) }));
        })
      );

      const uploadResultsByType = new Map(uploadResults.map((result) => [result.type, result]));
      const pixvidResult = uploadResultsByType.get('pixvid');
      const imgbbResult = uploadResultsByType.get('imgbb');

      const successfulImageResults = uploadResults.filter((result) => result && !result.error && result.url);
      const failedImageResults = uploadResults.filter((result) => result?.error);

      if (successfulImageResults.length === 0) {
        throw new Error(
          failedImageResults.length > 0
            ? `Image upload failed on all selected hosts. ${failedImageResults.map((result) => `${result.type}: ${result.error}`).join(' | ')}`
            : 'Image upload failed on all selected hosts.'
        );
      }

      if (failedImageResults.length > 0) {
        console.warn('Some image uploads failed:', failedImageResults);
        await this.updateStatusWithLog(
          `⚠️ Partial upload success. ${failedImageResults.map((result) => `${result.type}: ${result.error}`).join(' | ')} Saving...`,
          'warning'
        );
      } else if (successfulImageResults.length > 1) {
        await this.updateStatusWithLog('✅ All image uploads successful! Saving...', 'success');
      } else {
        await this.updateStatusWithLog('✅ Image upload successful! Saving...', 'success');
      }
      
      await this.updateStatusWithLog('💾 Saving to Firebase...');
      
      // Extract filename if not provided
      const fileName = this.extractFileName(data);
      
      // Clean sourceImageUrl - don't save base64 data URLs to Firebase
      let cleanSourceImageUrl = data.originalSourceUrl || data.imageUrl;
      
      // If it's a data URL (base64), it was uploaded via context menu - no real source URL
      if (cleanSourceImageUrl && cleanSourceImageUrl.startsWith('data:')) {
        // console.log('⚠️ [SAVE] Source is base64 data URL (context menu upload), setting source URL to empty');
        cleanSourceImageUrl = '';
      }
      
      // Save metadata to Firebase/Neon with generic imageHosts plus legacy URL fields for compatibility.
      let imageMetadata = {
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
        fileType, // File type from File object or EXIF
        fileTypeSource, // Source of file type (for debugging)
        creationDate, // Creation date from EXIF or file metadata
        creationDateSource, // Source of creation date (for debugging)
        tags: data.tags || [],
        description: data.description || '',
        exifMetadata: metadata.exifMetadata || null,
        collectionId: data.collectionId || null
      };

      for (const result of uploadResults) {
        if (!result || result.error) continue;
        imageMetadata = mergeImageProviderResult(imageMetadata, result.type, result);
      }
      
      // Sanitize data for Neon database compatibility
      const sanitizedMetadata = sanitizeForNeon(imageMetadata);

      const savedId = await this.storage.saveImage(sanitizedMetadata);
      
      await this.updateStatusWithLog('✅ Image saved successfully!', 'success');
      
      await this.archiveUploadLogRun('success', 'Image upload completed successfully.');

      return {
        id: savedId,
        pixvidUrl: pixvidResult?.url || null,
        imgbbUrl: imgbbResult && !imgbbResult.error ? imgbbResult.url : null,
        ...imageMetadata
      };
    } catch (error) {
      console.error('Upload error:', error);
      await this.archiveUploadLogRun('error', error.message || 'Image upload failed.');
      throw error;
    } finally {
      if (this.activeUploadController === uploadController) {
        this.activeUploadController = null;
      }
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

      // Encrypted vaulted upload path: skip filemoon/udrop, store flat encrypted blob.
      if (data.isVaulted) {
        return this.handleVaultedUpload(data, 'video');
      }

      // Get API keys from storage
      const settings = await this.getMergedVideoHostSettings();
      
      const configuredServices = getConfiguredVideoUploadServices(settings);

      if (configuredServices.length === 0) {
        throw new Error('No video hosting service configured. Please set at least one video host in settings.');
      }

      const selectedServices = filterUploadServicesByKeys(configuredServices, data.selectedHostKeys);

      if (selectedServices.length === 0) {
        throw new Error('Select at least one configured video host.');
      }

      await this.updateStatusWithLog('📥 Fetching video...');
      
      // Fetch the video once
      const videoSource = data.fileBlob instanceof Blob ? data.fileBlob : data.imageUrl;
      const videoBlob = await this.fetchImage(videoSource, undefined, data.pageUrl);
      const expectedSize = Number.isFinite(data.fileSize) ? data.fileSize : null;
      const fileName = this.extractFileName(data);

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

      if (!data.ignoreDuplicate) {
        await this.updateStatusWithLog('🔎 Checking for duplicate videos...');
        const videoDuplicate = await this.storage.findSavedVideoDuplicate({
          sourcePageUrl: data.pageUrl,
          sourceImageUrl: data.originalSourceUrl || data.imageUrl,
          fileName,
          fileSize: videoBlob.size,
        });

        if (videoDuplicate) {
          const error = new Error(`Duplicate video detected: ${videoDuplicate.matchReason || 'same saved video'}`);
          error.duplicate = videoDuplicate;
          error.allDuplicates = [videoDuplicate];
          this.updateStatus('');
          throw error;
        }
      } else {
        await this.updateStatusWithLog('⚠️ Skipping duplicate video check...', 'warning');
      }
      
      const serviceLabels = selectedServices.map((service) => service.label);
      const statusMsg = serviceLabels.length > 1
        ? `☁️ Uploading to ${joinNames(serviceLabels)}...`
        : `☁️ Uploading to ${serviceLabels[0]}...`;
      
      await this.updateStatusWithLog(statusMsg);
      
      const uploadResults = {};
      const uploadErrors = [];

      for (const service of selectedServices) {
        const uploader = this[service.uploaderKey];
        if (!uploader) {
          uploadErrors.push(`${service.label}: uploader is not available`);
          await this.appendUploadLog(`${service.label} uploader is not available.`, 'error');
          continue;
        }

        await this.appendUploadLog(`${service.label}: starting upload...`);
        try {
          const result = await service.upload({
            uploader,
            blob: videoBlob,
            settings,
            data: { ...data, fileName },
          });
          uploadResults[service.key] = result;
          await this.appendVideoProviderResultLog(service, result);
        } catch (err) {
          console.error(`${service.label} upload failed:`, err);
          uploadErrors.push(`${service.label}: ${err.message || String(err)}`);
          await this.appendUploadLog(`${service.label} failed: ${err.message || String(err)}`, 'error');
        }
      }

      if (Object.keys(uploadResults).length === 0) {
        await this.appendUploadLog('❌ No video host completed successfully.', 'error');
        throw new Error(uploadErrors.length > 0
          ? `Video upload failed on all selected hosts. ${uploadErrors.join(' | ')}`
          : 'Video upload failed on all selected hosts.');
      }

      if (uploadErrors.length > 0) {
        await this.updateStatusWithLog(`⚠️ Partial upload success. ${uploadErrors.join(' | ')}`, 'warning');
      }
      
      await this.updateStatusWithLog('💾 Saving to Firebase...');
      
      // Clean sourceImageUrl
      let cleanSourceImageUrl = data.originalSourceUrl || data.imageUrl;
      
      if (cleanSourceImageUrl && cleanSourceImageUrl.startsWith('data:')) {
        // console.log('⚠️ [SAVE] Source is base64 data URL (manual upload), setting source URL to empty');
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
      
      // Save metadata with generic provider links plus legacy URL fields for compatibility.
      let videoMetadata = {
        sourceImageUrl: cleanSourceImageUrl,
        sourcePageUrl: data.pageUrl,
        pageTitle: data.pageTitle,
        fileName,
        fileSize: videoBlob.size,
        fileType: data.fileType || data.fileMimeType || videoBlob.type,
        fileTypeSource: data.fileTypeSource || 'File object',
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

      for (const [providerKey, result] of Object.entries(uploadResults)) {
        videoMetadata = mergeVideoProviderResult(videoMetadata, providerKey, result);
      }

      // Sanitize data for Neon database compatibility
      const sanitizedVideoMetadata = sanitizeForNeon(videoMetadata);

      const savedId = await this.storage.saveImage(sanitizedVideoMetadata);
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

  async retryImageHostUpload({ imageId, host } = {}) {
    const targetHost = String(host || '').trim().toLowerCase();
    const service = getImageUploadService(targetHost);
    const hostLabel = service?.label || '';

    if (!imageId) {
      throw new Error('Missing image ID for provider resolve.');
    }
    if (!service) {
      throw new Error('Choose a configured image host to resolve.');
    }

    const item = await this.storage.getImageById(imageId);
    if (!item) {
      throw new Error('Saved image was not found.');
    }
    if (item.isLink || item.isVideo || String(item.fileType || '').startsWith('video/')) {
      throw new Error('Only saved images can resolve image hosts.');
    }

    const settings = await chrome.storage.sync.get(service.apiKeyFields || []);
    if (!service.isConfigured(settings)) {
      throw new Error(`${hostLabel} API settings are not configured.`);
    }

    const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value.trim());
    const sourceCandidates = getImageRetrySourceCandidates(item, targetHost);
    const sourceUrl = sourceCandidates.find(isHttpUrl);

    if (!sourceUrl) {
      throw new Error(`No existing hosted image URL is available to resolve ${hostLabel}.`);
    }

    await chrome.storage.local.set({
      uploadActive: true,
      uploadStatus: `Resolving ${hostLabel} image host...`,
    });
    await this.appendUploadLog(`Resolving ${hostLabel} from hosted fallback URL...`);

    try {
      const imageBlob = await this.fetchImage(sourceUrl, undefined, item.sourcePageUrl || sourceUrl);
      const isImageBlob = (
        imageBlob instanceof Blob &&
        imageBlob.size > 0 &&
        (
          !imageBlob.type ||
          imageBlob.type.startsWith('image/') ||
          imageBlob.type === 'application/octet-stream' ||
          imageBlob.type === 'binary/octet-stream'
        )
      );

      if (!isImageBlob) {
        throw new Error(`Resolve source did not return an image file${imageBlob?.type ? ` (${imageBlob.type})` : ''}.`);
      }

      const uploader = this[service.uploaderKey];
      if (!uploader) {
        throw new Error(`${hostLabel} uploader is not available.`);
      }

      const result = await service.upload({
        uploader,
        blob: imageBlob,
        settings,
        data: {
          ...item,
          imageUrl: sourceUrl,
          pageUrl: item.sourcePageUrl || sourceUrl,
          fileName: item.fileName || this.extractFileName({ imageUrl: sourceUrl }) || 'image',
        },
      });

      const mergedUpdates = mergeImageProviderResult(item, targetHost, result);
      const updates = {
        imageHosts: mergedUpdates.imageHosts,
        ...(service.urlField ? { [service.urlField]: mergedUpdates[service.urlField] || '' } : {}),
        ...(service.deleteUrlField ? { [service.deleteUrlField]: mergedUpdates[service.deleteUrlField] || '' } : {}),
        ...(service.thumbUrlField ? { [service.thumbUrlField]: mergedUpdates[service.thumbUrlField] || '' } : {}),
      };

      await this.storage.updateImage(imageId, sanitizeForNeon(updates));
      await this.updateStatusWithLog(`${hostLabel} resolve succeeded. Saved the missing host URLs.`, 'success');
      return {
        id: imageId,
        ...updates,
      };
    } catch (error) {
      await this.updateStatusWithLog(`${hostLabel} resolve failed: ${error.message || String(error)}`, 'error');
      throw error;
    } finally {
      await chrome.storage.local.set({ uploadActive: false });
    }
  }

  async retryVideoHostUpload({ imageId, host } = {}) {
    const targetHost = String(host || '').trim().toLowerCase();
    const service = getVideoUploadService(targetHost);
    const hostLabel = service?.label || '';

    if (!imageId) {
      throw new Error('Missing video ID for retry.');
    }
    if (!service) {
      throw new Error('Choose a configured video host to retry.');
    }

    const item = await this.storage.getImageById(imageId);
    if (!item) {
      throw new Error('Saved video was not found.');
    }
    if (!item.isVideo && !String(item.fileType || '').startsWith('video/')) {
      throw new Error('Only saved videos can retry video hosts.');
    }

    const settings = await this.getMergedVideoHostSettings();
    if (!service.isConfigured(settings)) {
      throw new Error(`${hostLabel} API settings are not configured.`);
    }

    const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value.trim());
    const sourceCandidates = getVideoRetrySourceCandidates(item, targetHost);
    const httpCandidates = sourceCandidates.filter(isHttpUrl);

    if (httpCandidates.length === 0) {
      throw new Error(`No existing hosted video URL is available to retry ${hostLabel}.`);
    }

    await chrome.storage.local.set({
      uploadActive: true,
      uploadStatus: `Retrying ${hostLabel} upload...`,
    });
    await this.appendUploadLog(`Retrying ${hostLabel} from hosted fallback URL...`);

    try {
      // Try each fallback URL in order until one actually returns a video
      // file. Watch pages (text/html) and expired direct links fail fast,
      // so a single failed candidate must not abort the whole retry.
      let videoBlob = null;
      let sourceUrl = '';
      const fetchErrors = [];

      for (const candidate of httpCandidates) {
        let fetchTarget = candidate;
        let referrer = item.sourcePageUrl || candidate;

        // Filemoon /d/ and /e/ pages only serve HTML — resolve them through
        // the API to the raw file URL (which needs the filemoon referer).
        const filemoonCode = extractFilemoonFilecode(candidate);
        if (filemoonCode) {
          if (settings.filemoonApiKey) {
            try {
              const directFileUrl = await getFilemoonDirectLink(settings.filemoonApiKey, filemoonCode);
              if (directFileUrl) {
                fetchTarget = directFileUrl;
                referrer = 'https://filemoon.sx/';
              }
            } catch (apiError) {
              fetchErrors.push(`${candidate} -> direct link API: ${apiError.message || apiError}`);
            }
          } else {
            fetchErrors.push(`${candidate} -> filemoonApiKey not available in service worker`);
          }
        }

        try {
          // Videos are large — the 60s default is too short for a slow host,
          // so the whole candidate fails with "user aborted". Give the retry
          // download a generous timeout instead.
          const blob = await this.fetchImage(fetchTarget, AbortSignal.timeout(600000), referrer);
          const isVideoBlob = (
            blob instanceof Blob &&
            blob.size > 0 &&
            (
              !blob.type ||
              blob.type.startsWith('video/') ||
              blob.type === 'application/octet-stream' ||
              blob.type === 'binary/octet-stream'
            )
          );
          if (isVideoBlob) {
            videoBlob = blob;
            sourceUrl = candidate;
            break;
          }
          fetchErrors.push(`${candidate} -> not a video (${blob?.type || 'empty'})`);
        } catch (fetchError) {
          const isTimeout = fetchError?.name === 'AbortError' || /aborted/i.test(fetchError?.message || '');
          fetchErrors.push(`${candidate} -> ${isTimeout ? 'timed out after 10 minutes' : fetchError.message || fetchError}`);
        }

        // If the filemoon direct-link API was rejected (account without
        // direct link permission), stream the file through HLS instead:
        // m3u8 -> segments -> single video blob.
        if (filemoonCode && settings.filemoonApiKey) {
          try {
            const hlsM3u8 = await getFilemoonHlsLink(settings.filemoonApiKey, filemoonCode);
            if (!hlsM3u8) {
              fetchErrors.push(`${candidate} -> hls link API: no m3u8 returned`);
            } else {
              const hlsBlob = await this.downloadHlsAsVideoBlob(hlsM3u8);
              if (hlsBlob && hlsBlob.size > 0) {
                videoBlob = hlsBlob;
                sourceUrl = candidate;
                break;
              }
              fetchErrors.push(`${candidate} -> hls produced an empty blob`);
            }
          } catch (hlsError) {
            fetchErrors.push(`${candidate} -> hls: ${hlsError.message || hlsError}`);
          }
        }

        // Last resort for filemoon: the anonymous player flow
        // (captcha + pow + playback) which works without any API key.
        if (filemoonCode && !videoBlob) {
          try {
            const stream = await getFilemoonStreamSource(filemoonCode);
            if (!stream || !stream.url) {
              fetchErrors.push(`${candidate} -> player flow returned no stream`);
            } else {
              const hlsBlob = await this.downloadHlsAsVideoBlob(stream.url);
              if (hlsBlob && hlsBlob.size > 0) {
                videoBlob = hlsBlob;
                sourceUrl = candidate;
                break;
              }
              fetchErrors.push(`${candidate} -> player flow produced an empty blob`);
            }
          } catch (spaError) {
            fetchErrors.push(`${candidate} -> player flow: ${spaError.message || spaError}`);
          }
        }
      }

      if (!videoBlob) {
        const details = fetchErrors.length > 0 ? ` Tried: ${fetchErrors.join('; ')}` : '';
        throw new Error(`No retry source returned a video file.${details}`);
      }

      const fileName = item.fileName || this.extractFileName({ imageUrl: sourceUrl }) || 'video.mp4';
      const uploader = this[service.uploaderKey];
      if (!uploader) {
        throw new Error(`${hostLabel} uploader is not available.`);
      }
      // Cap the whole host upload so a hanging API surfaces as an error
      // instead of leaving the Fix button spinning forever.
      const uploadSignal = AbortSignal.timeout(120000);
      const result = await service.upload({
        uploader,
        blob: videoBlob,
        settings,
        data: { ...item, fileName },
        signal: uploadSignal,
      });
      const mergedUpdates = mergeVideoProviderResult(item, targetHost, result);
      const updates = {
        videoHosts: mergedUpdates.videoHosts,
        ...(service.watchUrlField ? { [service.watchUrlField]: mergedUpdates[service.watchUrlField] || '' } : {}),
        ...(service.directUrlField ? { [service.directUrlField]: mergedUpdates[service.directUrlField] || '' } : {}),
        ...(service.aliasWatchUrlField ? { [service.aliasWatchUrlField]: mergedUpdates[service.aliasWatchUrlField] || '' } : {}),
      };

      await this.storage.updateImage(imageId, sanitizeForNeon(updates));
      await this.updateStatusWithLog(`${hostLabel} retry succeeded. Saved the missing host URLs.`, 'success');
      return {
        id: imageId,
        ...updates,
      };
    } catch (error) {
      await this.updateStatusWithLog(`${hostLabel} retry failed: ${error.message || String(error)}`, 'error');
      throw error;
    } finally {
      await chrome.storage.local.set({ uploadActive: false });
    }
  }

  /**
   * Download an HLS stream (m3u8 + segments) into a single video blob.
   * Used to recover video bytes from Filemoon when the direct link API is
   * rejected for the account.
   * @param {string} m3u8Url
   * @returns {Promise<Blob|null>}
   */
  async downloadHlsAsVideoBlob(m3u8Url) {
    const absolute = (url) => new URL(url, m3u8Url).toString();

    let playlistUrl = m3u8Url;
    let playlist = await this.fetchTextWithReferer(playlistUrl);

    // Master playlist -> pick the last rendition (usually the highest).
    if (/#EXT-X-STREAM-INF/i.test(playlist)) {
      const lines = playlist.split(/\r?\n/);
      let rendition = '';
      for (let i = 0; i < lines.length; i += 1) {
        if (/^#EXT-X-STREAM-INF/i.test(lines[i])) {
          const next = lines[i + 1];
          if (next && !next.startsWith('#')) rendition = next;
        }
      }
      if (!rendition) throw new Error('HLS master playlist had no renditions');
      playlistUrl = absolute(rendition.trim());
      playlist = await this.fetchTextWithReferer(playlistUrl);
    }

    const lines = playlist.split(/\r?\n/);
    const segmentUris = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (/^#EXTINF/i.test(lines[i])) {
        const next = lines[i + 1];
        if (next && !next.startsWith('#')) segmentUris.push(absolute(next.trim()));
      }
    }
    if (segmentUris.length === 0) throw new Error('HLS playlist had no segments');

    const parts = [];
    for (const uri of segmentUris) {
      const blob = await this.fetchImage(uri, AbortSignal.timeout(600000), 'https://filemoon.sx/');
      if (!(blob instanceof Blob) || blob.size === 0) {
        throw new Error('HLS segment fetch returned empty data');
      }
      parts.push(await blob.arrayBuffer());
    }

    const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
    if (total === 0) return null;
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      merged.set(new Uint8Array(part), offset);
      offset += part.byteLength;
    }
    return new Blob([merged], { type: 'video/mp4' });
  }

  async fetchTextWithReferer(url) {
    const blob = await this.fetchImage(url, undefined, 'https://filemoon.sx/');
    if (!(blob instanceof Blob)) throw new Error('Playlist fetch failed');
    return blob.text();
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

      // Byse /file/info returns player_img as the thumbnail URL.
      // filemoonapi.com is unreliable (returns 522), so use byse as primary.
      const response = await fetch(`https://api.byse.sx/file/info?key=${apiKey}&file_code=${filecode}`);

      if (!response.ok) {
        throw new Error(`Byse /file/info returned ${response.status}`);
      }

      const result = await response.json();
      const playerImg = result?.result?.[0]?.player_img || result?.result?.player_img;

      if (playerImg) {
        return playerImg;
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
  async handleNativeDownload(url, requestId = '', format = null) {
    try {
      // console.log(`📥 [NATIVE] Sending download request for: ${url}`);

      const downloadFolder = await this.resolveNativeDownloadFolder();
      const cookies = await this.getCookiesForYtDlp(url);

      // Generate output path with timestamp
      const outputPath = `${downloadFolder}\\%(title)s [%(id)s].%(ext)s`;
      
      // console.log(`📁 [NATIVE] Download folder: ${downloadFolder}`);
      // console.log(`📝 [NATIVE] Output path template: ${outputPath}`);
      // console.log(`🍪 [NATIVE] Prepared ${cookies.length} cookies for native download`);
      // console.log(`🔌 [NATIVE] Attempting to connect to native host: com.imgvault.nativehost`);
      
      // Connect to native messaging host
      let port;
      try {
        port = chrome.runtime.connectNative('com.imgvault.nativehost');
        // console.log(`✅ [NATIVE] Port connected successfully`);
      } catch (connectError) {
        console.error(`❌ [NATIVE] Failed to connect:`, connectError);
        throw new Error('Failed to connect to native host: ' + connectError.message);
      }
      
      const activeRequestId = requestId || `native-download-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await this.startActiveNativeDownload(activeRequestId, url);

      return new Promise((resolve, reject) => {
        let responseReceived = false;
        this.activeNativeDownloadPorts.set(activeRequestId, port);
        
        // Large yt-dlp jobs can take a long time before the native host replies.
        const timeout = setTimeout(() => {
          if (!responseReceived) {
            console.error(`⏱️ [NATIVE] Timeout waiting for response`);
            port.disconnect();
            this.activeNativeDownloadPorts.delete(activeRequestId);
            this.finishActiveNativeDownload(activeRequestId, {
              status: 'failed',
              error: 'Download timed out while waiting for the native host to finish. The file may still be downloading in the background.',
              lastMessage: 'Download timed out while waiting for the native host to finish. The file may still be downloading in the background.',
            }).catch(() => {});
            reject(new Error('Download timed out while waiting for the native host to finish. The file may still be downloading in the background.'));
          }
        }, NATIVE_DOWNLOAD_TIMEOUT_MS);
        
        port.onMessage.addListener((response) => {
          // console.log(`📨 [NATIVE] Response from host:`, response);
          if (response?.event === 'progress') {
            const progressLine = response.line || '';
            const progressType =
              response.stream === 'stderr' && /^error:/i.test(String(progressLine).trim())
                ? 'error'
                : 'info';

            this.appendNativeDownloadLog(
              response.requestId || activeRequestId,
              `[yt-dlp] ${progressLine}`,
              progressType,
              response.stream || 'stdout'
            ).catch(() => {});

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
            this.settleNativeDownloadCompleted(
              activeRequestId,
              url,
              response.filePath || '',
              response.message || 'Download complete'
            )
              .catch((error) => {
                console.debug('Failed to persist pending auto upload state:', error);
              })
              .finally(() => {
                resolve(response);
              });
          } else {
            (async () => {
              const currentStatus = await this.getActiveNativeDownloadStatus(activeRequestId);
              const isUserCancelled =
                currentStatus === 'cancelling' || currentStatus === 'cancelled';

              if (isUserCancelled) {
                await this.finishActiveNativeDownload(activeRequestId, {
                  status: 'cancelled',
                  filePath: response.filePath || '',
                  error: '',
                  lastMessage: 'Download stopped.',
                });
                await this.appendNativeDownloadLog(
                  activeRequestId,
                  'Download stopped.',
                  'warning',
                  'system'
                );
                reject({
                  message: 'Download stopped.',
                  filePath: response.filePath,
                  stdout: response.stdout,
                  stderr: response.stderr,
                  cancelled: true,
                });
                return;
              }

              await this.finishActiveNativeDownload(activeRequestId, {
                status: 'failed',
                error: response.message || 'Native host download failed',
                filePath: response.filePath || '',
                lastMessage: this.summarizeNativeDownloadMessage(
                  response.message,
                  'Native host download failed'
                ),
              });
              await this.appendNativeDownloadLog(
                activeRequestId,
                response.message || 'Native host download failed',
                'error',
                'system'
              );
              reject({
                message: this.summarizeNativeDownloadMessage(
                  response.message,
                  'Native host download failed'
                ),
                filePath: response.filePath,
                stdout: response.stdout,
                stderr: response.stderr
              });
            })().catch((error) => {
              reject(error);
            });
          }
          
          this.activeNativeDownloadPorts.delete(activeRequestId);
          port.disconnect();
        });
        
        port.onDisconnect.addListener(() => {
          clearTimeout(timeout);
          if (!responseReceived) {
            (async () => {
              console.error(`❌ [NATIVE] Port disconnected without response`);
              const error = chrome.runtime.lastError;
              const errorMsg = error ? error.message : 'Native host disconnected unexpectedly. Make sure the native host is registered.';
              console.error(`❌ [NATIVE] Error details:`, errorMsg);
              this.activeNativeDownloadPorts.delete(activeRequestId);

              const currentStatus = await this.getActiveNativeDownloadStatus(activeRequestId);
              const isUserCancelled =
                currentStatus === 'cancelling' || currentStatus === 'cancelled';

              if (isUserCancelled) {
                await this.finishActiveNativeDownload(activeRequestId, {
                  status: 'cancelled',
                  error: '',
                  lastMessage: 'Download stopped.',
                });
                await this.appendNativeDownloadLog(
                  activeRequestId,
                  'Download stopped.',
                  'warning',
                  'system'
                );
                reject(new Error('Download stopped.'));
                return;
              }

              await this.finishActiveNativeDownload(activeRequestId, {
                status: 'failed',
                error: errorMsg,
                lastMessage: this.summarizeNativeDownloadMessage(
                  errorMsg,
                  'Native host disconnected unexpectedly.'
                ),
              });
              await this.appendNativeDownloadLog(activeRequestId, errorMsg, 'error', 'system');
              reject(new Error(errorMsg));
            })().catch((disconnectError) => {
              reject(disconnectError);
            });
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
            format: format,
          });
          // console.log(`✉️ [NATIVE] Message sent to native host:`, {
          //   action: 'download',
          //   url,
          //   output_path: outputPath,
          //   cookies_count: cookies.length,
          //   request_id: activeRequestId,
          // });
        } catch (sendError) {
          console.error(`❌ [NATIVE] Failed to send message:`, sendError);
          clearTimeout(timeout);
          this.activeNativeDownloadPorts.delete(activeRequestId);
          this.finishActiveNativeDownload(activeRequestId, {
            status: 'failed',
            error: 'Failed to send message to native host: ' + sendError.message,
            lastMessage: 'Failed to send message to native host: ' + sendError.message,
          }).catch(() => {});
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
    // console.log(`📁 [NATIVE] Auto-detected default video folder: ${detectedFolder}`);
    return detectedFolder;
  }

  async handleNativeHostCommand(command, data = {}, timeoutMs = 15000) {
    try {
      // console.log(`[NATIVE] Sending host command: ${command}`, data);

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
        }, timeoutMs);

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

  cookieDomainsForUrl(targetUrl = '') {
    const domains = new Set();
    let host = '';

    try {
      host = new URL(targetUrl).hostname.toLowerCase();
    } catch (error) {
      host = '';
    }

    if (host) {
      const labels = host.split('.').filter(Boolean);
      for (let i = 0; i < labels.length - 1; i += 1) {
        domains.add(`.${labels.slice(i).join('.')}`);
      }
    }

    if (!host || /(^|\.)youtube\.com$/.test(host) || host === 'youtu.be') {
      domains.add('.youtube.com');
      domains.add('.google.com');
    }

    return Array.from(domains);
  }

  async getCookiesForYtDlp(targetUrl = '') {
    const domains = this.cookieDomainsForUrl(targetUrl);

    const results = await Promise.all(
      domains.map(async (domain) => {
        try {
          return await chrome.cookies.getAll({ domain });
        } catch (error) {
          return [];
        }
      })
    );

    const allCookies = results.flat();

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

  async fetchImage(imageUrl, signal, pageUrl = '') {
    if (imageUrl instanceof Blob) {
      return imageUrl;
    }

    if (typeof imageUrl !== 'string') {
      throw new Error('Unsupported media source. Please reload the file and try again.');
    }

    // Never let a fetch hang the retry/upload pipeline indefinitely.
    const effectiveSignal = signal || AbortSignal.timeout(60000);

    if (imageUrl.startsWith('data:')) {
      const response = await fetch(imageUrl, { signal: effectiveSignal });
      return response.blob();
    } else {
      let fetchOptions = { signal: effectiveSignal };
      try {
        const parsed = new URL(imageUrl);
        const isPixivCdn = /(^|\.)pximg\.net$/i.test(parsed.hostname);
        
        if (isPixivCdn) {
          // declarativeNetRequest handles the Referer header automatically for pximg.net
          // Just ensure credentials are included if needed
          fetchOptions = {
            ...fetchOptions,
            credentials: 'include',
          };
        } else if (typeof pageUrl === 'string' && /^https?:\/\//i.test(pageUrl)) {
          fetchOptions = {
            ...fetchOptions,
            referrer: pageUrl,
            referrerPolicy: 'no-referrer-when-downgrade',
          };
        }
      } catch (_) {
        // Keep default fetch options when URL parsing fails.
      }

      const response = await fetch(imageUrl, fetchOptions);
      if (!response.ok) {
        throw new Error('Failed to fetch image: HTTP ' + response.status);
      }
      return response.blob();
    }
  }

  async fetchImageAsDataUrl(imageUrl, pageUrl = '') {
    const blob = await this.fetchImage(imageUrl, undefined, pageUrl);
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';

    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }

    return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
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
        // console.log('Could not extract filename from URL:', e);
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
      // console.log('🔍 Extracting metadata only...');
      
      // Fetch image with host-aware fetch logic (important for pximg/pixiv hotlink rules)
      const imageBlob = await this.fetchImage(imageUrl, undefined, pageUrl);
      
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
      
      // console.log('✅ Metadata extracted:', metadata);
      // console.log('📋 File Type:', fileType, '(', fileTypeSource, ')');
      // console.log('📅 Creation Date:', creationDate, '(', creationDateSource, ')');
      
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
    let errorMsg = `Duplicate image detected! (${totalMatches} unique item${totalMatches !== 1 ? 's' : ''} found)\n\n`;
    let duplicateData = null;
    
    if (totalMatches > 0) {
      errorMsg += 'Matches:\n';
      duplicateCheck.allMatches.slice(0, 5).forEach((match, i) => {
        const matchTypes = match.matchTypes || [match.matchType || 'unknown'];
        const labels = [];
        if (matchTypes.includes('exact')) labels.push('exact file');
        if (matchTypes.includes('context')) labels.push('same source');
        if (matchTypes.includes('visual')) {
          const strength = match.visualStrength || 'likely';
          labels.push(`${strength} visual`);
        }

        const location = match._isTrash ? 'in trash' : 'in gallery';
        const title = match.pageTitle ? ` - ${match.pageTitle}` : '';
        errorMsg += `  ${i + 1}. ${labels.join(', ')} (${location})${title}\n`;

        if (match.matchTypes?.includes('visual')) {
          const similarity = match.similarity || '0';
          const matchCount = match.matchCount || 0;
          const hashResults = match.hashResults || {};
          const matchedHashes = [];
          if (hashResults.pHash?.match) matchedHashes.push('pHash');
          if (hashResults.aHash?.match) matchedHashes.push('aHash');
          if (hashResults.dHash?.match) matchedHashes.push('dHash');
          errorMsg += `     Visual: ${similarity}% similar (${matchCount}/3 hashes: ${matchedHashes.join(', ') || 'unknown'})\n`;
        }
      });

      if (duplicateCheck.allMatches.length > 5) {
        errorMsg += `  ... and ${duplicateCheck.allMatches.length - 5} more\n`;
      }
      
      duplicateData = duplicateCheck.exactMatch || duplicateCheck.contextMatch || duplicateCheck.visualMatch;
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

    let videoMetadata = {
      sourceImageUrl: cleanSourceImageUrl,
      sourcePageUrl: data.pageUrl,
      pageTitle: data.pageTitle,
      fileName,
      fileSize: data.fileSize || 0,
      fileType: data.fileType || data.fileMimeType || '',
      fileTypeSource: data.fileTypeSource || 'File object',
      creationDate,
      creationDateSource,
      duration: Number.isFinite(data.duration) ? data.duration : null,
      width: Number.isFinite(data.width) ? data.width : null,
      height: Number.isFinite(data.height) ? data.height : null,
      tags: data.tags || [],
      description: data.description || '',
      collectionId: data.collectionId || null,
      isVideo: true,
    };

    const uploadResults = data.videoUploadResults || {
      ...(data.filemoonResult ? { filemoon: data.filemoonResult } : {}),
      ...(data.udropResult ? { udrop: data.udropResult } : {}),
      ...(data.teraboxResult ? { terabox: data.teraboxResult } : {}),
    };

    for (const [providerKey, result] of Object.entries(uploadResults)) {
      videoMetadata = mergeVideoProviderResult(videoMetadata, providerKey, result);
    }

    await this.updateStatusWithLog('Saving video metadata...');
    // Sanitize data for Neon database compatibility
    const sanitizedVideoMetadata = sanitizeForNeon(videoMetadata);

    const savedId = await this.storage.saveImage(sanitizedVideoMetadata);
    await this.appendUploadLog(`[SAVE VIDEO] Video metadata size: ${JSON.stringify(videoMetadata).length} bytes`);
    await this.appendUploadLog(`[SAVE VIDEO] Saved successfully with ID: ${savedId}`, 'success');
    await this.updateStatusWithLog('Video saved successfully!', 'success');

    return {
      id: savedId,
      ...videoMetadata
    };
  }

  // DB-first video upload: create the item BEFORE uploading so that even if
  // the browser/tab dies mid-upload (or the save step is interrupted), the
  // item already exists in the DB and a half-finished file on the host can be
  // recovered via the resolve page instead of showing up as a ghost orphan.
  // Mark it pendingUpload so the resolve page can offer to link orphaned host
  // files to it. finalizeUploadedVideo() fills in the host links afterwards.
  async createPendingUpload(data) {
    const fileName = this.extractFileName(data);

    let cleanSourceImageUrl = data.originalSourceUrl || data.imageUrl;
    if (cleanSourceImageUrl && cleanSourceImageUrl.startsWith('data:')) {
      cleanSourceImageUrl = '';
    }

    const videoMetadata = {
      sourceImageUrl: cleanSourceImageUrl,
      sourcePageUrl: data.pageUrl,
      pageTitle: data.pageTitle,
      fileName,
      fileSize: data.fileSize || 0,
      fileType: data.fileType || data.fileMimeType || '',
      fileTypeSource: data.fileTypeSource || 'File object',
      duration: Number.isFinite(data.duration) ? data.duration : null,
      width: Number.isFinite(data.width) ? data.width : null,
      height: Number.isFinite(data.height) ? data.height : null,
      tags: data.tags || [],
      description: data.description || '',
      collectionId: data.collectionId || null,
      isVideo: true,
      extraMetadata: {
        pendingUpload: true,
        pendingUploadStartedAt: new Date().toISOString(),
        pendingUploadFileName: fileName || '',
      },
    };

    const sanitized = sanitizeForNeon(videoMetadata);
    const savedId = await this.storage.saveImage(sanitized);
    await this.appendUploadLog(`[PENDING UPLOAD] Reserved DB item ${savedId} before upload.`);
    return { id: savedId };
  }

  // Update an item created by createPendingUpload with the real host links
  // once the upload finishes. Also used by the resolve page to adopt an orphan
  // host file into a pending item (linkProviderFileToItem-style recovery).
  async finalizeUploadedVideo(data) {
    const { id, videoUploadResults } = data || {};
    if (!id) throw new Error('finalizeUploadedVideo requires an item id');

    const current = await this.storage.getImageById(id);
    if (!current) throw new Error(`Item ${id} not found`);

    const results = videoUploadResults || {
      ...(data.filemoonResult ? { filemoon: data.filemoonResult } : {}),
      ...(data.udropResult ? { udrop: data.udropResult } : {}),
      ...(data.teraboxResult ? { terabox: data.teraboxResult } : {}),
    };

    let merged = { ...current };
    for (const [providerKey, result] of Object.entries(results)) {
      merged = mergeVideoProviderResult(merged, providerKey, result);
    }

    const extraMetadata = {
      ...(merged.extraMetadata && typeof merged.extraMetadata === 'object' ? merged.extraMetadata : {}),
    };
    delete extraMetadata.pendingUpload;
    delete extraMetadata.pendingUploadStartedAt;
    delete extraMetadata.pendingUploadFileName;

    await this.storage.updateImage(id, {
      ...merged,
      extraMetadata,
    });

    await this.appendUploadLog(`[FINALIZE UPLOAD] Linked host URLs to item ${id}.`, 'success');
    return { id, ...merged, extraMetadata };
  }

  async handleFetchFile({ mediaId, url }) {
    let configJson = null;
    let extraMetadata = null;

    // Load config from DB if mediaId is available
    if (mediaId) {
      try {
        const sql = this.storage.ensureNeonReady?.();
        if (sql) {
          const rows = await sql`SELECT config_json, extra_metadata FROM public.media_items WHERE id = ${mediaId} AND (config_json IS NOT NULL OR extra_metadata IS NOT NULL) LIMIT 1`;
          if (rows?.[0]?.config_json) {
            configJson = typeof rows[0].config_json === 'string' ? JSON.parse(rows[0].config_json) : rows[0].config_json;
          }
          if (rows?.[0]?.extra_metadata) {
            extraMetadata = typeof rows[0].extra_metadata === 'string' ? JSON.parse(rows[0].extra_metadata) : rows[0].extra_metadata;
          }
        }
      } catch (e) {
        console.warn('[Fetcher] Failed to load config_json:', e.message);
      }
    }

    // Try IndexedDB cache first (for scene files cached during upload).
    if (mediaId) {
      try {
        const { getCachedSceneFiles } = await import('../utils/sceneFileCache.js');
        const cached = await getCachedSceneFiles(mediaId);
        if (cached?.spzBytes) {
          console.log('[Fetcher] Cache hit for', mediaId, 'spz:', cached.spzBytes.byteLength, 'tex:', cached.textureBytes?.byteLength);
          return {
            spzBuffer: Array.from(new Uint8Array(cached.spzBytes)),
            textureBuffer: cached.textureBytes ? Array.from(new Uint8Array(cached.textureBytes)) : null,
            configJson,
            fromCache: true,
          };
        }
      } catch (e) {
        console.warn('[Fetcher] Cache read failed:', e.message);
      }
    }

    // Fallback: fetch from URL (service worker has no CORS restrictions).
    if (!url) throw new Error('No URL and no cached data available');
    let fetchUrl = url;

    if (url.includes('udrop.com/file/')) {
      try {
        const pageResp = await fetch(url);
        const html = await pageResp.text();
        const match = html.match(/url='([^']+)'/i) || html.match(/url="([^"]+)"/i);
        if (match && match[1]) fetchUrl = match[1];
      } catch (e) {
        console.warn('[Fetcher] UDrop page parse failed:', e.message);
      }
    }

    // Try primary URL first
    let primaryFailed = false;
    try {
      const resp = await fetch(fetchUrl);
      if (resp.ok) {
        const buffer = await resp.arrayBuffer();
        console.log('[Fetcher] Fetched', buffer.byteLength, 'bytes from', fetchUrl.substring(0, 80));
        return { buffer: Array.from(new Uint8Array(buffer)), configJson, contentType: resp.headers.get('content-type') || '' };
      }
      primaryFailed = true;
      console.warn('[Fetcher] Primary URL returned', resp.status, resp.statusText, fetchUrl.substring(0, 80));
    } catch (e) {
      primaryFailed = true;
      console.warn('[Fetcher] Primary URL network error:', e.message, fetchUrl.substring(0, 80));
    }

    if (primaryFailed) {
      // Try fallback URLs from extraMetadata for scene files
      if (extraMetadata?.sceneSpzWatchUrl) {
        console.log('[Fetcher] Trying watch URL:', extraMetadata.sceneSpzWatchUrl);
        try {
          const watchResp = await fetch(extraMetadata.sceneSpzWatchUrl);
          if (watchResp.ok) {
            const buffer = await watchResp.arrayBuffer();
            console.log('[Fetcher] Fetched from watch URL', buffer.byteLength, 'bytes');
            return { buffer: Array.from(new Uint8Array(buffer)), configJson, contentType: watchResp.headers.get('content-type') || '' };
          }
          console.warn('[Fetcher] Watch URL failed:', watchResp.status, watchResp.statusText);
        } catch (e) {
          console.warn('[Fetcher] Watch URL network error:', e.message);
        }
      }
      if (extraMetadata?.sceneSpzShortUrl) {
        console.log('[Fetcher] Trying short URL:', extraMetadata.sceneSpzShortUrl);
        try {
          const shortResp = await fetch(extraMetadata.sceneSpzShortUrl);
          if (shortResp.ok) {
            const buffer = await shortResp.arrayBuffer();
            console.log('[Fetcher] Fetched from short URL', buffer.byteLength, 'bytes');
            return { buffer: Array.from(new Uint8Array(buffer)), configJson, contentType: shortResp.headers.get('content-type') || '' };
          }
          console.warn('[Fetcher] Short URL failed:', shortResp.status, shortResp.statusText);
        } catch (e) {
          console.warn('[Fetcher] Short URL network error:', e.message);
        }
      }
      // Try regenerating a fresh direct URL via UDrop API if we have the fileId
      let fileId = extraMetadata?.sceneSpzFileId;
      // For old scenes: extract fileId from the udrop.com/file/{code}/... URL pattern
      if (!fileId && url?.includes('udrop.com/file/')) {
        const codeMatch = url.match(/udrop\.com\/file\/([^\/]+)/i);
        if (codeMatch?.[1]) {
          fileId = codeMatch[1];
          console.log('[Fetcher] Extracted fileId from udrop URL:', fileId);
        }
      }
      if (fileId) {
        console.log('[Fetcher] Trying UDrop API regeneration for fileId:', fileId);
        const freshUrl = await this.regenerateUdropDirectUrl(fileId);
        if (freshUrl) {
          try {
            const freshResp = await fetch(freshUrl);
            if (freshResp.ok) {
              const buffer = await freshResp.arrayBuffer();
              console.log('[Fetcher] Fetched from regenerated URL', buffer.byteLength, 'bytes');
              return { buffer: Array.from(new Uint8Array(buffer)), configJson, contentType: freshResp.headers.get('content-type') || '' };
            }
            console.warn('[Fetcher] Regenerated URL failed:', freshResp.status, freshResp.statusText);
          } catch (e) {
            console.warn('[Fetcher] Regenerated URL network error:', e.message);
          }
        }
      }
      throw new Error(`All fetch attempts failed for ${fetchUrl.substring(0, 80)}`);
    }
  }

  async handleSceneUpload(data) {
    try {
      await chrome.storage.local.set({ uploadStatusLogs: [] });
      
      const settings = await this.getMergedVideoHostSettings();
      const udropService = getConfiguredVideoUploadServices(settings).find(s => s.key === 'udrop');
      
      if (!udropService) {
        throw new Error('UDrop is not configured. Please set UDrop API keys in settings.');
      }

      // Reconstruct Blobs from plain arrays (ArrayBuffers get zeroed in MV3 messaging)
      const spzBlob = new Blob([new Uint8Array(data.spzArray)], { type: 'application/octet-stream' });
      const textureBlob = new Blob([new Uint8Array(data.textureArray)], { type: data.textureMimeType || 'image/webp' });

      if (spzBlob.size <= 0) {
        throw new Error('SPZ file is empty.');
      }
      if (textureBlob.size <= 0) {
        throw new Error('Texture file is empty.');
      }

      await this.updateStatusWithLog('☁️ Uploading SPZ to UDrop...');
      console.log('📦 [SCENE] UDrop keys present:', Boolean(settings.udropKey1 && settings.udropKey2), 'key1 length:', settings.udropKey1?.length, 'key2 length:', settings.udropKey2?.length);
      const uploader = new UDropUploader();
      const spzResult = await uploader.upload(
        spzBlob,
        settings.udropKey1,
        settings.udropKey2,
        data.spzFileName || 'scene.spz'
      );
      await this.appendUploadLog(`SPZ uploaded: ${spzResult.url}`);

      await this.updateStatusWithLog('☁️ Uploading texture to UDrop...');
      const textureResult = await uploader.upload(
        textureBlob,
        settings.udropKey1,
        settings.udropKey2,
        data.textureFileName || 'texture.webp'
      );
      await this.appendUploadLog(`Texture uploaded: ${textureResult.url}`);

      await this.updateStatusWithLog('💾 Saving scene to database...');

      let creationDate = null;
      let creationDateSource = '';
      if (data.fileLastModified) {
        creationDate = new Date(data.fileLastModified).toISOString();
        creationDateSource = 'OS lastModified';
      } else {
        creationDate = new Date().toISOString();
        creationDateSource = 'Current timestamp';
      }

      const sceneMetadata = {
        kind: 'scene',
        pageTitle: data.pageTitle || '',
        description: data.description || '',
        tags: data.tags || [],
        collectionId: data.collectionId || null,
        sourcePageUrl: data.pageUrl || '',
        fileName: data.spzFileName || 'scene.spz',
        fileSize: data.spzFileSize || spzBlob.size,
        fileType: 'application/octet-stream',
        fileTypeSource: 'File object',
        creationDate,
        creationDateSource,
        spzUrl: spzResult.url,
        spzFileSize: data.spzFileSize || spzBlob.size,
        textureUrl: textureResult.url,
        textureFileSize: data.textureFileSize || textureBlob.size,
        configJson: data.sceneConfig ? JSON.stringify(data.sceneConfig) : null,
        extraMetadata: {
          sceneSpzFileId: spzResult.fileId || '',
          sceneSpzWatchUrl: spzResult.watchUrl || '',
          sceneSpzShortUrl: spzResult.shortUrl || '',
          sceneTextureFileId: textureResult.fileId || '',
          sceneTextureWatchUrl: textureResult.watchUrl || '',
        },
      };

      const savedId = await this.storage.saveImage(sceneMetadata);

      // Cache file bytes in IndexedDB so the viewer doesn't depend on UDrop URLs
      try {
        const { cacheSceneFiles } = await import('../utils/sceneFileCache.js');
        await cacheSceneFiles(savedId, {
          spzBytes: await spzBlob.arrayBuffer(),
          textureBytes: await textureBlob.arrayBuffer(),
        });
        await this.appendUploadLog('Scene files cached in IndexedDB');
      } catch (e) {
        console.warn('[Scene] Failed to cache files:', e.message);
      }

      await this.updateStatusWithLog('✅ 3D Scene saved successfully!', 'success');

      return {
        id: savedId,
        ...sceneMetadata,
      };
    } catch (error) {
      await this.updateStatusWithLog(`❌ Scene upload failed: ${error.message}`, 'error');
      throw error;
    }
  }

  async regenerateUdropDirectUrl(fileId) {
    try {
      const settings = await this.getMergedVideoHostSettings();
      if (!settings.udropKey1 || !settings.udropKey2) {
        console.warn('[Fetcher] Cannot regenerate UDrop URL: keys not configured');
        return null;
      }
      const uploader = new UDropUploader();
      const auth = await uploader.authorize(settings.udropKey1, settings.udropKey2);
      const formData = new FormData();
      formData.append('access_token', auth.access_token);
      formData.append('account_id', auth.account_id);
      formData.append('file_id', fileId);
      const resp = await fetch('https://www.udrop.com/api/v2/file/download', {
        method: 'POST',
        body: formData,
      });
      if (!resp.ok) return null;
      const result = await resp.json();
      if (result._status === 'success' && result.data?.download_url) {
        console.log('[Fetcher] Regenerated UDrop direct URL:', result.data.download_url);
        return result.data.download_url;
      }
      return null;
    } catch (e) {
      console.warn('[Fetcher] Failed to regenerate UDrop URL:', e.message);
      return null;
    }
  }
}

// Initialize service worker
const serviceWorker = new ImgVaultServiceWorker();

// Any download that was still in flight when the previous service worker
// context died is stale — settle it as interrupted on startup.
serviceWorker.reconcileStaleNativeDownload();

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
    await serviceWorker.resumePendingAutoUploadOnFocus();
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
    await serviceWorker.resumePendingAutoUploadOnFocus();
  } catch (error) {
    console.debug('Failed to update action icon on tab update:', error);
  }
});

chrome.windows.onFocusChanged.addListener(async () => {
  await serviceWorker.resumePendingAutoUploadOnFocus();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  serviceWorker.handleContextMenuClick(info, tab);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  return serviceWorker.handleMessage(request, sender, sendResponse);
});

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  const currentUrl = tab?.url || '';

  if (serviceWorker.isSupportedVideoPage(currentUrl)) {
    await serviceWorker.openOrFocusApp(`/host?url=${encodeURIComponent(currentUrl)}`, { reload: true });
    return;
  }

  await serviceWorker.openOrFocusApp('/gallery', { reload: true });
});

// Export for testing
export default serviceWorker;

