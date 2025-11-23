# ImgVault

Browser extension to save images with metadata to Pixvid/ImgBB + Firebase Firestore.

## Quick Setup

### 1. Firebase Setup
1. Create project at [Firebase Console](https://console.firebase.google.com)
2. Add web app, copy config
3. Enable Firestore Database
4. Set Firestore rules:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /images/{imageId} { allow read, write: if true; }
    match /userSettings/{document} { allow read, write: if true; }
  }
}
```

### 2. API Keys (works with only one as well)
- **Pixvid**: [pixvid.org/settings/api](https://pixvid.org/settings/api)
- **ImgBB**: [api.imgbb.com](https://api.imgbb.com/)

### 3. Install Extension
1. Open `chrome://extensions/`
2. Enable Developer mode
3. Load unpacked → select `extension` folder
4. Configure in Settings: Firebase config → API keys

## Usage
- Right-click image → "Save to ImgVault"
- View saved images in Gallery

## Tech Stack
- Vanilla JS + Chrome Extension MV3
- Firebase Firestore
- Pixvid/ImgBB APIs

- Perfect for personal use!

## License

MIT License - See LICENSE file for details

## Contributing

Contributions welcome! Please open an issue or submit a pull request.

## Support

For issues or questions:
- Open an issue on GitHub
- Check Firebase documentation for Firestore-related questions
- Check Pixvid documentation for API-related questions

---

**Made with ❤️ for digital packrats and cloud enthusiasts**
