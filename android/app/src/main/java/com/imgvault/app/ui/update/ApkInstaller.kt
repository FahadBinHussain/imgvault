package com.imgvault.app.ui.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/** the download/install step failed — the message names what and why */
class UpdateInstallException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * The APK download + install.
 *
 * The rules that matter:
 *  - the APK is verified against the manifest's SHA-256 BEFORE it is handed to
 *    the system installer — a mismatch aborts loudly, nothing is installed
 *  - the install goes through `PackageInstaller` with the USER ACTION REQUIRED:
 *    a sideloaded app can never be installed silently, so the system prompt is
 *    the point, not a problem
 *  - the file is written to the app's own cache; the app never needs the
 *    `file://` exemption
 */
class ApkInstaller(
    private val context: Context,
    private val http: OkHttpClient,
) {
    suspend fun download(manifest: UpdateManifest, onProgress: (Float?) -> Unit): File =
        withContext(Dispatchers.IO) {
            if (manifest.downloadUrl.isBlank()) {
                throw UpdateInstallException("The manifest has no download URL")
            }
            val request = Request.Builder().url(manifest.downloadUrl).get().build()
            val response = try {
                http.newCall(request).execute()
            } catch (error: IOException) {
                throw UpdateInstallException(
                    "The download failed: ${error.message ?: "network error"}",
                    error,
                )
            }
            response.use {
                if (!it.isSuccessful) {
                    throw UpdateInstallException(
                        "The download failed (HTTP ${it.code}) for ${manifest.downloadUrl}",
                    )
                }
                val body = it.body ?: throw UpdateInstallException("The download returned no body")
                val total = body.contentLength().takeIf { length -> length > 0 }
                    ?: manifest.sizeBytes.takeIf { size -> size > 0 }
                val target = File(context.cacheDir, "update-${manifest.versionCode}.apk")
                val digest = MessageDigest.getInstance("SHA-256")
                var read = 0L
                body.byteStream().use { input ->
                    target.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            output.write(buffer, 0, count)
                            digest.update(buffer, 0, count)
                            read += count
                            if (total != null && total > 0) {
                                onProgress((read.toDouble() / total).toFloat())
                            } else {
                                onProgress(null)
                            }
                        }
                    }
                }

                val expected = manifest.sha256.trim().lowercase()
                if (expected.isNotEmpty()) {
                    val actual = digest.digest().joinToString("") { byte -> "%02x".format(byte) }
                    if (actual != expected) {
                        target.delete()
                        throw UpdateInstallException(
                            "The downloaded APK does not match the manifest hash " +
                                "(expected $expected, got $actual) — nothing was installed.",
                        )
                    }
                }
                onProgress(1f)
                target
            }
        }

    /**
     * Hand the APK to the system installer.
     *
     * `PackageInstaller` with the default flags ALWAYS asks the user — silent
     * install is impossible for a sideloaded app, and pretending otherwise is
     * the classic way to ship an update that never lands.
     */
    suspend fun install(apk: File): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val installer = context.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            params.setAppPackageName(context.packageName)
            params.setSize(apk.length())
            val sessionId = installer.createSession(params)
            try {
                installer.openSession(sessionId).use { session ->
                    session.openWrite("package", 0, apk.length()).use { output ->
                        apk.inputStream().use { input ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                val count = input.read(buffer)
                                if (count < 0) break
                                output.write(buffer, 0, count)
                            }
                        }
                        session.fsync(output)
                    }
                    val intent = Intent(context, InstallResultReceiver::class.java)
                    val pending = PendingIntent.getBroadcast(
                        context,
                        sessionId,
                        intent,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
                    )
                    session.commit(pending.intentSender)
                }
            } catch (error: Exception) {
                installer.abandonSession(sessionId)
                throw UpdateInstallException(
                    "The system installer refused the APK: ${error.message ?: "unknown error"}",
                    error,
                )
            }
        }
    }
}
