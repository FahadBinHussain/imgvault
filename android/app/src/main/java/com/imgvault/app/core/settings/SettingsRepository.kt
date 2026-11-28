package com.imgvault.app.core.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.imgvault.app.core.security.SecureStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "imgvault_settings",
)

/** the non-secret settings */
data class AppSettings(
    val defaultGallerySource: String = DEFAULT_GALLERY_SOURCE,
    val defaultVideoSource: String = DEFAULT_VIDEO_SOURCE,
    val sortOrder: String = SORT_NEWEST,
    val updateCheckEnabled: Boolean = true,
) {
    companion object {
        const val DEFAULT_GALLERY_SOURCE = "imgbb"
        const val DEFAULT_VIDEO_SOURCE = "filemoon"
        const val SORT_NEWEST = "newest"
        const val SORT_OLDEST = "oldest"
        const val SORT_TITLE = "title"

        val SORT_ORDERS = listOf(SORT_NEWEST, SORT_OLDEST, SORT_TITLE)
    }
}

/**
 * Settings: the plain ones in DataStore, the secrets in the Keystore-backed
 * [SecureStore].
 *
 * Nothing here is ever a fallback for a missing value — a missing Neon URL
 * means "not configured yet", and the UI says so instead of pretending.
 */
class SettingsRepository(
    private val context: Context,
    private val secureStore: SecureStore,
) {
    val settings: Flow<AppSettings> = context.settingsDataStore.data.map { prefs ->
        AppSettings(
            defaultGallerySource = prefs[KEY_GALLERY_SOURCE] ?: AppSettings.DEFAULT_GALLERY_SOURCE,
            defaultVideoSource = prefs[KEY_VIDEO_SOURCE] ?: AppSettings.DEFAULT_VIDEO_SOURCE,
            sortOrder = prefs[KEY_SORT_ORDER] ?: AppSettings.SORT_NEWEST,
            updateCheckEnabled = (prefs[KEY_UPDATE_CHECK] ?: "true").toBoolean(),
        )
    }

    suspend fun setDefaultGallerySource(value: String) {
        context.settingsDataStore.edit { it[KEY_GALLERY_SOURCE] = value }
    }

    suspend fun setDefaultVideoSource(value: String) {
        context.settingsDataStore.edit { it[KEY_VIDEO_SOURCE] = value }
    }

    suspend fun setSortOrder(value: String) {
        context.settingsDataStore.edit { it[KEY_SORT_ORDER] = value }
    }

    suspend fun setUpdateCheckEnabled(value: Boolean) {
        context.settingsDataStore.edit { it[KEY_UPDATE_CHECK] = value.toString() }
    }

    /** the current settings, read once (a suspend read of the DataStore) */
    suspend fun current(): AppSettings = settings.first()

    // --- secrets -----------------------------------------------------------

    var neonUrl: String?
        get() = secureStore.get(SecureStore.KEY_NEON_URL)
        set(value) = store(SecureStore.KEY_NEON_URL, value)

    var telegramBotToken: String?
        get() = secureStore.get(SecureStore.KEY_TELEGRAM_BOT_TOKEN)
        set(value) = store(SecureStore.KEY_TELEGRAM_BOT_TOKEN, value)

    var telegramChannel: String?
        get() = secureStore.get(SecureStore.KEY_TELEGRAM_CHANNEL)
        set(value) = store(SecureStore.KEY_TELEGRAM_CHANNEL, value)

    var imgbbApiKey: String?
        get() = secureStore.get(SecureStore.KEY_IMGBB_API_KEY)
        set(value) = store(SecureStore.KEY_IMGBB_API_KEY, value)

    var pixvidApiKey: String?
        get() = secureStore.get(SecureStore.KEY_PIXVID_API_KEY)
        set(value) = store(SecureStore.KEY_PIXVID_API_KEY, value)

    var teraboxCookie: String?
        get() = secureStore.get(SecureStore.KEY_TERABOX_COOKIE)
        set(value) = store(SecureStore.KEY_TERABOX_COOKIE, value)

    /**
     * The jsToken captured from the TeraBox WebView login (1.0.15). The
     * WebView keeps it fresh; TeraBoxClient prefers it over the plain-HTTP
     * scrape, which returns the logged-out landing page on this phone's
     * network. The plain-HTTP scrape stays as the fallback.
     */
    var teraboxJsToken: String?
        get() = secureStore.get(SecureStore.KEY_TERABOX_JS_TOKEN)
        set(value) = store(SecureStore.KEY_TERABOX_JS_TOKEN, value)

    /** millis when [teraboxJsToken] was captured */
    var teraboxJsTokenAtMs: Long
        get() = secureStore.get(SecureStore.KEY_TERABOX_JS_TOKEN_AT)?.toLongOrNull() ?: 0L
        set(value) = store(SecureStore.KEY_TERABOX_JS_TOKEN_AT, value.toString())

    /** the vault master key, kept in the Keystore-backed store while unlocked */
    var vaultMasterKeyB64: String?
        get() = secureStore.get(SecureStore.KEY_VAULT_MASTER_KEY)
        set(value) = store(SecureStore.KEY_VAULT_MASTER_KEY, value)

    /** the stored vault config (salt, kdfSalt, wrapped master key) */
    var vaultConfigJson: String?
        get() = secureStore.get(SecureStore.KEY_VAULT_CONFIG)
        set(value) = store(SecureStore.KEY_VAULT_CONFIG, value)

    /**
     * WHICH vault configuration the stored master key belongs to.
     *
     * The master key on the phone is only meaningful together with the config
     * it was unwrapped from: change the account, the database or the vault
     * passcode and the old key decrypts nothing. The binding is the config's
     * `passHash` (a hash of the passcode, not the passcode), so a mismatch can
     * be detected WITHOUT ever touching the secret itself.
     */
    var vaultKeyBinding: String?
        get() = secureStore.get(SecureStore.KEY_VAULT_KEY_BINDING)
        set(value) = store(SecureStore.KEY_VAULT_KEY_BINDING, value)

    private fun store(key: String, value: String?) {
        if (value.isNullOrBlank()) {
            secureStore.remove(key)
        } else {
            secureStore.put(key, value)
        }
    }

    private companion object {
        val KEY_GALLERY_SOURCE = stringPreferencesKey("defaultGallerySource")
        val KEY_VIDEO_SOURCE = stringPreferencesKey("defaultVideoSource")
        val KEY_SORT_ORDER = stringPreferencesKey("sortOrder")
        val KEY_UPDATE_CHECK = stringPreferencesKey("updateCheckEnabled")
    }
}
