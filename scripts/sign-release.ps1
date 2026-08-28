# Sign a Windows release artifact with signtool (SHA-256 + RFC3161 timestamp).
# Usage: .\sign-release.ps1 -Pfx <path> -Password <pwd> -Target <exe|msi>
param(
  [Parameter(Mandatory = $true)][string]$Pfx,
  [Parameter(Mandatory = $true)][string]$Password,
  [Parameter(Mandatory = $true)][string]$Target
)

$ErrorActionPreference = 'Stop'
$signtool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\x64\\' } | Select-Object -First 1
if (-not $signtool) { $signtool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter signtool.exe | Select-Object -First 1 }
if (-not $signtool) { throw 'signtool.exe not found (install Windows SDK)' }

if (-not (Test-Path $Target)) { throw "Target not found: $Target" }

Write-Host "Signing $Target with $($signtool.FullName)"
& $signtool.FullName sign /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com /f $Pfx /p $Password $Target
if ($LASTEXITCODE -ne 0) { throw "signtool failed with exit code $LASTEXITCODE" }

Write-Host "Verify (warning is expected for self-signed certs: 'root certificate not trusted')"
& $signtool.FullName verify /pa /v $Target
Write-Host @"
Done. NOTE: self-signed certs warn on other machines. For silent local install:
  Import-Certificate -FilePath C:\Users\54191\.runbi-keys\runbi-codesign.cer -CertStoreLocation Cert:\CurrentUser\Root
For production, use an OV/EV certificate (see docs/release.md)."
@"
