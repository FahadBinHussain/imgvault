# ImgVault Android app

The Kotlin/Compose client for the ImgVault vault. Lives in `android/` inside
the same public repo as the Chrome extension and the web app — one repo, one
release train, three front ends.

## Build: CI ONLY, never on the Windows dev box

A local Gradle run drags the whole machine down (the Gradle daemon + AGP
+ Kotlin compile + AAPT2 on a 16 GB Windows box is what the plan calls a
"hang the PC" session). Every build happens in GitHub Actions
(`.github/workflows/android.yml`):

* `./gradlew :app:testDebugUnitTest` — the JVM unit tests
* `./gradlew :app:assembleRelease` — the signed APK
* the APK is published as a GitHub release asset (`android-v<versionCode>`)
* the update manifest (`web/src/data/android-release.json`) is rewritten and
  committed back, so `GET /api/app-release` always names the newest build

## The signing key is a secret, not a file

The release keystore is a PKCS#12 blob in the GitHub secret
`IMGVAULT_KEYSTORE_BASE64` (+ `IMGVAULT_KEY_ALIAS`, `IMGVAULT_KEY_PASSWORD`,
`IMGVAULT_STORE_PASSWORD`). It is NOT in this repo and never will be — the
CI job fails loudly when the secret is missing instead of shipping a
debug-signed APK that no phone could ever update.

The local copy (for re-signing a build by hand) is outside the repo:
`C:\Users\Admin\Downloads\imgvault-secrets\imgvault-android.p12` with the
password in `imgvault-android-password.txt` next to it.

## The update rules (do not "simplify" these away)

* the manifest's `minSupportedVersionCode` is **carried over** from the
  previous manifest — it is NEVER derived from the build being published. The
  floor is raised by an explicit edit of `web/src/data/android-release.json`,
  and only by hand.
* the APK is verified against the manifest's SHA-256 **before** it reaches
  the system installer; a mismatch deletes the file and aborts.
* the install goes through `PackageInstaller` with the **user action
  required** — a sideloaded app can never be installed silently. The prompt
  is the mechanism, not an obstacle.
* the app needs the `REQUEST_INSTALL_PACKAGES` permission, and the user has
  to allow "install unknown apps" for whatever app opens the APK.
* the app ships with **zero secrets**: the Neon connection string, the host
  API keys and the Telegram token are entered by the user in Settings and
  live in an EncryptedSharedPreferences file whose key is held by the Android
  Keystore.

### A publish needs a NEW versionCode

An APK is not byte reproducible, so rebuilding the same version and
re-uploading it replaces the published bytes under the same tag with a
different SHA-256 — and the manifest has to follow, which churns the branch
and leaves a phone that installed the first build with a hash the publisher
no longer serves.

The workflow therefore compares the `versionCode` with the published one
before it does anything: the unit tests always run, but the build, the
release and the manifest only happen when the `versionCode` is really newer.
**To publish a change, bump `versionCode` in `android/app/build.gradle.kts`.**

## The Neon wire shape

The gallery does NOT talk to the web app — it talks to Neon directly over
SQL-over-HTTP, exactly like the extension:

```
POST https://<host-with-first-dns-label-replaced-by-"api.">/sql
headers: Neon-Connection-String, Neon-Raw-Text-Output: true, Neon-Array-Mode: true
body:    { "query": "...", "params": [...] }
```

With those headers the answer is `{"fields":[...],"rows":[[...]]}` and EVERY
value is TEXT — numbers included. `core/neon/NeonClient.kt` owns that
conversion.

### A cell that holds JSON arrives as the JSON TEXT

`Neon-Raw-Text-Output` hands over EVERY value as a string, so a `jsonb`
column (`extra_metadata`) and a text array column (`tags`) arrive as the JSON
text itself — `"{\"isVaulted\": true}"`, `"[]"`. Reading such a cell with
`.jsonArray` throws, because the cell is a `JsonLiteral`:

```
Element class kotlinx.serialization.json.JsonLiteral
(Kotlin reflection is not available) is not a JsonArray
```

That is the crash the phone showed on 1.0.0. Read those cells with
`asJsonObjectOrEmpty()` / `asJsonListOrEmpty()` / `asJsonValue()`
(`core/neon/NeonClient.kt`) — they parse the text and never throw; a cell that
is not JSON reads as empty. `NeonTextTest.kt` pins the behaviour.

### Postgres writes a boolean as t/f

`is_video` and `is_link` come over as the letter `t` or `f`, not `true` or
`false`. A boolean cell that only knows `true` reads every video as an
image: the tile shows a broken picture icon and tapping it opens the image
viewer instead of the player. `asBooleanOrFalse()` reads `t`, `true`, `1` and
`yes` — keep it that way.

### The gallery and the vault split the rows

The gallery shows only the rows a normal user would see:

```sql
where deleted_at is null
  and left(id, 9) <> '__imgvault_'
  and coalesce(extra_metadata->>'systemType', '') <> 'secretVaultConfig'
  and coalesce(lower(extra_metadata->>'isVaulted'), 'false') not in ('true', '1', 'yes')
```

The same filters the web gallery runs (`web/src/app/api/images/route.js`). A
vaulted row keeps its plaintext columns BLANK, so it shows up in the gallery
as an empty tile with an id as its title — that is what "the gallery shows
192 vaulted items" looks like.

The vault configuration is NOT in the phone: it lives in the
`__imgvault_vault_config__` row (`extra_metadata->'secretVaultConfig'`), the
same place the web vault reads it from, so the passcode alone unlocks the
vault on the phone.

The endpoint rule was measured against the user's own database on
2026-11-26: `https://api.<region>.aws.neon.tech/sql` answers 200, and so does
the bare host; the api-prefixed form is what the JS client uses, so it is
what the Kotlin client uses too.

## ONE grid for every feed

`ui/grid/` holds the Google Photos grid, and it is the only place that knows
how a feed is drawn:

- `JustifiedLayout.kt` — the geometry (rows of tiles that share one height).
  It works on ANY item: the caller says how wide an item is (`ratioOf`) and
  which day it belongs to (`dayKeyOf`).
- `JustifiedGrid.kt` — the drawing: the date headers that stick to the top,
  the rows, the pinch that changes the density.
- `GridChrome.kt` — what a tile looks like without a picture, the video badge
  and the video placeholder.

The gallery (`ui/gallery`) and the vault (`ui/vault`) both draw THAT grid, so
they look and behave the same and one set of unit tests pins both
(`ui/grid/JustifiedLayoutTest.kt`). Do not copy the grid into a screen — a
second copy is a second thing to keep right.

Where the picture comes from is the caller's business: the gallery loads it
from a host url, the vault DECRYPTS it. The grid does not care.

### The vault's pictures are encrypted previews

The extension encrypts a small JPEG of every vaulted item and stores it in
`public.media_item_previews` (`item_id`, `preview_encrypted`). It is the same
single-shot AES-GCM container as the metadata — `iv || ciphertext || tag`,
base64 — but the plaintext is PICTURE BYTES, so it must not go through
`decryptMetadata` (that one decodes to text). `VaultCrypto.decryptPreviewBytes`
is the byte-level twin.

The grid asks for the tiles it draws, so the asks are collected into ONE query
per batch (`where item_id = any($1)`) — a scroll reads a page of pictures
instead of one request per tile.

A vaulted row keeps its plaintext columns blank, so the shape of the tile and
the day it belongs under come from the DECRYPTED metadata (width, height,
creationDate), with the day it was vaulted as the fallback.

## The vault crypto is a PORT, and it is pinned

`core/crypto/VaultCrypto.kt` is a Kotlin port of
`packages/shared/vaultCrypto.js` — that JS file stays the source of truth
(the repo's `check-shared-twins` rule). The port is pinned by
`app/src/test/java/com/imgvault/app/core/crypto/VaultCryptoTest.kt`, which
uses **golden vectors generated by running the real JS module** (fixed
passcode, fixed PBKDF2 salt, fixed master key). If the two ever drift, the
JS side wins and the test fails.

Never "improve" the crypto in the Kotlin file: the format is shared with the
extension and the web app.

## The vault key belongs to a vault configuration

The master key on the phone is stored in `SecureStore` together with its
BINDING — the `passHash` of the configuration it was unwrapped from
(`core/crypto/VaultKeyBinding.kt`). Without that binding a key from another
database, another account or an older passcode is indistinguishable from a
right key with dead data: every item fails with `BAD_DECRYPT`
(`error:1e000065`), which names the symptom and not the cause.

The check runs on every load: a binding that does not match the account's
current configuration drops the key, locks the vault and asks for the
passcode again. A key stored by an app that predates the binding counts as
stale on purpose — the safe move is to ask, not to guess.

The wrapped key is a CIPHERTEXT: compare its DECODED bytes (SHA-256 over the
decoded blob), never the base64 text. Re-wrapping the same master key with a
fresh IV gives different base64 and the same key.

### One unreadable item does not take the vault down

`loadVaultItems()` returns `VaultLoadResult(items, failed, total)`: an item
whose metadata cannot be decrypted keeps its place in the list and says what
is wrong with it, and the header counts them ("12 of 192 vault items could
not be decrypted with this vault key"). Throwing on the first bad row hid
the other 191 and turned a data problem into a broken screen — and the count
is the measurement that tells the two apart (0 failures = the key is wrong,
all of them = the data was written under another key).

## The Morph progress ring is a PORT too

`ui/update/BoloWavyProgress.kt` + `ui/update/BoloWavyRingMath.kt` come from
the bolo-keyboard app (the Material 3 Expressive wavy progress ring, the
numbers from M3 1.5.0-rc01). Only the package changed; the maths is pinned
by `BoloWavyRingMathTest.kt`. It needs `androidx.graphics:graphics-shapes`
(1.1.0 — that is the version that ships `Morph`).

### The vault detail screen had no video player

A vault video opened on its preview still and stayed there: the detail
screen only rendered the decrypted preview JPEG, with no `isVideo` branch,
no player and no call to `loadVaultBytes` anywhere in the UI. The preview
is a still — a video needs its decrypted blob.

The fix (1.0.8): the vault detail loads the video as a FILE and plays it
with ExoPlayer, the same player the gallery detail uses. The blob streams
from its host (Telegram via the Bot API `getFile` URL, or a direct TeraBox
link) through the IVG1 chunk decrypt straight into a cache file
(`loadVaultVideoFile`, `decryptVaultStreamToFile`) — it is never held in
memory whole, so a hundred-megabyte video does not need a hundred-megabyte
heap. The file is written to a `.tmp` sibling and renamed only when the
whole blob decrypted, so a cached file is always complete and a second open
reuses it. While the blob downloads the preview still is the poster with a
spinner and a "Loading the video…" label; a failure says why instead of
leaving the poster up. `VaultCrypto.kt` itself is untouched — the stream
decrypt reuses its chunk primitives (`parseVaultBlobHeader`,
`getVaultChunkLayout`, `decryptEncryptedChunk`) and is pinned by
`VaultRepositoryTest.kt` (single chunk, multi-chunk, legacy single-shot,
truncated blob fails loudly).

**1.0.9 follow-up (same day, found by testing on the phone):** the 19s
vault video still did not play — it failed loudly with "no bot token is
configured". The app ships with zero secrets, so the Telegram token is
empty until the user adds it in Settings, but the item ALSO has a TeraBox
copy and the code never tried it: Telegram was chosen first and its missing
token threw before TeraBox was reached. Now the video tries every host the
item lists — Telegram first when its token is configured, otherwise the
TeraBox copy — and when every host fails the error names them all
(`vaultVideoHosts`, pinned by `VaultRepositoryTest.kt`).

## No secrets in this repo

Not in the code, not in the resources, not in the CI logs. The app asks the
user for their own Neon URL and host keys, the same model as the extension's
Settings page.
