# ImgVault Next-Gen 🚀

<p align="center">
  <img src="extension/icons/icon.svg" alt="ImgVault Logo" width="128" height="128">
</p>

**Modern browser extension for saving images with advanced duplicate detection, metadata extraction, and cloud hosting.**

Built with React + Vite + Tailwind CSS for a next-generation user experience.

## ✨ Features

### 🎯 Core Features
- **Smart Image Saving**: Right-click any image → save to your personal vault
- **Dual Cloud Hosting**: Uploads to Pixvid + ImgBB for redundancy
- **Firebase Backend**: Secure cloud storage with Firestore
- **Collections**: Organize images into custom collections
- **Trash System**: Soft delete with restore capability (hosts preserved)

### 🔍 Advanced Duplicate Detection
- **Real-time Progress**: See scan progress across all images
- **Multi-algorithm Detection**:
  - **Context Matching**: Same source URL + page URL
  - **Exact Matching**: SHA-256 file hash comparison
  - **Visual Similarity**: Triple perceptual hashing (pHash, aHash, dHash)
- **Comprehensive Results**: View all duplicate matches with similarity scores
- **Smart UI**: Duplicate section at top of upload form with detailed match info

### ⌨️ Keyboard Shortcuts
- **Arrow Keys**: Navigate between images in modal (← →)
- **Escape**: Close modals / exit selection mode
- **Delete**: Delete selected image
- **U**: Open upload modal
- **S**: Toggle selection mode
- **/** or **Ctrl+K**: Focus search
- **Ctrl+S**: Save image (in modal)

### 📊 Rich Metadata
- **EXIF Data**: Camera info, timestamps, GPS (if available)
- **File Details**: Type, size, dimensions, hashes
- **Source Tracking**: Original URL, page context
- **Custom Fields**: Title, description, tags
- **Creation Date**: Smart detection (EXIF → file timestamp → upload date)

### 🎨 Modern UI/UX
- **Timeline Scrollbar**: Visual timeline of saved images
- **Two-Tab System**: 
  - "For Noobs 👶": Clean, essential info
  - "For Nerds 🤓": Complete technical details
- **Site Quality Badges**: Warns about low-quality sources
- **Responsive Design**: Tailwind CSS powered interface
- **Smooth Animations**: Framer Motion transitions

## 🚀 Quick Setup

### 1. Firebase Setup
1. Create project at [Firebase Console](https://console.firebase.com)
2. Add web app, copy config
3. Enable **Firestore Database**
4. Set Firestore rules:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /images/{imageId} { allow read, write: if true; }
    match /trash/{imageId} { allow read, write: if true; }
    match /collections/{collectionId} { allow read, write: if true; }
    match /userSettings/{document} { allow read, write: if true; }
  }
}
```

### 2. API Keys
Get API keys from these services (works with either one or both):
- **Pixvid**: [pixvid.org/settings/api](https://pixvid.org/settings/api)
- **ImgBB**: [api.imgbb.com](https://api.imgbb.com/) ⭐ Recommended

### 3. Build Extension
```bash
# Clone repository
git clone <repo-url>
cd ImgVault

# Install dependencies
pnpm install

# Navigate to nextgen extension
cd nextgen-extension

# Build the extension (icons and manifest are automatically copied)
pnpm run build

# Extension will be ready in dist/ folder
```

> **Note**: The build process automatically copies `icons/`, `manifest.json`, and CSS fixes to the `dist/` folder via the `postbuild.ps1` script. No manual copying needed!

### 4. Install in Browser
1. Open `chrome://extensions/` (or `edge://extensions/`)
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `nextgen-extension/dist` folder
5. Click extension icon → **Settings**
6. Configure:
   - Add Firebase config (paste JSON from Firebase console)
   - Add Pixvid and/or ImgBB API keys
7. Start saving images! 🎉

## 📖 Usage Guide

### Saving Images
1. **Right-click** any image on a webpage
2. Select **"Save to ImgVault"**
3. Review duplicate warnings (if any)
4. Edit metadata (title, description, tags)
5. Choose collection (optional)
6. Click **Upload**

### Viewing Gallery
- Click extension icon → **Gallery**
- Browse your saved images
- Use **timeline scrollbar** for quick navigation
- Click image for detailed view
- Use **arrow keys** to navigate between images

### Managing Images
- **Edit**: Click image → modify fields → Save (Ctrl+S)
- **Delete**: Click trash icon → moved to trash
- **Restore**: Open trash → click restore icon
- **Permanent Delete**: Empty trash to free up space

### Collections
- **Create**: Gallery → New Collection
- **Add Images**: Upload modal → Select collection
- **View**: Gallery → Filter by collection
- **Manage**: Edit collection names, delete collections

## 🛠️ Tech Stack

### Frontend
- **React 18**: Modern UI framework
- **Vite**: Lightning-fast build tool
- **Tailwind CSS**: Utility-first styling
- **Framer Motion**: Smooth animations
- **Zustand**: State management
- **Lucide Icons**: Beautiful icon library

### Backend & APIs
- **Firebase Firestore**: Cloud database
- **Pixvid API**: Primary image hosting
- **ImgBB API**: Secondary image hosting
- **Chrome Extension MV3**: Manifest V3 architecture

### Image Processing
- **Perceptual Hashing**: pHash, aHash, dHash algorithms
- **SHA-256**: Cryptographic file hashing
- **EXIF Reading**: exifr library for metadata extraction
- **Canvas API**: Image analysis and hash generation

## 📁 Project Structure

```
ImgVault/
├── extension/               # Legacy extension (vanilla JS)
├── nextgen-extension/       # Modern React extension ⭐
│   ├── src/
│   │   ├── pages/          # Gallery, Settings, Trash, Popup
│   │   ├── components/     # Reusable UI components
│   │   ├── hooks/          # Custom React hooks
│   │   ├── utils/          # Duplicate detection, uploaders
│   │   ├── config/         # Site quality config
│   │   └── background/     # Service worker
│   ├── dist/               # Built extension (after pnpm run build)
│   └── vite.config.js      # Vite configuration
└── README.md
```

## 🎯 Keyboard Shortcuts Reference

| Shortcut | Action | Context |
|----------|--------|---------|
| **← →** | Navigate images | Image modal |
| **Escape** | Close modal | Any modal |
| **Delete** | Delete image | Image modal |
| **U** | Open upload | Gallery |
| **S** | Selection mode | Gallery |
| **/** | Focus search | Gallery |
| **Ctrl+K** | Focus search | Gallery |
| **Ctrl+S** | Save changes | Image modal |

## 🌐 Supported Quality Sites

### ⭐ High Quality (Best Sources)
10 Eastern, Axoft Global, Divnil, Etsy, Facebook, Flickr, Glamping Hub, GoodFon, Instagram, JNGSainui, Note, Reddit, SlideShare, TripAdvisor, WallpapersDen, Wallpaper Cave, Yelp

### ⚠️ Warning Sites (Download Original)
Airbnb, Alpha Coders, ArtStation, Backiee, Google Drive, PeakPX, Sohu, Unsplash, WallHere, Wallpaper Mob

## 🔐 Privacy & Security
- **Local First**: All processing happens in your browser
- **Your Data**: You control Firebase and hosting accounts
- **No Tracking**: Zero telemetry or analytics
- **Open Source**: Full code transparency

## 🤝 Contributing

Contributions are welcome! Areas for improvement:
- Additional perceptual hash algorithms
- More site-specific optimizations  
- UI/UX enhancements
- Performance optimizations
- Bug fixes

Please open an issue or submit a pull request.

## 📝 License

MIT License - See [LICENSE](LICENSE) file for details.

## 🆘 Support

For issues or questions:
- **GitHub Issues**: Report bugs or request features
- **Firebase Docs**: [firebase.google.com/docs/firestore](https://firebase.google.com/docs/firestore)
- **Pixvid API**: Check API documentation
- **ImgBB API**: [api.imgbb.com](https://api.imgbb.com/)

---

**Made with ❤️ by digital packrats, for digital packrats**

*Perfect for photographers, designers, researchers, and anyone who hoards images like treasure* 🖼️✨
