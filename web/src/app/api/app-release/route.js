import androidRelease from '../../../data/android-release.json'

// Public manifest for the ImgVault Android updater (simple convenient updater:
// check versionCode, download the APK, verify SHA-256, install via the system
// prompt). No auth — this is public release metadata, like
// /api/releases/latest-assets. The release workflow updates
// src/data/android-release.json when a new APK is published; the web app
// redeploys on push, so the manifest updates with it.
export async function GET() {
  return Response.json(androidRelease, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
