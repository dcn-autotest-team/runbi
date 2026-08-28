# 润笔 (Runbi) 桌面端核心架构与开发交接文档

> **设计哲学**：*“少即是多，呼之即来，挥之即去，3秒完成一次润色。”*  
> 本文档记录了 Runbi 桌面客户端的核心架构实现、关键底层技术方案与后续维护指南。

---

## 📌 一、 核心技术方案全景

润笔桌面端基于 **Tauri 2.x + Rust + React 18 + Tailwind CSS** 构建，全面复用 `@runbi/shared` 中的核心 CJK Diff 与 Prompt 引擎。

### 模块定位一览
- **前端主界面**：[`desktop/src/App.tsx`](../desktop/src/App.tsx)
- **平台适配层**：[`desktop/src/adapters/TauriIPCLLMTransport.ts`](../desktop/src/adapters/TauriIPCLLMTransport.ts)
- **Rust 后台入口**：[`desktop/src-tauri/src/main.rs`](../desktop/src-tauri/src/main.rs)
- **全局鼠标划选监听**：[`desktop/src-tauri/src/commands/mouse_hook.rs`](../desktop/src-tauri/src/commands/mouse_hook.rs)
- **Rust 原生流式直连**：[`desktop/src-tauri/src/commands/transport.rs`](../desktop/src-tauri/src/commands/transport.rs)
- **智能边缘贴合定位**：[`desktop/src-tauri/src/commands/position.rs`](../desktop/src-tauri/src/commands/position.rs)
- **模拟粘贴与剪贴板保护**：[`desktop/src-tauri/src/commands/replacer.rs`](../desktop/src-tauri/src/commands/replacer.rs)
- **快捷键动态录制与注册**：[`desktop/src-tauri/src/commands/shortcut.rs`](../desktop/src-tauri/src/commands/shortcut.rs)

---

## 🎯 二、 已落地的四大核心机制

### 1. 全局鼠标划选即时唤醒（对齐豆包 / Cherry Studio）
- **实现位置**：`commands/mouse_hook.rs`
- **原理**：
  - 在独立 OS 线程中安装 Win32 全局低级鼠标钩子 (`WH_MOUSE_LL`)。
  - 监听全局 `WM_LBUTTONDOWN` 与 `WM_LBUTTONUP`，计算拖拽位移 (`distance > 6px`) 与双击事件。
  - 用户选中文本松开鼠标的一瞬间，通过后台模拟抓取选中文本，暂存并立即还原用户系统剪贴板，随后将浮窗定位在光标旁并向前端派发 `runbi://captured-selection` 事件。
  - 自身窗口防重入：智能判定鼠标坐标是否落在 Runbi 窗口内部，内部点击绝对不触发抓取。

### 2. Rust 原生 Reqwest 流式直连 IPC（100% 杜绝跨域）
- **实现位置**：`commands/transport.rs` 与 `adapters/TauriIPCLLMTransport.ts`
- **原理**：
  - 彻底放弃前端浏览器的 `fetch()`，由 Rust 后台 `reqwest` 发送 HTTPS POST 请求并消费 SSE 字节流。
  - 通过 Tauri 2.x 的 `tauri::ipc::Channel` 毫秒级回传 `Chunk`、`Done` 和 `Error` 事件给 React 表现层。
  - 自动识别 401（Key无效）、402（余额不足）、404（模型不存在）、429（超频）并提供友好中文引导。
  - 提供一键连通性测试 (`test_llm_connection`) 与 DeepSeek / 硅基流动 / OpenAI 预设。

### 3. 剪贴板无害化安全隔离与防死锁
- **实现位置**：`commands/replacer.rs` 与 `commands/clipboard_monitor.rs`
- **原理**：
  - 采用 Win32 原生 `OpenClipboard` + `CF_UNICODETEXT` 跨线程安全读取。
  - 在模拟 `Ctrl+C` 取词或 `Ctrl+V` 贴回前后，备份并还原用户的系统剪贴板。
  - 引入 `is_internal_action` 原子标记，贴回文本时自动屏蔽监控器，杜绝自发自收造成的无限循环死锁。

### 4. 多显示器智能工作区贴合避让
- **实现位置**：`commands/position.rs`
- **原理**：
  - 调用 Win32 `GetCursorPos` 全局硬件光标 API，彻底解决隐藏窗口无法获取光标的限制。
  - 通过 `MonitorFromPoint` 获取当前显示器的实际可用工作区（排除 Windows 任务栏）。
  - 默认靠右下展开，在屏幕右边界或下边界时自动翻转至左侧/上方，防出界、防遮挡原文字行。

---

## 🚫 三、 架构红线与设计准则

1. ❌ **禁止引入重量级依赖与冗余框架**（如额外的数据库、复杂的富文本编辑器）。
2. ❌ **禁止破坏 `@runbi/shared` 的无副作用纯函数设计**。
3. ❌ **保持纯键盘流体验**：Enter 贴回、Esc 隐匿、快捷键随录随用。

---

## 📦 四、 生产构建指令

```powershell
cd desktop

# 1. 编译前端
npm run build

# 2. 生成 Release 安装包与可执行文件
npm run tauri build
```
产物位置：`desktop/src-tauri/target/release/`
