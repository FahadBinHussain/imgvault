/**
 * @fileoverview Settings Page Component
 * @version 2.0.0
 */

import React, { useState, useEffect } from 'react';
import { Save, Check } from 'lucide-react';
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

      if (firebaseConfig) {
        setFirebaseStatus('☁️ Syncing to Firebase...');
        
        const { StorageManager } = await import('../utils/storage.js');
        const storageManager = new StorageManager();
        await storageManager.init();

        await storageManager.saveUserSettings({
          pixvidApiKey: localPixvid,
          imgbbApiKey: localImgbb,
          defaultGallerySource: localGallerySource
        });

        setFirebaseStatus('✅ Settings saved to Firebase');
      }
    } catch (error) {
      console.error('Error saving to Firebase:', error);
      setFirebaseStatus('⚠️ Saved locally, but Firebase sync failed');
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="min-h-screen bg-gradient-primary p-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="glass-card rounded-xl p-6 mb-6">
          <div className="flex items-center gap-3">
            <img src="/icons/icon48.png" alt="ImgVault" className="w-10 h-10" />
            <div>
              <h1 className="text-2xl font-bold gradient-text">Settings</h1>
              <p className="text-sm text-slate-300">Configure your ImgVault extension</p>
            </div>
          </div>
        </div>

        {/* Settings Form */}
        <Card className="space-y-6">
          {/* API Keys Section */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-4">API Keys</h2>
            <div className="space-y-4">
              <Input
                label="Pixvid API Key (Required)"
                type="password"
                value={localPixvid}
                onChange={(e) => setLocalPixvid(e.target.value)}
                placeholder="Enter your Pixvid API key"
              />
              <Input
                label="ImgBB API Key (Optional)"
                type="password"
                value={localImgbb}
                onChange={(e) => setLocalImgbb(e.target.value)}
                placeholder="Enter your ImgBB API key"
              />
            </div>
          </div>

          {/* Firebase Configuration */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-4">Firebase Configuration</h2>
            
            {/* Firebase Status */}
            {firebaseStatus && (
              <div className="mb-4 p-3 rounded-lg bg-white/5 border border-white/10">
                <p className="text-sm text-slate-200">{firebaseStatus}</p>
              </div>
            )}
            
            <Textarea
              label="Firebase Config (Paste from Firebase Console)"
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
              className="font-mono text-sm"
            />
            <p className="mt-2 text-xs text-slate-400">
              Get your Firebase config from the Firebase Console → Project Settings → General → Your apps
            </p>
          </div>

          {/* Gallery Preferences */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-4">Gallery Preferences</h2>
            <div>
              <label className="block text-sm font-medium text-slate-200 mb-2">
                Default Image Source
              </label>
              <select
                value={localGallerySource}
                onChange={(e) => setLocalGallerySource(e.target.value)}
                className="w-full px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white
                         focus:outline-none focus:ring-2 focus:ring-primary-400"
              >
                <option value="imgbb">ImgBB (faster loading)</option>
                <option value="pixvid">Pixvid</option>
              </select>
              <p className="mt-2 text-xs text-slate-400">
                Choose which service to display images from in the gallery
              </p>
            </div>
          </div>

          {/* Save Button */}
          <div className="pt-4">
            <Button
              variant="primary"
              className="w-full"
              onClick={handleSave}
            >
              {saved ? (
                <div className="flex items-center justify-center gap-2">
                  <Check className="w-5 h-5" />
                  <span>Saved!</span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <Save className="w-5 h-5" />
                  <span>Save Settings</span>
                </div>
              )}
            </Button>
          </div>
        </Card>

        {/* Help Section */}
        <Card className="mt-6">
          <h2 className="text-lg font-semibold text-white mb-3">Need Help?</h2>
          <div className="space-y-2 text-sm text-slate-300">
            <p>
              <strong className="text-white">Pixvid API Key:</strong> Get it from{' '}
              <a
                href="https://pixvid.org"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-300 hover:text-primary-200 underline"
              >
                pixvid.org
              </a>
            </p>
            <p>
              <strong className="text-white">ImgBB API Key:</strong> Get it from{' '}
              <a
                href="https://api.imgbb.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-300 hover:text-primary-200 underline"
              >
                api.imgbb.com
              </a>
            </p>
            <p>
              <strong className="text-white">Firebase:</strong> Create a project at{' '}
              <a
                href="https://console.firebase.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-300 hover:text-primary-200 underline"
              >
                Firebase Console
              </a>
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
