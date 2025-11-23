// Duplicate Detection Module
// Implements multi-layered duplicate detection:
// 1. SHA-256 hash (exact duplicates)
// 2. Three perceptual hashes (visually similar - requires 2/3 match):
//    - pHash: DCT-based, robust to compression & minor edits (32x32, threshold: 50)
//    - aHash: Average-based, fast & simple (8x8, threshold: 5)
//    - dHash: Gradient-based, detects resizing & cropping (8x8, threshold: 5)
// 3. Dimensions + file size (fast pre-filter)
// 4. Source URL + Page URL (context-based)

class DuplicateDetector {
  constructor() {
    // Hamming distance thresholds for perceptual hashes
    // Adjusted for optimal duplicate detection
    this.pHashThreshold = 100; // ~10% tolerance for 1024-bit hash
    this.aHashThreshold = 15;  // ~23% tolerance for 64-bit hash
    this.dHashThreshold = 20;  // ~31% tolerance for 64-bit hash (more lenient)
  }

  // Generate SHA-256 hash from image blob
  async generateSHA256(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Generate perceptual hash (pHash) for near-duplicate detection
  async generatePHash(blob) {
    try {
      // Create an ImageBitmap from the blob (works in service workers)
      const imageBitmap = await createImageBitmap(blob);
      
      // Create canvas and resize to 32x32 grayscale
      const canvas = new OffscreenCanvas(32, 32);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imageBitmap, 0, 0, 32, 32);
      
      const imageData = ctx.getImageData(0, 0, 32, 32);
      const grayscale = [];
      
      // Convert to grayscale
      for (let i = 0; i < imageData.data.length; i += 4) {
        const gray = Math.round(
          0.299 * imageData.data[i] + 
          0.587 * imageData.data[i + 1] + 
          0.114 * imageData.data[i + 2]
        );
        grayscale.push(gray);
      }
      
      // Calculate average
      const avg = grayscale.reduce((a, b) => a + b, 0) / grayscale.length;
      
      // Generate hash: 1 if pixel > average, 0 otherwise
      const hash = grayscale.map(val => val > avg ? '1' : '0').join('');
      
      imageBitmap.close();
      return hash;
    } catch (error) {
      console.error('pHash generation error:', error);
      throw error;
    }
  }

  // Generate average hash (aHash) - Simple and fast
  async generateAHash(blob) {
    try {
      const imageBitmap = await createImageBitmap(blob);
      
      // Resize to 8x8 grayscale
      const canvas = new OffscreenCanvas(8, 8);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imageBitmap, 0, 0, 8, 8);
      
      const imageData = ctx.getImageData(0, 0, 8, 8);
      const grayscale = [];
      
      // Convert to grayscale
      for (let i = 0; i < imageData.data.length; i += 4) {
        const gray = Math.round(
          0.299 * imageData.data[i] + 
          0.587 * imageData.data[i + 1] + 
          0.114 * imageData.data[i + 2]
        );
        grayscale.push(gray);
      }
      
      // Calculate average
      const avg = grayscale.reduce((a, b) => a + b, 0) / grayscale.length;
      
      // Generate hash: 1 if pixel > average, 0 otherwise
      const hash = grayscale.map(val => val > avg ? '1' : '0').join('');
      
      imageBitmap.close();
      return hash;
    } catch (error) {
      console.error('aHash generation error:', error);
      throw error;
    }
  }

  // Generate difference hash (dHash) - Gradient-based
  async generateDHash(blob) {
    try {
      const imageBitmap = await createImageBitmap(blob);
      
      // Resize to 9x8 (we need 9 columns to compare 8 gradients per row)
      const canvas = new OffscreenCanvas(9, 8);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imageBitmap, 0, 0, 9, 8);
      
      const imageData = ctx.getImageData(0, 0, 9, 8);
      const grayscale = [];
      
      // Convert to grayscale
      for (let i = 0; i < imageData.data.length; i += 4) {
        const gray = Math.round(
          0.299 * imageData.data[i] + 
          0.587 * imageData.data[i + 1] + 
          0.114 * imageData.data[i + 2]
        );
        grayscale.push(gray);
      }
      
      // Generate hash based on horizontal gradients
      let hash = '';
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const idx = row * 9 + col;
          // Compare each pixel with its right neighbor
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

  // Generate color histogram (RGB distribution)
  async generateColorHistogram(blob) {
    try {
      const imageBitmap = await createImageBitmap(blob);
      
      // Resize to 32x32 for faster processing
      const canvas = new OffscreenCanvas(32, 32);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imageBitmap, 0, 0, 32, 32);
      
      const imageData = ctx.getImageData(0, 0, 32, 32);
      const data = imageData.data;
      
      // Create histogram with 16 bins per channel (16x16x16 = 4096 colors)
      const bins = 16;
      const histogram = new Array(bins * bins * bins).fill(0);
      
      for (let i = 0; i < data.length; i += 4) {
        const r = Math.floor(data[i] / 256 * bins);
        const g = Math.floor(data[i + 1] / 256 * bins);
        const b = Math.floor(data[i + 2] / 256 * bins);
        const idx = r * bins * bins + g * bins + b;
        histogram[idx]++;
      }
      
      // Normalize histogram
      const total = 32 * 32;
      const normalized = histogram.map(count => count / total);
      
      imageBitmap.close();
      return normalized;
    } catch (error) {
      console.error('Color histogram generation error:', error);
      throw error;
    }
  }

  // Compare color histograms using correlation
  compareColorHistograms(hist1, hist2) {
    if (!hist1 || !hist2 || hist1.length !== hist2.length) return 0;
    
    // Calculate means
    const mean1 = hist1.reduce((a, b) => a + b, 0) / hist1.length;
    const mean2 = hist2.reduce((a, b) => a + b, 0) / hist2.length;
    
    // Calculate correlation coefficient
    let numerator = 0;
    let denom1 = 0;
    let denom2 = 0;
    
    for (let i = 0; i < hist1.length; i++) {
      const diff1 = hist1[i] - mean1;
      const diff2 = hist2[i] - mean2;
      numerator += diff1 * diff2;
      denom1 += diff1 * diff1;
      denom2 += diff2 * diff2;
    }
    
    if (denom1 === 0 || denom2 === 0) return 0;
    return numerator / Math.sqrt(denom1 * denom2);
  }

  // Calculate Hamming distance between two binary strings
  hammingDistance(hash1, hash2) {
    if (hash1.length !== hash2.length) return Infinity;
    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] !== hash2[i]) distance++;
    }
    return distance;
  }

  // Get image dimensions
  async getImageDimensions(blob) {
    try {
      const imageBitmap = await createImageBitmap(blob);
      const dimensions = { width: imageBitmap.width, height: imageBitmap.height };
      imageBitmap.close();
      return dimensions;
    } catch (error) {
      console.error('Dimension extraction error:', error);
      throw error;
    }
  }

  // Extract metadata from image blob
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

  // Check for duplicates against existing images
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
    console.log(`Total existing images in database: ${existingImages.length}`);
    console.log('==========================================');

    // Phase 1: Fast pre-filter - DISABLED (was causing false negatives)
    // Rely entirely on perceptual hashes for accurate duplicate detection
    console.log('\n📏 PHASE 1: PRE-FILTER');
    console.log('------------------------------------------');
    console.log('✅ Pre-filter disabled - checking all images with perceptual hashes');
    console.log('This ensures resized/recompressed duplicates are caught');
    console.log('------------------------------------------\n');
    
    onProgress && onProgress('Phase 1: Preparing to check all images...');
    
    // Pass all images to hash checking
    const fastFilterMatches = existingImages;
    results.fastFilterMatches = fastFilterMatches;

    // Phase 2: Context-based check (source URL + page URL)
    console.log('🔗 PHASE 2: CONTEXT CHECK (Source URL + Page URL)');
    console.log('------------------------------------------');
    onProgress && onProgress('Phase 2: Checking source URL and page URL...');
    
    const normalizedSourceUrl = URLNormalizer.normalize(newMetadata.sourceUrl);
    const normalizedPageUrl = URLNormalizer.normalize(newMetadata.pageUrl);
    
    console.log('New image context:', {
      sourceUrl: newMetadata.sourceUrl,
      normalizedSourceUrl,
      pageUrl: newMetadata.pageUrl,
      normalizedPageUrl
    });
    
    let contextCheckCount = 0;
    for (let i = 0; i < existingImages.length; i++) {
      const img = existingImages[i];
      const existingNormalizedSourceUrl = URLNormalizer.normalize(img.source_image_url);
      const existingNormalizedPageUrl = URLNormalizer.normalize(img.source_page_url);
      
      const sourceMatch = existingNormalizedSourceUrl === normalizedSourceUrl;
      const pageMatch = existingNormalizedPageUrl === normalizedPageUrl;
      const bothMatch = sourceMatch && pageMatch;
      
      contextCheckCount++;
      console.log(`Checking image ${contextCheckCount}/${existingImages.length}:`, {
        id: img.id?.substring(0, 8) + '...',
        sourceUrlMatch: sourceMatch ? '✅' : '❌',
        pageUrlMatch: pageMatch ? '✅' : '❌',
        DUPLICATE: bothMatch ? '🚨 YES' : 'No'
      });
      
      if (bothMatch) {
        console.log('------------------------------------------');
        console.log('🚨 DUPLICATE FOUND IN PHASE 2!');
        console.log('Same source URL + page URL detected');
        console.log('------------------------------------------');
        console.log('==========================================\n');
        results.isDuplicate = true;
        results.contextMatch = img;
        onProgress && onProgress('✗ Duplicate found (same context)');
        return results;
      }
    }
    
    console.log('------------------------------------------');
    console.log('Phase 2 Result: No context matches found');
    console.log('------------------------------------------');
    console.log('✅ Passed Phase 2 - CONTINUING TO PHASE 3\n');

    // Phase 3: SHA-256 exact match
    console.log('🔐 PHASE 3: SHA-256 HASH (Exact File Match)');
    console.log('------------------------------------------');
    onProgress && onProgress('Phase 3: Calculating SHA-256 hash...');
    console.log(`New image SHA-256: ${newMetadata.sha256}`);
    
    let sha256CheckCount = 0;
    for (const img of existingImages) {
      sha256CheckCount++;
      const match = img.sha256 === newMetadata.sha256;
      console.log(`Checking image ${sha256CheckCount}/${existingImages.length}:`, {
        id: img.id?.substring(0, 8) + '...',
        existingSHA256: img.sha256?.substring(0, 16) + '...',
        MATCH: match ? '🚨 YES' : 'No'
      });
      
      if (match) {
        console.log('------------------------------------------');
        console.log('🚨 DUPLICATE FOUND IN PHASE 3!');
        console.log('Exact same file detected (SHA-256 match)');
        console.log('------------------------------------------');
        console.log('==========================================\n');
        results.isDuplicate = true;
        results.exactMatch = img;
        onProgress && onProgress('✗ Duplicate found (exact match)');
        return results;
      }
    }
    
    console.log('------------------------------------------');
    console.log('Phase 3 Result: No SHA-256 matches found');
    console.log('------------------------------------------');
    console.log('✅ Passed Phase 3 - CONTINUING TO PHASE 4\n');

    // Phase 4: Perceptual hash for visual similarity
    // Check all three perceptual hashes: pHash, aHash, dHash
    // Treat as duplicate if at least 2 out of 3 match
    console.log('👁️ PHASE 4: PERCEPTUAL HASH (Visual Similarity)');
    console.log('------------------------------------------');
    console.log(`Checking ${fastFilterMatches.length} image(s) that passed Phase 1`);
    console.log('Thresholds:', {
      pHash: `${this.pHashThreshold}/1024 bits (~${(this.pHashThreshold/1024*100).toFixed(1)}%)`,
      aHash: `${this.aHashThreshold}/64 bits (~${(this.aHashThreshold/64*100).toFixed(1)}%)`,
      dHash: `${this.dHashThreshold}/64 bits (~${(this.dHashThreshold/64*100).toFixed(1)}%)`
    });
    console.log('Need 2/3 hashes to match for duplicate detection');
    console.log('------------------------------------------');
    onProgress && onProgress('Phase 4: Analyzing visual similarity...');
    
    let phaseCheckCount = 0;
    for (const img of fastFilterMatches) {
      phaseCheckCount++;
      let matchCount = 0;
      const hashResults = {
        pHash: { distance: Infinity, match: false, similarity: 0 },
        aHash: { distance: Infinity, match: false, similarity: 0 },
        dHash: { distance: Infinity, match: false, similarity: 0 }
      };
      
      console.log(`\nChecking image ${phaseCheckCount}/${fastFilterMatches.length}:`, {
        id: img.id?.substring(0, 8) + '...'
      });
      
      console.log('  Hash availability:', {
        pHash: img.pHash ? '✅' : '❌ MISSING',
        aHash: img.aHash ? '✅' : '❌ MISSING',
        dHash: img.dHash ? '✅' : '❌ MISSING'
      });
      
      // Check pHash (32x32 = 1024 bits, threshold: 100)
      if (img.pHash && newMetadata.pHash) {
        const distance = this.hammingDistance(newMetadata.pHash, img.pHash);
        const totalBits = newMetadata.pHash.length;
        const similarity = ((totalBits - distance) / totalBits * 100);
        const match = distance <= this.pHashThreshold;
        hashResults.pHash = { distance, match, similarity };
        if (match) matchCount++;
        console.log(`  pHash: ${distance}/${totalBits} bits different, ${similarity.toFixed(1)}% similar, threshold=${this.pHashThreshold} → ${match ? '✅ MATCH' : '❌ no match'}`);
      } else {
        console.log(`  pHash: ⚠️  SKIPPED (missing)`);
      }
      
      // Check aHash (8x8 = 64 bits, threshold: 15)
      if (img.aHash && newMetadata.aHash) {
        const distance = this.hammingDistance(newMetadata.aHash, img.aHash);
        const totalBits = newMetadata.aHash.length;
        const similarity = ((totalBits - distance) / totalBits * 100);
        const match = distance <= this.aHashThreshold;
        hashResults.aHash = { distance, match, similarity };
        if (match) matchCount++;
        console.log(`  aHash: ${distance}/${totalBits} bits different, ${similarity.toFixed(1)}% similar, threshold=${this.aHashThreshold} → ${match ? '✅ MATCH' : '❌ no match'}`);
      } else {
        console.log(`  aHash: ⚠️  SKIPPED (missing)`);
      }
      
      // Check dHash (8x8 = 64 bits, threshold: 20)
      if (img.dHash && newMetadata.dHash) {
        const distance = this.hammingDistance(newMetadata.dHash, img.dHash);
        const totalBits = newMetadata.dHash.length;
        const similarity = ((totalBits - distance) / totalBits * 100);
        const match = distance <= this.dHashThreshold;
        hashResults.dHash = { distance, match, similarity };
        if (match) matchCount++;
        console.log(`  dHash: ${distance}/${totalBits} bits different, ${similarity.toFixed(1)}% similar, threshold=${this.dHashThreshold} → ${match ? '✅ MATCH' : '❌ no match'}`);
      } else {
        console.log(`  dHash: ⚠️  SKIPPED (missing)`);
      }
      
      const isDuplicate = matchCount >= 2;
      console.log(`  SUMMARY: ${matchCount}/3 hashes matched → ${isDuplicate ? '🚨 DUPLICATE!' : 'Not a duplicate'}`);
      
      // If at least 2 out of 3 hashes match, it's a duplicate
      if (isDuplicate) {
        const avgSimilarity = (
          (hashResults.pHash.similarity + hashResults.aHash.similarity + hashResults.dHash.similarity) / 3
        ).toFixed(1);
        
        console.log('------------------------------------------');
        console.log('🚨 DUPLICATE FOUND IN PHASE 4!');
        console.log(`Visually similar image detected (${avgSimilarity}% average similarity)`);
        console.log('Matching hashes:', {
          pHash: hashResults.pHash.match ? '✅' : '❌',
          aHash: hashResults.aHash.match ? '✅' : '❌',
          dHash: hashResults.dHash.match ? '✅' : '❌'
        });
        console.log('------------------------------------------');
        console.log('==========================================\n');
        
        results.isDuplicate = true;
        results.visualMatch = { 
          ...img, 
          hashResults,
          matchCount,
          similarity: avgSimilarity
        };
        onProgress && onProgress(`✗ Duplicate found (${avgSimilarity}% similar, ${matchCount}/3 matched)`);
        return results;
      }
    }

    console.log('------------------------------------------');
    console.log('Phase 4 Result: No perceptual hash matches found');
    console.log('------------------------------------------');
    console.log('✅ Passed all phases - NO DUPLICATES DETECTED');
    console.log('==========================================\n');
    onProgress && onProgress('✓ No duplicates found');
    return results;
  }
}

// Export for use in background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DuplicateDetector;
}
