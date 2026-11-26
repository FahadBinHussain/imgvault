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
 *
 * EXCEPT a binding that was never stored at all (null): there is no stored
 * key to be stale, the vault is simply locked. A fresh lock clears the
 * binding, so null must mean "not stale" — otherwise the vault could never
 * open after a lock, because the very first read would throw "stale".
 */
object VaultKeyBinding {

    /** the id of a configuration */
    fun idOf(config: VaultConfig): String = config.passHash.ifBlank { config.salt }

    /**
     * Is the stored key unusable for this configuration?
     *
     * @param storedBinding the binding stored next to the key (null = no key
     *   was ever stored, so nothing is stale)
     * @param currentConfig the configuration the account has right now
     */
    fun isStale(storedBinding: String?, currentConfig: VaultConfig): Boolean {
        val current = idOf(currentConfig)
        if (current.isBlank()) return true
        if (storedBinding == null) return false
        return storedBinding.isBlank() || storedBinding != current
    }
}
