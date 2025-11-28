/**
 * @fileoverview Settings Page Component
 * @version 2.0.0
 */

import React, { useState, useEffect } from 'react';
import { Save, Check, ArrowLeft } from 'lucide-react';
import { Button, Input, Textarea, Card } from '../components/UI';
import { useChromeStorage } from '../hooks/useChromeExtension';

export default function SettingsPage() {
  const [pixvidApiKey, setPixvidApiKey] = useChromeStorage('pixvidApiKey', '', 'sync');
  const [imgbbApiKey, setImgbbApiKey] = useChromeStorage('imgbbApiKey', '', 'sync');
  const [firebaseConfigRaw, setFirebaseConfigRaw] = useChromeStorage('firebaseConfigRaw', '', 'sync');
  const [defaultGallerySource, setDefaultGallerySource] = useChromeStorage('defaultGallerySource', 'imgbb', 'sync');
  
  const [localPixvid, setLocalPixvid] = useState('');
  const [localImgbb, setLocalImgbb] = useState('');
  const [localFirebase, setLocalFirebase] = useState('');
  const [localGallerySource, setLocalGallerySource] = useState('imgbb');
  const [saved, setSaved] = useState(false);
  const [firebaseStatus, setFirebaseStatus] = useState('');

  const handleBack = () => {
    window.location.href = 'gallery.html';
  };

  useEffect(() => {
    setLocalPixvid(pixvidApiKey || '');
    setLocalImgbb(imgbbApiKey || '');
    setLocalFirebase(firebaseConfigRaw || '');
    setLocalGallerySource(defaultGallerySource || 'imgbb');
  }, [pixvidApiKey, imgbbApiKey, firebaseConfigRaw, defaultGallerySource]);

  // Auto-load settings from Firebase
  useEffect(() => {
    const loadFromFirebase = async () => {
      try {
        const firebaseConfig = await new Promise((resolve) => {
          chrome.storage.sync.get(['firebaseConfig'], (result) => {
            resolve(result.firebaseConfig);
          });
        });

        if (!firebaseConfig) return;

        setFirebaseStatus('🔄 Connecting to Firebase...');

        // Import StorageManager dynamically
        const { StorageManager } = await import('../utils/storage.js');
        const storageManager = new StorageManager();
        await storageManager.init();

        const firebaseSettings = await storageManager.getUserSettings();

        if (firebaseSettings) {
          let updated = false;

          // Only update if local values are empty AND Firebase has non-empty values
          if (!localPixvid && firebaseSettings.pixvidApiKey?.trim()) {
            setLocalPixvid(firebaseSettings.pixvidApiKey);
            setPixvidApiKey(firebaseSettings.pixvidApiKey);
            updated = true;
          }
          if (!localImgbb && firebaseSettings.imgbbApiKey?.trim()) {
            setLocalImgbb(firebaseSettings.imgbbApiKey);
            setImgbbApiKey(firebaseSettings.imgbbApiKey);
            updated = true;
          }
          if (firebaseSettings.defaultGallerySource?.trim()) {
            setLocalGallerySource(firebaseSettings.defaultGallerySource);
            setDefaultGallerySource(firebaseSettings.defaultGallerySource);
            updated = true;
          }

          if (updated) {
            setFirebaseStatus('✅ Settings loaded from Firebase');
          } else {
            setFirebaseStatus('ℹ️ Local settings already configured');
          }
        } else {
          setFirebaseStatus('ℹ️ No cloud settings found');
        }
      } catch (error) {
        console.error('Error loading from Firebase:', error);
        setFirebaseStatus('❌ Firebase sync failed');
      }
    };

    // Only auto-load if Firebase config is set
    if (firebaseConfigRaw) {
      loadFromFirebase();
    }
  }, [firebaseConfigRaw]); // Only re-run when Firebase config changes

  const handleSave = async () => {
    // Parse and validate Firebase config
    if (localFirebase) {
      try {
        let config;
        try {
          config = JSON.parse(localFirebase);
        } catch {
          // Try to extract from JavaScript object format
          const extractValue = (key) => {
            const regex = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`, 'i');
            const match = localFirebase.match(regex);
            return match ? match[1] : null;
          };

          config = {
            apiKey: extractValue('apiKey'),
            authDomain: extractValue('authDomain'),
            projectId: extractValue('projectId'),
            storageBucket: extractValue('storageBucket'),
            messagingSenderId: extractValue('messagingSenderId'),
            appId: extractValue('appId'),
            measurementId: extractValue('measurementId')
          };

          // Remove null values
          Object.keys(config).forEach(key => {
            if (!config[key]) delete config[key];
          });
        }

        // Validate critical fields
        if (!config.apiKey || !config.projectId) {
          alert('⚠️ Firebase config is missing critical fields (apiKey, projectId)');
          return;
        }

        await chrome.storage.sync.set({ 
          firebaseConfig: config,
          firebaseConfigRaw: localFirebase 
        });
      } catch (error) {
        alert('⚠️ Invalid Firebase configuration. Please check the format.');
        return;
      }
    }

    // Save other settings locally
    setPixvidApiKey(localPixvid);
    setImgbbApiKey(localImgbb);
    setDefaultGallerySource(localGallerySource);

    // Also save to Firebase if configured
    try {
      const firebaseConfig = await new Promise((resolve) => {
        chrome.storage.sync.get(['firebaseConfig'], (result) => {
          resolve(result.firebaseConfig);
        });
      });

      if (firebaseConfig && (localPixvid || localImgbb)) {
        setFirebaseStatus('☁️ Syncing to Firebase...');
        
        const { StorageManager } = await import('../utils/storage.js');
        const storageManager = new StorageManager();
        await storageManager.init();

        // Only save non-empty values to Firebase
        const settingsToSave = {};
        if (localPixvid) settingsToSave.pixvidApiKey = localPixvid;
        if (localImgbb) settingsToSave.imgbbApiKey = localImgbb;
        if (localGallerySource) settingsToSave.defaultGallerySource = localGallerySource;

        if (Object.keys(settingsToSave).length > 0) {
          await storageManager.saveUserSettings(settingsToSave);
          setFirebaseStatus('✅ Settings saved to Firebase');
        } else {
          setFirebaseStatus('ℹ️ No settings to sync to Firebase');
        }
      }
    } catch (error) {
      console.error('Error saving to Firebase:', error);
      setFirebaseStatus('⚠️ Saved locally, but Firebase sync failed');
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="backdrop-blur-2xl bg-white/5 border border-white/10 shadow-2xl rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-4">
            <Button
              onClick={handleBack}
              variant="secondary"
              className="!p-2 flex items-center justify-center"
              title="Back to Gallery"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-xl blur-md opacity-50"></div>
              <img src="/icons/icon48.png" alt="ImgVault" className="w-12 h-12 relative z-10 rounded-xl shadow-lg" />
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-300 to-secondary-300 bg-clip-text text-transparent">Settings</h1>
              <p className="text-sm text-slate-300 mt-1">Configure your ImgVault extension</p>
            </div>
          </div>
        </div>

        {/* Settings Form */}
        <div className="backdrop-blur-2xl bg-white/5 border border-white/10 shadow-2xl rounded-2xl p-8 space-y-8">
          {/* API Keys Section */}
          <div>
            <h2 className="text-xl font-semibold bg-gradient-to-r from-primary-300 to-secondary-300 bg-clip-text text-transparent mb-6 flex items-center gap-2">
              <span className="text-2xl">🔑</span>
              API Keys
            </h2>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2 flex items-center gap-2">
                  <span className="text-lg">⚡</span>
                  Pixvid API Key (Required)
                </label>
                <input
                  type="password"
                  value={localPixvid}
                  onChange={(e) => setLocalPixvid(e.target.value)}
                  placeholder="Enter your Pixvid API key"
                  className="w-full px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-600 
                           text-white placeholder-slate-400 
                           focus:outline-none focus:border-primary-500 focus:ring-2 
                           focus:ring-primary-500/20 transition-all shadow-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2 flex items-center gap-2">
                  <span className="text-lg">🖼️</span>
                  ImgBB API Key (Optional)
                </label>
                <input
                  type="password"
                  value={localImgbb}
                  onChange={(e) => setLocalImgbb(e.target.value)}
                  placeholder="Enter your ImgBB API key"
                  className="w-full px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-600 
                           text-white placeholder-slate-400 
                           focus:outline-none focus:border-primary-500 focus:ring-2 
                           focus:ring-primary-500/20 transition-all shadow-lg"
                />
              </div>
            </div>
          </div>

          {/* Firebase Configuration */}
          <div>
            <h2 className="text-xl font-semibold bg-gradient-to-r from-primary-300 to-secondary-300 bg-clip-text text-transparent mb-6 flex items-center gap-2">
              <span className="text-2xl">☁️</span>
              Firebase Configuration
            </h2>
            
            {/* Firebase Status */}
            {firebaseStatus && (
              <div className="mb-5 p-4 rounded-xl bg-gradient-to-r from-primary-500/10 to-secondary-500/10 border border-primary-500/30 shadow-lg">
                <p className="text-sm text-slate-200 font-medium">{firebaseStatus}</p>
              </div>
            )}
            
            <div>
              <label className="block text-sm font-medium text-slate-200 mb-2 flex items-center gap-2">
                <span className="text-lg">📝</span>
                Firebase Config (Paste from Firebase Console)
              </label>
              <textarea
                value={localFirebase}
                onChange={(e) => setLocalFirebase(e.target.value)}
                placeholder={`{
  "apiKey": "your-api-key",
  "authDomain": "your-project.firebaseapp.com",
  "projectId": "your-project-id",
  "storageBucket": "your-project.appspot.com",
  "messagingSenderId": "123456789",
  "appId": "your-app-id"
}`}
                rows={8}
                className="w-full px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-600 
                         text-white placeholder-slate-400 font-mono text-sm
                         focus:outline-none focus:border-primary-500 focus:ring-2 
                         focus:ring-primary-500/20 transition-all resize-none shadow-lg"
              />
              <p className="mt-3 text-xs text-slate-400 flex items-start gap-2">
                <span className="text-base">💡</span>
                <span>Get your Firebase config from the Firebase Console → Project Settings → General → Your apps</span>
              </p>
            </div>
          </div>

          {/* Gallery Preferences */}
          <div>
            <h2 className="text-xl font-semibold bg-gradient-to-r from-primary-300 to-secondary-300 bg-clip-text text-transparent mb-6 flex items-center gap-2">
              <span className="text-2xl">🎨</span>
              Gallery Preferences
            </h2>
            <div>
              <label className="block text-sm font-medium text-slate-200 mb-2 flex items-center gap-2">
                <span className="text-lg">🌟</span>
                Default Image Source
              </label>
              <select
                value={localGallerySource}
                onChange={(e) => setLocalGallerySource(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-600 
                         text-white cursor-pointer
                         focus:outline-none focus:border-primary-500 focus:ring-2 
                         focus:ring-primary-500/20 transition-all shadow-lg"
              >
                <option value="imgbb">ImgBB (Original Quality)</option>
                <option value="pixvid">Pixvid (Compressed Quality)</option>
              </select>
              <p className="mt-3 text-xs text-slate-400 flex items-start gap-2">
                <span className="text-base">💡</span>
                <span>Choose which service to display images from in the gallery</span>
              </p>
            </div>
          </div>

          {/* Save Button */}
          <div className="pt-4">
            <button
              onClick={handleSave}
              className="w-full px-6 py-4 rounded-xl bg-gradient-to-r from-primary-500 to-secondary-500 
                       hover:from-primary-600 hover:to-secondary-600 text-white font-semibold text-lg
                       shadow-2xl hover:shadow-[0_8px_30px_rgb(99,102,241,0.4)]
                       transform transition-all duration-300 ease-out
                       hover:scale-105 active:scale-95
                       flex items-center justify-center gap-3"
            >
              {saved ? (
                <>
                  <Check className="w-6 h-6" />
                  <span>Saved Successfully!</span>
                </>
              ) : (
                <>
                  <Save className="w-6 h-6" />
                  <span>Save Settings</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Help Section */}
        <div className="backdrop-blur-2xl bg-white/5 border border-white/10 shadow-2xl rounded-2xl p-6 mt-6">
          <h2 className="text-lg font-semibold bg-gradient-to-r from-primary-300 to-secondary-300 bg-clip-text text-transparent mb-4 flex items-center gap-2">
            <span className="text-xl">❓</span>
            Need Help?
          </h2>
          <div className="space-y-3 text-sm text-slate-300">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
              <span className="text-lg flex-shrink-0">⚡</span>
              <div>
                <strong className="text-white">Pixvid API Key:</strong> Get it from{' '}
                <a
                  href="https://pixvid.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-300 hover:text-primary-200 underline font-medium"
                >
                  pixvid.org
                </a>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
              <span className="text-lg flex-shrink-0">🖼️</span>
              <div>
                <strong className="text-white">ImgBB API Key:</strong> Get it from{' '}
                <a
                  href="https://api.imgbb.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-300 hover:text-primary-200 underline font-medium"
                >
                  api.imgbb.com
                </a>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
              <span className="text-lg flex-shrink-0">☁️</span>
              <div>
                <strong className="text-white">Firebase:</strong> Create a project at{' '}
                <a
                  href="https://console.firebase.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-300 hover:text-primary-200 underline font-medium"
                >
                  Firebase Console
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
