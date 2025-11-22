// popup.js - ImgVault Extension Popup with Firebase
// Handles image preview, metadata editing, and upload

let currentImageData = null;

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

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadPendingImage();
  setupEventListeners();
});

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
      pageUrl: pageUrlInput.value,
      pageTitle: currentImageData.pageTitle,
      tags: tagsInput.value.split(',').map(t => t.trim()).filter(t => t),
      notes: notesInput.value
    };
    
    const response = await chrome.runtime.sendMessage({
      action: 'uploadImage',
      data: uploadData
    });
    
    if (response.success) {
      showStatus('Upload successful!', 'success');
      showSuccessView(response.data.storedUrl);
    } else {
      throw new Error(response.error || 'Upload failed');
    }
  } catch (error) {
    console.error('Upload error:', error);
    showStatus(`Upload failed: ${error.message}`, 'error');
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload to ImgVault';
  }
}

function showStatus(message, type = 'info') {
  statusMessage.textContent = message;
  statusMessage.className = `status ${type}`;
  statusMessage.style.display = 'block';
  
  setTimeout(() => {
    statusMessage.style.display = 'none';
  }, 3000);
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
