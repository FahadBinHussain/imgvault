@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.imgvault.app.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.imgvault.app.core.settings.AppSettings

/**
 * Settings.
 *
 * The secret fields start EMPTY on purpose: a stored secret is never shown
 * back, the app only says that one is there. An empty field therefore means
 * "keep the stored value", never "delete it".
 */
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: SettingsViewModel = viewModel(),
) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val secrets by viewModel.secrets.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()
    val neonEndpoint by viewModel.neonEndpoint.collectAsStateWithLifecycle()

    var neonVisible by remember { mutableStateOf(false) }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
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
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            SectionTitle("Database")
            SecretField(
                label = "Neon connection string",
                value = secrets.neonUrlDraft,
                onValueChange = viewModel::setNeonUrlDraft,
                stored = secrets.hasNeonUrl,
                allowShow = true,
                visible = neonVisible,
                onVisibleChange = { neonVisible = it },
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = viewModel::testNeon) { Text("Test Neon") }
            }
            neonEndpoint?.let { endpoint ->
                Text(
                    text = "This build will contact $endpoint",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            HorizontalDivider()

            SectionTitle("Hosts")
            SecretField(
                label = "ImgBB API key",
                value = secrets.imgbbApiKeyDraft,
                onValueChange = viewModel::setImgbbApiKeyDraft,
                stored = secrets.hasImgbbApiKey,
            )
            SecretField(
                label = "Pixvid API key",
                value = secrets.pixvidApiKeyDraft,
                onValueChange = viewModel::setPixvidApiKeyDraft,
                stored = secrets.hasPixvidApiKey,
            )
            SecretField(
                label = "Telegram bot token",
                value = secrets.telegramBotTokenDraft,
                onValueChange = viewModel::setTelegramBotTokenDraft,
                stored = secrets.hasTelegramBotToken,
            )
            SecretField(
                label = "Telegram channel",
                value = secrets.telegramChannelDraft,
                onValueChange = viewModel::setTelegramChannelDraft,
                stored = secrets.hasTelegramChannel,
                hidden = false,
            )
            SecretField(
                label = "TeraBox cookie",
                value = secrets.teraboxCookieDraft,
                onValueChange = viewModel::setTeraboxCookieDraft,
                stored = secrets.hasTeraboxCookie,
            )

            HorizontalDivider()

            SectionTitle("Defaults")
            SettingDropdown(
                label = "Default image host",
                options = IMAGE_HOSTS,
                selected = settings.defaultGallerySource,
                onSelect = viewModel::setDefaultGallerySource,
            )
            SettingDropdown(
                label = "Default video host",
                options = VIDEO_HOSTS,
                selected = settings.defaultVideoSource,
                onSelect = viewModel::setDefaultVideoSource,
            )
            SettingDropdown(
                label = "Sort order",
                options = AppSettings.SORT_ORDERS,
                selected = settings.sortOrder,
                onSelect = viewModel::setSortOrder,
            )

            HorizontalDivider()

            SectionTitle("Updates")
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Check for app updates",
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    Text(
                        text = "The app asks the release manifest on launch and shows you the " +
                            "new build before you install it.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(
                    checked = settings.updateCheckEnabled,
                    onCheckedChange = viewModel::setUpdateCheckEnabled,
                )
            }

            HorizontalDivider()

            Button(
                onClick = viewModel::save,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Save")
            }
            message?.let { saved ->
                Text(
                    text = saved,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            error?.let { failure ->
                Text(
                    text = failure,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}

@Composable
private fun SectionTitle(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.primary,
    )
}

@Composable
private fun SecretField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    stored: Boolean,
    hidden: Boolean = true,
    allowShow: Boolean = false,
    visible: Boolean = false,
    onVisibleChange: (Boolean) -> Unit = {},
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            label = { Text(label) },
            singleLine = true,
            visualTransformation = if (hidden && !visible) {
                PasswordVisualTransformation()
            } else {
                VisualTransformation.None
            },
            trailingIcon = {
                if (allowShow) {
                    IconButton(onClick = { onVisibleChange(!visible) }) {
                        Icon(
                            imageVector = if (visible) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                            contentDescription = if (visible) "Hide" else "Show",
                        )
                    }
                }
            },
            supportingText = {
                Text(
                    text = if (stored) {
                        "A value is already stored — leave this empty to keep it."
                    } else {
                        "Not set yet."
                    },
                )
            },
            modifier = Modifier.fillMaxWidth(),
        )
        if (stored) {
            StoredChip()
        }
    }
}

/** the chip that says "there is a value here" without showing it */
@Composable
private fun StoredChip() {
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
    ) {
        Text(
            text = "set",
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

@Composable
private fun SettingDropdown(
    label: String,
    options: List<String>,
    selected: String,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
        )
        Box {
            OutlinedButton(
                onClick = { expanded = true },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = selected,
                    textAlign = TextAlign.Start,
                    modifier = Modifier.weight(1f),
                )
                Icon(Icons.Filled.ArrowDropDown, contentDescription = null)
            }
            DropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
            ) {
                options.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option) },
                        onClick = {
                            onSelect(option)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}

private val IMAGE_HOSTS = listOf("imgbb", "pixvid", "telegram")
private val VIDEO_HOSTS = listOf("filemoon", "udrop", "telegram")
