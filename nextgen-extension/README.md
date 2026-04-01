# ImgVault

A modern Chrome extension built with **React**, **Vite**, and **Tailwind CSS** for saving images with context and metadata.

## 🚀 Tech Stack

- **React 18** - Modern UI library with hooks
- **Vite** - Lightning-fast build tool
- **Tailwind CSS** - Utility-first CSS framework
- **Zustand** - Lightweight state management
- **Lucide React** - Beautiful icon library

## 📦 Features

- 🎨 Modern, glassmorphic UI design
- 🔍 Advanced duplicate detection with perceptual hashing
- ☁️ Dual upload to Pixvid and ImgBB
- 🔥 Firebase Firestore backend
- 🖼️ Beautiful gallery with search
- 🏷️ Tags and descriptions
- 📱 Responsive design

## 🛠️ Development Setup

### Prerequisites

- Node.js 18+ and pnpm
- Chrome browser

### Installation

```powershell
# Navigate to the extension directory
cd nextgen-extension

# Install dependencies
pnpm install

# Build for development
pnpm dev

# Build for production
pnpm build
```

### Loading the Extension

1. Build the extension: `pnpm build`
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `dist` folder

## 📁 Project Structure

```
nextgen-extension/
├── src/
│   ├── background/          # Service worker
│   │   └── background.js
│   ├── content/             # Content scripts
│   │   └── content.js
│   ├── components/          # Reusable React components
│   │   └── UI.jsx
│   ├── pages/               # Page components
│   │   ├── PopupPage.jsx
│   │   ├── GalleryPage.jsx
│   │   └── SettingsPage.jsx
│   ├── hooks/               # Custom React hooks
│   │   └── useChromeExtension.js
│   ├── stores/              # Zustand stores
│   │   └── appStore.js
│   ├── utils/               # Utility modules
│   │   ├── storage.js
│   │   ├── duplicate-detector.js
│   │   ├── url-normalizer.js
│   │   └── uploaders.js
│   ├── popup.jsx            # Popup entry
│   ├── gallery.jsx          # Gallery entry
│   ├── settings.jsx         # Settings entry
│   └── index.css            # Global styles
├── icons/                   # Extension icons
├── popup.html               # Popup HTML
├── gallery.html             # Gallery HTML
├── settings.html            # Settings HTML
├── manifest.json            # Extension manifest
├── vite.config.js           # Vite configuration
├── tailwind.config.js       # Tailwind configuration
├── postcss.config.js        # PostCSS configuration
└── package.json             # Dependencies
```

## 🔧 Configuration

### API Keys

1. **Pixvid API Key** (Required)
   - Get from [pixvid.org](https://pixvid.org)

2. **ImgBB API Key** (Optional)
   - Get from [api.imgbb.com](https://api.imgbb.com)

3. **Firebase Configuration** (Required)
   - Create a project at [Firebase Console](https://console.firebase.google.com)
   - Enable Firestore Database
   - Copy the config from Project Settings → General → Your apps

### Settings Page

Access the settings by clicking the settings icon in the extension popup or gallery.

## 🎨 Customization

### Tailwind Theme

Modify `tailwind.config.js` to customize colors, spacing, and other design tokens.

### Components

All UI components are in `src/components/UI.jsx` and can be easily customized.

## 📝 Scripts

- `pnpm dev` - Start development server with hot reload
- `pnpm build` - Build for production
- `pnpm preview` - Preview production build
- `pnpm lint` - Run ESLint

### Clean Build

```powershell
# Remove node_modules
Remove-Item -Recurse -Force node_modules

# Reinstall and build
pnpm install
pnpm build
```

## 🔄 Migration from Legacy Extension

The original extension code is preserved in the `extension` folder. The next-gen version includes:

- ✅ Modern React-based UI
- ✅ Better state management with Zustand
- ✅ Improved performance with Vite
- ✅ Cleaner component architecture
- ✅ Better code organization
- ✅ Type safety with JSDoc
- ✅ Modern CSS with Tailwind

## 📖 Architecture

### Service Worker (Background)

- Handles context menu
- Manages image uploads
- Coordinates with storage and duplicate detection

### Content Script

- Captures page metadata
- Extracts high-resolution image URLs

### React Pages

- **Popup**: Main image upload interface
- **Gallery**: Grid view of saved images
- **Settings**: Configuration panel

### Custom Hooks

- `useChromeStorage`: Chrome storage with React state
- `useChromeMessage`: Send messages to background
- `useImageUpload`: Handle image uploads
- `useImages`: Manage gallery images
- `usePendingImage`: Handle pending image data

## 🐛 Troubleshooting

### Build Issues

```powershell
# Clear node_modules and reinstall
Remove-Item node_modules -Recurse -Force
pnpm install
```

### Extension Not Loading

1. Ensure you've built the extension (`pnpm build`)
2. Load the `dist` folder, not the root folder
3. Check the Chrome DevTools console for errors

### API Key Issues

1. Verify API keys are correct in Settings
2. Check Firebase configuration is valid JSON
3. Ensure Firestore is enabled in Firebase Console

## 📄 License

Same as the original ImgVault project.

## 🤝 Contributing

This is a modernization of the original ImgVault extension. The original code is preserved for reference.
