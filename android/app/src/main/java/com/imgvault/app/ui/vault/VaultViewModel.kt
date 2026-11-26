package com.imgvault.app.ui.vault

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.imgvault.app.core.ServiceLocator
import com.imgvault.app.data.VaultItem
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
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
                _items.value = repository.loadVaultItems()
                _locked.value = false
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
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
                _items.value = repository.loadVaultItems()
                _locked.value = false
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
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
        _locked.value = true
    }
}
