# 智能体窗口模式下,滑动/选中鼠标导致窗口消失 — 诊断报告

日期:2026-09-30
仓库:`D:\agent\agv\runbi`,分支 `master` @ `27da882`(v1.0.25)
状态:**仅诊断,未改任何产品代码。** 文档作者全程只在 `$PI_SCRATCH_DIR` 写临时文件。

---

## 0. 结论(先说结果)

**根因:智能体面板打开时,全局划词钩子仍然生效。用户"滑动 + 选中"鼠标被判定为划词手势后,钩子把共享的主窗口缩成 236×44 的胶囊并把焦点/内容切走——智能体面板就从屏幕上消失了。**

智能体面板和划词胶囊**不是两个窗口,而是同一个 `main` 窗口的两种几何状态**。因此"弹出胶囊"这一步必然把面板顶掉——不存在两者并存的可能。

"有一定概率"是因为该判定依赖指针与面板矩形的相对位置、WebView2 子 HWND 的归属判断、DPI/激活帧时序等条件,并非每次都命中(详见 §4)。

---

## 1. 证据链(先量化,再进源码)

日志:`%APPDATA%\com.runbi.desktop\runbi.log`,36.6 万行 / 约 28 天。文件含非 UTF-8 字节,所有统计均用 `grep -a` / `perl` 按二进制安全方式读取。

### 1.1 事件量级

| 事件 | 次数 |
|---|---|
| `selection invalidated` | 142,409 |
| `panel reset on invalidation`(`stale translate panel reset`) | 50,365 |
| `outside-pointer-down` | 26,798 |
| `event received t=selection` | 3,570 |
| `capsule shown: generation=` | 1,713 |
| `hideCapsule` | 1,583 |
| `capsule dismiss fallback … hidden=true` | 952 |
| `selection capture skipped: pointer over Runbi UI` | 324 |

### 1.2 决定性量化:智能体任务运行期间,仍然弹出了胶囊

用索引配对(不是简单计数):找出 `agent task started` → `agent task (ended|failed)` 的每个任务区间,再统计落进区间内的胶囊/选择事件。

```
agent tasks: 50
capsule/selection events total: 5020
  of which DURING an agent task: 9
    capsule_shown=5, selection_event=4
```

即:**在 50 次智能体任务执行过程中,有 5 次窗口被缩放成胶囊、4 次向共享窗口投递了 selection 事件。** 这就是报告症状的直接实测。

### 1.3 一例干净的全链路日志(行 257023 附近,`capsule shown: generation=6913`)

```
[1790227644] capsule bounds: target=(734,638) actual=(734,638) size=283x53
[1790227644] capsule bounds shown: actual=(734, 638) size=283x53
[1790227644] capsule shown: generation=6913
[1790227644] frontend: event received t=selection hs=false keys=[capsule,generation,...] text=使用周期 3 个月
[1790227644] frontend: epoch bumped
```

`epoch bumped` = 前端 `setShowEpoch(n => n+1)` 重挂面板容器 → 智能体面板视图被替换。

### 1.4 次生证据:`outside-pointer-down` 风暴

任务运行期间可见密集的无效化风暴(每次鼠标按下都 `invalidate_selection`),且每条都紧跟一条 `stale translate panel reset on invalidation`:

```
[1790235810] selection invalidated: reason=keyboard generation=16540
[1790235810] frontend: stale translate panel reset on invalidation
... (连续数十条)
```

这解释了 AGENTS.md 里"stale translate panel reset storm"的来源之一,也是同一根因的旁证:钩子在面板开着时仍在积极处理选择手势/键盘。

### 1.5 配对健康度(排除"流泄漏"这一竞争假设)

复核 LLM 流配对,确认本问题**不是**请求侧泄漏:

```
requests=24784 terminated=24724 unpaired=60 max_concurrent=65
  reasons: done=22446, http_error=2035, send_error=243
requests/sec: 1 req/s × 24633s, 2 req/s × 69s, 4 req/s × 1s
```

未配对流 60/24784 = 0.24%,abort = 0,几乎均匀 1 req/s → 无并发抢占模型问题。与本 bug 无关。

---

## 2. 架构事实:这是一个单窗口应用

`desktop/src-tauri/tauri.conf.json` 里

```json
"label": "main", "width": 860, "height": 640,
"transparent": true, "skipTaskbar": true, "visible": false
```

代码中所有窗口操作都取同一个 `get_webview_window("main")`(`main.rs`、`mouse_hook.rs`、`clipboard_monitor.rs`、`tray.rs`、`position.rs`)。**没有第二个窗口标签,没有为智能体单独建窗。**

窗口几何由 `position.rs` 的 `PANEL_SIZE`(860×640,单一真相)控制;胶囊态则临时改成 `(236.0, 44.0)`:

```rust
// position.rs:296-320(HEAD 行号)
let (logical_w, logical_h) = if is_capsule {
    (236.0, 44.0)                       // ← 胶囊几何
} else {
    PANEL_SIZE.lock()...unwrap_or((PANEL_WIDTH, PANEL_HEIGHT))
};
window.set_min_size(Some(min_size))?;
window.set_resizable(!is_capsule)?;
window.set_size(LogicalSize::new(logical_w, logical_h))?;
set_capsule_no_activate(window, is_capsule)?;
```

`position_window_at_point_inner`(position.rs:268)只在 `!is_capsule` 时调 `leave_capsule_mode()`;`is_capsule=true` 时**不会**解除胶囊注册。`is_capsule=false` 分支才 `window.show() + set_focus()`。

---

## 3. 根因定位:闸门不感知"智能体面板开着"

### 3.1 唯一闸门

`mouse_hook.rs:743`(HEAD 行号):

```rust
fn should_handle_selection(state: &SelectionMonitorState) -> bool {
    state.enabled.load(Ordering::Relaxed)
        && state.auto_popup.load(Ordering::Relaxed)
        && !state.is_internal_action.load(Ordering::Relaxed)
}
```

三个条件:`enabled`、`auto_popup`、`is_internal_action`。**没有任何一条判断"当前是否处于智能体面板"。** 唯一的 `#[tauri::command]` 开关 `set_selection_monitor_enabled`(mouse_hook.rs:1411)在前端**从未被调用**(全仓库 grep 命中 0 次,日志中 `set_selection_monitor_enabled` 出现 0 次)。

### 3.2 触发链(滑选鼠标 → 面板消失)

```
low_level_mouse_proc  (global WH_MOUSE_LL,始终运行)
  WM_LBUTTONUP 且判定为 selection gesture
    → spawn: grab_selected_text_with_retry()
    → should_handle_selection()  ← 此处面板状态未被检查,直接放行
    → position_window_at_point(window, is_capsule=true, pt)   // 把窗口 set_size(236×44)
    → show_native_capsule(window, generation)                 // CAPSULE_GENERATION = generation
    → emit runbi://captured-selection { capsule:true, trigger:"selection" }
  ↓ 前端
  App.tsx 监听: shouldShowCapsule(payload) 为 true
    → armCapsule(info)  →  setUiMode('capsule') 渲染微胶囊
  App.tsx:1996-2007
    → 若 uiMode 已是 capsule:清空 capsuleInfo / setCapsule(null)
  App.tsx:2012  setShowAgent(false)     // ← 智能体面板被关掉
  App.tsx:2014  setShowEpoch(n => n+1)  // ← 面板容器重挂(日志 "epoch bumped")
```

### 3.3 为什么"消失"而不只是"变窄"

面板与胶囊共用窗口且共用渲染容器,`event received t=selection` 处理逻辑在 `App.tsx:2012` 无条件 `setShowAgent(false)`。窗口被缩成 236×44 后即便面板 DOM 还在,也已被裁掉不可见 —— 用户感知为"窗口消失"。

---

## 4. 为什么只有"一定概率"(间歇性)

命中取决于下列这些**不完全可靠**的条件,它们共同构成了间歇性:

1. **指针相对面板矩形**。`point_over_runbi_ui`(mouse_hook.rs:647,HEAD)只把**胶囊的紧矩形**和 `WindowFromPoint` 的点命中算作"在 Runbi UI 内";面板矩形不算(注释明确说明:早期用整窗矩形做判定吞掉了约 28% 真实选区)。所以指针越出胶囊尺寸区域时,面板上的滑选照样被判为"外部选区"。
2. **WebView2 子 HWND 归属**。代码注释自述:低层钩子会把 WebView2 子窗口误判为外部窗口(`schedule_capsule_click_dismissal` 注释),`is_runbi_window` 需要走 parent/owner 链 + PID 兜底(mouse_hook.rs:750)。归属判定在激活/调整帧期间不稳定。
3. **DPI / 激活帧调整**。`position_window_at_point_inner` 注释:`set_position` 可能被 WM 因 DPI/边框/工作区改写,命中测试用"最终物理矩形"。
4. **`visibility_capsule_window` / `current_capsule_bounds` 的"胶囊矩形"启发式**(`is_capsule_rect`:`100..=500` × `20..=160`)。面板 860×640 不满足;但窗口在过渡帧里若短暂落在该区间,分支走向会不同。
5. **`should_pop_once` 去重**(2s / 同 generation)与 `OUTSIDE_DISMISS` 180ms 宽限期会随机吞掉一部分触发。

以上合起来:同样一个"滑选"动作,有时命中、有时不命中 —— 与用户描述一致。

---

## 5. 修复方案(最小改动,待你批准后实施)

**思路:让选择闸门感知"智能体面板/工作模式处于激活态"。** 一处 guard 即可,不需要改几何、不需要新建窗口、不动用户的 `autoCopyPopup` 设置。

### 5.1 Rust 侧(核心,约 6 行)

`SelectionMonitorState` 增加一个字段,并在 `should_handle_selection` 里一并判断:

```rust
pub struct SelectionMonitorState {
    pub enabled: Arc<AtomicBool>,
    pub auto_popup: Arc<AtomicBool>,
    pub is_internal_action: Arc<AtomicBool>,
    pub agent_active: Arc<AtomicBool>,      // 新增
    pub last_selected_text: Arc<Mutex<String>>,
}

fn should_handle_selection(state: &SelectionMonitorState) -> bool {
    state.enabled.load(Ordering::Relaxed)
        && state.auto_popup.load(Ordering::Relaxed)
        && !state.is_internal_action.load(Ordering::Relaxed)
        && !state.agent_active.load(Ordering::Relaxed)   // 新增
}
```

加一个命令(对称于现有 `set_auto_popup_enabled`,mouse_hook.rs:1434),并在 `main.rs` 的 `invoke_handler` 注册:

```rust
#[tauri::command]
pub fn set_agent_active(state: tauri::State<SelectionMonitorState>, active: bool) -> Result<bool, String> {
    state.agent_active.store(active, Ordering::SeqCst);
    Ok(active)
}
```

> 为什么不复用 `set_selection_monitor_enabled`:它持久化在前端配置里、语义是"用户开关划词监听",用它承载"临时进入智能体"会污染用户设置状态。独立的 `agent_active` 语义干净、生命周期只跟随 `showAgent`。

### 5.2 前端侧(同步标志)

在 `App.tsx` 增加一个 effect,`showAgent` 变化时同步:

```tsx
useEffect(() => {
  if (!isTauri) return;
  invoke('set_agent_active', { active: showAgent }).catch(() => {});
}, [showAgent, isTauri]);
```

放在 `App.tsx:2355` 附近的既有 `useEffect` 群中即可。

### 5.3 可选加固(建议,但非必需)

- `clipboard_monitor.rs` 的 `handle_clipboard_change`(该文件:254)也会弹胶囊,应同样被 `agent_active` 覆盖(它目前只查 `state.enabled` / `is_internal_action`)。注意本用户 `clipboardTriggerEnabled=false`,该路径当前未激活,但同类 bug 应一并堵住。
- `App.tsx:2012` 的 `setShowAgent(false)` 本身是无条件执行的;若希望"面板开着时新选区只更新内容、不关闭面板",可在此加 `if (!stateRef.current.showAgent)` 之类的判断。但**只做 5.1+5.2 已足以消除本症状**;此项会改变交互语义,需你确认。

### 5.4 明确不做的

- 不改 `autoCopyPopup` / 用户持久化设置。
- 不新建第二个窗口拆分面板与胶囊(架构级改动,超出本 bug 范围)。
- 不恢复"用整窗矩形判定是否在 Runbi UI 内"的老做法(会吞掉 28% 真实选区,是已知回归)。

---

## 6. 回归测试建议

1. **Rust 单测**(`mouse_hook.rs` 的 `mod tests`,沿用现有 `automatic_selection_popup_is_opt_in_and_obeys_internal_guard` 风格):

   ```rust
   #[test]
   fn agent_mode_suppresses_selection_popup() {
       let state = SelectionMonitorState::default();
       assert!(should_handle_selection(&state));
       state.agent_active.store(true, Ordering::Relaxed);
       assert!(!should_handle_selection(&state), "agent panel open must not arm the capsule");
       state.agent_active.store(false, Ordering::Relaxed);
       assert!(should_handle_selection(&state), "leaving agent mode restores selection popup");
   }
   ```

2. **前端集成测试**(`tests/unit/desktop-app-selection-flow.test.tsx`,harness 已存在,含"keeps an executing agent alive across tab switches"):

   - 进入智能体面板 → 断言 `invoke` 收到 `set_agent_active {active:true}`;
   - 切换离开 / 进入润色 → 断言 `set_agent_active {active:false}`。

3. **日志验收**(修复后用日志确认剂量关系消失):

   ```
   perl <pairing script> runbi.log   # 任务区间内 capsule_shown 应为 0
   ```

   即重复 §1.2 的测量,期望 "of which DURING an agent task" 的 `capsule_shown` 归零。

---

## 7. 当前阻塞(必须先解决才能落地)

诊断期间工作树**被另一个进程并发修改**,且它把代码改坏了。本报告作者未参与这些改动。

```
$ git status --porcelain
 M desktop/src-tauri/src/commands/mouse_hook.rs    (10 行,语法错误)
 M desktop/src/App.tsx                             (88 行,capsule polish 路由等)
 M tests/unit/desktop-app-selection-flow.test.tsx  (38 行)

$ cd desktop/src-tauri && cargo check
error: this file contains an unclosed delimiter
error: could not compile `runbi-desktop` (bin "runbi-desktop") due to 1 previous error
```

损坏位置 `mouse_hook.rs` 当前工作树 1026–1037 行(HEAD 中原为正确代码):

```rust
        // ... EnumWindows on every mouse move starves the low-level hook ...
        if w_param == WM_LBUTTONUP as usize
            && CAPSULE_GENERATION.load(Ordering::SeqCst) != NO_CAPSULE {   // ← 开括号未闭合
        let inside_runbi_window = point_inside_capsule_bounds(pt)
            || point_inside_runbi_window(pt)
            || is_runbi_window(WindowFromPoint(pt));
        if 1 == 1
            && !inside_runbi_window
        {
            && CAPSULE_GENERATION.load(Ordering::SeqCst) != NO_CAPSULE        // ← 裸 && ,语法错误
            && !inside_runbi_window
        {
```

- 写入时间 15:39:41,至 15:53 未再变化,疑似中途中断。
- 从改动意图看,对方想给 `WM_MOUSEMOVE` 热路径减负(避免 `EnumWindows` 饿死低层钩子)——**方向与 AGENTS.md 的工程约束一致**,只是没写完。
- 处理建议(择一,须你决定):
  1. 确认无其他写者后,把该函数体恢复语法正确(保留其"仅在 LBUTTONUP + 胶囊活跃时才做命中测试"的优化意图),再编译通过,然后落地 §5;
  2. 把三处改动整体 `git checkout -- ` 回 HEAD;
  3. 由对方进程自行修完后,我再接手。

**在此之前不建议任何人继续动这三个文件**,否则会与对方写者冲突。
