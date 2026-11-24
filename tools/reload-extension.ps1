# reloads the unpacked ImgVault extension INCLUDING manifest.json changes.
# (same pattern as blindspot tools/reload-extension.ps1: Extensions Reloader
# only toggles management.setEnabled and never re-reads the manifest, so
# manifest bumps used to need a manual edge://extensions click. this rebuilds
# dist, then opens the loader page, which messages bg to blank its tab +
# self-reload. version source of truth is nextgen-extension/public/manifest.json.)
$extId = "cjialghkacooiecjckibhcifilfiibnn"
$cdpPortFile = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data\DevToolsActivePort'

# RELOAD GUARD (2.19.40): never reload while an upload is active. A reload
# kills the page's upload chain and wipes the SW vault session key — on
# 2026-11-24 a reload landed while the 381 MB vault upload was stuck at 74%
# and destroyed the only chain that could have reconciled its result. The
# guard probes chrome.storage.local (uploadActive) through the extension
# and FAILS LOUDLY when an upload is in flight. Clear the flag only after
# the upload is proven dead or complete — never to get past this check.
$edgeRunning = (Test-Path $cdpPortFile) -or (Get-Process msedge -ErrorAction SilentlyContinue)
if (-not $edgeRunning) {
  Write-Host "Reload guard: Edge is not running (no DevToolsActivePort, no msedge process) - no live upload can exist. Proceeding." -ForegroundColor Yellow
} else {
  $probeScript = Join-Path $PSScriptRoot 'probe-upload-state.py'
  $OutputEncoding = [Text.UTF8Encoding]::new($false)
  $probeOutput = Get-Content -Raw $probeScript | browser-use 2>&1
  $stateMatch = $probeOutput | Select-String -Pattern 'UPLOAD_STATE:' | Select-Object -Last 1
  $errorMatch = $probeOutput | Select-String -Pattern 'UPLOAD_STATE_ERROR:' | Select-Object -Last 1
  if ($stateMatch) {
    $stateLine = $stateMatch.Line
    $stateJson = $stateLine.Substring($stateLine.IndexOf('UPLOAD_STATE:') + 'UPLOAD_STATE:'.Length).Trim()
    $state = $null
    try { $state = $stateJson | ConvertFrom-Json } catch { $state = $null }
    if (-not $state) {
      Write-Error "Reload guard: probe returned unparseable state ($stateJson) - refusing to reload. Verify the upload state by hand (open chrome-extension://$extId/probe-upload-state.html) and re-run."
      exit 1
    }
    if ($state.uploadActive) {
      $what = $state.runFileName
      if (-not $what) { $what = $state.uploadStatus }
      if (-not $what) { $what = 'unknown file' }
      Write-Error "Reload guard: REFUSING to reload - an upload is ACTIVE ($what; run $($state.runKind)/$($state.runStatus)). Reloading now would kill the upload chain and lock the vault. Wait for it to finish, or clear uploadActive ONLY after proving the upload dead or complete, then re-run."
      exit 1
    }
    Write-Host "Reload guard: no upload active (uploadActive=false). Proceeding." -ForegroundColor Green
  } elseif ($errorMatch) {
    Write-Error "Reload guard: the upload-state probe FAILED ($($errorMatch.Line.Trim())) - refusing to reload while the state is unknown. Fix the probe (is Edge's remote-debugging toggle on?) or verify by hand that no upload is active, then re-run."
    exit 1
  } else {
    Write-Error "Reload guard: the upload-state probe produced no result (browser-use output had no UPLOAD_STATE line) - refusing to reload while the state is unknown."
    exit 1
  }
}

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
if (Test-Path $cdpPortFile) {
  try {
    $script = "cdp('Target.createTarget', url='chrome-extension://$extId/reload.html', background=True)"
    $script | browser-use | Out-Null
    Write-Host "Triggered extension reload via CDP background target." -ForegroundColor Green
  } catch {
    Start-Process "msedge" -ArgumentList "chrome-extension://$extId/reload.html"
  }
} else {
  Start-Process "msedge" -ArgumentList "chrome-extension://$extId/reload.html"
}
