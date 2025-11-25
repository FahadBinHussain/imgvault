/**
 * @fileoverview Content Script for ImgVault
 * @description Runs on all web pages to capture additional context
 * @version 2.0.0
 */

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

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getMetaContent, getHighResImageUrl };
}
