@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.imgvault.app.ui.gallery

import android.util.Log
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BrokenImage
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
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
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.SubcomposeAsyncImage
import com.imgvault.app.data.model.MediaItem

/**
 * The gallery grid.
 *
 * The layout is Google Photos': the feed is packed into rows of photos that
 * all share one height, every photo keeps its own shape inside that height,
 * the photos have small rounded corners and the feed is grouped under a date
 * header. Nothing is squashed into a square.
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
 * The row geometry comes from [buildGrid], so the screen only draws it. The
 * date header sticks to the top while its day is on screen, and a pinch
 * changes how many photos fit in a row — the same two things Google Photos
 * lets you do.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PhotoFeed(
    items: List<MediaItem>,
    provider: String,
    onOpenItem: (MediaItem) -> Unit,
) {
    var density by remember { mutableFloatStateOf(1f) }
    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        val widthDp = maxWidth.value
        val targetRatio = (GRID_TARGET_RATIO / density).coerceIn(1.1f, 7f)
        val entries = remember(items, widthDp, targetRatio) { buildGrid(items, widthDp, targetRatio = targetRatio) }
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .transformable { zoomChange, _, _ ->
                    density = (density * zoomChange).coerceIn(0.45f, 2.4f)
                },
        ) {
            items(entries) { entry ->
                when (entry) {
                    is GridEntry.Header -> stickyHeader { DateHeader(entry.label) }
                    is GridEntry.Photos -> PhotoRow(
                        row = entry.row,
                        provider = provider,
                        onOpenItem = onOpenItem,
                    )
                }
            }
        }
    }
}

/** the date header, the way Google Photos groups a feed */
@Composable
private fun DateHeader(label: String) {
    Text(
        text = label,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp),
    )
}

/** one row of photos, all of them the same height */
@Composable
private fun PhotoRow(
    row: GridRow,
    provider: String,
    onOpenItem: (MediaItem) -> Unit,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(GRID_GAP_DP.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = GRID_GAP_DP.dp),
    ) {
        row.tiles.forEach { tile ->
            val item = tile.item
            PhotoTile(
                item = item,
                provider = provider,
                widthDp = tile.widthDp,
                heightDp = row.heightDp,
                onOpen = { onOpenItem(item) },
            )
        }
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
    Box(
        modifier = Modifier
            .width(widthDp.dp)
            .height(heightDp.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable { onOpen() },
    ) {
        if (url.isEmpty()) {
            Log.i("ImgVault", "no thumbnail url for ${item.id}")
            if (item.isVideo) VideoPlaceholder(item) else TileFallback(item)
        } else {
            SubcomposeAsyncImage(
                model = url,
                contentDescription = item.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
                loading = { TileFallback(item, loading = true) },
                error = {
                    Log.w("ImgVault", "image failed: $url")
                    TileFallback(item)
                },
            )
        }
        if (item.isVideo) {
            VideoBadge(
                item = item,
                withPlayIcon = url.isNotEmpty(),
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(6.dp),
            )
        }
    }
}

/**
 * What is shown when there is no picture to show.
 *
 * It never hides the problem: a file without a thumbnail says so with an
 * icon and the file name, so the grid is never a row of empty squares.
 */
@Composable
private fun TileFallback(item: MediaItem, loading: Boolean = false) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(8.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (loading) {
            CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
        } else {
            Icon(
                imageVector = if (item.isVideo) Icons.Filled.PlayArrow else Icons.Filled.BrokenImage,
                contentDescription = null,
                modifier = Modifier.size(22.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            text = item.title,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

/**
 * A video without a poster frame.
 *
 * The database has no thumbnail for a video, so the tile says what it is: a
 * dark tile with a play button in the middle, the way Google Photos shows a
 * video it has no frame for.
 */
@Composable
private fun VideoPlaceholder(item: MediaItem) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF232323)),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            color = Color.White.copy(alpha = 0.22f),
            contentColor = Color.White,
            shape = CircleShape,
        ) {
            Icon(
                imageVector = Icons.Filled.PlayArrow,
                contentDescription = "Video",
                modifier = Modifier
                    .padding(10.dp)
                    .size(28.dp),
            )
        }
    }
}

/** the play badge and the length of a video, on the photo */
@Composable
private fun VideoBadge(item: MediaItem, withPlayIcon: Boolean, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (withPlayIcon) {
            Surface(
                color = MaterialTheme.colorScheme.scrim,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                shape = CircleShape,
            ) {
                Icon(
                    imageVector = Icons.Filled.PlayArrow,
                    contentDescription = "Video",
                    modifier = Modifier
                        .padding(3.dp)
                        .size(16.dp),
                )
            }
        }
        val duration = item.durationLabel
        if (duration.isNotEmpty()) {
            Surface(
                color = Color.Black.copy(alpha = 0.6f),
                contentColor = Color.White,
                shape = RoundedCornerShape(6.dp),
            ) {
                Text(
                    text = duration,
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
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
