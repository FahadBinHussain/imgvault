// node:test suite for packages/shared/vaultCrypto.js — the WebCrypto vault.
// Node 24 ships global crypto.subtle, Blob, TextEncoder and btoa/atob, so
// the whole module runs here with no mocks. Fake passcodes only.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VAULT_HEADER_SIZE,
  VAULT_IV_SIZE,
  VAULT_TAG_SIZE,
  createVaultConfig,
  decryptBlob,
  decryptEncryptedChunk,
  decryptMetadata,
  decryptPreviewBytes,
  encryptBlob,
  encryptMetadata,
  encryptPreviewBytes,
  generateOpaqueName,
  getVaultChunkLayout,
  hashVaultPasscode,
  parseVaultBlobHeader,
  rewrapMasterKey,
  unwrapMasterKey,
  vaultCrypto,
} from '../../packages/shared/vaultCrypto.js';

const PASS = 'correct horse battery staple (test only)';
const OTHER_PASS = 'a completely different test passcode';

async function makeKey(passcode = PASS) {
  const config = await createVaultConfig(passcode);
  const key = await unwrapMasterKey(config, passcode);
  return { config, key };
}

describe('hashVaultPasscode', () => {
  test('is deterministic for the same salt + passcode', async () => {
    const a = await hashVaultPasscode(PASS, 'deadbeef');
    const b = await hashVaultPasscode(PASS, 'deadbeef');
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });
  test('changes with the salt and with the passcode', async () => {
    const base = await hashVaultPasscode(PASS, 'salt-one');
    assert.notEqual(await hashVaultPasscode(PASS, 'salt-two'), base);
    assert.notEqual(await hashVaultPasscode(OTHER_PASS, 'salt-one'), base);
  });
});

describe('createVaultConfig / unwrapMasterKey', () => {
  test('creates a version-2 config with the expected shape', async () => {
    const config = await createVaultConfig(PASS);
    assert.match(config.salt, /^[0-9a-f]{32}$/);
    assert.match(config.passHash, /^[0-9a-f]{64}$/);
    assert.match(config.kdfSalt, /^[0-9a-f]{32}$/);
    assert.equal(config.kdfIterations, 100000);
    assert.equal(typeof config.wrappedMasterKey, 'string');
    assert.ok(config.wrappedMasterKey.length > 0);
    assert.equal(config.vaultVersion, 2);
  });
  test('two configs differ (random salts + random master key)', async () => {
    const a = await createVaultConfig(PASS);
    const b = await createVaultConfig(PASS);
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.wrappedMasterKey, b.wrappedMasterKey);
  });
  test('the passcode unwraps the master key', async () => {
    const config = await createVaultConfig(PASS);
    const key = await unwrapMasterKey(config, PASS);
    assert.equal(key.type, 'secret');
    assert.equal(key.algorithm.name, 'AES-GCM');
  });
  test('a wrong passcode fails to unwrap', async () => {
    const config = await createVaultConfig(PASS);
    await assert.rejects(() => unwrapMasterKey(config, OTHER_PASS));
  });
  test('a legacy config (no wrapped key) fails loudly, naming the fix', async () => {
    await assert.rejects(
      () => unwrapMasterKey({ salt: 'aa', passHash: 'bb' }, PASS),
      /legacy vault — re-save the passcode/,
    );
    await assert.rejects(() => unwrapMasterKey(null, PASS), /legacy vault/);
  });
});

describe('rewrapMasterKey', () => {
  test('re-wraps under a new passcode; old passcode stops working', async () => {
    const config = await createVaultConfig(PASS);
    const next = await rewrapMasterKey(config, PASS, OTHER_PASS);
    assert.notEqual(next.salt, config.salt);
    assert.notEqual(next.kdfSalt, config.kdfSalt);
    assert.equal(next.vaultVersion, 2);
    await unwrapMasterKey(next, OTHER_PASS);
    await assert.rejects(() => unwrapMasterKey(next, PASS));
  });
  test('the master key survives the re-wrap (blobs are never re-encrypted)', async () => {
    const config = await createVaultConfig(PASS);
    const oldKey = await unwrapMasterKey(config, PASS);
    const next = await rewrapMasterKey(config, PASS, OTHER_PASS);
    const newKey = await unwrapMasterKey(next, OTHER_PASS);
    const cipher = await encryptMetadata(oldKey, { hello: 'world' });
    assert.deepEqual(await decryptMetadata(newKey, cipher), { hello: 'world' });
  });
  test('re-wrap with a wrong old passcode fails', async () => {
    const config = await createVaultConfig(PASS);
    await assert.rejects(() => rewrapMasterKey(config, OTHER_PASS, 'new-pass'));
  });
});

describe('encryptMetadata / decryptMetadata', () => {
  test('round-trips JSON, including unicode and nesting', async () => {
    const { key } = await makeKey();
    const payload = { fileName: 'clip — ünïcödé.mp4', nested: { a: [1, 2, 3] }, n: null };
    const cipher = await encryptMetadata(key, payload);
    assert.equal(typeof cipher, 'string');
    assert.deepEqual(await decryptMetadata(key, cipher), payload);
  });
  test('the same payload encrypts differently each time (random IV)', async () => {
    const { key } = await makeKey();
    const a = await encryptMetadata(key, { x: 1 });
    const b = await encryptMetadata(key, { x: 1 });
    assert.notEqual(a, b);
  });
  test('decrypting with the wrong key fails', async () => {
    const { key } = await makeKey();
    const { key: otherKey } = await makeKey(OTHER_PASS);
    const cipher = await encryptMetadata(key, { x: 1 });
    await assert.rejects(() => decryptMetadata(otherKey, cipher));
  });
  test('tampered ciphertext fails', async () => {
    const { key } = await makeKey();
    const cipher = await encryptMetadata(key, { x: 1 });
    const tampered = cipher.slice(0, -4) + 'AAAA';
    await assert.rejects(() => decryptMetadata(key, tampered));
  });
});

describe('encryptPreviewBytes / decryptPreviewBytes', () => {
  test('round-trips raw bytes', async () => {
    const { key } = await makeKey();
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const cipher = await encryptPreviewBytes(key, bytes);
    assert.deepEqual(await decryptPreviewBytes(key, cipher), bytes);
  });
});

describe('encryptBlob / decryptBlob (chunked IVG1 format)', () => {
  test('round-trips a small blob', async () => {
    const { key } = await makeKey();
    const plain = new TextEncoder().encode('hello vault, this is a test blob');
    const cipher = await encryptBlob(key, new Blob([plain]));
    assert.equal(cipher.type, 'application/octet-stream');
    const back = await decryptBlob(key, cipher, 'text/plain');
    assert.equal(back.type, 'text/plain');
    assert.deepEqual(new Uint8Array(await back.arrayBuffer()), plain);
  });
  test('the encrypted blob starts with the IVG1 magic + header', async () => {
    const { key } = await makeKey();
    const cipher = await encryptBlob(key, new Blob([new Uint8Array([1, 2, 3])]));
    const head = new Uint8Array(await cipher.slice(0, 16).arrayBuffer());
    assert.equal(new TextDecoder().decode(head.slice(0, 4)), 'IVG1');
    assert.deepEqual(parseVaultBlobHeader(head), { total: 3, chunkSize: 8 * 1024 * 1024 });
  });
  test('an empty blob round-trips to an empty blob', async () => {
    const { key } = await makeKey();
    const cipher = await encryptBlob(key, new Blob([]));
    const back = await decryptBlob(key, cipher);
    assert.equal(back.size, 0);
  });
  test('a multi-chunk blob (> 8 MiB) round-trips', async () => {
    const { key } = await makeKey();
    const plain = new Uint8Array(9 * 1024 * 1024);
    for (let i = 0; i < plain.length; i += 997) plain[i] = i % 251;
    const cipher = await encryptBlob(key, new Blob([plain]));
    const back = await decryptBlob(key, cipher);
    assert.deepEqual(new Uint8Array(await back.arrayBuffer()), plain);
  });
  test('progress callbacks report encrypt then decrypt stages', async () => {
    const { key } = await makeKey();
    const stages = [];
    const cipher = await encryptBlob(key, new Blob([new Uint8Array(100)]), (p) => stages.push(p));
    assert.equal(stages.length, 1);
    assert.equal(stages[0].stage, 'encrypt');
    assert.equal(stages[0].loaded, 100);
    assert.equal(stages[0].total, 100);
    assert.equal(stages[0].percent, 100);
    const decryptStages = [];
    await decryptBlob(key, cipher, 'application/octet-stream', (p) => decryptStages.push(p));
    assert.equal(decryptStages[0].stage, 'decrypt');
    assert.equal(decryptStages[0].percent, 100);
  });
  test('decrypting with the wrong key fails', async () => {
    const { key } = await makeKey();
    const { key: otherKey } = await makeKey(OTHER_PASS);
    const cipher = await encryptBlob(key, new Blob([new Uint8Array([1, 2, 3])]));
    await assert.rejects(() => decryptBlob(otherKey, cipher));
  });
  test('the legacy single-shot format (iv || ciphertext, no magic) still decrypts', async () => {
    const { key } = await makeKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode('legacy blob');
    const cipherText = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
    const legacy = new Uint8Array(12 + cipherText.byteLength);
    legacy.set(iv, 0);
    legacy.set(new Uint8Array(cipherText), 12);
    const back = await decryptBlob(key, new Blob([legacy]), 'text/plain');
    assert.equal(await back.text(), 'legacy blob');
  });
});

describe('parseVaultBlobHeader / getVaultChunkLayout', () => {
  test('header constants are 16 / 12 / 16', () => {
    assert.equal(VAULT_HEADER_SIZE, 16);
    assert.equal(VAULT_IV_SIZE, 12);
    assert.equal(VAULT_TAG_SIZE, 16);
  });
  test('a non-IVG1 header parses to null', () => {
    assert.equal(parseVaultBlobHeader(new Uint8Array(16)), null);
    assert.equal(parseVaultBlobHeader(new TextEncoder().encode('NOPE' + '\0'.repeat(12))), null);
  });
  test('layout math for a 20 MiB blob in 8 MiB chunks', () => {
    const layout = getVaultChunkLayout(20 * 1024 * 1024, 8 * 1024 * 1024);
    assert.equal(layout.chunkCount, 3);
    assert.equal(layout.encryptedSize, 16 + 2 * (12 + 8 * 1024 * 1024 + 16) + (12 + 4 * 1024 * 1024 + 16));
    assert.equal(layout.encryptedChunkOffset(0), 16);
    assert.equal(layout.encryptedChunkOffset(1), 16 + (12 + 8 * 1024 * 1024 + 16));
    assert.equal(layout.encryptedChunkLength(0), 12 + 8 * 1024 * 1024 + 16);
    assert.equal(layout.encryptedChunkLength(2), 12 + 4 * 1024 * 1024 + 16);
    assert.equal(layout.plainChunkStart(2), 16 * 1024 * 1024);
    assert.equal(layout.plainChunkLength(2), 4 * 1024 * 1024);
  });
  test('an empty blob still has one chunk', () => {
    const layout = getVaultChunkLayout(0, 8 * 1024 * 1024);
    assert.equal(layout.chunkCount, 1);
    assert.equal(layout.encryptedSize, 16 + 12 + 0 + 16);
  });
  test('the layout matches what encryptBlob actually produces', async () => {
    const { key } = await makeKey();
    const total = 1000;
    const cipher = await encryptBlob(key, new Blob([new Uint8Array(total)]));
    const layout = getVaultChunkLayout(total, 8 * 1024 * 1024);
    assert.equal(cipher.size, layout.encryptedSize);
  });
});

describe('decryptEncryptedChunk', () => {
  test('decrypts a single iv || ciphertext chunk', async () => {
    const { key } = await makeKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode('one chunk');
    const cipherText = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
    const chunk = new Uint8Array(12 + cipherText.byteLength);
    chunk.set(iv, 0);
    chunk.set(new Uint8Array(cipherText), 12);
    assert.deepEqual(await decryptEncryptedChunk(key, chunk), plain);
  });
  test('decrypts a chunk sliced out of a real encrypted blob (random access)', async () => {
    const { key } = await makeKey();
    const plain = new Uint8Array(1000);
    for (let i = 0; i < plain.length; i += 1) plain[i] = i % 256;
    const cipher = await encryptBlob(key, new Blob([plain]));
    const bytes = new Uint8Array(await cipher.arrayBuffer());
    const layout = getVaultChunkLayout(plain.length, 8 * 1024 * 1024);
    const chunk = bytes.slice(
      layout.encryptedChunkOffset(0),
      layout.encryptedChunkOffset(0) + layout.encryptedChunkLength(0),
    );
    assert.deepEqual(await decryptEncryptedChunk(key, chunk), plain);
  });
});

describe('generateOpaqueName', () => {
  test('yields a unique 32-hex .bin name', () => {
    const a = generateOpaqueName();
    const b = generateOpaqueName();
    assert.match(a, /^[0-9a-f]{32}\.bin$/);
    assert.notEqual(a, b);
  });
});

describe('vaultCrypto namespace object', () => {
  test('exposes the public functions', () => {
    for (const name of [
      'createVaultConfig', 'unwrapMasterKey', 'rewrapMasterKey',
      'encryptBlob', 'decryptBlob', 'decryptEncryptedChunk',
      'parseVaultBlobHeader', 'getVaultChunkLayout',
      'encryptMetadata', 'decryptMetadata',
      'hashVaultPasscode', 'generateOpaqueName',
    ]) {
      assert.equal(typeof vaultCrypto[name], 'function', name);
    }
  });
});
