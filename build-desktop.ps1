# Runbi Desktop 一键编译脚本 (Tauri 2 + Rust)
# 前置条件: 系统 Smart App Control 已关闭或已放行 Cargo 构建脚本
# 运行:  powershell -ExecutionPolicy Bypass -File .\build-desktop.ps1

$ErrorActionPreference = "Stop"

# GNU 工具链自带 self-contained binutils, 提供 dlltool 解决 "dlltool not found"
$gnuBin = "C:\Users\54191\.rustup\toolchains\stable-x86_64-pc-windows-gnu\lib\rustlib\x86_64-pc-windows-gnu\bin\self-contained"
if (Test-Path $gnuBin) {
    $env:PATH = "$gnuBin;" + $env:PATH
    Write-Host "[+] 已加入 GNU dlltool 到 PATH: $gnuBin"
} else {
    Write-Warning "[-] 未找到 GNU self-contained binutils, dlltool 可能缺失"
}

# 确认 tauri CLI 可见(由根 node_modules 提升)
$tauriCli = "D:\agent\agv\runbi\node_modules\@tauri-apps\cli\tauri.js"
if (-not (Test-Path $tauriCli)) {
    Write-Host "[!] 未找到 tauri CLI, 先安装前端依赖"
    Push-Location "D:\agent\agv\runbi"
    try { npm install --include=dev } finally { Pop-Location }
} else {
    Write-Host "[+] tauri CLI 就绪"
}

Write-Host "`n=== 开始 Tauri 构建(前端 + Rust release)==="
Push-Location "D:\agent\agv\runbi\desktop"
try {
    node "D:\agent\agv\runbi\node_modules\@tauri-apps\cli\tauri.js" build
    Write-Host "`n=== 构建完成 ==="
} finally {
    Pop-Location
}

# 提示产物位置
Write-Host ""
Write-Host "产物位置:"
Write-Host "  Desktop 可执行: desktop\src-tauri\target\release\runbi-desktop.exe"
Write-Host "  安装包(NSIS/MSI): desktop\src-tauri\target\release\bundle\"
