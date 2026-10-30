# plan: platform feature parity (web ⇄ extension)

date: 2026-10-03
status: **phase 3 done (shared `packages/ui` + web AND extension swaps shipped). phase 4 (web feature parity) — all 4 roadmap chunks done (trash actions, gallery bulk, scene-viewer route, collections management 2026-10-13); open follow-ups: extension trash tint fix (chunk-1 note), web cards scene-texture thumb (2.13.21 note).**

standing rule (AGENTS.md): every feature exists on BOTH platforms — if one side lacks it,
build it there; never hide/drop a field or UI to make them "match". this plan is the
roadmap for getting there without ever breaking the extension (the user fears touching it).

## ground rules for every phase

- extension is touched LAST, if at all; phases 0–2 are build-time/shared-code only for it.
- per-phase gate before moving on: both apps `pnpm install --frozen-lockfile` + `pnpm build`
  green, phase-specific smoke test passes, commit pushed, Vercel deploy READY and live-checked.
- **never test destructive actions on real items (user rule, 2026-10-12 — non-negotiable)**:
  restore / permanent delete / empty / gallery delete / bulk ops run ONLY against
  synthetic rows I insert myself via Neon HTTP (needs just `id` + `kind`; no host
  URLs, no vault blob, no `collection_id` → host cleanup + collection counts are
  no-ops). real items are READ-ONLY: open modals, view, screenshot — never click a
  final confirm on a real row, never run Empty Trash for real (confirm dialog +
  Cancel only, every time). every live test session ENDS with a count audit vs the
  pre-test baseline: `SELECT count(*) FILTER (WHERE deleted_at IS NULL), count(*)
  FILTER (WHERE deleted_at IS NOT NULL) FROM media_items` must equal the
  pre-test numbers exactly, and `WHERE id LIKE 'synthetic%'` must be 0. if any
  number mismatches, stop and report loudly before doing anything else.
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

### post-3b visual incident ✅ fixed (same day, ext 2.13.25)

the shared modal shipped on BOTH platforms with its shell unstyled — classic tailwind
content-glob trap: both apps scanned only their own `src/`, so every class used solely
inside `packages/ui` (95vw dialog, lg:w-[550px] panel, the base-300/90 animation layer)
was missing from the compiled css; the inline `<style>` block still shipped, which is why
fields/tabs looked half-styled while the layout collapsed (the user's screenshot). web had
been visually broken since 3a — the 3a/3b smokes were DOM-level and cannot see css.

- fix 1: both tailwind configs scan `../packages/ui/**/*.{js,jsx}` — forward slashes only
  (fast-glob treats `\` as escape chars, silently matching nothing).
- fix 2 (found while verifying fix 1): web's daisyui was registered UNINVOKED
  (`plugins: [require('daisyui')]` + `daisyui: { themes: 'all' }` config key) — daisyui v5
  on tailwind v3 silently drops theme colors from theme.extend in that form, so NO
  semantic utility (`bg-base-100`/`text-info`/`text-error`/`from-base-300`/...) ever
  generated web-side; web's own pages never used them so nothing visibly broke before the
  modal. switched web to the extension's invoked style `daisyui({ themes: 'all' })` —
  web css 41KB → 141KB, activating ~13 semantic utilities already written into web src
  (text-base-content in 24 files etc.) — intended per parity (extension always had them).
- alpha-on-var variants (`bg-base-300/90`, `border-base-content/15`) never generate on
  tailwind v3 (both platforms) — the modal design tolerates this (opaque gradient bg).
- verify tooling: `Select-String` gave FALSE NEGATIVES grepping minified single-line css
  (the classes were present; `(Get-Content f -Raw)` + `[regex]::Matches` found them) —
  use the raw-regex method for built css. screenshot-verify UI changes from now on.

## phase 4 — web feature parity roadmap ⏳

missing on web today, in order (each its own phase-sized chunk, same gate):

1. trash actions (restore / permanent delete / empty trash) ✅ done (2026-10-12,
   commit `6ebc7e63`) — web-side only, extension untouched. server host-delete
   clients in `web/src/lib/hostDeletes.js` (imgbb/pixvid delete-url + TeraBox/UDrop
   vault-blob cleanup), deliberately NOT extracted to `imgvault-shared`: they are
   runtime-bound (extension = chrome.cookies + uploader classes, web = server
   fetch), extraction deferred until a third consumer exists. `/api/trash` gained
   POST `{action: restore|delete|empty}` mirroring `restoreFromTrashNeon` /
   `permanentlyDeleteNeon` / `emptyTrashNeon` (incl. the survivors-stay-trashed
   loud `N of M` error + `maxDuration: 60`), `web/src/db/schema.js` gained
   `mediaItemPreviews` (parity with ext schema.ts), UI = `TrashLightbox.jsx`
   (shared `MediaDetailModal` wrapper, same pattern as GalleryLightbox; creation-date
   editor PATCHes `/api/images` — no `deletedAt` filter there, body `{id, updates}`)
   + trash-page banner / Empty Trash header button / three confirm modals / sticky
   toasts. verified live on imgvaultt.vercel.app against a synthetic Neon row:
   creation-date round-trip (db `2020-01-15 04:30+00`), restore (db `deleted_at`
   cleared + list refresh), delete-forever (row gone), empty confirm opened +
   cancelled only — never run a real empty without asking. note: CI runs on NOTHING
   for a `web/**`-only push (workflow path filter) — the web gate is local
   frozen-lockfile + `pnpm --dir web build` + the Vercel deploy itself.
2. gallery delete + bulk select + bulk download ✅ done (2026-10-12) — 5 commits:
   `6a5d45c7` shared `packages/shared/downloadTargets.js` + `web/src/lib/downloads.js`
   (proxy transport) + `/api/trash` `action:'trash'`, `6dfb519e` web gallery selection
   state / card checkboxes / selection bar / Escape / single+bulk delete confirm modals /
   bulk download / bulk vault, `81fa93c0` web trash bulk select + 2 confirm modals,
   `aa771591` extension bulk Download (navbar button + `src/utils/downloads.js`,
   manifest **2.15.0**), `963060a2` fix: `/api/trash` `action:'trash'` used `isNull`
   without importing it from `drizzle-orm` (runtime-only — build can't catch it).
   bulk ops use `Promise.allSettled` + aggregate error toast; successes leave the
   selection, failed ids stay selected for retry (no fallbacks — per-item loud failure
   for filemoon/udrop, no tab spam). live-tested end to end on prod against synthetic
   rows ONLY: select/checkboxes/ring/bar UI, Escape exits selection, bulk Download
   (image → `~/Downloads/untitled.jpg`, link → loud aggregate error, row stayed
   selected), bulk Vault (470→468, restored via flag-only PATCH), single + bulk delete
   confirms (modal screenshots verified), trash bulk Restore ("2 items restored",
   trash 3→1) + Delete Permanently ("2 items permanently deleted", trash 3→1, real
   "Downloaded Video" row never selected — content-guarded clicks). closing audit
   exact vs baseline: **live 580 / trashed 1 / synth 0**. CSS probe: all 12 new
   chunk-2 classes present in the built main CSS (literal `.Contains` on raw text).
   note: web `/api/vault` PATCH `move` is flag-only (extra_metadata + share revocation,
   no encrypt/upload) vs the extension's full-encrypt move — possible future parity
   gap, out of chunk-2 scope.
3. scene-viewer route (the extension's `scene-viewer` page as a Next.js route) ✅ done
   (2026-10-13) — 3 commits: `c2d4da93` shared `packages/scene-viewer` (pnpm package
   `imgvault-scene-viewer`, three + @sparkjsdev/spark; core `startSceneViewer({spzUrl,
   sceneId, title, fetchSpz, getConfig})` owns rendering/DOM/IndexedDB cache) + ext
   `src/scene-viewer.js` rewired to a thin host (manifest **2.15.1**), `13a75b18` web
   `/scene-viewer` route + gallery-lightbox iframe + schema, `992522c5` live-test fix
   (manifest **2.15.2** — udrop `/file/` links 302 straight to the bytes now; the old
   refresh minted 404 tokens and the share-page parse downloaded the 30MB .spz twice,
   exceeding chrome's ~5-min MV3 message channel; details in AGENTS chunk-3 learnings).
   `three`/`spark` stay in the ext package.json — `SceneViewer.jsx` still imports them.
   gates: CI frozen install (6 projects) + `pnpm check:twins` + ext build (hashed
   scene-viewer entry + decoy `dist/scene-viewer.js`) + web build (`/scene-viewer`
   route, `min(90vw,1152px)` CSS); CI run `38282741338` needed one rerun (release-attach
   flake). live: WEB passed (7 badges → iframe → "Ready — 1,920,000 splats", canvas
   1152x648, clear-cache path, Escape). EXT passed on 2.15.2 — cache miss: first open
   renders after the ~152s udrop download ("Ready — 1,920,000 splats", no error, canvas);
   cache hit: reopen "Ready" in 4s; Escape closes both times; screenshot
   `C:\tmp\chunk3_ext_ready.png` verified (scene visible, hint bar, no overlay). closing
   audit exact vs baseline: **live 580 / trashed 1 / synth 0**.
4. collections management parity ✅ done (2026-10-13) — 5 commits: `cd8450ca` shared
   `packages/shared/collectionsLogic.js` + web `/api/collections` GET/POST/PATCH/DELETE
   (deleting/updating a collection WITH `imageCount > 0` is a loud 400 — never a silent
   count lie; `{id}` body for PATCH/DELETE) + `/api/images` PATCH `collectionId` writes
   with symmetric image_count deltas, `9a67e632` web `/collections` management page
   (create/rename/delete modals, `#iv-new-collection-name`/`#iv-new-collection-description`)
   + `/gallery/[collectionId]` scoped route (back banner, "N items" chip) + AppNavbar
   FolderOpen badge listening on `imgvault:collections-changed`, `58b6ee16` extension
   SceneUploadDialog inline-create (`+ Create New Collection` option → name input →
   Create → auto-selects the new id; manifest **2.15.3**), `b0cc281d` badge live refresh
   across pages, `2499566` fix: web lightbox collection control was DEAD live — the
   `MediaDetailModal` JSX passed the overview-field renderer TWICE (last-wins in JSX), so
   chunk-4's control never rendered; now `renderCollectionControlRow(index)` is routed
   through the top of `renderMetadataField` (`key === 'collectionId'`) and the duplicate
   prop + unused `defaultOverviewFieldRenderer` export are gone. live-tested on
   imgvaultt.vercel.app end to end (post-fix deploy `dpl_56xxvVgdxXt4UYeAattoKeRqi6VB`
   READY): create (toast + badge → 2) → rename → lightbox assign (row `21. collection Id`,
   `Add to Collection` → `Change Collection`, collections api count 2) → scoped route
   (exactly 1 card) → unassign → delete, real `x` collection untouched throughout;
   extension SceneUploadDialog verified on 2.15.3 (manifest check, FAB → dialog →
   inline create → select holds `synthetic-ext-collection`, closed with NO file picked /
   NO submit). screenshots verified by reading the PNGs: `chunk4_collections_page.png`,
   `chunk4_lightbox_assign.png`, `chunk4_collection_route.png`,
   `chunk4_ext_inline_create.png`, `chunk4_ext_selected.png`. closing audit exact vs
   baseline: **live 580 / trashed 1 / synth 0**, collections table back to exactly ONE
   row `collection_1775099714335` "x" `image_count 0`. test-harness learnings in AGENTS
   chunk-4 bullets (duplicate JSX prop, web cards carry no title → search-isolation,
   no-focus-stealing runs, SPA cache-bust navigation between test runs).

follow-up found during chunk 1: the extension trash page carries ~15 load-bearing
daisyui alpha classes (`bg-warning/15`, `bg-error/20`, `bg-success/15`, `border-warning/30`,
bordered chip variants) that never generate on tailwind v3 — its banner, confirm
boxes and chips render with no visible tint, while the web trash uses palette
alphas (`bg-amber-500/10 border-amber-500/40 bg-red-500/15 bg-green-500/20 bg-sky-500/20`)
and renders correctly. true visual parity needs a small extension tint fix
(manifest patch bump + reload) — its kept-dead `border-success/40`/`border-error/40`
on confirm buttons also only light up after that pairing.

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
