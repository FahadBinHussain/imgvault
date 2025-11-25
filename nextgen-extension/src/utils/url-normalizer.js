/**
 * @fileoverview URL Normalizer for Duplicate Detection
 * @description Handles CDN URLs with dynamic query parameters
 * @version 2.0.0
 */

/**
 * URL normalization utilities for consistent duplicate detection
 */
export class URLNormalizer {
  /**
   * CDN hostnames that require special handling
   * @private
   * @type {string[]}
   */
  static CDN_PATTERNS = [
    'fbcdn.net',
    'imgur.com',
    'i.imgur.com',
    'cloudfront.net',
    'akamaihd.net',
    'gstatic.com',
    'googleusercontent.com',
    'wp.com',
    'amazonaws.com',
    'cloudinary.com',
    'imgix.net'
  ];

  /**
   * Essential parameters to preserve for Facebook CDN
   * @private
   * @type {string[]}
   */
  static FACEBOOK_ESSENTIAL_PARAMS = ['fbid', 'set', 'id'];

  /**
   * Normalize CDN URLs by removing dynamic query parameters
   * @param {string} url - URL to normalize
   * @returns {string} Normalized URL
   */
  static normalize(url) {
    if (!url) return url;
    
    try {
      const urlObj = new URL(url);
      
      // For Facebook CDN URLs, keep only essential parameters
      if (urlObj.hostname.includes('fbcdn.net')) {
        return this.normalizeFacebookCDN(urlObj);
      }
      
      // For other CDN URLs, remove all query params
      if (this.isCDN(urlObj.hostname)) {
        return `${urlObj.origin}${urlObj.pathname}`;
      }
      
      // For regular URLs, keep as is
      return url;
    } catch (error) {
      // If URL parsing fails, return original
      console.warn('URL normalization failed:', error);
      return url;
    }
  }

  /**
   * Normalize Facebook CDN URL
   * @private
   * @param {URL} urlObj - URL object
   * @returns {string} Normalized URL
   */
  static normalizeFacebookCDN(urlObj) {
    const newParams = new URLSearchParams();
    
    for (const [key, value] of urlObj.searchParams) {
      if (this.FACEBOOK_ESSENTIAL_PARAMS.includes(key)) {
        newParams.set(key, value);
      }
    }
    
    // Return URL without dynamic session parameters
    return `${urlObj.origin}${urlObj.pathname}`;
  }

  /**
   * Check if hostname is a known CDN
   * @param {string} hostname - Hostname to check
   * @returns {boolean} True if CDN
   */
  static isCDN(hostname) {
    return this.CDN_PATTERNS.some(pattern => hostname.includes(pattern));
  }

  /**
   * Compare two URLs for equality after normalization
   * @param {string} url1 - First URL
   * @param {string} url2 - Second URL
   * @returns {boolean} True if URLs are equivalent
   */
  static areEqual(url1, url2) {
    return this.normalize(url1) === this.normalize(url2);
  }
}
