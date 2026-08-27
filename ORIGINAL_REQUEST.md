# Original User Request

## 2026-08-27T03:02:27Z

基于润笔 (Runbi) 现有的浏览器插件逻辑与 UI 资产，采用面向未来多端产品化（Extension / Desktop / Web / Mobile）的“共享核心层 + 平台适配器 (Shared Core + Platform Adapters)”架构，将纯业务、算法与通用 UI 抽象为共享模块，并在 `desktop/` 下构建基于 Tauri 2.x + Rust 的桌面客户端工程。实现全局热键、跨应用划词、无边框置顶浮窗、AI流式改写与一键替换回写；完成代码规范提交并准备 GitHub 交付。

Working directory: d:/FDE/Runbi
Integrity mode: demo

## Requirements

### R1. 多端共享核心抽象与架构分层 (Shared Core & Platform Adapters)
- **拒绝逻辑割裂**：严禁在桌面端另起炉灶编写一套重复的 Prompt、Diff 算法或 UI 状态逻辑。必须将多端通用的能力抽象为共享模块（可在 `shared/` 或 `packages/shared` 下）：
  - **核心纯逻辑**：文本 Diff 差异高亮算法、大模型 Prompt 角色模板预设、流式 Token 状态解析器、统一数据模型定义（`types/`）。
  - **无平台绑定的通用 UI**：`DiffViewer`、`StyleTabs`、`StreamingView`、`ActionBar` 等纯展示与交互组件。
- **平台能力抽象接口 (Platform Adapters)**：定义跨端统一的依赖倒置接口，各端分别注入实现：
  - `ISelectionProvider`：选区文本获取（插件端注入 DOM Selection 适配器；桌面端注入 Tauri 快捷键+模拟按键/剪贴板适配器）。
  - `ITextReplacer`：文本回写替换（插件端注入 DOM 节点替换器；桌面端注入系统剪贴板+模拟按键粘贴适配器）。
  - `IStorageProvider`：数据存储与配置（插件端走 `chrome.storage`；桌面端走 `tauri-plugin-store` 或 `localStorage`）。
  - `ILLMTransport`：网络与大模型传输（插件端走 Service Worker / fetch；桌面端走 Rust 原生 Reqwest 或 fetch）。

### R2. 桌面客户端工程搭建与 Tauri 2.x + Rust 底座
- 在 `desktop/` 目录下搭建 Tauri 2.x + React 18 + Vite 客户端工程，直接消费共享核心模块与组件。
- 配置 `tauri.conf.json`：无边框（`decorations: false`）、背景透明（`transparent: true`）、置顶（`alwaysOnTop: true`）、不占任务栏、启动初始隐藏防白屏、系统托盘常驻。
- 后端 Rust 核心服务：
  - 集成 `tauri-plugin-global-shortcut` 注册全局呼出热键（如 `Alt+Space`）。
  - 实现按键模拟取词与文本贴回功能（基于 `enigo` 或 Windows `SendInput` API）。
  - 获取鼠标光标坐标，支持浮窗贴近光标自动定位与边界溢出防遮挡。
  - 窗口失焦（`Focused(false)`）自动隐藏，保证系统级轻量即用即走体验。

### R3. 多端扩展性与产品化体验规范
- 桌面浮窗采用类似 Raycast / Spotlight 的极简精致质感，具备毛玻璃阴影效果。
- 保证浏览器插件原有代码结构的稳定与向后兼容，确保插件与桌面端均能顺畅调用同一套核心逻辑。
- 架构设计需对后续产品化扩展（如 Web SaaS 版、移动端或快捷指令）保持友好，未来增加新端只需实现新的 Platform Adapter，无需重构核心逻辑。

### R4. 代码完整性、静态验证与 Git 规范交付
- 严禁空实现或占位符代码，所有跨端适配器、IPC 通信与 UI 状态逻辑必须具备完整实现。
- 提供规范的工程配置与跨端依赖引用配置（`tsconfig.json` paths 映射或 npm/pnpm workspace 配置）。
- 编写 `desktop/README.md` 与多端架构说明文档，详细介绍架构分层、跨端适配原理与本地构建步骤。
- 初始化 Git 仓库，配置合理的 `.gitignore`，完成规范的原子化 Commit（语义化 commit 消息），并准备好一键推送到 GitHub 的指引与命令。

## Acceptance Criteria

### 1. 架构分层与复用性验证
- [ ] 存在清晰的共享层（`shared/` 或 `packages/shared`），集中维护了 `diff` 算法、`types`、大模型 Prompt 预设及共享 React UI 组件。
- [ ] 存在明确的平台适配器接口定义（如 `ISelectionProvider`、`ITextReplacer`、`IStorageProvider`），插件端与桌面端通过不同的 Adapter 实现平台隔离，核心逻辑实现 100% 共享。

### 2. 桌面客户端核心实现
- [ ] `desktop/` 具备完整的 Tauri 2.x 结构（`src-tauri/Cargo.toml`、`src-tauri/src/main.rs`、`src-tauri/tauri.conf.json`、`package.json`、`src/App.tsx`）。
- [ ] Rust 端完整实现了全局热键注册、模拟按键取词/贴回、光标定位与窗口显示/隐藏生命周期。
- [ ] 桌面端 UI 成功消费共享组件，无代码重复冗余。

### 3. 代码质量与零占位符
- [ ] 全部文件为完整可读代码，无任何未实现的占位函数（TODO / Stubs）。
- [ ] TypeScript 类型检查通过，跨模块路径别名正确解析。

### 4. Git 规范与交付完整性
- [ ] 根目录已执行 `git init`，配置好 `.gitignore`（忽略 `target/`、`node_modules/`、`dist/`）。
- [ ] 具备规范清晰的 Git 提交记录，代码整洁归档。
- [ ] 包含详细的架构与运行说明文档，具备直接推送到 GitHub 的完整准备。
