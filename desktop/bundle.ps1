# Build the downloadable Windows app (a one-click installer) with its own Node inside.
# Run on a Windows PC with Rust (rustup, with the Visual Studio C++ build tools) and Node 22+:
#   powershell -ExecutionPolicy Bypass -File desktop\bundle.ps1
# Output: desktop\src-tauri\target\release\bundle\nsis\chamber-windows-x64-setup.exe
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "src-tauri")
New-Item -ItemType Directory -Force binaries | Out-Null
Copy-Item (Get-Command node).Source "binaries\node-x86_64-pc-windows-msvc.exe" -Force
npm --prefix ..\..\relay ci --silent
npm --prefix ..\..\ui ci --silent
npm --prefix ..\..\ui run build
$env:CHAMBER_NODE = (Get-Command node).Source
npx --yes "@tauri-apps/cli@2" build --bundles nsis
$out = "target\release\bundle\nsis"
Copy-Item "$out\Chamber_*_x64-setup.exe" "$out\chamber-windows-x64-setup.exe" -Force
Write-Host "Upload to R2: chamber/releases/stable/<version>/chamber-windows-x64-setup.exe"
