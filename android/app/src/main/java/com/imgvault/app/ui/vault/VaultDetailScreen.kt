@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.imgvault.app.ui.vault

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.media3.common.MediaItem as Media3Item
import androidx.media3.datasource.DataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.ui.PlayerView
import coil.compose.SubcomposeAsyncImage
import com.imgvault.app.core.ServiceLocator
import com.imgvault.app.data.VaultBlobDataSource
import com.imgvault.app.data.VaultItem
import com.imgvault.app.data.VaultPreview
import com.imgvault.app.ui.grid.TileFallback
import java.util.Locale

/**
 * One vault item, full screen.
 *
 * The picture is the preview the app decrypted itself — the encrypted blob
 * lives on the vault host, and that host is not always reachable from a phone.
 * Every state says what is happening: a spinner while it loads, the reason it
 * could not be read when it cannot, and the metadata of the item below the
 * picture.
 *
 * A video is NOT its preview: the preview is only a still, so a video item
 * plays its decrypted blob with the player — the still is the poster while
 * the blob downloads, never the end of the story.
 */
@Composable
fun VaultDetailScreen(
    itemId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: VaultDetailViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val video by viewModel.video.collectAsStateWithLifecycle()

    LaunchedEffect(itemId) { viewModel.load(itemId) }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = {
                    val title = (state as? VaultDetailState.Ready)?.item?.title ?: "Vault item"
                    Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(Color(0xFF101010)),
            contentAlignment = Alignment.Center,
        ) {
            when (val current = state) {
                is VaultDetailState.Loading -> CircularProgressIndicator()

                is VaultDetailState.Missing -> Text(
                    text = "This vault item is gone.",
                    style = MaterialTheme.typography.titleMedium,
                    color = Color.White,
                )

                is VaultDetailState.Failed -> Text(
                    text = current.message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(24.dp),
                )

                is VaultDetailState.Ready -> VaultDetailContent(current.item, current.preview, video)
            }
        }
    }
}

@Composable
private fun VaultDetailContent(item: VaultItem, preview: VaultPreview?, video: VaultVideoState?) {
    Column(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            contentAlignment = Alignment.Center,
        ) {
            if (item.isVideo) {
                VaultVideoPane(item = item, preview = preview, video = video)
            } else {
                VaultPreviewImage(item = item, preview = preview, modifier = Modifier.fillMaxSize())
            }
        }
        Surface(color = MaterialTheme.colorScheme.surface) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = item.fileName.ifBlank { "unnamed file" },
                    style = MaterialTheme.typography.titleSmall,
                )
                Text(
                    text = listOf(
                        item.mimeType.ifBlank { "unknown type" },
                        formatSize(item.sizeBytes),
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                item.decryptError?.let { problem ->
                    Text(
                        text = problem,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                if (item.hosts.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        item.hosts.forEach { host ->
                            Surface(
                                color = MaterialTheme.colorScheme.surfaceVariant,
                                shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
                            ) {
                                Text(
                                    text = host,
                                    style = MaterialTheme.typography.labelSmall,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** the decrypted preview still of an item */
@Composable
private fun VaultPreviewImage(item: VaultItem, preview: VaultPreview?, modifier: Modifier = Modifier) {
    when {
        preview == null -> TileFallback(item.title, isVideo = item.isVideo, loading = true)
        preview is VaultPreview.Missing -> TileFallback(item.title, isVideo = item.isVideo)
        preview is VaultPreview.Failed -> Text(
            text = preview.message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.padding(24.dp),
        )
        preview is VaultPreview.Image -> SubcomposeAsyncImage(
            model = preview.bytes,
            contentDescription = item.title,
            contentScale = ContentScale.Fit,
            modifier = modifier.fillMaxSize(),
            loading = { TileFallback(item.title, isVideo = item.isVideo, loading = true) },
            error = { Text("The preview could not be shown.", color = Color.White) },
        )
    }
}

/**
 * A vault video: the encrypted blob, streamed and decrypted as it plays.
 *
 * The preview still is only the poster while the stream is being picked —
 * a still with a spinner says the video is coming, and a still with no
 * spinner would be a video that never plays. A failure says why instead of
 * leaving the poster up. The player reads through [VaultBlobDataSource],
 * which fetches each chunk's encrypted bytes with a Range request and
 * decrypts them on the fly — the video is never downloaded to a file first.
 */
@Composable
private fun VaultVideoPane(item: VaultItem, preview: VaultPreview?, video: VaultVideoState?) {
    val context = LocalContext.current
    when (video) {
        null, is VaultVideoState.Loading -> Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            VaultPreviewImage(item = item, preview = preview, modifier = Modifier.fillMaxSize())
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                CircularProgressIndicator()
                Text(
                    text = "Loading the video…",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White,
                )
            }
        }

        is VaultVideoState.Failed -> Text(
            text = video.message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.padding(24.dp),
        )

        is VaultVideoState.Ready -> {
            val exoPlayer = remember(item.id) { ExoPlayer.Builder(context).build() }

            DisposableEffect(exoPlayer) {
                onDispose { exoPlayer.release() }
            }

            LaunchedEffect(video.blobUrl) {
                val factory = ProgressiveMediaSource.Factory(
                    DataSource.Factory {
                        VaultBlobDataSource(ServiceLocator.http, video.blobUrl, video.key)
                    },
                )
                exoPlayer.setMediaSource(
                    factory.createMediaSource(Media3Item.fromUri(video.blobUrl)),
                )
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
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

/** the size in the unit a human reads */
private fun formatSize(bytes: Long): String {
    if (bytes >= 1024L * 1024L) return String.format(Locale.US, "%.1f MB", bytes / 1024.0 / 1024.0)
    if (bytes >= 1024L) return String.format(Locale.US, "%.1f KB", bytes / 1024.0)
    return "$bytes B"
}
