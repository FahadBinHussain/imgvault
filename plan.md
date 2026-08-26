# Plan: real encryption for the ImgVault Secret Vault (pure WebCrypto + udrop)

date: 2026-08-25
status: **v1 IMPLEMENTED (2.6.0) — awaiting manual round-trip test**

## context / current state

the current "Secret Vault" is only a **visibility toggle**, not encryption
(`VaultPage.jsx` disclaimer: *"Phase 1 hides items from the regular UI. It does
not encrypt hosted files or database fields yet."*). the passcode is hashed with
SHA-256 + salt and used only to gate the UI; the underlying files sit in plaintext
on Pixvid/ImgBB/Filemoon/udrop, and the DB rows (Neon) carry the real metadata.

goal: vaulted items must be **encrypted at rest** — blob content and blob
filename encrypted with a key derived from the vault passcode — stored as **flat
blobs on udrop** (no folders), exactly the rclone-crypt model but implemented in
pure WebCrypto so **no AList / no rclone / no WinFsp** is needed.

### why udrop only
- udrop has a simple file-upload API (`/api/v2/file/upload`, multipart) and the
  extension already has a `UDropUploader` + `udropApi.js` client.
- udrop accepts arbitrary blob content; uploads are reliable for both images and
  videos (~2.7 MB/s measured single-connection).
- TeraBox is deferred: it needs AList + the chunked PCS upload protocol, so it
  does not fit the pure approach. revisit later if ever needed.

## architecture

```
vault passcode
   │  PBKDF2 (SHA-256, 100k+ iters, per-vault salt) ──► master key (256-bit)
   │
   ├─► content key: AES-256-GCM encrypt the blob        ──► upload encrypted blob to udrop (flat)
   │        (random 12-byte IV per item, tag appended)
   │
   └─► name key: encrypt item filename + stored metadata ──► opaque string used as udrop filename
```

- udrop sees only: a random opaque filename (`<base32>.bin`) + ciphertext bytes.
  without the vault passcode, neither the file name nor the content is readable.
- the Neon DB row for a vaulted item stores **only** the encrypted blob's udrop
  link + the encrypted metadata blob + the per-item IV/salt. it does **not** store
  plaintext tags/description/source URLs for vaulted items (those move into the
  encrypted payload).
- the passcode never leaves the extension; the master key is derived in the
  service worker on unlock and held in memory only (session). it is never written
  to the DB, storage.sync, or udrop.

## key crypto decisions

- **KDF**: `crypto.subtle.deriveKey` PBKDF2, SHA-256, 100,000 iterations,
  256-bit AES-GCM key. salt = 16 random bytes, generated once per vault and
  stored (plaintext is fine) in `secretVaultConfig`.
- **Key wrapping (master key)**: on vault creation, generate one random
  256-bit **master key** (AES-GCM). all vault blobs are encrypted with the
  master key. the passcode-derived key encrypts the wrapped master key into
  `secretVaultConfig.wrappedMasterKey` (AES-GCM, iv stored alongside). unlock =
  derive passcode key → unwrap master key → use master key for blobs. passcode
  change = unwrap old master key, re-wrap with new passcode key. blobs never
  re-encrypted.
- **Blob encryption**: AES-256-GCM with the master key. per-item 12-byte random
  IV prepended to the ciphertext. tag (16 bytes) appended per WebCrypto
  semantics. encrypted blob = `iv || ciphertext || tag`.
- **Filename/name obfuscation**: store the encrypted name as a separate small
  AES-GCM payload (name + mime + optional tiny JSON metadata) so the udrop
  filename can be a fixed opaque `<32 hex chars>.bin`.
- **Key change**: instant (re-wrap only), per key wrapping above. no per-item
  re-encrypt needed.
- **Thumbnails**: vaulted items should NOT have decrypted thumbnails cached in
  plaintext. gallery/vault render decrypted previews only while unlocked; drop
  them from memory on lock.

## what changes

### new module
- `nextgen-extension/src/utils/vaultCrypto.js` — key derivation, encrypt/decrypt
  blob, encrypt/decrypt metadata payload, opaque-name generation. pure
  WebCrypto, no deps.

### storage layer (`src/utils/storage.js`)
- `saveVaultConfig` / vault config shape: add `vaultSalt`, `vaultVersion`,
  `kdfIterations`.
- new vault-item write path: when an item is created/uploaded as vaulted (or
  moved into the vault), encrypt the blob + metadata **before** upload, and store
  `encryptedBlobUdropUrl`, `encryptedMetadata` (base64), `iv`, `vaulted:true`
  instead of the normal provider URLs / plaintext metadata.
- `getVaultImages` / `getImageById` for vaulted rows: return the encrypted
  payload; decryption happens on demand in the caller (vault page / detail modal)
  with the in-memory master key.
- move-to-vault / restore-from-vault: move-to-vault encrypts (download original
  from provider → encrypt → re-upload to udrop → update row). restore decrypts
  back to a normal item (or just un-vaults if the blob stays udrop-encrypted —
  decide: keep encrypted at rest always, or restore to plaintext providers).
  recommended: **keep encrypted at rest even after restore** is NOT viable for
  normal gallery thumbnails, so restore = decrypt + move to the normal
  Pixvid/ImgBB/Filemoon path OR keep the item on udrop in plaintext. simplest
  v1: restore = decrypt blob → re-upload as a normal item via existing uploaders.

### upload path (`src/background/background.js` + `uploaders.js`)
- `handleImageUpload` / `handleVideoUpload`: if `data.isVaulted`, encrypt the
  blob with the vault key (require unlocked vault at upload time) and use
  `UDropUploader` for the encrypted blob instead of Pixvid/ImgBB/Filemoon.
- skip duplicate-detection hashing for vaulted items (hashing plaintext leaks
  nothing directly, but the pHash/EXIF pipeline currently stores plaintext
  metadata — route vaulted items through a "no metadata" path).

### UI (`src/pages/VaultPage.jsx`, `MediaDetailModal.jsx`)
- keep the existing passcode gate; after unlock, derive the master key once and
  keep in memory.
- vault grid + detail modal decrypt blobs on demand (fetch udrop → decrypt →
  object URL). release object URLs on lock / unmount.
- lock action explicitly drops the key + any decrypted object URLs.
- change-passcode flow: re-encrypt all vault items (progress UI).

### settings (`src/pages/SettingsPage.jsx`)
- no new keys needed for the vault itself (udrop keys already exist). add
  nothing unless a separate "vault udrop account" is desired (recommended:
  reuse the same udrop account + keys; blobs are opaque so it's safe).

### web app (`web/`)
- the web vault page can list vaulted items (encrypted payloads) but **cannot
  decrypt** (passcode never leaves the extension). mark web vault as
  "list-only / locked" — shows encrypted items with no preview, or is disabled
  for vaulted items. do not store the passcode on the server.

## scope / non-goals

- TeraBox integration: deferred (needs AList/PCS).
- native host / rclone / WinFsp: not used.
- end-to-end encryption of the non-vault gallery: out of scope.
- **existing already-vaulted items: DECISION (2026-08-25) = new-encryption-only
  (option B).** items vaulted after the update are encrypted; items vaulted
  before it stay exactly as they are — plaintext files on their current
  providers (Pixvid/ImgBB/Filemoon/udrop), hidden behind the passcode gate but
  not encrypted, still fully functional. **no auto-migration on unlock.** a
  "migrate old vault items" button in the vault page is a future follow-up
  (download original → encrypt → re-upload to udrop → update row); do not build
  it in v1.
- **restore from vault: DECISION (2026-08-25) = re-upload via normal
  providers.** decrypt blob → re-upload through the existing
  Pixvid/ImgBB/Filemoon uploaders (image/video) so restored items behave like
  normal gallery items with thumbnails. scenes restore to udrop plaintext.
- **passcode change: DECISION (2026-08-25) = key wrapping from the start.**
  a random internal master key encrypts all vault blobs; the passcode-derived
  key (PBKDF2) encrypts only the wrapped master key. changing the passcode
  re-wraps the master key (fast, no per-item re-encrypt). user still uses a
  single passcode; master key is invisible plumbing.

## implementation steps (after go)

1. `vaultCrypto.js` — KDF + encrypt/decrypt helpers + unit sanity checks in a
   scratch page or console.
2. storage.js — vault config shape (salt, version) + encrypted item read/write.
3. background.js — vaulted upload path (encrypt → udrop), move/restore paths.
4. VaultPage + MediaDetailModal — decrypt-on-view, lock clears keys/URLs.
5. SettingsPage change-passcode → re-encrypt-all.
6. web vault — list-only mode for encrypted items.
7. build + manual test on Edge (bump manifest version, `pnpm build`,
   `start msedge http://reload.extensions`), then a full round-trip:
   upload-encrypt → lock → unlock → decrypt-view → restore.
8. verify pre-existing vaulted items still render fine unencrypted (option B
   backward-compat: `getVaultImages` must handle both encrypted rows and legacy
   plaintext rows).

## v1 done (2.6.0, 2026-08-25) — what shipped

- `src/utils/vaultCrypto.js` — PBKDF2(100k) → passcode key; random 256-bit master
  key wraps it (AES-GCM); `encryptBlob`/`decryptBlob` (iv||ct||tag), encrypted
  metadata payload, `createVaultConfig`/`unwrapMasterKey`/`rewrapMasterKey`.
  round-trip + wrong-passcode + rewrap tests all passed.
- `src/utils/vaultSession.js` — page-side master key held in memory only.
- `src/background/background.js`:
  - `vaultSetMasterKey` / `vaultClearMasterKey` messages (key in SW while unlocked)
  - `encryptAndUploadVaultedBlob` — encrypt → flat opaque `<hex>.bin` → udrop
  - `handleVaultedUpload` — vaulted uploads bypass pixvid/imgbb/filemoon, store
    encrypted blob URL + encrypted metadata + isVaulted only (plaintext metadata
    kept blank)
  - `moveItemToVault` — encrypts on move when unlocked; legacy flag-only fallback
    for old vaults / no-vault; **throws if vault is encryption-capable but locked**
    (no silent plaintext)
  - `restoreFromVault` — decrypts → re-uploads via normal providers → un-vaults
  - `decryptVaultBlob` — regenerates stale udrop download URL from `fileId`
    before decrypting (durable long-lived vaults)
- `src/pages/VaultPage.jsx` — unlock unwraps master key + pushes to SW; legacy
  vaults auto-upgrade (gets wrapped key under same passcode); encrypted items show
  a lock placeholder in the grid and decrypt-on-view via the SW (object URL
  revoked on close/lock); lock clears key + URLs; search uses decrypted metadata.
- `public/manifest.json` — version bumped 2.5.3 → 2.6.0. built clean, reloaded.

### not done in v1 (carried from plan)
- web vault list-only mode for encrypted items (step 6) — extension path first.
- "migrate old vault items" button for pre-existing plaintext vaulted rows.
- scene (spz/texture) encrypted vault UI — scenes stay on udrop plaintext for now
  (scene rows are not encrypted, matching option B for pre-existing rows).
- `SettingsPage` passcode change already re-wraps via `rewrapMasterKey`
  (instant); the old "re-encrypt-all" note is superseded by key wrapping.

## open questions (RESOLVED)
- **restore from vault**: re-upload via normal providers (Pixvid/ImgBB/Filemoon).
- **passcode change**: key wrapping from the start — instant, no per-item re-encrypt.
- **pre-existing vaulted items**: option B (new-encryption-only, no migration).
