package com.imgvault.app.ui.vault

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.imgvault.app.core.ServiceLocator
import com.imgvault.app.data.VaultItem
import com.imgvault.app.data.VaultPreview
import java.io.File
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

/** what the video of a vault item managed to load */
sealed interface VaultVideoState {
    /** the encrypted blob is downloading and decrypting into a file */
    data object Loading : VaultVideoState

    /** the decrypted video, on disk, ready for the player */
    data class Ready(val file: File) : VaultVideoState

    data class Failed(val message: String) : VaultVideoState
}

/**
 * One vault item, full screen.
 *
 * The picture is the preview the app decrypted itself — the encrypted blob
 * lives on the vault host, and that host is not always reachable from a phone.
 *
 * A video is NOT its preview: the preview is only a still. The video itself
 * is the decrypted blob, downloaded and decrypted into a cache file and
 * played from disk — the blob is never held in memory whole.
 */
class VaultDetailViewModel : ViewModel() {

    private val repository = ServiceLocator.vaultRepository

    private val _state = MutableStateFlow<VaultDetailState>(VaultDetailState.Loading)
    val state: StateFlow<VaultDetailState> = _state.asStateFlow()

    private val _video = MutableStateFlow<VaultVideoState?>(null)
    val video: StateFlow<VaultVideoState?> = _video.asStateFlow()

    private var loadedItemId: String? = null

    fun load(itemId: String) {
        if (itemId.isBlank() || loadedItemId == itemId) return
        loadedItemId = itemId
        viewModelScope.launch {
            _state.value = VaultDetailState.Loading
            _video.value = null
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
                if (item.isVideo) loadVideo(item)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                _state.value = VaultDetailState.Failed(
                    error.message ?: "The vault item could not be read: ${error::class.java.simpleName}",
                )
            }
        }
    }

    /** a video is not its preview: fetch the decrypted blob as a file for the player */
    private fun loadVideo(item: VaultItem) {
        _video.value = VaultVideoState.Loading
        viewModelScope.launch {
            try {
                val file = withContext(Dispatchers.IO) {
                    repository.loadVaultVideoFile(item, ServiceLocator.cacheDir)
                }
                _video.value = VaultVideoState.Ready(file)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                _video.value = VaultVideoState.Failed(
                    error.message ?: "The vault video could not be read: ${error::class.java.simpleName}",
                )
            }
        }
    }
}
