/**
 * @fileoverview Advanced Duplicate Detection Module
 * @description Multi-layered duplicate detection using SHA-256 and perceptual hashing
 * @version 2.0.0
 * 
 * Detection Layers:
 * 1. SHA-256 hash (exact duplicates)
 * 2. Three visual hashes (visually similar):
 *    - pHash: legacy 32x32 average-threshold hash, robust-ish to compression (1024-bit, threshold: 100)
 *    - aHash: Average-based, fast & simple (64-bit, threshold: 15)
 *    - dHash: Gradient-based, detects resizing & cropping (64-bit, threshold: 20)
 * 3. Source URL + Page URL (context-based)
 */

import { URLNormalizer } from './url-normalizer.js';
import { getImageProviderLinks } from './imageProviderLinks.js';
import exifr from 'exifr';

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
 * @property {Object} [exifMetadata] - Complete EXIF metadata from exifr
 */

/**
 * @typedef {Object} DuplicateCheckResult
 * @property {boolean} isDuplicate - Whether duplicate found
 * @property {Object|null} exactMatch - First exact file match
 * @property {Object|null} visualMatch - First visual similarity match
 * @property {Object|null} contextMatch - First context match (same source + page)
 * @property {Array} allMatches - All duplicate matches found (context, exact, visual)
 * @property {Array} fastFilterMatches - Images passing pre-filter
 */

/**
 * Duplicate detection with multiple hashing algorithms
 */
export class DuplicateDetector {
  constructor() {
    /** @type {number} Hamming distance threshold for legacy pHash (1024-bit) */
    this.pHashThreshold = 100; // ~10% tolerance
    /** @type {number} Hamming distance threshold for aHash (64-bit) */
    this.aHashThreshold = 15;  // ~23% tolerance
    /** @type {number} Hamming distance threshold for dHash (64-bit) */
    this.dHashThreshold = 20;  // ~31% tolerance (more lenient)
    this.aspectRatioTolerance = 0.25;
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

  isSvgSource(blob, sourceUrl = '') {
    const blobType = String(blob?.type || '').toLowerCase();
    const url = String(sourceUrl || '').toLowerCase();
    return (
      blobType.includes('image/svg+xml') ||
      blobType.includes('svg') ||
      /^data:image\/svg\+xml/i.test(String(sourceUrl || '')) ||
      /\.svg(?:[?#]|$)/i.test(url)
    );
  }

  parseSvgLength(value) {
    if (!value) {
      return 0;
    }

    const match = String(value).trim().match(/^([0-9]+(?:\.[0-9]+)?)/);
    return match ? Number(match[1]) : 0;
  }

  extractSvgDimensions(svgText = '') {
    const tagMatch = svgText.match(/<svg\b[^>]*>/i);
    const svgTag = tagMatch?.[0] || '';
    const widthMatch = svgTag.match(/\bwidth=["']([^"']+)["']/i);
    const heightMatch = svgTag.match(/\bheight=["']([^"']+)["']/i);
    const viewBoxMatch = svgTag.match(/\bviewBox=["']([^"']+)["']/i);

    let width = this.parseSvgLength(widthMatch?.[1]);
    let height = this.parseSvgLength(heightMatch?.[1]);

    if ((!width || !height) && viewBoxMatch?.[1]) {
      const values = viewBoxMatch[1]
        .trim()
        .split(/[\s,]+/)
        .map(Number)
        .filter(Number.isFinite);

      if (values.length >= 4) {
        width = width || Math.abs(values[2]);
        height = height || Math.abs(values[3]);
      }
    }

    return {
      width: Math.round(width || 0),
      height: Math.round(height || 0)
    };
  }

  async extractSvgMetadata(blob, sourceUrl, pageUrl) {
    const [sha256, svgText] = await Promise.all([
      this.generateSHA256(blob),
      blob.text().catch(() => '')
    ]);
    const dimensions = this.extractSvgDimensions(svgText);

    return {
      sha256,
      pHash: '',
      aHash: '',
      dHash: '',
      width: dimensions.width,
      height: dimensions.height,
      fileSize: blob.size,
      sourceUrl,
      pageUrl,
      exifMetadata: {
        FileType: 'SVG',
        MIMEType: 'image/svg+xml',
        SVGWidth: dimensions.width,
        SVGHeight: dimensions.height
      }
    };
  }

  /**
   * Generate legacy pHash - 32x32 average-threshold hash.
   * This keeps the existing database field name, but it is not a true DCT pHash.
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

  isRealHttpUrl(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return false;

    try {
      const url = new URL(raw);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  getMatchKey(item = {}) {
    const providerLinks = getImageProviderLinks(item);
    const providerUrlPart = Object.keys(providerLinks)
      .sort()
      .map((key) => {
        const link = providerLinks[key] || {};
        return [key, link.url, link.displayUrl, link.directUrl, link.thumbnailUrl]
          .filter(Boolean)
          .join(',');
      })
      .filter(Boolean)
      .join('|');

    return (
      item.id ||
      item.firestoreDocumentId ||
      item.sha256 ||
      `${item.sourceImageUrl || ''}|${item.sourcePageUrl || ''}|${providerUrlPart}`
    );
  }

  getPrimaryMatchType(matchTypes = []) {
    if (matchTypes.includes('exact')) return 'exact';
    if (matchTypes.includes('context')) return 'context';
    if (matchTypes.includes('visual')) return 'visual';
    return matchTypes[0] || 'unknown';
  }

  getAspectRatio(meta = {}) {
    const width = Number(meta.width || 0);
    const height = Number(meta.height || 0);
    if (!width || !height) return null;
    return width / height;
  }

  hasCompatibleAspectRatio(newMeta = {}, existingImg = {}) {
    const newRatio = this.getAspectRatio(newMeta);
    const existingRatio = this.getAspectRatio(existingImg);
    if (!newRatio || !existingRatio) return true;
    const diff = Math.abs(newRatio - existingRatio) / Math.max(newRatio, existingRatio);
    return diff <= this.aspectRatioTolerance;
  }

  classifyVisualMatch(newMeta, existingImg, hashResults) {
    const matchCount = hashResults.matchCount || 0;
    const pHashMatched = Boolean(hashResults.details?.pHash?.match);
    const aspectCompatible = this.hasCompatibleAspectRatio(newMeta, existingImg);

    if (!aspectCompatible && matchCount < 3) {
      return { blocks: false, strength: 'possible', reason: 'Single/partial visual hash match ignored because aspect ratios differ too much' };
    }

    if (matchCount >= 3) {
      return { blocks: true, strength: 'strong', reason: 'Strong visual match (3/3 hashes)' };
    }

    if (matchCount >= 2) {
      return {
        blocks: true,
        strength: pHashMatched ? 'likely' : 'review',
        reason: pHashMatched
          ? 'Likely visual match (pHash + another hash)'
          : 'Likely visual match (2/3 hashes, review recommended)'
      };
    }

    if (matchCount === 1) {
      return { blocks: false, strength: 'possible', reason: 'Possible visual similarity (1/3 hashes)' };
    }

    return { blocks: false, strength: 'none', reason: '' };
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
   * Extract complete metadata from image blob including EXIF
   * @param {Blob} blob - Image blob
   * @param {string} sourceUrl - Source image URL
   * @param {string} pageUrl - Source page URL
   * @returns {Promise<ImageMetadata>} Complete metadata
   */
  async extractMetadata(blob, sourceUrl, pageUrl) {
    console.log('🔍 Extracting metadata with EXIF support...');

    if (this.isSvgSource(blob, sourceUrl)) {
      console.log('🧭 SVG detected, using vector metadata extraction.');
      return this.extractSvgMetadata(blob, sourceUrl, pageUrl);
    }
    
    // Extract EXIF metadata using exifr with ALL possible options enabled
    let exifMetadata = null;
    try {
      exifMetadata = await exifr.parse(blob, {
        exif: true,
        iptc: true,
        xmp: true,
        jfif: true,
        icc: true,
        tiff: true,
        skip: false,
        reviveValues: true
      });
      console.log('📸 EXIF metadata extracted:', exifMetadata ? 'YES' : 'NO');
      if (exifMetadata) {
        console.log('📊 EXIF fields found:', Object.keys(exifMetadata).length);
        console.log('📋 EXIF data sample:', Object.keys(exifMetadata).slice(0, 10));
      }
    } catch (error) {
      console.warn('⚠️ EXIF extraction failed (may be normal for some images):', error.message);
    }
    
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
      fileSize: blob.size, // Changed from 'size' to 'fileSize'
      sourceUrl,
      pageUrl,
      exifMetadata: exifMetadata || null
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
      allMatches: [],
      possibleMatches: [],
      fastFilterMatches: []
    };
    const blockingMatchesByKey = new Map();
    const possibleMatchesByKey = new Map();

    const addMatch = (img, type, reason, extras = {}, blocks = true) => {
      const key = this.getMatchKey(img);
      if (!blocks && blockingMatchesByKey.has(key)) {
        return blockingMatchesByKey.get(key);
      }

      const targetMap = blocks ? blockingMatchesByKey : possibleMatchesByKey;
      const targetList = blocks ? results.allMatches : results.possibleMatches;
      let match = targetMap.get(key);

      if (!match) {
        match = {
          ...img,
          matchTypes: [],
          matchReasons: [],
          matchType: type,
          matchReason: reason
        };
        targetMap.set(key, match);
        targetList.push(match);
      }

      if (!match.matchTypes.includes(type)) {
        match.matchTypes.push(type);
      }
      if (!match.matchReasons.includes(reason)) {
        match.matchReasons.push(reason);
      }

      Object.assign(match, extras);
      match.matchType = this.getPrimaryMatchType(match.matchTypes);
      match.matchReason = match.matchReasons.join(' + ');

      if (blocks) {
        results.isDuplicate = true;
        if (type === 'context' && !results.contextMatch) results.contextMatch = match;
        if (type === 'exact' && !results.exactMatch) results.exactMatch = match;
        if (type === 'visual' && !results.visualMatch) results.visualMatch = match;
      }

      return match;
    };

    const totalImages = existingImages.length;
    console.log('==========================================');
    console.log('🔍 STARTING DUPLICATE CHECK');
    console.log('==========================================');
    console.log('New image metadata:', {
      sourceUrl: newMetadata.sourceUrl,
      pageUrl: newMetadata.pageUrl,
      sha256: newMetadata.sha256.substring(0, 16) + '...',
      width: newMetadata.width,
      height: newMetadata.height,
      fileSize: newMetadata.fileSize
    });
    console.log(`Total existing images: ${totalImages}`);
    console.log('==========================================');

    // Phase 1: Context-based check (source URL + page URL)
    console.log('\n🔗 PHASE 1: CONTEXT CHECK');
    console.log('------------------------------------------');
    onProgress?.(`Phase 1: Checking context (0/${totalImages})...`);
    
    const normalizedSourceUrl = URLNormalizer.normalize(newMetadata.sourceUrl);
    const normalizedPageUrl = URLNormalizer.normalize(newMetadata.pageUrl);
    const hasComparableContext =
      this.isRealHttpUrl(normalizedSourceUrl) &&
      this.isRealHttpUrl(normalizedPageUrl);
    
    if (hasComparableContext) {
      for (let i = 0; i < existingImages.length; i++) {
        const img = existingImages[i];

        if (i % 10 === 0 || i === existingImages.length - 1) {
          onProgress?.(`Phase 1: Context check (${i + 1}/${totalImages})...`);
        }

        const existingSourceUrl = URLNormalizer.normalize(img.sourceImageUrl);
        const existingPageUrl = URLNormalizer.normalize(img.sourcePageUrl);

        if (
          this.isRealHttpUrl(existingSourceUrl) &&
          this.isRealHttpUrl(existingPageUrl) &&
          existingSourceUrl === normalizedSourceUrl &&
          existingPageUrl === normalizedPageUrl
        ) {
          console.log('🚨 CONTEXT MATCH FOUND!');
          addMatch(img, 'context', 'Same source URL + page URL');
        }
      }
    } else {
      console.log('Skipping context check because source/page URL is not a comparable HTTP URL.');
    }
    
    console.log(`Phase 1 Result: ${results.allMatches.filter(m => m.matchTypes.includes('context')).length} context match(es) found\n`);

    // Phase 2: SHA-256 exact match
    console.log('🔐 PHASE 2: SHA-256 HASH');
    console.log('------------------------------------------');
    onProgress?.(`Phase 2: Exact match check (0/${totalImages})...`);
    
    for (let i = 0; i < existingImages.length; i++) {
      const img = existingImages[i];
      
      // Report progress every 10 images or at key milestones
      if (i % 10 === 0 || i === existingImages.length - 1) {
        onProgress?.(`Phase 2: Exact match (${i + 1}/${totalImages})...`);
      }
      
      if (img.sha256 && newMetadata.sha256 && img.sha256 === newMetadata.sha256) {
        console.log('🚨 EXACT MATCH FOUND!');
        addMatch(img, 'exact', 'Identical file (SHA-256)');
      }
    }
    
    console.log(`Phase 2 Result: ${results.allMatches.filter(m => m.matchTypes.includes('exact')).length} exact match(es) found\n`);

    // Phase 3: Perceptual hash for visual similarity
    console.log('👁️ PHASE 3: PERCEPTUAL HASH');
    console.log('------------------------------------------');
    console.log('Thresholds:', {
      pHash: `${this.pHashThreshold}/1024 bits`,
      aHash: `${this.aHashThreshold}/64 bits`,
      dHash: `${this.dHashThreshold}/64 bits`
    });
    onProgress?.(`Phase 3: Visual similarity (0/${totalImages})...`);
    
    for (let i = 0; i < existingImages.length; i++) {
      const img = existingImages[i];
      
      // Report progress every 10 images or at key milestones
      if (i % 10 === 0 || i === existingImages.length - 1) {
        const percentage = Math.round((i + 1) / totalImages * 100);
        onProgress?.(`Phase 3: Visual check (${i + 1}/${totalImages} - ${percentage}%)...`);
      }
      
      const hashResults = this.compareHashes(newMetadata, img);
      const decision = this.classifyVisualMatch(newMetadata, img, hashResults);

      if (decision.strength !== 'none') {
        const matchCount = hashResults.matchCount;
        const avgSimilarity = hashResults.avgSimilarity.toFixed(1);
        const blocks = Boolean(decision.blocks);

        console.log(`${blocks ? '🚨' : 'ℹ️'} ${decision.strength.toUpperCase()} VISUAL MATCH (${avgSimilarity}% similar)`);

        addMatch(img, 'visual', decision.reason, {
          hashResults: hashResults.details,
          matchCount,
          similarity: avgSimilarity,
          visualStrength: decision.strength,
          aspectRatioCompatible: this.hasCompatibleAspectRatio(newMetadata, img),
        }, blocks);
      }
    }

    console.log(`Phase 3 Result: ${results.allMatches.filter(m => m.matchTypes.includes('visual')).length} blocking visual match(es) found`);
    console.log(`Phase 3 Possible Matches: ${results.possibleMatches.length}`);
    console.log('==========================================');
    console.log(`✅ SCAN COMPLETE: ${results.allMatches.length} blocking duplicate item(s), ${results.possibleMatches.length} possible visual item(s)`);
    
    if (results.isDuplicate) {
      const summary = {
        context: results.allMatches.filter(m => m.matchTypes.includes('context')).length,
        exact: results.allMatches.filter(m => m.matchTypes.includes('exact')).length,
        visual: results.allMatches.filter(m => m.matchTypes.includes('visual')).length
      };
      console.log('Match breakdown:', summary);
      onProgress?.(`✗ ${results.allMatches.length} duplicate item(s) found (${summary.context} context, ${summary.exact} exact, ${summary.visual} visual)`);
    } else {
      console.log('✅ NO DUPLICATES DETECTED\n');
      onProgress?.('✓ No duplicates found');
    }
    
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
      if (Number.isFinite(similarity)) similarities.push(similarity);
      if (match) matchCount++;
    }

    // Check aHash
    if (existingImg.aHash && newMeta.aHash) {
      const distance = this.hammingDistance(newMeta.aHash, existingImg.aHash);
      const similarity = ((64 - distance) / 64 * 100);
      const match = distance <= this.aHashThreshold;
      details.aHash = { distance, match, similarity };
      if (Number.isFinite(similarity)) similarities.push(similarity);
      if (match) matchCount++;
    }

    // Check dHash
    if (existingImg.dHash && newMeta.dHash) {
      const distance = this.hammingDistance(newMeta.dHash, existingImg.dHash);
      const similarity = ((64 - distance) / 64 * 100);
      const match = distance <= this.dHashThreshold;
      details.dHash = { distance, match, similarity };
      if (Number.isFinite(similarity)) similarities.push(similarity);
      if (match) matchCount++;
    }

    const avgSimilarity = similarities.length > 0
      ? similarities.reduce((a, b) => a + b, 0) / similarities.length
      : 0;

    return { matchCount, avgSimilarity, details };
  }
}
