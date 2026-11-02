/**
 * @fileoverview Pure TeraBox reference matching — shared by every platform.
 * @version 1.0.0
 *
 * WHY THIS EXISTS: the orphan scan used to decide "is this TeraBox file
 * referenced?" by NAME only, so it skipped every file whose name appeared
 * anywhere in the vault:
 *
 *   if (name && referencedNames.has(name)) continue;   // <- swallowed copies
 *
 * That is exactly what a duplicate is: the gallery item points at ONE copy
 * (by fs_id), and the second copy has the SAME NAME with a different fs_id.
 * The name matched, so the duplicate was never reported as an orphan and
 * could never be cleaned up from the Resolve page. A second copy of a
 * 900 MB video sat on the account, invisible, forever.
 *
 * The rule here is:
 *   - a file whose fs_id an item points at      -> referenced
 *   - a file with no fs_id whose name is claimed -> referenced (the item
 *     only knows the name, so the name IS the reference)
 *   - a file with an fs_id that NO item points at, but whose name IS
 *     claimed by an item that points at a DIFFERENT fs_id -> DUPLICATE
 *   - everything else                            -> orphan
 */

const asId = (value) => {
  const id = String(value ?? '').trim();
  return id || '';
};

const asName = (value) => {
  const name = String(value ?? '').trim();
  return name || '';
};

/**
 * The ONLY folder the vault writes to.
 *
 * The TeraBox uploader sanitizes the destination name with `split('/').pop()`
 * and uploads to `/<name>`, so every file the vault creates lands in the root
 * folder. A file in any other folder was NOT created by the vault - it belongs
 * to another tool (a git mirror, a manual upload) and must never be reported
 * as a vault orphan with a delete button on it.
 */
export const TERABOX_VAULT_FOLDER = 'root';

/**
 * Is this file in the folder the vault writes to?
 * @param {{_folder?: string}} file
 * @returns {boolean}
 */
export function isVaultFolderFile(file) {
  const folder = String(file?._folder ?? TERABOX_VAULT_FOLDER).trim();
  return !folder || folder === TERABOX_VAULT_FOLDER || folder === '/';
}

/**
 * A fresh reference index. One index per scan.
 * @returns {{ids: Set<string>, names: Set<string>, idsByName: Map<string, Set<string>>}}
 */
export function createTeraBoxRefIndex() {
  return {
    ids: new Set(),
    names: new Set(),
    // name -> the fs_ids an item claims for that name. An empty set means
    // "the name is claimed, but by name only" (no fs_id to match against).
    idsByName: new Map(),
  };
}

/**
 * Record one reference (an item pointing at a TeraBox file).
 * @param {{ids:Set, names:Set, idsByName:Map}} index
 * @param {string} id - fs_id, may be empty
 * @param {string} name - server filename, may be empty
 */
export function addTeraBoxRef(index, id, name) {
  if (!index) return;
  const fileId = asId(id);
  const fileName = asName(name);
  if (fileId) index.ids.add(fileId);
  if (!fileName) return;
  index.names.add(fileName);
  if (!index.idsByName.has(fileName)) index.idsByName.set(fileName, new Set());
  if (fileId) index.idsByName.get(fileName).add(fileId);
}

/**
 * Is this file referenced by the index?
 *
 * @param {{fs_id?: string, server_filename?: string}} file
 * @param {{ids:Set, names:Set, idsByName:Map}} index
 * @returns {boolean}
 */
export function isTeraBoxFileReferenced(file, index) {
  if (!file || !index) return false;
  const fileId = asId(file.fs_id);
  const name = asName(file.server_filename);

  if (fileId && index.ids.has(fileId)) return true;
  if (!name || !index.names.has(name)) return false;

  // The name is claimed. If the claim carries fs_ids and this file's fs_id is
  // not one of them, this is a SECOND copy of the same name — a duplicate,
  // not a reference.
  const claimedIds = index.idsByName.get(name);
  if (!claimedIds || claimedIds.size === 0) return true; // claimed by name only
  if (!fileId) return true; // no id to contradict the claim
  return claimedIds.has(fileId);
}

/**
 * Split a TeraBox listing into the files the vault references and the ones
 * it does not (orphans + duplicates).
 *
 * @param {Array<{fs_id?: string, server_filename?: string}>} files
 * @param {{ids:Set, names:Set, idsByName:Map}} index
 * @param {{shouldSkip?: (file: any) => boolean}} [options] - files another
 *   tab owns (scene models, scene textures) are skipped entirely
 * @returns {{referenced: Array, extra: Array}}
 */
export function classifyTeraBoxFiles(files, index, { shouldSkip } = {}) {
  const referenced = [];
  const extra = [];
  for (const file of files || []) {
    if (typeof shouldSkip === 'function' && shouldSkip(file)) continue;
    if (isTeraBoxFileReferenced(file, index)) referenced.push(file);
    else extra.push(file);
  }
  return { referenced, extra };
}
