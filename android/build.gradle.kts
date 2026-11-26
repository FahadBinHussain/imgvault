// Top-level build file for the ImgVault Android app.
//
// The whole app is ONE module (:app) on purpose: the shared code with the
// Chrome extension lives in the repo root's packages/ (JS), and this app is
// a separate Kotlin codebase — no Gradle multi-module ceremony needed for it.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
