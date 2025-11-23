// settings.js - Settings page for ImgVault

const apiKeyInput = document.getElementById('apiKeyInput');
const imgbbApiKeyInput = document.getElementById('imgbbApiKeyInput');
const firebaseConfigPaste = document.getElementById('firebaseConfigPaste');
const defaultGallerySource = document.getElementById('defaultGallerySource');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const statusMessage = document.getElementById('statusMessage');
const autoSaveIndicator = document.getElementById('autoSaveIndicator');

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
firebaseConfigPaste.addEventListener('input', autoSave);
defaultGallerySource.addEventListener('change', autoSave);
saveSettingsBtn.addEventListener('click', () => saveSettings(false));

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
