# Runbi Desktop Build Script (Tauri 2 + Rust)
$ErrorActionPreference = "Stop"

$gnuBin = "C:\Users\54191\.rustup\toolchains\stable-x86_64-pc-windows-gnu\lib\rustlib\x86_64-pc-windows-gnu\bin\self-contained"
if (Test-Path $gnuBin) {
    $env:PATH = "$gnuBin;" + $env:PATH
    Write-Host "[+] Added GNU dlltool to PATH: $gnuBin"
}

$tauriCli = "D:\agent\agv\runbi\node_modules\@tauri-apps\cli\tauri.js"
if (-not (Test-Path $tauriCli)) {
    Write-Host "[!] tauri CLI not found, installing root dependencies..."
    Push-Location "D:\agent\agv\runbi"
    try { npm install --include=dev } finally { Pop-Location }
} else {
    Write-Host "[+] tauri CLI ready"
}

Write-Host "`n=== Building Runbi Desktop (Frontend + Rust Release) ==="
Push-Location "D:\agent\agv\runbi\desktop"
try {
    node "D:\agent\agv\runbi\node_modules\@tauri-apps\cli\tauri.js" build
    Write-Host "`n=== Build Complete ==="
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Artifacts:"
Write-Host "  Desktop Exe: desktop\src-tauri\target\release\runbi-desktop.exe"
Write-Host "  Installer Bundle: desktop\src-tauri\target\release\bundle"
