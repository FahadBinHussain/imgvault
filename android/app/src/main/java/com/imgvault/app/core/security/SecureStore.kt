package com.imgvault.app.core.security

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * The app's secret store.
 *
 * Every secret the app holds — the Neon connection string, the host API keys,
 * the Telegram bot token + channel, the TeraBox cookie, the vault master key
 * — lives in an EncryptedSharedPreferences file whose key is held by the
 * Android Keystore. Nothing secret is ever written to the repo, the APK, a
 * log line or the plain preferences.
 *
 * The app ships with ZERO secrets: the user pastes their own in Settings, the
 * same model as the extension's Settings page.
 */
class SecureStore(context: Context) {

    private val appContext = context.applicationContext

    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            appContext,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun get(key: String): String? = prefs.getString(key, null)?.takeIf { it.isNotBlank() }

    fun put(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    fun remove(key: String) {
        prefs.edit().remove(key).apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val FILE_NAME = "imgvault_secrets"

        const val KEY_NEON_URL = "neonDatabaseUrl"
        const val KEY_TELEGRAM_BOT_TOKEN = "telegramBotToken"
        const val KEY_TELEGRAM_CHANNEL = "telegramChannel"
        const val KEY_IMGBB_API_KEY = "imgbbApiKey"
        const val KEY_PIXVID_API_KEY = "pixvidApiKey"
        const val KEY_TERABOX_COOKIE = "teraboxCookie"
        const val KEY_VAULT_MASTER_KEY = "vaultMasterKeyB64"
        const val KEY_VAULT_CONFIG = "vaultConfigJson"
    }
}
