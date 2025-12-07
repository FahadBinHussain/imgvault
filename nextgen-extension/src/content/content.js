/**
 * @fileoverview Content Script for ImgVault
 * @description Runs on all web pages to capture additional context
 * @version 2.0.0
 */

console.log('🚀 ImgVault content script loaded on:', window.location.href);

/**
 * Store last right-click position and element
 */
let lastRightClickElement = null;

/**
 * Capture right-click events to store clicked element
 */
document.addEventListener('contextmenu', (e) => {
  lastRightClickElement = e.target;
  console.log('📍 Right-click captured on element:', e.target);
  
  // Also try to extract and store background image immediately
  const imageUrl = extractBackgroundImage(e.target);
  if (imageUrl) {
    console.log('💾 Storing right-click image URL:', imageUrl);
    chrome.storage.local.set({
      lastRightClickImageUrl: imageUrl,
      lastRightClickTimestamp: Date.now()
    });
  }
}, true);

/**
 * Extract background image from element
 * @param {HTMLElement} element - Element to check
 * @returns {string|null} Image URL
 */
function extractBackgroundImage(element) {
  if (!element) return null;
  
  // Check data attribute
  const coverImageUrlSet = element.getAttribute('data-cover-image-url-set');
  if (coverImageUrlSet) {
    const urls = coverImageUrlSet.split(',').map(s => s.trim().split(' ')[0]);
    return urls[0];
  }
  
  // Check inline style
  const inlineStyle = element.getAttribute('style');
  if (inlineStyle && inlineStyle.includes('background-image')) {
    const match = inlineStyle.match(/background-image:\s*url\(['"]?(.+?)['"]?\)/);
    if (match) return match[1];
  }
  
  // Check computed style
  const style = window.getComputedStyle(element);
  const bgImage = style.backgroundImage;
  if (bgImage && bgImage !== 'none') {
    const match = bgImage.match(/url\(['"]?(.+?)['"]?\)/);
    if (match) return match[1];
  }
  
  // Check parents
  let parent = element.parentElement;
  let depth = 0;
  while (parent && depth < 5) {
    const parentUrl = extractBackgroundImageDirect(parent);
    if (parentUrl) return parentUrl;
    parent = parent.parentElement;
    depth++;
  }
  
  return null;
}

/**
 * Extract background image directly from element (non-recursive)
 */
function extractBackgroundImageDirect(element) {
  if (!element) return null;
  
  const coverImageUrlSet = element.getAttribute('data-cover-image-url-set');
  if (coverImageUrlSet) {
    const urls = coverImageUrlSet.split(',').map(s => s.trim().split(' ')[0]);
    return urls[0];
  }
  
  const inlineStyle = element.getAttribute('style');
  if (inlineStyle && inlineStyle.includes('background-image')) {
    const match = inlineStyle.match(/background-image:\s*url\(['"]?(.+?)['"]?\)/);
    if (match) return match[1];
  }
  
  const style = window.getComputedStyle(element);
  const bgImage = style.backgroundImage;
  if (bgImage && bgImage !== 'none') {
    const match = bgImage.match(/url\(['"]?(.+?)['"]?\)/);
    if (match) return match[1];
  }
  
  return null;
}

/**
 * Message handlers
 */
const messageHandlers = {
  /**
   * Get page information
   * @returns {Object} Page info
   */
  getPageInfo() {
    return {
      title: document.title,
      url: window.location.href,
      description: getMetaContent('description'),
      keywords: getMetaContent('keywords')
    };
  },
  
  /**
   * Get background image from clicked element
   * @param {number} x - Click X coordinate
   * @param {number} y - Click Y coordinate
   * @returns {Object} Background image info
   */
  getBackgroundImage(x, y) {
    const element = lastRightClickElement || document.elementFromPoint(x, y);
    if (!element) {
      console.log('❌ No element found');
      return { imageUrl: null };
    }
    
    console.log('🔍 Checking element for background image:', element);
    console.log('🔍 Element tag:', element.tagName);
    console.log('🔍 Element id:', element.id);
    console.log('🔍 Element classes:', element.className);
    
    // Check data attributes for rajce.idnes.cz (check this first as it's most specific)
    const coverImageUrlSet = element.getAttribute('data-cover-image-url-set');
    if (coverImageUrlSet) {
      console.log('🎯 Found data-cover-image-url-set:', coverImageUrlSet);
      // Extract highest resolution URL from srcset
      const urls = coverImageUrlSet.split(',').map(s => s.trim().split(' ')[0]);
      const highestResUrl = urls[0]; // First one is usually highest
      console.log('🎨 Extracted highest res URL:', highestResUrl);
      return { imageUrl: highestResUrl };
    }
    
    // Check for inline style background image
    const inlineStyle = element.getAttribute('style');
    if (inlineStyle && inlineStyle.includes('background-image')) {
      const urlMatch = inlineStyle.match(/background-image:\s*url\(['"]?(.+?)['"]?\)/);
      if (urlMatch && urlMatch[1]) {
        console.log('🎨 Found inline background image:', urlMatch[1]);
        return { imageUrl: urlMatch[1] };
      }
    }
    
    // Check for background image in computed style
    const computedStyle = window.getComputedStyle(element);
    const backgroundImage = computedStyle.backgroundImage;
    
    if (backgroundImage && backgroundImage !== 'none') {
      const urlMatch = backgroundImage.match(/url\(['"]?(.+?)['"]?\)/);
      if (urlMatch && urlMatch[1]) {
        console.log('🎨 Found computed background image:', urlMatch[1]);
        return { imageUrl: urlMatch[1] };
      }
    }
    
    // Check parent elements
    let parent = element.parentElement;
    let depth = 0;
    while (parent && depth < 5) {
      console.log(`🔍 Checking parent ${depth + 1}:`, parent.tagName, parent.id, parent.className);
      
      const parentCoverImageUrlSet = parent.getAttribute('data-cover-image-url-set');
      if (parentCoverImageUrlSet) {
        console.log('🎯 Found data-cover-image-url-set in parent:', parentCoverImageUrlSet);
        const urls = parentCoverImageUrlSet.split(',').map(s => s.trim().split(' ')[0]);
        const highestResUrl = urls[0];
        console.log('🎨 Extracted URL from parent:', highestResUrl);
        return { imageUrl: highestResUrl };
      }
      
      const parentInlineStyle = parent.getAttribute('style');
      if (parentInlineStyle && parentInlineStyle.includes('background-image')) {
        const urlMatch = parentInlineStyle.match(/background-image:\s*url\(['"]?(.+?)['"]?\)/);
        if (urlMatch && urlMatch[1]) {
          console.log('🎨 Found inline background image in parent:', urlMatch[1]);
          return { imageUrl: urlMatch[1] };
        }
      }
      
      const parentStyle = window.getComputedStyle(parent);
      const parentBgImage = parentStyle.backgroundImage;
      
      if (parentBgImage && parentBgImage !== 'none') {
        const urlMatch = parentBgImage.match(/url\(['"]?(.+?)['"]?\)/);
        if (urlMatch && urlMatch[1]) {
          console.log('🎨 Found computed background image in parent:', urlMatch[1]);
          return { imageUrl: urlMatch[1] };
        }
      }
      
      parent = parent.parentElement;
      depth++;
    }
    
    console.log('❌ No background image found');
    return { imageUrl: null };
  }
};

/**
 * Get meta tag content
 * @param {string} name - Meta tag name
 * @returns {string} Meta content
 */
function getMetaContent(name) {
  const meta = document.querySelector(`meta[name="${name}"]`) || 
                document.querySelector(`meta[property="og:${name}"]`);
  return meta ? meta.getAttribute('content') : '';
}

/**
 * Get high resolution image URL if available
 * @param {HTMLImageElement} imgElement - Image element
 * @returns {string} High resolution image URL
 */
function getHighResImageUrl(imgElement) {
  const highResSources = [
    imgElement.getAttribute('data-src'),
    imgElement.getAttribute('data-original'),
    imgElement.getAttribute('data-full'),
    imgElement.src
  ];
  
  return highResSources.find(src => src && src.length > 0) || imgElement.src;
}

/**
 * Listen for messages from background script
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📨 Content script received message:', request);
  
  const handler = messageHandlers[request.action];
  
  if (handler) {
    try {
      const response = handler(request.x, request.y);
      console.log('✅ Handler response:', response);
      sendResponse(response);
    } catch (error) {
      console.error('❌ Handler error:', error);
      sendResponse({ imageUrl: null, error: error.message });
    }
  } else {
    console.warn('⚠️ No handler found for action:', request.action);
    sendResponse({ imageUrl: null });
  }
  
  return true;
});

/**
 * Flickr-specific: Make images accessible for context menu
 */
if (window.location.hostname.includes('flickr.com')) {
  console.log('🔧 ImgVault: Enabling Flickr image context menu');
  
  // Allow right-click on Flickr images by removing the protective overlay
  const enableFlickrContextMenu = () => {
    // Remove pointer-events from protective overlays
    const protectiveOverlays = document.querySelectorAll('.facade-of-protection-zoom, .facade-of-protection');
    console.log(`Found ${protectiveOverlays.length} protective overlays`);
    protectiveOverlays.forEach(overlay => {
      overlay.style.pointerEvents = 'none';
      overlay.style.display = 'none'; // Hide it completely
    });
    
    // Make zoom containers allow pointer events to pass through to images
    const zoomContainers = document.querySelectorAll('.zoom-photo-container');
    console.log(`Found ${zoomContainers.length} zoom containers`);
    zoomContainers.forEach(container => {
      const images = container.querySelectorAll('img');
      console.log(`Found ${images.length} images in container`);
      images.forEach(img => {
        img.style.pointerEvents = 'auto';
        console.log('Enabled pointer events on image:', img.src);
      });
    });
    
    // Also handle all images on the page
    const allImages = document.querySelectorAll('img');
    console.log(`Total images on page: ${allImages.length}`);
    allImages.forEach(img => {
      img.style.pointerEvents = 'auto';
    });
  };
  
  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enableFlickrContextMenu);
  } else {
    enableFlickrContextMenu();
  }
  
  // Watch for dynamic content changes
  const observer = new MutationObserver(() => {
    enableFlickrContextMenu();
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Also try to disable contextmenu event listeners
  document.addEventListener('contextmenu', (e) => {
    if (e.target.tagName === 'IMG') {
      console.log('Context menu on image allowed');
    }
  }, true); // Use capture phase
}

/**
 * rajce.idnes.cz-specific: Make images accessible for context menu
 */
if (window.location.hostname.includes('rajce.idnes.cz')) {
  console.log('🔧 ImgVault: Enabling rajce.idnes.cz image context menu');
  
  const enableRajceContextMenu = () => {
    // Remove pointer-events from wrapper divs
    const wrappers = document.querySelectorAll('#cover-image-wrapper, [data-cover-image-url-set]');
    console.log(`Found ${wrappers.length} image wrappers`);
    wrappers.forEach(wrapper => {
      wrapper.style.pointerEvents = 'auto';
      console.log('Enabled pointer events on wrapper:', wrapper.id || wrapper.className);
    });
    
    // Make all images accessible
    const allImages = document.querySelectorAll('img');
    console.log(`Total images on page: ${allImages.length}`);
    allImages.forEach(img => {
      img.style.pointerEvents = 'auto';
    });
  };
  
  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enableRajceContextMenu);
  } else {
    enableRajceContextMenu();
  }
  
  // Watch for dynamic content changes
  const observer = new MutationObserver(() => {
    enableRajceContextMenu();
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Allow contextmenu event
  document.addEventListener('contextmenu', (e) => {
    if (e.target.tagName === 'IMG' || e.target.hasAttribute('data-cover-image-url-set')) {
      console.log('Context menu on rajce image allowed');
    }
  }, true);
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getMetaContent, getHighResImageUrl };
}
