# 润笔 (Runbi) - 产品需求文档 (PRD)

---

## 1. 文档概述

- **产品名称**：润笔 (Runbi) 浏览器划词润色插件
- **规范标准**：Chrome Extension Manifest V3 (MV3)
- **目标运行环境**：Chrome 110+ / Edge 110+ 及其他 Chromium 内核浏览器
- **开发推荐技术栈**：
  - 构建工具：Vite + `@crxjs/vite-plugin` (或 Plasmo Framework)
  - 前端框架：React 18+ / Vue 3 + TypeScript
  - 样式方案：Tailwind CSS (注入 Shadow DOM 内部)
  - 核心依赖：`diff-match-patch` / `diff` (Diff比对), `lucide-react` (图标), `clsx` / `tailwind-merge`

---

## 2. 系统总体架构与通信模型

由于 Chrome Manifest V3 的安全策略限制以及网页原生 CSS 污染问题，系统划分为以下 4 个核心构件：

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 浏览器标签页 (Webpage Context)                                               │
│                                                                             │
│  [ 用户选中的文本 ]                                                           │
│         │ (划词触发 selectionchange / mouseup)                               │
│         ▼                                                                   │
│  [ Content Script ]                                                         │
│         │                                                                   │
│         ▼ 隔离宿主样式                                                      │
│  [ Web Component (Custom Element: <runbi-container>) ]                      │
│         │                                                                   │
│         └─── #shadow-root (open)                                            │
│                 ├── 注入的独立 CSS (Tailwind)                               │
│                 ├── Trigger 悬浮胶囊徽标 (Icon)                             │
│                 └── 润色主面板 (Panel: 状态/流式输出/Diff/操作栏)            │
└───────────────────────┬─────────────────────────────────────────────────────┘
                        │ chrome.runtime.sendMessage (流式请求发起)
                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Background Service Worker (扩展后台服务)                                     │
│                                                                             │
│  - 负责直接与 LLM API (OpenAI / DeepSeek 等) 建立 Fetch SSE 流式长连接       │
│  - 处理跨域 CORS 限制                                                       │
│  - 通过 Port / Message 流式向 Content Script 回传 chunks                    │
│  - 监听与管理 AbortController 中止请求                                      │
└───────────────────────┬─────────────────────────────────────────────────────┘
                        │
                        ▼ 读写配置 (API Key, 模型选择, 快捷键, 预设)
┌─────────────────────────────────────────────────────────────────────────────┐
│ chrome.storage.local 本地安全存储                                           │
└───────────▲─────────────────────────────────────────────────▲───────────────┘
            │                                                 │
┌───────────┴──────────────┐                    ┌─────────────┴──────────────┐
│ Popup 弹窗 (快捷开关)     │                    │ Options 选项页 (高级设置)   │
│ - 划词开关/静默模式      │                    │ - API Key / Base URL 设置  │
│ - 当前润色预设模型选择   │                    │ - 自定义 Prompt 模板管理   │
│ - 快捷键引导与关于       │                    │ - 网站黑白名单             │
└──────────────────────────┘                    └────────────────────────────┘
```

---

## 3. 功能需求详细定义 (Functional Requirements)

### FR-001: 划词监听与坐标定位引擎
- **触发条件**：
  - 监听 `document.addEventListener('mouseup')` 与 `selectionchange`。
  - 校验选中文本：`window.getSelection().toString().trim()` 字符长度 $\ge 2$ 且 $\le 5000$ 字符。
  - 防抖（Debounce）：鼠标拖拽选词完成 150ms 内触发定位计算。
- **坐标与碰撞规避算法**：
  - 获取选中区域范围：`const range = selection.getRangeAt(0); const rect = range.getBoundingClientRect();`
  - 悬浮胶囊默认渲染在选区末尾右上方（`top: rect.top + window.scrollY - 36px`, `left: rect.right + window.scrollX + 4px`）。
  - **视窗边界溢出校正**：
    - 若右侧超出视窗：向左翻转吸附；
    - 若顶部超出视窗（`rect.top < 40px`）：向下移动至选区下方（`rect.bottom + window.scrollY + 8px`）。
- **取消机制**：
  - 监测点击外部区域（Outside Click），或按下 `ESC` 键，立即销毁/隐藏面板与浮标。

### FR-002: 悬浮触发微标 (Trigger Icon)
- **外观**：直径 28px 的圆角胶囊/圆形按钮，内嵌润笔 Logo 图标，微光呼吸感阴影。
- **状态流转**：
  - **划词模式 A（默认·轻微标模式）**：划词后先仅出现 28px 的润笔微标，用户点击微标后才展开主浮窗并开始润色（避免误触打扰）。
  - **划词模式 B（极速极客模式，可在设置中开启）**：划词释放鼠标后，直接展开面板并自动开始润色。
  - **快捷键模式 C**：划词后按快捷键（默认 `Alt + W`）直接弹出。

### FR-003: 润色主面板与场景预设 (Presets & Prompt Engineering)
- **预设风格 Tab**（用户可点击切换，实时重新发起润色）：
  1. **【通用润色】(Polished)**：消除语病，表达通顺自然，保持原意与语气。
  2. **【学术规范】(Academic)**：严格学术规范，符合 SCI/顶会风格，用词客观、精炼、高级，消除中式口语。
  3. **【职场商务】(Business)**：礼貌得体、自信专业，适合 Slack、邮件、汇报沟通。
  4. **【文采飞扬】(Literary)**：增强词藻意境，比喻生动，修辞优雅。
  5. **【精简提炼】(Concise)**：剔除冗词废话，字数缩减 30%~50%，直奔主题。
  6. **【地道英文】(Native EN)**：若原文为中文则意译为地道母语级英文；若原文为英文则地道化俚语与语法。
- **Prompt 模板设计规范（核心规则）**：
  ```markdown
  你是一名文字润色专家。你的唯一职责是对用户的文本进行润色。
  目标风格：{{style_name}}
  用户原文本：
  """
  {{selected_text}}
  """
  
  【极其严苛的规则】：
  1. 直接输出润色后的终稿内容。
  2. 严禁包含任何前缀或后缀客套话（如“好的，这是润色后的版本：”、“希望对你有帮助”等）。
  3. 严禁添加引号包裹，严禁自行添加 markdown 标题。
  4. 保持原文的段落排版格式。
  ```

### FR-004: SSE 流式响应与状态渲染
- **请求协议**：支持标准 OpenAI Compatible `/v1/chat/completions` API，`stream: true`。
- **交互状态机**：
  - `IDLE`：待触发。
  - `GENERATING`：流式接收 chunk，界面打字机效果渐显，停止按钮（⏹ 停止生成）高亮。
  - `SUCCESS`：接收完毕，显示耗时与 Token 统计，高亮操作栏。
  - `ERROR`：捕获 401（Key无效）、429（超额）、网络中断等，提供友好中文提示与“重试”按钮。
- **中止能力**：点击面板右上角 `⏹` 或关闭浮窗时，触发 `abortController.abort()`，后台立即中断 Fetch 连接，节省 Token。

### FR-005: 文本差异比对视图 (Diff View)
- **比对机制**：
  - 点击面板右上角的 `[显示对比 / Diff]` 开关切换视图。
  - 使用字符级（中文）或词级（英文）比对算法。
  - **删除内容**：浅红色背景 + 贯穿删除线（如 `rgba(239, 68, 68, 0.15)`）。
  - **新增/替换内容**：浅绿色背景 + 翠绿下划线（如 `rgba(16, 185, 129, 0.15)`）。
  - **未修改内容**：普通字体颜色。

### FR-006: 结果操作栏与一键就地替换 (In-Place Replace)
- **一键复制 (Copy)**：将润色结果复制到剪贴板，浮现“已复制”轻提示（Toast），1.5 秒后自动消失。
- **一键替换 (Replace - 核心高级特性)**：
  - 判断原划选区域是否位于可编辑节点内：
    - `<textarea>` / `<input type="text">`：使用 `setRangeText()` 并派发 `input` 事件触发前端框架双向绑定更新。
    - `[contenteditable="true"]`（如 Notion、飞书、知乎、Gmail 富文本框）：恢复之前的 `Selection` Range，调用 `document.execCommand('insertText', false, polishedText)`。
  - 替换成功后，自动关闭浮窗并伴随微光高亮闪烁提示。
- **重新润色 (Regenerate)**：保留当前选区，让模型重新换一个角度生成。

### FR-007: API Key 与模型配置（Options 选项页）
- **支持 Provider**：
  - 默认预设：DeepSeek (深度求索 `deepseek-chat`) —— 性价比与中文文采极致。
  - OpenAI (`gpt-4o-mini` / `gpt-4o`)。
  - 自定义兼容端点 (Custom Base URL)：支持 SiliconFlow、Moonshot、Ollama 本地 `http://localhost:11434/v1` 等。
- **存储安全**：
  - 所有 API Key 存储在 `chrome.storage.local`，绝不上传至任何外部非目标 LLM 服务器。
  - 提供“测试连通性 (Test Connection)”按钮，输入 Key 后一键验证是否可用。

### FR-008: 网站黑白名单与免打扰
- 悬浮面板提供“在当前域名下禁用”快捷选项。
- Options 页面支持自定义黑名单（例如在特定的在线编程 IDE、游戏页面中彻底关闭划词触发）。

---

## 4. 非功能性需求 (Non-Functional Requirements)

1. **绝对样式隔离 (Style Encapsulation)**：  
   所有的 Content Script DOM 必须包装在 `#shadow-root (open)` 内部，外部网页 CSS（如 Bootstrap、Tailwind、重置样式）绝不能渗透破坏润笔浮窗；浮窗内的样式也严禁污染宿主网页。
2. **轻量与性能指标**：  
   - 生产打包后插件体积控制在 **1.5MB** 以内。
   - 划词触发浮标展示耗时 **< 30ms**。
   - 首字输出响应延迟（TTFT - Time to First Token）取决于 LLM 服务端，前端接收 chunk 渲染无卡顿，FPS 稳定在 60 帧。
3. **权限最小化原则**：  
   Manifest V3 permissions 仅声明：`["storage", "activeTab"]`，网络请求 host_permissions 声明为 `["https://*/*"]`，保证用户在任何网站均可划词。
