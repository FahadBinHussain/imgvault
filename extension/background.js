// Create context menu on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'saveToImgVault',
    title: 'Save to ImgVault',
    contexts: ['image']
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'saveToImgVault') {
    // Store the image data
    const imageData = {
      imageUrl: info.srcUrl,
      pageUrl: info.pageUrl,
      pageTitle: tab.title,
      timestamp: new Date().toISOString()
    };

    // Save to storage
    await chrome.storage.local.set({ pendingImage: imageData });

    // Open the popup
    chrome.action.openPopup();
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'saveImage') {
    chrome.storage.local.set({ pendingImage: request.data });
    chrome.action.openPopup();
    sendResponse({ success: true });
  }
  return true;
});
