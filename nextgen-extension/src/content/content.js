/**
 * @fileoverview Content Script for ImgVault
 * @description Runs on all web pages to capture additional context
 * @version 2.0.0
 */

console.log('🚀 ImgVault content script loaded on:', window.location.href);

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
  const handler = messageHandlers[request.action];
  
  if (handler) {
    const response = handler();
    sendResponse(response);
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

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getMetaContent, getHighResImageUrl };
}
