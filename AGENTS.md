# imgvault

chrome extension (mv3, no build for ext itself; vite build outputs to `dist/`) + tauri rust native host for yt-dlp downloads.

- native host source: `native-host/src-tauri/src/main.rs`; build with `cargo build --release --target x86_64-pc-windows-gnu` and copy the exe to `native-host/ImgVault-Native-Host.exe`; rebuild + copy after every rust change, not just compile.
- extension edits: bump `"version"` in `nextgen-extension/public/manifest.json`, run `pnpm build`, then `start msedge http://reload.extensions`.
- push: token at `%APPDATA%\mainframe\accounts\github\fahadbinhussain@outlook.com\token.txt`, `git push https://x-access-token:$tok@github.com/fahadbinhussain/imgvault.git main`.
- vault items are soft-deleted to trash (un-vault + moveToTrash with `skipCollectionCount: true`); trash cards fail gracefully via onError placeholders + 12s timeout.
- ukdevilz.com mirrors VK videos; its own `videofile/{id}.mp4` is stale (Cloudflare challenge/404) and generic-extractor downloads fail. `rewrite_mirror_url()` in main.rs rewrites `/watch/{owner_id}_{video_id}` to `vk.com/video-{owner}_{video}` so yt-dlp uses its vk extractor. id format is `owner_video` with an underscore — the id filter must allow `_` (was missed once). apply to both download paths if adding url handling. same trick likely works for other vk mirrors.
- `--impersonate chrome` is added for all downloads (tiktok + generic hosts).
- lint broken (no eslint config), pre-existing.