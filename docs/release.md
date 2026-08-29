# Runbi Desktop 发布与自动更新手册

最后更新：2026-08-29。当前更新通道：<https://github.com/dcn-autotest-team/runbi-updates>。

## 当前状态与交接结论

- 已发布版本：`v1.0.1`，Release 同时包含 NSIS 安装包、Tauri `.sig` 和 `latest.json`。
- 源码仓库保持私有；`runbi-updates` 是公开的二进制分发仓库，不能上传源代码或私钥。
- `1.0.0` 内置的是旧私钥对应公钥和私有更新地址，无法信任新链路。用户需手动安装一次 `1.0.1`；从 `1.0.1` 起，后续发布可在应用内自动升级。

## 密钥与证书

| 用途 | 位置 | 规则 |
| --- | --- | --- |
| Tauri 更新私钥 | `C:\Users\54191\.tauri\runbi-updater.key` | 绝不提交、上传或粘贴到日志 |
| 更新私钥密码 | `C:\Users\54191\.tauri\runbi-updater.password.clixml` | Windows DPAPI，仅当前用户可解密 |
| 更新公钥 | `desktop/src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` | 可公开，必须与私钥匹配 |
| Windows 代码签名 | 证书指纹 `E31B0322E9D634FC9011931F7C57175CC6AEC7CF` | 构建时自动对 EXE/安装包签名 |

私钥丢失会使已安装客户端无法验证未来升级包；先在受控密码库备份私钥和密码文件，再开始下一次发布。

## 发布新版本

1. 同步版本号：

   - `desktop/package.json`
   - `desktop/src-tauri/Cargo.toml`
   - `desktop/src-tauri/tauri.conf.json`
   - `desktop/src-tauri/Cargo.lock` 的 `runbi-desktop` 条目

2. 在仓库根目录执行验证：

   ```powershell
   npm test -- --run
   cd desktop/src-tauri
   cargo test
   ```

3. 在 `desktop` 目录构建并生成 updater 签名。以下脚本不会输出私钥或密码：

   ```powershell
   $keyPath = 'C:\Users\54191\.tauri\runbi-updater.key'
   $passwordPath = 'C:\Users\54191\.tauri\runbi-updater.password.clixml'
   $securePassword = Import-Clixml -LiteralPath $passwordPath
   $passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
   try {
     $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -LiteralPath $keyPath -Raw
     $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
     npx tauri build --bundles nsis
   } finally {
     [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
     Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
     Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
   }
   ```

4. 确认构建产物（版本以 `1.0.2` 为例）：

   ```text
   desktop/src-tauri/target/release/bundle/nsis/Runbi_1.0.2_x64-setup.exe
   desktop/src-tauri/target/release/bundle/nsis/Runbi_1.0.2_x64-setup.exe.sig
   ```

5. 在同一目录创建 `latest.json`。当前产品仅支持 Windows，可用动态清单：

   ```json
   {
     "version": "1.0.2",
     "notes": "本版本更新说明。",
     "pub_date": "2026-08-29T12:00:00Z",
     "url": "https://github.com/dcn-autotest-team/runbi-updates/releases/download/v1.0.2/Runbi_1.0.2_x64-setup.exe",
     "signature": "完整复制 Runbi_1.0.2_x64-setup.exe.sig 的内容"
   }
   ```

6. 发布到公开分发仓库：

   ```powershell
   gh release create v1.0.2 --repo dcn-autotest-team/runbi-updates --target main `
     --title 'Runbi 1.0.2' --notes '本版本更新说明。' --latest `
     .\Runbi_1.0.2_x64-setup.exe `
     .\Runbi_1.0.2_x64-setup.exe.sig `
     .\latest.json
   ```

7. 用匿名网络验证，不能依赖本机 GitHub 登录态：

   ```powershell
   $manifest = curl.exe -fsSL https://github.com/dcn-autotest-team/runbi-updates/releases/latest/download/latest.json | ConvertFrom-Json
   $manifest.version
   $manifest.url
   curl.exe -fsSL -o .\verify.exe $manifest.url
   Get-AuthenticodeSignature .\verify.exe
   Get-FileHash .\verify.exe -Algorithm SHA256
   ```

## 发布前检查清单

- `latest.json` 的版本高于已发布版本，URL、`.sig` 和安装包文件名一致。
- 下载 URL 与 `latest.json` 都可匿名访问，HTTP 200。
- `Get-AuthenticodeSignature` 返回 `Valid`。
- `latest.json` 中的 `signature` 与 `.sig` 内容逐字一致。
- 不提交 `C:\Users\54191\.tauri\runbi-updater.key`、密码文件、安装包或签名私钥。

## 后续维护边界

- 客户端更新地址和公钥在 `desktop/src-tauri/tauri.conf.json`。
- 更新失败提示在 `desktop/src/components/UpdateCheckRow.tsx`；404、超时和签名失败均有明确中文提示。
- 需要 CI 时，在私有源码仓库配置 GitHub Actions Secrets 后再引入自动发布；当前手工流程已经可发布，避免把私钥放进公开仓库。
