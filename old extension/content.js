// Content script for ImgVault
// This script runs on all web pages and helps capture additional context

// Listen for messages from the background script if needed
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPageInfo') {
    const pageInfo = {
      title: document.title,
      url: window.location.href,
      description: getMetaContent('description'),
      keywords: getMetaContent('keywords')
    };
    sendResponse(pageInfo);
  }
  return true;
});

// Utility function to get meta tag content
function getMetaContent(name) {
  const meta = document.querySelector(`meta[name="${name}"]`) || 
                document.querySelector(`meta[property="og:${name}"]`);
  return meta ? meta.getAttribute('content') : '';
}

// Helper to capture full resolution image URL if available
function getHighResImageUrl(imgElement) {
  // Check for common high-res image attributes
  const highResSources = [
    imgElement.getAttribute('data-src'),
    imgElement.getAttribute('data-original'),
    imgElement.getAttribute('data-full'),
    imgElement.src
  ];
  
  return highResSources.find(src => src && src.length > 0) || imgElement.src;
}
