// Vercel rejects a function request body over 4.5 MB, so the browser-encrypted
// blob that rides POST /api/vault/move has to stay under it. Shared by the
// route (server-side re-check) and the gallery helper (pre-flight, so the
// upload is not attempted at all).
export const VAULT_MOVE_MAX_CIPHERTEXT_BYTES = 4_500_000
