# ImgVault - Cloud-Based Browser Extension

![ImgVault Logo](extension/icons/icon128.png)

ImgVault is a browser extension that saves images with full context metadata to the cloud. Right-click any image, save it to [Pixvid](https://pixvid.org), and store metadata in Firebase Firestore!

## Features

✨ **Context Menu Integration** - Right-click any image and select "Save to ImgVault"  
🖼️ **Image Preview** - See the image before uploading  
📝 **Smart Metadata** - Automatically captures source URL and page information  
✏️ **Editable Source** - Edit the page URL if needed  
🏷️ **Tags & Notes** - Add custom tags and notes to organize your images  
☁️ **Cloud Storage** - Firebase Firestore for permanent, accessible-anywhere metadata  
🔄 **Pixvid Integration** - Uploads images to Pixvid for permanent hosting  

## Installation

### 1. Set Up Firebase

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project (or use existing one)
3. Click on "Web" icon (</>) to add a web app
4. Register your app (name it "ImgVault")
5. Copy the Firebase configuration (you'll need this later)
6. Enable Firestore Database:
   - Go to Firestore Database in the left menu
   - Click "Create database"
   - Start in **production mode**
   - Choose a location close to you
7. Set up Firestore Security Rules:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /images/{imageId} {
         allow read, write: if true;  // For testing. Secure this later!
       }
     }
   }
   ```

### 2. Get Your Pixvid API Key

1. Go to [pixvid.org](https://pixvid.org)
2. Create an account or log in
3. Navigate to Settings → API
4. Copy your API key

### 3. Load the Extension

#### Chrome/Edge/Brave

1. Open your browser and go to `chrome://extensions/` (or `edge://extensions/`)
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension` folder from this project
5. The ImgVault extension should now be installed!

#### Firefox

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select the `manifest.json` file from the `extension` folder

### 4. Configure the Extension

1. Click the ImgVault extension icon in your browser toolbar
2. Click the Settings (⚙️) button
3. Fill in the **Pixvid API** section:
   - Enter your Pixvid API key
4. Fill in the **Firebase Configuration** section:
   - API Key: `your-firebase-api-key`
   - Auth Domain: `your-app.firebaseapp.com`
   - Project ID: `your-project-id`
   - Storage Bucket: `your-app.appspot.com`
   - Messaging Sender ID: `123456789`
   - App ID: `1:123456789:web:abc123`
5. Click "Save Settings"

## Usage

### Saving an Image

1. **Right-click** on any image on a webpage
2. Select **"Save to ImgVault"** from the context menu
3. The ImgVault popup will open showing:
   - Image preview
   - Source image URL (automatically captured)
   - Page URL (automatically captured, editable)
   - Optional notes field
   - Optional tags field
4. (Optional) Click the ✏️ icon to edit the page URL
5. (Optional) Add notes or tags
6. Click **"Upload to ImgVault"**
7. Your image will be uploaded to Pixvid and metadata saved to Firebase!

### Viewing Saved Images

All image metadata is stored in Firebase Firestore under the `images` collection with this structure:

```javascript
{
  id: "auto-generated-id",
  stored_url: "https://pixvid.org/images/...",
  source_image_url: "https://example.com/image.jpg",
  source_page_url: "https://example.com/page",
  page_title: "Example Page Title",
  file_type: "image/jpeg",
  file_size: 123456,
  tags: ["tag1", "tag2"],
  notes: "My notes about this image",
  created_at: Timestamp
}
```

You can view your data in the Firebase Console under Firestore Database.

## Project Structure

```
ImgVault/
├── extension/
│   ├── manifest.json       # Extension configuration
│   ├── background.js       # Service worker (handles uploads)
│   ├── storage.js          # Firebase Firestore management
│   ├── popup.html          # Extension popup UI
│   ├── popup.css           # Popup styling
│   ├── popup.js            # Popup logic
│   ├── content.js          # Content script
│   ├── lib/                # Firebase SDKs
│   │   ├── firebase-app.js
│   │   └── firebase-firestore.js
│   └── icons/              # Extension icons
├── archive/
│   └── backend/            # Old Go backend (deprecated)
└── README.md
```

## Technology Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Cloud Storage**: Firebase Firestore
- **Image Hosting**: Pixvid API (Chevereto)
- **Platform**: Chrome Extension Manifest V3

## Permissions

The extension requires these permissions:

- `contextMenus` - To add right-click menu option
- `activeTab` - To capture page information
- `storage` - To store settings locally
- `tabs` - To access page title and URL
- `https://pixvid.org/*` - To upload images to Pixvid
- `<all_urls>` - To capture images from any website

## Privacy

- Image metadata is stored in **your** Firebase project (you control the data)
- Only images are uploaded to Pixvid (using your API key)
- Your API keys are stored in browser's sync storage (encrypted by browser)
- No data is sent to any other third-party servers

## Security Recommendations

### Firebase Security Rules

For production use, update your Firestore security rules to restrict access:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /images/{imageId} {
      // Option 1: Authenticated users only (recommended)
      allow read, write: if request.auth != null;
      
      // Option 2: Specific user only
      // allow read, write: if request.auth.uid == "your-user-id";
    }
  }
}
```

Then enable Firebase Authentication in your project.

## Troubleshooting

### "Firebase not configured"
- Make sure you've entered all Firebase configuration fields
- Verify the values match your Firebase Console project settings
- Check browser console for detailed error messages

### "Pixvid API key not configured"
- Make sure you've entered your API key in Settings
- Verify the API key is correct from pixvid.org/settings/api

### "Failed to fetch image"
- The image might be protected or from a private network
- Try saving a different image

### "Upload failed"
- Check your Pixvid API key is valid
- Check your Firebase configuration is correct
- Ensure Firestore is enabled in your Firebase project
- Verify security rules allow writes
- Check browser console for detailed error messages

## Future Features

- [ ] Image gallery view to browse saved images
- [ ] Search and filter by tags, notes, or source
- [ ] Firebase Authentication integration
- [ ] Export metadata to JSON
- [ ] Bulk operations
- [ ] Custom upload services
- [ ] Multi-user support

## Cost Considerations

### Firebase Free Tier

- **Firestore**: 1 GB storage, 50K reads/day, 20K writes/day, 20K deletes/day
- Perfect for personal use!
- [Firebase Pricing](https://firebase.google.com/pricing)

### Pixvid

- Check their pricing and limits at [pixvid.org](https://pixvid.org)

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
