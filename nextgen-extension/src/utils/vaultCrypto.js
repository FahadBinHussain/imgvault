// canonical implementation lives in imgvault-shared (packages/shared/vaultCrypto.js)
// so the web vault and the extension decrypt/encrypt with the exact same code.
// drift guard: tools/check-shared-twins.mjs — this file must stay re-exports only.
export * from 'imgvault-shared/vaultCrypto.js';
