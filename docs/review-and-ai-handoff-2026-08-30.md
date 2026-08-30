# Runbi 产品级代码评审与 AI 实施交接

> 评审日期：2026-08-30
>
> 评审基线：`master` / `e5e0d04`，同时检查了当时工作区中尚未提交的行业包、皮肤、透明度与后台截图改动。
>
> 范围：Windows 桌面端、Chrome 扩展、共享核心、发布与产品文档。
>
> 目标：把美观和易用性推进到可正式交付的 9 分水平，但优先保证核心闭环可靠、可测、可信。

## 1. 结论先行

当前版本可以构建，自动化测试覆盖面也不错，但还不适合直接按“9 分产品”交付。主要问题不是颜色或动画，而是四个核心承诺尚未同时成立：

1. **选中后一定出现在正确位置**：扩展端滚动页和非 1920×1080 视口仍可能严重错位。
2. **只在完整生成后贴回正确内容**：桌面端缺少统一完成态闸门，错误、停止或空结果仍可能贴回原文或半截结果。
3. **用户明确知道何时触发、发送什么**：首次引导、自动唤起开关与实际默认行为互相矛盾；聊天截图默认开启又与隐私政策冲突。
4. **核心成功率可被量化**：仓库有大量单元和压力测试，但没有真实应用矩阵，也没有取词、首字、贴回、恢复剪贴板等匿名成功指标。

综合评分：

| 维度 | 当前 | 正式交付目标 | 主要差距 |
| --- | ---: | ---: | --- |
| 易用性 | 5.5/10 | 9/10 | 引导与默认值矛盾、失败静默、贴回无完成态、设置取消语义不真 |
| 视觉与交互设计 | 6.5/10 | 9/10 | 基础风格统一，但信息密度偏高、10px 文本过多、主题功能挤占核心注意力 |
| 架构合理性 | 6.5/10 | 8.5/10 | 共享核心与平台适配方向正确，但桌面 `App.tsx` 已成为 2100 行状态中心，跨端类型和 Mock 仍重复 |
| 性能 | 7/10 | 9/10 | 启动与构建体量可控，但每个流式 chunk 触发整棵桌面 App 重渲染，且缺少持续性能门禁 |
| 核心竞争力 | 5/10 | 8.5/10 | “Windows 划词原地改写”已不是空位；中文专业规则、可靠性和私有化优势尚未被数据证明 |

**发布判断：No-Go。** 完成本文 P0、通过真实应用矩阵并满足性能预算后，再进入正式交付候选。

## 2. 已经做对的部分

- `shared/core` 保持平台无关，桌面和扩展通过适配器接入，方向合理。
- 桌面端已经采用 UI Automation 优先、剪贴板模拟复制兜底，不再只有单一 `Ctrl+C` 路径。
- 剪贴板监听已改为 `WM_CLIPBOARDUPDATE` 事件驱动，默认关闭，并有密码管理器与敏感文本拦截。
- API Key 在 Windows 使用 DPAPI 保护；更新包同时使用 Tauri 签名与 Authenticode。
- 当前工作区验证结果：Vitest **31 个文件 / 665 个测试通过**；桌面前端生产构建通过；Rust `cargo check` 通过；Rust **22 个测试通过、1 个需外部 GlitchTip 的测试忽略**。
- 桌面主包约 **94.32 kB gzip**，不是当前性能问题的主要来源。

这些基础应保留。后续 AI 不应为了“重构得更漂亮”重写已经稳定的 Win32、存储或流式传输链路。

## 3. P0：正式交付阻断项

### P0-1 扩展浮层坐标系错误

**位置**：

- `src/content/App.tsx:224`、`src/content/App.tsx:337`
- `shared/core/position.ts:48`、`shared/core/position.ts:132`
- `src/content/shadowRoot.ts:37`

**事实**：选区矩形来自 viewport 坐标，但调用 `calculatePanelPosition` / `calculateCapsulePosition` 时没有传真实 viewport 和滚动量，函数会回退到 1920×1080、scroll=0；Shadow host 又使用 `position:absolute`。这会复现“划词在页面底部，入口跑到页面顶部或屏幕外”的问题。

**最小修复**：统一使用 viewport 坐标。优先把 host/container 改为 `position:fixed`，定位函数传入 `window.innerWidth/innerHeight`，不再叠加 scroll；监听 `scroll`、`resize` 时重新夹取或关闭浮层。

**验收**：1366×768、1920×1080、125%/150% 缩放、页面滚动 1200px、四个视口边角均测试；28px 入口与 400px 面板完整留在视口内，距边缘至少 8px，距选区不超过 16px。

### P0-2 贴回缺少“完整结果”闸门

**位置**：

- `desktop/src/App.tsx:1294`
- `desktop/src/App.tsx:1420`
- `shared/components/PolishPanel.tsx:433`

**事实**：`handleReplace` 使用 `polishedText || originalText`；全局 Enter 和按钮没有共享严格的生成完成条件。停止或错误前已经收到部分 chunk 时，还可能把半截结果贴回目标应用。

**最小修复**：引入单一 `generationStatus`，并派生：

```ts
const canCommit = generationStatus === 'completed' && !error && polishedText.trim().length > 0;
```

按钮、Enter 快捷键和适配器调用只使用 `canCommit`；删除 `|| originalText`；`aborted` 结果默认不可贴回，可保留复制入口但要标记“未完成”。

**验收**：onboarding、idle、connecting、streaming、aborted、error、empty 状态均不调用 `replaceText`；completed 状态只调用一次，内容与完整终稿逐字一致。

### P0-3 首次引导与产品默认行为冲突

**位置**：

- `desktop/src/components/OnboardingView.tsx:26`
- `desktop/src/App.tsx:136`
- `desktop/src/App.tsx:894`
- `desktop/src/App.tsx:1366`

**事实**：引导宣称“鼠标划选后面板自动呼出”，但 `autoCopyPopup` 默认关闭；引导 5 秒后自动收入托盘，并且 Enter/Space 关闭引导时，桌面全局 Enter 贴回监听仍存在。

**最小修复**：

1. 首次引导不自动关闭。
2. 给出三个明确动作：“开启划词入口”“连接模型”“稍后，仅用快捷键”。
3. `showOnboarding` 写入全局键盘闸门，引导可见时禁止贴回、历史和设置快捷键。
4. 首次真实完成“选中→生成→贴回”后才标记核心引导完成；跳过只记录跳过，不伪装成功。

**验收**：只用键盘可完成或跳过；停留任意时长不自动隐藏；引导期间 `replaceText` 调用数为 0；用户能准确复述当前是“划词自动触发”还是“快捷键触发”。

### P0-4 截图默认值、日志与隐私承诺冲突

**位置**：

- `desktop/src/App.tsx:138`、`desktop/src/App.tsx:894`
- `desktop/src/App.tsx:1007`
- `docs/PRIVACY_POLICY.md:18`

**事实**：隐私政策写明聊天截图默认关闭且首次触发询问，代码却默认 `true`，并直接把截图用于模型请求；另外事件日志把选中文本前 24 个字符写入 `runbi.log`，而隐私政策称日志只含元数据。

**最小修复**：截图默认关闭；首次调用前显示截图预览、目标模型端点、用途与一次/持续授权；拒绝后只走文本。日志删除所有用户文本片段，只记录长度、来源类别、耗时和结果码。

**验收**：新安装、旧配置缺字段、拒绝授权三种状态下请求体均不含图片；日志 grep 不出现输入/输出样本文字；隐私政策与代码默认值测试锁定一致。

### P0-5 “划词触发”和“复制触发”被错误合并

**位置**：

- `desktop/src/App.tsx:927`、`desktop/src/App.tsx:952`
- `desktop/src/App.tsx:1806`
- `desktop/src-tauri/src/commands/mouse_hook.rs:49`
- `desktop/src-tauri/src/commands/clipboard_monitor.rs:382`

**事实**：同一个 `autoCopyPopup` 同时控制鼠标划词钩子和系统剪贴板监听。用户可能只想划词入口，却因此把每次复制也变成唤起；这正是“关了仍唤起/开启后过度打扰”类问题容易反复出现的设计根源。

**最小修复**：拆成两个独立设置：`selectionTriggerEnabled` 与 `clipboardTriggerEnabled`。剪贴板触发默认永远关闭；划词触发由首次引导明确选择。迁移旧配置时不要自动打开剪贴板监听。

**验收**：2×2 设置组合全部集成测试；关闭复制触发后，连续复制 20 次窗口不出现；开启划词触发时拖选仍正常；两者关闭时只有全局快捷键生效。

### P0-6 发布版本必须单一来源

**位置**：

- `desktop/package.json:3`
- `desktop/src-tauri/Cargo.toml:3`
- `desktop/src-tauri/tauri.conf.json:4`
- `package-lock.json:42`
- `docs/release.md`

**事实**：产品与 Rust 配置已经是 1.0.2，公开更新仓库也已发布 v1.0.2，但根 `package-lock.json` 的 desktop workspace 仍记录 1.0.1，发布文档开头也仍写“已发布 v1.0.1”。手工同步多个版本字段容易再次制造更新失败。

**最小修复**：新增一个不依赖第三方库的版本检查脚本，CI/发布前比较四处版本和 `latest.json`；不要求自动改写，发现不一致就失败。

**验收**：故意改错任一版本字段时检查退出码非 0；正常发布产物、manifest、Release tag 和安装后显示版本完全一致。

## 4. P1：下一迭代必须完成

### P1-1 为真实核心闭环建立指标和应用矩阵

当前 665 个前端测试和 22 个 Rust 测试主要证明纯逻辑与模拟边界，不证明 Word、微信、受保护 PDF 或 Electron 上的成功率。先记录**不含用户内容**的本地指标：

| 指标 | 目标 |
| --- | ---: |
| 支持应用取词成功率 | ≥98%，按 UIA / Ctrl+C / 手动粘贴分组 |
| 误弹率 | <0.5% 的划词尝试 |
| 划词到入口可见 p95 | <250ms |
| 热键到窗口可见 p95 | <120ms |
| 设置首次打开 p95 | <100ms |
| 贴回成功率 | ≥99% |
| 剪贴板恢复成功率 | ≥99.9% |
| 崩溃自由会话 | ≥99.8% |
| 空闲 CPU | <0.5% |
| 桌面进程空闲内存 p95 | <80MB |

真实应用矩阵至少覆盖：Word、Outlook、记事本、Chrome 普通页、Edge PDF、微信、企业微信、VS Code、一个典型 Electron 编辑器和远程桌面。每次发布前在相同文本长度档位（20/500/5000 字）跑取词与贴回。

### P1-2 批处理流式 UI 更新

**位置**：`desktop/src/App.tsx:500`、`desktop/src/App.tsx:217`

每个 SSE chunk 都 `setPolishedText`，会让包含 47 个 `useState` 的 2100 行 App 整体重渲染，同时重复运行禁用词扫描和结果区渲染。使用 ref 缓冲 chunk，每个 `requestAnimationFrame` 最多提交一次；完成和错误时立即 flush。不要先引入新状态库。

**验收**：模拟 2000 个小 chunk 时，React commit 次数不高于屏幕帧数的 1.2 倍；主线程无 >50ms 长任务；结果逐字一致。

### P1-3 收紧桌面 App 状态中心

`desktop/src/App.tsx` 目前约 2100 行、47 个 `useState`、17 个 `useCallback`。不要做大爆炸重构。只按用户可见边界抽出三个现有子视图：`SettingsView`、`ScreenReplyFlow`、`MainPolishView`；共享运行态继续放顶层，设置草稿留在设置组件。

**验收**：App 主文件降至 900 行以内；设置字段修改不触发流式结果区重渲染；现有测试全绿并新增设置取消测试。

### P1-4 演示模式必须显式，不可伪装真实模型

**位置**：`desktop/src/adapters/TauriIPCLLMTransport.ts:47`、`desktop/src/App.tsx:594`、`src/background/streamHandler.ts:246`

无 API Key 的 Mock 是演示数据，不是离线模型。结果区常驻“演示模式，不会调用真实模型”水印，并给出“连接模型”入口；不得显示真实模型徽标或伪造“已读取聊天上下文”。真正离线能力只指已连接 Ollama/本地端点。

### P1-5 失败必须指向唯一恢复动作

为 401/403、404 模型不支持、429、timeout、vision unsupported、本地端点不可达分别提供中文说明和一个主操作；普通用户不看原始堆栈。桌面只保留一个全局 Toast，并把消息结构化为 `success | error | info`，错误使用 `role=alert`。

### P1-6 设置取消语义必须真实

当前设置控件直接修改运行时 state，皮肤还会即时生效，但“取消/Esc”不会恢复。二选一：

- 推荐：打开设置时创建草稿，保存时一次提交，取消时丢弃；
- 或全量自动保存并删除“保存/取消”按钮。

不要继续保留两套语义。

### P1-7 跨端行为必须对齐

- 扩展端附件 UI 已能显示文件 chip，但请求路径忽略附件；未完成传输前应隐藏附件入口。
- 扩展端只拦截 password input，未复用桌面的敏感文本检测；极速模式可能直接发送 token/身份证等内容。
- 超过 5000 字或少于 2 字时扩展静默返回 null，应在选区旁明确提示长度限制。
- `src/types/stream.ts` 和 `src/core/mockStream.ts` 与 `shared` 版本并存并已经出现字段差异，统一导入共享实现。

### P1-8 可访问性和可读性

- 说明文字至少 12px，正文 13–14px；普通文字对比度至少 4.5:1。
- 所有交互保留可见 `:focus-visible`；菜单实现方向键、Enter、Esc 与焦点归还。
- 200% 缩放下不截断；系统减少动画时关闭扩展连续动画。
- 固定 560×520、不可调整大小的桌面窗口要在 125%/150% DPI 下验证设置页；若信息仍拥挤，设置改独立可调整窗口，而不是继续缩小字体。

### P1-9 后台截图进程匹配必须精确

**位置**：当前未提交的 `desktop/src-tauri/src/commands/screenshot.rs` 中 `process_name_matches`。

不要用 `contains(want_lower)` 匹配可执行文件名，避免抓错相似进程。比较去掉 `.exe` 后的完整 basename，并在 UI 显示实际捕获的应用名；捕获失败时不得复用上一张截图。

## 5. P2：删减与收敛

在 P0/P1 达标前，不继续扩充外观和垂直包数量：

- 删除或暂停当前未提交的红白皮肤与窗口透明度。透明度最低 20% 会直接损害可读性，皮肤覆盖增加 100 多行脆弱 CSS，却不提升核心任务成功率。
- 把 token、耗时等技术统计移到诊断页。当前 token 可能只是估算，不应占用普通用户结果区。
- 普通用户不应配置 GlitchTip/Sentry DSN。崩溃上报同意与“提交反馈”应分开；反馈不能依赖用户自建运维系统。
- 删除不可达的 `clipboardReference` 交互和未使用的 `.raycast-window/.acrylic-card/.spotlight-input/.kbd-badge` 样式。
- 行业包先只保留一个可验证场景。建议选择“中文客户沟通/商务回复”，不要同时承诺法律判断、公文合规和销售转化。

## 6. 核心竞争力重判

### 6.1 原竞争假设已经失效

“中文 × 划词触发 × Windows × 原地替换”仍有定位价值，但交互本身不是护城河：

- [Raycast Windows 官方更新](https://www.raycast.com/changelog/windows) 已提供读取选中文本的 AI 扩展、Quick Fix 和 AI Command 原地替换，并加入屏幕上下文能力。
- [Microsoft PowerToys Advanced Paste](https://learn.microsoft.com/en-us/windows/powertoys/advanced-paste) 已支持云端模型、Foundry Local 或 Ollama，把剪贴板内容按提示改写后贴回。
- [Grammarly for Windows](https://www.grammarly.com/desktop/windows) 已覆盖大量桌面应用；其[选中文本重写](https://support.grammarly.com/hc/en-us/articles/30916398193037-Introducing-paragraph-level-rewrites)支持改善、改写、缩短和语气转换。

因此不能再对外宣称“Windows 无直接竞品”或把 Win32 hook 当壁垒。

### 6.2 建议的新定位

> **Runbi：面向中文专业沟通的 Windows 原地改写层——选中即处理，结果可解释，数据可留在自己的模型与网络里。**

优先服务需要高频中文沟通又无法接受复制到聊天网页的用户，例如客户成功、销售支持、行政与专业服务团队。先证明一个场景，再扩行业。

### 6.3 真正可积累的四层壁垒

1. **可靠性壁垒**：公开支持应用矩阵和成功率；UIA、剪贴板、手动粘贴三级降级，失败可见而非静默。
2. **中文规则资产**：称谓、语气、禁用词、数字/链接/代码/LaTeX 保护、术语表和可解释 Diff；规则有基准集和专家验收，不只是 Prompt 字符串。
3. **企业隐私与部署**：BYOK、Ollama/私有网关、DPAPI、内容零日志、可审计的出站域名与管理员策略。
4. **工作流资产**：团队共享动作、行业模板版本、灰度发布和质量反馈闭环。宿主钩子本身可复制，这些数据与交付能力更难复制。

### 6.4 北极星指标

`有效贴回次数 / 有意图的触发次数`。

只看调用量会奖励误弹，只看生成量会忽略贴回失败。该指标同时要求取词正确、结果可接受和贴回成功。辅助指标包括首周完成三次有效贴回的用户比例、七日留存、模板采纳率和失败恢复率。

## 7. 90 天实施顺序

### Sprint 0：1 周，清除发布阻断

完成 P0-1 至 P0-6；补扩展定位、完成态、引导、截图同意、触发拆分、版本一致性测试。不得顺带做主题或新行业包。

### Sprint 1：2 周，证明“可靠”

建立真实应用矩阵和匿名本地指标；加入失败降级入口；完成流式 rAF 批处理。达不到取词 98% / 贴回 99% 时，不扩功能。

### Sprint 2：3 周，证明“中文专业”

只选择一个“客户沟通/商务回复”包，构建 200 条脱敏基准集；评估事实保留、语气命中、专有名词保护和人工采纳率。禁用词扫描必须给替代建议和解释。

### Sprint 3：4 周，证明“可交付”

完成安装、自动升级、崩溃恢复、隐私说明、离线 Ollama、管理员配置和 10 台真实设备灰度；冻结功能，只修阻断问题。

### Sprint 4：2 周，决定是否扩行业

根据北极星指标和人工基准决定是否增加第二行业。没有数据优势则继续打磨第一场景，不增加法律、公文或截图代理功能。

## 8. 给后续 AI 的执行协议

1. 开始前运行 `git status -sb`。当前工作区存在其他未提交改动，必须保留，不得 `reset --hard` 或覆盖。
2. 一次只领取一个编号；P0 按顺序合并，避免大 PR。
3. 每项先写能失败的最小回归测试，再改共享根因；不要在多个调用方重复打补丁。
4. 每个 PR 必须附：用户可见变化、失败路径、隐私影响、测试命令、真实应用验证截图或日志。
5. 禁止新增状态库、UI 框架、数据库或遥测 SaaS，除非现有平台能力确实无法完成。
6. 任何日志和指标只记录枚举、布尔值、长度、耗时与错误码，禁止记录输入、输出、截图、API Key、窗口标题全文。
7. 完成 P0 后执行：

```powershell
npm test -- --run
npm run build
npm --prefix desktop run build
cd desktop/src-tauri
cargo check
cargo test
```

8. 发布候选还必须执行本文真实应用矩阵；自动化全绿不等于产品闭环通过。

## 9. Ponytail 全仓简化清单

按“能不写就不写、能复用就不复制”排序：

1. `delete:` 暂停红白皮肤、透明度和后台指定应用截图三组未发布功能；先完成核心闭环。替代：保留单一品牌主题和前台文本路径。`desktop/src/App.tsx`、`desktop/src/styles/glass.css`、`desktop/src-tauri/src/commands/screenshot.rs`
2. `delete:` 删除扩展本地 Mock 与流类型副本。替代：统一使用 `@runbi/shared/core` 与 `@runbi/shared/types`。`src/core/mockStream.ts`、`src/types/stream.ts`
3. `delete:` 删除不可达 `clipboardReference` 与未引用的 glass CSS 类。替代：无。`desktop/src/App.tsx`、`desktop/src/styles/glass.css`
4. `yagni:` 不同时维护通用、微商、法律、房产/保险多个未经基准验证的行业包。替代：只发布一个客户沟通包并用数据决定第二个。`shared/types/settings.ts`
5. `shrink:` 47 个状态和设置表单不应都驻留在根 App。替代：只按已有页面边界抽出设置草稿和屏幕回复流程，不引入状态库。`desktop/src/App.tsx`
6. `delete:` 若最终源码搜索仍无引用，移除 `diff`、`clsx`、`tailwind-merge`、`lucide-react` 的冗余包声明。替代：现有纯函数 Diff、模板字符串与自有图标。三个 `package.json`

**net：约可减少 500–900 行，最多减少 4 个未使用依赖。** 实施前必须以 `rg` 和完整构建再次确认依赖确实无引用。

## 10. 完成定义

只有同时满足以下条件，才可以把产品易用性和美观性评为 9 分：

- P0 全部关闭，并有回归测试。
- 真实应用矩阵达到取词、贴回和剪贴板恢复目标。
- 首次用户无需阅读外部文档即可完成第一次真实贴回。
- 截图、日志、遥测与隐私政策完全一致。
- p95 启动、唤起、设置打开和划词到入口均达到预算。
- 视觉在 125%/150% DPI、200% 缩放、键盘和减少动画模式下通过验收。
- 核心定位不再依赖“没有竞品”，而由可公开验证的中文质量与可靠性支撑。
