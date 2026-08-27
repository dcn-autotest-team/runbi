# 润笔 (Runbi) 桌面客户端 (Desktop Client)

> **轻划选词，妙笔生花 —— 全场景桌面级 AI 润色助手**  
> 基于 **Tauri 2.x + Rust + React 18 + Tailwind CSS** 构建，采用 **"共享核心层 + 平台适配器 (Shared Core + Platform Adapters)"** 现代化多端架构。

---

## 📌 产品定位与核心特性

Runbi 桌面客户端打破了传统浏览器插件的沙盒限制，将精准的 AI 文本润色与文采修饰能力拓展至整个操作系统（VSCode、Word、飞书、微信、邮件客户端、各类 IDE 与 PDF 阅读器等）：

1. **⚡ 全局快捷键即时唤醒 (Global Hotkey)**
   - 默认全局热键 `Alt+Space`，随叫随到，毫秒级响应唤起。
2. **🎯 系统级跨应用划词与文本捕获 (Selection Grab)**
   - 在任意软件中选中文本后按下热键，Rust 后台通过模拟事件读取目标文本，并在鼠标光标旁即时弹出悬浮面板。
3. **🪄 一键贴回原文 (In-place Text Replacement)**
   - 润色满意后，点击“替换原文”或按 `Enter` 键，浮窗自动隐匿并将新文本通过模拟粘贴（`Ctrl+V` / `Cmd+V`）无缝替换回原应用。
4. **🪟 Raycast / Spotlight 风格沉浸悬浮窗 (Glassmorphism UI)**
   - 无边框（Frameless）、半透明毛玻璃质感、黑暗模式自适应、失焦自动隐藏（Focus Loss Auto-Hide）。
5. **🎛️ 常驻系统托盘与单实例守护 (System Tray Daemon)**
   - 支持开机自启、托盘菜单控制，集成单实例检测（`single-instance`），杜绝多开冲突。
6. **📦 共享核心与无重复逻辑 (@runbi/shared)**
   - 100% 复用与浏览器插件相同的 CJK Myers Diff 引擎、大模型 Prompt 预设模板、流式 Token 解析算法与 React 表现层组件。

---

## 🏗️ 架构分层设计

```
┌────────────────────────────────────────────────────────┐
│               Presentation Layer (React 18)            │
│  - App.tsx (Raycast 悬浮主窗口)                        │
│  - @runbi/shared/components (PolishPanel, DiffViewer)  │
└──────────────────────────┬─────────────────────────────┘
                           │ 消费平台抽象接口
┌──────────────────────────▼─────────────────────────────┐
│          Desktop Platform Adapters (src/adapters/)     │
│  - TauriSelectionProvider (Win32 SendInput 取词)       │
│  - TauriTextReplacer (剪贴板 + 模拟粘贴回写)           │
│  - TauriStorageProvider (本地持久化配置)               │
│  - TauriIPCLLMTransport (流式大模型网络传输)           │
└──────────────────────────┬─────────────────────────────┘
                           │ 异步 IPC 通信
┌──────────────────────────▼─────────────────────────────┐
│             Native Core (src-tauri / Rust)             │
│  - tauri-plugin-global-shortcut (热键注册)             │
│  - tauri-plugin-clipboard-manager (剪贴板读写)         │
│  - tauri-plugin-single-instance (单实例守护)           │
│  - commands (selection, replacer, position, transport) │
│  - tray (系统托盘生命周期管理)                         │
└────────────────────────────────────────────────────────┘
```

---

## 🚀 快速开始与本地开发

### 1. 环境准备
- **Node.js**: >= 18.0.0
- **Rust**: >= 1.75.0 (`rustup default stable`)
- **操作系统要求**:
  - **Windows**: Windows 10/11 (自带 Microsoft Edge WebView2)
  - **macOS**: macOS 11+ (自带 WebKit)
  - **Linux**: 安装 `webkit2gtk-4.1` 等基础 GUI 依赖

### 2. 安装依赖
在项目根目录或 `desktop/` 目录下执行：
```bash
# 进入桌面端子目录
cd desktop

# 安装前端依赖
npm install
```

### 3. 本地启动开发环境
```bash
# 启动 Vite 前端开发服务器（支持 Web 预览与独立调试）
npm run dev

# 启动完整的 Tauri 桌面端应用（含 Rust 原生热键与浮窗）
npm run tauri dev
```

### 4. 生产打包构建
```bash
# 编译前端生产 Bundle
npm run build

# 打包为原生桌面安装包 (Windows: .msi / .exe; macOS: .dmg; Linux: .deb / .AppImage)
npm run tauri build
```

---

## ⌨️ 默认快捷键

| 快捷键 | 功能说明 |
| :--- | :--- |
| `Alt + Space` | 全局唤醒 / 隐藏 Runbi 悬浮润色窗口 |
| `Enter` | 确认润色并将结果直接替换贴回原窗口 |
| `Esc` | 立即隐藏悬浮窗口 |
| `Tab` | 快速切换润色风格预设 |

---

## 📄 许可证
MIT License. Part of the **Runbi (润笔)** Multi-Platform Ecosystem.
