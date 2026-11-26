@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.imgvault.app.ui.vault

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.imgvault.app.data.VaultItem
import java.util.Locale

/**
 * The vault screen.
 *
 * Locked, it asks for the passcode and says nothing else — the decrypted rows
 * only exist after the key is unwrapped, and they are dropped again the moment
 * the vault is locked.
 */
@Composable
fun VaultScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: VaultViewModel = viewModel(),
) {
    val locked by viewModel.locked.collectAsStateWithLifecycle()
    val items by viewModel.items.collectAsStateWithLifecycle()
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
                    error = error,
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
            visualTransformation = PasswordVisualTransformation(),
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
    error: String?,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        error?.let { message ->
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(16.dp),
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
            LazyColumn(modifier = Modifier
                .fillMaxWidth()
                .weight(1f)) {
                items(items) { item -> VaultRow(item) }
            }
        }
    }
}

@Composable
private fun VaultRow(item: VaultItem) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = item.fileName.ifBlank { "unnamed file" },
            style = MaterialTheme.typography.titleSmall,
        )
        Text(
            text = "${item.mimeType.ifBlank { "unknown type" }} · ${formatSize(item.sizeBytes)}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        item.decryptError?.let { problem ->
            Text(
                text = "This item could not be read: $problem",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
        if (item.hosts.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                item.hosts.forEach { host -> HostChip(host) }
            }
        }
    }
    HorizontalDivider()
}

@Composable
private fun HostChip(host: String) {
    Surface(
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Text(
            text = host,
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

/** the size in the unit a human reads */
private fun formatSize(bytes: Long): String = when {
    bytes >= 1024L * 1024L -> String.format(Locale.US, "%.1f MB", bytes / 1024.0 / 1024.0)
    bytes >= 1024L -> "${bytes / 1024L} KB"
    else -> "$bytes B"
}
