# 润笔 (Runbi) 桌面客户端 (Desktop Client)

> **轻划选词，妙笔生花 —— 全场景桌面级 AI 润色助手**  
> 基于 **Tauri 2.x + Rust + React 18 + Tailwind CSS** 构建，采用 **"共享核心层 + 平台适配器 (Shared Core + Platform Adapters)"** 现代化多端架构。

---

## 📌 产品定位与核心特性

Runbi 桌面客户端打破了传统浏览器插件的沙盒限制，将精准的 AI 文本润色与文采修饰能力拓展至整个操作系统（VSCode、Word、飞书、微信、邮件客户端、各类 IDE 与 PDF 阅读器等）：

1. **🖱️ 鼠标划选即时唤醒（对齐豆包 / Cherry Studio 体验）**
   - 底层集成 Windows 低级鼠标钩子 (`WH_MOUSE_LL`)，在任何应用中划选文本（或双击选词）松开鼠标后，浮窗自动在光标旁弹出并开始流式润色，**无需按任何键**。
2. **⚡ 全局快捷键与自定义录制 (Global Hotkey)**
   - 默认全局热键 `Ctrl+Shift+Space`，支持在设置面板中直接按下键盘录制自定义快捷键，Rust 后台动态注册与持久化。
3. **🪄 一键贴回原文 (In-place Text Replacement)**
   - 润色满意后，点击“替换原文”或按 `Enter` 键，浮窗自动隐匿并将新文本通过模拟粘贴无缝替换回原应用。
4. **🌐 Rust 原生流式直连 (Reqwest IPC)**
   - 绕过 WebView 浏览器的跨域 (CORS/CSP) 限制，支持 DeepSeek、硅基流动、OpenAI 及本地 Ollama。
   - 智能识别 401/402/404/429 错误并提供中文操作指引，留空 Key 时自动启用零配置离线 Mock 模拟流。
5. **🪟 Raycast / Spotlight 风格沉浸悬浮窗 (Glassmorphism UI)**
   - 无边框（Frameless）、半透明毛玻璃质感、黑暗模式自适应。
6. **🎯 智能屏幕边缘避让 (Smart Edge Clamping)**
   - 基于 Win32 `GetCursorPos` 全局光标与多显示器工作区检测，屏幕下/右边缘自动翻转，防溢出、防遮挡原文字行。
7. **🛡️ 剪贴板无害化保护 (Clipboard Isolation)**
   - 划词取词毫秒级自动备份并还原用户的系统剪贴板，绝不污染用户原本复制的历史记录。

---

## 🏗️ 架构分层设计

```
┌────────────────────────────────────────────────────────┐
│               Presentation Layer (React 18)            │
│  - App.tsx (Raycast 悬浮主窗口 & 快捷键录制)           │
│  - @runbi/shared/components (PolishPanel, DiffViewer)  │
└──────────────────────────┬─────────────────────────────┘
                           │ 消费平台抽象接口
┌──────────────────────────▼─────────────────────────────┐
│          Desktop Platform Adapters (src/adapters/)     │
│  - TauriSelectionProvider (Win32 选区读取)             │
│  - TauriTextReplacer (剪贴板 + 模拟粘贴回写)           │
│  - TauriStorageProvider (tauri-plugin-store 本地存储)  │
│  - TauriIPCLLMTransport (Rust Reqwest 流式直连 IPC)    │
└──────────────────────────┬─────────────────────────────┘
                           │ 异步 IPC 通信 (Channel & Commands)
┌──────────────────────────▼─────────────────────────────┐
│             Native Core (src-tauri / Rust)             │
│  - mouse_hook.rs (WH_MOUSE_LL 全局划词自动监听)        │
│  - transport.rs (Reqwest SSE 流式直连与网络诊断)       │
│  - position.rs (GetCursorPos 多显示器智能边缘贴合)     │
│  - replacer.rs (SendInput 模拟粘贴与剪贴板隔离保护)    │
│  - shortcut.rs (全局热键动态注册与录制持久化)          │
│  - tray.rs (系统托盘生命周期管理)                      │
└────────────────────────────────────────────────────────┘
```

---

## 🚀 快速开始与本地开发

### 1. 环境准备
- **Node.js**: >= 18.0.0
- **Rust**: >= 1.75.0 (`rustup default stable`)
- **操作系统**: Windows 10/11 (Edge WebView2) / macOS 11+ / Linux

### 2. 本地启动开发环境
```powershell
cd desktop

# 安装依赖
npm install

# 启动开发环境（前端 Vite + Rust 原生浮窗）
npm run tauri dev
```

### 3. 生产打包构建
```powershell
cd desktop

# 一键全量编译（产出绿色单文件与安装包）
npm run tauri build
```

产物路径：
* **绿色便携版 (.exe)**：`desktop/src-tauri/target/release/runbi-desktop.exe`
* **Windows 安装包 (NSIS)**：`desktop/src-tauri/target/release/bundle/nsis/Runbi_1.0.0_x64-setup.exe`
* **企业分发包 (MSI)**：`desktop/src-tauri/target/release/bundle/msi/Runbi_1.0.0_x64_en-US.msi`

---

## ⌨️ 默认快捷键

| 快捷键 | 功能说明 |
| :--- | :--- |
| **鼠标划选** | 在任意应用中划选文本，松开鼠标立即弹出润色（豆包体验，无需按键） |
| `Ctrl + Shift + Space` | 全局手动唤醒 / 隐藏 Runbi 悬浮润色窗口（支持自定义录制） |
| `Enter` | 确认润色并将结果直接替换贴回原窗口 |
| `Esc` | 立即隐藏悬浮窗口并停止生成 |
| `1` ~ `7` | 快速切换对应润色风格（通用/学术/商务/文采/精简/英文/回复） |

---

## 📄 许可证
MIT License. Part of the **Runbi (润笔)** Multi-Platform Ecosystem.
