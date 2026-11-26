package com.imgvault.app.ui.update

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import kotlinx.coroutines.flow.MutableSharedFlow

/** what the system installer said */
data class InstallResult(
    val status: Int,
    val message: String?,
) {
    val succeeded: Boolean
        get() = status == PackageInstaller.STATUS_SUCCESS
}

/**
 * Receives the result of the system install prompt.
 *
 * The install is never silent: the user confirms it in the system dialog, and
 * this receiver reports what the installer decided (installed, cancelled,
 * failed) so the UI can say it out loud instead of guessing.
 */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(
            PackageInstaller.EXTRA_STATUS,
            PackageInstaller.STATUS_FAILURE,
        )
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        results.tryEmit(InstallResult(status, message))
    }

    companion object {
        val results = MutableSharedFlow<InstallResult>(extraBufferCapacity = 8)
    }
}
