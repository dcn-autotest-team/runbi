# GEO（生成式引擎优化）网站规范

> 适用范围：产品官网、下载页、文档站和内容站。新项目上线前按本文完成基础项；内容或产品事实变化时同步复查。最后更新：2026-08-31。

## 1. 目标与边界

GEO（Generative Engine Optimization）是让网站的真实、可验证信息更容易被搜索引擎和 AI 搜索理解、检索、引用的工作。它建立在 SEO 之上：先保证网页可抓取、内容有用且信息准确，再优化信息结构和证据。

它**不是**“让 AI 必然推荐或引用本站”的技巧；搜索与 AI 答案由各平台决定。不要使用关键词堆砌、隐藏内容、伪造评价/引用、不与页面可见内容一致的结构化数据，或企图通过提示注入操控爬虫。

## 2. 每个网站的最小交付

### 2.1 页面与技术基线

- 每个可被搜索的页面有唯一的 `<title>`、`meta description`、`<html lang>` 和绝对 `canonical` URL。
- 发布 `robots.txt` 与 `sitemap.xml`；站点地图只列出可公开访问、返回 200、希望被收录的规范 URL。
- 页面可在未登录、未执行复杂交互时看到核心文案；不要把核心事实只放在图片、视频、Canvas 或 hash 路由里。
- 使用 HTTPS；检查移动端可读性、加载速度、图片替代文本、视频字幕和清晰的 H1/H2 层级。
- 配置符合页面实际内容的 JSON-LD。产品下载页通常使用 `SoftwareApplication`，机构介绍页可用 `Organization`，文章使用 `Article`。结构化数据只能陈述页面中可见、可证明的信息。
- 为产品提供稳定的公开信息页：功能、支持的平台、价格/试用规则（如有）、版本、更新日期、帮助与隐私政策。不要把这些事实只写在社交媒体或发布说明里。

### 2.2 内容基线

- 首屏用一句话说清“这是什么、给谁用、解决什么问题”，随后给出能验证的功能、限制和使用路径。
- 一个页面聚焦一个明确问题或任务；标题用用户会问的自然语言，而不是只写营销口号。
- 对关键主张给出来源、演示、版本号、适用条件或更新时间；数据与承诺必须可复核。
- FAQ 回答真实高频问题，答案直接、完整、与产品当前行为一致；不要为了覆盖关键词制造问答。
- 图片配有语义明确的 `alt`；演示视频有同步字幕、文字摘要和可访问的产品落地页。
- 中文站优先写高质量中文；有独立英文受众时再做完整英文页，并用 `hreflang` 关联等价页面，不能只做机器直译摘要。

## 3. 推荐的网站信息架构

最小官网可包含以下可索引 URL（按产品实际情况增减）：

| 页面 | 解决的问题 | 必须事实 |
| --- | --- | --- |
| 首页 / 产品页 | 这是什么、为何需要它 | 定位、核心收益、主要功能、平台、明确行动入口 |
| 功能或使用场景页 | 它怎样完成具体任务 | 操作流程、输入/输出、限制、截图或示例 |
| 下载/价格页 | 如何开始、成本是什么 | 下载链接、系统要求、版本、价格或试用规则 |
| 文档/支持页 | 如何安装和排障 | 步骤、FAQ、联系方式、更新时间 |
| 更新日志 | 最近改变了什么 | 日期、版本、用户可见变更、已知限制 |
| 隐私与条款 | 数据如何处理 | 数据范围、第三方服务、用户权利、联系渠道 |

## 4. 项目实施清单

### 4.1 开发阶段

- [ ] 记录规范域名、目标受众、核心问题和 3–5 条可公开验证的产品事实。
- [ ] 为每个重要页面确定一个稳定 URL；避免仅靠 `#hash` 承载需要被搜索的独立内容。
- [ ] 写出页面标题、描述、H1、主问题和直接答案；校对产品名、版本、价格和限制。
- [ ] 添加规范链接、Open Graph/Twitter 分享信息、站点地图、robots 和适用的 JSON-LD。
- [ ] 为所有关键图片补 `alt`，为视频补字幕、文字概述和封面图。
- [ ] 将下载、注册、咨询、FAQ、视频等关键动作标记为可统计事件。

### 4.2 上线前

- [ ] 逐页确认规范 URL、`title`、`description`、H1 与可见正文一致。
- [ ] 检查 `robots.txt` 没有误封站，`sitemap.xml` 仅含正确且可访问的规范 URL。
- [ ] 用 [Rich Results Test](https://search.google.com/test/rich-results) 检查支持的结构化数据；修复错误，不为追求富结果添加不真实字段。
- [ ] 使用 [PageSpeed Insights](https://pagespeed.web.dev/) 检查关键页面的移动端体验和性能。
- [ ] 在 Google Search Console 与 Bing Webmaster Tools 验证站点、提交站点地图；发布后请求检查重要 URL。
- [ ] 复查隐私政策与实际分析、广告、客服、支付等第三方脚本一致，并取得需要的同意。

### 4.3 运营阶段

- [ ] 每次版本发布同步更新下载页、文档、FAQ、更新日志和结构化数据中的版本/日期。
- [ ] 每月查看收录、自然搜索和转化，修复抓取错误与过时页面。
- [ ] 每季度抽查核心事实、外链来源、截图和示例是否仍准确。
- [ ] 记录用户提问和站内搜索词，将真实重复问题沉淀为产品页或文档页，而不是批量生成低质量内容。

## 5. 衡量：从曝光到真实使用

不要只看“AI 是否提到品牌”。采用同一条漏斗评估，并按页面、来源、国家/语言和版本分组：

```text
搜索可见性 → 落地页访问 → 关键内容互动 → 下载/注册 → 激活或付费
```

| 层级 | 指标 | 工具/数据源 |
| --- | --- | --- |
| 收录与可见性 | 已收录页、展示、点击、CTR、查询词、抓取错误 | Google Search Console、Bing Webmaster Tools |
| AI 搜索信号 | AI 答案中的展示/引用/来源页面（若平台报告提供） | Bing Webmaster 的 AI Performance；其他平台以可用官方报告为准 |
| 站内兴趣 | 着陆页、参与度、FAQ 展开、视频 25/50/75/100% | GA4 或获批准的隐私友好分析工具 |
| 意向 | 下载按钮点击、注册开始、联系表单提交 | 分析自定义事件、表单/CRM |
| 实际结果 | GitHub Release 资源下载、安装激活、试用转付费 | 发布平台与产品后端；GitHub 的 `download_count` 不是独立用户数 |

### 5.1 事件命名约定

事件名称使用英文小写加下划线，语义稳定，参数只传必要的非敏感上下文：

```text
download_release     placement, version, platform
signup_started       placement, plan
contact_submitted    topic
faq_open             question_id
video_start          video_name
video_25_percent     video_name
video_50_percent     video_name
video_75_percent     video_name
video_complete       video_name
```

禁止把用户输入、文档正文、API Key、邮箱、IP、截图或其他个人/敏感数据作为事件参数。启用分析前，先在隐私政策中说明统计目的、服务商和用户选择。

## 6. 可复用项目记录模板

在新项目创建 `docs/GEO.md` 后，将以下内容填入文首或项目 README，作为上线交接记录：

```md
## 本项目 GEO 记录

- 网站名称：
- 规范域名：
- 面向用户与主要地区/语言：
- 一句话定位：
- 可公开验证的核心事实：
  - 
  - 
  - 
- 事实来源（产品文档、发布说明、政策页）：
- 重要可索引页面：
- Sitemap：
- Robots：
- Structured data 类型与页面：
- Google Search Console：已验证 / 待验证
- Bing Webmaster Tools：已验证 / 待验证
- 分析工具与隐私政策链接：
- 关键转化事件：
- 负责人：
- 最近复查日期：
```

## 7. Runbi 当前落地记录

- 官网：`https://dcn-autotest-team.github.io/runbi-updates/`
- 已具备：规范链接、Open Graph、`SoftwareApplication` JSON-LD、`robots.txt`、`sitemap.xml`、支持页、隐私页、同步字幕的产品演示视频。
- 数据：已启用 GA4，Measurement ID 为 `G-72KYFKNTZZ`；追踪下载、FAQ 与视频进度事件。隐私页已说明该统计用途。
- 待人工完成：在 Google Search Console 和 Bing Webmaster Tools 验证该站点并提交站点地图；网站有足够自然流量后，按月记录查询词、来源页面和下载转化。

## 8. 权威参考

- [Google：让内容适配 AI 搜索体验的原则](https://developers.google.com/search/blog/2025/05/succeeding-in-ai-search?hl=en)
- [Google：以用户为中心的有用、可靠内容](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- [Google：SoftwareApplication 结构化数据](https://developers.google.com/search/docs/appearance/structured-data/software-app?hl=en)
- [Google：构建和提交 sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google Search Console 入门](https://developers.google.com/search/docs/monitor-debug/search-console-start)
- [Bing Webmaster Guidelines](https://www.bing.com/webmasters/help/bing-webmaster-guidelines-30fba23a)
- [Bing Webmaster AI Performance](https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c)

这些平台的产品与报告会变化。每次新项目上线前，以对应官方文档的当前版本为准。
