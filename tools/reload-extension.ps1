# reloads the unpacked ImgVault extension INCLUDING manifest.json changes.
# (same pattern as blindspot tools/reload-extension.ps1: Extensions Reloader
# only toggles management.setEnabled and never re-reads the manifest, so
# manifest bumps used to need a manual edge://extensions click. this rebuilds
# dist, then opens the loader page, which messages bg to blank its tab +
# self-reload. version source of truth is nextgen-extension/public/manifest.json.)
Push-Location "$PSScriptRoot\..\nextgen-extension"
try {
  pnpm build
} finally {
  Pop-Location
}
$extId = "cjialghkacooiecjckibhcifilfiibnn"
Start-Process "msedge" -ArgumentList "chrome-extension://$extId/reload.html"
