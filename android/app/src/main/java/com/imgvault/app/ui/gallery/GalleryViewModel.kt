package com.imgvault.app.ui.gallery

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.imgvault.app.core.ServiceLocator
import com.imgvault.app.core.settings.AppSettings
import com.imgvault.app.data.model.MediaItem
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * The gallery feed.
 *
 * The whole feed is pulled once and kept in memory: search and sort run on the
 * phone so typing is instant and no query ever leaves the device again. A
 * failed load always names what failed — a silent empty grid would look like
 * "no media exists" and hide a broken database link.
 */
class GalleryViewModel : ViewModel() {

    private val galleryRepository = ServiceLocator.galleryRepository
    private val settingsRepository = ServiceLocator.settings

    /** everything the database handed over, unfiltered and unsorted */
    private val _loaded = MutableStateFlow<List<MediaItem>>(emptyList())

    /** what the grid shows: the loaded items after search and sort */
    private val _items = MutableStateFlow<List<MediaItem>>(emptyList())
    val items: StateFlow<List<MediaItem>> = _items.asStateFlow()

    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query.asStateFlow()

    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    /** the host the grid asks first — the user's own default from Settings */
    private val _provider = MutableStateFlow(AppSettings.DEFAULT_GALLERY_SOURCE)
    val provider: StateFlow<String> = _provider.asStateFlow()

    private val _sortOrder = MutableStateFlow(AppSettings.SORT_NEWEST)
    val sortOrder: StateFlow<String> = _sortOrder.asStateFlow()

    init {
        viewModelScope.launch {
            // the stored preference decides the order AND the host the grid asks
            // first, so a change in Settings re-sorts the open screen without a
            // second network round trip
            val stored = settingsRepository.settings.first()
            applySettings(stored)
            settingsRepository.settings.drop(1).collect { applySettings(it) }
        }
        refresh()
    }

    /** pull the feed again — a failure lands in [error], never in a blank grid */
    fun refresh() {
        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            try {
                _loaded.value = galleryRepository.loadGallery()
                recompute()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                _error.value = error.message
                    ?: "The gallery could not be loaded: ${error::class.java.simpleName}"
            } finally {
                _loading.value = false
            }
        }
    }

    /** search the items already in memory — no extra database round trip */
    fun setQuery(text: String) {
        _query.value = text
        recompute()
    }

    /** change the order and remember it, so the next launch starts the same way */
    fun setSortOrder(order: String) {
        viewModelScope.launch {
            settingsRepository.setSortOrder(order)
            _sortOrder.value = order
            recompute()
        }
    }

    private fun applySettings(settings: AppSettings) {
        _sortOrder.value = settings.sortOrder
        _provider.value = settings.defaultGallerySource
        recompute()
    }

    private fun recompute() {
        val needle = _query.value.trim().lowercase()
        val matching = if (needle.isEmpty()) {
            _loaded.value
        } else {
            _loaded.value.filter { it.matches(needle) }
        }
        _items.value = sortItems(matching, _sortOrder.value)
    }

    private fun sortItems(list: List<MediaItem>, order: String): List<MediaItem> = when (order) {
        AppSettings.SORT_OLDEST -> list.sortedBy { it.sortKey() }
        AppSettings.SORT_TITLE -> list.sortedBy { it.title.lowercase() }
        else -> list.sortedByDescending { it.sortKey() }
    }

    /**
     * The timestamps are ISO-8601 text, so a plain string compare is the
     * chronological order — no date parsing, no timezone surprises.
     */
    private fun MediaItem.sortKey(): String =
        internalAddedTimestamp.ifEmpty { creationDate }

    private fun MediaItem.matches(needle: String): Boolean =
        title.lowercase().contains(needle) ||
            description.lowercase().contains(needle) ||
            fileName.lowercase().contains(needle) ||
            tags.any { it.lowercase().contains(needle) }
}
