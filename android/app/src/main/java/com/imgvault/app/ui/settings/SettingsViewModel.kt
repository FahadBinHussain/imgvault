package com.imgvault.app.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.imgvault.app.core.ServiceLocator
import com.imgvault.app.core.neon.NeonClient
import com.imgvault.app.core.settings.AppSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * What the Settings screen knows about the secrets.
 *
 * Only the FLAGS ever leave the vault: the app never shows a stored secret
 * back, so the fields start empty and a "set" chip says that a value is
 * already there. The drafts are what the user typed in this session.
 */
data class SecretState(
    val hasNeonUrl: Boolean = false,
    val hasTelegramBotToken: Boolean = false,
    val hasTelegramChannel: Boolean = false,
    val hasImgbbApiKey: Boolean = false,
    val hasPixvidApiKey: Boolean = false,
    val hasTeraboxCookie: Boolean = false,
    val neonUrlDraft: String = "",
    val telegramBotTokenDraft: String = "",
    val telegramChannelDraft: String = "",
    val imgbbApiKeyDraft: String = "",
    val pixvidApiKeyDraft: String = "",
    val teraboxCookieDraft: String = "",
)

/**
 * Settings.
 *
 * The plain preferences live in DataStore and the secrets in the
 * Keystore-backed store — the screen only ever sees the plain ones and the
 * "is it set" flags of the secrets.
 */
class SettingsViewModel : ViewModel() {

    private val repository = ServiceLocator.settings

    val settings: StateFlow<AppSettings> = repository.settings
        .stateIn(viewModelScope, SharingStarted.Eagerly, AppSettings())

    private val _secrets = MutableStateFlow(SecretState())
    val secrets: StateFlow<SecretState> = _secrets.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    /** the endpoint the Neon connection string resolves to — never the string */
    private val _neonEndpoint = MutableStateFlow<String?>(null)
    val neonEndpoint: StateFlow<String?> = _neonEndpoint.asStateFlow()

    init {
        refreshSecretFlags()
    }

    fun setNeonUrlDraft(value: String) = setDraft { it.copy(neonUrlDraft = value) }

    fun setTelegramBotTokenDraft(value: String) = setDraft { it.copy(telegramBotTokenDraft = value) }

    fun setTelegramChannelDraft(value: String) = setDraft { it.copy(telegramChannelDraft = value) }

    fun setImgbbApiKeyDraft(value: String) = setDraft { it.copy(imgbbApiKeyDraft = value) }

    fun setPixvidApiKeyDraft(value: String) = setDraft { it.copy(pixvidApiKeyDraft = value) }

    fun setTeraboxCookieDraft(value: String) = setDraft { it.copy(teraboxCookieDraft = value) }

    fun setDefaultGallerySource(value: String) {
        viewModelScope.launch { repository.setDefaultGallerySource(value) }
    }

    fun setDefaultVideoSource(value: String) {
        viewModelScope.launch { repository.setDefaultVideoSource(value) }
    }

    fun setSortOrder(value: String) {
        viewModelScope.launch { repository.setSortOrder(value) }
    }

    fun setUpdateCheckEnabled(value: Boolean) {
        viewModelScope.launch { repository.setUpdateCheckEnabled(value) }
    }

    /**
     * Persist everything.
     *
     * An empty draft leaves the stored secret alone: the app never shows a
     * secret back, so an empty field means "keep what is stored", not "delete
     * it".
     */
    fun save() {
        viewModelScope.launch {
            _error.value = null
            _message.value = null
            try {
                val drafts = _secrets.value
                withContext(Dispatchers.IO) {
                    if (drafts.neonUrlDraft.isNotBlank()) {
                        repository.neonUrl = drafts.neonUrlDraft.trim()
                    }
                    if (drafts.telegramBotTokenDraft.isNotBlank()) {
                        repository.telegramBotToken = drafts.telegramBotTokenDraft.trim()
                    }
                    if (drafts.telegramChannelDraft.isNotBlank()) {
                        repository.telegramChannel = drafts.telegramChannelDraft.trim()
                    }
                    if (drafts.imgbbApiKeyDraft.isNotBlank()) {
                        repository.imgbbApiKey = drafts.imgbbApiKeyDraft.trim()
                    }
                    if (drafts.pixvidApiKeyDraft.isNotBlank()) {
                        repository.pixvidApiKey = drafts.pixvidApiKeyDraft.trim()
                    }
                    if (drafts.teraboxCookieDraft.isNotBlank()) {
                        repository.teraboxCookie = drafts.teraboxCookieDraft.trim()
                    }
                }
                val current = settings.value
                repository.setDefaultGallerySource(current.defaultGallerySource)
                repository.setDefaultVideoSource(current.defaultVideoSource)
                repository.setSortOrder(current.sortOrder)
                repository.setUpdateCheckEnabled(current.updateCheckEnabled)
                refreshSecretFlags()
                _message.value = "Saved"
            } catch (error: Exception) {
                _error.value = error.message
                    ?: "The settings could not be saved: ${error::class.java.simpleName}"
            }
        }
    }

    /**
     * Show which endpoint the connection string reaches, so the user can see
     * what the app is about to talk to. The connection string itself stays
     * hidden — it carries the database password.
     */
    fun testNeon() {
        viewModelScope.launch {
            val draft = _secrets.value.neonUrlDraft.trim()
            val stored = withContext(Dispatchers.IO) { repository.neonUrl }
            val connection = draft.ifEmpty { stored.orEmpty() }
            if (connection.isBlank()) {
                _neonEndpoint.value = null
                _error.value = "No Neon connection string is configured yet. Paste one first."
                return@launch
            }
            try {
                val endpoint = NeonClient.buildEndpoint(connection)
                _neonEndpoint.value = endpoint
                _error.value = null
            } catch (error: Exception) {
                _neonEndpoint.value = null
                _error.value = "The Neon connection string could not be parsed: " +
                    (error.message ?: error::class.java.simpleName)
            }
        }
    }

    fun clearMessage() {
        _message.value = null
    }

    fun clearError() {
        _error.value = null
    }

    private fun setDraft(update: (SecretState) -> SecretState) {
        _secrets.value = update(_secrets.value)
    }

    /** read the flags from the Keystore-backed store, never the values */
    private fun refreshSecretFlags() {
        viewModelScope.launch {
            val flags = withContext(Dispatchers.IO) {
                SecretState(
                    hasNeonUrl = !repository.neonUrl.isNullOrBlank(),
                    hasTelegramBotToken = !repository.telegramBotToken.isNullOrBlank(),
                    hasTelegramChannel = !repository.telegramChannel.isNullOrBlank(),
                    hasImgbbApiKey = !repository.imgbbApiKey.isNullOrBlank(),
                    hasPixvidApiKey = !repository.pixvidApiKey.isNullOrBlank(),
                    hasTeraboxCookie = !repository.teraboxCookie.isNullOrBlank(),
                )
            }
            _secrets.value = _secrets.value.copy(
                hasNeonUrl = flags.hasNeonUrl,
                hasTelegramBotToken = flags.hasTelegramBotToken,
                hasTelegramChannel = flags.hasTelegramChannel,
                hasImgbbApiKey = flags.hasImgbbApiKey,
                hasPixvidApiKey = flags.hasPixvidApiKey,
                hasTeraboxCookie = flags.hasTeraboxCookie,
            )
        }
    }
}
