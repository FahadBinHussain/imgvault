// settings.js - Settings page for ImgVault

const apiKeyInput = document.getElementById('apiKeyInput');
const imgbbApiKeyInput = document.getElementById('imgbbApiKeyInput');
const firebaseConfigPaste = document.getElementById('firebaseConfigPaste');
const defaultGallerySource = document.getElementById('defaultGallerySource');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const statusMessage = document.getElementById('statusMessage');
const autoSaveIndicator = document.getElementById('autoSaveIndicator');
const firebaseSyncStatus = document.getElementById('firebaseSyncStatus');

let storageManager = null;
let isLoadingFromFirebase = false;

function showFirebaseStatus(message, type = 'info') {
  firebaseSyncStatus.textContent = message;
  firebaseSyncStatus.style.color = type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--error)' : 'var(--text-secondary)';
  firebaseSyncStatus.classList.add('show');
  // Keep status visible permanently, don't auto-hide
}

// Load settings on page load
document.addEventListener('DOMContentLoaded', loadSettings);

// Auto-save with debounce
let saveTimeout;
const autoSave = () => {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveSettings(true); // Silent save
  }, 800); // Save 800ms after typing stops
};

apiKeyInput.addEventListener('input', autoSave);
imgbbApiKeyInput.addEventListener('input', autoSave);
firebaseConfigPaste.addEventListener('input', () => {
  autoSave();
  // Also try to connect when config changes
  setTimeout(tryLoadFromFirebase, 1000);
});
defaultGallerySource.addEventListener('change', autoSave);
saveSettingsBtn.addEventListener('click', () => saveSettings(false));

async function tryLoadFromFirebase() {
  if (isLoadingFromFirebase) return;
  
  try {
    isLoadingFromFirebase = true;
    showFirebaseStatus('🔄 Connecting to Firebase...', 'info');
    
    const settings = await chrome.storage.sync.get(['firebaseConfig']);
    
    if (settings.firebaseConfig) {
      storageManager = new StorageManager();
      await storageManager.init();
      
      const firebaseSettings = await storageManager.getUserSettings();
      
      if (firebaseSettings) {
        let updated = false;
        
        // Only update if not already filled AND Firebase has a non-empty value
        if (!apiKeyInput.value && firebaseSettings.pixvidApiKey && firebaseSettings.pixvidApiKey.trim()) {
          apiKeyInput.value = firebaseSettings.pixvidApiKey;
          updated = true;
        }
        if (!imgbbApiKeyInput.value && firebaseSettings.imgbbApiKey && firebaseSettings.imgbbApiKey.trim()) {
          imgbbApiKeyInput.value = firebaseSettings.imgbbApiKey;
          updated = true;
        }
        if (firebaseSettings.defaultGallerySource && firebaseSettings.defaultGallerySource.trim()) {
          defaultGallerySource.value = firebaseSettings.defaultGallerySource;
          updated = true;
        }
        
        // Save the loaded values to local storage
        if (updated) {
          await saveSettings(true); // Silent save to local storage
        }
        
        showFirebaseStatus('✅ Synced from Firebase', 'success');
        showStatus('✅ Settings loaded from Firebase', 'success');
      } else {
        showFirebaseStatus('ℹ️ No cloud settings found', 'info');
      }
    }
  } catch (error) {
    console.error('Error loading from Firebase:', error);
    showFirebaseStatus('❌ Firebase sync failed', 'error');
  } finally {
    isLoadingFromFirebase = false;
  }
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get(['pixvidApiKey', 'imgbbApiKey', 'firebaseConfigRaw', 'firebaseConfig', 'defaultGallerySource']);
  
  if (settings.pixvidApiKey) {
    apiKeyInput.value = settings.pixvidApiKey;
  }
  
  if (settings.imgbbApiKey) {
    imgbbApiKeyInput.value = settings.imgbbApiKey;
  }
  
  if (settings.firebaseConfigRaw) {
    firebaseConfigPaste.value = settings.firebaseConfigRaw;
  } else if (settings.firebaseConfig) {
    firebaseConfigPaste.value = JSON.stringify(settings.firebaseConfig, null, 2);
  }
  
  if (settings.defaultGallerySource) {
    defaultGallerySource.value = settings.defaultGallerySource;
  } else {
    defaultGallerySource.value = 'imgbb'; // Default to ImgBB
  }
  
  // Try to load from Firebase after local settings are loaded
  setTimeout(tryLoadFromFirebase, 500);
}

async function saveSettings(silent = false) {
  const apiKey = apiKeyInput.value.trim();
  const imgbbApiKey = imgbbApiKeyInput.value.trim();
  const pastedText = firebaseConfigPaste.value.trim();
  const gallerySource = defaultGallerySource.value;
  
  console.log('🔵 Saving settings - Pixvid API key:', apiKey ? 'present' : 'missing', 'ImgBB API key:', imgbbApiKey ? 'present' : 'missing', 'Config:', pastedText ? `${pastedText.length} chars` : 'missing', 'Gallery source:', gallerySource);
  
  // Save API keys if present
  if (apiKey) {
    await chrome.storage.sync.set({ pixvidApiKey: apiKey });
    console.log('✅ Pixvid API key saved');
  }
  
  if (imgbbApiKey) {
    await chrome.storage.sync.set({ imgbbApiKey: imgbbApiKey });
    console.log('✅ ImgBB API key saved');
  }
  
  // Save gallery source preference
  await chrome.storage.sync.set({ defaultGallerySource: gallerySource });
  console.log('✅ Default gallery source saved:', gallerySource);
  
  // Save Firebase config if present
  if (pastedText) {
    let firebaseConfig = null;
    
    // Try parsing as JSON first
    try {
      firebaseConfig = JSON.parse(pastedText);
      console.log('✅ Parsed as JSON:', firebaseConfig);
    } catch (e) {
      console.log('🔵 Not valid JSON, trying regex parsing...');
      
      // Parse config with regex (for JS object format)
      const extractValue = (key) => {
        // Match both "key": "value" and key: "value" formats
        const regex = new RegExp('["\']?' + key + '["\']?\\s*:\\s*["\']([^"\']+)["\']', 'i');
        const match = pastedText.match(regex);
        console.log(`🔵 Extracting ${key}:`, match ? match[1].substring(0, 20) + '...' : 'NOT FOUND');
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
      
      console.log('🔵 Parsed config:', firebaseConfig);
      
      // Remove null values
      Object.keys(firebaseConfig).forEach(key => {
        if (!firebaseConfig[key]) delete firebaseConfig[key];
      });
    }
    
    console.log('🔵 Final config:', firebaseConfig);
    
    // Validate critical fields
    const criticalFields = ['apiKey', 'projectId', 'authDomain'];
    const missingFields = criticalFields.filter(field => !firebaseConfig[field]);
    
    if (missingFields.length > 0) {
      console.error('❌ Missing critical Firebase fields:', missingFields);
      if (!silent) {
        alert(`⚠️ Firebase config is missing critical fields: ${missingFields.join(', ')}\n\nPlease paste the complete config from Firebase Console.`);
      }
      return;
    }
    
    console.log('✅ All critical Firebase fields present');
    
    await chrome.storage.sync.set({ 
      firebaseConfig: firebaseConfig,
      firebaseConfigRaw: pastedText
    });
    console.log('✅ Firebase config saved');
  }
  
  // Save to Firebase if configured
  try {
    const settings = await chrome.storage.sync.get(['firebaseConfig']);
    if (settings.firebaseConfig && (apiKey || imgbbApiKey)) {
      // Only sync to Firebase if we have actual API keys to save
      showFirebaseStatus('🔄 Syncing to Firebase...', 'info');
      
      if (!storageManager) {
        storageManager = new StorageManager();
        await storageManager.init();
      }
      
      await storageManager.saveUserSettings({
        pixvidApiKey: apiKey || '',
        imgbbApiKey: imgbbApiKey || '',
        defaultGallerySource: gallerySource || 'imgbb'
      });
      
      showFirebaseStatus('✅ Synced to Firebase', 'success');
      console.log('✅ Settings synced to Firebase');
    } else if (settings.firebaseConfig && !apiKey && !imgbbApiKey && !silent) {
      // Don't show error on auto-save, only on manual save
      showFirebaseStatus('ℹ️ Enter API keys to sync', 'info');
    }
  } catch (error) {
    console.warn('Could not sync to Firebase:', error);
    
    if (error.message && error.message.includes('PERMISSION_DENIED')) {
      showFirebaseStatus('❌ Firebase: Permission denied. Update Firestore rules.', 'error');
      showStatus('⚠️ Local settings saved. Firebase sync failed: Update Firestore security rules to allow reads/writes.', 'warning');
    } else {
      showFirebaseStatus('❌ Firebase sync failed', 'error');
    }
  }
  
  if (silent) {
    // Show auto-save indicator
    autoSaveIndicator.classList.add('show');
    setTimeout(() => {
      autoSaveIndicator.classList.remove('show');
    }, 2000);
  } else {
    showStatus('✅ Settings saved successfully!', 'success');
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
