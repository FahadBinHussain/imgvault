package com.imgvault.app.data.model

import com.imgvault.app.core.neon.asBooleanOrFalse
import com.imgvault.app.core.neon.asJsonListOrEmpty
import com.imgvault.app.core.neon.asJsonObjectOrEmpty
import com.imgvault.app.core.neon.asLongOrNull
import com.imgvault.app.core.neon.asTextOrEmpty
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * One media item, mapped from a `public.media_items` row.
 *
 * The mapping mirrors the extension's `fromNeonMediaRow` (snake_case columns
 * -> camelCase fields, `extra_metadata` spread over the item). The vault
 * fields live INSIDE `extra_metadata`, so they are read from there — the same
 * place the extension reads them from.
 */
data class MediaItem(
    val id: String = "",
    val kind: String = "",
    val isVideo: Boolean = false,
    val isLink: Boolean = false,
    val pageTitle: String = "",
    val description: String = "",
    val tags: List<String> = emptyList(),
    val collectionId: String? = null,
    val internalAddedTimestamp: String = "",
    val sourceImageUrl: String = "",
    val sourcePageUrl: String = "",
    val fileName: String = "",
    val fileSize: Long? = null,
    val width: Int? = null,
    val height: Int? = null,
    val duration: String = "",
    val fileType: String = "",
    val creationDate: String = "",
    val sha256: String = "",
    val pixvidUrl: String = "",
    val imgbbUrl: String = "",
    val imgbbThumbUrl: String = "",
    val filemoonWatchUrl: String = "",
    val filemoonDirectUrl: String = "",
    val udropWatchUrl: String = "",
    val udropDirectUrl: String = "",
    val linkUrl: String = "",
    val linkUrlCanonical: String = "",
    val linkPreviewImageUrl: String = "",
    val faviconUrl: String = "",
    val spzUrl: String = "",
    val deletedAt: String = "",
    val extra: JsonObject = JsonObject(emptyMap()),
) {
    /** the image hosts the item actually has links for */
    val imageHosts: Map<String, HostLink>
        get() {
            val fromExtra = extra["imageHosts"].asJsonObjectOrEmpty()
            val map = linkedMapOf<String, HostLink>()
            map["pixvid"] = HostLink(
                url = pixvidUrl,
                thumbnailUrl = extra["pixvidThumbUrl"].asTextOrEmpty(),
            )
            map["imgbb"] = HostLink(
                url = imgbbUrl,
                thumbnailUrl = imgbbThumbUrl,
            )
            fromExtra.forEach { (key, value) ->
                val link = value.asJsonObjectOrEmpty()
                val existing = map[key]
                map[key] = HostLink(
                    url = link["url"].asTextOrEmpty().ifEmpty { existing?.url.orEmpty() },
                    displayUrl = link["displayUrl"].asTextOrEmpty(),
                    directUrl = link["directUrl"].asTextOrEmpty(),
                    deleteUrl = link["deleteUrl"].asTextOrEmpty(),
                    thumbnailUrl = link["thumbnailUrl"].asTextOrEmpty()
                        .ifEmpty { link["thumbUrl"].asTextOrEmpty() }
                        .ifEmpty { existing?.thumbnailUrl.orEmpty() },
                )
            }
            return map.filterValues { it.hasAnything }
        }

    /** the video hosts the item actually has links for */
    val videoHosts: Map<String, HostLink>
        get() {
            val fromExtra = extra["videoHosts"].asJsonObjectOrEmpty()
            val map = linkedMapOf<String, HostLink>()
            map["filemoon"] = HostLink(
                url = filemoonWatchUrl,
                directUrl = filemoonDirectUrl,
            )
            map["udrop"] = HostLink(
                url = udropWatchUrl,
                directUrl = udropDirectUrl,
            )
            // terabox keeps its links on the item itself, not on a host column
            map["terabox"] = HostLink(
                url = extra["teraboxUrl"].asTextOrEmpty(),
                displayUrl = extra["teraboxWatchUrl"].asTextOrEmpty(),
                directUrl = extra["teraboxDirectUrl"].asTextOrEmpty(),
            )
            fromExtra.forEach { (key, value) ->
                val link = value.asJsonObjectOrEmpty()
                val existing = map[key]
                map[key] = HostLink(
                    // a video host names its page "watchUrl"
                    url = link["url"].asTextOrEmpty()
                        .ifEmpty { link["watchUrl"].asTextOrEmpty() }
                        .ifEmpty { existing?.url.orEmpty() },
                    displayUrl = link["displayUrl"].asTextOrEmpty()
                        .ifEmpty { link["watchUrl"].asTextOrEmpty() },
                    directUrl = link["directUrl"].asTextOrEmpty()
                        .ifEmpty { existing?.directUrl.orEmpty() },
                    deleteUrl = link["deleteUrl"].asTextOrEmpty(),
                    thumbnailUrl = link["thumbnailUrl"].asTextOrEmpty(),
                )
            }
            return map.filterValues { it.hasAnything }
        }

    /**
     * The image to DISPLAY.
     *
     * Playable-first like the extension (2.19.16): the preferred host is
     * tried first, and only when it has no link does the host that actually
     * holds the file answer — with its name, so the UI can say which host is
     * serving the picture instead of silently showing another host's file.
     */
    fun displayImage(preferredProvider: String): HostLink? {
        val links = imageHosts
        if (links.isEmpty()) return null
        val preferred = preferredProvider.trim().lowercase()
        val order = listOf(preferred) + links.keys.filter { it != preferred }
        for (key in order) {
            val link = links[key] ?: continue
            val url = link.url.ifEmpty { link.displayUrl }.ifEmpty { link.directUrl }
            if (url.isNotEmpty()) return link.copy(url = url, sourceKey = key)
        }
        return null
    }

    /**
     * The video to PLAY — a direct file link wins, because a watch page is an
     * html page and the player cannot read it.
     */
    fun displayVideo(preferredProvider: String): HostLink? {
        val links = videoHosts
        if (links.isEmpty()) return null
        val preferred = preferredProvider.trim().lowercase()
        val order = listOf(preferred) + links.keys.filter { it != preferred }
        for (key in order) {
            val link = links[key] ?: continue
            val direct = link.directUrl
            if (direct.isNotEmpty()) return link.copy(url = direct, sourceKey = key)
        }
        for (key in order) {
            val link = links[key] ?: continue
            val url = link.url.ifEmpty { link.displayUrl }
            if (url.isNotEmpty()) return link.copy(url = url, sourceKey = key)
        }
        return null
    }

    /** the thumbnail to show in the grid (falls back to the full image) */
    fun thumbnail(preferredProvider: String): String {
        val links = imageHosts
        val preferred = preferredProvider.trim().lowercase()
        val order = listOf(preferred) + links.keys.filter { it != preferred }
        for (key in order) {
            val link = links[key] ?: continue
            val thumb = link.thumbnailUrl
            if (thumb.isNotEmpty()) return thumb
        }
        return displayImage(preferredProvider)?.url.orEmpty()
    }

    /** a vaulted item keeps its plaintext columns blank and carries encrypted metadata */
    val isVaulted: Boolean
        get() = extra["isVaulted"].asBooleanOrFalse() ||
            extra["encryptedMetadata"].asTextOrEmpty().isNotEmpty()

    val encryptedMetadata: String
        get() = extra["encryptedMetadata"].asTextOrEmpty()

    val encryptedMimeType: String
        get() = extra["encryptedMimeType"].asTextOrEmpty()

    val encryptedFileName: String
        get() = extra["encryptedFileName"].asTextOrEmpty()

    /** the telegram file id of the encrypted blob (telegram-hosted vault rows) */
    val encryptedBlobFileId: String
        get() = extra["encryptedBlobFileId"].asTextOrEmpty()

    val encryptedBlobMessageId: String
        get() = extra["encryptedBlobMessageId"].asTextOrEmpty()

    /** a direct http url of the encrypted blob (terabox-hosted vault rows) */
    val encryptedBlobUrl: String
        get() = extra["encryptedBlobUrl"].asTextOrEmpty()

    val vaultHosts: List<String>
        get() = extra["vaultHosts"].asJsonListOrEmpty()
            .ifEmpty { listOfNotNull(extra["vaultHost"].asTextOrEmpty().takeIf { it.isNotEmpty() }) }

    /** what the card shows as its title */
    val title: String
        get() = pageTitle.ifEmpty { fileName.ifEmpty { sourceImageUrl } }

    /**
     * The shape of the file, the way the grid needs it.
     *
     * The database knows the real width and height, so a panorama gets a wide
     * tile and a portrait a narrow one — the photo is never squashed into a
     * square. A file without a size falls back to a square.
     */
    val aspectRatio: Float
        get() {
            val w = width ?: return DEFAULT_ASPECT_RATIO
            val h = height ?: return DEFAULT_ASPECT_RATIO
            if (w <= 0 || h <= 0) return DEFAULT_ASPECT_RATIO
            return (w.toFloat() / h.toFloat()).coerceIn(MIN_ASPECT_RATIO, MAX_ASPECT_RATIO)
        }

    /** how long the video runs, for the badge on the tile */
    val durationLabel: String
        get() {
            val raw = duration.trim()
            if (raw.isEmpty()) return ""
            val seconds = raw.toLongOrNull()
                ?: raw.toDoubleOrNull()?.toLong()
                ?: return ""
            val minutes = seconds / 60
            val rest = seconds % 60
            return if (minutes > 0) "${minutes}:${rest.toString().padStart(2, '0')}" else "${rest}s"
        }

    /**
     * The poster frame of a video.
     *
     * A video has no image host, but the host that holds it may keep a frame
     * of its own (TeraBox does). The grid shows that frame when it has one.
     */
    val videoThumbnailUrl: String
        get() = videoHosts.values
            .firstNotNullOfOrNull { it.thumbnailUrl.takeIf { url -> url.isNotEmpty() } }

    companion object {
        const val DEFAULT_ASPECT_RATIO = 1f
        const val MIN_ASPECT_RATIO = 0.55f
        const val MAX_ASPECT_RATIO = 2.2f
    }
}

/** one host's link bundle */
data class HostLink(
    val url: String = "",
    val displayUrl: String = "",
    val directUrl: String = "",
    val deleteUrl: String = "",
    val thumbnailUrl: String = "",
    val sourceKey: String = "",
) {
    val hasAnything: Boolean
        get() = url.isNotEmpty() || displayUrl.isNotEmpty() || directUrl.isNotEmpty() ||
            deleteUrl.isNotEmpty() || thumbnailUrl.isNotEmpty()
}

/** map a `public.media_items` row (Neon: text values, column names) to an item */
fun Map<String, JsonElement>.toMediaItem(): MediaItem {
    fun column(name: String): JsonElement? = this[name]

    // `extra_metadata` is a jsonb column: with Neon-Raw-Text-Output it arrives
    // as the JSON TEXT, so it has to be read back into an object — otherwise
    // every vault flag and every host link stays invisible.
    val extra = column("extra_metadata").asJsonObjectOrEmpty()

    return MediaItem(
        id = column("id").asTextOrEmpty(),
        kind = column("kind").asTextOrEmpty(),
        isVideo = column("is_video").asBooleanOrFalse(),
        isLink = column("is_link").asBooleanOrFalse(),
        pageTitle = column("page_title").asTextOrEmpty().ifEmpty { extra["pageTitle"].asTextOrEmpty() },
        description = column("description").asTextOrEmpty().ifEmpty { extra["description"].asTextOrEmpty() },
        // `tags` is a text array: Neon hands it over as text ("[]", "[\"a\"]")
        tags = column("tags").asJsonListOrEmpty(),
        collectionId = column("collection_id").asTextOrEmpty().ifEmpty { null },
        internalAddedTimestamp = column("internal_added_timestamp").asTextOrEmpty(),
        sourceImageUrl = column("source_image_url").asTextOrEmpty(),
        sourcePageUrl = column("source_page_url").asTextOrEmpty(),
        fileName = column("file_name").asTextOrEmpty(),
        fileSize = column("file_size").asLongOrNull(),
        width = column("width").asTextOrEmpty().toIntOrNull(),
        height = column("height").asTextOrEmpty().toIntOrNull(),
        duration = column("duration").asTextOrEmpty(),
        fileType = column("file_type").asTextOrEmpty(),
        creationDate = column("creation_date").asTextOrEmpty(),
        sha256 = column("sha256").asTextOrEmpty(),
        pixvidUrl = column("pixvid_url").asTextOrEmpty().ifEmpty { extra["pixvidUrl"].asTextOrEmpty() },
        imgbbUrl = column("imgbb_url").asTextOrEmpty().ifEmpty { extra["imgbbUrl"].asTextOrEmpty() },
        imgbbThumbUrl = column("imgbb_thumb_url").asTextOrEmpty().ifEmpty { extra["imgbbThumbUrl"].asTextOrEmpty() },
        filemoonWatchUrl = column("filemoon_watch_url").asTextOrEmpty(),
        filemoonDirectUrl = column("filemoon_direct_url").asTextOrEmpty(),
        udropWatchUrl = column("udrop_watch_url").asTextOrEmpty(),
        udropDirectUrl = column("udrop_direct_url").asTextOrEmpty(),
        linkUrl = column("link_url").asTextOrEmpty(),
        linkUrlCanonical = column("link_url_canonical").asTextOrEmpty(),
        linkPreviewImageUrl = column("link_preview_image_url").asTextOrEmpty(),
        faviconUrl = column("favicon_url").asTextOrEmpty(),
        spzUrl = column("spz_url").asTextOrEmpty(),
        deletedAt = column("deleted_at").asTextOrEmpty(),
        extra = extra,
    )
}
