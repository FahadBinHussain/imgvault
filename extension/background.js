// background.js - Service worker for ImgVault extension
// Handles context menu, image uploads to Pixvid, and storage

importScripts('storage.js', 'duplicate-detector.js', 'url-normalizer.js');

const storage = new StorageManager();
const duplicateDetector = new DuplicateDetector();

// Initialize storage when extension loads
storage.init().catch(err => console.error('Failed to initialize storage:', err));

// Create context menu on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'saveToImgVault',
    title: 'Save to ImgVault',
    contexts: ['image']
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'saveToImgVault') {
    // Store the image info for the popup to use
    chrome.storage.local.set({
      pendingImage: {
        srcUrl: info.srcUrl,
        pageUrl: info.pageUrl || tab.url,
        pageTitle: tab.title,
        timestamp: Date.now()
      }
    }, () => {
      // Open the popup by triggering the action
      chrome.action.openPopup();
    });
  }
});

// Listen for upload requests from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'uploadImage') {
    handleImageUpload(request.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ 
        success: false, 
        error: error.message,
        duplicate: error.duplicate || null // Include duplicate image data if available
      }));
    return true; // Keep the message channel open for async response
  }
  
  if (request.action === 'getImages') {
    storage.getAllImages()
      .then(images => sendResponse({ success: true, images }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (request.action === 'deleteImage') {
    storage.deleteImage(request.id)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

async function handleImageUpload(data) {
  const updateStatus = (message) => {
    // Send status update to popup
    chrome.storage.local.set({ uploadStatus: message });
  };

  try {
    // Get API key from storage
    const settings = await chrome.storage.sync.get(['pixvidApiKey']);
    if (!settings.pixvidApiKey) {
      throw new Error('Pixvid API key not configured. Please set it in the extension settings.');
    }

    updateStatus('📥 Fetching image...');
    
    // Fetch the image (handles both URLs and data URLs)
    let imageBlob;
    if (data.imageUrl.startsWith('data:')) {
      // It's a data URL (uploaded file)
      const response = await fetch(data.imageUrl);
      imageBlob = await response.blob();
    } else {
      // It's a regular URL
      const imageResponse = await fetch(data.imageUrl);
      if (!imageResponse.ok) {
        throw new Error('Failed to fetch image');
      }
      imageBlob = await imageResponse.blob();
    }
    
    updateStatus('🔍 Extracting image metadata...');
    
    // Extract comprehensive metadata for duplicate detection
    const metadata = await duplicateDetector.extractMetadata(
      imageBlob, 
      data.imageUrl, 
      data.pageUrl
    );
    
    console.log('Extracted metadata:', {
      sha256: metadata.sha256.substring(0, 16) + '...',
      pHash: metadata.pHash.substring(0, 32) + '...',
      aHash: metadata.aHash.substring(0, 16) + '...',
      dHash: metadata.dHash.substring(0, 16) + '...',
      width: metadata.width,
      height: metadata.height,
      size: metadata.size
    });
    
    updateStatus('🔎 Checking for duplicates...');
    
    // Get existing images from Firebase
    const existingImages = await storage.getAllImages();
    
    console.log(`Checking against ${existingImages.length} existing images`);
    console.log('First existing image hashes:', existingImages[0] ? {
      sha256: existingImages[0].sha256?.substring(0, 16) + '...',
      pHash: existingImages[0].pHash?.substring(0, 32) + '...',
      width: existingImages[0].width,
      height: existingImages[0].height
    } : 'No existing images');
    
    // Check for duplicates with progress updates
    const duplicateCheck = await duplicateDetector.checkDuplicates(
      metadata, 
      existingImages,
      (progressMsg) => updateStatus(`🔎 ${progressMsg}`)
    );
    
    // If duplicate found, return error with details
    if (duplicateCheck.isDuplicate) {
      let errorMsg = 'Duplicate image detected!\n';
      let duplicateData = null;
      
      if (duplicateCheck.contextMatch) {
        errorMsg += '✗ Same image from same page already exists';
        duplicateData = duplicateCheck.contextMatch;
      } else if (duplicateCheck.exactMatch) {
        errorMsg += '✗ Identical file already exists (SHA-256 match)';
        duplicateData = duplicateCheck.exactMatch;
      } else if (duplicateCheck.visualMatch) {
        const similarity = duplicateCheck.visualMatch.similarity || '0';
        const matchCount = duplicateCheck.visualMatch.matchCount || 0;
        errorMsg += `✗ Visually similar image found (${similarity}% similar, ${matchCount}/3 hashes matched)`;
        duplicateData = duplicateCheck.visualMatch;
      }
      
      // Don't use updateStatus for duplicates - let popup handle the display
      // Clear the progress status
      updateStatus('');
      
      // Store duplicate data for popup to display
      const error = new Error(errorMsg);
      error.duplicate = duplicateData; // Attach duplicate image data to error
      throw error;
    }
    
    updateStatus('☁️ Uploading to Pixvid...');
    
    // Upload to Pixvid
    const uploadResult = await uploadToPixvid(imageBlob, settings.pixvidApiKey, data.imageUrl);
    
    updateStatus('💾 Saving to Firebase...');
    
    // Save metadata to Firebase with hash information
    const imageMetadata = {
      stored_url: uploadResult.url,
      delete_url: uploadResult.deleteUrl,
      source_image_url: data.imageUrl,
      source_page_url: data.pageUrl,
      page_title: data.pageTitle,
      file_type: imageBlob.type,
      file_size: imageBlob.size,
      width: metadata.width,
      height: metadata.height,
      sha256: metadata.sha256,
      pHash: metadata.pHash,
      aHash: metadata.aHash,
      dHash: metadata.dHash,
      tags: data.tags || [],
      notes: data.notes || ''
    };
    
    const savedId = await storage.saveImage(imageMetadata);
    
    updateStatus('✅ Image saved successfully!');
    
    // Keep success message visible (don't clear it)
    // User will see it until they close the popup
    
    return {
      id: savedId,
      storedUrl: uploadResult.url,
      ...imageMetadata
    };
  } catch (error) {
    console.error('Upload error:', error);
    // Don't clear status on error - let the error message persist
    // updateStatus('') <- REMOVED so error messages stay visible
    throw error;
  }
}

async function uploadToPixvid(blob, apiKey, originalFilename) {
  const formData = new FormData();
  
  // Extract filename from URL or use default
  const filename = originalFilename.split('/').pop().split('?')[0] || 'image.jpg';
  formData.append('source', blob, filename);
  formData.append('key', apiKey);
  
  try {
    const response = await fetch('https://pixvid.org/api/1/upload', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Pixvid upload failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    if (result.status_code !== 200) {
      throw new Error(result.error?.message || 'Upload failed');
    }

    return {
      url: result.image.url,
      deleteUrl: result.image.delete_url,
      displayUrl: result.image.display_url
    };
  } catch (error) {
    console.error('Pixvid API error:', error);
    throw new Error(`Failed to upload to Pixvid: ${error.message}`);
  }
}
