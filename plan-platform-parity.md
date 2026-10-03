# plan: platform feature parity (web ⇄ extension)

date: 2026-10-03
status: **phase 0 + 1 done (pushed). phase 2 next. stop-and-go between phases.**

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

## phase 2 — move the logic twins into `imgvault-shared` + drift guard ⏳ next

targets (the hand-copied twins that exist today):

- `web/src/lib/image-provider-links.js` ⇄ `nextgen-extension/src/utils/imageProviderLinks.js`
- `web/src/lib/video-provider-links.js` ⇄ `nextgen-extension/src/utils/videoProviderLinks.js`
- provider catalog (host lists / upload services metadata) currently inlined in both apps
- `web/src/shared/{mediaDbPayload,mediaFieldRegistry,mediaItemNormalizer}.js` (vendored
  copies) ⇄ their extension `src/utils/` counterparts

steps:

1. move the real implementations into `packages/shared/` (keep unscoped `imgvault-*`
   naming — symmetry with `imgvault-web` / `imgvault-nextgen`).
2. both apps import from `imgvault-shared`; delete the vendored copies (web's
   `src/shared/`, web's `src/lib/*-provider-links.js` re-exports only if a thin adapter
   keeps imports short).
3. drift guard: a check (script, run in CI + locally via root `pnpm` script) that fails
   loudly if a twin file reappears outside `packages/shared` — or if imports point at the
   deleted paths. record the chosen mechanism in AGENTS.md.
4. gate: frozen install + build both apps, extension smoke (gallery 461 items, kind
   classification), web gallery + resolve pages load, push, Vercel READY, live check.

## phase 3 — `packages/ui` detail-modal merge (gate-able / skippable) ⏳

the one the user fears: extract the gallery detail modal (image/video/3D variants) into a
shared package consumed by both platforms. do it ONLY after phase 2 is proven — it is the
riskiest phase. keep the extension-side swap as its own commit so a revert is one command.
estimate 1–2 days; stop and report before touching the extension for it.

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
