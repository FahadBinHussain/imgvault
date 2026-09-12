# reloads the unpacked ImgVault extension INCLUDING manifest.json changes.
# (same pattern as blindspot tools/reload-extension.ps1: Extensions Reloader
# only toggles management.setEnabled and never re-reads the manifest, so
# manifest bumps used to need a manual edge://extensions click. this rebuilds
# dist, then opens the loader page, which messages bg to blank its tab +
# self-reload. version source of truth is nextgen-extension/public/manifest.json.)
Push-Location "$PSScriptRoot\..\nextgen-extension"
try {
  pnpm build
  $buildExit = $LASTEXITCODE
} finally {
  Pop-Location
}
# Never reload on a failed build: a partial dist (e.g. vite dying mid-transpile
# with esbuild ENOMEM) gets registered by the self-reload below and Chromium
# flags the whole extension CORRUPTED (disable_reasons=4), which then sticks —
# the enable toggle flips back off on every edge://extensions refresh until a
# manual re-load from a complete dist. Fail loudly instead.
if ($buildExit -ne 0) {
  Write-Error "pnpm build FAILED (exit $buildExit) - NOT reloading the extension. dist/ may be incomplete; fix the build and re-run."
  exit $buildExit
}
$extId = "cjialghkacooiecjckibhcifilfiibnn"
Start-Process "msedge" -ArgumentList "chrome-extension://$extId/reload.html"
