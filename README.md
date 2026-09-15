# 润笔 (Runbi) - AI 划词润色助手 (Multi-Platform)

> **“轻划选词，妙笔生花。”**  
> 一款现代、轻量、纯粹的 AI 划词润色与文采修饰工具。支持 **Windows 桌面客户端 (Tauri 2.x + Rust)** 与 **Chrome 浏览器插件 (Manifest V3)**。

---

## 📌 产品核心能力

1. **🖱️ 鼠标划选即时润色（对齐豆包 / Cherry Studio 原生体验）**
   - 在任意软件（Word、网页、PDF、微信、IDE、记事本）中用鼠标选中文本，松开鼠标浮窗即刻在光标旁弹出，并立即开始流式润色与红绿 Diff 差异对比，**无需按任何快捷键**。
2. **⌨️ 极致纯键盘流闭环**
   - `Enter` 键：一键将润色后的文本无缝替换贴回原软件并自动隐藏。
   - `Esc` 键：立即隐藏浮窗并终止生成。
   - `Ctrl + Shift + Space`（或自定义热键）：全局呼出 / 隐藏控制。
3. **⚡ Rust 原生流式直连（Reqwest IPC）**
   - 彻底突破 WebView 浏览器跨域 (CORS/CSP) 限制，毫秒级逐字流式打字机效果。
   - 内置智能错误诊断：401 (Key失效)、402 (余额不足)、404 (模型不匹配)、429 (并发超限) 均提供清晰中文引导。
   - 支持 **DeepSeek、硅基流动、OpenAI、Ollama 本地模型**，未配置 Key 时自动启用内置零配置离线 Mock 体验。
4. **🛡️ 剪贴板无害化安全隔离**
   - 划词取词在后台毫秒级暂存并自动还原用户的系统剪贴板，绝不污染用户原本复制的历史记录。
5. **🎯 多显示器智能边缘避让**
   - 基于 Win32 `GetCursorPos` 全局硬件光标定位与工作区边界探测，屏幕边缘自动翻转贴合，防溢出、防遮挡原行。

---

## 📁 文档导航

| 文档名称 | 路径 | 核心说明 |
| :--- | :--- | :--- |
| **🚀 桌面端开发与构建指南** | [`desktop/README.md`](desktop/README.md) | Tauri 2.x + Rust 桌面端运行、编译、安装包打包与架构 |
| **01. 产品介绍与定位** | [`docs/01_PRODUCT_INTRODUCTION.md`](docs/01_PRODUCT_INTRODUCTION.md) | 产品愿景、目标客群、用户旅程与核心差异化卖点 |
| **02. 详细产品需求文档 (PRD)** | [`docs/02_PRD_REQUIREMENTS.md`](docs/02_PRD_REQUIREMENTS.md) | 功能模块分解、API 数据流、异常边界处理 |
| **03. 原型设计与 UI 规范** | [`docs/03_PROTOTYPE_AND_UI_SPEC.md`](docs/03_PROTOTYPE_AND_UI_SPEC.md) | 交互流程、Shadow DOM / 悬浮窗设计、Design Tokens |
| **04. 视觉与 Logo 资产规范** | [`docs/04_DESIGN_ASSETS_SPEC.md`](docs/04_DESIGN_ASSETS_SPEC.md) | 品牌 Logo、应用图标、配色方案规范 |
| **05. 桌面端极简架构设计与交接** | [`docs/05_DESKTOP_MINIMAL_HANDOFF.md`](docs/05_DESKTOP_MINIMAL_HANDOFF.md) | 底层 Win32 钩子、Rust IPC 与平台适配器实现细节 |
| **📕 Agent 教训录 (2026-09-15)** | [`docs/agent-lessons-2026-09-15.md`](docs/agent-lessons-2026-09-15.md) | **接手前必读**：LLM 响应慢的报因排查、Rust/TypeScript 方言语法、构建与日志排查手册、遗留未修项 |

---

## 🏗️ 仓库结构

```
runbi/
├── shared/                       # 100% 平台无关共享核心库 (@runbi/shared)
│   ├── core/                     # Myers CJK Diff、Prompt 模板库、Mock 流式生成器
│   ├── adapters/                 # 抽象接口契约 (ISelectionProvider, ITextReplacer, ILLMTransport, IStorageProvider)
│   ├── components/               # 跨端复用 React 表现层组件 (PolishPanel, DiffViewer 等)
│   └── types/                    # 统一 TypeScript 类型
├── desktop/                      # 桌面端应用 (Tauri 2.x + Rust + React 18)
│   ├── src/                      # 桌面前端交互与设置面板
│   └── src-tauri/                # Rust 后台、全局鼠标钩子 (WH_MOUSE_LL)、Reqwest 流式直连
├── src/                          # Chrome 浏览器插件 (Manifest V3)
└── docs/                         # 完整设计与开发文档库
```

---

## 🚀 桌面端快速启动

```powershell
# 1. 进入桌面端目录
cd desktop

# 2. 安装依赖
npm install

# 3. 运行桌面开发环境
npm run tauri dev

# 4. 打包 Windows 独立绿色版与安装包
npm run tauri build
```

编译产物位于 `desktop/src-tauri/target/release/`：
* **绿色单文件程序**：`runbi-desktop.exe`
* **Windows 安装向导**：`bundle/nsis/Runbi_1.0.0_x64-setup.exe`

---

## Hello World

Orbi dispatch is live on 141.87

---

## 📄 许可证
MIT License.
dispatch v2 works
