package com.imgvault.app

import android.app.Application
import com.imgvault.app.core.ServiceLocator

class ImgVaultApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ServiceLocator.init(this)
    }
}
