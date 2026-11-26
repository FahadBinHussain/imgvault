package com.imgvault.app.ui.update

import android.app.Application
import android.content.pm.PackageManager
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.imgvault.app.core.ServiceLocator
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** what the update screen shows */
sealed interface UpdateState {
    data object Idle : UpdateState
    data object Checking : UpdateState

    /** the installed build is the newest one */
    data class UpToDate(val versionName: String, val versionCode: Long) : UpdateState

    /** a newer build exists */
    data class Available(val manifest: UpdateManifest) : UpdateState

    /** the server refuses the installed build — the update is mandatory */
    data class Blocked(val manifest: UpdateManifest, val installedVersionCode: Long) : UpdateState

    data class Downloading(val manifest: UpdateManifest, val progress: Float?) : UpdateState

    /** downloaded and verified — waiting for the user to install */
    data class ReadyToInstall(val manifest: UpdateManifest, val apk: File) : UpdateState

    /** the system installer is showing its prompt */
    data class Installing(val manifest: UpdateManifest) : UpdateState

    data class Installed(val versionName: String) : UpdateState

    data class Failed(val message: String) : UpdateState
}

/**
 * The self-update flow.
 *
 * The server owns the floor: when the manifest's `minSupportedVersionCode`
 * is above the installed build, the app is REFUSED — the update screen goes
 * into [UpdateState.Blocked] and the only way out is the new build. The floor
 * is never derived from the build being published.
 */
class UpdateViewModel(application: Application) : AndroidViewModel(application) {

    private val updateService = UpdateService(ServiceLocator.http)
    private val installer = ApkInstaller(application, ServiceLocator.http)

    private val _state = MutableStateFlow<UpdateState>(UpdateState.Idle)
    val state: StateFlow<UpdateState> = _state.asStateFlow()

    private val _installed = MutableStateFlow(installedVersion())
    val installed: StateFlow<InstalledVersion> = _installed.asStateFlow()

    init {
        viewModelScope.launch {
            InstallResultReceiver.results.collect { result ->
                if (result.succeeded) {
                    _state.value = UpdateState.Installed(_installed.value.versionName)
                } else {
                    _state.value = UpdateState.Failed(
                        "The system installer did not install the update" +
                            (result.message?.let { ": $it" } ?: "."),
                    )
                }
            }
        }
    }

    fun check() {
        _state.value = UpdateState.Checking
        viewModelScope.launch {
            try {
                val manifest = updateService.fetch()
                val current = _installed.value
                when {
                    manifest.hasFloor && manifest.minSupportedVersionCode > current.code -> {
                        _state.value = UpdateState.Blocked(manifest, current.code)
                    }
                    manifest.available && manifest.versionCode > current.code -> {
                        _state.value = UpdateState.Available(manifest)
                    }
                    else -> {
                        _state.value = UpdateState.UpToDate(current.versionName, current.code)
                    }
                }
            } catch (error: Exception) {
                _state.value = UpdateState.Failed(
                    error.message ?: "The update check failed for an unknown reason",
                )
            }
        }
    }

    fun download() {
        val manifest = when (val current = _state.value) {
            is UpdateState.Available -> current.manifest
            is UpdateState.Blocked -> current.manifest
            else -> return
        }
        _state.value = UpdateState.Downloading(manifest, 0f)
        viewModelScope.launch {
            try {
                val apk = installer.download(manifest) { progress ->
                    _state.value = UpdateState.Downloading(manifest, progress)
                }
                _state.value = UpdateState.ReadyToInstall(manifest, apk)
            } catch (error: Exception) {
                _state.value = UpdateState.Failed(
                    error.message ?: "The update download failed for an unknown reason",
                )
            }
        }
    }

    fun install() {
        val current = _state.value as? UpdateState.ReadyToInstall ?: return
        _state.value = UpdateState.Installing(current.manifest)
        viewModelScope.launch {
            val result = installer.install(current.apk)
            result.onFailure { error ->
                _state.value = UpdateState.Failed(
                    error.message ?: "The update could not be handed to the system installer",
                )
            }
            // on success the result arrives through InstallResultReceiver
        }
    }

    fun refreshInstalledVersion() {
        _installed.value = installedVersion()
    }

    private fun installedVersion(): InstalledVersion {
        val context = getApplication<Application>()
        return try {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                info.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                info.versionCode.toLong()
            }
            InstalledVersion(info.versionName.orEmpty(), code)
        } catch (error: PackageManager.NameNotFoundException) {
            throw UpdateManifestException(
                "The installed package could not be read: ${error.message}",
                error,
            )
        }
    }
}

data class InstalledVersion(val versionName: String, val code: Long)
