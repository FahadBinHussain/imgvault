/**
 * @fileoverview In-memory vault master-key session for the SPA.
 *
 * The unwrapped master key (CryptoKey) lives here while the vault is unlocked.
 * It is never persisted — not to chrome.storage, not to the DB, not to disk.
 * Holds it for the lifetime of the page; lock clears it.
 *
 * The raw key bytes are exposed via getRawKeyBytes() for operations that must
 * run in the service worker (encrypt-on-upload / decrypt-on-restore), where a
 * CryptoKey object cannot be transferred. The bytes are the same value the
 * page already holds, so exposing them to the SW adds no new exposure.
 */

let masterKey = null; // CryptoKey (AES-GCM 256)

export function setVaultMasterKey(key) {
  masterKey = key;
}

export function getVaultMasterKey() {
  return masterKey;
}

export function hasVaultMasterKey() {
  return Boolean(masterKey);
}

export async function getRawKeyBytes() {
  if (!masterKey) return null;
  try {
    const bytes = await crypto.subtle.exportKey('raw', masterKey);
    return new Uint8Array(bytes);
  } catch (_) {
    return null;
  }
}

export function clearVaultMasterKey() {
  masterKey = null;
}

/**
 * Import a base64-encoded raw key and set it as the page-side master key.
 * Reverses exportKey('raw') → btoa(String.fromCharCode(...)).
 */
export async function importMasterKeyFromB64(b64) {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  masterKey = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  return masterKey;
}
