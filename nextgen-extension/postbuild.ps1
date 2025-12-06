# Post-build script to copy icons and manifest
Write-Host "Running post-build tasks..." -ForegroundColor Cyan

# Copy manifest.json
Write-Host "Copying manifest.json..." -ForegroundColor Yellow
Copy-Item -Path "manifest.json" -Destination "dist/manifest.json" -Force

# Copy flickr-fix.css
Write-Host "Copying flickr-fix.css..." -ForegroundColor Yellow
Copy-Item -Path "flickr-fix.css" -Destination "dist/flickr-fix.css" -Force

# Copy icons folder
Write-Host "Copying icons..." -ForegroundColor Yellow
if (Test-Path "dist/icons") {
    Remove-Item -Path "dist/icons" -Recurse -Force
}
Copy-Item -Path "icons" -Destination "dist/icons" -Recurse -Force

Write-Host "Post-build tasks completed!" -ForegroundColor Green
