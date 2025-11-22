// background.js - Service worker for ImgVault extension
// Handles context menu, image uploads to Pixvid, and storage

importScripts('storage.js');

const storage = new StorageManager();

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
      .catch(error => sendResponse({ success: false, error: error.message }));
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
  try {
    // Get API key from storage
    const settings = await chrome.storage.sync.get(['pixvidApiKey']);
    if (!settings.pixvidApiKey) {
      throw new Error('Pixvid API key not configured. Please set it in the extension settings.');
    }

    // Fetch the image
    const imageResponse = await fetch(data.imageUrl);
    if (!imageResponse.ok) {
      throw new Error('Failed to fetch image');
    }
    
    const imageBlob = await imageResponse.blob();
    
    // Upload to Pixvid
    const uploadResult = await uploadToPixvid(imageBlob, settings.pixvidApiKey, data.imageUrl);
    
    // Save metadata to IndexedDB
    const imageMetadata = {
      stored_url: uploadResult.url,
      delete_url: uploadResult.deleteUrl,
      source_image_url: data.imageUrl,
      source_page_url: data.pageUrl,
      page_title: data.pageTitle,
      file_type: imageBlob.type,
      file_size: imageBlob.size,
      tags: data.tags || [],
      notes: data.notes || ''
    };
    
    const savedId = await storage.saveImage(imageMetadata);
    
    return {
      id: savedId,
      storedUrl: uploadResult.url,
      ...imageMetadata
    };
  } catch (error) {
    console.error('Upload error:', error);
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
