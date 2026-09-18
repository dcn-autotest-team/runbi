# Build release with updater signature and NSIS installer
$ErrorActionPreference = 'Stop'

$keyPath = 'C:\Users\54191\.tauri\runbi-updater.key'
$passwordPath = 'C:\Users\54191\.tauri\runbi-updater.password.clixml'

if (-not (Test-Path $keyPath) -or -not (Test-Path $passwordPath)) {
    throw "Updater key or password file missing"
}

$securePassword = Import-Clixml -LiteralPath $passwordPath
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
    $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -LiteralPath $keyPath -Raw
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
    
    Push-Location "desktop"
    try {
        node ..\node_modules\@tauri-apps\cli\tauri.js build --bundles nsis
    } finally {
        Pop-Location
    }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}
