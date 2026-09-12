# Post-build script to copy icons and manifest
Write-Host "Running post-build tasks..." -ForegroundColor Cyan

# Copy manifest.json (source of truth is public/manifest.json; the root
# manifest.json is a stale leftover that must not overwrite it)
Write-Host "Copying manifest.json..." -ForegroundColor Yellow
Copy-Item -Path "public/manifest.json" -Destination "dist/manifest.json" -Force

# Copy flickr-fix.css
Write-Host "Copying flickr-fix.css..." -ForegroundColor Yellow
Copy-Item -Path "flickr-fix.css" -Destination "dist/flickr-fix.css" -Force

# Copy slideshare-fix.css
Write-Host "Copying slideshare-fix.css..." -ForegroundColor Yellow
Copy-Item -Path "slideshare-fix.css" -Destination "dist/slideshare-fix.css" -Force

# Copy rajce-fix.css
Write-Host "Copying rajce-fix.css..." -ForegroundColor Yellow
Copy-Item -Path "rajce-fix.css" -Destination "dist/rajce-fix.css" -Force

# Copy contextmenu-unlock.js
Write-Host "Copying contextmenu-unlock.js..." -ForegroundColor Yellow
Copy-Item -Path "src/content/contextmenu-unlock.js" -Destination "dist/contextmenu-unlock.js" -Force

# Copy scene-viewer.js: declared as a concrete web_accessible_resources entry in
# the manifest, but it is a plain (non-bundled) file under src/. vite only emits
# the hashed sceneViewer-*.js for the scene-viewer.html entry, so without this
# copy the built folder is missing a declared resource and Chromium flags the
# extension CORRUPTED (enable flips back off on refresh).
Write-Host "Copying scene-viewer.js..." -ForegroundColor Yellow
Copy-Item -Path "src/scene-viewer.js" -Destination "dist/scene-viewer.js" -Force

# Copy icons folder
Write-Host "Copying icons..." -ForegroundColor Yellow
if (Test-Path "dist/icons") {
    Remove-Item -Path "dist/icons" -Recurse -Force
}
Copy-Item -Path "icons" -Destination "dist/icons" -Recurse -Force

Write-Host "Post-build tasks completed!" -ForegroundColor Green
