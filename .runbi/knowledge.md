# Runbi 项目工程知识与交付规则

## 1. 项目定位与架构
- **定位**：Runbi（润笔）是一款轻量、极简的桌面与浏览器划词润色/回复/翻译/自主智能体助手。
- **架构**：
  - `desktop/`: Tauri 2.x + Rust 桌面端应用（Win32 原生钩子 + WebView2 前端）。
  - `src/`: Chrome 扩展插件（Manifest V3）。
  - `shared/`: 共享核心库（类型定义、模型调用、上下文分析、通用 UI 组件）。
  - `tests/`: 单元与集成测试（Vitest + Cargo tests）。

## 2. 核心工程与工具链约束
- **构建环境**：
  - `npm` 不在系统 PATH 中，执行构建时必须在 `desktop/` 目录下调用：`node ..\node_modules\@tauri-apps\cli\tauri.js build --no-bundle`。
  - 构建前必须先终止正在运行的 `runbi-desktop.exe` 进程，防止 Windows 文件写入锁定（os error 5）。
  - 前端类型检查：`node ../node_modules/typescript/bin/tsc --noEmit`。
  - 前端单测：`node ./node_modules/vitest/vitest.mjs run`。
  - 后端单测：在 `desktop/src-tauri` 下执行 `cargo test`。

## 3. 极简原则（Ponytail 准则）
- 遵循严苛的“Lazy Senior Dev”准则：
  - 先问 YAGNI，拒绝一切未经请求的复杂抽象和无用依赖。
  - 修复 Bug 必须定位根因（Root Cause），排查所有同类调用方，一处守卫胜过处处修补。
  - 任何非平凡逻辑必须留下一份最小可运行测试（Assert-based test，无多余脚手架）。
  - 保持最短工作 Diff，以删代码为美。
