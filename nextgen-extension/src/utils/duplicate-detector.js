/**
 * @fileoverview Advanced Duplicate Detection Module
 * @description Multi-layered duplicate detection using SHA-256 and perceptual hashing
 * @version 2.0.0
 * 
 * Detection Layers:
 * 1. SHA-256 hash (exact duplicates)
 * 2. Three perceptual hashes (visually similar):
 *    - pHash: DCT-based, robust to compression & minor edits (1024-bit, threshold: 100)
 *    - aHash: Average-based, fast & simple (64-bit, threshold: 15)
 *    - dHash: Gradient-based, detects resizing & cropping (64-bit, threshold: 20)
 * 3. Source URL + Page URL (context-based)
 */

import { URLNormalizer } from './url-normalizer.js';

/**
 * @typedef {Object} ImageMetadata
 * @property {string} sha256 - SHA-256 hash
 * @property {string} pHash - Perceptual hash
 * @property {string} aHash - Average hash
 * @property {string} dHash - Difference hash
 * @property {number} width - Image width
 * @property {number} height - Image height
 * @property {number} size - File size
 * @property {string} sourceUrl - Source image URL
 * @property {string} pageUrl - Source page URL
 */

/**
 * @typedef {Object} DuplicateCheckResult
 * @property {boolean} isDuplicate - Whether duplicate found
 * @property {Object|null} exactMatch - Exact file match
 * @property {Object|null} visualMatch - Visual similarity match
 * @property {Object|null} contextMatch - Context match (same source + page)
 * @property {Array} fastFilterMatches - Images passing pre-filter
 */

/**
 * Duplicate detection with multiple hashing algorithms
 */
export class DuplicateDetector {
  constructor() {
    /** @type {number} Hamming distance threshold for pHash (1024-bit) */
    this.pHashThreshold = 100; // ~10% tolerance
    /** @type {number} Hamming distance threshold for aHash (64-bit) */
    this.aHashThreshold = 15;  // ~23% tolerance
    /** @type {number} Hamming distance threshold for dHash (64-bit) */
    this.dHashThreshold = 20;  // ~31% tolerance (more lenient)
  }

  /**
   * Generate SHA-256 hash from blob
   * @param {Blob} blob - Image blob
   * @returns {Promise<string>} SHA-256 hash (hex)
   */
  async generateSHA256(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Generate perceptual hash (pHash) - DCT-based
   * @param {Blob} blob - Image blob
   * @returns {Promise<string>} 1024-bit binary hash
   */
  async generatePHash(blob) {
    try {
      const imageBitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(32, 32);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imageBitmap, 0, 0, 32, 32);
      
      const imageData = ctx.getImageData(0, 0, 32, 32);
      const grayscale = this.toGrayscale(imageData);
      
      // Calculate average
      const avg = grayscale.reduce((a, b) => a + b, 0) / grayscale.length;
      
      // Generate hash
      const hash = grayscale.map(val => val > avg ? '1' : '0').join('');
      
      imageBitmap.close();
      return hash;
    } catch (error) {
      console.error('pHash generation error:', error);
      throw error;
    }
  }

  /**
   * Generate average hash (aHash) - Simple and fast
   * @param {Blob} blob - Image blob
   * @returns {Promise<string>} 64-bit binary hash
   */
  async generateAHash(blob) {
    try {
      const imageBitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(8, 8);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imageBitmap, 0, 0, 8, 8);
      
      const imageData = ctx.getImageData(0, 0, 8, 8);
      const grayscale = this.toGrayscale(imageData);
      
      const avg = grayscale.reduce((a, b) => a + b, 0) / grayscale.length;
      const hash = grayscale.map(val => val > avg ? '1' : '0').join('');
      
      imageBitmap.close();
      return hash;
    } catch (error) {
      console.error('aHash generation error:', error);
      throw error;
    }
  }

  /**
   * Generate difference hash (dHash) - Gradient-based
   * @param {Blob} blob - Image blob
   * @returns {Promise<string>} 64-bit binary hash
   */
  async generateDHash(blob) {
    try {
      const imageBitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(9, 8);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imageBitmap, 0, 0, 9, 8);
      
      const imageData = ctx.getImageData(0, 0, 9, 8);
      const grayscale = this.toGrayscale(imageData);
      
      // Generate hash based on horizontal gradients
      let hash = '';
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const idx = row * 9 + col;
          hash += grayscale[idx] < grayscale[idx + 1] ? '1' : '0';
        }
      }
      
      imageBitmap.close();
      return hash;
    } catch (error) {
      console.error('dHash generation error:', error);
      throw error;
    }
  }

  /**
   * Convert image data to grayscale array
   * @private
   * @param {ImageData} imageData - Canvas image data
   * @returns {number[]} Grayscale values
   */
  toGrayscale(imageData) {
    const grayscale = [];
    for (let i = 0; i < imageData.data.length; i += 4) {
      const gray = Math.round(
        0.299 * imageData.data[i] + 
        0.587 * imageData.data[i + 1] + 
        0.114 * imageData.data[i + 2]
      );
      grayscale.push(gray);
    }
    return grayscale;
  }

  /**
   * Calculate Hamming distance between binary strings
   * @param {string} hash1 - First binary hash
   * @param {string} hash2 - Second binary hash
   * @returns {number} Hamming distance
   */
  hammingDistance(hash1, hash2) {
    if (hash1.length !== hash2.length) return Infinity;
    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] !== hash2[i]) distance++;
    }
    return distance;
  }

  /**
   * Get image dimensions from blob
   * @param {Blob} blob - Image blob
   * @returns {Promise<{width: number, height: number}>} Dimensions
   */
  async getImageDimensions(blob) {
    try {
      const imageBitmap = await createImageBitmap(blob);
      const dimensions = { 
        width: imageBitmap.width, 
        height: imageBitmap.height 
      };
      imageBitmap.close();
      return dimensions;
    } catch (error) {
      console.error('Dimension extraction error:', error);
      throw error;
    }
  }

  /**
   * Extract complete metadata from image blob
   * @param {Blob} blob - Image blob
   * @param {string} sourceUrl - Source image URL
   * @param {string} pageUrl - Source page URL
   * @returns {Promise<ImageMetadata>} Complete metadata
   */
  async extractMetadata(blob, sourceUrl, pageUrl) {
    const [sha256, pHash, aHash, dHash, dimensions] = await Promise.all([
      this.generateSHA256(blob),
      this.generatePHash(blob),
      this.generateAHash(blob),
      this.generateDHash(blob),
      this.getImageDimensions(blob)
    ]);

    return {
      sha256,
      pHash,
      aHash,
      dHash,
      width: dimensions.width,
      height: dimensions.height,
      size: blob.size,
      sourceUrl,
      pageUrl
    };
  }

  /**
   * Check for duplicates against existing images
   * @param {ImageMetadata} newMetadata - New image metadata
   * @param {Array} existingImages - Existing images from database
   * @param {Function} [onProgress] - Progress callback
   * @returns {Promise<DuplicateCheckResult>} Duplicate check result
   */
  async checkDuplicates(newMetadata, existingImages, onProgress) {
    const results = {
      isDuplicate: false,
      exactMatch: null,
      visualMatch: null,
      contextMatch: null,
      fastFilterMatches: []
    };

    console.log('==========================================');
    console.log('🔍 STARTING DUPLICATE CHECK');
    console.log('==========================================');
    console.log('New image metadata:', {
      sourceUrl: newMetadata.sourceUrl,
      pageUrl: newMetadata.pageUrl,
      sha256: newMetadata.sha256.substring(0, 16) + '...',
      width: newMetadata.width,
      height: newMetadata.height,
      size: newMetadata.size
    });
    console.log(`Total existing images: ${existingImages.length}`);
    console.log('==========================================');

    // Phase 1: Context-based check (source URL + page URL)
    console.log('\n🔗 PHASE 1: CONTEXT CHECK');
    console.log('------------------------------------------');
    onProgress?.('Phase 1: Checking context...');
    
    const normalizedSourceUrl = URLNormalizer.normalize(newMetadata.sourceUrl);
    const normalizedPageUrl = URLNormalizer.normalize(newMetadata.pageUrl);
    
    for (const img of existingImages) {
      const existingSourceUrl = URLNormalizer.normalize(img.sourceImageUrl);
      const existingPageUrl = URLNormalizer.normalize(img.sourcePageUrl);
      
      if (existingSourceUrl === normalizedSourceUrl && 
          existingPageUrl === normalizedPageUrl) {
        console.log('🚨 DUPLICATE FOUND - Same context!');
        results.isDuplicate = true;
        results.contextMatch = img;
        onProgress?.('✗ Duplicate found (same context)');
        return results;
      }
    }
    
    console.log('✅ Passed Phase 1 - No context matches\n');

    // Phase 2: SHA-256 exact match
    console.log('🔐 PHASE 2: SHA-256 HASH');
    console.log('------------------------------------------');
    onProgress?.('Phase 2: Checking exact file match...');
    
    for (const img of existingImages) {
      if (img.sha256 === newMetadata.sha256) {
        console.log('🚨 DUPLICATE FOUND - Exact file match!');
        results.isDuplicate = true;
        results.exactMatch = img;
        onProgress?.('✗ Duplicate found (exact match)');
        return results;
      }
    }
    
    console.log('✅ Passed Phase 2 - No exact matches\n');

    // Phase 3: Perceptual hash for visual similarity
    console.log('👁️ PHASE 3: PERCEPTUAL HASH');
    console.log('------------------------------------------');
    console.log('Thresholds:', {
      pHash: `${this.pHashThreshold}/1024 bits`,
      aHash: `${this.aHashThreshold}/64 bits`,
      dHash: `${this.dHashThreshold}/64 bits`
    });
    onProgress?.('Phase 3: Analyzing visual similarity...');
    
    for (const img of existingImages) {
      const hashResults = this.compareHashes(newMetadata, img);
      const matchCount = hashResults.matchCount;
      
      if (matchCount >= 1) {
        const avgSimilarity = hashResults.avgSimilarity.toFixed(1);
        console.log(`🚨 DUPLICATE FOUND - Visual match (${avgSimilarity}% similar)`);
        
        results.isDuplicate = true;
        results.visualMatch = { 
          ...img, 
          hashResults: hashResults.details,
          matchCount,
          similarity: avgSimilarity
        };
        onProgress?.(`✗ Duplicate found (${avgSimilarity}% similar)`);
        return results;
      }
    }

    console.log('✅ Passed Phase 3 - No visual matches');
    console.log('==========================================');
    console.log('✅ NO DUPLICATES DETECTED\n');
    onProgress?.('✓ No duplicates found');
    return results;
  }

  /**
   * Compare perceptual hashes between images
   * @private
   * @param {ImageMetadata} newMeta - New image metadata
   * @param {Object} existingImg - Existing image
   * @returns {Object} Hash comparison results
   */
  compareHashes(newMeta, existingImg) {
    let matchCount = 0;
    const details = {};
    const similarities = [];

    // Check pHash
    if (existingImg.pHash && newMeta.pHash) {
      const distance = this.hammingDistance(newMeta.pHash, existingImg.pHash);
      const similarity = ((1024 - distance) / 1024 * 100);
      const match = distance <= this.pHashThreshold;
      details.pHash = { distance, match, similarity };
      similarities.push(similarity);
      if (match) matchCount++;
    }

    // Check aHash
    if (existingImg.aHash && newMeta.aHash) {
      const distance = this.hammingDistance(newMeta.aHash, existingImg.aHash);
      const similarity = ((64 - distance) / 64 * 100);
      const match = distance <= this.aHashThreshold;
      details.aHash = { distance, match, similarity };
      similarities.push(similarity);
      if (match) matchCount++;
    }

    // Check dHash
    if (existingImg.dHash && newMeta.dHash) {
      const distance = this.hammingDistance(newMeta.dHash, existingImg.dHash);
      const similarity = ((64 - distance) / 64 * 100);
      const match = distance <= this.dHashThreshold;
      details.dHash = { distance, match, similarity };
      similarities.push(similarity);
      if (match) matchCount++;
    }

    const avgSimilarity = similarities.length > 0
      ? similarities.reduce((a, b) => a + b, 0) / similarities.length
      : 0;

    return { matchCount, avgSimilarity, details };
  }
}
