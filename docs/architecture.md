# Architecture

## Components

1. Browser extension (`nextgen-extension`)
2. Native messaging host (`native-host`)
3. Web app + API (`web`)

## Extension Responsibilities

- Context menu capture (image/background/video frame paths)
- Upload orchestration (Pixvid/ImgBB/Filemoon/UDrop)
- Duplicate detection and metadata extraction
- Gallery/trash/settings/host pages
- Native messaging calls for video download and host commands

Primary files:

- `nextgen-extension/src/background/background.js`
- `nextgen-extension/src/pages/GalleryPage.jsx`
- `nextgen-extension/src/pages/HostPage.jsx`
- `nextgen-extension/src/utils/storage.js`
- `nextgen-extension/src/utils/uploaders.js`

## Native Host Responsibilities

- Register native messaging host manifest in Windows
- Execute yt-dlp download commands
- Return progress lines to extension
- Detect default Windows Videos folder
- Handle cookie passthrough for yt-dlp

Primary file:

- `native-host/src-tauri/src/main.rs`

## Web App Responsibilities

- Authenticated dashboard UX (gallery, trash, settings, links)
- Firestore-backed API proxy for media records
- Share-link lifecycle (create/list/revoke/fetch)
- User config persistence in Neon/Postgres

Primary files:

- `web/src/app/api/images/route.js`
- `web/src/app/api/share/route.js`
- `web/src/app/components/GalleryLightbox.jsx`
- `web/src/db/schema.js`

## Data Flow (Video)

1. User triggers native download from Host page
2. Extension sends native message (`nativeDownload`) with output template
3. Native host runs yt-dlp and streams progress
4. Native host returns final file path
5. Gallery attempts local file auto-load from saved folder handle
6. Modal opens for upload/save flow

## Data Flow (Image)

1. Context menu saves pending image context
2. Gallery opens and processes media
3. Duplicate detector + metadata extraction run
4. Selected upload providers return hosted URLs
5. Final media record stored with base and extra fields
