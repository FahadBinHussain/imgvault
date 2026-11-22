// Regression tests mined from the ImgVault bug history (AGENTS.md).
// Area: the Secret Vault — master-key survival (2.18.x), the stream
// path (2.12.x chunk-granule cache, dlink refresh, terabox speed trap),
// vault delete/restore (2.13.3, 2.12.77/82), and the web move cap.
//
// The pure crypto seams (vaultCrypto round trips, chunk layout math,
// preview bytes) are covered live by the sibling unit tests, so this
// file pins the SERVICE-WORKER wiring, which cannot be imported in
// plain node: source-text assertions on background.js / storage.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const background = () => src('../src/background/background.js');
const storage = () => src('../src/utils/storage.js');

// ------------------------------------------------- master-key survival ---

test('2.18.3 (2026-10-31): setVaultMasterKey mirrors the key to chrome.storage.session so an MV3 nap does not lock the vault', () => {
  const bg = background();
  const fn = bg.slice(bg.indexOf('async setVaultMasterKey(keyB64) {'));
  assert.ok(fn.includes('await chrome.storage.session.set({ [VAULT_MASTER_KEY_SESSION_SLOT]: keyB64 });'));
  // importVaultMasterKey is the heal path: it must NOT reset the fallback
  // notification dedupe, or a napping worker re-reports every fallback.
  const importFn = bg.slice(bg.indexOf('async importVaultMasterKey(keyB64) {'));
  const importBody = importFn.slice(0, importFn.indexOf('\n  async ', 10));
  assert.ok(!importBody.includes('_vaultReadNotified = new Set()'));
});

test('2.18.3 (2026-10-31): getVaultStatus heals first; clearVaultMasterKey clears memory + session + the plaintext cache', () => {
  const bg = background();
  const statusFn = bg.slice(bg.indexOf('async getVaultStatus() {'));
  assert.ok(statusFn.indexOf('await this.ensureVaultMasterKey();') < statusFn.indexOf('getVaultConfig'));
  const clearFn = bg.slice(bg.indexOf('async clearVaultMasterKey() {'));
  assert.ok(clearFn.includes('this.vaultMasterKey = null;'));
  assert.ok(clearFn.includes('await chrome.storage.session.remove(VAULT_MASTER_KEY_SESSION_SLOT)'));
  assert.ok(clearFn.includes('this.clearPlaintextCache();'));
});

test('2.12.2 (2026-08-24): every vault gate heals the master key before touching encrypted bytes', () => {
  const bg = background();
  const gates = [
    'async encryptAndUploadVaultedBlob(',
    'async decryptVaultBlob(',
    'async fetchVaultPlaintextRange(',
    'async probeVaultBlobFormat(',
    'async handleVaultStreamRequest(',
    'async moveItemToVault(',
    'async restoreFromVault(',
    'async handleVaultedUpload(',
  ];
  for (const gate of gates) {
    const start = bg.indexOf(gate);
    assert.ok(start > 0, `${gate} not found`);
    // The next method definition bounds the gate's body.
    const nextMethod = bg.indexOf('\n  async ', start + gate.length);
    const body = bg.slice(start, nextMethod > 0 ? nextMethod : start + 8000);
    assert.ok(body.includes('await this.ensureVaultMasterKey();'), `${gate} must call ensureVaultMasterKey`);
  }
});

test('2.12.2 (2026-08-24): restoreFromVault refuses an encrypted item while the vault is locked', () => {
  const bg = background();
  assert.ok(bg.includes("throw new Error('Vault is locked. Unlock the vault before restoring this encrypted item.');"));
});

// --------------------------------------------------------- streaming ---

test('2.12.12 (2026-08-31): the stream handler falls back to the DB item ONLY when no copies arrived on the URL', () => {
  const bg = background();
  const fn = bg.slice(bg.indexOf('async handleVaultStreamRequest(request, itemId) {'));
  const fallbackAt = fn.indexOf('if (copies.length === 0) {');
  const dbAt = fn.indexOf('const item = await this.storage.getImageById(itemId);', fallbackAt);
  assert.ok(fallbackAt > 0 && dbAt > fallbackAt);
  assert.ok(fn.includes("return new Response('Vault item not found', { status: 404 });"));
});

test('2.12.x (2026-09): resolveVaultStreamUrls resolves per copy with a 30s race, terabox through the mutex, and throws only when ALL copies fail', () => {
  const bg = background();
  const fn = bg.slice(bg.indexOf('async resolveVaultStreamUrls('));
  assert.ok(fn.includes('timeoutMs = 30000'));
  assert.ok(fn.includes("host.toLowerCase() === 'terabox' ? this._enqueueTeraBoxResolve(resolveTask) : resolveTask()"));
  assert.ok(fn.includes('if (failures.length === copies.length) {'));
  assert.ok(fn.includes('throw new Error(`No vault blob copy could be resolved (${failures.join(\'; \')})`);'));
  // One dead copy must not sink the item: the stored URL is kept.
  assert.ok(fn.includes('let url = copy.encryptedBlobUrl || \'\';'));
});

test('2.12.x (2026-09): terabox dlink reads re-resolve every time (forceResolve) and never send the session cookie', () => {
  const bg = background();
  const fn = bg.slice(bg.indexOf('async fetchVaultBlobRange('));
  assert.ok(fn.includes("const forceResolve = host === 'terabox';"));
  assert.ok(fn.includes("headers['Referer'] = 'https://www.terabox.com/';"));
  assert.ok(fn.includes("headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';"));
  assert.ok(fn.includes("let resp = await fetch(url, { headers, credentials: 'omit' });"));
  assert.ok(!fn.includes("headers['Cookie'] ="), 'no Cookie header is ever set on a dlink read');
});

test('2.12.16 (2026-09-01): getTeraBoxRangeCookie is gone — the cookie is the throttle, not the fix', () => {
  const bg = background();
  assert.equal((bg.match(/getTeraBoxRangeCookie/g) || []).length, 0);
});

test('2.12.x (2026-09): terabox gets 15-minute chunk / 20-minute outer timeouts, others 30s / 5min', () => {
  const bg = background();
  assert.ok(bg.includes('const chunkTimeoutMs = isTeraBox ? 15 * 60 * 1000 : 30000;'));
  assert.ok(bg.includes('const outerTimeoutMs = isTeraBox ? 20 * 60 * 1000 : 300000;'));
});

test('2.12.x (2026-09): full-blob decrypt runs in parallel batches — 3 for terabox, 6 for others — and a failed chunk fails the blob', () => {
  const bg = background();
  const fn = bg.slice(bg.indexOf('async _decryptFullVaultBlob('));
  assert.ok(fn.includes("const batchSize = host === 'terabox' ? 3 : 6;"));
  assert.ok(fn.includes('const results = await Promise.allSettled(jobs);'));
  assert.ok(fn.includes("const failed = results.find((r) => r.status === 'rejected');"));
});

test('2.12.85-87 (2026-09-16): the plaintext cache is capped at 192 MiB (entry and total), the chunk cache at 128 MiB', () => {
  const bg = background();
  assert.ok(bg.includes('static PLAINTEXT_CACHE_MAX_ENTRY = 192 * 1024 * 1024;'));
  assert.ok(bg.includes('static PLAINTEXT_CACHE_MAX_BYTES = 192 * 1024 * 1024;'));
  assert.ok(bg.includes('static CHUNK_CACHE_MAX_BYTES = 128 * 1024 * 1024;'));
  assert.ok(bg.includes('this.vaultPlaintextCacheBytes > ImgVaultServiceWorker.PLAINTEXT_CACHE_MAX_BYTES'));
  // The stream stops pulling when the consumer goes away (desiredSize null).
  assert.ok(bg.includes('const alive = () => controller.desiredSize !== null;'));
});

test('2.12.90 (2026-09-18): fetchPlaintextRange hard-caps at 40 MiB and names a bogus locator range', () => {
  const bg = background();
  const fn = bg.slice(bg.indexOf('async fetchVaultPlaintextRange('));
  assert.ok(fn.includes('const MAX_RANGE_BYTES = 40 * 1024 * 1024;'));
  assert.ok(fn.includes('the frame locator returned a bogus range'));
});

test('2.12.x (2026-09): the chunk cache is keyed by the layout signature (total + chunkSize), and the layout is memoized + invalidated', () => {
  const bg = background();
  assert.ok(bg.includes('this.vaultBlobLayout = new Map(); // itemId -> {total, chunkSize}'));
  assert.ok(bg.includes('_getCachedChunk(itemId, chunkIndex, total, chunkSize) {'));
  assert.ok(bg.includes('_setCachedChunk(itemId, chunkIndex, plain, total, chunkSize) {'));
  assert.ok(bg.includes('this.vaultBlobLayout.delete(itemId);'));
});

test('2.12.x (2026-09): a fallback read (copyIndex > 0) is reported exactly once per session', () => {
  const bg = background();
  assert.ok(bg.includes('if (copyIndex > 0) this._noteVaultReadFallback(item?.id, { host, primaryHost, failures });'));
  assert.ok(bg.includes('if (copyIndex > 0) this._noteVaultReadFallback(item?.id, { host, primaryHost, failures });'));
});

// --------------------------------------------------- delete / restore ---

test('2.13.3 (2026-09-25): a vault blob missing from root is searched by fs_id in every folder before the row is released', () => {
  const bg = background();
  const fn = bg.slice(bg.indexOf('async deleteVaultBlobFiles('));
  assert.ok(fn.includes("console.log(`[VAULT DELETE] terabox fs_id ${fsId} not in root — searching all folders`);"));
  assert.ok(fn.includes('const all = await listAllTeraBoxFiles(cookie);'));
  assert.ok(fn.includes('const hit = all.find((f) => String(f.fs_id) === String(fsId))'));
  assert.ok(fn.includes('absent from the account listing — already deleted, no host cleanup needed'));
});

test('2.12.77/82 (2026-09-13): restoring from trash re-vaults on ANY vault provenance marker and clears wasVaulted', () => {
  const store = storage();
  const fn = store.slice(store.indexOf('async restoreFromTrashNeon(id) {'));
  assert.ok(fn.includes('current.encryptedBlobUrl ||'));
  assert.ok(fn.includes('this.isTruthyFlag(current.wasVaulted) ||'));
  assert.ok(fn.includes("current.vaultMode === 'hidden' ||"));
  assert.ok(fn.includes('current.vaultedAt'));
  assert.ok(fn.includes('wasVaulted: false,'));
});

// ---------------------------------------------------------- web move ---

test('2.12.x (2026-09): the web vault move refuses blobs over the 4.5 MB Vercel body cap, pre-flight and server-side', () => {
  const limits = src('../../web/src/lib/vaultMoveLimits.js');
  assert.ok(limits.includes('export const VAULT_MOVE_MAX_CIPHERTEXT_BYTES = 4_500_000'));
  const move = src('../../web/src/lib/vaultMove.js');
  assert.ok(move.includes('if (Number(item.fileSize) > VAULT_MOVE_MAX_CIPHERTEXT_BYTES) throw capError(item.fileSize)'));
  assert.ok(move.includes('if (declaredSize > VAULT_MOVE_MAX_CIPHERTEXT_BYTES) throw capError(declaredSize)'));
  assert.ok(move.includes('over the ${formatBytes(VAULT_MOVE_MAX_CIPHERTEXT_BYTES)} web-move limit'));
});

// ------------------------------------------------- gap-closing pins ---

test('2.12.1 (2026-08-30): the background constructor instantiates the terabox uploader (restore silently skipped terabox without it)', () => {
  const bg = background();
  const ctor = bg.slice(bg.indexOf('constructor()'));
  assert.ok(ctor.includes('this.teraboxUploader = new TeraBoxUploader();'));
});

test('2.12.3 (2026-08-30): background.js never dynamic-imports vaultCrypto — the only dynamic imports left are the known sceneFileCache ones', () => {
  const bg = background();
  assert.equal((bg.match(/await import\(/g) || []).length, 2);
  assert.equal((bg.match(/await import\('\.\.\/utils\/sceneFileCache\.js'\);/g) || []).length, 2);
  assert.ok(!bg.includes("await import('../utils/vaultCrypto.js')"));
  assert.ok(bg.includes('decryptBlob,'));
  assert.ok(bg.includes('decryptMetadata,'));
});

test('2.12.71 (2026-09-11): the gallery hydrates its page key from the SW (vaultGetMasterKey) instead of throwing "locked" on an unlocked vault', () => {
  const page = src('../src/pages/GalleryPage.jsx');
  const fn = page.slice(page.indexOf('const ensureVaultKeyHydrated'));
  assert.ok(fn.includes("const res = await sendMessage('vaultGetMasterKey');"));
  assert.ok(fn.includes('await importMasterKeyFromB64(res.keyB64);'));
  assert.ok(page.includes('await ensureVaultKeyHydrated();'));
});

test('2.13.5 (2026-09-18): a fresh Vault tab hydrates from the SW too — getVaultStatus, then vaultGetMasterKey, then it writes its own session entry', () => {
  const page = src('../src/pages/VaultPage.jsx');
  const mount = page.slice(page.indexOf("if (status?.unlocked) {", page.indexOf('loadVaultConfig')));
  assert.ok(mount.includes("const res = await sendMessage('vaultGetMasterKey');"));
  assert.ok(mount.includes('await importMasterKeyFromB64(res.keyB64);'));
  assert.ok(mount.includes("await sendMessage('vaultSetMasterKey', { keyB64: res.keyB64 });"));
  assert.ok(mount.includes('sessionStorage.setItem('));
});

test('2.13.2 (2026-09-18): the blob delete does NOT pre-flight the explicit terabox cookie — it passes settings through and lets the API throw the real remediation', () => {
  const bg = background();
  const fn = bg.slice(bg.indexOf('async deleteVaultBlobFiles(item)'));
  assert.ok(fn.includes("const cookie = settings?.teraboxCookie || '';"));
  assert.equal((bg.match(/TeraBox cookie not configured/g) || []).length, 0);
  assert.ok(src('../src/utils/teraBoxApi.js').includes("throw new Error('No TeraBox cookie. Log in to TeraBox or set the cookie in Settings.');"));
});

test('2.12.18 (2026-09-01): vault video elements autoplay and remount per item (key={item.id})', () => {
  const page = src('../src/pages/VaultPage.jsx');
  assert.equal((page.match(/autoPlay/g) || []).length, 3);
  assert.ok((page.match(/key=\{item\.id\}/g) || []).length >= 3);
});

test('2.12.19 (2026-09-01): the modal overview skips the raw imageHosts/videoHosts blobs (the flattened per-provider rows already carry them)', () => {
  const registry = src('../../packages/shared/mediaFieldRegistry.js');
  assert.ok(registry.includes("if (key === 'imageHosts' || key === 'videoHosts') continue;"));
});

// ------------------------------------------- native vault route (2.19.31) ---

test('2.19.31 (2026-11-22): fetchVaultBlobRange reads native- telegram copies through the native host, never getFile', () => {
  const bg = background();
  const fn = bg.slice(bg.indexOf('async fetchVaultBlobRange('));
  assert.ok(fn.includes("if (isNativeTelegramFileId(fileId)) {"));
  assert.ok(fn.includes('downloadTelegramFileNative({ messageId, channel, offset: start, length: end - start + 1 })'));
  assert.ok(fn.includes("const messageId = nativeTelegramMessageId(fileId);"));
  // the native branch sits BEFORE the Bot API token check — a native copy
  // needs the channel, not the bot token
  assert.ok(fn.indexOf('isNativeTelegramFileId(fileId)') < fn.indexOf("telegram vault read needs the bot token"));
});

test('2.19.31 (2026-11-22): decryptVaultBlob downloads a native telegram copy whole through the native host BEFORE any URL fetch', () => {
  const bg = background();
  const fn = bg.slice(bg.indexOf('async decryptVaultBlob('));
  const nativeBranch = fn.indexOf("isNativeTelegramFileId(candidate.fileId)");
  assert.ok(nativeBranch > 0);
  assert.ok(fn.includes('downloadTelegramFileNative({ messageId, channel, offset: 0, length: 0 })'));
  // the stored URL of a native copy is a t.me post page — fetching it
  // would return HTML and poison the blob, so the native branch must come
  // before the first fetch(candidate.url)
  assert.ok(nativeBranch < fn.indexOf('const resp = await fetch(candidate.url);'));
});

test('2.19.31 (2026-11-22): both vault upload paths probe the native host for over-20 MB telegram blobs and pass the answer to the gate', () => {
  const bg = background();
  const swFn = bg.slice(bg.indexOf('async encryptAndUploadVaultedBlob('));
  assert.ok(swFn.includes("await this.handleNativeHostCommand('ping', {})"));
  assert.ok(swFn.includes('assertVaultBlobHostSizes(targetHosts, encryptedBlob.size, undefined, { hasNativeHost, nativeProbeError })'));
  assert.ok(swFn.includes('nativeAboveBytes: TELEGRAM_GETFILE_MAX_BYTES'));

  const gallery = src('../src/pages/GalleryPage.jsx');
  const pageFn = gallery.slice(gallery.indexOf('const uploadVaultedDirectly = async (uploadData) => {'));
  assert.ok(pageFn.includes('const probe = await probeNativeHost();'));
  assert.ok(pageFn.includes('assertVaultBlobHostSizes(vaultHostKeys, encryptedBlob.size, undefined, { hasNativeHost, nativeProbeError })'));
  assert.ok(pageFn.includes('nativeAboveBytes: TELEGRAM_GETFILE_MAX_BYTES'));
  assert.ok(pageFn.includes('Native host reachable — the Telegram vault copy'));
  // the probe happens before the gate call it feeds
  assert.ok(pageFn.indexOf('const probe = await probeNativeHost();') < pageFn.indexOf('assertVaultBlobHostSizes(vaultHostKeys'));
});

test('2.19.31 (2026-11-22): background.js imports the native telegram download helpers', () => {
  const bg = background();
  assert.ok(bg.includes('downloadTelegramFileNative, fetchTelegramFile, deleteTelegramMessage, isNativeTelegramFileId, nativeTelegramMessageId'));
});
