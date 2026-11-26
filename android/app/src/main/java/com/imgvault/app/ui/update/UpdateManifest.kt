package com.imgvault.app.ui.update

import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * The update manifest served by the web app at `GET /api/app-release`.
 *
 * The server owns the floor: `minSupportedVersionCode` is the OLDEST build
 * the server still accepts. A client below that floor is not "outdated" — it
 * is REFUSED, and the app must not pretend otherwise: the update screen goes
 * into a blocking state where the only way out is the new build.
 *
 * The floor is NEVER derived from the build being published. It is carried
 * over and only raised by an explicit edit of the manifest file.
 */
data class UpdateManifest(
    val app: String = "",
    val available: Boolean = false,
    val downloadUrl: String = "",
    val minSupportedVersionCode: Int = 0,
    val notes: String = "",
    val sha256: String = "",
    val sizeBytes: Long = 0,
    val versionCode: Int = 0,
    val versionName: String = "",
) {
    /** the floor only bites when the server actually set one */
    val hasFloor: Boolean
        get() = minSupportedVersionCode > 0

    companion object {
        const val DEFAULT_URL = "https://imgvaultt.vercel.app/api/app-release"

        fun parse(body: String): UpdateManifest {
            val root = Json.parseToJsonElement(body).jsonObject
            return UpdateManifest(
                app = root.string("app"),
                available = root.string("available").equals("true", ignoreCase = true),
                downloadUrl = root.string("downloadUrl"),
                minSupportedVersionCode = root.string("minSupportedVersionCode").toIntOrNull() ?: 0,
                notes = root.string("notes"),
                sha256 = root.string("sha256").lowercase(),
                sizeBytes = root.string("sizeBytes").toLongOrNull() ?: 0L,
                versionCode = root.string("versionCode").toIntOrNull() ?: 0,
                versionName = root.string("versionName"),
            )
        }

        private fun JsonObject.string(key: String): String =
            this[key]?.jsonPrimitive?.content.orEmpty()
    }
}

/** the manifest could not be read — the message names the URL and why */
class UpdateManifestException(message: String, cause: Throwable? = null) : Exception(message, cause)

class UpdateService(
    private val http: OkHttpClient,
    private val manifestUrl: String = UpdateManifest.DEFAULT_URL,
) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun fetch(): UpdateManifest = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(manifestUrl)
            .addHeader("Accept", "application/json")
            .addHeader("X-App-Client", "imgvault-android")
            .get()
            .build()
        val response = try {
            http.newCall(request).execute()
        } catch (error: IOException) {
            throw UpdateManifestException(
                "Could not reach the update manifest at $manifestUrl: ${error.message ?: "network error"}",
                error,
            )
        }
        response.use {
            val body = it.body?.string().orEmpty()
            if (!it.isSuccessful) {
                throw UpdateManifestException(
                    "The update manifest at $manifestUrl answered HTTP ${it.code}: ${body.take(200)}",
                )
            }
            try {
                UpdateManifest.parse(body)
            } catch (error: Exception) {
                throw UpdateManifestException(
                    "The update manifest at $manifestUrl is not readable: ${error.message}",
                    error,
                )
            }
        }
    }
}
