# ImgVault master plan — roadmap, decisions, shipped log

merged 2026-10-30 from four separate plan docs:

- `plan.md` (vault encryption, 2026-08-25)
- `plan-terabox-vault.md` (2026-08-27)
- `plan-telegram-host.md` (2026-10-10)
- `plan-platform-parity.md` (2026-10-03)

the originals are **kept verbatim** in `plans/archive/` (nothing deleted). the telegram
flowchart stays at `plan-telegram-flow.html` — it is a diagram, not a task list.

**legend**

- ~~struck~~ = shipped, decided, or no longer actionable (kept for history — never deleted)
- ⏳ = still open
- statuses were re-checked against the code on 2026-10-30 (manifest **2.17.0**), not copied
  from the old status lines. where the code disagreed with a plan, the plan is corrected in
  place and the correction is marked `[verified 2026-10-30]`.

---

# 1. Secret Vault: real encryption

date: 2026-08-25 · originally `plan.md`

## context (historical — do not re-read as current state)

~~the "Secret Vault" is only a **visibility toggle**, not encryption
(`VaultPage.jsx` disclaimer: *"Phase 1 hides items from the regular UI. It does not
encrypt hosted files or database fields yet."*). the passcode is hashed with SHA-256 +
salt and used only to gate the UI; the underlying files sit in plaintext on
Pixvid/ImgBB/Filemoon/udrop, and the DB rows (Neon) carry the real metadata.~~
— this was the pre-2.6.0 state; it is shipped and no longer true.

~~goal: vaulted items must be **encrypted at rest** — blob content and blob filename
encrypted with a key derived from the vault passcode — stored as **flat blobs on udrop**
(no folders), exactly the rclone-crypt model but implemented in pure WebCrypto so **no
AList / no rclone / no WinFsp** is needed.~~ — shipped in 2.6.0, extended to multi-host.

### ~~why udrop only~~ (superseded by the TeraBox plan, section 2)

- ~~udrop has a simple file-upload API (`/api/v2/file/upload`, multipart) and the
  extension already has a `UDropUploader` + `udropApi.js` client.~~
- ~~udrop accepts arbitrary blob content; uploads are reliable for both images and videos
  (~2.7 MB/s measured single-connection).~~
- ~~TeraBox is deferred: it needs AList + the chunked PCS upload protocol, so it does not
  fit the pure approach. revisit later if ever needed.~~ — revisited and shipped (section 2).

## architecture (current)

```
vault passcode
   │  PBKDF2 (SHA-256, 100k+ iters, per-vault salt) ──► master key (256-bit)
   │
   ├─► content key: AES-256-GCM encrypt the blob        ──► upload encrypted blob to every selected host (flat)
   │        (chunked IVG1 container, 8 MiB chunks)
   │
   └─► name key: encrypt item filename + stored metadata ──► opaque string used as the blob filename
```

- a host sees only: a random opaque filename (`<32 hex>.bin`) + ciphertext bytes. without
  the passcode, neither the name nor the content is readable.
- the row for a vaulted item stores **only** the encrypted blob copies + the encrypted
  metadata blob. it does **not** store plaintext tags/description/source URLs for vaulted
  items (those move into the encrypted payload).
- the passcode never leaves the client; the master key lives in memory only (SW + page).
  since 2.18.3 the worker also mirrors it into `chrome.storage.session` so an MV3 idle
  restart heals instead of reporting a false lock — session storage still dies with the
  browser, so nothing about the key's lifetime changed.

## key crypto decisions (all shipped)

- **KDF**: `crypto.subtle.deriveKey` PBKDF2, SHA-256, 100,000 iterations, 256-bit AES-GCM
  key. salt = 16 random bytes, generated once per vault, stored plaintext in
  `secretVaultConfig`.
- **Key wrapping (master key)**: one random 256-bit master key encrypts all vault blobs;
  the passcode-derived key encrypts the wrapped master key into
  `secretVaultConfig.wrappedMasterKey`. unlock = derive → unwrap → use. passcode change =
  re-wrap only (blobs never re-encrypted).
- **Blob encryption**: AES-256-GCM with the master key, per-item random IV. **update:**
  blobs are no longer single-shot — the container is the chunked `IVG1` layout
  (`magic "IVG1" | totalSize u64 | chunkSize u32` + per-8 MiB GCM chunks) so multi-GB
  videos stream/decrypt without a worker-killing memory spike. legacy single-shot blobs
  are still probed and decryptable. `[verified 2026-10-30 in vaultCrypto.js]`
- **Filename/name obfuscation**: encrypted name payload (name + mime + optional tiny JSON
  metadata); the host filename is a fixed opaque `<32 hex>.bin`.
- **Key change**: instant (re-wrap only).
- **Thumbnails**: no decrypted thumbnails cached in plaintext; previews exist only while
  unlocked and object URLs are revoked on lock.

## what changed (shipped)

### ~~new module~~
- ~~`nextgen-extension/src/utils/vaultCrypto.js` — key derivation, encrypt/decrypt blob,
  encrypt/decrypt metadata payload, opaque-name generation. pure WebCrypto, no deps.~~

### ~~storage layer (`src/utils/storage.js`)~~
- ~~`saveVaultConfig` / vault config shape: add `vaultSalt`, `vaultVersion`,
  `kdfIterations`.~~
- ~~new vault-item write path: encrypt blob + metadata **before** upload, store
  `encryptedBlobUrl`, `encryptedMetadata`, `iv`, `vaulted:true` instead of plaintext
  provider URLs.~~ (now `encryptedBlobHosts[]` — see section 2)
- ~~`getVaultImages` / `getImageById` for vaulted rows: return the encrypted payload;
  decryption happens on demand in the caller.~~
- ~~move-to-vault / restore-from-vault: move encrypts (download → encrypt → upload →
  update row); restore decrypts back through the normal providers.~~

### ~~upload path (`src/background/background.js` + `uploaders.js`)~~
- ~~vaulted uploads encrypt with the vault key (unlocked required) and use the vault blob
  hosts instead of Pixvid/ImgBB/Filemoon.~~
- ~~skip duplicate-detection hashing / plaintext metadata for vaulted items.~~

### ~~UI (`VaultPage.jsx`, `MediaDetailModal.jsx`)~~
- ~~keep the passcode gate; after unlock derive the master key once and keep it in memory.~~
- ~~grid + detail modal decrypt on demand; release object URLs on lock / unmount.~~
- ~~lock explicitly drops the key + decrypted object URLs.~~
- ~~change-passcode flow re-wraps the master key (no per-item re-encrypt).~~

### ~~settings (`SettingsPage.jsx`)~~
- ~~no new keys needed for the vault itself (reuse the udrop account; blobs are opaque).~~

### web app (`web/`) — ~~read + decrypt shipped (2.17.2, 2026-10-30)~~; ~~move still flag-only~~ → encrypted move shipped 2026-10-31
- ~~the web vault page can list vaulted items but **cannot decrypt** (the passcode never
  leaves the extension). the plan was to mark web vault as "list-only / locked".~~
  **shipped as real encryption instead**: `vaultCrypto.js` moved to
  `packages/shared/vaultCrypto.js` (extension keeps a re-export shim, drift-guarded), so web
  creates/unlocks/re-wraps with the *same* wrapped-master-key config the extension uses;
  the master key lives only in the tab (sessionStorage `keyB64`). new authenticated routes:
  `GET /api/vault/blob?id=` (Range proxy that regenerates udrop signed URLs; terabox copies
  fail loudly because their dlink needs the extension's hidden-tab token scrape) and
  `GET /api/vault/preview?id=` (ciphertext preview rows). the page decrypts IVG1 blobs one
  8 MiB chunk at a time over Range requests, decrypts titles/tags from `encryptedMetadata`,
  and shows encrypted video thumbs from `media_item_previews`; encrypted images show a lock
  tile (same as the extension) until opened. restore of an encrypted item is refused loudly
  on web (it needs the master key + an upload path).
- ~~`web /api/vault` PATCH `action:'move'` is still **flag-only** (marks vaulted + revokes
  shares), it never encrypts or uploads — so a web-side "vault" is not the same security
  model as the extension's, and it now answers with an explicit `warning` that the gallery
  turns into a warning toast. see section 4 open items.~~
  **closed 2026-10-31 — web moves encrypt for real.** the browser fetches the original
  through the same-origin `/api/media` proxy, encrypts it in the tab with the master key
  from sessionStorage (IVG1 `encryptBlob` + `encryptMetadata`, same payload as the
  extension), and POSTs multipart ciphertext to `POST /api/vault/move`; the server posts
  the opaque `.bin` to the configured Telegram channel (`sendDocument`) and writes the
  same row shape the extension writes (`encryptedBlob*`, `vaultHost(s)`, blanks the
  plaintext columns + extra keys, revokes share links). the master key never leaves the
  tab. PATCH `action:'move'` is now a 400 pointing at the new route; PATCH restore of an
  encrypted row is a 400 (web has no upload path). **hard cap: the Vercel request body is
  4.5 MB**, so the relayed ciphertext must stay under `VAULT_MOVE_MAX_CIPHERTEXT_BYTES`
  (4.5 MB) — over-cap items fail loudly and are told to move from the extension, which
  uploads straight to the host. source rules: full-size image URL only (never a
  thumbnail), videos need a direct byte URL (watch pages serve HTML), HTML responses are
  refused loudly. **verified live 2026-10-31 on production `imgvaultt.vercel.app`,
  27/27 checks**: a minted database session + scratch row, a 78,899 B JPEG encrypted in
  node with a throwaway key → `POST /api/vault/move` stored telegram message 67 and the
  row got the full encrypted shape (plaintext columns + extra keys gone); reading back
  through `/api/vault/blob` returned 78,943 B of ciphertext that decrypted **byte-equal**
  to the original; 401 without a session, 400 for PATCH `move`, 400 for an already-vaulted
  row; the telegram post was deleted and every scratch row purged. the real gallery UI was
  also driven in Edge against a local instance: the first click failed loudly (preferred
  source ImgBB, scratch row only had a pixvid link — the strict-source rule doing its job),
  then with both links present "Move to Vault" vaulted the row (telegram post 68, plaintext
  blanked) and the read-back decrypted byte-equal. local instance + scratch rows + posts
  cleaned up afterwards.

## scope / non-goals

- ~~TeraBox integration: deferred (needs AList/PCS).~~ — shipped, pure extension API (section 2).
- native host / rclone / WinFsp: not used. (still true)
- end-to-end encryption of the non-vault gallery: out of scope. (still true)
- ~~**existing already-vaulted items: DECISION (2026-08-25) = new-encryption-only (option
  B).** items vaulted after the update are encrypted; items vaulted before it stay
  plaintext on their current providers, hidden behind the passcode gate. **no
  auto-migration on unlock.** a "migrate old vault items" button is a future follow-up.~~
  — the option-B decision holds and is **final (2026-10-30)**; the migrate button was never
  built and is struck from the roadmap.
- ~~**restore from vault: DECISION = re-upload via normal providers.** decrypt blob →
  re-upload through the existing uploaders so restored items behave like normal gallery
  items. scenes restore to udrop plaintext.~~ — shipped (`restoreFromVault`, with
  per-kind target-host selection).
- ~~**passcode change: DECISION = key wrapping from the start.** re-wraps the master key,
  no per-item re-encrypt.~~ — shipped (`rewrapMasterKey`).

## implementation steps

1. ~~`vaultCrypto.js` — KDF + encrypt/decrypt helpers.~~ done
2. ~~storage.js — vault config shape + encrypted item read/write.~~ done
3. ~~background.js — vaulted upload path, move/restore paths.~~ done
4. ~~VaultPage + MediaDetailModal — decrypt-on-view, lock clears keys/URLs.~~ done
5. ~~SettingsPage change-passcode → re-wrap.~~ done
6. ~~web vault — list-only mode for encrypted items.~~ **shipped as full decrypt** (2.17.2):
   shared `vaultCrypto`, wrapped-master-key create/unlock/re-wrap, Range blob proxy,
   preview store, chunked decrypt-on-open. ~~⏳ leftover: web-side *move* stays flag-only.~~
   **leftover closed 2026-10-31**: web move now encrypts in the tab and relays the
   ciphertext to Telegram through `POST /api/vault/move` (4.5 MB body cap).
7. ~~build + manual test on Edge (bump manifest, `pnpm build`, reload), full round-trip:
   upload-encrypt → lock → unlock → decrypt-view → restore.~~ done (2.6.0 onward; reload is
   now `pwsh tools/reload-extension.ps1`, never `start msedge http://reload.extensions`)
8. ~~verify pre-existing vaulted items still render fine unencrypted (option B
   backward-compat: both encrypted rows and legacy plaintext rows).~~ done

## v1 log (2.6.0, 2026-08-25) — shipped

- ~~`vaultCrypto.js` — PBKDF2(100k) → passcode key; random 256-bit master key wraps it;
  `encryptBlob`/`decryptBlob`, encrypted metadata payload,
  `createVaultConfig`/`unwrapMasterKey`/`rewrapMasterKey`.~~
- ~~`vaultSession.js` — page-side master key in memory only.~~
- ~~background: `vaultSetMasterKey` / `vaultClearMasterKey`; `encryptAndUploadVaultedBlob`;
  `handleVaultedUpload`; `moveItemToVault` (throws if encryption-capable but locked —
  never silent plaintext); `restoreFromVault`; `decryptVaultBlob` (regenerates stale
  download URLs from the file id).~~
- ~~VaultPage: unlock unwraps + pushes the key to the SW; legacy vaults auto-upgrade;
  encrypted items show a lock placeholder; decrypt-on-view; lock clears key + URLs.~~
- ~~manifest 2.5.3 → 2.6.0.~~

### ~~not done in v1~~ → current standing of each

- ~~web vault list-only mode for encrypted items (step 6)~~ — **superseded**: web now decrypts
  for real (2.17.2, see section 1); web-side *move* closed 2026-10-31 (encrypt-in-tab →
  Telegram relay, 4.5 MB cap).
- ~~"migrate old vault items" button for pre-existing plaintext vaulted rows~~ — **struck
  2026-10-30**: never built and will not be. option B (new-encryption-only) is final, so
  legacy plaintext vault rows stay exactly as they are. the web vault now labels them
  `Not encrypted` (`isEncrypted = Boolean(item.encryptedBlobUrl)`) instead of pretending,
  which is the whole requirement.
- ~~scene (spz/texture) encrypted vault UI~~ — **still absent** ⏳; scenes stay on plaintext
  hosts (option B for scene rows).
- ~~`SettingsPage` passcode change already re-wraps via `rewrapMasterKey`; the old
  "re-encrypt-all" note is superseded by key wrapping.~~ confirmed shipped.

## open questions — resolved

- ~~restore from vault: re-upload via normal providers.~~ decided + shipped.
- ~~passcode change: key wrapping — instant.~~ decided + shipped.
- ~~pre-existing vaulted items: option B (new-encryption-only).~~ decided, still in force.

---

# 2. TeraBox encrypted vault host

date: 2026-08-27 · originally `plan-terabox-vault.md` · **status: shipped** (the old
"draft — investigation phase" line was never updated)

## context

the vault stores 1 item → 1 opaque blob (`<32-hex>.bin`). TeraBox was evaluated as a
**second encrypted host** so a single host losing a file could not lose vaulted data.

## ~~why TeraBox, not another host~~ (confirmed, still accurate)

- ~~TeraBox has 1 TB free space — no per-file caps for our sizes (<4 GB).~~
- ~~the extension already has `cookies` permission + `<all_urls>` → can read the TeraBox
  session cookie (`ndus`, `browserid`, `lang`) from the logged-in browser.~~
- ~~the route is **pure extension** (no AList, no rclone, no native host).~~
- ~~the AList terabox driver (v3.63.0) confirmed the PCS upload protocol works.~~

## architecture — shipped, with one deviation

```
vault upload
  encrypt with master key → opaque Blob
  upload a copy to EVERY selected vault blob host (sequential, not background-sync)

  TeraBox path:
    read cookie via chrome.cookies (authorizeTeraBox) → no explicit login step
    homepage → jsToken + bdstoken + dp-logid (fetchTeraBoxPageContext)
    POST /api/precreate → uploadid, return_type
    GET  /rest/2.0/pcs/file?method=locateupload → upload host
    POST <host>/rest/2.0/pcs/superfile2 (chunked) → md5s
    POST /api/create → fs_id
```

- **deviation from the plan:** the plan debated parallel vs "udrop first, TeraBox
  background sync". what shipped is **sequential copies to every selected host inside
  `encryptAndUploadVaultedBlob`** — the user picks the host set, each copy is recorded in
  `encryptedBlobHosts[]`, and any host that fails throws loudly (no silent single-host
  save). progress is reported per stage (encrypt → upload → saving).
  `[verified 2026-10-30 in background.js]`

## cookie + jsToken (shipped)

- ~~**cookie**: `chrome.cookies.get` + `browserid` + `lang`; user must be logged into
  TeraBox in the browser. freshness is the main auth risk.~~ — shipped
  (`authorizeTeraBox`, `hasTeraBoxSessionCookie` fails loudly with remediation text).
- ~~**jsToken**: scraped from the homepage; the driver resets it on stale-token errors.~~
  — shipped (`fetchTeraBoxPageContext`, also captures `bdstoken` + `dp-log-id`, which
  write ops require — 2.16.9 fix).
- ~~**stale token**: treat as "refetch and retry", not a captcha.~~ — superseded: 2.16.9
  added explicit handling for `errno 4000023` (real verify wall → open the site and tell
  the user, rather than an opaque retry loop).

## upload path details (shipped)

~~precreate / locateupload / chunk upload / create~~ — implemented in
`TeraBoxUploader` (`src/utils/uploaders.js`); chunked XHR with per-chunk progress.

## download path (restore from vault) — shipped, with a major correction

### list files
- ~~`POST /api/list` … find the item by its opaque name.~~ — shipped
  (`listAllTeraBoxFiles`, `resolveTeraBoxFilePath` root-first then recursive).

### get download link
- ~~crack mode: `/api/filemetas` → signed `dlink`; no sign-gen needed.~~ — shipped.
- ~~**CRITICAL THROTTLE**: TeraBox CDN caps large-file downloads at ~30 KB/s (`tsl=30`).
  a 1.2 GB blob takes **~11 hours**. this is a server-side cap, not fixable.
  recommendation: **udrop is the primary restore source**; TeraBox is backup only.~~
  **WRONG as written** — `[verified 2026-10-30, code comment measured 2026-09-01]` the cap
  depends on whether the request carries the TeraBox session cookie: **with cookie →
  `tsl=30` (~30 KB/s); without cookie → `tsl=2000` (~2 MB/s)** on the same dlink.
  `fetchVaultBlobRange` therefore fetches terabox dlinks with `credentials: 'omit'` +
  UA/Referer only, and gets ~0.68 MB/s sustained (measured) instead of 0.01 MB/s.
  so TeraBox **is** a usable read source — the "udrop only, 11 hours" conclusion is dead.

## file size limits

- ~~TeraBox free tier: 4 GB max single file via web.~~ confirmed; our blobs are well under.
- ~~total storage: 1 TB free.~~ confirmed.

## changes needed (all shipped)

### new module
- ~~`teraBoxUploader.js` — PCS upload (precreate + locateupload + chunked upload +
  create).~~ shipped as `TeraBoxUploader` inside `src/utils/uploaders.js`.
- ~~`teraBoxApi.js` — list, dlink, delete, jsToken refresh.~~ shipped, and grew well past
  the plan: `hasTeraBoxSessionCookie`, `fetchTeraBoxPageContext`, `authorizeTeraBox`,
  `listAllTeraBoxFiles`, `resolveTeraBoxThumbnail`, `resolveTeraBoxFilePath`,
  `resolveTeraBoxPlaybackUrl`, `collectTeraBoxRefs`, `checkTeraBoxIntegrity`,
  `checkTeraBoxSceneIntegrity`, `deleteTeraBoxFiles`.

### SW (background.js)
- ~~`getTeraBoxAuth` — cookie + jsToken.~~ shipped as `authorizeTeraBox`
  (cookie auto-read, no separate message).
- ~~`handleVaultedUploadToTeraBox` — parallel to the udrop vault upload.~~ shipped inside
  `encryptAndUploadVaultedBlob` (generic host loop, not a TeraBox-specific branch).
- ~~`saveVaultedUpload` — accept a second host result.~~ shipped as
  `encryptedBlobHosts[]` on the row.
- ~~`restoreFromVault` — tries udrop first; if udrop's link is dead, falls back to TeraBox
  (with a "slow download" warning).~~ shipped as `fetchVaultBlobRange`, which iterates
  `hostCopies` and throws `All vault blob hosts failed for range …` when every copy fails.
- ~~`decryptVaultBlob` — fetch from TeraBox when udrop is unavailable.~~ shipped (same
  host loop, plus per-host URL regeneration — terabox dlinks are single-use, so every
  range read resolves a fresh one).

### upload path (GalleryPage.jsx)
- ~~`uploadVaultedDirectly` — upload to BOTH udrop and TeraBox.~~ shipped, with a
  user-selected host set (`selectedVaultHostKeys`) instead of a hardcoded pair.

### DB / storage layer
- ~~new fields `teraBoxUrl`, `teraBoxFileId`, `teraBoxFileName`; or a `providerHosts` JSON
  field.~~ shipped as `encryptedBlobHosts: [{host, encryptedBlobUrl,
  encryptedBlobWatchUrl, encryptedBlobFileId}]` + the legacy flat fields for old rows.

### decrypt path (VaultPage.jsx, background.js)
- ~~try udrop first, then TeraBox; show a "slow" indicator on the TeraBox path.~~ shipped,
  but no slow-indicator label (the throttle turned out to be avoidable by dropping the
  cookie, so there is nothing slow to warn about). ~~**no visible host badge is shown when
  reading from a secondary copy** — if a read ever silently lands on a non-primary host,
  that is a missing loud label, worth adding if it comes up.~~ **added 2.17.3**: the read
  layer now returns which copy served it (`copyIndex`/`primaryHost`/`failures`), the web
  proxy turns that into `X-Vault-Blob-Fallback` headers → page banner + lightbox warning,
  and the extension SW broadcasts `vaultReadFallback` → toast + detail-modal banner.

## open questions — all resolved

- ~~**upload speed**: measure before committing to parallel.~~ measured via the shipped
  uploader; sequential copies were kept (simpler, and the connection is the bottleneck).
- ~~**cookie freshness**: ndus expires.~~ handled by `hasTeraBoxSessionCookie` — a missing
  or expired session fails loudly with "log into TeraBox / update the cookie in Settings".
- ~~**parallel upload strategy**: simultaneous vs udrop-first + background sync.~~
  decided: sequential copies to the selected host set (see deviation note above).
- ~~**file size cap — 4 GB**.~~ confirmed; blobs are under it.
- ~~**download throttle**: 30 KB/s hard cap; is premium needed?~~ refuted — see the
  cookie correction above. no paid tier needed, and no paid tier is to be recommended.

## implementation steps (all shipped)

1. ~~measure TeraBox upload speed with the full PCS flow.~~ done
2. ~~`TeraBoxUploader` with chunked XHR + progress.~~ done
3. ~~`teraBoxApi.js` — list, dlink, delete, jsToken refresh.~~ done
4. ~~SW auth + save/handle/download messages.~~ done
5. ~~GalleryPage: write to TeraBox after udrop.~~ done (host-set copies)
6. ~~VaultPage/background: decrypt fallback path.~~ done (`fetchVaultBlobRange`)
7. ~~round-trip: upload → lock → unlock → decrypt from the backup copy.~~ done
8. ~~update AGENTS.md + plan status.~~ done (2.16.9 entry)

## scope / non-goals (still in force)

- not replacing udrop as the default host — TeraBox is a peer/backup copy, chosen per upload.
- not using AList or rclone for the extension vault path — pure direct API.
- not supporting TeraBox for non-vaulted images/videos (Pixvid/ImgBB/Filemoon are the
  normal upload targets).

---

# 3. Telegram as a video / 3D / vault host

date: 2026-10-10 · originally `plan-telegram-host.md` · diagram: `plan-telegram-flow.html`

**status:** phases 0 + 1 + 2 + 3a shipped (2.15.6–2.18.2), 3a live-verified against the real
channel 2026-10-30. phases 3b / 4 **open** (both
optional — 3b only buys telegram vault blobs over the 20 MB getFile cap).
`[verified 2026-10-30]` telegram **is** a vault blob host now (`vaultBlobHost: true` +
`vaultMaxBytes: 20 MiB` in `packages/shared/providerCatalog.js`), capped reads and all, and
`THREE_D_SOURCE_OPTIONS` includes it (phase 2).

## context

~~evaluated `caamer20/Telegram-Drive` as a host: **rejected as a dependency** (its
REST/WebDAV binds loopback only, the desktop app must be running — the Vercel web app can
never reach the user's `127.0.0.1`, so it would be a parity violation).~~ — still the
decision; it was used as a method reference only.

## verified facts (probed live 2026-10-10, still accurate)

- ~~`api.telegram.org` sends `Access-Control-Allow-Origin: *` — the Bot API is callable
  from extension page XHR AND from the web app; no localhost, no native host for
  bot-size files.~~
- ~~**Bot API caps**: cloud upload ≤ 50 MB (`sendVideo`/`sendDocument`/`sendPhoto`), cloud
  `getFile` download ≤ 20 MB.~~ — encoded as
  `TELEGRAM_UPLOAD_MAX_BYTES` / `TELEGRAM_GETFILE_MAX_BYTES`.
- ~~**local Bot API server**: unlimited download, 2000 MB upload — the big-blob path.~~
  still unbuilt (phase 3b, optional).
- ~~**public-channel video**: the `t.me/s/<channel>` preview HTML exposes a
  `<video src="…cdn…">`; hotlink 200 with no cookies, Range → 206, ACAO `*`, token
  stable.~~
- ~~**public-channel photos**: tokenless permanent CDN URLs.~~ — not used: images ship as
  documents (byte-faithful decision).
- ~~**documents** (`.spz`, vault `.bin`): no public URL; only `getFile` ≤ 20 MB, token in
  the URL → never persist it, resolve at fetch time.~~
- ~~**delete**: bot `deleteMessage` removes its own posts (admin rights).~~ shipped (2.15.7).
- ~~**enumeration**: `getMessages` pagination → integrity listings.~~ shipped (2.15.8).
- ~~accounts needed: Telegram account, bot via BotFather, public channel, api_id/hash —
  **nothing paid anywhere**.~~ confirmed; all free.

## what we take from Telegram-Drive (reference only)

- ~~grammers MTProto usage is kept as the documented ALTERNATIVE to the local Bot API
  server (3b), not built by default.~~ (still the position)
- ~~public message-link shape `t.me/<channel>/<msg_id>` as the stable watch URL.~~ shipped.
- we do NOT take: their app, loopback REST/WebDAV, TDENC2.

## architecture

### credentials — ~~planned~~ shipped
- ~~`telegramBotToken` (masked) + `telegramChannel` → settingsSchema → live DB columns
  (migration required — repo schema is not auto-applied).~~ shipped in 2.15.6
  (`apiKeyFields` → both platforms render them; ext reads `chrome.storage.sync`, web reads
  the settings row).

### ~~upload flow (page-side XHR → progress)~~ shipped
1. ~~`FormData` → `sendVideo` | `sendDocument` → `message_id`.~~
2. ~~`watchUrl = https://t.me/<channel>/<message_id>`.~~
3. ~~directUrl = fresh scrape of `t.me/s/<channel>` for the CDN url.~~
4. ~~store `{watchUrl, directUrl, messageId}`.~~ shipped as a relative
   `/telegram-media/<fileId>?mt=` url served by the platform-local proxy, with `getFile`
   resolved per request (never cached) — a deliberate tightening over the plan.

### ~~fresh-resolve hook~~ shipped
- ~~telesco token lifetime unknown → re-scrape on read, cache per session, throw LOUDLY if
  the scrape breaks.~~ shipped; a scrape failure also deletes the just-posted message so no
  orphan is left.

### ~~documents (3D spz, anything without a CDN URL)~~ shipped for media AND 3D
- ~~store `fileId`; resolve `getFile` at fetch time; extension SW fetches direct, web goes
  through a server-side proxy; the token never lands in the DB or a client-visible URL.~~
  shipped (ext proxy + `web/src/app/telegram-media/[fileId]/route.js`). **3D scenes** shipped
  with phase 2 (2.17.4).

### ~~vault — ⏳ open (phase 3a)~~ shipped 2026-10-30 (2.18.0), live round trip verified (2.18.1)
- crypto is unchanged (host sees only ciphertext).
- ~~upload: existing `encryptAndUploadVaultedBlob` catalog dispatch → `sendDocument`
  (cloud) …~~ **wired**: telegram carries `vaultBlobHost: true`, so both vault writers
  (`background.encryptAndUploadVaultedBlob` and the gallery page-side loop) dispatch it
  through the shared catalog, and `buildVaultBlobCopy` stores the byte route + the channel
  `messageId` for it.
- read-back constraint stands: cloud `getFile` ≤ 20 MB → telegram vault blobs are hard-capped
  at 20 MB, `assertVaultBlobHostSizes` fails LOUD on the encrypted size before any host is
  uploaded to, and `getTelegramFileInfo` repeats the cap on every read.
- bigger blobs → local Bot API server (phase 3b, optional).

### privacy (loud)
- a public channel's message pages are viewable by anyone who guesses the channel name;
  CDN hashes are unguessable. use an obscure channel name. vault blobs would be encrypted
  regardless.

## phases

- ~~**0 — spike**: BotFather → token into settings; public channel; bot as admin; run
  upload → scrape → hotlink → Range → delete.~~ **done 2026-10-15** (results below).
- ~~**1 — host for images + videos**: `TelegramUploader`, `telegramApi.js`,
  providerCatalog entries, settings fields + migration, gallery upload/play on BOTH
  platforms, delete, resolve-page integrity tab.~~ **done 2026-10-15** (2.15.6–2.15.12).
- ~~**2 — 3D (spz as document + texture as photo)**~~ **done 2026-10-30 (2.17.4 + 2.17.5)**:
  telegram opt-in is one catalog flag (`threeDHost: true`); `THREE_D_SOURCE_OPTIONS` +
  `THREE_D_HOST_KEYS` are derived from it, so settings/gallery/resolve all pick it up.
  **texture ships as a document, not a photo** (phase-0 A/B: `sendPhoto` re-encodes) —
  the `getFile` 20 MB gate is the scene limit, pre-flighted on BOTH files before either
  uploads. scene integrity has its own Telegram subtab (`sceneFiles.telegram` =
  spz/texture fileId + messageId; `extra` = unreferenced `t.me/s` media posts, 2 per
  scene by design since the API cannot enumerate files). web scene viewer fetches local
  `/telegram-media/` urls same-origin (`/api/media` only proxies absolute urls).
- ~~**3a — vault via cloud bot (≤ 20 MB) — ⏳ open**~~ **done 2026-10-30 (2.18.0)**: telegram
  is a vault blob host. one catalog flag (`vaultBlobHost`) + `vaultLabel`/`vaultMaxBytes`/
  `vaultCapNote`, so the picker states the cap and `assertVaultBlobHostSizes` pre-flights
  every selected host on the ENCRYPTED size before the first upload. reads go through the
  `fetchVaultBlobRange` telegram branch (Bot API `getFile` per range, Range → 206), writes
  store the byte route + `encryptedBlobMessageId` via the shared `buildVaultBlobCopy`,
  deletes remove the channel post (the Bot API has no file delete — said out loud), and
  web got a server-side reader (`telegramServerApi.js`, `WEB_READABLE_VAULT_HOSTS`).
- **live round trip, run 2026-10-30 on the real channel**: 3.06 MB vaulted image → post 65 in
  6.9 s, 10 MB → post 66 in 4.4 s, copy holds `encryptedBlobFileId` + `encryptedBlobMessageId`
  (mirrored top-level), probe reports `{chunked:true,total:10485760,chunkSize:8388608}`, and
  plaintext ranges came back **byte-equal** at the head (3695 ms), straddling the 8 MiB chunk
  boundary (835 ms) and at the tail (3 ms, cached) — so a chunked telegram blob costs one cold
  `getFile` and warm reads after that, which is the only real argument left for 3b. 25 MiB was
  refused before any upload with nothing saved, and after `permanentlyDelete` the ciphertext was
  still fetchable by file id (`bytesReachableAfterDelete: true`), confirming the *unreferenced,
  not wiped* wording in both delete paths.
- **3b — local Bot API server (2000 MB upload, unlimited read) — ⏳ open, OPTIONAL**:
  lifecycle-managed by the Rust native host. buys exactly one thing: telegram vault blobs
  > 20 MB, which udrop/terabox already serve. cut freely; over-cap = loud error, item goes
  to udrop/terabox (also stated under "decisions at the pause point").
- **4 — bulk-migrate the existing library via the bot/mainframe helper — ⏳ open, optional**.

## failure modes (no-fallback rule: every one fails LOUD, naming the cap)

- upload > 50 MB via cloud bot → error names the cap (local server = 3b).
- `getFile` > 20 MB → error names the cap + points at 3b.
- local server not running when a big blob is read → LOUD, names the native-host spawn.
- `FLOOD_WAIT n` → wait + one retry, then loud.
- scrape breakage → resolver throws with the marker text.

## decisions at the pause point (2026-10-11)

- ~~whole-plan diagram: `plan-telegram-flow.html` (repo root, commit `f95ce283`).~~
- ~~phase 3b (local Bot API server) is OPTIONAL, not required.~~ confirmed.
- ~~scope clarification: telegram is NOT gallery-only — the vault works on it too, just
  capped (phase 3a). the phase order is risk order.~~ still the plan.
- ~~still open from the spike list: Range support on cloud `getFile` URLs + the local
  server; `sendPhoto` vs `sendDocument` image A/B.~~ — **Range: verified** (spike table:
  `Accept-Ranges: bytes`, Range → 206). **A/B: decided** (`sendDocument`, byte-faithful).

## phase 0 — done (2026-10-15): admin granted, spike green end-to-end

~~bot created and token verified (`getMe`); channel created and public; bot-as-admin solved
without a human action; the whole upload → scrape → hotlink → range → delete spike ran
clean.~~

### ~~how bot-as-admin was solved~~ (history, still accurate)
- ~~the Bot API cannot promote a bot (no membership path); the logged-in web client is a
  live MTProto session and exposes `window.appImManager` on web.telegram.org/k; calling
  `managers.appChatsManager.editAdmin(...)` grants admin directly, no invite.~~
- ~~verified through the Bot API afterwards: member count 2, bot `status: administrator`.~~
- ~~generalises: every `appChatsManager` / `appMessagesManager` / `appUsersManager` call is
  reachable the same way.~~

### spike results (measured live) — kept as reference

| test | result |
|---|---|
| ~~`sendVideo` (h264 mp4, 20 122 B)~~ | ~~200, 1.8 s; byte-identical; 320x240; `message_id` returned~~ |
| ~~scrape public page~~ | ~~200; CDN url is in the HTML; no `og:video` — parse the markup~~ |
| ~~CDN hotlink~~ | ~~200 `video/mp4`, exact bytes, ACAO `*`, `Accept-Ranges: bytes`, 3 h cache~~ |
| ~~Range on the CDN url~~ | ~~206 head + mid-file, repeat reads OK — not single-use~~ |
| ~~`getFile` cloud url~~ | ~~200 `application/octet-stream`, Range → 206~~ |
| ~~`getFile` 20 MB gate~~ | ~~25 MB doc → 400 `file is too big`; the loud cap is real~~ |
| ~~upload cap~~ | ~~40 MB ok (1.4 MB/s); 51 MB fails as ConnectionError OR 413 — map BOTH~~ |
| ~~`deleteMessage`~~ | ~~`ok: true`; the channel-created service message is undeletable~~ |

- ~~**image A/B — decided**: `sendPhoto` re-encodes (14 074 B vs 23 122 B original);
  `sendDocument` is byte-faithful. **`sendDocument` it is**.~~ shipped.
- ~~**stream version vs `getFile` original — decided**: mp4 in → hotlink path; anything
  else → `getFile` (≤ 20 MB) or a loud over-cap error, never a silent re-encode.~~ shipped
  (webm comes back as a document with no CDN mp4).
- ~~**scrape-marker correction**: a post is `data-post="<ch>/<id>"` in the preview html.~~
  applied.

## phase 0 history (2026-10-14) — four dead-ends, kept so nobody re-litigates

| path | result |
|---|---|
| ~~Bot API `joinChat`~~ | ~~404 — a bot cannot add itself to a channel~~ |
| ~~Bot API `promoteChatMember`~~ | ~~Forbidden: bot is not a member~~ |
| ~~MTProto (telethon) with stored web sessions~~ | ~~`AuthKeyUnregisteredError` on its own DC~~ |
| ~~Telegram Web UI + pointer CDP~~ | ~~opening a chat needs a trusted pointer event; pointer dispatch wedged~~ |

- ~~the stored web auth keys are genuinely dead, not mis-addressed.~~
- ~~the web tab is pinned by a privacy extension to one chat hash; hash changes revert
  within ~200 ms.~~
- ~~keyboard input DOES reach the page; selection is the wall (rows are `<a>` with no href).~~
- ~~pointer dispatch wedges in the harness daemon (`_IPCResponseTimeout`) — a daemon bug.~~
- ~~both "unblock" options are obsolete — the manager-layer route beat them.~~

## phase 1 — done (2026-10-15): gallery host + delete + integrity tab, live-tested

| chunk | commit | shipped |
|---|---|---|
| ~~1 settings~~ | ~~`1c0cde25`~~ | ~~`telegramBotToken`/`telegramChannel` in settingsSchema; live row seeded~~ |
| ~~2 ext runtime~~ | ~~`82c54b9b` (2.15.6)~~ | ~~`telegramApi.js` + uploader; images → `sendDocument`; mp4 → `sendVideo` → CDN; `/telegram-media/<fileId>`; caps enforced; scrape failure deletes the post then throws; token never in a client-visible url or log~~ |
| ~~3 web route~~ | ~~`c0bc188c`~~ | ~~self-contained serve route (token server-side, `getFile` per request)~~ |
| ~~4 delete~~ | ~~`1abf0c63` (2.15.7) + fix `10efae28`~~ | ~~delete fires ONLY on permanent delete; ext + web helpers; "not found" = verifiable absent~~ |
| ~~5 integrity tab~~ | ~~`91991f55` (2.15.8)~~ | ~~resolve-page Telegram tab; strict pagination, loud on cap; found/missing/extra; extra-card delete~~ |

- ~~**restructure (2.15.9)**: the check moved under the video subtab row as
  `Telegram integrity`, judging the video type only, with an all-items extras pass.~~
- ~~**gap bucket + fix flow (2.15.12)**: `No Telegram URL` bucket, per-card Fix, bulk
  `Resolve all to Telegram`, mirroring the sibling host tabs.~~

### live-learned, keep (still relevant)

- ~~the `t.me/s` LISTING page is fastly-cached and can lag a fresh post by minutes — a
  reconciliation right after a fix upload can misclassify the item as broken, and a false
  broken card offers a Fix that re-uploads a DUPLICATE.~~ — fixed by making the post page
  the authoritative existence probe.
- ~~**the post page is the authoritative existence probe**: a ref counts as broken only
  when BOTH the listing lacks it AND its own post page lacks the message.~~ shipped.
- ~~ext-page fetch of a localhost asset url can be served a synthetic 204 by an
  environment layer — not app code; test fix flows from a real CDN url.~~
- ~~Telegram answers "message to delete not found" with HTTP 400 + JSON body, not
  200 + `ok:false` — parse the body before the `response.ok` check.~~ fixed in `10efae28`.
- ~~stat chips render during loading — wait for the completion NOTICE in tests.~~
- ~~browser-use reads drift in a busy Edge profile — pin with `switch_tab` before every
  call and return `location.href`; compare exact tab labels, never a /Telegram/i filter.~~

### ~~supersedes: "token never written in settings"~~ — phase 1 stores the token in
settings (Neon row for web, `chrome.storage.sync` for ext). still true: never in git,
never in a client-visible url, never in a log.

## still open (⏳)

- Range support on cloud `getFile` urls — ~~untested~~ **verified 206** `[2026-10-30]`.
- the 48h-window `t.me/s` history probe — **still not attempted** (the channel has no old
  media history to probe; only a service post).
- `sendPhoto` vs `sendDocument` A/B — ~~resolved by decision~~, no A/B run; not needed.

**parity note:** the telegram integrity check is ext-only because the web has no
`/resolve` route at all — a missing tab there is not a parity drop.

---

# 4. Platform feature parity (web ⇄ extension)

date: 2026-10-03 · originally `plan-platform-parity.md`
**status:** phases 0–4 all shipped. two small follow-ups remain open (below).

standing rule (AGENTS.md): every feature exists on BOTH platforms — if one side lacks it,
build it there; never hide/drop a field or UI to make them "match".

## ground rules for every phase (still in force)

- extension is touched LAST, if at all; earlier phases are build-time/shared-code only.
- per-phase gate before moving on: both apps `pnpm install --frozen-lockfile` + `pnpm build`
  green, phase smoke test passes, commit pushed, Vercel deploy READY and live-checked.
- **never test destructive actions on real items (2026-10-12 — non-negotiable)**: restore /
  permanent delete / empty / gallery delete / bulk ops run ONLY against synthetic rows
  inserted via Neon HTTP (needs just `id` + `kind`). real items are READ-ONLY. every live
  session ENDS with a count audit vs the pre-test baseline:
  `SELECT count(*) FILTER (WHERE deleted_at IS NULL), count(*) FILTER (WHERE deleted_at IS
  NOT NULL) FROM media_items` must match exactly and `WHERE id LIKE 'synthetic%'` must be
  0; on any mismatch, stop and report loudly first.
- extension dist rollback: `C:\tmp\imgvault-dist-backup-<version>`;
  `tools/reload-extension.ps1` refuses a partial dist.
- never flip `shared-workspace-lockfile: false` without updating CI
  (`nextgen-extension-crx.yml` install + `cache-dependency-path`) and Vercel (project
  `imgvault`, Root Directory = `web`) in the same change.
- learnings go into AGENTS.md as they happen.

## ~~phase 0 — pnpm workspace skeleton~~ ✅ done (commit `b441145`)

- ~~root `package.json` + `pnpm-workspace.yaml` (members `web`, `nextgen-extension`,
  `packages/*`; `shared-workspace-lockfile: false`; `allowBuilds` esbuild + sharp).~~
- ~~gotcha: member `pnpm-workspace.yaml` files shadowed the root workspace → `packages/*`
  invisible. pnpm 11 reads config from the workspace root only.~~
- ~~verified: both apps frozen install + build pass; Vercel READY; extension 2.13.18
  loaded, gallery 461 items.~~

## ~~phase 1 — settings parity~~ ✅ done (commit `9f9b882`)

- ~~single source of truth `packages/shared/settingsSchema.js`.~~
- ~~web `/settings` renders every field from the schema (incl. Default 3D Source).~~
- ~~web `/api/config` GET = defaults < app_settings JSON < table columns; POST writes every
  table-backed field via `buildTableSettingsPayload`.~~
- ~~POST persists `user_configs.firebase_config` (was stuck at `{}`).~~
- ~~`web/src/db/schema.js` gained `default_3d_source`.~~
- ~~persistence split: table columns vs `app_settings` / `chrome.storage.sync`.~~
- ~~verified live: all 12 fields render; save round-trip bumped `updated_at`.~~
- ~~minor cleanup left: GET could carry `id`/`updatedAt` from old app_settings JSON.~~
  **fixed since** `[verified 2026-10-30: web/src/app/api/config/route.js destructures both
  keys out before returning]`.

## ~~phase 2 — move the logic twins into `imgvault-shared` + drift guard~~ ✅ done (2026-10-11)

- ~~`providerCatalog.js` — host metadata + pure helpers; the extension catalog was the
  superset → canonical, web's copy is now a shim.~~
- ~~`imageProviderLinks.js` + `videoProviderLinks.js` — extension versions canonical
  (legacy column fallback, thumbnail no-fallback rule); web copies are shims.~~
- ~~`mediaDbPayload.js` / `mediaFieldRegistry.js` / `mediaItemNormalizer.js` — moved from
  repo-root `shared/`; web's vendored copies deleted.~~
- ~~**runtime stays app-side**: `uploaderClass` / `upload` / `uploadWithProgress` /
  `vaultDownloadUrl` are NOT in shared; `src/config/providerCatalog.js` attaches per-host
  runtime.~~
- ~~**the trap — runtime-bound lookups must return enriched entries**: a pure `export *`
  shim returns metadata-only entries → every upload path crashes. the shims re-export and
  override exactly those lookups.~~
- ~~**zero consumer-import edits**: aliases point at `packages/shared`; old paths kept as
  shims.~~
- ~~drift guard `tools/check-shared-twins.mjs` (`pnpm check:twins`, also a CI step) fails
  loudly on reappearing twins / fat shims / metadata re-definitions.~~
- ~~verification 2026-10-11: guard OK; `vite build` 13.9 s; `next build` green; frozen
  installs green in BOTH apps.~~
- ~~the `.pnpm-workspace-state-v1.json` gotcha: delete both state files (root + member
  `node_modules/`) before trusting a local `CI=true` frozen-lockfile result.~~

## ~~phase 3 — `packages/ui` detail-modal merge~~ ✅ done

### ~~3a — `packages/ui` + web swap~~ ✅ done (2026-10-11)
- ~~new pnpm package `imgvault-ui` with canonical `MediaDetailModal.jsx` + `Modal`/`Spinner`.~~
- ~~`GalleryLightbox.jsx` became a wrapper with the SAME public props; logic stays web-side.~~
- ~~visible web changes: 95vw/95vh dialog, tabs → "Overview/Technical", mobile drag handle
  gone, chevrons on mobile.~~
- ~~web config: `imgvault-ui: workspace:*` + `transpilePackages`.~~
- ~~**workspace-package dep trap**: a `packages/*` project importing any npm package needs
  the dep in its own `package.json` AND its own committed `pnpm-lock.yaml` (per-project
  lockfiles). `peerDependencies` are not a workaround.~~
- ~~verified: frozen install, `next build` green, guard OK, live smoke on
  imgvaultt.vercel.app.~~

### ~~3b — extension swap~~ ✅ done (2026-10-11, ext 2.13.24)
- ~~extension gained `imgvault-ui`; `MediaDetailModal.jsx` is a one-line shim (named →
  default); `UI.jsx` re-exports `Modal`/`Spinner`; drift guard extended in the same commit.~~
- ~~**vite compiles workspace-package JSX with ZERO config** (symlinked deps resolve to
  realpath) — contrast Next, which needs `transpilePackages`.~~
- ~~CI-mirror frozen install green (5 projects).~~
- ~~smoke on 2.13.24 (CDP, user's Edge): gallery modal, trash modal, collections dialog.~~
- ~~gotchas hit in smoke only: `browser-use` stdin via pwsh pipe fails silently (use
  `cmd /c "browser-use < script.py"`); `ensure_real_tab()` bounces off chrome-extension://
  tabs (use `switch_tab(id)` alone); non-ASCII literals mangle through the console codepage.~~

### ~~post-3b visual incident~~ ✅ fixed (2.13.25)
- ~~shared modal shipped on both platforms unstyled — tailwind content-glob trap: classes
  used only inside `packages/ui` were never generated.~~
- ~~fix 1: both tailwind configs scan `../packages/ui/**/*.{js,jsx}` — forward slashes only.~~
- ~~fix 2: web's daisyui was registered uninvoked → no semantic utility generated; switched
  to `daisyui({ themes: 'all' })` (web css 41 KB → 141 KB).~~
- ~~alpha-on-var variants (`bg-base-300/90`) never generate on tailwind v3 (both
  platforms) — the modal design tolerates it.~~ — this is the root cause of the open
  extension-trash tint item below.
- ~~verify tooling: `Select-String` gave FALSE NEGATIVES on minified single-line css — use
  `(Get-Content -Raw)` + `[regex]::Matches`. screenshot-verify UI changes from now on.~~

## ~~phase 4 — web feature parity roadmap~~ ✅ all four chunks done

1. ~~trash actions (restore / permanent delete / empty trash)~~ ✅ done (2026-10-12,
   `6ebc7e63`) — server host-delete clients in `web/src/lib/hostDeletes.js`,
   `/api/trash` POST actions mirroring the extension, `TrashLightbox.jsx`, banner +
   sticky toasts. verified live against a synthetic row.
2. ~~gallery delete + bulk select + bulk download~~ ✅ done (2026-10-12, 5 commits;
   extension bulk Download at manifest 2.15.0) — includes the `isNull` import fix and the
   `Promise.allSettled` + keep-failed-selected retry behavior.
3. ~~scene-viewer route~~ ✅ done (2026-10-13) — shared `packages/scene-viewer`, ext
   host rewired, web `/scene-viewer` route, live-tested on both platforms.
4. ~~collections management parity~~ ✅ done (2026-10-13) — shared
   `collectionsLogic.js`, web `/api/collections`, `/collections` page, scoped gallery
   route, ext inline-create, badge refresh, plus the duplicate-JSX-prop lightbox fix.

## open follow-ups (⏳)

- ~~**extension trash tints — ⏳ OPEN.** `nextgen-extension/src/pages/TrashPage.jsx` still
  carries **15** load-bearing daisyui alpha classes (`bg-warning/15`, `bg-error/20`,
  `bg-success/15`, `border-warning/30`, `border-success/40`, `border-error/40`, …) that
  tailwind v3 cannot generate from CSS-var colors — so the banner, confirm boxes and chips
  render with no tint while the web trash (palette alphas) renders correctly.
  `[verified 2026-10-30: 15 occurrences in source, 0 matches in the built dist CSS]`
  fix = swap to palette alphas on the extension side (+ manifest patch bump + reload).~~
  **fixed 2.17.1 (2026-10-30)** — the classes were never the bug: daisyui v5 exposes colors
  as bare CSS vars, so tailwind v3 emitted no `/opacity` variant for **any** daisy color
  (~750 dead utilities repo-wide). fixed at the source with
  `oklch(from var(--color-<token>) l c h / <alpha-value>)` tokens in both
  `nextgen-extension/tailwind.config.js` and `web/tailwind.config.js`. no per-class swaps.
- **~~web vault move is flag-only — OPEN (narrowed 2026-10-30).~~ CLOSED 2026-10-31.**
  `web/src/app/api/vault/move/route.js` (new) takes the browser-encrypted blob
  (`lib/vaultMove.js` encrypts in the tab) and relays it to Telegram; the row gets the
  extension's encrypted shape, plaintext columns/extra keys are blanked, share links are
  revoked. PATCH `action:'move'` answers 400. the 4.5 MB Vercel body cap is the one real
  limit: over-cap items are told, loudly, to move from the extension. udrop was not usable
  as the web upload target — its CORS response header is misspelled
  (`Access-Control-Allow-Orgin`) and OPTIONS returns no allow headers, so a browser
  upload is impossible; telegram is the only host with server-side write *and* read.
  **verified live 2026-10-31** — route E2E 27/27 on prod + browser move in Edge on a local
  instance, both with byte-equal decrypt read-back; scratch rows/posts cleaned up.
- ~~web cards scene-texture thumb.~~ **done** `[verified 2026-10-30: gallery/page.jsx
  renders firstImageLikeUrl(image?.textureUrl) with a "thumbnail unavailable" note on
  failure]`.
- ~~web `/api/config` GET carrying `id`/`updatedAt`.~~ **done** (see phase 1).

every chunk: shared logic first (`imgvault-shared`), web UI second, extension untouched
unless it is actually missing something.

## resume notes (infra, still current)

- push: token via `Read-VaultSecret` (github.com* pattern), then
  `git push "https://x-access-token:$tok@github.com/FahadBinHussain/imgvault.git" main`.
- Vercel: token via `Read-VaultSecret` (vercel.com*), project
  `prj_I3IzduxJsbQCrIbfF7XBZq2qLC83` in team `team_Mei5kaLVoB1zzUAgNmbxDq2R`
  (`bayazid10@gmail.com`, team "qwerty's projects"), production domain
  `imgvaultt.vercel.app`. **the CLI link belongs at the REPO ROOT**, not in `web/`:
  the project has `rootDirectory: web`, so `vercel deploy` must run from the root
  (fixed 2026-10-30 — `web/.vercel` held a dead `prj_hRlsKiTZuw5AV85YXfgeJBztIdjG`
  / "web" link that 404s in this team, which sent local deploys to the wrong place).
- psql 5432 is flaky from here — use the Neon HTTP fallback (port 443, `--resolve` to a
  working IP, `Neon-Connection-String` header, single statement per request).
- settings fields live in `packages/shared/settingsSchema.js`; never hand-edit field lists
  in `web/src/app/settings/page.jsx`.

---

# 5. Cross-plan open queue

everything still actionable, in one place:

| # | item | plan | notes |
|---|---|---|---|
| 1 | ~~extension trash tint fix (15 dead alpha classes)~~ | parity | **done 2.17.1** — fixed in the tailwind config (relative-color alpha tokens, both packages), not per-class |
| 2 | ~~web vault = flag-only / no decryption, extension-encrypted rows look empty~~ | vault | **done 2.17.2 + 2026-10-31** — web creates/unlocks/decrypts with the shared wrapped-master-key crypto + Range blob proxy, and web *move* now encrypts in the tab and relays ciphertext to Telegram via `POST /api/vault/move` (4.5 MB cap → extension for bigger items) |
| 3 | ~~"migrate old vault items" button (pre-2.6.0 plaintext vault rows)~~ | vault | **struck 2026-10-30** — never built, won't be; option B is final. legacy rows stay plaintext and now show a `Not encrypted` badge |
| 4 | scene (spz/texture) encrypted vault support | vault | scenes stay plaintext on their hosts |
| 5 | ~~telegram 3D (phase 2)~~ | telegram | **done 2.17.4 + 2.17.5** — `threeDHost` flag drives `THREE_D_HOST_KEYS`/options; docs-only textures + 20 MB pair pre-flight; Telegram 3D integrity subtab; local `/telegram-media/` scenes render on web; scene refs now persist (see the `updateImage` extra-key gotcha in AGENTS.md) |
| 6 | ~~telegram vault host (phase 3a, ≤ 20 MB cloud)~~ | telegram | **done 2.18.0 + live-verified 2.18.1** — `vaultBlobHost` + `vaultLabel`/`vaultMaxBytes`; shared `assertVaultBlobHostSizes` pre-flight + `buildVaultBlobCopy`; `fetchVaultBlobRange` telegram branch (getFile per range, 206); vault post ids count as referenced in telegram integrity; delete = `deleteMessage` of the blob post (no Bot API file delete, stated loudly); web reads telegram copies server-side via `lib/telegramServerApi.js` |
| 7 | local Bot API server (phase 3b) | telegram | optional; only buys > 20 MB telegram vault blobs |
| 8 | telegram bulk library migration (phase 4) | telegram | optional |
| 9 | `t.me/s` 48h history probe | telegram | untested; channel has no old media |
| 10 | ~~loud host badge when a vault read lands on a non-primary host~~ | terabox | **done 2.17.3** — `/api/vault/blob` returns copy/host/failure headers, web shows a page banner + lightbox warning, extension SW broadcasts `vaultReadFallback` → toast + detail-modal banner. also fixed `resolveVaultStreamUrls` hard-failing playback on a dead primary resolve |
| 11 | ~~make `buildExtraSeed` stop shadowing fresh extra-key writes~~ | parity | **done 2.18.2** — the builder now diffs against the row that was read (`updateImageNeon` passes `existing`): a top-level field the caller changed still wins (2.12.1 `isVaulted` rule intact), and an `extraMetadata` key the caller changed now beats the untouched top-level mirror that `fromNeonMediaRow` produces. `toMediaDbPayload` also replaces `merged.imageHosts`/`videoHosts` with a freshly written map, because `normalize*Hosts` merges maps field-by-field (provider columns still merge back in, so nothing is lost). "the caller named it in extraMetadata" alone was NOT enough — `fromNeonMediaRow` hands the whole stored blob back, so that version silently broke un-vaulting. scene/thumbnail dual writes stay, only for the legacy firestore backend; the neon rule "must ride top-level too" is dead. verified: node repro modelling `updateImageNeon` 13/18 → 18/18, plus a live prod run on 2.18.2 (second extra-only write stuck; flag-only un-vault still cleared `extraMetadata.isVaulted`); scratch rows trashed + purged after. web unaffected — only `nextgen-extension/src/utils/storage.js` imports `toMediaDbPayload`, and `web/src/app/api/images/route.js` merges from `current.extraMetadata` directly (no top-level mirror there) |
| 12 | ~~vault key is only re-pushed to the worker on page load, so an idle MV3 restart makes an unlocked vault act locked~~ | vault | **done 2.18.3** — the worker keeps its own copy in `chrome.storage.session` (`vaultMasterKeyB64`) and `ensureVaultMasterKey()` re-imports it whenever memory is empty, called ahead of every lock gate (encrypt/upload, decrypt, range read, probe, `/vault-stream`, move-to-vault, restore, vaulted upload) plus `getVaultStatus`/`vaultGetMasterKey` so the UI stops contradicting the page. Import is split from the notify-dedupe reset, so a healed worker does not re-report fallbacks it already announced. `clearVaultMasterKey()` is now the single way out (memory + session copy + plaintext cache together) and the `vaultClearMasterKey` case awaits it, so a lock can never be undone by the copy. Still fails LOUDLY with "vault is locked" when neither place has a key — no silent degradation. Verified on a real eviction, not a model: the harness drives the worker through its content-script world in a throwaway edge profile and watches the `service_worker` CDP target disappear and come back with a new id — 13/13 pass, including the half that matters most (after a lock + a second eviction it stays locked and hands out no key). harness kept at `automata-private\microsoft.com\edge\mv3-worker-cdp-harness.mjs` |
