@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.imgvault.app.ui.gallery

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem as Media3Item
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import com.imgvault.app.core.ServiceLocator
import com.imgvault.app.core.settings.AppSettings
import com.imgvault.app.data.model.MediaItem
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first

/** what the detail screen managed to load */
private sealed interface DetailLoadState {
    data object Loading : DetailLoadState

    /** the row is gone — deleted, or never existed under this id */
    data object Missing : DetailLoadState

    data class Ready(val item: MediaItem) : DetailLoadState

    data class Failed(val message: String) : DetailLoadState
}

/** the two host preferences the gallery and the player use */
private data class HostDefaults(val image: String, val video: String)

/**
 * The full-screen item view.
 *
 * The zoom runs on the already decoded picture — the file is never re-encoded
 * and never re-uploaded, the app only paints the bitmap larger. The badge
 * names the host that actually answered, so a picture served by Pixvid while
 * ImgBB was preferred is never silently passed off as an ImgBB picture.
 */
@Composable
fun DetailScreen(
    itemId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var reloadKey by remember { mutableIntStateOf(0) }

    val state by produceState<DetailLoadState>(DetailLoadState.Loading, itemId, reloadKey) {
        value = try {
            val item = ServiceLocator.galleryRepository.loadItem(itemId)
            if (item == null) DetailLoadState.Missing else DetailLoadState.Ready(item)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            DetailLoadState.Failed(
                error.message ?: "The item could not be loaded: ${error::class.java.simpleName}",
            )
        }
    }

    val hosts by produceState(
        HostDefaults(AppSettings.DEFAULT_GALLERY_SOURCE, AppSettings.DEFAULT_VIDEO_SOURCE),
    ) {
        value = runCatching {
            val stored = ServiceLocator.settings.settings.first()
            HostDefaults(stored.defaultGallerySource, stored.defaultVideoSource)
        }.getOrDefault(
            HostDefaults(AppSettings.DEFAULT_GALLERY_SOURCE, AppSettings.DEFAULT_VIDEO_SOURCE),
        )
    }

    val title = when (val current = state) {
        is DetailLoadState.Ready -> current.item.title.ifBlank { "Item" }
        else -> "Item"
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when (val current = state) {
                DetailLoadState.Loading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }

                DetailLoadState.Missing -> DetailMessage(
                    title = "This item is not in the gallery any more",
                    body = "The row was deleted, or the id does not exist in public.media_items.",
                )

                is DetailLoadState.Failed -> DetailMessage(
                    title = "The item could not be loaded",
                    body = current.message,
                    actionLabel = "Retry",
                    onAction = { reloadKey++ },
                )

                is DetailLoadState.Ready -> {
                    val item = current.item
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                    ) {
                        if (item.isVideo) {
                            VideoPane(item = item, provider = hosts.video)
                        } else {
                            ZoomableImage(item = item, provider = hosts.image)
                        }
                    }
                    ItemInfo(item = item, hosts = hosts)
                }
            }
        }
    }
}

@Composable
private fun ZoomableImage(
    item: MediaItem,
    provider: String,
    modifier: Modifier = Modifier,
) {
    var scale by remember(item.id) { mutableFloatStateOf(1f) }
    var offset by remember(item.id) { mutableStateOf(Offset.Zero) }

    val url = item.displayImage(provider)?.url.orEmpty()
    if (url.isEmpty()) {
        DetailMessage(
            title = "This image has no image host link",
            body = "No image host link exists for this item — neither ImgBB nor Pixvid has it. " +
                "Open it from the extension.",
            modifier = modifier,
        )
    } else {
        Box(modifier = modifier.fillMaxSize()) {
            AsyncImage(
                model = url,
                contentDescription = item.title,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(item.id) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            val next = (scale * zoom).coerceIn(1f, MAX_SCALE)
                            scale = next
                            offset = if (next > 1f) offset + pan else Offset.Zero
                        }
                    }
                    .pointerInput(item.id) {
                        detectTapGestures(
                            onDoubleTap = {
                                if (scale > 1.05f) {
                                    scale = 1f
                                    offset = Offset.Zero
                                } else {
                                    scale = DOUBLE_TAP_SCALE
                                    offset = Offset.Zero
                                }
                            },
                        )
                    }
                    .graphicsLayer {
                        scaleX = scale
                        scaleY = scale
                        translationX = offset.x
                        translationY = offset.y
                    },
            )

            if (scale > ZOOM_BADGE_THRESHOLD) {
                Surface(
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(12.dp),
                ) {
                    TextButton(onClick = { scale = 1f; offset = Offset.Zero }) {
                        Text("${formatScale(scale)}x")
                    }
                }
            }
        }
    }
}

@Composable
private fun VideoPane(
    item: MediaItem,
    provider: String,
    modifier: Modifier = Modifier,
) {
    val link = item.displayVideo(provider)
    val url = link?.url.orEmpty()
    val context = LocalContext.current
    when {
        url.isEmpty() -> DetailMessage(
            title = "This video has no video host link",
            body = "No video host link exists for this item — Filemoon, UDrop and Telegram all " +
                "have nothing for it. Open it from the extension.",
            modifier = modifier,
        )

        // a host that serves the FILE can be played right here
        isDirectMediaUrl(url) -> {
            val exoPlayer = remember(item.id) { ExoPlayer.Builder(context).build() }

            DisposableEffect(exoPlayer) {
                onDispose { exoPlayer.release() }
            }

            LaunchedEffect(url) {
                exoPlayer.setMediaItem(Media3Item.fromUri(url))
                exoPlayer.prepare()
                exoPlayer.playWhenReady = true
            }

            AndroidView(
                factory = { ctx ->
                    PlayerView(ctx).apply {
                        useController = true
                        this.player = exoPlayer
                    }
                },
                update = { view -> view.player = exoPlayer },
                modifier = modifier.fillMaxSize(),
            )
        }

        // a host that serves a PAGE cannot be played by the player - the
        // browser can, because the page is the player
        else -> DetailMessage(
            title = "This host serves a page, not the file",
            body = "${link?.sourceKey ?: "The host"} plays this video on a web page, so the phone " +
                "cannot stream it directly. Open the page and the video plays there.",
            actionLabel = "Open in browser",
            onAction = {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                runCatching { context.startActivity(intent) }
            },
            modifier = modifier,
        )
    }
}

/**
 * Does this URL hand over the file itself?
 *
 * Filemoon and UDrop answer with a web page that plays the video, so the
 * player would only get HTML. A link that ends in a media file name is the
 * real thing.
 */
private fun isDirectMediaUrl(url: String): Boolean {
    val path = url.substringBefore('?').substringBefore('#').lowercase()
    return MEDIA_FILE_ENDINGS.any { path.endsWith(it) }
}

private val MEDIA_FILE_ENDINGS = listOf(
    ".mp4", ".webm", ".m3u8", ".mov", ".m4v", ".mkv", ".mp3", ".m4a", ".ogv",
)

@Composable
private fun ItemInfo(
    item: MediaItem,
    hosts: HostDefaults,
) {
    val servingHost = if (item.isVideo) {
        item.displayVideo(hosts.video)?.sourceKey
    } else {
        item.displayImage(hosts.image)?.sourceKey
    }
    val availableHosts = if (item.isVideo) item.videoHosts.keys else item.imageHosts.keys

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = item.title,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        if (item.description.isNotBlank()) {
            Text(
                text = item.description,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            text = "Served by: ${servingHost ?: "no host"}",
            style = MaterialTheme.typography.labelMedium,
        )
        if (availableHosts.isNotEmpty()) {
            Text(
                text = "Hosts with a link: ${availableHosts.joinToString(", ")}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun DetailMessage(
    title: String,
    body: String,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text = title, style = MaterialTheme.typography.titleMedium)
        Text(
            text = body,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (actionLabel != null && onAction != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onAction) { Text(actionLabel) }
            }
        }
    }
}

private fun formatScale(scale: Float): String = String.format(Locale.US, "%.1f", scale)

private const val MAX_SCALE = 8f
private const val DOUBLE_TAP_SCALE = 2.5f
private const val ZOOM_BADGE_THRESHOLD = 1.05f
