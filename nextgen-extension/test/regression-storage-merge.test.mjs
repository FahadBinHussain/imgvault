// Regression tests for the updateImage merge contract — updating ONE
// host's links must never wipe the OTHER hosts.
//
// storage.js cannot be imported in plain node (it needs the @shared alias
// and the Neon client), so these are source-text pins on the exact merge
// lines, the established pattern for unimportable modules. The contract
// they pin:
//
//   updateImageNeon merges SHALLOWLY — `{ ...existing, ...updates }` — so
//   an update carrying `videoHosts: { filemoon: ... }` would REPLACE the
//   whole videoHosts object and silently drop udrop/terabox/telegram.
//   Merge safety therefore lives in the CALLERS: every flow that writes
//   one host must read the current item first and spread the existing
//   hosts into the update. These pins guard that spread in each caller.
//
// (Was a real bug 2.2.x — updateImage overwrote the URL when a second
// file was linked to the same item; linkProviderFileToItem exists because
// of it.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('updateImageNeon merges shallowly — callers MUST spread existing hosts (the contract these pins guard)', () => {
  const storage = src('../src/utils/storage.js');
  const fn = storage.slice(storage.indexOf('async updateImageNeon('));
  // The Neon write merges the update over the existing row, one level deep.
  assert.ok(fn.includes('const payload = this.toNeonMediaPayload({ ...existing, ...updates }, existing, options);'));
  // And it reads the row first — a write against a missing item fails loudly.
  assert.ok(fn.includes("if (!rows.length) throw new Error('Image not found');"));
});

test('updateVideoThumbnail spreads BOTH videoHosts copies before setting one host thumbnail', () => {
  const storage = src('../src/utils/storage.js');
  const fn = storage.slice(storage.indexOf('async updateVideoThumbnail('));
  // Top-level AND extraMetadata copies are read — the row mirrors its host
  // links in both places, and a spread of only one would drop the other's.
  assert.ok(fn.includes('const existingVh = current.videoHosts && typeof current.videoHosts === \'object\' ? current.videoHosts : {};'));
  assert.ok(fn.includes('const existingExtraVh = current.extraMetadata?.videoHosts && typeof current.extraMetadata.videoHosts === \'object\''));
  assert.ok(fn.includes('const vh = { ...existingVh, ...existingExtraVh };'));
  // The one host's entry is merged per-key, not replaced wholesale.
  assert.ok(fn.includes('vh[key] = {'));
  assert.ok(fn.includes('...(vh[key] || {}),'));
  // The merged map rides in BOTH copies of the update.
  assert.ok(fn.includes('extraMetadata: { ...(current.extraMetadata || {}), videoHosts: vh },'));
  assert.ok(fn.includes('videoHosts: vh,'));
});

test('linkProviderFileToItem APPENDS a link (never replaces) and is idempotent on the same filecode', () => {
  const storage = src('../src/utils/storage.js');
  const fn = storage.slice(storage.indexOf('async linkProviderFileToItem('));
  assert.ok(fn.includes('const alreadyLinked = existingLinks.some((entry) => String(entry?.filecode || \'\') === filecode);'));
  assert.ok(fn.includes('if (alreadyLinked) return true;'));
  assert.ok(fn.includes('const nextLinks = ['));
  assert.ok(fn.includes('...existingLinks,'));
  assert.ok(fn.includes('extraMetadata: { ...existingExtra, [linksKey]: nextLinks },'));
});

test('linkProviderFileToItem only fills a top-level watch/direct URL when the item has none yet', () => {
  const storage = src('../src/utils/storage.js');
  const fn = storage.slice(storage.indexOf('async linkProviderFileToItem('));
  // The first link becomes the primary field; a second link must NOT
  // overwrite it (that was the 2.2.x orphan-flip bug).
  assert.ok(fn.includes('if (!current.filemoonWatchUrl && link.watchUrl) updates.filemoonWatchUrl = String(link.watchUrl);'));
  assert.ok(fn.includes('if (!current.filemoonDirectUrl && link.directUrl) updates.filemoonDirectUrl = String(link.directUrl);'));
  assert.ok(fn.includes('if (!current.udropWatchUrl && link.watchUrl) updates.udropWatchUrl = String(link.watchUrl);'));
  assert.ok(fn.includes('if (!current.udropDirectUrl && link.directUrl) updates.udropDirectUrl = String(link.directUrl);'));
});

test('linkProviderFileToItem merges the terabox entry per-key instead of replacing videoHosts', () => {
  const storage = src('../src/utils/storage.js');
  const fn = storage.slice(storage.indexOf('async linkProviderFileToItem('));
  assert.ok(fn.includes('vh.terabox = {'));
  assert.ok(fn.includes('...(vh.terabox || {}),'));
});

test('the firestore updateImage PATCHes only the named fields (updateMask) — never a whole-doc rewrite', () => {
  const storage = src('../src/utils/storage.js');
  const fn = storage.slice(storage.indexOf('async updateImage(id, updates, options = {})'));
  assert.ok(fn.includes('const fieldPaths = Object.keys(firestoreUpdates);'));
  assert.ok(fn.includes("'updateMask.fieldPaths': fieldPaths"));
  assert.ok(fn.includes("method: 'PATCH',"));
});

test('the background updateImage message forwards the caller payload as-is — the merge is the caller\'s job', () => {
  const bg = src('../src/background/background.js');
  const fn = bg.slice(bg.indexOf("case 'updateImage':"));
  assert.ok(fn.includes('this.storage.updateImage(request.data.id, request.data)'));
});

test('toNeonMediaPayload normalizes videoHosts from the merged extra + legacy fields', () => {
  const storage = src('../src/utils/storage.js');
  const fn = storage.slice(storage.indexOf('toNeonMediaPayload('));
  assert.ok(fn.includes('const videoHosts = normalizeVideoProviderLinksForStorage({ ...extra, ...legacyVideoFields });'));
});
