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
 * @param {string} accessToken
 * @param {string} accountId
 * @param {string} [folderId] – empty string for root folder
 * @returns {Promise<{files:Array,folders:Array}|null>}
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
    console.warn('[udropApi] folder/listing HTTP error:', resp.status);
    return null;
  }

  const result = await resp.json();
  console.log('[udropApi] folder/listing result:', result);

  if (result._status !== 'success') {
    console.warn('[udropApi] folder/listing API error:', result.response || JSON.stringify(result));
    return null;
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
    if (!listing) continue;

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
 * Full UDrop integrity check.
 * Uses /folder/listing to get ALL files, then compares against DB items.
 * Also identifies orphaned UDrop files (not in DB).
 * @param {Array} items – DB media items with udropWatchUrl/udropDirectUrl/spzUrl
 * @param {string} accessToken
 * @param {string} accountId
 * @returns {Promise<{found:[],missing:[],noUrl:[],extra:[]}>}
 */
export async function checkUdropIntegrity(items, accessToken, accountId) {
  const found = [];
  const missing = [];
  const noUrl = [];
  const extra = [];

  // 1. Try to get full file list via folder/listing
  let udropFiles = [];
  let udropMap = new Map();
  let listingSucceeded = false;

  try {
    udropFiles = await listAllUdropFiles(accessToken, accountId);
    udropMap = buildUdropFileMap(udropFiles);
    listingSucceeded = true;
    console.log(`[udropApi] Listed ${udropFiles.length} UDrop files across all folders.`);
  } catch (err) {
    console.warn('[udropApi] folder/listing failed, falling back to per-file checks:', err.message);
  }

  // 2. Track which DB items reference which codes
  const dbCodes = new Set();

  for (const item of items) {
    // Read URLs from the provider-links object (videoHosts / extra_metadata)
    // as well as the legacy top-level fields — items saved through flows
    // that only write videoHosts otherwise look like orphans forever.
    const providerLinks = getVideoProviderLinks(item);
    const links = providerLinks.udrop || {};
    const urls = [
      links.watchUrl,
      links.directUrl,
      item.udropWatchUrl,
      item.udropDirectUrl,
      item.udropUrl,
      item.spzUrl,
      item.textureUrl,
    ].filter(Boolean);

    const codes = urls.map(extractUdropCode).filter(Boolean);
    const uniqueCodes = [...new Set(codes)];

    if (!uniqueCodes.length) {
      noUrl.push({ item, codes: [] });
      continue;
    }

    // Add to global DB code set
    uniqueCodes.forEach((c) => dbCodes.add(c));

    // Try map lookup first (fast)
    let matchedFile = null;
    if (listingSucceeded) {
      matchedFile = uniqueCodes.map((code) => udropMap.get(code)).find(Boolean) || null;
    }

    // If no map match or listing failed, fall back to per-file API check
    if (!matchedFile && !listingSucceeded) {
      for (const code of uniqueCodes) {
        const check = await checkUdropFileExists(accessToken, accountId, code);
        if (check.exists) {
          matchedFile = { file_id: code, ...check.raw };
          break;
        }
      }
    }

    if (matchedFile) {
      found.push({ item, codes: uniqueCodes, matchedFile });
    } else {
      missing.push({ item, codes: uniqueCodes });
    }
  }

  // 3. Find extra files: UDrop files not referenced by any DB item
  if (listingSucceeded) {
    for (const file of udropFiles) {
      const code = file.short_url || file.shortUrl || '';
      const fileId = String(file.file_id || file.id || '');
      const isReferenced = dbCodes.has(code) || dbCodes.has(fileId);
      if (!isReferenced) {
        extra.push({ file });
      }
    }
  }

  return { found, missing, noUrl, extra };
}
