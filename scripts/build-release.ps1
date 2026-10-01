# Build release with updater signature, NSIS installer, and automated update manifest
param(
    [switch]$Publish,
    [string]$Notes = ""
)

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

# --- Post-build: Extract version, verify artifacts, and generate latest.json ---
$pkg = Get-Content -LiteralPath "desktop/package.json" -Raw | ConvertFrom-Json
$version = $pkg.version

$bundleDir = "desktop/src-tauri/target/release/bundle/nsis"
$setupExe = Join-Path $bundleDir "Runbi_${version}_x64-setup.exe"
$sigFile = Join-Path $bundleDir "Runbi_${version}_x64-setup.exe.sig"
$latestJsonFile = Join-Path $bundleDir "latest.json"

if (-not (Test-Path $setupExe) -or -not (Test-Path $sigFile)) {
    throw "Build artifacts missing: $setupExe or $sigFile"
}

$sigContent = (Get-Content -LiteralPath $sigFile -Raw).Trim()
$pubDate = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")

if ([string]::IsNullOrWhiteSpace($Notes)) {
    $Notes = "Runbi $version"
}

$manifest = [ordered]@{
    version   = $version
    notes     = $Notes
    pub_date  = $pubDate
    url       = "https://github.com/dcn-autotest-team/runbi-updates/releases/download/v$version/Runbi_${version}_x64-setup.exe"
    signature = $sigContent
}

$manifestJson = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText((Resolve-Path $latestJsonFile), $manifestJson, [System.Text.UTF8Encoding]::new($false))
Write-Host "Generated update manifest: $latestJsonFile" -ForegroundColor Green

if ($Publish) {
    Write-Host "Publishing release v$version to dcn-autotest-team/runbi-updates..." -ForegroundColor Cyan
    gh release create "v$version" --repo dcn-autotest-team/runbi-updates --target main `
        --title "Runbi $version" --notes $Notes --latest `
        $setupExe $sigFile $latestJsonFile
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to publish release to GitHub"
    }
    Write-Host "Successfully published v$version to dcn-autotest-team/runbi-updates!" -ForegroundColor Green
}
