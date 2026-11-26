package com.imgvault.app.core

import android.content.Context
import com.imgvault.app.core.security.SecureStore
import com.imgvault.app.core.settings.SettingsRepository
import com.imgvault.app.data.GalleryRepository
import com.imgvault.app.data.VaultRepository
import java.io.File
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient

/**
 * The app's dependency graph — a hand-rolled service locator.
 *
 * No DI framework on purpose: the graph is small, the wiring is readable in
 * one file, and the build stays free of annotation processors (the release
 * pipeline has to stay reproducible on CI).
 */
object ServiceLocator {
    private lateinit var appContext: Context

    fun init(context: Context) {
        appContext = context.applicationContext
    }

    /** where the app keeps decrypted files that can be rebuilt (vault videos) */
    val cacheDir: File get() = appContext.cacheDir

    val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .build()
    }

    val secureStore: SecureStore by lazy { SecureStore(appContext) }

    val settings: SettingsRepository by lazy { SettingsRepository(appContext, secureStore) }

    val galleryRepository: GalleryRepository by lazy { GalleryRepository(settings, http) }

    val vaultRepository: VaultRepository by lazy { VaultRepository(settings, http) }
}
