# ImgVault Native Host

Headless native messaging host for the ImgVault Chrome extension.

## How it works

- Run `ImgVault-Native-Host.exe` once.
- It registers itself for the ImgVault extension and exits.
- After that, the extension talks to it through Chrome native messaging.

When Chrome launches it for native messaging, the host runs in `--native` mode automatically.

## Build

Prerequisites:

- Rust and Cargo
- `yt-dlp` available on the machine

Build the single-file host:

```bash
pnpm portable:build
```

That produces:

- `native-host/ImgVault-Native-Host.exe`

## Registration

Running the exe normally will:

- write `manifest.json` next to the exe
- register `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.imgvault.nativehost`
- allow the extension ID `johjkjkidbedgjmogpekmlpfakccnoan`

## Notes

- Windows only
- No WebView2 UI runtime is required anymore
- The extension is now the main UI
