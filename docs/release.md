# Runbi Desktop 发布流程 (Windows)

## 0. 前置条件
- 更新签名密钥(已生成,私钥**不在仓库内**):
  - 私钥: `C:\Users\54191\.runbi-keys\runbi-updater.key`
  - 公钥: 已写入 `desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
  - ⚠️ 私钥丢失 = 已发出去的客户端无法再自动更新,务必备份
- 签名证书(见 §3)

## 1. 构建
```powershell
cd desktop
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "C:\Users\54191\.runbi-keys\runbi-updater.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
node ..\node_modules\@tauri-apps\cli\tauri.js build
```

> ⚠️ **坑：在 LobsterAI cowork 会话里跑构建**，其 `node` shim 会让 `process.argv[0]`
> 变成 `D:\LobsterAI\LobsterAI.exe`，tauri CLI 报 `unrecognized subcommand`。
> 此时必须用真实 node 全路径：
> `& "C:\Program Files\nodejs\node.exe" ..\node_modules\@tauri-apps\cli\tauri.js build`
> （用户自己的终端 / npm 均不受影响）

构建时代码签名已配置（`tauri.conf.json → bundle.windows.certificateThumbprint`，
证书 `CN=Runbi Dev`，指纹 `E31B0322...`），安装包自动带 Authenticode 签名。
若 updater `.sig` 未生成（CLI 曾在无 TTY 时卡密码提示），补签：

```powershell
& "C:\Program Files\nodejs\node.exe" ..\node_modules\@tauri-apps\cli\tauri.js signer sign `
  -k (Get-Content "C:\Users\54191\.runbi-keys\runbi-updater.key" -Raw) "<安装包路径>"
```

注意：`-k` 传**密钥内容**（不是路径）；一次只收一个 `<FILE>`；密码为空时直接回车。
产物:
- `target\release\bundle\nsis\Runbi_<ver>_x64-setup.exe`  ← 主分发安装包
- `target\release\bundle\msi\Runbi_<ver>_x64_en-US.msi`
- NSIS 目录下同时生成 `*.exe.sig`(minisign 签名,供 updater 校验)

## 2. 版本号(三处同步)
- `desktop/src-tauri/tauri.conf.json` → `version`
- `desktop/src-tauri/Cargo.toml` → `version`
- `desktop/package.json`(如有)

## 3. 代码签名
当前状态:**自签测试证书**(本机信任后无告警,他人机器 SmartScreen 仍会提示)。

一次性创建自签证书:
```powershell
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=Runbi" -CertStoreLocation Cert:\CurrentUser\My
$pwd = ConvertTo-SecureString -String "<导出密码>" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath "C:\Users\54191\.runbi-keys\runbi-codesign.pfx" -Password $pwd
```

签名安装包:
```powershell
.\scripts\sign-release.ps1 -Pfx "C:\Users\54191\.runbi-keys\runbi-codesign.pfx" -Password "<导出密码>" `
  -Target "desktop\src-tauri\target\release\bundle\nsis\Runbi_1.0.0_x64-setup.exe"
```

**正式产品化**:购买 OV/EV 代码签名证书(DigiCert/Sectigo/GlobalSign,EV 立刻消除 SmartScreen 告警),
或用 Azure Trusted Signing(按月计费,免管理证书文件)。拿到证书后把 `sign-release.ps1` 换成对应 PFX 即可,流程不变。

## 4. 发布 → 自动更新生效
1. `git tag v<版本> && git push --tags`
2. GitHub Releases 上传: `Runbi_<ver>_x64-setup.exe`、`*.exe.sig`、`latest.json`
3. `latest.json` 由 Tauri 生成(或在 CI 中用 `tauri-action` 自动生成),指向新安装包下载地址
4. 端点约定(已写入 tauri.conf.json):
   `https://github.com/dcn-autotest-team/runbi/releases/latest/download/latest.json`
5. 已安装用户在「设置 → 软件更新 → 检查更新」即可收到并一键安装

## 5. CI 建议(下一步)
用 `tauri-apps/tauri-action` GitHub Action:打 tag 自动构建 + 签名 + 生成 latest.json + 发 Release,
本地就不再需要手工构建。
