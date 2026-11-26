# ImgVault Android — Plan

**Goal:** an Android client that mirrors the Chrome extension — gallery, vault, upload,
trash, settings — so users can use ImgVault directly from Android. Plus a share-intent
flow: share a reel or file from any app and the app auto-detects and uploads it.

**Status:** plan phase (2026-11-26). Extension inventory done (see §1). Repo + reel-download
approach still need the user's call (§7).

---

## 1. What the Android app must mirror (extension inventory, 2026-11-26)

Source: `FahadBinHussain/imgvault` (extension `nextgen-extension/`, web `web/`,
shared `packages/`). All paths relative to that repo.

- **Gallery** — one feed for `kind` in (`image`, `video`, `link`) + scenes (3D `.spz`).
  Text search, sort newest/oldest, collection/tag/kind filter. Detail modal with zoom +
  minibar, video player with a per-host source picker (plays ONLY the selected host,
  loud picker on failure — no silent fallback).
- **Vault** — encrypted blobs (IVG1) on **TeraBox + Telegram**. Upload: encrypt file →
  upload copies to both hosts → `saveVaultedUpload`. View: range-fetch 1 MiB at a time,
  accumulate 8 MiB blocks, decrypt. Move gallery items in/out of the vault.
- **Upload** — input is either a local file **or a URL** (the extension's
  `handleImageUpload` already accepts both). Images → ImgBB (original) / Pixvid
  (compressed) / Telegram (document, byte-faithful); videos → Filemoon / uDrop /
  Telegram; audio → uDrop (Filemoon is video-only); 3D `.spz` → uDrop. Duplicate
  detection by SHA-256/pHash (upload rejects with `duplicate` + `allDuplicates`).
  Upload runs are journaled with heartbeat recovery (a crash never leaves the UI
  stuck on "Uploading…").
- **Trash** — soft delete (`deleted_at` set). Restore (re-vaults on any
  vault-provenance marker). Permanent delete = delete host blobs + delete Telegram
  posts + delete the row. Since 2.19.50: on the Bot API `message can't be deleted`
  age error, the extension asks the native host (Telethon `telegram_verify`) whether
  the post is gone before releasing the row.
- **Settings** — API keys + default sources (`defaultGallerySource` imgbb,
  `defaultVideoSource` filemoon, `default3DSource` udrop). Saved to Neon
  `public.settings` (id=`config`) and `chrome.storage.sync`.
- **Link previews** — og:image/title fetched + stored (hotlink, rots; self-healing
  refresh exists). Link items are `kind='link'` with `link_url`, `link_url_canonical`,
  `favicon_url`, `last_visited_at`.
- **Data model** — `public.media_items` (id, kind, page_title, description, tags jsonb,
  collection_id, file_name, file_size, width/height, duration, sha256, p_hash, exif +
  extra_metadata jsonb, per-host URL columns, `deleted_at` for trash). **Vault fields
  live inside `extra_metadata` JSONB** (spread into the item by `fromNeonMediaRow`).
  `public.settings` holds the host API keys; `public.collections` holds collections.
  **Telegram token/channel and the TeraBox cookie are NOT in Neon** — they live in
  `chrome.storage.sync` (`telegramBotToken`, `telegramChannel`, `teraboxCookie`).
- **Neon access** — the extension uses `@neondatabase/serverless` (fetch-based HTTP):
  POST `{query, params}` to `https://<host with first DNS label replaced by api.>/sql`,
  headers `Neon-Connection-String`, `Neon-Raw-Text-Output: true`,
  `Neon-Array-Mode: true`. The connection string comes from `chrome.storage.sync`
  key `neonDatabaseUrl`.
- **Vault crypto** (`packages/shared/vaultCrypto.js`) — random 256-bit AES-GCM master
  key encrypts blobs + metadata. Passcode → PBKDF2-HMAC-SHA256, 100,000 iterations,
  16-byte salts → wraps the master key. Blob format **IVG1**: 16-byte header
  (`"IVG1"` + total size u64 LE + chunkSize u32 LE) + **8 MiB** chunks, each
  12-byte IV + ciphertext + 16-byte tag (28 B overhead/chunk). Metadata is single-shot
  AES-GCM, base64 in `encryptedMetadata`. The passcode is never stored.
- **Share-relevant** — the extension has context menus (save image/link/YouTube frame)
  but **no inbound share receiver**. The upload entry point already accepts both a
  file and a URL, so Android `ACTION_SEND` maps cleanly: `EXTRA_STREAM` → file,
  `EXTRA_TEXT` (URL) → URL path.

## 2. Architecture decision (the big one — user's correction, 2026-11-26 11:05)

**Self-hosted, per user. The app ships with ZERO secrets.** Each user enters their
OWN self-hosted backend in Settings — their own Neon database URL, their own
Telegram bot token + channel, their own host API keys — exactly like the extension's
Settings page. The app then works from that. Nothing of anyone's is in the APK or
the repo, so there is nothing to leak. (My earlier "APK is extractable" framing was
wrong-headed: extraction only matters if secrets are embedded, and here none are.)

- **V1: the app talks to the user's OWN ImgVault backend** (their Neon + their
  hosts), configured once in Settings — the same model as the extension. Keys live
  in `EncryptedSharedPreferences` + Android Keystore, **never in the repo or the
  APK**. No new server for V1.
- **Neon from Android:** the Neon HTTP API is plain HTTPS POSTs (the same shape as
  `@neondatabase/serverless`). OkHttp does it directly — no JDBC, no new dependency.
- **Later (Phase 5):** a thin backend on the existing web app
  (`imgvaultt.vercel.app`, NextAuth + Drizzle already exist) with per-user auth, so
  users don't have to paste keys. That is a separate job, not V1.

## 3. Tech stack (his standard)

- **Language/UI:** Kotlin, Jetpack Compose (BOM 2025.01.00), Material 3.
- **Architecture:** MVVM + ViewModel + Navigation Compose, Coroutines + StateFlow.
- **Data:** OkHttp + Kotlinx Serialization; Room (local cache: thumbnails, offline
  gallery); DataStore (settings); WorkManager (background uploads — a share-intent
  upload must finish even if the app is closed).
- **Media:** Coil (images), Media3 ExoPlayer (video).
- **Secrets:** Android Keystore + EncryptedSharedPreferences (host keys, Neon URL,
  Telegram token, TeraBox cookie, vault master key). Never plaintext.
- **Vault crypto:** `javax.crypto` — PBKDF2-HMAC-SHA256 (100k), AES-256-GCM, IVG1
  header/chunk layout. A direct port of `packages/shared/vaultCrypto.js`; the
  `check-shared-twins` rule means the JS stays the source of truth for the format.
- **Build: GitHub Actions ONLY.** Never Gradle on his Windows PC (it hangs it).
  CI builds + publishes the APK. Locally: lightweight checks + ADB install of CI
  APKs. Tests gate the release (same as ImgVault's `gate-tests`).
- **OTA (user's call, 2026-11-26 11:08 — keep it simple):** OTA is just a
  convenient updater, not a gating system. The app checks a public manifest on
  launch; if a newer version exists it downloads the APK and installs it through
  the system prompt. Simple release-based flow: `GET /api/app-release` manifest
  (versionName, versionCode, sizeBytes, sha256, downloadUrl), SHA-256 verified
  download, install via `PackageInstaller` with the system install prompt (user
  action required — silent install is impossible for a sideloaded app). No
  server-enforced minimum-version floor for V1 (that is a later concern, only if
  a breaking change ever needs it). Release server: the existing web app
  (`imgvaultt.vercel.app`) serving the public manifest; APKs as release assets on
  the same public repo.
- **UI / animation (user's call, 2026-11-26 11:08):** keep the UIs beautiful and
  reuse **Bolo Key's Morph animation** for the update flow (and the app's
  transitions where it fits) — pull the Morph implementation from the bolo-key
  repo rather than inventing a new one.

## 4. Phases

### Phase 0 — repo + skeleton + CI + OTA
Private app repo, Android project skeleton (Compose + Navigation + DI), GitHub
Actions build (assembleRelease on push, tests gate), release-server stub serving
`/api/app-release`, in-app updater (check on launch, one-tap download + install).
Deliverable: the app installs, checks for updates, shows "no update".

### Phase 1 — read-only gallery + vault view
Neon read via the HTTP API (gallery feed, search/sort/filter), vault decrypt +
range-fetch view, video playback (Media3), thumbnails (Coil + Room cache), vault
unlock (passcode → unwrap master key, Keystore-backed). Proves the data path.
Deliverable: browse gallery + vault, play a video, view a vault image.

### Phase 2 — upload
File upload (gallery images/videos) + URL upload + vault upload (encrypt → IVG1 →
TeraBox + Telegram via Bot API ≤ 50 MB). Duplicate detection (SHA-256). Background
upload via WorkManager with progress + journal/heartbeat recovery (same idea as the
extension). Deliverable: upload a photo + a vault file from the phone.

### Phase 3 — share intent (the headline feature)
`ACTION_SEND` (text/URL + image/video/file) and `ACTION_VIEW` receiver → detect
kind → route to the upload path (Phase 2). **Facebook reel:** WebView extraction —
the user logs into Facebook in the app's WebView once; JS finds the `<video>` src;
download the CDN `.mp4`; upload to the vault. Deliverable: share a reel from
Facebook → it lands in the vault.
Limitation (honest): reels that need login won't work without that WebView login,
and Facebook changes its page — extraction fails loudly, never silently skips.

### Phase 4 — trash / restore / permanent delete + settings + collections + search
Full CRUD parity for gallery/vault/trash. Delete flow: Bot API delete; on the
>48h age error, the Android equivalent of the 2.19.50 native existence check needs
MTProto (no native host on Android) — V1 shows the manual-delete + retry path and
retries after the user confirms; the MTProto existence check is Phase 5.
Deliverable: delete/restore/trash works end to end; Settings (keys + default
sources) + collections + search.

### Phase 5 — later (not V1)
- Vault blobs > 50 MB: Kotlin MTProto client (or a server relay) — the Bot API
  `sendDocument` cap is 50 MB.
- MTProto existence check for deletes (the 2.19.50 native-check equivalent).
- Scenes (3D `.spz` viewer), link previews, self-healing preview refresh.
- Server-side backend (web app API + per-user auth) so users don't paste keys.
- Multi-user accounts.

## 5. Honest limits (V1)

- **Vault blobs > 50 MB:** Bot API `sendDocument` cap is 50 MB. The 1.5 GB / 399 MB
  files need MTProto (Phase 5). V1 uploads ≤ 50 MB to Telegram; TeraBox has no
  such cap, so V1 uploads to TeraBox always and marks the Telegram copy pending
  when the blob is over the cap.
- **TeraBox auth:** cookie-based (ndus session cookie + jsToken + bdstoken). V1: the
  user logs into TeraBox in a WebView once; the app reads the session cookie from
  `CookieManager` and stores it encrypted — the on-device equivalent of the
  extension's `chrome.cookies` read.
- **Facebook reel:** WebView extraction (needs the login in the WebView). Fragile
  by nature — fail loudly, never silently skip.
- **No silent fallbacks** (his firm rule): if a host fails, the app says which host
  failed and why. A second method, if genuinely used, is labelled visibly.

## 6. Repo / CI (user's call, 2026-11-26 11:04: PUBLIC, one repo)

- **Public, everything, no separate repos.** ImgVault is a public project, so the
  Android app lives in the **same public repo** `FahadBinHussain/imgvault` as an
  `android/` folder — next to `nextgen-extension/` and `web/`. No private app repo,
  no separate releases repo.
- **APK + OTA manifest:** the APK ships as a **release asset on the same repo**
  (same pattern as the extension's CRX release workflow), and the manifest is
  served by the existing web app (`imgvaultt.vercel.app`) via a **public**
  `/api/app-release` route (no auth — the web's other API routes are NextAuth
  sessions, so this one must be explicitly public). No new Vercel project.
- **CI:** GitHub Actions in the same repo — build on push, publish APK to the
  repo's releases on tag, update the manifest. Tests gate the release.
- **`AGENTS.md` in the repo from day one** — his rules (no local Gradle builds, OTA
  recipe, commit style, no-fallback rule, secrets never in the repo).

## 7. Open decisions (his call)

1. **Repo / visibility — DECIDED 2026-11-26 11:04:** public, one repo (see §6).
2. **Reel download** — WebView extraction (V1, no server, needs the Facebook login
   in the WebView) vs server-side yt-dlp (needs a server that runs yt-dlp; Vercel
   can't run it well — needs a small VPS or a paid API, and a paid option must be
   flagged loudly before it is recommended). **Default for V1 is WebView** (no new
   infra — matches the one-repo call); only matters at Phase 3, not blocking
   Phase 0–2.
3. **V1 scope** — is the ≤ 50 MB Telegram cap acceptable for vault uploads, or
   should the MTProto path come earlier?

## Morph animation — reference (found 2026-11-26, bolo-keyboard repo)

"Morph" is Bolo Key's **Material 3 Expressive wavy progress ring** in the update
flow (the download/verify progress indicator), ported from the "Morphe Manager"
reference app. It is NOT a sine wave: it morphs a circle into a rounded star
polygon.

- **Source files** (repo `FahadBinHussain/bolo-keyboard`, local
  `C:\Users\Admin\Downloads\bolo-keyboard`):
  `bolo-update/src/main/java/ai/bolo/update/ui/BoloWavyProgress.kt` (613 lines,
  the composable `BoloWavyProgressRing`) + `BoloWavyRingMath.kt` (179 lines, pure
  math, JVM-testable) + test `BoloWavyRingMathTest.kt`. Used by `BoloUpdatePanel`
  (the self-update + changelog panel).
- **How it works:** `androidx.graphics.shapes.Morph` (library
  `androidx.graphics:graphics-shapes`, pure Kotlin, no android.* refs) morphs
  `RoundedPolygon.circle` into `RoundedPolygon.star` (inner radius 0.75,
  rounding 0.35/smoothing 0.4, inner rounding 0.5). Amplitude 0 = circle,
  amplitude 1 = star. Vertex count = circumference / wavelength (min 5), so the
  wavelength stays constant as the ring grows.
- **Numbers (copied from M3 1.5.0-rc01):** wavelength 30.dp, gap 4.dp, star inner
  radius 0.75, amplitude 500ms. Progress eased with tween(220, FastOutSlowIn).
  Wave flat below 10% and above 95% progress, full in between; travels 1
  wavelength/second (phase 0→1 over 1000ms, LinearEasing, infinite). Indeterminate:
  quarter-arc sweeping one full turn per 2s. Ring entrance: scale 0.85→1 with a
  low-bouncy spring. Wave flattens while TalkBack touch exploration is on.
- **Rendering:** Canvas + PathMeasure. The progress arc is cut from a DOUBLED full
  wavy circle (so the travelling wave wraps); the track arc is shortened at both
  ends by the gap (stroke cap + 4.dp). Centre readout: % (displaySmall, bold) +
  "downloaded / total MB"; caption below the ring. Defaults: ring 220.dp, stroke
  10.dp.
- **Reuse for ImgVault:** port the two files as-is (change only the package) —
  they are self-contained and regression-tested in Bolo Key. Bolo Key replicates
  the M3 component manually because the real `CircularWavyProgressIndicator`
  needs material3 1.5.0-rc01 + Compose 1.12; for a new app the real M3 component
  is the alternative if the BOM includes it, but the port is the proven route.
