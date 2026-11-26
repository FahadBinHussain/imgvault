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

## The Morph progress ring is a PORT too

`ui/update/BoloWavyProgress.kt` + `ui/update/BoloWavyRingMath.kt` come from
the bolo-keyboard app (the Material 3 Expressive wavy progress ring, the
numbers from M3 1.5.0-rc01). Only the package changed; the maths is pinned
by `BoloWavyRingMathTest.kt`. It needs `androidx.graphics:graphics-shapes`
(1.1.0 — that is the version that ships `Morph`).

## No secrets in this repo

Not in the code, not in the resources, not in the CI logs. The app asks the
user for their own Neon URL and host keys, the same model as the extension's
Settings page.
