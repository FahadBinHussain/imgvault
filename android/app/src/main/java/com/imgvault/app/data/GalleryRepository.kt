package com.imgvault.app.data

import com.imgvault.app.core.neon.NeonClient
import com.imgvault.app.core.settings.SettingsRepository
import com.imgvault.app.data.model.MediaItem
import com.imgvault.app.data.model.toMediaItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.OkHttpClient

/** something in the data layer failed — the message names what and why */
class ImgVaultException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * The gallery feed.
 *
 * The rows come straight from `public.media_items` over Neon's SQL-over-HTTP
 * API (the same query the extension runs), and the search / sort / filter
 * happen on the phone so the feed is instant.
 */
class GalleryRepository(
    private val settings: SettingsRepository,
    private val http: OkHttpClient,
) {
    private fun client(): NeonClient {
        val connectionString = settings.neonUrl
            ?: throw ImgVaultException(
                "No Neon database is configured yet. Add your Neon connection string in Settings.",
            )
        return NeonClient(connectionString, http)
    }

    suspend fun loadGallery(): List<MediaItem> = withContext(Dispatchers.IO) {
        val rows = client().query(GALLERY_SQL)
        rows.map { it.toMediaItem() }
    }

    suspend fun loadItem(id: String): MediaItem? = withContext(Dispatchers.IO) {
        val rows = client().query(ITEM_SQL, listOf(JsonPrimitive(id)))
        rows.firstOrNull()?.toMediaItem()
    }

    companion object {
        /**
         * The gallery query — the same columns and the same order as the
         * extension's `getImagesNeon`.
         *
         * The filters are the ones the web gallery runs: a vaulted item lives
         * in the Secret Vault, not in the gallery, and the system rows (the
         * vault config item) are not media at all.
         */
        val GALLERY_SQL = """
            select
              id, kind, is_video, is_link, page_title, description, tags, collection_id,
              internal_added_timestamp, source_image_url, source_page_url, file_name, file_size,
              width, height, duration, file_type, file_type_source, creation_date, creation_date_source,
              sha256, p_hash, a_hash, d_hash,
              pixvid_url, pixvid_delete_url, imgbb_url, imgbb_delete_url, imgbb_thumb_url,
              filemoon_watch_url, filemoon_direct_url, udrop_watch_url, udrop_direct_url,
              link_url, link_url_canonical, link_preview_image_url, favicon_url, last_visited_at,
              spz_url, spz_file_size, texture_url, texture_file_size, config_json,
              deleted_at, created_at, updated_at, extra_metadata
            from public.media_items
            where deleted_at is null
              and left(id, 9) <> '__imgvault_'
              and coalesce(extra_metadata->>'systemType', '') <> 'secretVaultConfig'
              and coalesce(lower(extra_metadata->>'isVaulted'), 'false') not in ('true', '1', 'yes')
            order by internal_added_timestamp desc, created_at desc
        """.trimIndent()

        val ITEM_SQL = """
            select
              id, kind, is_video, is_link, page_title, description, tags, collection_id,
              internal_added_timestamp, source_image_url, source_page_url, file_name, file_size,
              width, height, duration, file_type, file_type_source, creation_date, creation_date_source,
              sha256, p_hash, a_hash, d_hash,
              pixvid_url, pixvid_delete_url, imgbb_url, imgbb_delete_url, imgbb_thumb_url,
              filemoon_watch_url, filemoon_direct_url, udrop_watch_url, udrop_direct_url,
              link_url, link_url_canonical, link_preview_image_url, favicon_url, last_visited_at,
              spz_url, spz_file_size, texture_url, texture_file_size, config_json,
              deleted_at, created_at, updated_at, extra_metadata
            from public.media_items
            where id = ${'$'}1 and deleted_at is null
              and left(id, 9) <> '__imgvault_'
              and coalesce(extra_metadata->>'systemType', '') <> 'secretVaultConfig'
              and coalesce(lower(extra_metadata->>'isVaulted'), 'false') not in ('true', '1', 'yes')
            limit 1
        """.trimIndent()
    }
}
