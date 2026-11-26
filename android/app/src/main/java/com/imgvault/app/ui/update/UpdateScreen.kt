package com.imgvault.app.ui.update

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel

/**
 * The update screen.
 *
 * Every state says what is going on out loud: no silent spinner, no blank
 * screen. The install method is always named on screen — the system prompt is
 * the install method, and the user has to see that.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UpdateScreen(
    onBack: () -> Unit,
    viewModel: UpdateViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("App update") },
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
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            when (val current = state) {
                is UpdateState.Idle -> {
                    Text("Check whether a newer build is published.", style = MaterialTheme.typography.bodyMedium)
                    Button(onClick = { viewModel.check() }) { Text("Check for updates") }
                }

                is UpdateState.Checking -> {
                    BoloWavyProgressRing(
                        progress = null,
                        totalSizeBytes = 0L,
                        caption = "Asking the server what the newest build is…",
                    )
                }

                is UpdateState.UpToDate -> {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Text(
                                "You're on the latest version",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                "Version ${current.versionName} (${current.versionCode}) is the newest published build.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    OutlinedButton(onClick = { viewModel.check() }) { Text("Check again") }
                }

                is UpdateState.Available -> {
                    UpdateCard(
                        title = "Version ${current.manifest.versionName} is available",
                        body = buildString {
                            append("You have ${viewModel.installed.value.versionName}.")
                            if (current.manifest.sizeBytes > 0) {
                                append(" The download is ")
                                append(current.manifest.sizeBytes / (1024 * 1024))
                                append(" MB.")
                            }
                            if (current.manifest.notes.isNotBlank()) {
                                append("\n\n")
                                append(current.manifest.notes)
                            }
                        },
                    )
                    Button(onClick = { viewModel.download() }) { Text("Download") }
                }

                is UpdateState.Blocked -> {
                    UpdateCard(
                        title = "This build is no longer accepted",
                        body = "The server requires version ${current.manifest.minSupportedVersionCode} " +
                            "or newer, and this app is version ${current.installedVersionCode}. " +
                            "Update before using the app again.",
                    )
                    Button(onClick = { viewModel.download() }) { Text("Update now") }
                }

                is UpdateState.Downloading -> {
                    BoloWavyProgressRing(
                        progress = current.progress,
                        totalSizeBytes = current.manifest.sizeBytes,
                        caption = "Downloading version ${current.manifest.versionName}…",
                    )
                }

                is UpdateState.ReadyToInstall -> {
                    UpdateCard(
                        title = "The update is downloaded and verified",
                        body = "Version ${current.manifest.versionName} is ready. The system installer asks " +
                            "you to confirm — Android always shows that prompt for an app update.",
                    )
                    UpdateMethodBadge(text = "Android PackageInstaller (you confirm)")
                    Button(onClick = { viewModel.install() }) { Text("Install the update") }
                }

                is UpdateState.Installing -> {
                    BoloPulsingInstallIndicator(
                        title = "Installing version ${current.manifest.versionName}",
                        subtitle = "Confirm the system prompt to finish.",
                        methodBadge = "Android PackageInstaller (you confirm)",
                    )
                }

                is UpdateState.Installed -> {
                    BoloUpdateCompletedView(
                        title = "Update installed",
                        subtitle = "The new build is in place. Restart the app to use it.",
                    )
                }

                is UpdateState.Failed -> {
                    UpdateCard(title = "The update did not go through", body = current.message)
                    OutlinedButton(onClick = { viewModel.check() }) { Text("Try again") }
                }
            }
        }
    }
}

@Composable
private fun UpdateCard(title: String, body: String) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            horizontalAlignment = Alignment.Start,
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(
                body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
