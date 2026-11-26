@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.imgvault.app.ui.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import com.imgvault.app.data.model.MediaItem

/**
 * The gallery grid.
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

                    else -> LazyVerticalGrid(
                        columns = GridCells.Adaptive(minSize = 120.dp),
                        contentPadding = PaddingValues(12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        items(items) { item ->
                            GalleryCard(
                                item = item,
                                provider = provider,
                                onOpenItem = onOpenItem,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GalleryCard(
    item: MediaItem,
    provider: String,
    onOpenItem: (MediaItem) -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onOpenItem(item) },
    ) {
        Box {
            AsyncImage(
                model = item.thumbnail(provider),
                contentDescription = item.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f)
                    .background(MaterialTheme.colorScheme.surfaceVariant),
            )
            if (item.isVideo) {
                Surface(
                    color = MaterialTheme.colorScheme.scrim,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                    shape = CircleShape,
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(6.dp),
                ) {
                    Icon(
                        imageVector = Icons.Filled.PlayArrow,
                        contentDescription = "Video",
                        modifier = Modifier
                            .padding(4.dp)
                            .size(18.dp),
                    )
                }
            }
        }
        Text(
            text = item.title,
            style = MaterialTheme.typography.bodySmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
        )
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
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
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
