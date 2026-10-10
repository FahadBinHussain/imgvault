# Plan: Telegram as a video / 3D / vault host (own integration, Telegram-Drive as method reference only)

date: 2026-10-10
status: **draft — recon + live probes done, phase 0 needs a bot from you**

## context

evaluated `caamer20/Telegram-Drive` as a host: **rejected as a dependency** (its REST/WebDAV
binds loopback only, desktop app must be running + signed in — the Vercel web app can never
reach the user's `127.0.0.1`, so it would be a parity violation for anything web-side).
its VALUE is as a method reference — it proves the MTProto stack (grammers, Rust) and the
"public channel → native t.me message link" idea. we shape our own integration the same way
TeraBox was shaped: direct API calls from the extension, harvest/resolve our own URLs, no
third-party app in the loop.

## verified facts (probed live 2026-10-10, not guessed)

- `api.telegram.org` sends `Access-Control-Allow-Origin: *` (+ GET/POST/OPTIONS) — the Bot
  API is callable from extension page XHR (progress events work, like pixvid/imgbb) AND
  from the web app. no localhost, no native host needed for bot-size files.
- **Bot API caps**: upload ≤ 50 MB (`sendVideo`/`sendDocument`/`sendPhoto`),
  `getFile` download ≤ 20 MB.
- **public-channel video**: the `https://t.me/s/<channel>` preview HTML exposes
  `<video src="https://cdn1.telesco.pe/file/<hash>.mp4?token=…">`. verified: plain-curl
  hotlink **200 `video/mp4`** with no referer/cookies, **Range → 206**, **ACAO `*`**,
  token required (404 without) but **stable across fetches**.
- **public-channel photos**: `<img src>` carries **tokenless, permanent** CDN URLs (22/22
  fetched 200).
- **documents** (`.spz`, vault `.bin`): no public URL exists anywhere — only `getFile`
  (≤ 20 MB, token embedded in the file URL → **never persist that URL**, resolve at fetch time).
- **delete**: bot `deleteMessage` removes its own channel posts (admin rights) → orphan
  delete buttons work.
- **enumeration**: `getMessages` pagination → integrity-check listings, same as
  `listTeraBoxFolder`.
- MTProto personal-account route: 2 GB/file (Telegram-Drive's own cap). we already have
  `automata-private\telegram.org\telegram-account.ps1` (mainframe multi-account helper,
  Python bridge) for account-side sessions/bulk work.
- accounts needed: Telegram account (free), bot via BotFather (free), public channel (free),
  `api_id`/`api_hash` from my.telegram.org (free). **nothing paid anywhere.**

## what we take from Telegram-Drive (reference only — no code reuse; it's a Tauri app)

- grammers (Rust MTProto) usage: chunked upload, `FLOOD_WAIT` handling → informs the
  phase-3 native-host actions.
- public message-link shape `t.me/<channel>/<msg_id>` as the stable watch URL.
- we do NOT take: their app, loopback REST/WebDAV, TDENC2 (our vault crypto already exists).

## architecture

### credentials (settings — same pattern as `imgbbApiKey`)

- `telegramBotToken` (masked field) + `telegramChannel` (public channel username) →
  settingsSchema → `telegram_bot_token` / `telegram_channel` columns (**live migration
  required** — 2.12.81 lesson: repo schema is not auto-applied).
- phase 3 only: `apiId`/`apiHash` + a native-host-local MTProto session file (never in DB).

### upload flow (page-side XHR → progress, like the other REST hosts)

1. `FormData` → `sendVideo` | `sendDocument` | `sendPhoto` → response `message_id`.
2. `watchUrl = https://t.me/<channel>/<message_id>`.
3. directUrl = fresh scrape: `GET https://t.me/s/<channel>?before=<message_id+1>` → regex
   the `<video src>` / `<img src>` CDN URL. new `nextgen-extension/src/utils/telegramApi.js`
   (the `teraBoxApi.js` shape).
4. store `{watchUrl, directUrl, messageId}` under `videoHosts.telegram`.

### fresh-resolve hook

telesco token lifetime is unknown → treat it like a TeraBox dlink: `vaultDownloadUrl`-style
re-scrape on read, cache per session, resolve throws LOUDLY if the scrape breaks (same
failure class as terabox's jsToken gate changing).

### documents (3D spz, anything without a CDN URL)

store `fileId`; downloads resolve `getFile` at fetch time — extension SW fetches direct,
web goes through `/api/media` proxy (server-side, holds the token). the token NEVER lands
in the DB or in any client-visible URL.

### vault

- ≤ 50 MB blobs: bot `sendDocument` — plugs into the existing
  `encryptAndUploadVaultedBlob` catalog dispatch with zero new plumbing. safe on a public
  channel: blobs are AES-256-GCM client-side already.
- bigger blobs: phase-3 MTProto actions in the Rust native host (grammers) — extension-only,
  which is parity-safe because the vault is ext-only by design (web page is metadata-only).
  native-message 1 MiB cap → reuse the chunk-transfer pattern from `video_normalize_*`.

### privacy (loud)

a public channel's `t.me/<ch>/<id>` pages are viewable by anyone who guesses the channel
name; CDN hashes are unguessable (same exposure class as imgbb/udrop unlisted links). use
an obscure channel name. vault blobs are encrypted regardless.

## phases

- **0 — spike (needs you, ~10 min setup + my ~30 min)**: BotFather `/newbot` → token into
  settings; create obscure public channel; add bot as admin (post + delete + read rights).
  my spike: disposable unique mp4 → sendVideo → scrape → hotlink play + Range + delete →
  record results here. also A/B: CDN stream version vs `getFile` original quality.
- **1 — host for images + videos (~half a day)**: `TelegramUploader` in `uploaders.js`,
  `telegramApi.js`, providerCatalog entries (ext + web twin), settings fields + live
  migration, gallery upload/play on BOTH platforms, delete, resolve-page integrity tab.
  images decision from spike: `sendPhoto` (lossy re-compress) vs `sendDocument` +
  `getFile` proxy (byte-faithful) — default to faithful.
- **2 — 3D (~2–3 h)**: spz as document + texture as photo; enable in all THREE_D lists
  (ext `GalleryPage.jsx` ×2, both providerCatalog filters, settingsSchema options,
  `GalleryLightbox` label map); scene integrity.
- **3a — vault via bot (~2 h)**: add `telegram` to vault blob hosts (≤ 50 MB).
- **3b — MTProto native host (1–2 days)**: grammers actions `tg_upload`/`tg_download` in
  `native-host/src-tauri/src/main.rs`, session mgmt, flood-wait → lifts vault/video to 2 GB.
- **4 — optional**: bulk-migrate existing library via the bot/mainframe helper.

## failure modes (no-fallback rule: every one fails LOUD, naming the cap)

- upload > 50 MB via bot → error names the cap (MTProto is 3b).
- `getFile` > 20 MB → error names the cap.
- `FLOOD_WAIT n` → wait + one retry, then loud.
- scrape breakage (Telegram changes preview HTML) → resolver throws with the marker text.
