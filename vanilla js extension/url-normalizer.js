// URL Normalizer for Duplicate Detection
// Handles CDN URLs with dynamic query parameters

class URLNormalizer {
  // Normalize CDN URLs by removing dynamic query parameters
  static normalize(url) {
    if (!url) return url;
    
    try {
      const urlObj = new URL(url);
      
      // For Facebook CDN URLs, keep only essential parameters
      if (urlObj.hostname.includes('fbcdn.net')) {
        const essentialParams = ['fbid', 'set', 'id'];
        const newParams = new URLSearchParams();
        
        for (const [key, value] of urlObj.searchParams) {
          if (essentialParams.includes(key)) {
            newParams.set(key, value);
          }
        }
        
        // Return URL without dynamic session parameters
        return `${urlObj.origin}${urlObj.pathname}`;
      }
      
      // For other CDN URLs (imgur, etc.), remove all query params
      if (this.isCDN(urlObj.hostname)) {
        return `${urlObj.origin}${urlObj.pathname}`;
      }
      
      // For regular URLs, keep as is
      return url;
    } catch (e) {
      // If URL parsing fails, return original
      return url;
    }
  }
  
  // Check if hostname is a known CDN
  static isCDN(hostname) {
    const cdnPatterns = [
      'fbcdn.net',
      'imgur.com',
      'i.imgur.com',
      'cloudfront.net',
      'akamaihd.net',
      'gstatic.com',
      'googleusercontent.com',
      'wp.com',
      'amazonaws.com'
    ];
    
    return cdnPatterns.some(pattern => hostname.includes(pattern));
  }
}

// Export for use in service worker
if (typeof module !== 'undefined' && module.exports) {
  module.exports = URLNormalizer;
}
