// popup.js - ImgVault Extension Popup with Firebase
// Handles image preview, metadata editing, and upload
console.log('🔵 ImgVault popup.js loaded - v2.0');

let currentImageData = null;
let storageManager = null;

// DOM Elements  
const settingsView = document.getElementById('settingsView');
const imageView = document.getElementById('imageView');
const successView = document.getElementById('successView');
const noImageView = document.getElementById('noImageView');

const previewImage = document.getElementById('previewImage');
const sourceUrlDisplay = document.getElementById('sourceUrlDisplay');
const pageUrlInput = document.getElementById('pageUrlInput');
const editPageUrlBtn = document.getElementById('editPageUrlBtn');
const notesInput = document.getElementById('notesInput');
const tagsInput = document.getElementById('tagsInput');
const uploadBtn = document.getElementById('uploadBtn');
const statusMessage = document.getElementById('statusMessage');

const apiKeyInput = document.getElementById('apiKeyInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const settingsBtns = document.querySelectorAll('#settingsBtn');
const backToImageBtn = document.getElementById('backToImageBtn');

const firebaseConfigPaste = document.getElementById('firebaseConfigPaste');

const pixvidUrlLink = document.getElementById('pixvidUrlLink');
const imgbbUrlLink = document.getElementById('imgbbUrlLink');
const imgbbUrlSection = document.getElementById('imgbbUrlSection');
const copyPixvidBtn = document.getElementById('copyPixvidBtn');
const copyImgbbBtn = document.getElementById('copyImgbbBtn');

const galleryBtn = document.getElementById('galleryBtn');
const uploadProgress = document.getElementById('uploadProgress');
const progressText = document.getElementById('progressText');

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🔵 DOMContentLoaded event fired');
  storageManager = new StorageManager();
  await loadSettings();
  await loadPendingImage();
  console.log('🔵 About to setup event listeners');
  setupEventListeners();
  console.log('🔵 Event listeners setup complete');
  setupStatusListener();
});

// Listen for upload status updates from background script
function setupStatusListener() {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.uploadStatus) {
      const status = changes.uploadStatus.newValue;
      if (status) {
        // Show progress indicator with status
        uploadProgress.style.display = 'flex';
        progressText.textContent = status;
        
        // Only auto-hide success messages, keep errors/duplicates visible
        if (status.includes('✅')) {
          setTimeout(() => {
            uploadProgress.style.display = 'none';
          }, 5000); // 5 seconds for success
        }
        // Errors (✗) and duplicates (🚫) stay visible until user closes popup
      } else {
        // Hide progress when status is cleared
        uploadProgress.style.display = 'none';
      }
    }
  });
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get(['pixvidApiKey', 'imgbbApiKey', 'firebaseConfig', 'firebaseConfigRaw']);
  
  if (settings.pixvidApiKey) {
    apiKeyInput.value = settings.pixvidApiKey;
  }
  
  if (settings.firebaseConfigRaw) {
    // Load the raw text that was typed
    firebaseConfigPaste.value = settings.firebaseConfigRaw;
  } else if (settings.firebaseConfig) {
    // Fallback: Show the parsed config as formatted JSON
    firebaseConfigPaste.value = JSON.stringify(settings.firebaseConfig, null, 2);
  }
  
  // Update services indicator
  updateServicesIndicator(settings.pixvidApiKey, settings.imgbbApiKey);
}

function updateServicesIndicator(hasPixvid, hasImgbb) {
  const indicator = document.getElementById('uploadServicesIndicator');
  const statusSpan = document.getElementById('servicesStatus');
  
  if (!indicator || !statusSpan) return;
  
  let html = '';
  
  if (hasPixvid) {
    html += '<span class="service-badge pixvid">Pixvid</span>';
  }
  
  if (hasImgbb) {
    html += '<span class="service-badge imgbb">ImgBB</span>';
  } else {
    html += '<span class="service-badge disabled">ImgBB (not configured)</span>';
  }
  
  statusSpan.innerHTML = html;
}

async function loadPendingImage() {
  const result = await chrome.storage.local.get('pendingImage');
  
  if (result.pendingImage) {
    currentImageData = result.pendingImage;
    await chrome.storage.local.remove('pendingImage');
    showImageView();
    displayImageData(currentImageData);
  } else {
    showNoImageView();
  }
}

function displayImageData(data) {
  previewImage.src = data.srcUrl;
  sourceUrlDisplay.textContent = truncateUrl(data.srcUrl);
  sourceUrlDisplay.title = data.srcUrl;
  pageUrlInput.value = data.pageUrl || '';
  
  if (data.pageTitle) {
    notesInput.placeholder = `From: ${data.pageTitle}`;
  }
  
  // Show Google Drive tip if applicable
  const gdriveTip = document.getElementById('gdriveTip');
  if (data.isGoogleDrive) {
    gdriveTip.style.display = 'flex';
  } else {
    gdriveTip.style.display = 'none';
  }
}

function truncateUrl(url, maxLength = 50) {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength) + '...';
}

function setupEventListeners() {
  settingsBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Open settings in new tab
      chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
    });
  });
  
  backToImageBtn.addEventListener('click', () => {
    if (currentImageData) {
      showImageView();
    } else {
      showNoImageView();
    }
  });
  
  saveSettingsBtn.addEventListener('click', saveSettings);
  editPageUrlBtn.addEventListener('click', togglePageUrlEdit);
  uploadBtn.addEventListener('click', handleUpload);
  copyPixvidBtn.addEventListener('click', () => copyUrl(pixvidUrlLink));
  copyImgbbBtn.addEventListener('click', () => copyUrl(imgbbUrlLink));
  
  galleryBtn.addEventListener('click', openGallery);
  
  // Upload from computer button in no-image view
  const uploadFromPCBtn = document.getElementById('uploadFromPCBtn');
  const uploadFileInput = document.getElementById('uploadFileInput');
  
  if (uploadFromPCBtn && uploadFileInput) {
    uploadFromPCBtn.addEventListener('click', () => {
      uploadFileInput.click();
    });
    
    uploadFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      // Reset input
      e.target.value = '';
      
      // Show the image upload view with the selected file
      noImageView.style.display = 'none';
      imageView.style.display = 'block';
      
      // Load the selected file as an image
      const reader = new FileReader();
      reader.onload = (event) => {
        previewImage.src = event.target.result;
        sourceUrlDisplay.textContent = file.name;
        pageUrlInput.value = '';
        
        // Store the file for upload
        window.selectedFile = file;
      };
      reader.readAsDataURL(file);
    });
  }
  
  // Auto-save settings with debounce
  let saveTimeout;
  const autoSaveSettings = () => {
    console.log('🔵 Auto-save triggered');
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      console.log('🔵 Saving settings...');
      saveSettings(true); // true = silent save (no status messages)
    }, 1000); // Save 1 second after user stops typing
  };
  
  console.log('🔵 Setting up auto-save listeners');
  apiKeyInput.addEventListener('input', autoSaveSettings);
  firebaseConfigPaste.addEventListener('input', autoSaveSettings);
  console.log('🔵 Auto-save listeners attached');
  
  // File upload - use event delegation on document
  document.addEventListener('click', (e) => {
    console.log('🔵 Click target:', e.target.tagName, e.target.className, e.target.id);
    
    // Check if the click is on the replace button or any of its children
    const replaceBtn = e.target.closest('.replace-btn') || (e.target.classList && e.target.classList.contains('replace-btn'));
    
    if (replaceBtn) {
      console.log('✅ Replace button clicked!');
      e.preventDefault();
      e.stopPropagation();
      const fileInput = document.getElementById('fileInput');
      console.log('🔵 File input element:', fileInput);
      if (fileInput) {
        console.log('🔵 Triggering file input click');
        fileInput.click();
      }
    }
  });
  
  // File input change listener
  document.addEventListener('change', (e) => {
    if (e.target.id === 'fileInput') {
      console.log('File input changed via delegation');
      handleFileUpload(e);
    }
  });
  
  // Tip banner close button
  document.addEventListener('click', (e) => {
    if (e.target.id === 'closeTip') {
      document.getElementById('gdriveTip').style.display = 'none';
    }
    if (e.target.id === 'closeReplaced') {
      document.getElementById('replacedBanner').style.display = 'none';
    }
  });
}

function showImageView() {
  hideAllViews();
  imageView.style.display = 'block';
}

function showNoImageView() {
  hideAllViews();
  noImageView.style.display = 'block';
}

function showSettings() {
  hideAllViews();
  settingsView.style.display = 'block';
}

function showSuccessView(pixvidUrl, imgbbUrl) {
  hideAllViews();
  successView.style.display = 'block';
  
  pixvidUrlLink.href = pixvidUrl;
  pixvidUrlLink.textContent = truncateUrl(pixvidUrl, 40);
  
  if (imgbbUrl) {
    imgbbUrlSection.style.display = 'block';
    imgbbUrlLink.href = imgbbUrl;
    imgbbUrlLink.textContent = truncateUrl(imgbbUrl, 40);
  } else {
    imgbbUrlSection.style.display = 'none';
  }
}

function openGallery() {
  chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html') });
}

function hideAllViews() {
  settingsView.style.display = 'none';
  imageView.style.display = 'none';
  successView.style.display = 'none';
  noImageView.style.display = 'none';
}

async function saveSettings(silent = false) {
  const apiKey = apiKeyInput.value.trim();
  const pastedText = firebaseConfigPaste.value.trim();
  
  console.log('🔵 saveSettings called - silent:', silent, 'apiKey:', apiKey ? 'filled' : 'empty', 'config:', pastedText ? `${pastedText.length} chars` : 'empty');
  
  if (!apiKey && !silent) {
    showStatus('Please enter a Pixvid API key', 'error');
    return;
  }
  
  // Parse Firebase config from textarea using regex extraction
  let firebaseConfig;
  try {
    if (!pastedText && !silent) {
      showStatus('Please paste your Firebase config', 'error');
      return;
    }
    
    // Skip if both fields are empty (silent mode)
    if (!apiKey && !pastedText && silent) {
      console.log('🔵 Skipping save - both fields empty');
      return;
    }
    
    // If only API key is filled, save just that
    if (apiKey && !pastedText && silent) {
      await chrome.storage.sync.set({ pixvidApiKey: apiKey });
      console.log('🔵 API key saved');
      return;
    }
    
    // If only Firebase config is filled, save just that with raw text
    if (pastedText && !apiKey && silent) {
      console.log('🔵 Saving Firebase config only, length:', pastedText.length);
      // Try to parse, but save raw text even if parsing fails
      const extractValue = (key) => {
        const regex = new RegExp(key + '\\s*:\\s*["\']([^"\']+)["\']', 'i');
        const match = pastedText.match(regex);
        return match ? match[1] : null;
      };
      
      const parsedConfig = {
        apiKey: extractValue('apiKey'),
        authDomain: extractValue('authDomain'),
        projectId: extractValue('projectId'),
        storageBucket: extractValue('storageBucket'),
        messagingSenderId: extractValue('messagingSenderId'),
        appId: extractValue('appId'),
        measurementId: extractValue('measurementId')
      };
      
      console.log('🔵 Parsed config:', parsedConfig);
      
      // Remove null/undefined values
      Object.keys(parsedConfig).forEach(key => {
        if (!parsedConfig[key]) delete parsedConfig[key];
      });
      
      await chrome.storage.sync.set({ 
        firebaseConfig: parsedConfig,
        firebaseConfigRaw: pastedText
      });
      console.log('🔵 Firebase config saved successfully');
      return;
    }
    
    // Extract values using regex
    const extractValue = (key) => {
      const regex = new RegExp(key + '\\s*:\\s*["\']([^"\']+)["\']', 'i');
      const match = pastedText.match(regex);
      return match ? match[1] : null;
    };
    
    firebaseConfig = {
      apiKey: extractValue('apiKey'),
      authDomain: extractValue('authDomain'),
      projectId: extractValue('projectId'),
      storageBucket: extractValue('storageBucket'),
      messagingSenderId: extractValue('messagingSenderId'),
      appId: extractValue('appId'),
      measurementId: extractValue('measurementId')
    };
    
    // Remove null/undefined values
    Object.keys(firebaseConfig).forEach(key => {
      if (!firebaseConfig[key]) delete firebaseConfig[key];
    });
    
    // Validate required fields
    if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId) {
      if (!silent) {
        throw new Error('Missing required fields: apiKey, authDomain, and projectId');
      }
      return; // Skip save in silent mode if validation fails
    }
  } catch (error) {
    console.error('🔴 Parse error:', error);
    if (!silent) {
      showStatus(error.message || 'Invalid Firebase config. Please paste the entire config object.', 'error');
    }
    return;
  }
  
  await chrome.storage.sync.set({ 
    pixvidApiKey: apiKey,
    firebaseConfig: firebaseConfig,
    firebaseConfigRaw: pastedText // Save the raw text too
  });
  
  console.log('🔵 Settings saved to storage', { apiKey: apiKey.substring(0, 10) + '...', configLength: pastedText.length });
  
  if (!silent) {
    showStatus('Settings saved!', 'success');
    
    setTimeout(() => {
      if (currentImageData) {
        showImageView();
      } else {
        showNoImageView();
      }
    }, 1000);
  } else {
    // Silent save - just show a subtle indicator
    saveSettingsBtn.textContent = '✅ Auto-saved';
    setTimeout(() => {
      saveSettingsBtn.textContent = '💾 Save Configuration';
    }, 1500);
  }
}

function togglePageUrlEdit() {
  const isReadonly = pageUrlInput.hasAttribute('readonly');
  
  if (isReadonly) {
    pageUrlInput.removeAttribute('readonly');
    pageUrlInput.focus();
    pageUrlInput.select();
    editPageUrlBtn.textContent = '✓';
    editPageUrlBtn.title = 'Save';
  } else {
    pageUrlInput.setAttribute('readonly', 'readonly');
    editPageUrlBtn.innerHTML = '✏️';
    editPageUrlBtn.title = 'Edit page URL';
    saveFormData(); // Save when user finishes editing
  }
}

async function handleFileUpload(event) {
  console.log('handleFileUpload called', event);
  const file = event.target.files[0];
  console.log('Selected file:', file);
  
  if (!file) {
    console.log('No file selected');
    return;
  }
  
  // Validate file is an image
  if (!file.type.startsWith('image/')) {
    showStatus('Please select an image file', 'error');
    return;
  }
  
  console.log('Reading file:', file.name, file.type, file.size);
  
  try {
    // Read the file as data URL
    const reader = new FileReader();
    reader.onload = async (e) => {
      console.log('File loaded, data URL length:', e.target.result.length);
      const dataUrl = e.target.result;
      
      // Preserve the original source URL
      if (!currentImageData.originalSrcUrl) {
        currentImageData.originalSrcUrl = currentImageData.srcUrl;
      }
      
      // Update the current image data with uploaded file
      currentImageData.srcUrl = dataUrl;
      currentImageData.isUploadedFile = true;
      currentImageData.fileName = file.name; // Store the filename
      
      // Update preview
      previewImage.src = dataUrl;
      
      // Show persistent banner
      document.getElementById('replacedBanner').style.display = 'flex';
      
      console.log('Image replaced successfully');
    };
    
    reader.readAsDataURL(file);
  } catch (error) {
    console.error('File upload error:', error);
    showStatus('Failed to load file', 'error');
  }
  
  // Clear the input so the same file can be selected again
  event.target.value = '';
}

async function handleUpload() {
  if (!currentImageData) {
    showStatus('No image to upload', 'error');
    return;
  }
  
  const settings = await chrome.storage.sync.get(['pixvidApiKey', 'firebaseConfig']);
  
  if (!settings.pixvidApiKey) {
    showStatus('Please configure your Pixvid API key in settings', 'error');
    setTimeout(() => showSettings(), 1500);
    return;
  }
  
  if (!settings.firebaseConfig) {
    showStatus('Please configure Firebase in settings', 'error');
    setTimeout(() => showSettings(), 1500);
    return;
  }
  
  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading...';
  
  try {
    const uploadData = {
      imageUrl: currentImageData.srcUrl,
      originalSourceUrl: currentImageData.originalSrcUrl || currentImageData.srcUrl,
      pageUrl: pageUrlInput.value,
      pageTitle: currentImageData.pageTitle,
      tags: tagsInput.value.split(',').map(t => t.trim()).filter(t => t),
      description: notesInput.value,
      isUploadedFile: currentImageData.isUploadedFile || false,
      fileName: currentImageData.fileName || ''
    };
    
    const response = await chrome.runtime.sendMessage({
      action: 'uploadImage',
      data: uploadData
    });
    
    if (response.success) {
      showStatus('Upload successful!', 'success');
      showSuccessView(response.data.pixvidUrl, response.data.imgbbUrl);
    } else {
      // Check if it's a duplicate with image data
      if (response.duplicate) {
        showStatus(`Upload failed: ${response.error}`, 'error');
        showDuplicateImage(response.duplicate, uploadData);
      } else {
        throw new Error(response.error || 'Upload failed');
      }
    }
  } catch (error) {
    console.error('Upload error:', error);
    
    // Hide the upload progress indicator
    uploadProgress.style.display = 'none';
    
    // Show error in status message
    showStatus(`Upload failed: ${error.message}`, 'error');
    
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload to ImgVault';
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload to ImgVault';
  }
}

function showDuplicateImage(duplicateData, uploadData) {
  // Create a duplicate info display
  const duplicateInfo = document.createElement('div');
  duplicateInfo.className = 'duplicate-info';
  duplicateInfo.innerHTML = `
    <div class="duplicate-header">
      <span class="duplicate-icon">🔗</span>
      <strong>Existing Image:</strong>
    </div>
    <div class="duplicate-preview">
      <img src="${duplicateData.pixvidUrl}" alt="Duplicate image" />
    </div>
    <div class="duplicate-actions">
      <a href="${duplicateData.pixvidUrl}" target="_blank" class="btn-link">
        Open Image
      </a>
      <button class="btn-link" onclick="navigator.clipboard.writeText('${duplicateData.pixvidUrl}'); this.textContent='Copied!'">
        Copy URL
      </button>
      <button class="btn-link btn-ignore-duplicate">
        Ignore & Upload Anyway
      </button>
    </div>
  `;
  
  // Insert after status message
  statusMessage.parentNode.insertBefore(duplicateInfo, statusMessage.nextSibling);
  
  // Add click handler for ignore button
  const ignoreBtn = duplicateInfo.querySelector('.btn-ignore-duplicate');
  ignoreBtn.addEventListener('click', async () => {
    // Remove the duplicate info display
    duplicateInfo.remove();
    
    // Clear error status
    statusMessage.style.display = 'none';
    
    // Upload with ignore flag
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
    
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'uploadImage',
        data: { ...uploadData, ignoreDuplicate: true }
      });
      
      if (response.success) {
        showStatus('Upload successful!', 'success');
        showSuccessView(response.data.pixvidUrl, response.data.imgbbUrl);
      } else {
        throw new Error(response.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      uploadProgress.style.display = 'none';
      showStatus(`Upload failed: ${error.message}`, 'error');
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload to ImgVault';
    }
  });
}

function showStatus(message, type = 'info') {
  statusMessage.textContent = message;
  statusMessage.className = `status ${type}`;
  statusMessage.style.display = 'block';
  
  // Only auto-hide success/info messages, keep errors visible
  if (type !== 'error') {
    setTimeout(() => {
      statusMessage.style.display = 'none';
    }, 3000);
  }
}

async function copyUrl(linkElement) {
  const url = linkElement.href;
  const buttonElement = linkElement.nextElementSibling; // Get the copy button next to the link
  try {
    await navigator.clipboard.writeText(url);
    const originalText = buttonElement.textContent;
    buttonElement.textContent = '✓';
    setTimeout(() => {
      buttonElement.textContent = originalText;
    }, 2000);
  } catch (error) {
    console.error('Failed to copy:', error);
  }
}
