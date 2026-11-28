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

## 1.0.10 — six fixes in one release

**The signing certificate changed every release (the update could never
install).** 1.0.7, 1.0.8 and 1.0.9 were each signed with a DIFFERENT
certificate (v2 SHA-256: 1.0.7 `42828de9…`, 1.0.8 `f2681c8a…`, 1.0.9
`02874b1c…`), so 1.0.9 could not install over the 1.0.8 on the user's phone
at all — `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, and the in-app screen only
said "the system installer did not install the update". **One-time
consequence: 1.0.8 must be UNINSTALLED once, then 1.0.10 installs clean.**
The 02874b1c keystore that signed 1.0.9 is LOST — it only ever lived in the
GitHub secret, which rotated again after 1.0.9 (the CI build then signed
with a fourth cert, `c22109fc…`), and the local `.p12` turned out to be a
FIFTH cert (`bda52264…`, CN=ImgVault Android, alias `imgvault`) that had
never signed any release. So 02874b1c cannot be restored from anywhere.
**The stable keystore is the local `.p12`** (`C:\Users\Admin\Downloads\
imgvault-secrets\imgvault-android.p12`, cert `bda52264…`): on 2026-11-27
the GitHub secrets were set from that file (`IMGVAULT_KEYSTORE_BASE64` +
`IMGVAULT_KEY_ALIAS=imgvault` + both passwords from
`imgvault-android-password.txt`), and `android/signing-cert-sha256.txt`
now pins `bda52264…`. The CI step "Pin the signing certificate" reads the
built APK's signing certificate with **apksigner** (`verify --print-certs`,
the same tool Android uses) and FAILS the build when it differs. The
earlier hand-rolled v2-block parser (python3 + struct/hashlib) was WRONG:
it kept reporting a stale `c22109fc…` certificate while apksigner proved
the same APK is signed with the pinned `bda52264…` — the build had been
signing correctly all along and the pin's parser was the bug, not the
keystore, the secret, or any cache (config cache, build cache and stale
APK were all ruled out the hard way). Never bring back a hand-rolled
signing-block parser for the pin; apksigner is the authority. **The local
`.p12` is the canonical copy — never regenerate it, never replace it, and
keep it in the vault; the GitHub secret is set FROM it, never the other way
round.** If the secret ever drifts again the pin fails the build instead of
shipping an update no phone can install.

1. **Install button.** Two gaps: the app declares `REQUEST_INSTALL_PACKAGES`
but the user still has to turn on "Install unknown apps" for ImgVault, and
the button gave no hint — `UpdateViewModel.install()` now checks
`canRequestPackageInstalls()` first, fails loudly naming the setting, and
opens that exact settings page (`ACTION_MANAGE_UNKNOWN_APP_SOURCES`). The
install-result failure now carries the numeric status code ("(status 6)" is
`STATUS_FAILURE_INCOMPATIBLE`, a signature mismatch), so the next failure
is diagnosable instead of a bare "it did not install".
2. **Launcher icon.** The hand-drawn white frame+mountains vector on solid
`#3D5AFE` is gone. The icon is now the project's real shield
(`nextgen-extension/public/icon128.png`, teal/blue gradient, cloud + padlock
over a picture): a 432×432 adaptive foreground (shield in the centre 288
safe zone), legacy mipmap PNGs (48/72/96/144/192, shield + round), and the
background is the shield body's deep blue `#1F57A8`. The adaptive XMLs
already referenced `@drawable/ic_launcher_foreground`, which now resolves
to the PNG — they needed no edit.
3. **Gallery video thumbnails.** Videos showed an empty placeholder: the
built-in video hosts carry no `thumbnailUrl`. A video tile with no thumbnail
URL now loads a real frame from the video's direct URL with Coil's
`VideoFrameDecoder` (`io.coil-kt:coil-video:2.7.0`), keeping the duration
badge + play icon; a failed frame falls back to the placeholder. The
image-tile path is unchanged.
4. **Vault lock.** The master key lived in the Keystore-backed store, so it
survived a restart and the vault opened itself — the LockedPane flashed
once and the vault was open. The key now lives ONLY in memory
(`inMemoryKey`): `unlock()` derives it and writes only the key binding,
`lock()` drops it and clears any key a 1.0.8/1.0.9 build stored, and a null
binding is NOT stale (`VaultKeyBinding.isStale` — null means "no key was
stored", so the vault is simply locked). On app start the vault shows
LockedPane and STAYS there until the passcode is entered.
5. **Vault video: source setting + true streaming.** Settings now offers
TeraBox as a default video host. The host order follows the user's source
(`vaultVideoHosts(item, defaultVideoSource, token)` — the source first when
the item has it, then the rest; Telegram is NOT a hardcoded constant, it is
first only when the user picked it). The video no longer downloads to a
cache file: `VaultBlobDataSource` (an ExoPlayer `DataSource`) reads the
16-byte IVG1 header with one Range request, then fetches exactly the
encrypted chunks each read spans with one Range request and decrypts them
with the existing `VaultCrypto` primitives — a 700 MB video starts in
seconds and is never held on disk. Legacy single-shot blobs fall back to
decrypting in memory. The same host order now applies to vault IMAGES
(`loadVaultBytes`), which used to throw "no bot token" before trying
TeraBox. The old file path (`loadVaultVideoFile`, `downloadAndDecryptVideo`,
`decryptVaultStreamToFile`, `readExactly`, `videoFileExtension`) is deleted;
the streaming decrypt is pinned by `VaultRepositoryTest.kt` (span math,
multi-chunk stream, seek, legacy) against an in-memory Range-serving
OkHttp interceptor.

Two compile gotchas this release, so the next person does not re-hit
them: in media3 `C.LENGTH_UNSET` is a Java `int`, not a `Long` — assigning
it to a `Long` or comparing it to one fails to compile, use
`C.LENGTH_UNSET.toLong()`. And Coil's video frame decoder is
`coil.decode.VideoFrameDecoder`, not `coil.video` — the `coil-video`
artifact puts it in the `coil.decode` package.

A third one, from the streaming tests: in a plain JVM unit test
`android.net.Uri.parse` is a stub that returns null, and media3's
`DataSpec` throws on a null Uri — so the streaming tests drive
`VaultBlobDataSource.openAt(position, length)` (internal, the same code
`open(DataSpec)` delegates to) instead of building a `DataSpec`. Do not
"fix" the tests back to `DataSpec` without Robolectric.

## 1.0.11 — the launcher icon is the new brand, not the old shield1.0.10 shipped the extension's old shield (`nextgen-extension/public/
icon128.png`, cloud + padlock) as the launcher icon. The user called it
foul — ImgVault's new brand is the purple lightning bolt, and the white
one is the one to use (`nextgen-extension/public/icons/1.png`, 512×512,
white bolt on deep purple `#370278`, transparent rounded corners; the
web app's BrandLogo already serves the same series via
`/api/brand/icon`). The cyan bolt (`icons/2.png`) is NOT the brand — do
not use it. The launcher icon is now the white bolt: a 432×432 adaptive
foreground (the 512 source scaled to 288 and centred in the safe zone),
legacy mipmaps 48/72/96/144/192 + round, and the adaptive background is
`#370278` (was `#1F57A8`). The old shield is gone from the Android app
entirely — it still lives in the extension (`nextgen-extension/public/
icon128.png`) and the extension was NOT re-branded here.

## 1.0.15 — TeraBox login in an in-app WebView (the viable persistent login)

A pasted cookie is not durable: TeraBox rotates/expires it and the user
has to re-paste by hand. Settings now has a "Log in to TeraBox" button that
opens `TeraBoxLoginScreen` — a real WebView on https://www.terabox.com/.
The user signs in once; the WebView's CookieManager persists the session,
and on every page finish the screen pulls the fresh cookie + `window.jsToken`
out of the WebView and stores them (cookie → Settings, token → secure
store, with a capture timestamp). `TeraBoxClient.jsToken()` prefers the
stored WebView token; the plain-HTTP scrape is only the fallback.

Why the WebView was needed at all: a plain HTTP GET from the phone's
network returns the 8 KB logged-out landing page with NO jsToken in it,
even with the cookie attached — the VM's datacenter IP gets the full page,
the phone's carrier IP does not. A WebView sends a real browser's headers
and runs the page's JS, so `window.jsToken` is actually there. The
TeraBox app's own session (`com.dubox.drive`) cannot be reused: no root,
so its private data is unreadable, and its 260 MB APK was pulled only to
confirm that — no extractable token without root.

## 1.0.14 — the TeraBox client runs on Dispatchers.IO

1.0.13 shipped the client but every call failed with "terabox homepage
fetch failed: null" — the gallery tile calls it from the main thread and a
blocking OkHttp `execute()` there throws NetworkOnMainThreadException, whose
message IS null. The phone reaches terabox.com fine (ping + curl 200), so
it was never a network problem. `jsToken()` and `apiGet()` now run inside
`withContext(Dispatchers.IO)`. Lesson: any blocking call reached from a
composable's LaunchedEffect must be IO-dispatched — LaunchedEffect is Main.

## 1.0.13 — the app resolves fresh TeraBox links itself (no extension)

1.0.12 proved the fallback triggers but cannot help old TeraBox videos:
both the thumbnail and the video dlink are stale (8h expiry) and the app
had no way to mint a fresh one. Now it does — `core/terabox/
TeraBoxClient.kt`, entirely in-app: it fetches `window.jsToken` with a
plain GET of https://www.terabox.com/ (a native client sends no browser
Sec-Fetch headers, so it gets the real page, not /simple-verify — verified
by curl 2026-11-28), then calls /api/list (fresh `thumbs.url3`) and
/api/filemetas (fresh dlink, dlna mode) with the user's TeraBox cookie from
Settings. The root listing is cached 60s so a gallery of TeraBox videos
shares one call; the jsToken is cached 12h. The gallery tile mints a fresh
thumbnail when the stored one fails, and a fresh dlink when the frame
decoder needs one. Requires the TeraBox cookie in Settings (ndus= session)
— without it the client logs a warning and the tile falls back as before.
This is what makes the app independent of the extension for TeraBox media.

## 1.0.12 — a dead thumbnail URL falls back to a video frame

Phone test 2026-11-28: every gallery video tile was a placeholder, no
frame, while image thumbnails loaded fine. Logcat showed `image failed`
for the TeraBox thumbnail endpoint (`dm-data.terabox.com/thumbnail/...
&ft=video`) — those dlinks expire in 8h, so the `thumbnailUrl` stored in
the DB is stale within a day. The 1.0.10 frame-decoder fallback only ran
when the item had NO thumbnail URL at all; a URL that EXISTS but fails to
load showed the placeholder and never tried the frame. Now the tile
tracks the failure (`thumbFailed`, reset per item) and, on failure, loads
the video's direct URL through `VideoFrameDecoder` — the direct URL on
filemoon/udrop does not expire, so those videos get a real frame. A
TeraBox-only video whose direct dlink is ALSO stale still shows the
placeholder: the app cannot mint a fresh TeraBox dlink (that needs the
extension's hidden-tab jsToken scrape, which cannot run here — see
`web/src/lib/vaultBlobSource.js`). That is a data limit, not a code bug.

## No secrets in this repo

Not in the code, not in the resources, not in the CI logs. The app asks the
user for their own Neon URL and host keys, the same model as the extension's
Settings page.
