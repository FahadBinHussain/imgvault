# Native Host and yt-dlp

## Purpose

`native-host` is the Windows native messaging companion for extension download workflows.

It is responsible for:

- host registration
- download command execution
- progress streaming
- output path handling
- cookie bridge for yt-dlp

Primary implementation: `native-host/src-tauri/src/main.rs`

## Command Strategy

Current yt-dlp args include:

- `-o <output template>`
- `-f bestvideo+bestaudio/best`
- `--merge-output-format mkv`
- `--windows-filenames`
- `--no-playlist`
- `--progress --newline`
- `--print after_move:filepath`

## Filename Strategy

Preferred output template (closest to original):

- `%(title)s [%(id)s].%(ext)s`

Automatic fallback when Windows write/path failure occurs:

- `%(title).180B [%(id)s].%(ext)s`

This keeps title readability + ID uniqueness while reducing path length risk.

## Facebook-Specific Failure Pattern

A frequent failure:

- very long/emoji-rich titles cause write errors like `unable to open for writing` or `No such file or directory`

Current mitigation:

- first run uses full title template
- on matching write/path errors, host retries once with byte-trimmed template

## Encoding Robustness

Progress stream parsing uses byte reads + lossy UTF-8 conversion to avoid hard failures on cp1252/non-UTF8 stderr output.

## Build Output

Main portable build command:

```powershell
cd native-host
pnpm portable:build
```

Portable executable path:

- `native-host/ImgVault-Native-Host.exe`

## Operational Note

If behavior appears unchanged after build, verify:

- extension reloaded
- updated native host executable actually installed/launched
- no stale copy of the host binary is still registered/running
