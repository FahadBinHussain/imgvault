package com.imgvault.app.ui.vault

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.imgvault.app.core.ServiceLocator
import com.imgvault.app.data.VaultItem
import com.imgvault.app.data.VaultLoadResult
import com.imgvault.app.data.VaultPreview
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The vault.
 *
 * The vault stays locked until the passcode unwraps the master key, so the
 * decrypted metadata never sits in memory unlocked. Locking drops the items
 * again — a locked vault must not keep showing what it just decrypted.
 */
class VaultViewModel : ViewModel() {

    private val repository = ServiceLocator.vaultRepository

    private val _locked = MutableStateFlow(true)
    val locked: StateFlow<Boolean> = _locked.asStateFlow()

    private val _items = MutableStateFlow<List<VaultItem>>(emptyList())
    val items: StateFlow<List<VaultItem>> = _items.asStateFlow()

    private val _unlocking = MutableStateFlow(false)
    val unlocking: StateFlow<Boolean> = _unlocking.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    /** the decrypted previews, by item id */
    private val _previews = MutableStateFlow<Map<String, VaultPreview>>(emptyMap())
    val previews: StateFlow<Map<String, VaultPreview>> = _previews.asStateFlow()

    private val pendingPreviews = mutableSetOf<String>()
    private var previewJob: Job? = null

    init {
        load()
    }

    /** read the vault rows when a master key is around (it survives a restart) */
    fun load() {
        viewModelScope.launch {
            val hasKey = try {
                withContext(Dispatchers.IO) { repository.masterKey() } != null
            } catch (error: Exception) {
                _error.value = error.message
                    ?: "The stored vault key could not be read: ${error::class.java.simpleName}"
                false
            }
            if (!hasKey) {
                _locked.value = true
                _items.value = emptyList()
                return@launch
            }
            _error.value = null
            try {
                apply(repository.loadVaultItems())
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                // the vault cannot be read - it goes back to locked so the
                // passcode can be entered again
                _locked.value = true
                _items.value = emptyList()
                _error.value = error.message
                    ?: "The vault could not be read: ${error::class.java.simpleName}"
            }
        }
    }

    /** unwrap the master key with the passcode, then read the rows */
    fun unlock(passcode: String) {
        if (passcode.isBlank()) {
            _error.value = "Enter the vault passcode."
            return
        }
        viewModelScope.launch {
            _unlocking.value = true
            _error.value = null
            try {
                // the key derivation is deliberately slow, so it must not run on
                // the main thread
                withContext(Dispatchers.IO) { repository.unlock(passcode) }
                apply(repository.loadVaultItems())
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                _locked.value = true
                _error.value = error.message
                    ?: "The vault could not be unlocked: ${error::class.java.simpleName}"
            } finally {
                _unlocking.value = false
            }
        }
    }

    /** drop the master key and everything that was decrypted with it */
    fun lock() {
        try {
            repository.lock()
        } catch (error: Exception) {
            _error.value = error.message
                ?: "The vault could not be locked: ${error::class.java.simpleName}"
        }
        _items.value = emptyList()
        _previews.value = emptyMap()
        _locked.value = true
    }

    /**
     * Ask for the preview of an item.
     *
     * The grid asks for every tile it draws, so the asks are collected into
     * one query per batch: a scroll reads a page of pictures instead of one
     * request per tile.
     */
    fun requestPreview(itemId: String) {
        if (_previews.value.containsKey(itemId)) return
        synchronized(pendingPreviews) { pendingPreviews += itemId }
        if (previewJob?.isActive == true) return
        previewJob = viewModelScope.launch {
            while (true) {
                // let the tiles that are on screen ask first
                delay(PREVIEW_BATCH_DELAY_MS)
                val batch = synchronized(pendingPreviews) {
                    pendingPreviews.toList().also { pendingPreviews.clear() }
                }
                if (batch.isEmpty()) break
                val loaded = try {
                    withContext(Dispatchers.IO) { repository.loadPreviews(batch) }
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    // one batch that cannot be read must not kill the rest
                    batch.associateWith {
                        VaultPreview.Failed(
                            error.message ?: "The preview could not be read.",
                        )
                    }
                }
                _previews.value = _previews.value + loaded
            }
        }
    }

    /** show what was loaded and say how many items could not be read */
    private fun apply(result: VaultLoadResult) {
        _items.value = result.items
        _locked.value = false
        _error.value = unreadableMessage(result.failed, result.total)
    }

    /**
     * What to say about the items that could not be read.
     *
     * Nothing is hidden here: an item that was encrypted with a different vault
     * key stays visible and says so.
     */
    private fun unreadableMessage(failed: Int, total: Int): String? {
        if (failed <= 0) return null
        return "$failed of $total vault items could not be decrypted with this vault key. " +
            "They were encrypted with a different key - open them in the extension."
    }

    private companion object {
        /** how long a tile waits before its batch is fetched */
        const val PREVIEW_BATCH_DELAY_MS = 80L
    }
}
