package com.imgvault.app.ui.vault

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.imgvault.app.core.ServiceLocator
import com.imgvault.app.data.VaultItem
import com.imgvault.app.data.VaultPreview
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** what the vault detail screen managed to load */
sealed interface VaultDetailState {
    data object Loading : VaultDetailState

    /** the row is gone — deleted, or never existed under this id */
    data object Missing : VaultDetailState

    data class Ready(val item: VaultItem, val preview: VaultPreview?) : VaultDetailState

    data class Failed(val message: String) : VaultDetailState
}

/**
 * One vault item, full screen.
 *
 * The picture is the preview the app decrypted itself — the encrypted blob
 * lives on the vault host, and that host is not always reachable from a phone.
 */
class VaultDetailViewModel : ViewModel() {

    private val repository = ServiceLocator.vaultRepository

    private val _state = MutableStateFlow<VaultDetailState>(VaultDetailState.Loading)
    val state: StateFlow<VaultDetailState> = _state.asStateFlow()

    private var loadedItemId: String? = null

    fun load(itemId: String) {
        if (itemId.isBlank() || loadedItemId == itemId) return
        loadedItemId = itemId
        viewModelScope.launch {
            _state.value = VaultDetailState.Loading
            try {
                val result = withContext(Dispatchers.IO) { repository.loadVaultItems() }
                val item = result.items.firstOrNull { it.id == itemId }
                if (item == null) {
                    _state.value = VaultDetailState.Missing
                    return@launch
                }
                val preview = withContext(Dispatchers.IO) {
                    repository.loadPreviews(listOf(itemId))[itemId]
                }
                _state.value = VaultDetailState.Ready(item, preview)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                _state.value = VaultDetailState.Failed(
                    error.message ?: "The vault item could not be read: ${error::class.java.simpleName}",
                )
            }
        }
    }
}
