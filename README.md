# 润笔 (Runbi) - 浏览器划词润色插件

> **“轻划选词，妙笔生花。”**  
> 一款现代、轻量、纯粹的 AI 划词润色与文采修饰浏览器插件（Chrome Extension Manifest V3）。

---

## 📌 项目定位与交接说明

本项目专为追求极致阅读与写作体验的用户打造，通过在网页任意位置选中文字，唤出优雅的轻量悬浮面板，一键实现 **学术规范、文采润色、职场公文、地道翻译、精简提炼** 等多种高质量润色改写。

**本目录包含完整的交接文档套件，供 AI 编码助手（如 Claude, GPT-4, Cursor, Windsurf 等）或工程师直接进行全流程落地开发。**

---

## 📁 交付文档导航

| 文档名称 | 路径 | 核心内容说明 |
| :--- | :--- | :--- |
| **01. 产品介绍与定位** | [`docs/01_PRODUCT_INTRODUCTION.md`](docs/01_PRODUCT_INTRODUCTION.md) | 产品愿景、目标客群、用户旅程与核心差异化卖点 |
| **02. 详细产品需求文档 (PRD)** | [`docs/02_PRD_REQUIREMENTS.md`](docs/02_PRD_REQUIREMENTS.md) | Manifest V3 架构、功能模块分解、API 数据流、异常边界处理 |
| **03. 原型设计与 UI 规范** | [`docs/03_PROTOTYPE_AND_UI_SPEC.md`](docs/03_PROTOTYPE_AND_UI_SPEC.md) | 交互流程、Shadow DOM 隔离方案、ASCII 原型图、Design Tokens |
| **04. 视觉与 Logo 资产规范** | [`docs/04_DESIGN_ASSETS_SPEC.md`](docs/04_DESIGN_ASSETS_SPEC.md) | 品牌 Logo、应用图标、配色方案、Chrome 扩展尺寸要求 |

---

## 🎨 视觉资产目录

已内置于 `assets/` 目录中：
- [`assets/logo_brand.jpg`](assets/logo_brand.jpg) : 润笔品牌平面标准字与 Logo 资产（适用于官网、宣传与关于页）。
- [`assets/icon_app.jpg`](assets/icon_app.jpg) : 现代质感 App/插件主图标（适用于 Chrome 扩展图标、扩展商店徽标）。
- [`assets/icon_concept.jpg`](assets/icon_concept.jpg) : 划词交互发光概念图。

---

## 🤖 给接手开发 AI 的启动指令（Prompt Template）

如果你是将本套文档投喂给下一个 AI 工具（如 Cursor Composer、Windsurf Cascade、Claude 3.7 等），可以直接使用以下 Prompt 开启工程构建：

```markdown
你好！请作为资深 Chrome Extension 架构师兼前端工程师。
请仔细阅读根目录下的 README.md 以及 docs/ 目录下的所有文档：
1. docs/01_PRODUCT_INTRODUCTION.md
2. docs/02_PRD_REQUIREMENTS.md
3. docs/03_PROTOTYPE_AND_UI_SPEC.md
4. docs/04_DESIGN_ASSETS_SPEC.md

请按照 PRD 中的架构规范：
- 技术栈建议：Vite + CRXJS (或 Plasmo) + React/Vue3 + TypeScript + Tailwind CSS
- 标准：Chrome Extension Manifest V3
- 核心要求：Content Script 必须使用 Web Components / Shadow DOM 进行绝对样式隔离，支持 OpenAI/DeepSeek 兼容流式输出与 Diff 差异高亮。

请分步骤帮我搭建项目骨架并实现核心功能！
```
