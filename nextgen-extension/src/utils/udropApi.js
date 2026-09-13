/**
 * @fileoverview UDrop API v2 client for extension use
 * @description Uses /folder/listing to recursively list all files, then
 *              cross-checks against DB items. Falls back to per-file
 *              checks if listing fails.
 */

import { getVideoProviderLinks } from './videoProviderLinks.js';

const UDROP_API_BASE = 'https://www.udrop.com/api/v2';

/**
 * Authorize with UDrop API
 * @param {string} key1
 * @param {string} key2
 * @returns {Promise<{access_token:string,account_id:string}>}
 */
export async function authorizeUdrop(key1, key2) {
  const formData = new FormData();
  formData.append('key1', key1);
  formData.append('key2', key2);

  const resp = await fetch(`${UDROP_API_BASE}/authorize`, {
    method: 'POST',
    body: formData,
  });

  if (!resp.ok) throw new Error(`Auth failed: ${resp.status}`);
  const result = await resp.json();
  console.log('[udropApi] authorize result:', result);
  if (result._status !== 'success') throw new Error(`Auth error: ${result.response || result.msg || result.message || JSON.stringify(result)}`);
  if (!result.data) throw new Error('Auth succeeded but no data returned.');
  return result.data;
}

/**
 * List contents of a single folder.
 * Fails LOUDLY — a swallowed error here would make every file look broken.
 * @param {string} accessToken
 * @param {string} accountId
 * @param {string} [folderId] – empty string for root folder
 * @returns {Promise<{files:Array,folders:Array}>}
 */
export async function listUdropFolder(accessToken, accountId, folderId = '') {
  const formData = new FormData();
  formData.append('access_token', accessToken);
  formData.append('account_id', accountId);
  if (folderId) formData.append('folder_id', folderId);

  const resp = await fetch(`${UDROP_API_BASE}/folder/listing`, {
    method: 'POST',
    body: formData,
  });

  if (!resp.ok) {
    throw new Error(`UDrop folder/listing failed: HTTP ${resp.status}${folderId ? ` (folder ${folderId})` : ''}`);
  }

  const result = await resp.json();
  console.log('[udropApi] folder/listing result:', result);

  if (result._status !== 'success') {
    throw new Error(`UDrop folder/listing error: ${result.response || result.msg || result.message || JSON.stringify(result)}${folderId ? ` (folder ${folderId})` : ''}`);
  }

  const data = result.data || {};
  const files = (Array.isArray(data.files) ? data.files : []).filter(
      (f) => f.status !== 'trash' && f.status !== 'deleted'
    );
  const folders = Array.isArray(data.folders)
    ? data.folders
    : Array.isArray(data.subFolders)
      ? data.subFolders
      : [];

  return { files, folders };
}

/**
 * Recursively list ALL files across every folder.
 * Throws on any folder failure — a partial listing would report healthy
 * files as broken links, which is worse than a loud error.
 * @param {string} accessToken
 * @param {string} accountId
 * @returns {Promise<Array>}
 */
export async function listAllUdropFiles(accessToken, accountId) {
  const allFiles = [];
  const foldersToProcess = [{ folderId: '', name: 'root' }];
  const visited = new Set();

  while (foldersToProcess.length > 0) {
    const { folderId, name } = foldersToProcess.shift();
    if (visited.has(folderId)) continue;
    visited.add(folderId);

    const listing = await listUdropFolder(accessToken, accountId, folderId);

    for (const file of listing.files) {
      allFiles.push({ ...file, _folderName: name });
    }

    for (const sub of listing.folders) {
      const subId = String(sub.id || sub.folder_id || sub.folderId || '');
      if (subId && !visited.has(subId)) {
        foldersToProcess.push({
          folderId: subId,
          name: sub.name || sub.folder_name || subId,
        });
      }
    }
  }

  return allFiles;
}

/**
 * Build a UDrop file lookup map from a flat file list.
 * Keys by short_url code and file_id.
 * @param {Array} files
 * @returns {Map<string, Object>}
 */
export function buildUdropFileMap(files = []) {
  const map = new Map();
  for (const file of files) {
    const code = file.short_url || file.shortUrl || '';
    const fileId = String(file.file_id || file.id || '');
    if (code) map.set(code, file);
    if (fileId) map.set(fileId, file);
    // Also index by url if it contains a code
    if (file.url) {
      const urlMatch = String(file.url).match(/udrop\.com(?:\/file)?\/([^\/\?#]+)/i);
      if (urlMatch) map.set(urlMatch[1], file);
    }
  }
  return map;
}

/**
 * Extract UDrop short code / file_id from a URL.
 * @param {string} url
 * @returns {string|null}
 */
export function extractUdropCode(url) {
  if (!url) return null;
  const match = String(url).match(/udrop\.com(?:\/file)?\/([^\/\?#]+)/i);
  return match ? match[1] : null;
}

/**
 * Check if a single file still exists via /file/download (lightweight existence check).
 * @param {string} accessToken
 * @param {string} accountId
 * @param {string} fileIdOrCode
 * @returns {Promise<{exists:boolean,raw:Object|null}>}
 */
export async function checkUdropFileExists(accessToken, accountId, fileIdOrCode) {
  const formData = new FormData();
  formData.append('access_token', accessToken);
  formData.append('account_id', accountId);
  // Try file_id first, then short_url
  if (/^\d+$/.test(fileIdOrCode)) {
    formData.append('file_id', fileIdOrCode);
  } else {
    formData.append('short_url', fileIdOrCode);
  }

  const resp = await fetch(`${UDROP_API_BASE}/file/download`, {
    method: 'POST',
    body: formData,
  });

  if (!resp.ok) return { exists: false, raw: null };

  const result = await resp.json();
  if (result._status === 'success' && result.data?.download_url) {
    return { exists: true, raw: result.data };
  }
  return { exists: false, raw: result };
}

/**
 * Delete a file on UDrop.
 * @param {string} accessToken
 * @param {string} accountId
 * @param {string} fileId
 * @returns {Promise<boolean>}
 */
export async function deleteUdropFile(accessToken, accountId, fileId) {
  const formData = new FormData();
  formData.append('access_token', accessToken);
  formData.append('account_id', accountId);
  formData.append('file_id', String(fileId));

  const resp = await fetch(`${UDROP_API_BASE}/file/delete`, {
    method: 'POST',
    body: formData,
  });

  if (!resp.ok) throw new Error(`Delete failed: ${resp.status}`);
  const result = await resp.json();
  if (result._status !== 'success') {
    throw new Error(result.response || result.msg || result.message || 'Delete failed');
  }
  return true;
}

/**
 * All UDrop-bearing URL fields an item can carry (legacy columns, provider
 * links, extra multi-links, and the vault encrypted blob — vault .bin files
 * live on UDrop too and must never count as orphans).
 */
function udropUrlsOfItem(item) {
  const providerLinks = getVideoProviderLinks(item);
  const links = providerLinks.udrop || {};
  const extraLinks = Array.isArray(item.extraMetadata?.udropLinks) ? item.extraMetadata.udropLinks : [];
  return [
    links.watchUrl,
    links.directUrl,
    item.udropWatchUrl,
    item.udropDirectUrl,
    item.udropUrl,
    item.spzUrl,
    item.textureUrl,
    item.encryptedBlobUrl,
    item.extraMetadata?.encryptedBlobUrl,
    ...extraLinks.flatMap((entry) => [entry?.watchUrl, entry?.directUrl]).filter(Boolean),
  ].filter(Boolean);
}

/**
 * Full UDrop integrity check.
 * Uses /folder/listing to get ALL files, then compares against DB items.
 * Also identifies orphaned UDrop files (not in DB).
 * A listing failure THROWS — never report health from a partial/empty listing.
 * @param {Array} items – DB media items (video items) checked for found/missing/noUrl
 * @param {Array} allItems – every DB item; their udrop codes (incl. scene spz/texture)
 *                           are excluded from the extra list so 3D scene files don't
 *                           show as video orphans
 * @param {string} accessToken
 * @param {string} accountId
 * @returns {Promise<{found:[],missing:[],noUrl:[],extra:[]}>}
 */
export async function checkUdropIntegrity(items, allItems, accessToken, accountId) {
  const found = [];
  const missing = [];
  const noUrl = [];
  const extra = [];

  // 1. Full file list — throws loudly if any folder fails to list
  const udropFiles = await listAllUdropFiles(accessToken, accountId);
  const udropMap = buildUdropFileMap(udropFiles);
  console.log(`[udropApi] Listed ${udropFiles.length} UDrop files across all folders.`);

  // 2. Track which DB items reference which codes
  const dbCodes = new Set();

  for (const item of items) {
    // Read URLs from the provider-links object (videoHosts / extra_metadata)
    // as well as the legacy top-level fields — items saved through flows
    // that only write videoHosts otherwise look like orphans forever.
    const urls = udropUrlsOfItem(item);
    const codes = urls.map(extractUdropCode).filter(Boolean);
    const uniqueCodes = [...new Set(codes)];

    if (!uniqueCodes.length) {
      noUrl.push({ item, codes: [] });
      continue;
    }

    // Add to global DB code set
    uniqueCodes.forEach((c) => dbCodes.add(c));

    const matchedFile = uniqueCodes.map((code) => udropMap.get(code)).find(Boolean) || null;

    if (matchedFile) {
      found.push({ item, codes: uniqueCodes, matchedFile });
    } else {
      missing.push({ item, codes: uniqueCodes });
    }
  }

  // 3. Find extra files: UDrop files not referenced by any DB item.
  //    Build a comprehensive referenced set from ALL items (including scenes
  //    and vault blobs) so their files don't show as video orphans.
  const referencedCodes = new Set(dbCodes);
  for (const item of allItems || []) {
    if (!item) continue;
    udropUrlsOfItem(item).map(extractUdropCode).filter(Boolean).forEach((c) => referencedCodes.add(c));
  }
  for (const file of udropFiles) {
    const code = file.short_url || file.shortUrl || '';
    const fileId = String(file.file_id || file.id || '');
    const isReferenced = referencedCodes.has(code) || referencedCodes.has(fileId);
    if (!isReferenced) {
      extra.push({ file });
    }
  }

  return { found, missing, noUrl, extra };
}

/**
 * 3D scene integrity check against UDrop.
 * Scenes are stored as .spz files on UDrop (spzUrl = udrop.com/{code}/{name}.spz).
 * Compares the scene items' spz codes against the full UDrop file listing so the
 * scene tab doesn't inflate the video counts (was mixed into checkUdropIntegrity).
 * A listing failure THROWS — never report health from a partial/empty listing.
 * @param {Array} items – DB media items (scene items)
 * @param {Array} allItems – every DB item; their udrop codes are excluded from
 *                           the extra list so video files don't show as scene orphans
 * @param {string} accessToken
 * @param {string} accountId
 * @returns {Promise<{found:[],missing:[],noUrl:[],extra:[]}>}
 */
export async function checkSceneIntegrity(items, allItems, accessToken, accountId) {
  const found = [];
  const missing = [];
  const noUrl = [];
  const extra = [];

  const udropFiles = await listAllUdropFiles(accessToken, accountId);
  const udropMap = buildUdropFileMap(udropFiles);
  console.log(`[udropApi] Scene check: listed ${udropFiles.length} UDrop files.`);

  // Codes referenced by ANY item (videos and vault blobs included) never
  // count as scene orphans
  const referencedCodes = new Set();
  for (const item of allItems || []) {
    if (!item) continue;
    udropUrlsOfItem(item).map(extractUdropCode).filter(Boolean).forEach((c) => referencedCodes.add(c));
  }

  const dbCodes = new Set();

  for (const item of items) {
    const urls = udropUrlsOfItem(item);
    const spzCode = extractUdropCode(item.spzUrl);
    const texCode = extractUdropCode(item.textureUrl);
    const codes = urls.map(extractUdropCode).filter(Boolean);
    const uniqueCodes = [...new Set(codes)];

    if (!uniqueCodes.length) {
      noUrl.push({ item, codes: [], spzCode: spzCode || null, texCode: texCode || null, spzMatched: null, texMatched: null });
      continue;
    }

    uniqueCodes.forEach((c) => dbCodes.add(c));

    let spzMatched = null;
    let texMatched = null;
    if (spzCode) spzMatched = udropMap.get(spzCode) || null;
    if (texCode) texMatched = udropMap.get(texCode) || null;

    // Both files are part of 1 scene — require both when both codes exist (2.12.58)
    const needsSpz = Boolean(spzCode);
    const needsTex = Boolean(texCode);
    const spzOk = !needsSpz || Boolean(spzMatched);
    const texOk = !needsTex || Boolean(texMatched);
    const allOk = spzOk && texOk;
    const anyOk = Boolean(spzMatched || texMatched);
    // Keep legacy matchedFile for callers that only read one
    const matchedFile = spzMatched || texMatched || null;

    if (allOk && anyOk) {
      found.push({ item, codes: uniqueCodes, matchedFile, spzCode: spzCode || null, texCode: texCode || null, spzMatched, texMatched });
    } else {
      // Partial: one file missing counts as missing so both hosts stay symmetric
      missing.push({ item, codes: uniqueCodes, matchedFile, spzCode: spzCode || null, texCode: texCode || null, spzMatched, texMatched });
    }
  }

  const TEXTURE_EXT_RE = /\.(webp|png|jpg|jpeg|gif|bmp|tiff|tga|exr|hdr)$/i;
  const stemOf = (name) => String(name || '').split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
  const coreOf = (stem) => String(stem || '').split('_').pop().split('-').pop();
  const isOrphanFile = (file) => {
    const code = file.short_url || file.shortUrl || '';
    const fileId = String(file.file_id || file.id || '');
    if (dbCodes.has(code) || dbCodes.has(fileId)) return false;
    if (referencedCodes.has(code) || referencedCodes.has(fileId)) return false;
    return true;
  };
  const spzOrphans = [];
  const textureOrphans = [];
  for (const file of udropFiles) {
    if (!isOrphanFile(file)) continue;
    const name = String(file.name || file.filename || '');
    if (name.toLowerCase().endsWith('.spz')) spzOrphans.push(file);
    else if (TEXTURE_EXT_RE.test(name)) textureOrphans.push(file);
  }
  const usedTextureIdx = new Set();
  for (const spzFile of spzOrphans) {
    const spzName = String(spzFile.name || spzFile.filename || '');
    const spzStem = stemOf(spzName);
    const spzCore = coreOf(spzStem);
    const mates = [];
    textureOrphans.forEach((texFile, idx) => {
      if (usedTextureIdx.has(idx)) return;
      const texStem = stemOf(texFile.name || texFile.filename || '');
      if (texStem === spzStem || texStem === spzCore || spzStem.endsWith(`_${texStem}`) || spzStem.endsWith(`-${texStem}`) || texStem.endsWith(`_${spzCore}`)) {
        mates.push(texFile);
        usedTextureIdx.add(idx);
      }
    });
    extra.push({ file: spzFile, textureFiles: mates });
  }
  textureOrphans.forEach((texFile, idx) => {
    if (usedTextureIdx.has(idx)) return;
    extra.push({ file: texFile, textureFiles: [], standaloneTexture: true });
  });

  return { found, missing, noUrl, extra };
}
