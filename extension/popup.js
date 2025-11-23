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

const storedUrlLink = document.getElementById('storedUrlLink');
const copyUrlBtn = document.getElementById('copyUrlBtn');

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
  const settings = await chrome.storage.sync.get(['pixvidApiKey', 'firebaseConfig']);
  
  if (settings.pixvidApiKey) {
    apiKeyInput.value = settings.pixvidApiKey;
  }
  
  if (settings.firebaseConfig) {
    // Show the config in a formatted way in the textarea
    firebaseConfigPaste.value = JSON.stringify(settings.firebaseConfig, null, 2);
  }
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
    btn.addEventListener('click', showSettings);
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
  copyUrlBtn.addEventListener('click', copyStoredUrl);
  
  galleryBtn.addEventListener('click', openGallery);
  
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

function showSuccessView(storedUrl) {
  hideAllViews();
  successView.style.display = 'block';
  storedUrlLink.href = storedUrl;
  storedUrlLink.textContent = truncateUrl(storedUrl, 40);
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

async function saveSettings() {
  const apiKey = apiKeyInput.value.trim();
  
  if (!apiKey) {
    showStatus('Please enter a Pixvid API key', 'error');
    return;
  }
  
  // Parse Firebase config from textarea using regex extraction
  let firebaseConfig;
  try {
    const pastedText = firebaseConfigPaste.value.trim();
    
    if (!pastedText) {
      showStatus('Please paste your Firebase config', 'error');
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
      throw new Error('Missing required fields: apiKey, authDomain, and projectId');
    }
  } catch (error) {
    console.error('Parse error:', error);
    showStatus(error.message || 'Invalid Firebase config. Please paste the entire config object.', 'error');
    return;
  }
  
  await chrome.storage.sync.set({ 
    pixvidApiKey: apiKey,
    firebaseConfig: firebaseConfig
  });
  
  showStatus('Settings saved!', 'success');
  
  setTimeout(() => {
    if (currentImageData) {
      showImageView();
    } else {
      showNoImageView();
    }
  }, 1000);
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
      
      // Update preview
      previewImage.src = dataUrl;
      
      // Show confirmation
      showStatus('✅ Image replaced! Ready to upload higher quality version', 'success');
      
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
      notes: notesInput.value,
      isUploadedFile: currentImageData.isUploadedFile || false
    };
    
    const response = await chrome.runtime.sendMessage({
      action: 'uploadImage',
      data: uploadData
    });
    
    if (response.success) {
      showStatus('Upload successful!', 'success');
      showSuccessView(response.data.storedUrl);
    } else {
      // Check if it's a duplicate with image data
      if (response.duplicate) {
        showStatus(`Upload failed: ${response.error}`, 'error');
        showDuplicateImage(response.duplicate);
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

function showDuplicateImage(duplicateData) {
  // Create a duplicate info display
  const duplicateInfo = document.createElement('div');
  duplicateInfo.className = 'duplicate-info';
  duplicateInfo.innerHTML = `
    <div class="duplicate-header">
      <span class="duplicate-icon">🔗</span>
      <strong>Existing Image:</strong>
    </div>
    <div class="duplicate-preview">
      <img src="${duplicateData.stored_url}" alt="Duplicate image" />
    </div>
    <div class="duplicate-actions">
      <a href="${duplicateData.stored_url}" target="_blank" class="btn-link">
        Open Image
      </a>
      <button class="btn-link" onclick="navigator.clipboard.writeText('${duplicateData.stored_url}'); this.textContent='Copied!'">
        Copy URL
      </button>
    </div>
  `;
  
  // Insert after status message
  statusMessage.parentNode.insertBefore(duplicateInfo, statusMessage.nextSibling);
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

async function copyStoredUrl() {
  const url = storedUrlLink.href;
  try {
    await navigator.clipboard.writeText(url);
    copyUrlBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyUrlBtn.textContent = 'Copy URL';
    }, 2000);
  } catch (error) {
    console.error('Failed to copy:', error);
  }
}
