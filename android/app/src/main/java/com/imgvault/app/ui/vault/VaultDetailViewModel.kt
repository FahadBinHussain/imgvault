package com.imgvault.app.ui.vault

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.imgvault.app.core.ServiceLocator
import com.imgvault.app.data.VaultItem
import com.imgvault.app.data.VaultPreview
import javax.crypto.SecretKey
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
    /** the blob URL is being picked — the stream starts after this */
    data object Loading : VaultVideoState

    /** the blob URL and the key that decrypts it — the player streams it */
    data class Ready(val blobUrl: String, val key: SecretKey) : VaultVideoState

    data class Failed(val message: String) : VaultVideoState
}

/**
 * One vault item, full screen.
 *
 * The picture is the preview the app decrypted itself — the encrypted blob
 * lives on the vault host, and that host is not always reachable from a phone.
 *
 * A video is NOT its preview: the preview is only a still. The video itself
 * streams from its host through the decrypting player source — the blob is
 * never downloaded to a file first, so a 700 MB video starts in seconds.
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

    /** a video is not its preview: pick the blob URL and the key, the player streams it */
    private fun loadVideo(item: VaultItem) {
        _video.value = VaultVideoState.Loading
        viewModelScope.launch {
            try {
                val source = withContext(Dispatchers.IO) {
                    repository.resolveVaultVideoSource(item)
                }
                _video.value = VaultVideoState.Ready(source.blobUrl, source.key)
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
