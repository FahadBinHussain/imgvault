package com.imgvault.app.core.crypto

/**
 * Which vault configuration a stored master key belongs to.
 *
 * The master key on the phone is only meaningful together with the config it
 * was unwrapped from: change the account, the database or the vault passcode
 * and the old key decrypts nothing at all — every item then fails with
 * `BAD_DECRYPT`, which says nothing about WHAT went wrong.
 *
 * So the key is stored together with the id of the config it came from. The id
 * is the config's `passHash` — a hash of the passcode, never the passcode
 * itself — and the config's `salt` as the fallback for a legacy config that
 * has no `passHash` yet.
 *
 * A key without a binding (an app from before this existed) counts as STALE:
 * the safe move is to ask for the passcode again, not to guess.
 */
object VaultKeyBinding {

    /** the id of a configuration */
    fun idOf(config: VaultConfig): String = config.passHash.ifBlank { config.salt }

    /**
     * Is the stored key unusable for this configuration?
     *
     * @param storedBinding the binding stored next to the key (null = unknown)
     * @param currentConfig the configuration the account has right now
     */
    fun isStale(storedBinding: String?, currentConfig: VaultConfig): Boolean {
        val current = idOf(currentConfig)
        if (current.isBlank()) return true
        return storedBinding.isNullOrBlank() || storedBinding != current
    }
}
