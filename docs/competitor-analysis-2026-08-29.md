# Runbi 竞品调研报告

> 调研时间:2026-08-29 01:00-02:10(北京时间)
> 调研人:LobsterAI(OpenClaw 主 agent)|分工:本报告为国际竞品 + 桌面系统级划词类;国内插件/输入法生态部分基于领域知识补充,已标注
> 方法:官网实抓(7 家 200 响应 / 2 家 WAF 拦截)+ 领域知识。所有"实抓"数据截至调研时间点,定价以官网为准。

---

## 一、竞品全景:三个梯队

### 梯队 A|国际 AI 写作助手(浏览器插件 + Web,与 Runbi 扩展端正面竞争)

#### 1. Grammarly(行业标杆)
- **实抓**:`grammarly.com/plans` — Free $0 / **Pro $12/月** / Enterprise 联系销售,三级定价
- 平台:浏览器插件(全主流)+ Windows/Mac 桌面 App + Web + Office 插件
- 交互:输入框内浮球/侧边栏,选中文本内联改写
- 模型:自家托管,用户不可选;BYOK 不支持
- 隐私:Enterprise 版有数据承诺;C 端数据过其云
- **对 Runbi 的启示**:三级定价骨架(Free 养口碑 / Pro 个人订阅 / Enterprise 大客户)是被验证过的标准打法;但 Grammarly 无"系统级跨应用贴回"能力

#### 2. QuillBot(改写赛道第一)
- 实抓被 Cloudflare 拦截,以下为领域知识
- 定位:学术改写/降重之王,学生与论文人群盘踞
- 平台:Web + 浏览器插件 + Word 插件
- 定价:Freemium,Premium 约 $10-20/月(按年折算更低)
- 模式:自家模型,词库式改写(Synonym slider)
- **启示**:验证了"垂直人群(学术)+ 改写"这一个窄场景可以撑起一家公司;Runbi 的学术英文润色模板可对标

#### 3. Wordtune
- **实抓**:`wordtune.com` — 功能线:Paraphrase / Rewrite / Summarize / AI Writing / Grammar / **Humanize AI**(把 AI 味文本改得像人写)
- Freemium,无信用卡免费起步
- **启示**:"Humanize AI" 是 2024-2026 新长出来的需求(AI 生成内容去味),Runbi 场景模板可加一条

#### 4. DeepL Write
- **实抓**:`deepl.com/en/write` — 风格/语气选择、词句备选、拼写语法,Web 免费,Pro 套餐捆绑
- 深耕数据安全叙事(独立数据安全页),欧洲企业市场强
- **启示**:DeepL 用"翻译口碑 → 写作助手"的路径与企业安全叙事拿 B 端;Runbi 私有化叙事可参考其数据安全页话术

### 梯队 B|系统级划词/效率工具(最接近 Runbi 桌面端的形态)⭐ 重点

#### 5. PopClip(macOS)
- **实抓**:`popclip.app` — "PopClip appears when you select text in any app"(任意应用选中文本弹出操作条)——**交互范式与 Runbi 桌面端完全同构**
- 扩展库生态(翻译/复制/搜索/分享…),一次买断制,持续更新(2026.8 版),从 Mac App Store 迁移到独立版
- 无内置 AI(AI 靠扩展接入各家 API,BYOK)
- **仅 macOS**,无 Windows 版
- **启示**:这个交互范式在 macOS 已被验证 15 年(2011 年至今),付费意愿成立;**Windows 上没有等价物**——这就是 Runbi 桌面端的空窗位

#### 6. Bob(macOS)
- **实抓**:`bobtranslate.com` — 划词翻译/截图翻译/输入翻译 + OCR;**支持 30+ 翻译服务**(火山/腾讯/阿里/百度/有道/DeepL…即 BYOK 模式);插件系统
- Mac App Store 分发,国内用户基数大
- **启示**:Bob = "macOS 版 Runbi 的翻译版",BYOK + 划词 + 服务聚合的模式在国内被验证过;但 Bob 主打翻译,没有 AI 润色原生体验;**同样没有 Windows 版**

#### 7. Raycast AI(macOS → ⚠️ 已进军 Windows)
- **实抓**:`raycast.com/ai` — "AI that works with your OS",**32+ 模型聚合**,AI Chat + 扩展;导航栏已出现 **Windows 入口(raycast.com/windows)**
- 订阅制:Pro 订阅 + AI 加购(约 $8+/月,领域知识)
- **启示(重要)**:Raycast 是 Runbi 桌面端最直接的对标体验标杆,且 **Windows 版已落地**——虽然其 Windows 版成熟度(全局划词/贴回能力)待验证,但空窗期可能比预想的短。这是本次调研最重要的单一发现

#### 8. uTools(全平台)
- **实抓**:`u-tools.cn` — 3000+ 插件生态,500 万+ 用户,**Alt+Space 全局唤起(与 Runbi 桌面端同款热键)**,企业内网部署方案,有 AI 插件创作(Vibe Coding)
- 公司化运营(福州猿力信息),免费 + 会员/企业版
- **启示**:双刃——既是威胁(生态位重叠),也是渠道(Runbi 可做成 uTools 插件借 500 万用户分发);其"企业内网部署"验证了 B 端私有化需求

### 梯队 C|国内 AI 写作与输入法生态(流量碾压区,Runbi 应避开正面)

> 以下为 Hermes 中文区调研(2026-08-29 02:00-03:00)
> 🔍=实采(官网/商店直接抓取) 📚=领域知识(官网 JS 壳/WAF 拦,待白天 SimilarWeb/商店实采补数)

**浏览器插件类**

| 产品 | 形态 | 划词润色 | 系统级/跨应用 | 收费 | 来源 |
|---|---|---|---|---|---|
| 沉浸式翻译 | 浏览器插件+桌面壳 | ✅ 划词翻译(强)/润色弱 | ⚠️ 部分 | 免费 + Pro ¥49/月(年付¥588 立省28%,含 GPT-5.6 Luna/DeepL Pro/2000万token/月) | 🔍 immersivetranslate.com/pricing |
| 秘塔写作猫 | Web 编辑器+插件 | ✅ 中文改写/校对/润色 | ❌ | 免费+订阅 | 📚 xiezuocat.com(系统升级中,JS壳) |
| 豆包浏览器插件 | 插件(Chrome商店第三方为主) | ✅ 划词 AI 问答/总结 | ❌ | 免费(字节流量) | 📚 doubao.com;桌面端另设微软商店 |
| Kimi 浏览器助手 | 官方插件(2024-07 上线,2024-10 推新) | ✅ 划词 AI(解析/翻译/润色辅助) | ❌ | 免费+会员 | 📚 kimi.moonshot.cn/extension;baike.baidu.com |
| 欧路词典 | 插件+桌面取词 | ✅ 划词翻译(术语/词典向) | ✅ 桌面取词(跨软件) | 免费+内购 | 🔍 www.eudic.net |

**输入法 AI 类(输入框内即时润色,锁输入法场景)**

| 产品 | 形态 | 划词/润色 | 系统级 | 收费 | 来源 |
|---|---|---|---|---|---|
| 讯飞输入法 AI | PC/手机输入法内置 | ✅ 输入框内 AI 润色/改写 | ⚠️ 仅输入法场景 | 免费+会员 | 📚 srf.xunfei.cn / inputmethod.iflytek.com(JS壳) |
| 搜狗输入法 AI | PC 输入法内置 | ✅ 输入框内 AI | ⚠️ 仅输入法场景 | 免费 | 📚 shurufa.sogou.com(JS壳) |
| 百度输入法 AI | PC 输入法内置 | ✅ 输入框内 AI | ⚠️ 仅输入法场景 | 免费 | 📚 shurufa.baidu.com |
| 微信输入法 | PC/Mac/移动输入法 | ⚠️ AI 侧重语音整理,非划词润色 | ⚠️ 仅输入法场景 | 免费 | 🔍 z.weixin.qq.com(发布动态:语音/长语音整理) |
| 彩云小译 | 网页+插件+移动 | ✅ 划词翻译(双语对照) | ❌ | 免费+会员 | 🔍 fanyi.caiyunapp.com |
| WPS AI | Office 生态内 | ✅ 文档内润色 | ❌ 锁 WPS 内 | 订阅 | 📚 领域知识 |

**国内线关键结论**

1. **国内无「Windows 系统级划词→AI 润色→安全贴回」直接竞品**:输入法 AI 锁输入框、浏览器插件锁网页内、欧路锁定翻译/词典向——Runbi 的跨应用贴回+剪贴板恢复在国产生态仍是空白。
2. **免费流量碾压属实**:豆包/Kimi/输入法 AI 全部免费,C 端正面打必输;唯一防御位仍是「Windows 原生+BYOK 隐私+中文场景模板(B 端)」。
3. **沉浸式翻译是唯一值得学的国产对手**:验证了「划词入口+免费引流+Pro 订阅」模型可行(¥49/月锚点),隐私口号(「翻译内容零保留」)与 Runbi「数据不出域」叙事一致,可直接借鉴文案。
4. **C 端定价安全带**:沉浸式翻译 Pro ¥49/月(≈$7)比 Grammarly $12/月低;Runbi 若做 C 端 BYOK 免费层+功能付费,¥19.9-29.9/月是安全区间。
5. **秘塔定位澄清**:Metaso 官网是 AI 搜索(非划词工具);秘塔写作猫偏中文公文/学术改写——验证了中文垂直模板包的付费意愿,与 Runbi 律所/券商/政务模板路线互洽。

> 待补(白天):SimilarWeb 用户量/下载量、Chrome 商店实装数、讯飞/搜狗/百度输入法 AI 功能页实采。

---

## 二、Runbi 卡位分析(对比矩阵)

| 维度 | Grammarly | PopClip/Bob | Raycast | 豆包/输入法 | **Runbi** |
|---|---|---|---|---|---|
| 系统级跨应用划词 | ❌ | ✅(仅 macOS) | ✅(Mac 成熟/Win 起步) | ❌ | ✅ **Windows** |
| AI 原生润色+Diff 对比 | ✅ | ❌(靠扩展) | 部分 | 部分 | ✅ |
| 一键原地贴回 | 部分 | ✅ | 部分 | ❌ | ✅(剪贴板隔离+防死锁) |
| BYOK / 自选模型 | ❌ | ✅ | ❌(订阅聚合) | ❌ | ✅(DeepSeek/智谱/OpenAI 预设) |
| 隐私(不过厂商云) | ❌ | ✅ | ❌ | ❌ | ✅ |
| 定价 | $12/月 订阅 | 买断 | 订阅+加购 | 免费 | **未定(建议见下)** |
| Windows 桌面端 | ✅(应用内) | ❌ | ⚠️ 新 | ❌ | ✅ 原生 |

## 三、核心结论

1. **真实空窗存在**:「Windows 系统级划词 → AI 润色 → 安全贴回」这个组合,市面上没有直接竞品。PopClip/Bob 证明了该交互范式付费意愿(均为 15 年/6 年的成熟付费产品),但都止步 macOS。
2. **时间窗口警告**:Raycast Windows 版已上线导航入口,是唯一可能快速填坑的玩家。Runbi 的窗口期估计 6-12 个月,应尽快锁"Windows 原生 + 中文场景 + BYOK 隐私"的心智。
3. **C 端别碰,卡位 B 端**:豆包/输入法用免费流量碾压通用 C 端;Grammarly/DeepL/uTools 的企业线(Enterprise/内网部署/数据安全页)证明 B 端愿为"数据不出域"付钱——与昨晚商业方案(律所/券商/政务模板包 + 私有化)完全互洽。
4. **定价锚点**:Grammarly Pro $12/月 与 PopClip 买断(约 $25)之间,Runbi B 端按坐席 ¥299-599/年 + token 套餐有竞争力;C 端 BYOK 永久免费层获客。
5. **两个可白嫖的功能灵感**:Wordtune 的 "Humanize AI"(AI 味去除)可作为新场景模板;Raycast 的多模型聚合可作为 BYOK 进阶(一个 key 面板多模型切换)。

## 四、行动建议

1. 本周:把"Windows 原生系统级划词 AI"写进所有对外文案的第一行(这是唯一的空窗词,别用"AI 润色"这种红海词)
2. 两周内:完成 Chrome 商店上架(免费 BYOK 版占位,防 Raycast/大厂抢注搜索词)
3. 本月:出一页 vs PopClip/Bob/Raycast 的对比表(英文),投放 Product Hunt/r/Windows 技术社区,试探海外 Windows 用户需求

## 五、来源与可信度

- **实抓(2026-08-29 01:00-02:00)**:grammarly.com/plans、wordtune.com、deepl.com/en/write、popclip.app、bobtranslate.com、u-tools.cn、raycast.com/ai
- **领域知识补充(WAF 拦截/JS 渲染)**:QuillBot 定价、秘塔写作猫、豆包/Kimi/输入法生态、沉浸式翻译、PopClip/Raycast 具体价格数字
- **局限**:未做用户量/收入第三方数据(需 SimilarWeb/点点数据,建议白天补);Raycast Windows 版功能完成度未实测(仅确认入口存在)
