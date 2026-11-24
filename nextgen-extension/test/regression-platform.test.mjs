// Regression tests mined from the ImgVault bug history (AGENTS.md).
// Area: platform — manifest/build/CI/pnpm, the service-worker
// lifecycle, the gallery shell (navbar, timeline, modal nav), host
// selection + dedup wiring, and the extension/web parity contracts.
//
// All source-text assertions: these seams live in React/worker files,
// manifests, and configs that cannot be imported in plain node.
// (The task forbids MODIFYING package.json, run-tests.mjs, workflows,
// AGENTS.md, web/, or native-host/ — reading them for assertions is
// the sanctioned pattern.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const exists = (rel) => existsSync(fileURLToPath(new URL(rel, import.meta.url)));

const background = () => src('../src/background/background.js');
const gallery = () => src('../src/pages/GalleryPage.jsx');

// ------------------------------------------------- manifest / build ---

test('2.19.40 (2026-11-24): the manifest is at 2.19.40, carries unlimitedStorage, and lists scene-viewer.js concretely', () => {
  const manifest = JSON.parse(src('../public/manifest.json'));
  assert.equal(manifest.version, '2.19.40');
  assert.ok(manifest.permissions.includes('unlimitedStorage'));
  const resources = manifest.web_accessible_resources.flatMap((entry) => entry.resources);
  assert.ok(resources.includes('scene-viewer.js'));
  assert.ok(resources.includes('scene-viewer.html'));
  assert.ok(!exists('../manifest.json'), 'no stray root manifest (2.1.7)');
});

test('2.12.73 (2026-09-12): postbuild copies src/scene-viewer.js into dist (the hashed bundle name would not match the manifest entry)', () => {
  const postbuild = src('../postbuild.ps1');
  assert.ok(postbuild.includes('Copy-Item -Path "src/scene-viewer.js" -Destination "dist/scene-viewer.js" -Force'));
});

test('CI race (2026-09-19): exactly ONE release job, ONE gh-release call, and it fails on unmatched files', () => {
  const workflow = src('../../.github/workflows/nextgen-extension-crx.yml');
  assert.equal((workflow.match(/^  publish-release:/gm) || []).length, 1);
  assert.equal((workflow.match(/softprops\/action-gh-release@v2/g) || []).length, 1);
  assert.ok(workflow.includes('fail_on_unmatched_files: true'));
  assert.ok(workflow.includes("require('./public/manifest.json').version"));
});

test('pnpm workspace (2026-10-30): per-member lockfiles, root-only build approvals, no member workspace files', () => {
  const workspace = src('../../pnpm-workspace.yaml');
  assert.ok(workspace.includes('sharedWorkspaceLockfile: false'));
  assert.ok(workspace.includes('- web\n  - nextgen-extension\n  - packages/*'));
  assert.ok(workspace.includes('allowBuilds:'));
  assert.ok(workspace.includes('esbuild'));
  assert.ok(!exists('../../web/pnpm-workspace.yaml'));
  assert.ok(!exists('../pnpm-workspace.yaml'));
  assert.ok(!exists('../../packages/shared/pnpm-workspace.yaml'));
});

test('2.17.1 (2026-10-30): both tailwind configs map daisyui v5 colors through the oklch helper and scan packages/ui with forward slashes', () => {
  const ext = src('../tailwind.config.js');
  const web = src('../../web/tailwind.config.js');
  for (const config of [ext, web]) {
    assert.ok(config.includes('oklch(from var(--color-${token}) l c h / <alpha-value>)'));
    assert.ok(config.includes("split('\\\\').join('/')") || config.includes("split(path.sep).join('/')"));
  }
  assert.ok(ext.includes('plugins: [daisyui({ themes: DAISYUI_THEMES })]'));
  assert.ok(web.includes("plugins: [require('daisyui')({ themes: 'all' })]"));
});

test('2.13.21 (2026-10-05): the standalone entries redirect to index.html#/... instead of mounting pages without a router', () => {
  for (const entry of ['gallery', 'settings', 'trash']) {
    const file = src(`../src/${entry}.jsx`);
    assert.ok(file.includes("window.location.replace(`index.html${window.location.search || ''}${hash}`);"));
  }
});

test('reload-extension.ps1 (2026-10-26): a failed build NEVER reloads — a partial dist corrupts the extension', () => {
  const script = src('../../tools/reload-extension.ps1');
  assert.ok(script.includes('$buildExit = $LASTEXITCODE'));
  assert.ok(script.includes('if ($buildExit -ne 0) {'));
  assert.ok(script.includes('pnpm build FAILED (exit $buildExit) - NOT reloading the extension.'));
  assert.ok(script.includes('exit $buildExit'));
});

// ------------------------------------------------- worker lifecycle ---

test('2.16.3 (2026-10-26): useCallback is imported in GalleryPage, PopupPage, and VaultPage (blank-page ReferenceError)', () => {
  assert.ok(gallery().includes("import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';"));
  assert.ok(src('../src/pages/PopupPage.jsx').includes("import React, { useState, useEffect, useMemo, useCallback } from 'react';"));
  assert.ok(src('../src/pages/VaultPage.jsx').includes("import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';"));
});

test('2.16.7 (2026-10-26): the keepalive reload loop stays reverted — no keepalive in index.jsx', () => {
  assert.equal((src('../src/index.jsx').match(/keepalive/g) || []).length, 0);
});

test('2.16.6 (2026-10-26): onInstalled refreshes open extension tabs (except reload.html) so they reconnect to the fresh worker', () => {
  const bg = background();
  const fn = bg.slice(bg.indexOf('chrome.runtime.onInstalled.addListener'));
  assert.ok(fn.includes("if (tab.url && tab.url.startsWith(extPrefix) && !tab.url.includes('reload.html')) {"));
  assert.ok(fn.includes('chrome.tabs.reload(tab.id)'));
});

test('2.16.8 (2026-10-26): skipWaiting + clients.claim activate the new worker immediately; selfReload answers before reloading', () => {
  const bg = background();
  assert.ok(bg.includes('self.skipWaiting();'));
  assert.ok(bg.includes('event.waitUntil(self.clients.claim());'));
  const reload = bg.slice(bg.indexOf("if (request && request.type === 'selfReload')"));
  assert.ok(reload.indexOf('sendResponse({ ok: true });') < reload.indexOf('chrome.runtime.reload();'));
});

// ------------------------------------------------- gallery shell ---

test('2.19.10 (2026-11-06): the undefined log setter is gone — upload logs clear through chrome.storage.local', () => {
  const page = gallery();
  assert.equal((page.match(/setClientUploadLogs/g) || []).length, 0);
  assert.equal((page.match(/uploadStatusLogs: \[\]/g) || []).length, 8);
});

test('2.19.9 (2026-11-06): a notification click clears, opens the gallery, resumes auto-upload — and focuses the OS window on BOTH paths', () => {
  const bg = background();
  const handler = bg.slice(bg.indexOf('chrome.notifications.onClicked.addListener'));
  assert.ok(handler.includes('await chrome.notifications.clear(notificationId)'));
  assert.ok(handler.includes("await serviceWorker.openOrFocusApp('/gallery');"));
  assert.ok(handler.includes('await serviceWorker.resumePendingAutoUploadOnFocus();'));
  const focus = bg.slice(bg.indexOf('async openOrFocusApp('));
  assert.ok(focus.includes('await chrome.windows.update(existingTab.windowId, { focused: true });'));
  assert.ok(focus.includes('await chrome.windows.update(tab.windowId, { focused: true });'));
});

test('2.13.6/7/9 (2026-09-18): the YouTube picker takes the largest DECODED video, falls back to captureVisibleTab, and the diagnostic marker is gone', () => {
  const bg = background();
  assert.ok(bg.includes(".filter((v) => v && v.readyState >= 2 && v.videoWidth && v.videoHeight)"));
  assert.ok(bg.includes(".sort((a, b) => (b.videoWidth * b.videoHeight) - (a.videoWidth * a.videoHeight));"));
  assert.ok(bg.includes('chrome.tabs.captureVisibleTab(tab.windowId, { format: \'png\' })'));
  assert.ok(bg.includes("console.log('[ImgVault][ContextMenu] Click received'"));
  assert.equal((bg.match(/Capture started/g) || []).length, 0);
});

test('2.13.10 (2026-09-22): modal navigation runs on filteredImages with explicit canGoPrevious/canGoNext — never on media load state', () => {
  const page = gallery();
  assert.ok(page.includes('const canGoPrevious = modalImageIndex > 0;'));
  assert.ok(page.includes('const canGoNext = modalImageIndex >= 0 && modalImageIndex < filteredImages.length - 1;'));
  assert.ok(page.includes('canGoPrevious={canGoPrevious}'));
  assert.ok(page.includes('canGoNext={canGoNext}'));
  const modal = src('../../packages/ui/MediaDetailModal.jsx');
  assert.ok(modal.includes('canGoPrevious = false,'));
  assert.ok(modal.includes('disabled={!canGoPrevious}'));
});

test('2.10.6 (2026-08-16): filemoon /e/ URLs play in an iframe in the modal, never as <video src>', () => {
  const page = gallery();
  const fn = page.slice(page.indexOf('const getModalVideoSource'));
  assert.ok(fn.includes("return { type: 'iframe', src: directUrl, sourceKey: defaultVideoSource"));
  assert.ok(fn.includes("return { type: 'iframe', src: directUrl || watchUrl, sourceKey: defaultVideoSource"));
});

test('2.14.0 (2026-10-11): the navbar goes single-row at 1700px; the timeline rail reads document.scrollingElement with pin-aware progress', () => {
  const navbar = src('../src/components/GalleryNavbar.jsx');
  assert.ok(navbar.includes('@media(min-width:1700px){'));
  assert.ok(navbar.includes('.iv-actions{order:3;margin-left:auto}'));
  const rail = src('../src/components/TimelineScrollbar.jsx');
  assert.ok(rail.includes('const readProgress = (shouldPin) => {'));
  assert.ok(rail.includes('const doc = document.scrollingElement;'));
  assert.ok(rail.includes('const onScroll = () => readProgress(true);'));
  assert.ok(rail.includes('readProgress(false); // Initial call — never pins'));
});

// ------------------------------------------------- STRICT (current) ---

// NOTE (2.19.23): the 2.11.x STRICT entry says "never use the chain-based
// getPreferred* for UI", but all three pages use getPreferredImageProviderLink
// for IMAGE display. The VIDEO side complies (playable-first since 2.19.16),
// and the IMAGE side now has the same shape: getPlayableImageProviderLink
// (preferred first, named fallback) drives both modals, and
// getPreferredImageProviderLink delegates to it for card thumbnails.
// STRICT still governs vault move + download targets, so those are what
// is pinned here.
test('2.11.x STRICT (current contract): vault move resolves STRICTLY from the selected host; video UI never uses the chain helper', () => {
  const bg = background();
  assert.ok(bg.includes("? (getStrictVideoProviderLink(current, sourceHost, 'directUrl') || getStrictVideoProviderLink(current, sourceHost, 'watchUrl'))"));
  assert.ok(bg.includes(": getStrictImageProviderLink(current, sourceHost, 'url');"));
  for (const page of ['GalleryPage', 'VaultPage', 'ResolvePage']) {
    assert.ok(!src(`../src/pages/${page}.jsx`).includes('getPreferredVideoProviderLink'));
  }
});

test('2.19.23: image display is playable-first — web pages and both modals resolve from the host that has the file and name it', () => {
  const web = (rel) => src(`../../web/src/${rel}`);
  // web display pages no longer use STRICT (a pixvid-only image was
  // invisible when imgbb was preferred)
  for (const rel of ['app/gallery/page.jsx', 'app/collections/page.jsx', 'app/components/GalleryLightbox.jsx']) {
    const file = web(rel);
    assert.ok(file.includes('getPlayableImageProviderLink'), `${rel} must use the playable helper`);
    assert.ok(!file.includes('getStrictImageProviderLink'), `${rel} must not use STRICT for display`);
  }
  // both modals name the serving host when it is not the preferred one
  const lightbox = web('app/components/GalleryLightbox.jsx');
  assert.ok(lightbox.includes('Showing from {playableImage.sourceLabel}'));
  const page = gallery();
  assert.ok(page.includes('const playableImage = getPlayableImageProviderLink(modalImage, defaultGallerySource'));
  assert.ok(page.includes('Showing from {playableImage.sourceLabel}'));
  // STRICT still governs download targets (shared) and vault move
  const targets = src('../../packages/shared/downloadTargets.js');
  assert.ok(targets.includes('getStrictImageProviderLink(item, imageSource, \'url\')'));
});

// ------------------------------------------------- host / dedup wiring ---

test('2.16.2 (2026-10-26): host selection persists PER KIND with a legacy fallback, and useChromeStorage resolves functional updates', () => {
  const page = gallery();
  assert.ok(page.includes("useChromeStorage('selectedUploadHostKeysByKind', {}, 'local')"));
  assert.ok(page.includes('const fromKind = selectedUploadHostKeysByKind?.[currentUploadKind];'));
  const hooks = src('../src/hooks/useChromeExtension.js');
  assert.ok(hooks.includes("const resolved = typeof newValue === 'function' ? newValue(prev) : newValue;"));
});

test('2.16.4 (2026-10-26): direct video upload checks duplicates before reserving (the check used to be dead code on the XHR path)', () => {
  const page = gallery();
  assert.ok(page.includes("const dupResponse = await sendMessage('checkVideoDuplicate', {"));
});

test('2.16.10 (2026-10-30): the upload modal re-arms the SW key from the page copy before asking getVaultStatus', () => {
  const page = gallery();
  const gate = page.slice(page.indexOf('if (uploadToVault) {', page.indexOf('handleUploadSubmit')));
  assert.ok(gate.includes('const pageMasterKey = getVaultMasterKey();'));
  assert.ok(gate.includes("await sendMessage('vaultSetMasterKey', { keyB64 });"));
  assert.ok(gate.includes("const status = await sendMessage('getVaultStatus');"));
  assert.ok(gate.includes('if (status?.configured && !status?.unlocked) {'));
});

test('2.17.0 (2026-10-30): dropping files on /vault opens the gallery modal with "Upload to Secret Vault" already on', () => {
  const vault = src('../src/pages/VaultPage.jsx');
  assert.ok(vault.includes("window.addEventListener('dragenter', handleDragEnter);"));
  assert.ok(vault.includes("window.addEventListener('dragover', handleDragOver);"));
  assert.ok(vault.includes('with "Upload to Secret Vault" already on'));
});

test('2.15.12 (2026-10-15): the telegram integrity subtab has the sibling tabs\' noUrl gap bucket + bulk resolve', () => {
  const page = src('../src/pages/ResolvePage.jsx');
  assert.ok(page.includes('const [telegramIntegrity, setTelegramIntegrity] = useState({ found: [], missing: [], noUrl: [], extra: [] });'));
  assert.ok(page.includes('`Resolve all to Telegram (${telegramFixTargetCount})`'));
});

test('2.13.20 (2026-10-04): video thumbnail healing is session-only — React state, never a DB mirror write', () => {
  const page = gallery();
  assert.ok(page.includes('const [filemoonThumbs, setFilemoonThumbs] = useState({});'));
  assert.ok(page.includes("const res = await sendMessage('getVideoThumbnail', { providerKey: defaultVideoSource, filecode });"));
  assert.ok(page.includes('setFilemoonThumbs((prev) => ({ ...prev, [img.id]: thumbUrl }));'));
});

test('2.8.0 (2026-08-26): vault upload progress logs are gated on BYTES (~20 MB), never on percent', () => {
  // 2.19.36: the gate moved out of GalleryPage into utils/uploadProgress.js
  // (same semantics — 20 MB step, 100% always logs — plus a per-phase
  // watermark reset). The live behavior is covered by the 2.19.36 tracker
  // tests; this pins the wiring + the constant's home.
  const progress = src('../src/utils/uploadProgress.js');
  assert.ok(progress.includes('export const UPLOAD_LOG_STEP_BYTES = 20 * 1024 * 1024;'));
  assert.ok(progress.includes('if (percent === 100 || loaded - loggedBytes >= stepBytes) {'));
  const page = gallery();
  assert.ok(page.includes('vaultProgressTracker.shouldLog({ loaded, percent, phase })'));
});

test('Ctrl+S (2.16.x): the save shortcut submits through uploadSubmitRef, never a bare handleSave', () => {
  const page = gallery();
  assert.ok(page.includes('const uploadSubmitRef = useRef(null);'));
  assert.ok(page.includes('uploadSubmitRef.current = handleUploadSubmit;'));
  assert.ok(page.includes('uploadSubmitRef.current?.();'));
});

// ------------------------------------------------- settings / parity ---

test('2.12.81 (2026-09-14): the cloud-sync gate counts the preference sources, and default_3d_source is a real column', () => {
  const settings = src('../src/pages/SettingsPage.jsx');
  assert.ok(settings.includes('f.gallerySrc || f.videoSrc || f.threeDSrc'));
  const schema = src('../src/db/schema.ts');
  assert.ok(schema.includes("default3DSource: text('default_3d_source').notNull().default('udrop'),"));
});

test('parity roadmap (2026-10-03/30): one plan.md at root, the four originals kept verbatim in plans/archive/', () => {
  assert.ok(exists('../../plan.md'));
  for (const doc of ['plan-platform-parity.md', 'plan-telegram-host.md', 'plan-terabox-vault.md']) {
    assert.ok(exists(`../../plans/archive/${doc}`));
  }
});

test('parity phase 3 (2026-10-11): packages/ui exports exactly Modal, Spinner, MediaDetailModal — no renderer re-export to drift', () => {
  const index = src('../../packages/ui/index.js');
  assert.ok(index.includes("export { Modal } from './Modal';"));
  assert.ok(index.includes("export { Spinner } from './Spinner';"));
  assert.ok(index.includes("export { default as MediaDetailModal } from './MediaDetailModal';"));
  assert.ok(!index.includes('defaultOverviewFieldRenderer'));
  const modal = src('../../packages/ui/MediaDetailModal.jsx');
  assert.ok(modal.includes('const overviewFieldRenderer = renderOverviewField || defaultOverviewFieldRenderer;'));
});

test('web parity: gallery cards keep a 16:9 frame, /api/vault refuses flag-only moves, /api/config writes the table payload', () => {
  const galleryPage = src('../../web/src/app/gallery/page.jsx');
  assert.equal((galleryPage.match(/aspect-video/g) || []).length, 3);
  assert.ok(galleryPage.includes('` · ${counts.audio} songs`'));
  const vaultRoute = src('../../web/src/app/api/vault/route.js');
  assert.ok(vaultRoute.includes("error: 'Web moves must encrypt — use POST /api/vault/move with the encrypted blob'"));
  assert.ok(vaultRoute.includes("error: 'Vault item id and action=restore are required'"));
  const configRoute = src('../../web/src/app/api/config/route.js');
  assert.ok(configRoute.includes('buildTableSettingsPayload'));
  assert.ok(configRoute.includes('...buildTableSettingsPayload(settings),'));
});

// ------------------------------------------------- gap-closing pins ---

test('2.17.3 (2026-10-30): the web vault blob route labels fallbacks in headers — host, primary, copy index, and a 400-char-capped failure list', () => {
  const route = src('../../web/src/app/api/vault/blob/route.js');
  assert.ok(route.includes("'X-Vault-Blob-Host': headerText(host),"));
  assert.ok(route.includes("'X-Vault-Blob-Primary': headerText(primaryHost),"));
  assert.ok(route.includes("'X-Vault-Blob-Copy': String(copyIndex),"));
  assert.ok(route.includes("headers['X-Vault-Blob-Fallback'] = '1'"));
  assert.ok(route.includes("headers['X-Vault-Blob-Failed'] = headerText(failures.join('; '), 400)"));
});

test('2.18.0 (2026-10-30): every telegram failure string goes through redactTelegramToken before it can reach a header or body', () => {
  const api = src('../../web/src/lib/telegramServerApi.js');
  assert.ok(api.includes('export function redactTelegramToken(text, token) {'));
  assert.ok(api.includes('redactTelegramToken(err.message || err, token)'));
});

test('parity phase 3 (2026-10-11): Next transpiles the shared UI package (JSX in a workspace package needs transpilePackages)', () => {
  const config = src('../../web/next.config.js');
  assert.ok(config.includes("transpilePackages: ['imgvault-ui', 'imgvault-scene-viewer'],"));
});
