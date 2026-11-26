package com.imgvault.app.core.crypto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The master key on the phone is bound to the vault configuration it was
 * unwrapped from. Without that binding a key from another account, another
 * database or an older passcode silently decrypts nothing — every item then
 * fails with `BAD_DECRYPT`, which says nothing about what is really wrong.
 */
class VaultKeyBindingTest {

    private val config = VaultConfig(
        salt = "000102030405060708090a0b0c0d0e0f",
        passHash = "2b2da9c773503e4dffcc2fe5d581100dbdeb2164d8cec01a1ba428ee800bc6d1",
        kdfSalt = "101112131415161718191a1b1c1d1e1f",
        kdfIterations = VaultCrypto.KDF_ITERATIONS,
        wrappedMasterKey = "qrvM3e7/ABEiM0RVhnr21EcmfDJXc/hlitVr62D3Gfvp/hkBtbHp369SojNPj7/nZ2mQbRs6RRqnp9v3",
    )

    @Test
    fun `the binding is the config passHash`() {
        assertEquals(config.passHash, VaultKeyBinding.idOf(config))
    }

    @Test
    fun `a legacy config without a passHash is bound by its salt`() {
        val legacy = config.copy(passHash = "")
        assertEquals(legacy.salt, VaultKeyBinding.idOf(legacy))
    }

    @Test
    fun `a key from the same configuration is not stale`() {
        assertFalse(VaultKeyBinding.isStale(config.passHash, config))
    }

    @Test
    fun `a key from another configuration is stale`() {
        val other = config.copy(passHash = "f".repeat(64))
        assertTrue(VaultKeyBinding.isStale(other.passHash, config))
    }

    @Test
    fun `no stored binding means no stored key, so nothing is stale`() {
        // a fresh lock clears the binding: there is no key to be stale, the
        // vault is simply locked and the passcode is asked for
        assertFalse(VaultKeyBinding.isStale(null, config))
    }

    @Test
    fun `a key with an empty binding is stale - the passcode is asked again`() {
        assertTrue(VaultKeyBinding.isStale("", config))
    }

    @Test
    fun `a config without any id cannot be matched`() {
        val empty = config.copy(passHash = "", salt = "")
        assertTrue(VaultKeyBinding.isStale("anything", empty))
    }
}
