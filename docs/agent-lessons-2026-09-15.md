# Agent 教训录 · 2026-09-15 · 本地模型 LLM 响应慢

> 读者：后续接手 Runbi 的 agent。
> 目的：把"哪条路走通过、哪条路是我自己搞错的"固化下来，避免重复踩坑。
> 相关提交：`2e530fa`（v1.0.22）。工作区已验证干净。

---

## 一、结论先行：慢的真因不是单请求慢，是**并发**

直连本地模型实测（`127.0.0.1:8888`，同一模型同一 prompt）：

| 场景 | 中位总耗时 | 中位首字 |
|---|---|---|
| 5 个**串行**请求 | 3 072 ms | 22 ms |
| 5 个**并发**请求 | 6 868 ms | 30 ms |

**并发把单请求延迟乘了 2.24 倍。**

而 `runbi.log` 里：

```
W=5s  : 6.3%   的请求是在 5 秒内跟另一个请求一起发出的
W=10s : 91.3%  的请求是在 10 秒内跟另一个请求一起发出的
```

也就是说**九成以上请求都在跟别人抢模型**。所以排查方向从一开始就不该是"怎么让单次生成更快"，而是"为什么会有这么多并发请求"。

---

## 二、四个真实缺陷（v1.0.22 已修）

### 缺陷 1 · 取消到不了 Rust（**主因**）

`desktop/src/App.tsx` 的 `abortController.abort()` 只把前端的回调静默掉，
**Rust 侧的 SSE 读循环完全不知道**，会继续把整段生成拉完。

后果：用户按 Esc 取消 → 前端不动了 → 但那个 socket 还在满速读、模型还在为它算 →
**下一个真正想要的请求排在它后面**。

日志铁证（20 388 条请求配对统计）：

```
llm request   : 20387
llm done      : 18447
llm send error:  113
→ 1 827 个流永远没有到达任何终点
```

**修法**：新增全局 `ABORTED_STREAM_ID: AtomicU64` + `#[tauri::command] abort_llm_stream(stream_id)`。
每个流由前端铸一个递增 `streamId`；SSE 读循环里加两个检查点（每 body chunk 一次、每 SSE 行一次），
id 相等就立刻停读、丢 socket、返回。

**为什么用 `==` 而不是 `<=` / `fetch_max`**：迟到的旧 id 上报会误杀一个刚启动的新流。
这类"迟到旧事件"在异步系统里是常态。已写回归测试锁住这个语义。

### 缺陷 2 · 每个请求泄一个永久线程

原 `transport.rs::stream_llm_chat` 里：

```rust
let kb_stop = Arc::new(AtomicBool::new(false));   // 建了
std::thread::spawn(move || loop {                 // 闭包根本没捕获 kb_stop
    note_internal_keyboard_activity(true);
    sleep(200ms);
});                                               // 死循环，永不退出
```

- 每个 LLM 请求泄一个 OS 线程，**永不退出**，每 200 ms 醒一次。
- 同时它不停把 `INTERNAL_KEYBOARD_GRACE_UNTIL_MS` 往后推 500 ms，
  于是 `should_invalidate_keyboard()` **永久返回 false** —— 键盘划词失效、
  陈旧的翻译面板永远不自动清掉。

**修法**：`KeybordGraceKepper` 持有 stop 旗 + `impl Drop`，
`stream_llm_chat` 用 `let _kb_grace = KeybordGraceKepper::start();`，所有返回路径都会停线程。
`test_llm_connection` 是单次探针，没有面板要保护，**直接不起线程**。

### 缺陷 3 · 每个 SSE chunk 触发一次全量 React 重渲染

`setPolishedText((prev) => prev + delta)` 每来一个 chunk 就调一次，
连带重渲染整个约 3 500 行的 `App.tsx` + `MarkdownRenderer` 重解析 + `findBannedWords`。

**修法**：前端按 16 ms 帧合并 delta 再落状态；
Rust 侧另按 50 ms 批量发 IPC。实测 386 个原始 chunk → 9 次 IPC（少 97.7%）。

**这是一个会改语义的合并，不是纯性能改动**：
`onDone` 里的 `setPolishedText(fn)` 拿到的是 React 已合并后的状态，
而帧回调可能还没跑 → **尾段 delta 会丢**。
必须 `flushPending(true)` 在 `onDone` 里先强制落掉。
外面套 `try { … } finally { flushPending(true); }` 保证取消/报错路径也不留尾巴。

### 缺陷 4 · 探针客户端没绕代理

`test_llm_connection` 的 `Client` 少了 `.no_proxy()`，而真实流有。
本机回环端点经过本地代理（Clash 7890）会被缓冲，导致**连通性检查假阴性**。

---

## 三、我自己犯的两个错（重要，别重复）

### 错 1 · 编了一个漂亮但错误的因果叙事

我曾断言："延迟随泄漏线程数单调增长，所以 ~2 万个泄线程把模型压慢了。"

按请求序号分桶实测后：

```
reqIdx 窗口     | n    | 中位 | p90
1-2000        | 1918 | 1s  | 2s
2001-4000     | 1970 | 1s  | 1s
…
18001-20000   | 1961 | 1s  | 2s
```

**中位耗时全程稳定在 1 s，根本不涨。** 那条因果链是假的。

泄漏线程是真的（缺陷 2 独立成立，也确实破坏键盘失效机制），
**但它不是"慢"的原因**。真因是缺陷 1 导致的并发叠加。

> 教训：拿到一个"看起来能解释症状"的机制时，**必须单独验证它的剂量─反应关系**。
> 别让"这个 bug 确实存在"替代"这个 bug 是本次症状的原因"。

### 错 2 · 在错误的 cwd 下跑构建，得出"构建管线坏了"

我在仓库根目录而不是 `desktop/` 下跑构建，得到
`'tsc' 不是内部或外部命令`，于是判定 `tauri.conf.json` 的
`"beforeBuildCommand": "npm run build"` 是坏的，还去改成了绝对 node 路径。

换正确 cwd 后**立刻跑通**。那是我的测量错误，改动已回退。

> 教训：**工具报错时先怀疑自己的调用方式**，再怀疑代码。
> 结论"基础设施坏了"之前的验证成本，永远比想象中低。

---

## 四、这个代码库里必须知道的约定

写代码前先看这里，能省很多次编译失败。

### Rust 方言（自定义变体）

| 东西 | 写法 |
|---|---|
| 原子量 | `std::sync::atomic::{AtomicBool, AtomicU64, AtomicI32, AtomicIsize, Ordering}` |
| 引用计数 | `std::sync::Arc` |
| 互斥量 | `std::sync::Mutex`（注意有时也写作 `Mutux`），`.lock()` 返回 `Result` |
| Drop | `impl Drop for X { fn drop(&mut self) { … } }` |
| 内存序 | `Ordering::Relaxed` / `Ordering::SeqCst` |
| 命令注册 | `#[tauri::command]` |
| 条件编译 | `#[cfg(windows)]` / `#[cfg(not(windows))]` |
| 测试 | `#[cfg(test)] mod tests { #[test] fn … }` |
| 断言 | `assert!(…)` / `assert_eq!(…)` |
| 原子量方法 | `.load(o)` `.store(v, o)` `.fetch_add(n, o)` `.fetch_sub(n, o)` `.fetch_max(v, o)` `.compare_exchange(a, b, o1, o2)`（返回 `.is_ok()`） |

**宏注册的命令会被判死代码**：`#[tauri::command]` 的注册编译器看不见，
需要配 `#[allow(dead_code)]`，否则 `cargo check` 报 `never used` 警告。

### Frontend 方言（TypeScript）

- `setTimeout` / `clearTimeout` / `setInterval` / `clearInterval`（裸名，不带 `window.`）
- `useMemo` / `useCallback` / `useRef`（不是 `useMemo` 的标准 React 拼写）
- 取消信号用**属性**：`currentSignal.aborted`（不是方法）
- `AbortController` 定义在 `node_modules/jsdom/lib/jsdom/living/aborting/`，
  **它的 `onabort` 属性 setter 没有可用的类型** → 别用它挂回调，
  用 `setInterval` 轮询 `signal.aborted` 更省事。

### 工具链

- **`npm` 在 PATH 里不存在。** 用 `node_modules/` 下的 node 脚本直调：
  ```powershell
  cd D:\agent\agv\runbi\desktop
  node ..\node_modules\@tauri-apps\cli\tauri.js build
  ```
  → 这个会跑 `beforeBuildCommand`（前端）+ Rust 编译 + 打包。**必须在 `desktop/` 下跑。**
- 单独类型检查：`node ../node_modules/typescript/bin/tsc --noEmit`
- Rust 测试：`cd desktop/src-tauri && cargo test`
- **构建前必须先杀掉运行中的 exe**，否则
  `failed to remove file … runbi-desktop.exe`（os error 5，拒绝访问）。

### 构建管线（已核实是好的，别去"修"它）

`desktop/src-tauri/tauri.conf.json`：

```json
"beforeBuildCommand": "npm run build",
"frontendDist": "../dist"
```

`desktop/package.json` 的 `build` 脚本 = `tsc && vite build` → 产出 `desktop/dist/assets/index-<hash>.js`，
再由 tauri 嵌进 exe。

**验证"exe 嵌的是不是新前端"，用这个方法**（比看时间戳可靠）：

```powershell
# exe 里嵌的 asset 名
Select-String -Path 'desktop\src-tauri\target\release\runbi-desktop.exe' -Pattern 'index-[A-Za-z0-9_-]{8}\.(js|css)'
# 磁盘上新构建的
Get-ChildItem desktop\dist\assets\index-*.js
# 两者必须一致
```

### 私有文件位置

| 东西 | 路径 |
|---|---|
| 运行配置 | `%APPDATA%\com.runbi.desktop\config.json` |
| **追加式日志** | `%APPDATA%\com.runbi.desktop\runbi.log` |
| 运行中的 exe | `desktop\src-tauri\target\release\runbi-desktop.exe` |

`runbi.log` 是**天然的分析宝库**，格式：

```
[<unix 秒>] llm request: model=… image=… payload_kb=N endpoint=…
[<unix 秒>] llm status: 200 OK (20ms)
[<unix 秒>] llm done: N chars, head: …
[<unix 秒>] llm aborted by frontend after Nms     ← v1.0.22 新增
```

---

## 五、下次接手时的排查顺序

1. **先量，别先读代码。** 把 `runbi.log` 做 request→done 配对统计，看
   `未配对流数`（该等于 0）、`p50/p90/p99 耗时`、`并发分布`。
2. 分化原因：**单请求慢** 还是 **并发抢占**？
   并发的问题永远不该靠优化单请求解决。
3. 只有在日志证实之后，才进代码。改动前先确认
   "改成旧逻辑这个测试会不会红"，不会红就不算验证。
4. 加日志就用 `crate::commands::file_log(&app, …)`，别用 console
   （release 构建没有 console 输出）。

---

## 六、遗留未修（留给下一个人）

1. **请求没有去重。**
   日志里有 3.4% 的请求是 2–17 个同时发出的（同一用户操作）。
   同 prompt + 同配置的进行中请求应该复用而不是新开一个。
2. **`findBannedWords(polishedText)` 在每次 chunk 上跑一遍 useMemo。**
   已按帧合并缓解，但仍可再往下挪。
3. **`DiffViewer` 的 Myers diff 在长文本上成本高。**
   已做增量缓解，未做真正的时间切片。
4. **`frontend: stale translate panel reset on invalidation` 风暴**
   （`App.tsx:1758-1761`）在高频划词时会连发。
5. **`INTERNAL_KEYBOARD_GRACE_UNTIL_MS` 的 `fetch_max` 语义**
   在泄漏线程修掉后是否仍然必要，可以重新评估。
