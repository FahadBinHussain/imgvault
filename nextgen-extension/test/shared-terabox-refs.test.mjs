// node:test suite for packages/shared/teraboxRefs.js — the fs_id-based
// TeraBox reference matching. Pure functions, no network.
//
// The legacy test-terabox-orphan-matching.mjs (18/18) covers the headline
// duplicate rule end to end; this suite pins the index primitives and the
// edge cases around them.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TERABOX_VAULT_FOLDER,
  addTeraBoxRef,
  classifyTeraBoxFiles,
  createTeraBoxRefIndex,
  isTeraBoxFileReferenced,
  isVaultFolderFile,
} from '../../packages/shared/teraboxRefs.js';

const file = (fs_id, server_filename, extra = {}) => ({ fs_id, server_filename, ...extra });

describe('createTeraBoxRefIndex / addTeraBoxRef', () => {
  test('a fresh index is empty', () => {
    const index = createTeraBoxRefIndex();
    assert.equal(index.ids.size, 0);
    assert.equal(index.names.size, 0);
    assert.equal(index.idsByName.size, 0);
  });
  test('adding a ref records the id, the name, and the id under the name', () => {
    const index = createTeraBoxRefIndex();
    addTeraBoxRef(index, '111', 'clip.mp4');
    assert.ok(index.ids.has('111'));
    assert.ok(index.names.has('clip.mp4'));
    assert.deepEqual([...index.idsByName.get('clip.mp4')], ['111']);
  });
  test('a name-only claim records the name with an empty id set', () => {
    const index = createTeraBoxRefIndex();
    addTeraBoxRef(index, '', 'clip.mp4');
    assert.equal(index.ids.size, 0);
    assert.ok(index.names.has('clip.mp4'));
    assert.equal(index.idsByName.get('clip.mp4').size, 0);
  });
  test('an id-only claim records the id but no name', () => {
    const index = createTeraBoxRefIndex();
    addTeraBoxRef(index, '111', '');
    assert.ok(index.ids.has('111'));
    assert.equal(index.names.size, 0);
  });
  test('whitespace is trimmed from ids and names', () => {
    const index = createTeraBoxRefIndex();
    addTeraBoxRef(index, ' 111 ', ' clip.mp4 ');
    assert.ok(index.ids.has('111'));
    assert.ok(index.names.has('clip.mp4'));
  });
  test('adding to a null index is a no-op, not a crash', () => {
    assert.doesNotThrow(() => addTeraBoxRef(null, '111', 'clip.mp4'));
    assert.doesNotThrow(() => addTeraBoxRef(undefined, '111', 'clip.mp4'));
  });
  test('two ids under one name are both recorded', () => {
    const index = createTeraBoxRefIndex();
    addTeraBoxRef(index, '111', 'clip.mp4');
    addTeraBoxRef(index, '222', 'clip.mp4');
    assert.deepEqual([...index.idsByName.get('clip.mp4')].sort(), ['111', '222']);
  });
});

describe('isTeraBoxFileReferenced', () => {
  test('the copy the item points at is referenced', () => {
    const index = createTeraBoxRefIndex();
    addTeraBoxRef(index, '111', 'clip.mp4');
    assert.equal(isTeraBoxFileReferenced(file('111', 'clip.mp4'), index), true);
  });
  test('same name + different fs_id is a DUPLICATE, not a reference', () => {
    const index = createTeraBoxRefIndex();
    addTeraBoxRef(index, '111', 'clip.mp4');
    assert.equal(isTeraBoxFileReferenced(file('222', 'clip.mp4'), index), false);
  });
  test('a file with no fs_id whose name is claimed is referenced', () => {
    const index = createTeraBoxRefIndex();
    addTeraBoxRef(index, '111', 'clip.mp4');
    assert.equal(isTeraBoxFileReferenced(file('', 'clip.mp4'), index), true);
    assert.equal(isTeraBoxFileReferenced(file(undefined, 'clip.mp4'), index), true);
  });
  test('a name-only claim matches any id under that name', () => {
    const index = createTeraBoxRefIndex();
    addTeraBoxRef(index, '', 'clip.mp4');
    assert.equal(isTeraBoxFileReferenced(file('555', 'clip.mp4'), index), true);
  });
  test('a name-only claim does not swallow a different name', () => {
    const index = createTeraBoxRefIndex();
    addTeraBoxRef(index, '', 'clip.mp4');
    assert.equal(isTeraBoxFileReferenced(file('555', 'other.mp4'), index), false);
  });
  test('an id match wins even when the name differs', () => {
    const index = createTeraBoxRefIndex();
    addTeraBoxRef(index, '111', 'clip.mp4');
    assert.equal(isTeraBoxFileReferenced(file('111', 'renamed.mp4'), index), true);
  });
  test('an unclaimed file is not referenced', () => {
    const index = createTeraBoxRefIndex();
    addTeraBoxRef(index, '111', 'clip.mp4');
    assert.equal(isTeraBoxFileReferenced(file('333', 'other.mp4'), index), false);
    assert.equal(isTeraBoxFileReferenced(file('', ''), index), false);
  });
  test('null file or null index is not referenced', () => {
    const index = createTeraBoxRefIndex();
    addTeraBoxRef(index, '111', 'clip.mp4');
    assert.equal(isTeraBoxFileReferenced(null, index), false);
    assert.equal(isTeraBoxFileReferenced(file('111', 'clip.mp4'), null), false);
    assert.equal(isTeraBoxFileReferenced(null, null), false);
  });
});

describe('classifyTeraBoxFiles', () => {
  test('splits a listing into referenced and extra, duplicates landing in extra', () => {
    const index = createTeraBoxRefIndex();
    addTeraBoxRef(index, '111', 'clip.mp4');
    const { referenced, extra } = classifyTeraBoxFiles([
      file('111', 'clip.mp4'),
      file('222', 'clip.mp4'),
      file('333', 'other.mp4'),
    ], index);
    assert.deepEqual(referenced.map((f) => f.fs_id), ['111']);
    assert.deepEqual(extra.map((f) => f.fs_id), ['222', '333']);
  });
  test('shouldSkip removes a file from both buckets', () => {
    const index = createTeraBoxRefIndex();
    const { referenced, extra } = classifyTeraBoxFiles([
      file('111', 'clip.mp4'),
      file('222', 'scene.spz'),
    ], index, { shouldSkip: (f) => f.server_filename.endsWith('.spz') });
    assert.deepEqual(referenced, []);
    assert.deepEqual(extra.map((f) => f.fs_id), ['111']);
  });
  test('an empty or missing listing yields nothing', () => {
    const index = createTeraBoxRefIndex();
    assert.deepEqual(classifyTeraBoxFiles([], index), { referenced: [], extra: [] });
    assert.deepEqual(classifyTeraBoxFiles(null, index), { referenced: [], extra: [] });
    assert.deepEqual(classifyTeraBoxFiles(undefined, index), { referenced: [], extra: [] });
  });
});

describe('isVaultFolderFile', () => {
  test('the vault folder constant is root', () => {
    assert.equal(TERABOX_VAULT_FOLDER, 'root');
  });
  test('root, slash, empty and missing folders count as vault files', () => {
    assert.equal(isVaultFolderFile({ _folder: 'root' }), true);
    assert.equal(isVaultFolderFile({ _folder: '/' }), true);
    assert.equal(isVaultFolderFile({ _folder: '' }), true);
    assert.equal(isVaultFolderFile({}), true);
    assert.equal(isVaultFolderFile(), true);
    assert.equal(isVaultFolderFile({ _folder: '  root  ' }), true);
  });
  test('any other folder is not a vault file', () => {
    assert.equal(isVaultFolderFile({ _folder: 'gh-mirror' }), false);
    assert.equal(isVaultFolderFile({ _folder: 'videos/2026' }), false);
    assert.equal(isVaultFolderFile({ _folder: 'root2' }), false);
  });
});
