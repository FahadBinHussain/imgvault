# Setup Instructions

## Quick Setup (3 Steps)

### 1. Install yt-dlp

Place `yt-dlp.exe` in the same folder as `ImgVault-Native-Host.exe`

Download from: https://github.com/yt-dlp/yt-dlp/releases/latest

OR install system-wide:
```bash
winget install yt-dlp
```

### 2. Register the Native Host

1. Run `ImgVault-Native-Host.exe`
2. Click the "Register" button
3. You should see "Successfully registered ImgVault Native Host!"
4. You can now close the app

**Note**: The manifest.json is automatically created with your extension ID built-in. You don't need to edit anything!

### 3. Test It

1. Open the ImgVault extension
2. Navigate to the extension's main page
3. Go to the `/debug` route (click Debug or type in URL bar)
4. Enter a YouTube URL
5. Click "Download with yt-dlp"
6. Check your Downloads folder (`C:\Users\Admin\Downloads\`)

## How It Works

- **GUI Mode** (default): Shows a registration interface
- **Headless Mode** (automatic): Extension launches it with `--native` flag to communicate
- **Registry**: Writes to `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.imgvault.nativehost`
- **Manifest**: Auto-generated in the same folder as the .exe with your extension ID: `johjkjkidbedgjmogpekmlpfakccnoan`

## Do I Need to Re-register After Rebuilding?

**Yes**, but only if:
- You moved the .exe to a different location
- You rebuilt and the exe path changed

**No**, if:
- You always run the same exe from the same location
- You only made changes to the extension (not the native host)

## Troubleshooting

### "Failed to communicate with native host"
- Make sure you clicked "Register" in the native host app
- Check that `manifest.json` exists in the same folder as the .exe
- Verify the extension ID in manifest.json matches: `johjkjkidbedgjmogpekmlpfakccnoan`

### "yt-dlp failed"
- Make sure `yt-dlp.exe` is in the same folder as the native host
- OR make sure yt-dlp is installed system-wide (in PATH)
- Try running `yt-dlp --version` in cmd to verify it's accessible

### "Permission denied"
- Run the native host as administrator when registering
- Check Windows registry: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.imgvault.nativehost`

### Download Works But File Not Found
- Check `C:\Users\Admin\Downloads\` folder
- The file name will be `yt-dlp-[timestamp].mp4`
