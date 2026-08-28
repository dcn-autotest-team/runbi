---
name: build-runbi-desktop
description: Build the Runbi Tauri 2 desktop client (Rust) on Windows. Use when asked to compile, build, or package the Runbi desktop app, or when a Tauri/Rust build fails with dlltool, windres, Smart App Control (os error 4551), icon, or clipboard errors. Covers environment setup, known code/config fixes, and producing runbi-desktop.exe plus installers.
---

# Build Runbi Desktop (Tauri 2 + Rust) on Windows

Builds `desktop/` — a Tauri 2.x + React 18 + Tailwind desktop client — into
`desktop/src-tauri/target/release/runbi-desktop.exe` and optional MSI/NSIS installers.

This is a **GNU toolchain** machine (`stable-x86_64-pc-windows-gnu`). The MSVC
toolchain is NOT usable here (VS2022 has no VC++ Build Tools workload). Do not
switch to MSVC; fix the GNU path instead.

## When to use
- "编译/构建 Runbi 桌面端", "build the desktop app", "tauri build"
- Any of these failures while building `desktop/`:
  - `dlltool not found` / `dlltool could not create import library`
  - `应用程序控制策略已阻止此文件 (os error 4551)`
  - `windres: preprocessing failed`
  - `icon ... is not RGBA` / `icon file does not contain icon data`
  - `no method named clipboard()` in `commands/*.rs`
  - store plugin `invalid type: map, expected unit` panic at runtime

## Prerequisites (check once)
```powershell
node --version; npm --version; rustc --version; cargo --version
# Expect: node present, rustc/cargo from rustup GNU toolchain
Test-Path C:\msys64\mingw64\bin\as.exe   # must be True (MSYS2 binutils)
```
If `C:\msys64\mingw64\bin` is missing or lacks `as.exe`, the whole approach
breaks — stop and tell the user MSYS2 MinGW-w64 is required.

## Step 0 — Smart App Control (SAC)
SAC blocks Cargo's unsigned build scripts → `os error 4551`. Check state:
```powershell
(Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy).VerifiedAndReputablePolicyState
```
- `1` = SAC active → **cannot bypass programmatically**. Ask the user to turn it
  off via *Windows Security → Device security → Kernel isolation → Memory
  integrity / Smart App Control*, then re-check until it reads `0`.
- `0` = OK, proceed.

## Step 1 — Frontend deps + build
```powershell
cd D:\agent\agv\runbi
npm install --include=dev          # workspace hoists deps to root node_modules
cd desktop
npm run build                       # tsc && vite build -> desktop/dist
```
Verify `desktop/dist/index.html` exists. Tauri CLI lives at
`D:\agent\agv\runbi\node_modules\@tauri-apps\cli\tauri.js` (hoisted).

## Step 2 — Set the PATH (critical, every build command)
Both dirs are REQUIRED and in this order:
```powershell
$env:PATH = "C:\msys64\mingw64\bin;" +
  "C:\Users\54191\.rustup\toolchains\stable-x86_64-pc-windows-gnu\lib\rustlib\x86_64-pc-windows-gnu\bin\self-contained;" +
  $env:PATH
```
Why:
- `mingw64/bin` provides working `windres`/`gcc`/`cpp` AND the DLLs that
  `cc1.exe` needs (without them cc1 dies with `STATUS_DLL_NOT_FOUND` and
  windres reports "preprocessing failed"). It also supplies `as.exe` so GNU
  `dlltool` can create import libraries.
- `self-contained` provides the Rust-bundled `dlltool.exe`/`ld.exe` for linking.

## Step 3 — Compile check first (fast)
```powershell
cd D:\agent\agv\runbi\desktop\src-tauri
cargo check --release
```
Fix any `error[...]` before the full build. Known fixes already applied to this
repo (re-apply if reverted):
- `commands/selection.rs` & `commands/replacer.rs`: add
  `use tauri_plugin_clipboard_manager::ClipboardExt;`
- `selection.rs`: `clipboard.read_text().unwrap_or_default()` (single call, not doubled)
- `replacer.rs`: restore block uses `if !original_clip.is_empty() { ... }`
  (original_clip is a String, not Option)

## Step 4 — Icons (only if they fail)
`tauri::generate_context!` requires `icons/icon.png` to be RGBA and
`icons/icon.ico` to be a real multi-size ICO. If either is broken:
```powershell
cd D:\agent\agv\runbi\desktop\src-tauri\icons
python -c "from PIL import Image; im=Image.open('icon.png').convert('RGBA'); im.save('icon.png')"
python -c "from PIL import Image; s=Image.open('icon.png').convert('RGBA'); [s.resize((x,x)) for x in (16,24,32,48,64,128)]; s.save('icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128)])"
```
(Back up originals as `*.bak` first.)

## Step 5 — Build
```powershell
cd D:\agent\agv\runbi\desktop
# exe only (skips installer download):
node ..\node_modules\@tauri-apps\cli\tauri.js build --no-bundle
# exe + installers (downloads WiX ~70MB; needs good network):
node ..\node_modules\@tauri-apps\cli\tauri.js build
```

## Step 6 — Verify
```powershell
$p = Start-Process .\target\release\runbi-desktop.exe -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 4
if (-not $p.HasExited) { Write-Host "RUNNING OK"; Stop-Process -Id $p.Id -Force }
else { Write-Host "EXITED $($p.ExitCode)" }
```

## Outputs
- Exe: `desktop/src-tauri/target/release/runbi-desktop.exe`
- Installers: `desktop/src-tauri/target/release/bundle/msi|nsis/`

## Runtime config gotcha
`tauri.conf.json` → `"plugins": { "store": null }` (NOT `{}`). The store plugin
Builder takes no config; `{}` causes a startup panic
`invalid type: map, expected unit`.

## Troubleshooting quick table
| Symptom | Cause | Fix |
|---|---|---|
| `os error 4551` on build-script-build | SAC active | User disables SAC (Step 0) |
| `dlltool not found` | self-contained dir not on PATH | Add it (Step 2) |
| `dlltool could not create import library` | missing `as.exe` | Ensure mingw64/bin on PATH |
| `windres: preprocessing failed` | cc1 missing DLLs | Ensure mingw64/bin on PATH |
| `icon ... is not RGBA` | icon.png lacks alpha | Convert to RGBA (Step 4) |
| `does not contain icon data` | icon.ico corrupt/PNG-in-ico | Regenerate ICO (Step 4) |
| `no method named clipboard()` | missing trait import | Add ClipboardExt (Step 3) |
| store panic at launch | `"store": {}` | Set `"store": null` |
