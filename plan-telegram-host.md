# Plan: Telegram as a video / 3D / vault host (own integration, Telegram-Drive as method reference only)

date: 2026-10-10
status: **paused 2026-10-11 — focus moved to the platform-parity plan (`plan-platform-parity.md`,
phase 2). nothing built, zero code written. resume trigger: BotFather token + public
channel with bot-as-admin.**

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
- **Bot API caps (official docs, re-verified 2026-10-11)**: cloud upload ≤ 50 MB
  (`sendVideo`/`sendDocument`/`sendPhoto`), cloud `getFile` download ≤ 20 MB.
- **local Bot API server** (official, self-hosted): "Download files **without a size
  limit**, upload up to **2000 MB**" — same Bot API surface, different base URL. this is
  the big-blob path (supersedes writing grammers MTProto). Range support on cloud
  `getFile` URLs and on the local server = **VERIFY in phase 0 spike**.
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

- grammers (Rust MTProto) usage: chunked upload, `FLOOD_WAIT` handling — kept as the
  documented ALTERNATIVE to the local Bot API server (plan phase 3b), not built by default.
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

**crypto is unchanged — it already exists.** the vault encrypts client-side BEFORE any
host sees bytes (`vaultCrypto.js`: passcode → PBKDF2 → master key → per-8 MiB-chunk
AES-256-GCM, `IVG1` container). Telegram is just another dumb byte pipe that stores an
opaque `<32-hex>.bin` — which is exactly why a public channel is safe for vault blobs: a
leak yields gibberish, and neither the passcode nor any key ever leaves the browser.
the bot token leak ≠ vault compromise (ciphertext only).

- upload: existing `encryptAndUploadVaultedBlob` catalog dispatch → `sendDocument`
  (cloud) or local Bot API server (below). stored as `vaultHost: 'telegram'` +
  `encryptedBlobHosts` entry, same shape as udrop/terabox.
- read-back (the real constraint): cloud `getFile` download cap is **20 MB** → cloud
  telegram vault blobs are hard-capped at 20 MB (loud error naming the cap; blobs ARE
  encrypted before upload, so size checks run on the ciphertext = plaintext + ~1%).
- **bigger blobs → local Bot API server** (official Telegram binary, spawned/managed by
  the existing Rust native host like yt-dlp/ffmpeg): unlimited download, 2000 MB upload,
  same API code path (only base URL + auth differ) → `fetchVaultBlobRange` telegram
  branch resolves through it. extension-only, which is parity-safe: the web vault page is
  metadata-only by design and never reads blobs. if the server isn't running → LOUD error
  naming it, never a silent skip.

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
- **3a — vault via cloud bot (≤ 20 MB) (~2 h)**: add `telegram` to the vault blob hosts;
  `fetchVaultBlobRange` telegram branch + `vaultDownloadUrl` fresh-resolve + loud 20 MB gate.
- **3b — local Bot API server for big blobs (1 day)**: run Telegram's official local Bot
  API server, lifecycle-managed by the Rust native host (spawn on demand like yt-dlp);
  same API code path, base URL swapped → vault to 2000 MB uploads / unlimited reads.
  Telegram-Drive's grammers MTProto stays the documented alternative if the local server
  misbehaves — not built unless 3b fails.
- **4 — optional**: bulk-migrate existing library via the bot/mainframe helper.

## failure modes (no-fallback rule: every one fails LOUD, naming the cap)

- upload > 50 MB via cloud bot → error names the cap (local Bot API server = 3b).
- `getFile` > 20 MB → error names the cap + points at the local server (3b).
- local server not running when a big blob is read → LOUD, names the native-host spawn.
- `FLOOD_WAIT n` → wait + one retry, then loud.
- scrape breakage (Telegram changes preview HTML) → resolver throws with the marker text.

## decisions at the pause point (2026-10-11)

- **whole-plan diagram**: `plan-telegram-flow.html` (repo root, commit `f95ce283`) —
  upload routing → channel → fresh-resolve → gallery/vault read paths, size gates, loud caps.
- **phase 3b (local Bot API server) is OPTIONAL, not required** — the cloud bot API alone
  covers gallery images + videos, 3D spz (`getFile` ≤ 20 MB), and vault blobs ≤ 20 MB
  ciphertext. the local server buys exactly ONE thing: telegram-hosted vault blobs bigger
  than 20 MB — which existing hosts (udrop, 1.2 GB verified / terabox) already serve. cut
  3b freely; over-cap on telegram = loud error naming it, that item goes udrop/terabox.
  the flowchart draws 3b dashed for this reason.
- **scope clarification**: telegram is NOT gallery-only — the vault works on it too, just
  capped (phase 3a). the phase ORDER is risk order (gallery first because vault reuses the
  same upload plumbing), not an exclusion of the vault.
- still open from the spike list: Range support on cloud `getFile` URLs + the local
  server; `sendPhoto` vs `sendDocument` image A/B (default byte-faithful `sendDocument`).

## phase 0 status (2026-10-14) — BLOCKED on one human action

bot created and its token verified (`getMe` resolves to the intended bot; the token lives
only in off-repo scratch storage and is never written here or in settings). channel created
and public, 1 subscriber (the owner). the only missing piece is **bot-as-admin**, and it is
blocked on four independent dead-ends — all probed live today, none inferred:

| path | result |
|---|---|
| Bot API `joinChat` | `404 Not Found` — a bot cannot add itself to a channel |
| Bot API `promoteChatMember` | `Forbidden: bot is not a member of the channel chat` (membership is a prerequisite) |
| MTProto (telethon) | every stored web-session auth key → `AuthKeyUnregisteredError` on its own DC |
| Telegram Web UI | opening a chat needs a trusted pointer event; both pointer CDP methods are wedged in the harness daemon |

findings worth keeping so the next attempt does not re-litigate them:

- **the stored web auth keys are genuinely dead, not mis-addressed.** an earlier diagnosis
  blamed a wrong DC IP; re-tested against the DC list the server itself returns
  (`help.getConfig`, correct production addresses) — every key still rejects on its own
  home DC. web build 677 keeps the live key in memory only, so there is nothing exportable
  in localStorage/IndexedDB. a desktop client is not installed either, so there is no local
  key to borrow.
- **the web tab is pinned by a privacy extension to one specific chat hash**: any
  `location.hash` or `history.pushState` change is reverted within ~200 ms, so a chat
  cannot be reached by URL. (a full document load at the channel's chat URL would bypass
  this — but only if that URL is allowlisted.)
- **keyboard input DOES reach the page**: `Input.insertText` works, and the channel is
  findable — typing its handle into the sidebar search renders the row (correct peer id,
  "1 subscriber"). selection is the wall: the row is an `<a>` with **no `href`**, JS
  `.click()` and a full mousedown/mouseup/click sequence do not route it, and
  ArrowDown/Enter select nothing (no picked autocomplete item, element not focusable).
- `Input.dispatchMouseEvent` and `Input.dispatchTouchEvent` both fail with
  `_IPCResponseTimeout … timed out waiting for the daemon` — a harness daemon bug, not a
  Telegram constraint. an empty-payload call answers instantly, proving the daemon is alive
  and only payload-bearing pointer dispatch wedges.

**what unblocks phase 0** (both free, pick one):

1. *~30 s, recommended* — the owner adds the bot to the channel and promotes it from their
   own Telegram client (phone is fine), granting post + edit + delete rights. the spike then
   runs entirely over the Bot API with no UI driving at all.
2. temporarily allowlist the channel's chat URL in the blocking extension so a direct
   document load opens it — but this only pays off once pointer dispatch is fixed too,
   since the in-app navigation is click-gated.

until one of those lands: **zero code written, spike not started, no results to record.**
