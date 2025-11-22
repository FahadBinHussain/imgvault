// Duplicate Detection Module
// Implements multi-layered duplicate detection:
// 1. SHA-256 hash (exact duplicates)
// 2. pHash perceptual hash (visually similar)
// 3. Dimensions + file size (fast pre-filter)
// 4. Source URL + Page URL (context-based)

class DuplicateDetector {
  constructor() {
    this.pHashThreshold = 5; // Hamming distance threshold for similarity
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
    const [sha256, pHash, dimensions] = await Promise.all([
      this.generateSHA256(blob),
      this.generatePHash(blob),
      this.getImageDimensions(blob)
    ]);

    return {
      sha256,
      pHash,
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

    console.log('Starting duplicate check with metadata:', {
      sourceUrl: newMetadata.sourceUrl,
      pageUrl: newMetadata.pageUrl,
      sha256: newMetadata.sha256.substring(0, 16) + '...',
      width: newMetadata.width,
      height: newMetadata.height,
      size: newMetadata.size
    });

    // Phase 1: Fast pre-filter (dimensions + file size)
    onProgress && onProgress('Checking dimensions and file size...');
    const fastFilterMatches = existingImages.filter(img => {
      const widthMatch = Math.abs(img.width - newMetadata.width) <= 10;
      const heightMatch = Math.abs(img.height - newMetadata.height) <= 10;
      const sizeMatch = Math.abs((img.file_size || img.size) - newMetadata.size) <= 1024; // 1KB tolerance
      
      console.log(`Comparing with existing image:`, {
        existingWidth: img.width,
        newWidth: newMetadata.width,
        widthMatch,
        existingHeight: img.height,
        newHeight: newMetadata.height,
        heightMatch,
        existingSize: img.file_size || img.size,
        newSize: newMetadata.size,
        sizeMatch
      });
      
      return widthMatch && heightMatch && sizeMatch;
    });
    results.fastFilterMatches = fastFilterMatches;

    console.log(`Fast filter: ${fastFilterMatches.length} matches out of ${existingImages.length} images`);

    if (fastFilterMatches.length === 0) {
      onProgress && onProgress('No size/dimension matches found');
      return results;
    }

    onProgress && onProgress(`Found ${fastFilterMatches.length} potential matches, checking hashes...`);

    // Phase 2: Context-based check (source URL + page URL)
    onProgress && onProgress('Checking source URL and page URL...');
    
    console.log('Checking context match...');
    for (let i = 0; i < existingImages.length; i++) {
      const img = existingImages[i];
      console.log(`Image ${i}: sourceUrl match = ${img.source_image_url === newMetadata.sourceUrl}, pageUrl match = ${img.source_page_url === newMetadata.pageUrl}`);
      if (img.source_image_url === newMetadata.sourceUrl && img.source_page_url === newMetadata.pageUrl) {
        console.log('CONTEXT MATCH FOUND!');
      }
    }
    
    const contextMatch = existingImages.find(img => 
      img.source_image_url === newMetadata.sourceUrl && 
      img.source_page_url === newMetadata.pageUrl
    );

    if (contextMatch) {
      results.isDuplicate = true;
      results.contextMatch = contextMatch;
      onProgress && onProgress('✗ Exact context match found (same URL on same page)');
      console.log('Duplicate found: context match');
      return results;
    }

    // Phase 3: SHA-256 exact match
    onProgress && onProgress('Calculating SHA-256 hash...');
    const exactMatch = existingImages.find(img => img.sha256 === newMetadata.sha256);
    
    console.log('SHA-256 check:', {
      newHash: newMetadata.sha256.substring(0, 16) + '...',
      foundMatch: !!exactMatch
    });
    
    if (exactMatch) {
      results.isDuplicate = true;
      results.exactMatch = exactMatch;
      onProgress && onProgress('✗ Exact duplicate found (identical file)');
      console.log('Duplicate found: SHA-256 match');
      return results;
    }

    // Phase 4: Perceptual hash for visual similarity
    onProgress && onProgress('Analyzing visual similarity (pHash)...');
    for (const img of fastFilterMatches) {
      if (img.pHash) {
        const distance = this.hammingDistance(newMetadata.pHash, img.pHash);
        console.log(`pHash distance: ${distance} (threshold: ${this.pHashThreshold})`);
        if (distance <= this.pHashThreshold) {
          results.isDuplicate = true;
          results.visualMatch = { ...img, hammingDistance: distance };
          onProgress && onProgress(`✗ Visually similar image found (${distance}% difference)`);
          console.log('Duplicate found: visual similarity');
          return results;
        }
      }
    }

    onProgress && onProgress('✓ No duplicates found');
    console.log('No duplicates detected');
    return results;
  }
}

// Export for use in background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DuplicateDetector;
}
