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
const openTabBtn = document.getElementById('openTabBtn');
const backToImageBtn = document.getElementById('backToImageBtn');

const firebaseApiKey = document.getElementById('firebaseApiKey');
const firebaseAuthDomain = document.getElementById('firebaseAuthDomain');
const firebaseProjectId = document.getElementById('firebaseProjectId');
const firebaseStorageBucket = document.getElementById('firebaseStorageBucket');
const firebaseMessagingSenderId = document.getElementById('firebaseMessagingSenderId');
const firebaseAppId = document.getElementById('firebaseAppId');

const storedUrlLink = document.getElementById('storedUrlLink');
const copyUrlBtn = document.getElementById('copyUrlBtn');
const viewImagesBtn = document.getElementById('viewImagesBtn');

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadPendingImage();
  await restoreViewState();
  setupEventListeners();
});

async function restoreViewState() {
  // If there's a pending image, prioritize that  
  if (currentImageData) {
    return;
  }
  
  const { lastView, lastUploadedUrl } = await chrome.storage.local.get(['lastView', 'lastUploadedUrl']);
  
  // Otherwise restore last view
  if (lastView === 'settings') {
    showSettings();
  } else if (lastView === 'success' && lastUploadedUrl) {
    showSuccessView(lastUploadedUrl);
  } else {
    showNoImageView();
  }
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get(['pixvidApiKey', 'firebaseConfig']);
  
  if (settings.pixvidApiKey) {
    apiKeyInput.value = settings.pixvidApiKey;
  }
  
  if (settings.firebaseConfig) {
    const config = settings.firebaseConfig;
    firebaseApiKey.value = config.apiKey || '';
    firebaseAuthDomain.value = config.authDomain || '';
    firebaseProjectId.value = config.projectId || '';
    firebaseStorageBucket.value = config.storageBucket || '';
    firebaseMessagingSenderId.value = config.messagingSenderId || '';
    firebaseAppId.value = config.appId || '';
  }
}

async function loadPendingImage() {
  let result = await chrome.storage.local.get('pendingImage');
  
  // If no pending image, check for saved current image
  if (!result.pendingImage) {
    result = await chrome.storage.local.get('currentImage');
    if (result.currentImage) {
      currentImageData = result.currentImage;
      showImageView();
      displayImageData(currentImageData);
      return;
    }
  }
  
  if (result.pendingImage) {
    currentImageData = result.pendingImage;
    // Save as current image so it persists
    await chrome.storage.local.set({ currentImage: result.pendingImage });
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
  
  // Restore saved notes and tags if they exist
  restoreFormData();
  
  // Auto-save form data as user types
  notesInput.addEventListener('input', saveFormData);
  tagsInput.addEventListener('input', saveFormData);
  pageUrlInput.addEventListener('input', saveFormData);
}

async function saveFormData() {
  await chrome.storage.local.set({
    draftNotes: notesInput.value,
    draftTags: tagsInput.value,
    draftPageUrl: pageUrlInput.value
  });
}

async function restoreFormData() {
  const { draftNotes, draftTags, draftPageUrl } = await chrome.storage.local.get([
    'draftNotes',
    'draftTags',
    'draftPageUrl'
  ]);
  
  if (draftNotes) notesInput.value = draftNotes;
  if (draftTags) tagsInput.value = draftTags;
  if (draftPageUrl) pageUrlInput.value = draftPageUrl; // Override with draft if exists
}

function clearFormData() {
  chrome.storage.local.remove(['draftNotes', 'draftTags', 'draftPageUrl', 'currentImage']);
}

function truncateUrl(url, maxLength = 50) {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength) + '...';
}

function setupEventListeners() {
  settingsBtns.forEach(btn => {
    btn.addEventListener('click', showSettings);
  });
  
  if (openTabBtn) {
    openTabBtn.addEventListener('click', openVaultTab);
  }
  
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
  viewImagesBtn.addEventListener('click', openVaultTab);
  
  // Add keyboard shortcut to open in tab
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 't') {
      e.preventDefault();
      openVaultTab();
    }
  });
}

function openVaultTab() {
  chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
}

function showImageView() {
  hideAllViews();
  imageView.style.display = 'block';
  chrome.storage.local.set({ lastView: 'image' });
}

function showNoImageView() {
  hideAllViews();
  noImageView.style.display = 'block';
  chrome.storage.local.set({ lastView: 'empty' });
}

function showSettings() {
  hideAllViews();
  settingsView.style.display = 'block';
  chrome.storage.local.set({ lastView: 'settings' });
}

function showSuccessView(storedUrl) {
  hideAllViews();
  successView.style.display = 'block';
  storedUrlLink.href = storedUrl;
  storedUrlLink.textContent = truncateUrl(storedUrl, 40);
  chrome.storage.local.set({ 
    lastView: 'success',
    lastUploadedUrl: storedUrl
  });
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
  
  // Validate Firebase config
  const fbApiKey = firebaseApiKey.value.trim();
  const fbAuthDomain = firebaseAuthDomain.value.trim();
  const fbProjectId = firebaseProjectId.value.trim();
  
  if (!fbApiKey || !fbAuthDomain || !fbProjectId) {
    showStatus('Please fill in all required Firebase fields', 'error');
    return;
  }
  
  const firebaseConfig = {
    apiKey: fbApiKey,
    authDomain: fbAuthDomain,
    projectId: fbProjectId,
    storageBucket: firebaseStorageBucket.value.trim(),
    messagingSenderId: firebaseMessagingSenderId.value.trim(),
    appId: firebaseAppId.value.trim()
  };
  
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
  showStatus('Uploading image...', 'info');
  
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
      clearFormData(); // Clear saved draft
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
