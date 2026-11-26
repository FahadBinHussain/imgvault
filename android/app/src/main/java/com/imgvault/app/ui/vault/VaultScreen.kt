@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.imgvault.app.ui.vault

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.SubcomposeAsyncImage
import com.imgvault.app.data.VaultItem
import com.imgvault.app.data.VaultPreview
import com.imgvault.app.ui.grid.JustifiedGrid
import com.imgvault.app.ui.grid.TileFallback
import com.imgvault.app.ui.grid.VideoBadge

/**
 * The vault screen.
 *
 * The vault is the gallery, locked: the SAME grid draws it (the shared one in
 * `ui/grid`), so the pictures keep their own shape, the days are headers and
 * a pinch changes the density.
 *
 * The difference is where the pictures come from: the gallery loads them from
 * a host, the vault decrypts them itself. An item that cannot be decrypted
 * keeps its place in the grid and says what is wrong with it.
 */
@Composable
fun VaultScreen(
    onBack: () -> Unit,
    onOpenItem: (VaultItem) -> Unit = {},
    modifier: Modifier = Modifier,
    viewModel: VaultViewModel = viewModel(),
) {
    val locked by viewModel.locked.collectAsStateWithLifecycle()
    val items by viewModel.items.collectAsStateWithLifecycle()
    val previews by viewModel.previews.collectAsStateWithLifecycle()
    val unlocking by viewModel.unlocking.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()

    var passcode by rememberSaveable { mutableStateOf("") }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text("Vault") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    if (!locked) {
                        TextButton(onClick = viewModel::lock) { Text("Lock") }
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
            if (locked) {
                LockedPane(
                    passcode = passcode,
                    onPasscodeChange = { passcode = it },
                    unlocking = unlocking,
                    onUnlock = { viewModel.unlock(passcode) },
                    error = error,
                )
            } else {
                UnlockedPane(
                    items = items,
                    previews = previews,
                    error = error,
                    onRequestPreview = viewModel::requestPreview,
                    onOpenItem = onOpenItem,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}

@Composable
private fun LockedPane(
    passcode: String,
    onPasscodeChange: (String) -> Unit,
    unlocking: Boolean,
    onUnlock: () -> Unit,
    error: String?,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = "The vault is locked",
            style = MaterialTheme.typography.titleMedium,
        )
        Text(
            text = "Enter the passcode you set in the extension. The metadata stays encrypted " +
                "until the master key is unwrapped.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedTextField(
            value = passcode,
            onValueChange = onPasscodeChange,
            label = { Text("Passcode") },
            singleLine = true,
            visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )
        Button(
            onClick = onUnlock,
            enabled = !unlocking && passcode.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (unlocking) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
                Text("Unlocking…", modifier = Modifier.padding(start = 8.dp))
            } else {
                Text("Unlock")
            }
        }
        error?.let { message ->
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

@Composable
private fun UnlockedPane(
    items: List<VaultItem>,
    previews: Map<String, VaultPreview>,
    error: String?,
    onRequestPreview: (String) -> Unit,
    onOpenItem: (VaultItem) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        Text(
            text = "${items.size} vault items",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        )
        error?.let { message ->
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        if (items.isEmpty()) {
            Box(modifier = Modifier
                .fillMaxWidth()
                .weight(1f), contentAlignment = Alignment.Center) {
                Text(
                    text = "The vault is empty",
                    style = MaterialTheme.typography.titleMedium,
                )
            }
        } else {
            JustifiedGrid(
                items = items,
                ratioOf = { it.aspectRatio },
                dayKeyOf = { it.dayKey },
            ) { item, widthDp, heightDp ->
                VaultTile(
                    item = item,
                    preview = previews[item.id],
                    widthDp = widthDp,
                    heightDp = heightDp,
                    onRequestPreview = onRequestPreview,
                    onOpen = { onOpenItem(item) },
                )
            }
        }
    }
}

/**
 * One vault tile: the picture the app decrypted itself.
 *
 * An item that cannot be read keeps its place and says so — the grid never
 * pretends a broken item is an empty one.
 */
@Composable
private fun VaultTile(
    item: VaultItem,
    preview: VaultPreview?,
    widthDp: Float,
    heightDp: Float,
    onRequestPreview: (String) -> Unit,
    onOpen: () -> Unit,
) {
    LaunchedEffect(item.id) { onRequestPreview(item.id) }
    Box(
        modifier = Modifier
            .width(widthDp.dp)
            .height(heightDp.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable { onOpen() },
    ) {
        when {
            item.decryptError != null -> VaultTileError(item.decryptError)
            preview == null -> TileFallback(item.title, isVideo = item.isVideo, loading = true)
            preview is VaultPreview.Missing -> TileFallback(item.title, isVideo = item.isVideo)
            preview is VaultPreview.Failed -> VaultTileError(preview.message)
            preview is VaultPreview.Image -> SubcomposeAsyncImage(
                model = preview.bytes,
                contentDescription = item.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
                loading = { TileFallback(item.title, isVideo = item.isVideo, loading = true) },
                error = { VaultTileError("The preview could not be shown.") },
            )
        }
        if (item.isVideo) {
            VideoBadge(
                duration = item.durationLabel,
                withPlayIcon = preview is VaultPreview.Image,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(6.dp),
            )
        }
    }
}

/** what a tile says when the item could not be read */
@Composable
private fun VaultTileError(message: String) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.errorContainer)
            .padding(6.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            imageVector = Icons.Filled.Lock,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onErrorContainer,
        )
        Text(
            text = message,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onErrorContainer,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}
