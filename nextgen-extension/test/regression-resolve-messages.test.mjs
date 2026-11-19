// Regression tests mined from the ImgVault bug history (AGENTS.md).
// Area: message shapes between the gallery page and the service worker —
// the resolveImagePreview saga (2.19.17-2.19.20), the duplicate-message
// shapes (2.16.5), the single-flight auto-upload handoff (2.19.8), the
// 64MiB message cap + routing order (2.12.21 / 2.12.70), and the
// sendMessage unwrap trap (2.12.12).
//
// GalleryPage.jsx / background.js / VaultPage.jsx cannot be imported in
// plain node, so these are SOURCE-TEXT assertions: they pin the exact fix
// text the AGENTS.md entry describes. (The 2.19.19 slice trap had a second
// site — background.js sliced the source to 160 chars in the "Secret Vault
// got no bytes" error — fixed in 2.19.23 and pinned below.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const background = () => src('../src/background/background.js');
const gallery = () => src('../src/pages/GalleryPage.jsx');
const vaultPage = () => src('../src/pages/VaultPage.jsx');
const hooks = () => src('../src/hooks/useChromeExtension.js');

// ------------------------------------------------- resolveImagePreview ---

test('2.19.18 (2026-11-13): resolveImagePreview reads imageUrl/pageUrl FLAT or WRAPPED', () => {
  const bg = background();
  const branch = bg.slice(bg.indexOf("case 'resolveImagePreview':"));
  assert.ok(branch.includes('request.imageUrl ?? request.data?.imageUrl'));
  assert.ok(branch.includes('request.pageUrl ?? request.data?.pageUrl'));
});

test('2.19.20 (2026-11-13): resolveImagePreview answers { success, data: { dataUrl } }, not top-level dataUrl', () => {
  const bg = background();
  const branch = bg.slice(
    bg.indexOf("case 'resolveImagePreview':"),
    bg.indexOf("case 'createCollection':"),
  );
  assert.ok(branch.includes('.then(dataUrl => sendResponse({ success: true, data: { dataUrl } }))'));
  assert.ok(!branch.includes('sendResponse({ success: true, dataUrl })'));
});

test('2.19.20 (2026-11-13): useChromeMessage resolves response.data on success — the contract the branch must match', () => {
  const hook = hooks();
  assert.ok(hook.includes("} else if (response?.success) {\n            resolve(response.data);"));
});

test('2.19.20 (2026-11-13): the one raw caller reads response.data.dataUrl', () => {
  const page = gallery();
  assert.ok(page.includes('setUploadPreviewSrc(response.data.dataUrl);'));
});

test('2.19.19 (2026-11-13): describeSource shortens ONLY data: URLs — a signed http(s) URL is never sliced', () => {
  const page = gallery();
  const start = page.indexOf('const describeSource = (url)');
  const fn = page.slice(start, start + 300);
  assert.ok(fn.includes("url.startsWith('data:')"));
  assert.ok(fn.includes('`${url.slice(0, 60)}… (${url.length} chars)`'));
  assert.ok(fn.includes(': url);'));
});

test('2.19.19 (2026-11-13): the vault fetch failure points at downloading locally instead of implying breakage', () => {
  const page = gallery();
  assert.ok(page.includes('If that host refuses a blind fetch, download the file and upload it locally instead.'));
  assert.ok(page.includes('No local file for this item — it came from a page URL, so its bytes are fetched before encrypting:'));
});

test('2.19.17 (2026-11-13): uploadVaultedDirectly sends the WRAPPED resolveImagePreview and names the payload shape when nothing is fetchable', () => {
  const page = gallery();
  assert.ok(page.includes("resolved = await sendMessage('resolveImagePreview', {"));
  assert.ok(page.includes('imageUrl: remoteSource,'));
  assert.ok(page.includes('fetchedDataUrl = resolved?.dataUrl || \'\';'));
  assert.ok(page.includes('Could not fetch the image bytes for the Secret Vault from'));
  assert.ok(page.includes('Secret Vault has nothing to encrypt — the upload modal holds no file and no image URL.'));
  assert.ok(page.includes('payload: ${JSON.stringify(payloadShape)}'));
});

test('2.19.17 (2026-11-13): handleVaultedUpload names the source it got no bytes from', () => {
  const bg = background();
  assert.ok(bg.includes('Secret Vault got no bytes to encrypt from'));
});

test('2.19.23: handleVaultedUpload keeps the source URL whole — the worker side of the 2.19.19 slice trap', () => {
  const bg = background();
  const start = bg.indexOf('Secret Vault got no bytes to encrypt from');
  assert.ok(start > 0);
  // the error is built from describeSource, not a slice
  const fn = bg.slice(Math.max(0, start - 800), start + 200);
  assert.ok(fn.includes('const describeSource = (value)'));
  assert.ok(fn.includes("value.startsWith('data:')"));
  assert.ok(fn.includes('`${value.slice(0, 60)}… (${value.length} chars)`'));
  assert.ok(fn.includes('describeSource(source)'));
  assert.ok(!fn.includes('source.slice(0, 160)'), 'the 160-char slice must be gone from this error');
});

test('2.19.18 (2026-11-13): fetchImage rejects non-strings, sends credentials to pximg, and names the HTTP status', () => {
  const bg = background();
  assert.ok(bg.includes("throw new Error('Unsupported media source"));
  assert.ok(bg.includes("/(^|\\.)pximg\\.net$/i.test(parsed.hostname)"));
  assert.ok(bg.includes("credentials: 'include',"));
  assert.ok(bg.includes('referrer: pageUrl,'));
  assert.ok(bg.includes('Failed to fetch image: HTTP'));
});

// ---------------------------------------------------------- 2.12.12 ---

test('2.12.12 (2026-08-31): VaultPage reads res.copies directly — sendMessage already unwrapped response.data', () => {
  const page = vaultPage();
  assert.ok(page.includes('if (!res?.copies || !Array.isArray(res.copies) || res.copies.length === 0) {'));
  assert.ok(page.includes('return res.copies;'));
  assert.ok(!page.includes('res.data?.copies'));
});

// ---------------------------------------------------------- 2.16.5 ---

test('2.16.5 (2026-10-26): checkVideoDuplicate answers { success, data: duplicate, duplicate }', () => {
  const bg = background();
  assert.ok(bg.includes('sendResponse({ success: true, data: duplicate, duplicate })'));
});

test('2.16.5 (2026-10-26): createPendingUpload forwards the duplicate fields and useChromeMessage attaches them to the error', () => {
  const bg = background();
  assert.ok(bg.includes('duplicate: error.duplicate || null,'));
  const hook = hooks();
  assert.ok(hook.includes('if (response?.duplicate) {'));
  assert.ok(hook.includes('error.duplicate = response.duplicate;'));
});

test('2.16.5 (2026-10-26): fileBlob never crosses the message channel — stripped before sendMessage, serializability asserted', () => {
  const page = gallery();
  assert.ok(page.includes('delete pendingMetaVideo.fileBlob;'));
  assert.ok(page.includes('delete pendingMetaVideo.file;'));
  assert.ok(page.includes('assertSerializableUploadData(uploadData);'));
  assert.ok(page.includes("throw new Error('Upload data contains non-serializable values');"));
});

test('2.16.5 (2026-10-26): files under 100 MB get a SHA-256 for instant hash dedup; a closed port says to refresh the tab', () => {
  const page = gallery();
  assert.ok(page.includes('uploadData.fileBlob.size < 100 * 1024 * 1024'));
  assert.ok(page.includes("error?.message?.includes('message port closed')"));
  assert.ok(page.includes('Extension service worker disconnected or reloaded. Refresh this tab to reconnect.'));
});

// ---------------------------------------------------------- 2.19.8 ---

test('2.19.8 (2026-11-06): auto-upload handoff carries a unique id and the page drops duplicate handoffs', () => {
  const bg = background();
  assert.ok(bg.includes("const handoffId = activeRequestId || ('pau-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));"));
  assert.ok(bg.includes('id: handoffId,'));
  const page = gallery();
  assert.ok(page.includes('const processedAutoUploadIdsRef = useRef(new Set());'));
  assert.ok(page.includes('if (processedAutoUploadIdsRef.current.has(autoUploadKey)) {'));
  assert.ok(page.includes('const isLoadingDownloadedFileRef = useRef(false);'));
  // The pending payload is removed BEFORE navigating, atomically, so a
  // focus event cannot resurrect it into a second upload of the same file.
  assert.ok(page.includes("await chrome.storage.local.remove('pendingAutoUpload');"));
  const storage = src('../src/utils/storage.js');
  assert.ok(storage.includes(
    "if (item.extraMetadata?.pendingUpload === true || item.extraMetadata?.pendingUpload === 'true' || item.pendingUpload) continue;",
  ));
});

// ------------------------------------------------- 2.12.21 / 2.12.70 ---

test('2.12.21 (2026-09-08): uploadPreparedMedia routes >60 MiB blobs around the 64MiB message cap', () => {
  const page = gallery();
  assert.ok(page.includes('const isLargeForMessage = blobSize > 60 * 1024 * 1024 || blobSize > 64 * 1024 * 1024 * 0.9;'));
  assert.ok(page.includes('using direct page upload to avoid 64MiB message limit.'));
  const dialog = src('../src/components/SceneUploadDialog.jsx');
  assert.ok(dialog.includes('if (totalBytes > 20 * 1024 * 1024) {'));
});

test('2.12.70 (2026-09-10): routing order is vault first, then explicit 3D, then video, then the large-message fallback', () => {
  const page = gallery();
  const fn = page.slice(page.indexOf('const uploadPreparedMedia = async (uploadData) => {'));
  const vaultAt = fn.indexOf('if (uploadData.isVaulted) {');
  const threeDAt = fn.indexOf('if (uploadData.is3D) {');
  const videoAt = fn.indexOf('if ((uploadData.isVideo || uploadData.isAudio) && uploadData.fileBlob) {');
  const largeAt = fn.indexOf('const isLargeForMessage = blobSize > 60 * 1024 * 1024');
  assert.ok(vaultAt > 0 && threeDAt > vaultAt && videoAt > threeDAt && largeAt > videoAt);
  // buildUploadData.is3D no longer reads is3DMode — the toggle only filters
  // the host list, it must not reclassify a plain video as 3D.
  assert.ok(page.includes('is3D: Boolean(mediaData?.is3D || is3DUploadFile(mediaData?.file)),'));
});

// ------------------------------------------------- gap-closing pins ---

test('2.19.3 (2026-11-02): the four no-undef crashes stay fixed — linkProviderFileToItem loads its row, VaultPage restores with the reconciled keys, mp4MinFrame hoists lastTrackDur', () => {
  const storage = src('../src/utils/storage.js');
  const link = storage.slice(storage.indexOf('async linkProviderFileToItem'));
  assert.ok(link.includes('const current = await this.getImageById(id);'));
  const vault = src('../src/pages/VaultPage.jsx');
  assert.ok(vault.includes('targetHostKeys: reconciledRestoreHostKeys,'));
  assert.ok(vault.includes('const reconciledRestoreHostKeys = useMemo(() => {'));
  const mp4 = src('../src/utils/mp4MinFrame.js');
  assert.ok(mp4.includes('let lastTrackDur = 0;'));
  assert.ok(mp4.includes('lastTrackDur = trackDur;'));
});

test('2.3.0 (2026-08): linking a second file to the same item APPENDS to the per-provider links array (idempotent per filecode) instead of overwriting the first', () => {
  const storage = src('../src/utils/storage.js');
  const link = storage.slice(storage.indexOf('async linkProviderFileToItem'));
  assert.ok(link.includes('const linksKey = `${providerKey}Links`;'));
  assert.ok(link.includes('const alreadyLinked = existingLinks.some((entry) => String(entry?.filecode || \'\') === filecode);'));
  assert.ok(link.includes('extraMetadata: { ...existingExtra, [linksKey]: nextLinks },'));
  assert.ok(link.includes('if (!current.filemoonWatchUrl && link.watchUrl) updates.filemoonWatchUrl = String(link.watchUrl);'));
});

test('2.16.4/2.19.8 (2026-10/11): the duplicate finder skips the resumed row (excludeItemId) and pending rows, and matches on sha256', () => {
  const storage = src('../src/utils/storage.js');
  const fn = storage.slice(storage.indexOf('findVideoDuplicateInItems'));
  assert.ok(fn.includes("if (excludeItemId && String(item.id || '') === excludeItemId) continue;"));
  assert.ok(fn.includes('if (item.extraMetadata?.pendingUpload === true'));
  assert.ok(fn.includes("const targetSha256 = String(target.sha256 || '').trim().toLowerCase();"));
  assert.ok(fn.includes('String(item.sha256).trim().toLowerCase() === targetSha256;'));
});
