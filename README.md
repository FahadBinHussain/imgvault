# ImgVault

ImgVault is a browser-first media vault for saving images and videos with source context, metadata, duplicate detection, cloud hosting, and a native-host-assisted video workflow.

This repo currently contains:
- `nextgen-extension`: the main browser extension built with React, Vite, Tailwind, and DaisyUI
- `native-host`: the desktop companion used for native messaging, default video folder detection, and host-assisted downloads
- `old extension`: older extension code kept for reference
- `web`: the web app built with Next.js, NextAuth, Drizzle, and Neon

## What ImgVault Does

ImgVault is built around two primary save flows:

- Images:
  - save from the browser context menu
  - review metadata before upload
  - upload to image hosts
  - store metadata and vault records in Firebase/Firestore

- Videos:
  - download through the native host
  - auto-detect the default Videos folder
  - reopen in the gallery upload flow
  - upload to video hosts
  - keep source and upload metadata in the vault

## Current Feature Set

- Save images from webpages with source context
- Upload images to Pixvid and/or ImgBB
- Upload videos to Filemoon and/or UDrop
- Native host integration for host-assisted downloads
- Auto handoff from downloaded file to gallery upload flow
- Collections for organizing saved media
- Trash flow for soft deletion and recovery
- Duplicate detection with context and hash-based checks
- Metadata extraction for file details and EXIF when available
- Themeable UI with DaisyUI-based theming
- Gallery, trash, settings, collections, and host management pages

## Repo Structure

```text
ImgVault/
├── nextgen-extension/   # Main browser extension
├── native-host/         # Native desktop companion
├── web/                 # Next.js web app and APIs
├── old extension/       # Older extension code
├── README.md
└── LICENSE
```

## Extension Overview

The extension is the main user-facing product.

Main areas:
- `src/pages`
  - `GalleryPage.jsx`
  - `TrashPage.jsx`
  - `SettingsPage.jsx`
  - `CollectionsPage.jsx`
  - `HostPage.jsx`
  - `PopupPage.jsx` source still exists, though the action popup is not currently wired in the manifest
- `src/components`
  - shared UI, navbar, theme controls, timeline scrollbar
- `src/background`
  - service worker logic
  - context menu handling
  - upload orchestration
  - native host messaging
- `src/utils`
  - uploaders
  - storage
  - metadata and duplicate-related helpers

Current extension capabilities include:
- image save via context menu
- gallery browsing and editing
- host page for native-host checks and downloads
- settings for API keys, Firebase config, and download folder
- themed UI across pages

## Native Host Overview

The native host is used when the browser alone is not enough, especially for video workflows.

Current responsibilities include:
- receiving native messaging commands from the extension
- returning the default Windows Videos directory
- running host-side download commands
- avoiding hardcoded placeholder download paths

The extension now sends a real output path instead of relying on a hardcoded native-host default token.

## Web App Overview

The `web` folder is a separate Next.js application for the broader ImgVault platform.

Current stack:
- Next.js App Router
- NextAuth
- Drizzle ORM
- Neon serverless Postgres
- Tailwind + DaisyUI

Current `web/src` layout includes:
- `src/app`
  - main app shell and routes
  - gallery page
  - trash page
  - settings page
  - links page
  - shared/public share page
  - API routes for auth, config, images, media, share, trash, and brand icon
- `src/db`
  - database connection and schema

Based on the current code, the web app is intended to support:
- authenticated access
- remote gallery/media views
- share links
- settings/config endpoints
- database-backed media and trash APIs

## Hosting Providers

Image hosting:
- Pixvid
- ImgBB

Video hosting:
- Filemoon
- UDrop

Configuration happens through the extension settings page.

## Storage

ImgVault uses a mix of browser storage and Firebase-backed storage:

- `chrome.storage`
  - API keys
  - settings
  - local extension state
- IndexedDB
  - persisted directory handles for download-folder reuse
- Firebase / Firestore
  - vault records
  - collections
  - trash
  - synced user settings

Extension implementation notes such as gallery snapshot fields live under:
- `nextgen-extension/docs`

## Typical Workflows

### Save an image

1. Right-click an image on a webpage
2. Choose `Save to ImgVault`
3. Review metadata in the extension UI
4. Upload to configured image hosts
5. Store the final record in the vault

### Save a video

1. Open the Host page in the extension
2. Send a video URL to the native host
3. Download the file to the configured or detected Videos folder
4. Reopen the gallery upload flow automatically
5. Upload the video to configured video hosts

## Local Development

### Extension

```powershell
cd nextgen-extension
pnpm install
pnpm build
```

Build output is written to:
- `nextgen-extension/dist`

The build also runs post-build copy steps for manifest/assets.

### Native Host

```powershell
cd native-host
pnpm install
```

The native host also includes Tauri/Rust components under:
- `native-host/src-tauri`

Depending on what you are changing, you may need to rebuild both the extension and the native host.

### Web App

```powershell
cd web
pnpm install
pnpm dev
```

Useful scripts in `web`:
- `pnpm dev`
- `pnpm build`
- `pnpm start`
- `pnpm lint`
- `pnpm db:generate`
- `pnpm db:migrate`
- `pnpm db:push`
- `pnpm db:studio`

## Loading the Extension

1. Open your Chromium extensions page:
   - `chrome://extensions`
   - or `edge://extensions`
2. Enable Developer Mode
3. Click `Load unpacked`
4. Select `nextgen-extension/dist`

## Settings You Will Usually Need

- Pixvid API key
- ImgBB API key
- Filemoon API key
- UDrop API keys
- Firebase config
- Default gallery source
- Download folder

## Notes About Current UX

- The extension icon currently does not use a wired popup in the manifest
- Image saving is already context-menu-based
- Video saving currently flows through the Host page and gallery upload handoff
- The repo still contains some older code and assets that are no longer the primary path

## Recent Updates And Lessons Learned

This section captures important implementation changes made during recent UI and metadata work:

- Firestore document coverage in web gallery:
  - `web/src/app/api/images/route.js` now fetches full Firestore documents instead of a narrow field mask.
  - This was required so Nerds view can show all expected fields from Firestore.

- Firestore value parsing:
  - Web API parsing now supports nested/map/array values more safely instead of only a narrow set of scalar types.
  - This avoids silent field drops in metadata-heavy records.

- Shared modal redaction behavior:
- Shared view keeps sensitive provider delete URLs visible as `REDACTED` instead of exposing raw values.

- Upload modal metadata UX:
  - Video uploads now use `For Noobs` and `For Nerds` tabs like the detail modal.
  - The stale `Total Firestore Fields` summary block was removed from the upload modal.
  - Source URL fields in native video flow preserve real source links when available.

- Toast notification overflow hardening:
  - Long notification text now wraps and remains inside the viewport instead of overflowing.
  - Do not expose `imgbbDeleteUrl` / `pixvidDeleteUrl` in public share pages.

- Firebase console deep link format:
  - Working format uses:
    - `/u/1/project/<projectId>/firestore/databases/-default-/data/~2F<collection>~2F<documentId>?view=panel-view`
  - `/(default)` path variants did not resolve reliably in this setup.
  - Collection resolution follows media state (`images` vs `trash`).

- Theme-driven border radius (DaisyUI v5):
  - Correct token is `--radius-box` (not `--rounded-box`).
  - Radius classes were moved away from hardcoded Tailwind rounded sizes toward token-based usage where possible.
  - If corners appear square in a theme, verify that theme’s `--radius-box` is non-zero.

- Extension/Web icon normalization:
  - Icon references were standardized to `1.png` where requested.
  - Existing `2.png` references were intentionally preserved.

## Build Note

When working on the extension, the main verification command is:

```powershell
cd nextgen-extension
pnpm build
```

## License

MIT. See [LICENSE](C:\Users\Admin\Downloads\ImgVault\LICENSE).
