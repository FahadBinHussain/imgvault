@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.imgvault.app.ui.gallery

import android.util.Log
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.SubcomposeAsyncImage
import coil.request.ImageRequest
import coil.decode.VideoFrameDecoder
import com.imgvault.app.core.ServiceLocator
import com.imgvault.app.core.time.isoDayOf
import com.imgvault.app.data.model.MediaItem
import com.imgvault.app.ui.grid.JustifiedGrid
import com.imgvault.app.ui.grid.TileFallback
import com.imgvault.app.ui.grid.VideoBadge
import com.imgvault.app.ui.grid.VideoPlaceholder

/**
 * The gallery grid.
 *
 * The layout is Google Photos': the feed is packed into rows of photos that
 * all share one height, every photo keeps its own shape inside that height,
 * the photos have small rounded corners and the feed is grouped under a date
 * header. Nothing is squashed into a square.
 *
 * The drawing of that grid is SHARED with the vault (`ui/grid/JustifiedGrid`)
 * — the two feeds look and behave the same, and the geometry is pinned by one
 * set of unit tests.
 *
 * Every state says what is happening: a spinner while the feed loads, the
 * failure message with a retry when the database cannot be reached, and an
 * explicit "not configured yet" when the list is empty because there is no
 * Neon connection string. A silent empty grid would be indistinguishable from
 * "your library is empty".
 */
@Composable
fun GalleryScreen(
    onOpenVault: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenUpdate: () -> Unit = {},
    onOpenItem: (MediaItem) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: GalleryViewModel = viewModel(),
) {
    val items by viewModel.items.collectAsStateWithLifecycle()
    val query by viewModel.query.collectAsStateWithLifecycle()
    val loading by viewModel.loading.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()
    val provider by viewModel.provider.collectAsStateWithLifecycle()
    val sortOrder by viewModel.sortOrder.collectAsStateWithLifecycle()

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text("ImgVault") },
                actions = {
                    IconButton(onClick = onOpenUpdate) {
                        Icon(Icons.Filled.SystemUpdate, contentDescription = "App update")
                    }
                    IconButton(onClick = onOpenVault) {
                        Icon(Icons.Filled.Lock, contentDescription = "Vault")
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Filled.Settings, contentDescription = "Settings")
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
            OutlinedTextField(
                value = query,
                onValueChange = viewModel::setQuery,
                label = { Text("Search") },
                singleLine = true,
                shape = RoundedCornerShape(28.dp),
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                trailingIcon = {
                    if (query.isNotEmpty()) {
                        IconButton(onClick = { viewModel.setQuery("") }) {
                            Icon(Icons.Filled.Clear, contentDescription = "Clear the search")
                        }
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )

            Text(
                text = "${items.size} items · sorted by $sortOrder",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp),
            )

            Box(modifier = Modifier
                .fillMaxWidth()
                .weight(1f)) {
                when {
                    loading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))

                    error != null -> GalleryError(
                        message = error.orEmpty(),
                        onRetry = viewModel::refresh,
                        onOpenSettings = onOpenSettings,
                        modifier = Modifier.align(Alignment.Center),
                    )

                    items.isEmpty() -> GalleryEmpty(
                        onOpenSettings = onOpenSettings,
                        modifier = Modifier.align(Alignment.Center),
                    )

                    else -> PhotoFeed(
                        items = items,
                        provider = provider,
                        onOpenItem = onOpenItem,
                    )
                }
            }
        }
    }
}

/**
 * The feed itself: date headers with the photo rows under them.
 *
 * The grid is the shared one — the vault draws the very same feed.
 */
@Composable
private fun PhotoFeed(
    items: List<MediaItem>,
    provider: String,
    onOpenItem: (MediaItem) -> Unit,
) {
    JustifiedGrid(
        items = items,
        ratioOf = { it.aspectRatio },
        dayKeyOf = { isoDayOf(it.internalAddedTimestamp.ifEmpty { it.creationDate }) },
    ) { item, widthDp, heightDp ->
        PhotoTile(
            item = item,
            provider = provider,
            widthDp = widthDp,
            heightDp = heightDp,
            onOpen = { onOpenItem(item) },
        )
    }
}

/** one photo, cropped to fill its own shape — never squashed */
@Composable
private fun PhotoTile(
    item: MediaItem,
    provider: String,
    widthDp: Float,
    heightDp: Float,
    onOpen: () -> Unit,
) {
    val url = item.thumbnail(provider).ifEmpty { item.videoThumbnailUrl }
    // a video with no thumbnail URL at all: the built-in video hosts carry no
    // thumbnailUrl, so the tile would be an empty placeholder. A real frame
    // from the video's direct URL is the thumbnail instead — the frame
    // decoder reads it without downloading the whole video.
    val videoUrl = if (item.isVideo) item.displayVideo(provider)?.url.orEmpty() else ""
    // a thumbnail URL that EXISTS but no longer loads (a TeraBox dlink past
    // its 8h expiry) is resolved FRESH from TeraBox itself — the app mints a
    // new thumbnail via /api/list (and a new dlink via /api/filemetas for the
    // frame decoder) with the user's cookie, no extension needed. Only when
    // that also fails does the tile fall through to the frame decoder, and
    // only when the decoder has no working URL does it show a placeholder.
    val fsId = item.teraboxFsId
    var freshThumb by remember(url, fsId) { mutableStateOf<String?>(null) }
    var triedFreshThumb by remember(url, fsId) { mutableStateOf(false) }
    var thumbFailed by remember(url, fsId) { mutableStateOf(false) }
    var freshVideo by remember(videoUrl, fsId) { mutableStateOf<String?>(null) }
    var triedFreshVideo by remember(videoUrl, fsId) { mutableStateOf(false) }
    val effectiveThumb = freshThumb ?: url
    val showThumb = effectiveThumb.isNotEmpty() && !thumbFailed
    val effectiveVideo = freshVideo ?: videoUrl
    // once the stored thumbnail fails, mint a fresh one from TeraBox.
    LaunchedEffect(thumbFailed) {
        if (thumbFailed && !triedFreshThumb && item.isVideo && fsId.isNotEmpty()) {
            triedFreshThumb = true
            val fresh = runCatching { ServiceLocator.teraBoxClient.resolveThumbnail(fsId) }.getOrNull()
            if (!fresh.isNullOrEmpty() && fresh != url) {
                Log.i("ImgVault", "terabox fresh thumbnail for $fsId")
                freshThumb = fresh
                thumbFailed = false
            } else {
                Log.w("ImgVault", "terabox thumbnail refresh failed for $fsId — using video frame")
            }
        }
    }
    // the frame decoder needs a working video URL; a stored TeraBox dlink is
    // as stale as the thumbnail, so mint a fresh one when the tile falls
    // through to the decoder.
    LaunchedEffect(showThumb) {
        if (!showThumb && item.isVideo && videoUrl.isNotEmpty() && !triedFreshVideo && fsId.isNotEmpty()) {
            triedFreshVideo = true
            val fresh = runCatching { ServiceLocator.teraBoxClient.resolveDlink(fsId, item.title) }.getOrNull()
            if (!fresh.isNullOrEmpty() && fresh != videoUrl) {
                Log.i("ImgVault", "terabox fresh dlink for $fsId")
                freshVideo = fresh
            } else {
                Log.w("ImgVault", "terabox dlink refresh failed for $fsId — decoding stored url")
            }
        }
    }
    Box(
        modifier = Modifier
            .width(widthDp.dp)
            .height(heightDp.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable { onOpen() },
    ) {
        if (showThumb) {
            SubcomposeAsyncImage(
                model = effectiveThumb,
                contentDescription = item.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
                loading = { TileFallback(item.title, isVideo = item.isVideo, loading = true) },
                error = {
                    Log.w("ImgVault", "image failed: $effectiveThumb")
                    thumbFailed = true
                    TileFallback(item.title, isVideo = item.isVideo)
                },
            )
        } else if (item.isVideo && effectiveVideo.isNotEmpty()) {
            SubcomposeAsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(effectiveVideo)
                    .decoderFactory(VideoFrameDecoder.Factory())
                    .build(),
                contentDescription = item.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
                loading = { TileFallback(item.title, isVideo = true, loading = true) },
                error = {
                    Log.w("ImgVault", "video frame failed: $effectiveVideo")
                    VideoPlaceholder()
                },
            )
        } else if (item.isVideo) {
            Log.i("ImgVault", "no thumbnail url for ${item.id}")
            VideoPlaceholder()
        } else {
            Log.i("ImgVault", "no thumbnail url for ${item.id}")
            TileFallback(item.title, isVideo = false)
        }
        if (item.isVideo) {
            VideoBadge(
                duration = item.durationLabel,
                withPlayIcon = effectiveThumb.isNotEmpty() || effectiveVideo.isNotEmpty(),
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(6.dp),
            )
        }
    }
}

@Composable
private fun GalleryError(
    message: String,
    onRetry: () -> Unit,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(modifier = modifier.padding(16.dp)) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = "The gallery could not be loaded",
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onRetry) { Text("Retry") }
                OutlinedButton(onClick = onOpenSettings) { Text("Open Settings") }
            }
        }
    }
}

@Composable
private fun GalleryEmpty(
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "No items yet",
            style = MaterialTheme.typography.titleMedium,
        )
        Text(
            text = "The Neon connection string is not set yet. Add it in Settings and the " +
                "gallery loads from your own database.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(onClick = onOpenSettings) { Text("Open Settings") }
    }
}
