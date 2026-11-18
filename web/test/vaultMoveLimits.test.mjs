// The web-move ciphertext cap: Vercel rejects function request bodies over
// 4.5 MB, so the browser-encrypted blob riding POST /api/vault/move must
// stay under it. Shared by the route (server-side re-check) and the gallery
// helper (pre-flight).
import test from 'node:test'
import assert from 'node:assert/strict'

import { VAULT_MOVE_MAX_CIPHERTEXT_BYTES } from '../src/lib/vaultMoveLimits.js'

test('vault move cap is exactly 4,500,000 bytes', () => {
  assert.equal(VAULT_MOVE_MAX_CIPHERTEXT_BYTES, 4_500_000)
})

test('vault move cap is a whole positive number of bytes', () => {
  assert.equal(typeof VAULT_MOVE_MAX_CIPHERTEXT_BYTES, 'number')
  assert.ok(Number.isInteger(VAULT_MOVE_MAX_CIPHERTEXT_BYTES))
  assert.ok(VAULT_MOVE_MAX_CIPHERTEXT_BYTES > 0)
})

test('vault move cap sits under the 4.5 MB Vercel body limit it guards', () => {
  // The cap IS the 4.5 MB limit expressed in bytes (4.5 * 1,000,000), not
  // 4.5 MiB — a MiB reading would let a 4,718,592-byte body through and the
  // server would reject it.
  assert.equal(VAULT_MOVE_MAX_CIPHERTEXT_BYTES, 4.5 * 1_000_000)
  assert.ok(VAULT_MOVE_MAX_CIPHERTEXT_BYTES < 4.5 * 1024 * 1024)
})
