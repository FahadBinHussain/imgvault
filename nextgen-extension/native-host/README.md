# ImgVault Native Messaging Host

A Tauri-based desktop application that enables native messaging between the ImgVault Chrome extension and the local system.

## Features

- **GUI Mode** (Default): Simple interface with a "Register" button to set up native messaging
- **Headless Mode** (`--native` flag): Listens for messages from the Chrome extension via stdin/stdout
- **Video Downloads**: Uses yt-dlp to download videos when requested by the extension

## Development

### Prerequisites

- Node.js and pnpm
- Rust and Cargo
- yt-dlp (must be in PATH)

### Install Dependencies

```bash
pnpm install
```

### Run in Development

```bash
pnpm tauri dev
```

### Build for Production

```bash
cd nextgen-extension/native-host
pnpm tauri:build
```

## Usage

### GUI Mode (Registration)

1. Run the application normally (double-click the .exe or run without arguments)
2. Click the "Register" button
3. The app will:
   - Write a `manifest.json` file in the app directory
   - Create a Windows registry key pointing to the manifest
   - Enable native messaging with Chrome

### Headless Mode (Native Messaging)

The Chrome extension will automatically launch the app with the `--native` flag when needed.

The app listens for JSON messages on stdin:

```json
{
  "action": "download",
  "url": "https://example.com/video",
  "output_path": "C:\\path\\to\\output.mp4"
}
```

And responds on stdout:

```json
{
  "success": true,
  "message": "Download complete",
  "file_path": "C:\\path\\to\\output.mp4"
}
```

## Extension Integration

The extension ID must be added to the manifest.json after registration. Edit the manifest to include your extension's ID:

```json
{
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID_HERE/"
  ]
}
```

## Notes

- Currently only supports Windows
- Requires yt-dlp to be installed and accessible in PATH
- The registry key is written to: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.imgvault.nativehost`
