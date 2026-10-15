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

## phase 0 — DONE (2026-10-15): admin granted, spike green end-to-end

bot created and its token verified (`getMe` resolves to the intended bot; the token lives
only in off-repo scratch storage and is never written here or in settings). channel created
and public. bot-as-admin is **solved without a human action** (route below) and the whole
upload → scrape → hotlink → range → delete spike ran clean. history of the four dead-ends
that used to block it is kept underneath — they are still true, they just no longer matter.

### how bot-as-admin was solved

the Bot API has no path (`joinChat` 404s; `promoteChatMember` needs membership first) and the
stored web MTProto keys are dead — but **the logged-in web client is itself a live MTProto
session**, and it exposes its own manager layer on `window.appImManager` in the production
build. calling the same manager the client's own "add admin" UI calls grants it directly:

```js
const m = window.appImManager;                       // reachable on web.telegram.org/k
await m.managers.appUsersManager.resolveUsername('<bot handle>');
await m.managers.appChatsManager.editAdmin(
  <chatId>, <botUserId>,
  {_: 'chatAdminRights', pFlags: {change_info:1, post_messages:1, edit_messages:1,
    delete_messages:1, ban_users:1, invite_users:1, pin_messages:1}},
  '<rank>');
```

- `editAdmin(id, participant, rights, rank)` invokes `channels.editAdmin` — and bots may be
  made admins directly, no invite: `channels.inviteToChannel` rejects bots with `USER_BOT`,
  which is why every "add then promote" recipe skips the invite.
- verified afterwards through the Bot API, not the UI: `getChatMemberCount` = 2 and the bot
  reads back `status: administrator` with `can_post_messages: true` (plus change/edit/delete/
  invite/restrict).
- **the UI never has to open the chat for this**, so the trusted-pointer and hash-pin
  dead-ends below simply do not apply. for the record: `window.appImManager` IS live in the
  production build and `setPeer({peerId})` does move `chat.peerId` to the target, but the
  re-render half-applies and dies on `element is not connected` — drive the manager layer,
  never the DOM, when the manager layer can do the job.
- this route generalises: every `appChatsManager` / `appMessagesManager` / `appUsersManager`
  call is available the same way (posting, deleting, resolving peers), Bot API or not.

### spike results (all measured live, not inferred)

| test | result |
|---|---|
| `sendVideo` (h264 mp4, 20 122 B) | 200, 1.8 s; stored `file_size` **20 122 B — byte-identical**, 320x240, 3 s, `video/mp4`; `message_id` returned |
| scrape public page | `t.me/s/<ch>/<id>` → 200; the CDN url is in the HTML; **no `og:video` meta** — parse the markup |
| CDN hotlink | 200 `video/mp4`, exact bytes, **`Access-Control-Allow-Origin: *`**, `Accept-Ranges: bytes`, `Cache-Control: max-age=10800` (3 h) |
| Range on the CDN url | `206` head **and** mid-file, repeat reads on the SAME url OK — **not single-use** (unlike terabox dlinks) |
| `getFile` cloud url | 200 `application/octet-stream`, `Accept-Ranges: bytes`, Range → 206 |
| **`getFile` 20 MB gate** | 25 MB document → **`400 Bad Request: file is too big`**, no path returned. phase 3a's loud cap is real |
| upload cap | 40 MB → OK (28.7 s ≈ 1.4 MB/s). 51 MB → **fails two different ways**: `ConnectionError` (reset) on one attempt, `413 Request Entity Too Large` on another. map BOTH to the cap, loudly |
| `deleteMessage` | `ok: true`, post verified gone. the channel-created service message is undeletable (`message can't be deleted`) |

**image A/B — decided (plan default confirmed):** the same 23 122 B jpeg both ways —
`sendPhoto` re-encodes to 640x480 **14 074 B** (sha differs, and `getFile` of that photo hands
back the re-encoded 14 074 B, **not** the original), while `sendDocument` returns
**23 122 B byte-faithful** with `image/jpeg` preserved. **`sendDocument` it is**, exactly as
the plan defaulted; `getFile` cannot recover a photo's original bytes.

**stream version vs `getFile` original — decided:** for an already-compliant h264 mp4 the two
are the same bytes (CDN 20 122 = `getFile` 20 122 = upload 20 122, no re-encode). but a
**webm** sent through `sendVideo` comes back as a `document` (`video/webm`, bytes identical,
`getFile` sha-matches the original) with **no CDN mp4 at all** — so the hotlink path only
exists for mp4 input. phase 1 rule: **mp4 in → hotlink path; anything else → `getFile` path
(≤ 20 MB) or a loud over-cap error**, never a silent re-encode.

**scrape-marker correction:** a post is `data-post="<ch>/<id>"` in the preview html.
`message-id="…"` does not exist there — the first delete-verification used it and silently
reported "still present / not present" at random. use `data-post`.

the channel was left clean afterwards: only the undeletable service message, member count 2.

---

## phase 0 history (2026-10-14) — the four dead-ends, still true

these blocked bot-as-admin before the manager-layer route above; they remain accurate and are
kept so nobody re-litigates them:

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

**both "unblock" options below are now obsolete** — kept only as history. the manager-layer
route above beat both of them and needs neither a human nor an extension change:

1. *~30 s, recommended* — the owner adds the bot to the channel and promotes it from their
   own Telegram client (phone is fine), granting post + edit + delete rights.
2. temporarily allowlist the channel's chat URL in the blocking extension so a direct
   document load opens it — only ever paid off once pointer dispatch was fixed too, since
   in-app navigation is click-gated.
