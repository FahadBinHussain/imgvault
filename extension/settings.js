// settings.js - Settings page for ImgVault

const apiKeyInput = document.getElementById('apiKeyInput');
const firebaseConfigPaste = document.getElementById('firebaseConfigPaste');
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
firebaseConfigPaste.addEventListener('input', autoSave);
saveSettingsBtn.addEventListener('click', () => saveSettings(false));

async function loadSettings() {
  const settings = await chrome.storage.sync.get(['pixvidApiKey', 'firebaseConfigRaw', 'firebaseConfig']);
  
  if (settings.pixvidApiKey) {
    apiKeyInput.value = settings.pixvidApiKey;
  }
  
  if (settings.firebaseConfigRaw) {
    firebaseConfigPaste.value = settings.firebaseConfigRaw;
  } else if (settings.firebaseConfig) {
    firebaseConfigPaste.value = JSON.stringify(settings.firebaseConfig, null, 2);
  }
}

async function saveSettings(silent = false) {
  const apiKey = apiKeyInput.value.trim();
  const pastedText = firebaseConfigPaste.value.trim();
  
  // Save API key if present
  if (apiKey) {
    await chrome.storage.sync.set({ pixvidApiKey: apiKey });
  }
  
  // Save Firebase config if present
  if (pastedText) {
    // Parse config
    const extractValue = (key) => {
      const regex = new RegExp(key + '\\s*:\\s*["\']([^"\']+)["\']', 'i');
      const match = pastedText.match(regex);
      return match ? match[1] : null;
    };
    
    const firebaseConfig = {
      apiKey: extractValue('apiKey'),
      authDomain: extractValue('authDomain'),
      projectId: extractValue('projectId'),
      storageBucket: extractValue('storageBucket'),
      messagingSenderId: extractValue('messagingSenderId'),
      appId: extractValue('appId'),
      measurementId: extractValue('measurementId')
    };
    
    // Remove null values
    Object.keys(firebaseConfig).forEach(key => {
      if (!firebaseConfig[key]) delete firebaseConfig[key];
    });
    
    await chrome.storage.sync.set({ 
      firebaseConfig: firebaseConfig,
      firebaseConfigRaw: pastedText
    });
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
