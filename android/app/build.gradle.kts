plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.imgvault.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.imgvault.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 11
        versionName = "1.0.10"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        // The release keystore comes from GitHub Actions secrets
        // (IMGVAULT_KEYSTORE_BASE64 / IMGVAULT_KEY_ALIAS / IMGVAULT_KEY_PASSWORD /
        // IMGVAULT_STORE_PASSWORD). It is NEVER in the repo — the CI job fails
        // loudly when a secret is missing instead of shipping a debug-signed
        // APK that the user's phone could never update.
        create("release") {
            val keystorePath = System.getenv("IMGVAULT_KEYSTORE_PATH")
            if (!keystorePath.isNullOrBlank() && file(keystorePath).exists()) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("IMGVAULT_STORE_PASSWORD")
                keyAlias = System.getenv("IMGVAULT_KEY_ALIAS")
                keyPassword = System.getenv("IMGVAULT_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // R8/shrinking stays OFF for V1: the first CI build must be a
            // reproducible green run, and a missing keep rule would only show
            // up as a runtime crash on the user's phone. Turn it on once the
            // app has instrumentation coverage.
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (System.getenv("IMGVAULT_KEYSTORE_PATH")?.let { file(it).exists() } == true) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    testOptions {
        unitTests {
            isReturnDefaultValues = true
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.security.crypto)
    implementation(libs.androidx.work.runtime.ktx)

    // Morph (androidx.graphics.shapes.Morph / RoundedPolygon) — the Material 3
    // Expressive wavy progress ring ported from the bolo-keyboard app.
    implementation(libs.androidx.graphics.shapes)

    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    implementation(libs.coil.compose)
    implementation(libs.coil.video)
    implementation(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.media3.ui)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.espresso)
}

