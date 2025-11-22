# ImgVault - Quick Start Guide

## Firebase is Already Configured!

Your Firebase project **imgvault-f028e** is ready to use.

---

## Step 1: Enable Firestore Database

> **Note:** Firestore has a generous free tier and does NOT require a credit card to get started!

1. Go to [Firebase Console](https://console.firebase.google.com/project/imgvault-f028e)
2. Click "Firestore Database" in the left menu
3. Click "Create database"
4. Choose "Start in production mode"
5. Select a location closest to you
6. Click "Enable"

## Step 2: Set Firestore Security Rules

1. In Firestore Database, click the "Rules" tab
2. Replace with these rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /images/{imageId} {
      allow read, write: if true;
    }
  }
}
```

3. Click "Publish"

## Step 3: Get Pixvid API Key

1. Go to https://pixvid.org
2. Sign up or log in
3. Go to Settings → API
4. Copy your API key

## Step 4: Load Extension

### Chrome/Edge/Brave
1. Open chrome://extensions
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select: c:\Users\Admin\Downloads\ImgVault\extension

### Firefox
1. Open about:debugging#/runtime/this-firefox
2. Click "Load Temporary Add-on"
3. Select manifest.json from extension folder

## Step 5: Configure Extension

1. Click ImgVault icon
2. Click Settings (gear icon)
3. Fill in:

**Pixvid API:**
- API Key: [Your Pixvid API key]

**Firebase:**
- API Key: AIzaSyC0iVmYfstlLaWagLR5utqjIBgVw8y_GdY
- Auth Domain: imgvault-f028e.firebaseapp.com
- Project ID: imgvault-f028e
- Storage Bucket: (leave empty - not needed for Firestore)
- Messaging Sender ID: 333865732308
- App ID: 1:333865732308:web:38a5e31b4b0aaf94f0d341

4. Click "Save Settings"

---

## How to Use

1. Right-click any image
2. Select "Save to ImgVault"
3. Add notes/tags (optional)
4. Click "Upload to ImgVault"
5. Done!

## View Your Data

**Firebase Console:**
https://console.firebase.google.com/project/imgvault-f028e/firestore

**Pixvid Dashboard:**
https://pixvid.org/dashboard

---

## Troubleshooting

**"Firebase not configured"**
- Complete Step 5 configuration
- Check all Firebase fields are correct

**"Pixvid API key not configured"**
- Get key from pixvid.org/settings/api
- Save settings after entering

**"Upload failed"**
- Check Firestore is enabled (Step 1)
- Check security rules (Step 2)
- Open browser console (F12) for errors

---

Ready to save images! 🚀
