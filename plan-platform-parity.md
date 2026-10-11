# plan: platform feature parity (web ⇄ extension)

date: 2026-10-03
status: **phase 3 done (shared `packages/ui` + web AND extension swaps shipped). phase 4 (web feature parity) next — stop-and-go after 3b per plan.**

standing rule (AGENTS.md): every feature exists on BOTH platforms — if one side lacks it,
build it there; never hide/drop a field or UI to make them "match". this plan is the
roadmap for getting there without ever breaking the extension (the user fears touching it).

## ground rules for every phase

- extension is touched LAST, if at all; phases 0–2 are build-time/shared-code only for it.
- per-phase gate before moving on: both apps `pnpm install --frozen-lockfile` + `pnpm build`
  green, phase-specific smoke test passes, commit pushed, Vercel deploy READY and live-checked.
- extension dist rollback: `C:\tmp\imgvault-dist-backup-<version>` (xcopy restore);
  `tools/reload-extension.ps1` refuses a partial dist.
- never flip `shared-workspace-lockfile: false` without updating CI
  (`nextgen-extension-crx.yml` install + `cache-dependency-path`) and Vercel (project
  `imgvault`, Root Directory = `web`) in the same change.
- learnings go into AGENTS.md as they happen (workspace note, settings architecture,
  drift-guard note when phase 2 lands).

## phase 0 — pnpm workspace skeleton ✅ done (commit `b441145`)

- root `package.json` (private, scripts `build:web` / `build:extension`) +
  `pnpm-workspace.yaml` (members `web`, `nextgen-extension`, `packages/*`;
  `shared-workspace-lockfile: false`; `allowBuilds` esbuild + sharp).
- gotcha fixed: member `pnpm-workspace.yaml` files shadowed the root workspace →
  `packages/*` invisible (`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`); member files deleted,
  `allowBuilds` moved to root. pnpm 11 reads config from the workspace root only.
- verified: both apps frozen install + build pass; Vercel READY; extension 2.13.18
  loaded, gallery 461 items.

## phase 1 — settings parity ✅ done (commit `9f9b882`)

single source of truth: `packages/shared/settingsSchema.js` (pnpm package
`imgvault-shared`) — sections, fields, defaults, select options, `table:` column map.

- web `/settings` renders every field from the schema (API Keys incl. TeraBox Cookie,
  Cloud & Database incl. Neon URL, Preferences incl. **Default 3D Source** — was missing
  entirely —, Download Folder, Firebase block kept as-is).
- web `/api/config` GET = `SETTINGS_DEFAULTS` < `user_configs.app_settings` JSON <
  `public.settings` columns (columns win, symmetric with the extension upsert);
  POST writes EVERY table-backed field via `buildTableSettingsPayload` — the old
  hand-listed payload silently dropped `default_3d_source`.
- POST now also persists `user_configs.firebase_config` (was stuck at `{}`).
- `web/src/db/schema.js` gained `default_3d_source` (live column since ext 2.12.81).
- persistence split: table columns = pixvid/imgbb/filemoon/udrop1/2/default_*; non-column
  keys (teraboxCookie, neonDatabaseUrl, downloadFolder) = `app_settings` (web) +
  `chrome.storage.sync` (extension).
- verified live: all 12 fields render, selects show table truth (imgbb/terabox/terabox),
  save round-trip bumped `public.settings.updated_at` (2026-10-03 10:48:48Z), values unchanged.
- minor cleanup left: GET response can carry `id`/`updatedAt` keys from old app_settings
  JSON — harmless (form ignores unknown keys); strip on next settings pass if convenient.

## phase 2 — move the logic twins into `imgvault-shared` + drift guard ✅ done (2026-10-11)

what moved into `packages/shared/`:

- `providerCatalog.js` — host metadata (keys, labels, url/watch/direct field names,
  `apiKeyFields`, `uploaderKey`, `vaultBlobHost` flags, `isConfigured`) + pure helpers
  (`filterUploadServicesByKeys`, `getConfiguredServices`, `getVaultBlobHost*`,
  `normalizeVaultBlobHostKeys`, the `*_SOURCE_OPTIONS` builders). the extension catalog was
  the superset → canonical; web's 66-line copy was metadata-only and is now a shim.
- `imageProviderLinks.js` + `videoProviderLinks.js` — extension versions were supersets
  (11/12 exports vs web's 3/4, plus two real logic upgrades: legacy `<key>ThumbUrl`
  column fallback and the thumbnailUrl no-fallback rule) → canonical. web copies were
  older/simpler; both are now shims. note: web `VIDEO_SOURCE_OPTIONS` gains the ext sort
  (default first, then localeCompare → filemoon, TeraBox, UDrop) — parity of option order.
- `mediaDbPayload.js` / `mediaFieldRegistry.js` / `mediaItemNormalizer.js` — moved from
  repo-root `shared/` (the extension's `@shared` target); web's vendored `web/src/shared/`
  copies were byte-identical (diff exit 0) and are deleted.

architecture:

- **runtime stays app-side**: `uploaderClass` / `upload` / `uploadWithProgress` /
  `vaultDownloadUrl` are NOT in shared (they import uploaders.js / teraBoxApi.js).
  `nextgen-extension/src/config/providerCatalog.js` = thin runtime layer that imports the
  shared catalog and attaches per-host runtime (`attachRuntime` map keyed by host).
  web's `src/lib/providerCatalog.js` re-exports shared as-is.
- **the trap — runtime-bound lookups must return enriched entries**: `getImageUploadService`,
  `getVideoUploadService`, `getConfigured{Image,Video}UploadServices`, `getVaultBlobHostServices`
  feed `service.upload(...)` / `new service.uploaderClass()` / `service.uploadWithProgress` all
  over background.js, GalleryPage, ResolvePage, VaultPage, videoRetryPageSide. a pure
  `export *` shim returns metadata-only entries → every upload path crashes. so the extension
  shims (`src/utils/{image,video}ProviderLinks.js`) re-export shared AND override exactly those
  lookups from `../config/providerCatalog.js` (explicit named re-export beats `export *`).
- **zero consumer-import edits**: both `@shared` aliases now point at `packages/shared`
  (ext `vite.config.js`; web `next.config.js` + `jsconfig.json`), and every old import path
  is kept as a shim. extension gained the `imgvault-shared: workspace:*` dep (lockfile updated).

drift guard (recorded in AGENTS.md too): `tools/check-shared-twins.mjs`, run locally as
`pnpm check:twins` (repo root) and as a CI step in `nextgen-extension-crx.yml` (workflow now
also triggers on `packages/**` + the guard path). fails loudly when: `shared/` or
`web/src/shared/` reappear; a shim grows any line beyond re-exports; a twin implementation
filename (`mediaFieldRegistry.js` etc.) exists outside `packages/shared/`; or the extension
runtime layer stops importing the shared catalog / re-defines metadata markers.

verification (2026-10-11): guard OK; `vite build` green (13.9s, postbuild complete);
`next build` green (all routes); `CI=true pnpm install --frozen-lockfile` green in BOTH apps
(after clearing the `.pnpm-workspace-state-v1.json` short-circuit — the AGENTS.md trap);
extension bumped to 2.13.22, dist backed up, reloaded, gallery + settings smoke passed.
the `.pnpm-workspace-state-v1.json` gotcha bit again locally: a CI=true frozen run failed,
the rerun short-circuited "Already up to date" in 42ms — always delete both state files
(root + member `node_modules/`) before trusting a local frozen result.

## phase 3 — `packages/ui` detail-modal merge (gate-able / skippable) ✅ done

the one the user fears: extract the gallery detail modal (image/video/3D variants) into a
shared package consumed by both platforms. do it ONLY after phase 2 is proven — it is the
riskiest phase. keep the extension-side swap as its own commit so a revert is one command.
estimate 1–2 days; stop and report before touching the extension for it.

### 3a — `packages/ui` + web swap ✅ done (2026-10-11)

- new pnpm package `imgvault-ui` (`packages/ui/`): `MediaDetailModal.jsx` (canonical,
  lifted verbatim from the extension's `src/components/MediaDetailModal.jsx`) +
  `Modal.jsx`/`Spinner.jsx` (lifted from the extension `UI.jsx`, clsx inlined away).
  two additive deltas vs the extension original: `overviewNotice` slot (renders above the
  ID row; web puts saveError + shareStatus there) and the panel `h2` now shows
  `item.pageTitle || item.fileName || 'Details'` (web used to show the title mobile-only).
- web `GalleryLightbox.jsx` is now a wrapper with the SAME public props (gallery/vault/
  share-token consumers untouched): all logic (swipe, keyboard nav, scroll lock, edit
  state, video source resolution, field renderers) stays web-side; the return renders the
  shared modal with slots — renderMedia = the swipe track, actions = the button row
  (moved from bottom bar to beside the tabs, ext placement), renderDocumentId = the
  firestore card, renderOverviewField/TechnicalField = web's labeled renderer.
- visible web changes: full-screen takeover → 95vw/95vh centered dialog (ext look), tabs
  "For Noobs/For Nerds" → "Overview/Technical" (canonical labels), mobile bottom-sheet
  drag handle gone (shell stacks panel under media), chevrons now also on mobile.
- web config: `imgvault-ui: workspace:*` dep + `transpilePackages: ['imgvault-ui']` in
  next.config.js (JSX inside a workspace package needs it).
- **workspace-package dep trap (CI bit here)**: a `packages/*` project that imports ANY
  npm package (ui imports `lucide-react`) needs that dep in its own `package.json` AND its
  own committed `pnpm-lock.yaml` — `sharedWorkspaceLockfile: false` means per-project
  lockfiles, and CI's root `pnpm install --frozen-lockfile` ("Scope: all N workspace
  projects") fails `ERR_PNPM_NO_LOCKFILE` for a dep-ful project without one (phase 2 never
  hit it: `packages/shared` is dep-less). `peerDependencies` are NOT a workaround: pnpm
  still wants a lockfile for them, and once they're gone the package's `node_modules` is
  empty so the bundler cannot resolve bare imports from the package's realpath (Next only
  aliases `react`; `lucide-react` from `packages/ui/` fails the build loudly). only
  dep-less packages get to skip the lockfile. `.gitignore` now ignores ONLY
  `packages/shared/pnpm-lock.yaml` (stray, dep-less) — a dep-ful package's lockfile is
  committed.
- verified: frozen install (state files deleted first), `next build` green all routes,
  drift guard OK untouched, live smoke on imgvaultt.vercel.app.

### 3b — extension swap ✅ done (2026-10-11, ext 2.13.24, own commit)

shipped exactly as planned: extension gained `imgvault-ui: workspace:*` (+ its lockfile via
`pnpm --dir nextgen-extension install --lockfile-only`); `src/components/MediaDetailModal.jsx`
is now a one-line shim `export { MediaDetailModal as default } from 'imgvault-ui';` (NOT
`export { default }` — the package's index exports it as a NAMED export, so the shim maps
named→default to keep the three pages' default imports working); `UI.jsx` dropped its own
Spinner + Modal definitions (and the now-unused `X` lucide import) for
`export { Modal, Spinner } from 'imgvault-ui';` — every `./UI` consumer path unchanged
(Modal: 7 importers, Spinner: 5). drift guard extended in the same commit: 3 new
TWIN_BASENAMES (`MediaDetailModal.jsx`/`Modal.jsx`/`Spinner.jsx`), skip generalized
`packages/shared/` → `packages/`, shim allowlist entry for the extension MediaDetailModal.
- **vite compiles workspace-package JSX with ZERO config** (proven here, was assumption):
  symlinked workspace deps resolve to their realpath inside the repo, so vite's esbuild
  transform covers them — no optimizeDeps/alias needed (contrast Next, which needs
  `transpilePackages`). `pnpm build` green first run, 6.8s.
- CI-mirror frozen install green (5 workspace projects, ext lockfile consistent) after
  deleting BOTH `.pnpm-workspace-state-v1.json` files (root + native-host stray).
- smoke on loaded 2.13.24 (CDP, user's Edge): gallery modal opens from grid (h2 + tabs
  Overview 21 / Technical 6, technical field list renders, Next-item nav changes the h2,
  ✕ closes), trash modal (Overview 22 / Technical 3, Restore + Delete Forever actions),
  collections New Collection dialog (non-media Modal consumer: title/2 inputs/
  Create+Cancel) — all through the shared package. dist backup at
  `C:\tmp\imgvault-dist-backup-2.13.23` (44 files) predates the rebuild.
- gotchas hit in smoke only (not the app): `browser-use` stdin via pwsh pipe fails
  silently (exit 1) — use `cmd /c "browser-use < script.py"`; `ensure_real_tab()` bounces
  the attach off chrome-extension:// tabs back to the visible tab — for extension pages
  use `switch_tab(id)` alone; non-ASCII literals (✕) mangle through the console codepage —
  match via `\u2715` escapes in JS instead.

## phase 4 — web feature parity roadmap ⏳

missing on web today, in order (each its own phase-sized chunk, same gate):

1. trash actions (restore / permanent delete / empty trash — extension logic is in
   `storage.js` + SW handlers, incl. the vault-blob host delete path)
2. gallery delete + bulk select + bulk download
3. scene-viewer route (the extension's `scene-viewer` page as a Next.js route)
4. collections management parity

every chunk: shared logic first (`imgvault-shared`), web UI second, extension untouched
unless it is actually missing something.

## resume notes

- push: token via `Read-VaultSecret` (github.com* pattern), then
  `git push "https://x-access-token:$tok@github.com/FahadBinHussain/imgvault.git" main`.
- Vercel: token via `Read-VaultSecret` (vercel.com*), project `prj_I3IzduxJsbQCrIbfF7XBZq2qLC83`
  in team `team_Mei5kaLVoB1zzUAgNmbxDq2R`; deployments list = `/v6/deployments?projectId=...&target=production`.
- psql 5432 is flaky from here — use the Neon HTTP fallback (port 443, `--resolve` to a
  working IP, `Neon-Connection-String` header, single statement per request).
- settings fields live in `packages/shared/settingsSchema.js`; never hand-edit the field
  lists in `web/src/app/settings/page.jsx` (they are rendered from the schema).
