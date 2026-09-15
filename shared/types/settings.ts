/**
 * @file shared/types/settings.ts
 * Application Persistent Settings & Provider Presets
 * Multi-Platform: Chrome Storage Local & Tauri Plugin Store
 */

import type { PolishStyle, ProviderType, TriggerMode } from './stream';

/**
 * Full persistent application settings state.
 */
export interface AppSettings {
  /**
   * User BYOK API key for LLM provider.
   */
  apiKey?: string;

  /**
   * SenseAudio 通道的 API Key（与环境变量 SENSEAUDIO_API_KEY 同义；未单独设置时回退 apiKey）。
   */
  senseAudioApiKey?: string;

  /**
   * Base URL for OpenAI/DeepSeek-compatible endpoint.
   */
  baseUrl?: string;

  /**
   * Model identifier (e.g. 'deepseek-chat', 'gpt-4o-mini').
   */
  model?: string;

  /**
   * Selected provider preset ID.
   */
  provider?: ProviderType;

  /**
   * Trigger mode ('capsule' for 28px icon, 'direct' for instant modal).
   */
  triggerMode?: TriggerMode;

  /**
   * Master enable/disable toggle.
   */
  enabled?: boolean;

  /**
   * List of domain names or app names where Runbi is disabled.
   */
  blacklist?: string[];

  /**
   * Global prompt template override.
   */
  customPrompt?: string;

  /**
   * Per-style custom system prompt overrides.
   */
  customPrompts?: Partial<Record<PolishStyle, string>>;

  /**
   * UI Theme preference ('light' | 'dark' | 'system').
   */
  theme?: 'light' | 'dark' | 'system';

  /**
   * Desktop global shortcut (e.g. 'Alt+Space').
   */
  shortcut?: string;

  /**
   * User Persona preference ID.
   */
  persona?: PersonaType;

  /**
   * Custom Persona prompt description when persona is 'custom'.
   */
  customPersonaPrompt?: string;

  /**
   * Industry template pack ID (INDUSTRY_PACKS). 'general' = no addendum.
   */
  industryPack?: string;

  /**
   * UI 主题。'dark' = 深色（默认）; 'light' = 浅色。
   */
  skin?: 'dark' | 'light';

  /**
   * User-defined quick reply actions (name + prompt), rendered as chips in the reply panel.
   */
  customActions?: CustomAction[];

  /**
   * 个人专属词库：术语映射 / 受保护词 / 禁忌词，编译为 system prompt 硬约束。
   */
  glossary?: GlossaryRule[];

  /**
   * 我的文风标杆样本（few-shot，最多取 3 段），润色输出模仿用户本人笔触。
   */
  styleSamples?: string[];

  /**
   * 官方试用通道已消耗的估算 token 数（本地记账）。
   */
  trialTokensUsed?: number;

  /**
   * 飞书智能应答追踪是否开启。
   */
  feishuCopilotEnabled?: boolean;

  /**
   * 飞书智能应答模式：'collaborative'（人机协同预填）或 'autopilot'（全自动应答回车发送）。
   */
  feishuCopilotMode?: 'collaborative' | 'autopilot';
}

/**
 * 个人词库规则。kind:
 * - 'replace'：术语映射，输出中 from 一律写作 to；
 * - 'keep'：受保护词，禁止翻译/改写/展开（如缩写 DCN）；
 * - 'ban'：禁忌词，输出中绝对不得出现。
 */
export interface GlossaryRule {
  id: string;
  kind: 'replace' | 'keep' | 'ban';
  from: string;
  /** kind='replace' 时的目标词。 */
  to?: string;
}

/**
 * User-defined quick action: a named prompt snippet shown as a one-tap chip.
 * Pattern validated by PowerToys Advanced Paste / Raycast AI Commands / openai-translator.
 */
export interface CustomAction {
  id: string;
  name: string;
  prompt: string;
}

export type PersonaType = 'standard' | 'professional' | 'warm' | 'concise' | 'humorous' | 'custom';

export interface PersonaPreset {
  id: PersonaType;
  name: string;
  description: string;
  prompt: string;
}

export const PERSONA_PRESETS: PersonaPreset[] = [
  {
    id: 'standard',
    name: '智能跟随 (推荐)',
    description: 'AI 根据对话语境自动匹配语气，无需设置——对方随意就随意，对方正式就正式',
    prompt: '像平时聊天一样自然随意，简短直接，不刻意客套，和用户自己的说话习惯保持一致。',
  },
  {
    id: 'professional',
    name: '严谨商务',
    description: '沉稳干练、职场专业、逻辑严谨，适合正式汇报与跨部门沟通',
    prompt: '沉稳严谨、逻辑清晰、用词得体自信，符合高质量职场商务标准。',
  },
  {
    id: 'warm',
    name: '亲切亲和',
    description: '真诚周到、富有同理心与温度，适合客户关怀与团队伙伴协作',
    prompt: '真诚热情、富有同理心与沟通温度，语气亲切周到。',
  },
  {
    id: 'concise',
    name: '极简敏捷',
    description: '直切要害、短小精悍、不讲废话，适合高效快节奏交流',
    prompt: '极致精简干练，直奔主题核心，剔除一切冗余客套话。',
  },
  {
    id: 'humorous',
    name: '幽默风趣',
    description: '生动接梗、高情商自嘲与破冰，适合轻松活跃的社群与好友对话',
    prompt: '幽默轻松、机智生动、高情商化解与接梗，氛围轻松愉悦。',
  },
  {
    id: 'custom',
    name: '自定义人设',
    description: '自定义您的个性化身份背景、说话习惯与特定行业术语',
    prompt: '',
  },
];

/**
 * Industry template pack: injects scene rules into reply prompts and drives intent chips.
 * 'general' = current behavior (no addendum, default chips).
 */
export interface IndustryIntent {
  /** Short chip label shown in the reply panel. */
  label: string;
  /** Full instruction fed to the refine round when the chip is clicked. */
  instruction: string;
}

export interface IndustryPack {
  id: string;
  name: string;
  description: string;
  /** Multi-line scene rules injected into reply system prompts ('' = no injection). */
  sceneHint: string;
  /** Default intent chips for the reply panel ([] = default behavior). */
  intents: IndustryIntent[];
  /** 智能识别关键词：窗口标题/选中文本命中即自动启用该包（仅真实行业包需要）。 */
  autoKeywords?: string[];
}

/**
 * 智能识别：AI 根据窗口标题与选中文本自动判断是否注入行业场景规则，
 * 无命中时回退通用行为。用户无需理解"行业模板包"概念即可获得行业能力。
 */
export function detectIndustryPack(hintText: string): IndustryPack | null {
  const text = hintText.toLowerCase();
  let best: { pack: IndustryPack; score: number } | null = null;
  for (const pack of INDUSTRY_PACKS) {
    let score = 0;
    for (const kw of pack.autoKeywords ?? []) {
      if (text.includes(kw.toLowerCase())) score += kw.length >= 2 ? 2 : 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { pack, score };
  }
  return best ? best.pack : null;
}

export const INDUSTRY_PACKS: IndustryPack[] = [
  {
    id: 'auto',
    name: '智能识别 (推荐)',
    description: 'AI 根据窗口标题与选中文本自动判断行业场景，命中才注入规则，其余场景自动通用',
    sceneHint: '',
    intents: [],
  },
  {
    id: 'general',
    name: '通用',
    description: '不注入行业规则，适用于所有日常场景',
    sceneHint: '',
    intents: [],
  },
  {
    id: 'we_commerce',
    name: '微商·私域客服',
    autoKeywords: ['淘宝', '京东', '拼多多', '发货', '退款', '退货', '包邮', '订单', '亲，', '小店', '客服', '差评', '催发'],
    description: '私域卖家接待：咨询、议价、催付、物流、售后',
    sceneHint: `用户是微商/私域卖家，正在微信上接待咨询商品的客户。
场景常识：客户常见动作有问产品、比价砍价、拍下不付款、催发货、问物流、收货后售后；转账/红包是客户付款动作，不是需要文字回复的消息。
话术规则：
1. 像熟悉的店主，不像客服：称呼随和（亲、姐、宝），一句话说完，不用"您好""感谢惠顾"这类店腔。
2. 议价给台阶不硬拒：小额抹零/送小样/满减，比"不能便宜"更能成交；守住底价但不翻脸。
3. 拍下不付款：轻催一次，给台阶（库存紧张/帮留货），不连环催。
4. 红线：不夸大功效与收益，不承诺具体发货到货时间（说"尽快""一般X天"）；售后先安抚再定责。`,
    intents: [
      { label: '催付款', instruction: '礼貌催促拍下未付款的客户完成付款，用库存紧张/帮留货当台阶，一句话，不像催债。' },
      { label: '报物流', instruction: '告知物流进展或单号，顺带一句关怀，一句话。' },
      { label: '议价让步', instruction: '客户砍价，给出小让步方案（抹零/小赠品/满减）并引导下单，守住底价。' },
      { label: '婉拒议价', instruction: '客户砍价超出底线，婉拒并给替代价值（赠品/包邮/下次优惠），语气不硬邦邦。' },
      { label: '售后安抚', instruction: '客户反馈问题（质量/物流/不符预期），先安抚情绪，再要信息（照片/订单号），承诺处理。' },
      { label: '邀请复购', instruction: '对老客户自然带出新品/活动/复购优惠，像朋友分享不像广告。' },
    ],
  },
  {
    id: 'legal',
    name: '律所·法务咨询',
    autoKeywords: ['律师', '法务', '诉讼', '起诉', '律师事务所', '案件', '委托', '证据', '开庭'],
    description: '律师/法务微信接待：咨询、约谈、报价、风险提示',
    sceneHint: `用户是律师/法务，正在微信上接待潜在或已有委托的客户咨询。
场景常识：客户常发大段案情描述、问"能不能赢"、问收费、拖延交材料；微信咨询只是入口，成交在线下面谈与委托协议。
话术规则：
1. 专业但不说教：口语化表达，"根据您的描述"开头，一次只回答一个问题。
2. 不预测结果：只讲流程、条件与风险，禁用"肯定能赢/没问题/判不了"类结论；证据不明时说"要看证据情况"。
3. 收费话题：给计费方式和区间，说明具体方案面谈后确定，不在线上讨价还价。
4. 自然推进委托：咨询到火候主动约面谈，给时间选项，说明要带的材料，不催促不推销。
5. 红线：微信里不做正式法律意见，重要结论补一句"以面谈和书面意见为准"。`,
    intents: [
      { label: '初步接待', instruction: '首次咨询的客户，简短回应案情，问清关键信息（时间/证据/对方情况），引导客户补充。' },
      { label: '约面谈', instruction: '推进到线下面谈，给出时间选项和地点，说明面谈要带的材料。' },
      { label: '报价引导', instruction: '客户问收费，给计费方式与大致区间，说明具体方案面谈后确定，引导到面谈。' },
      { label: '材料清单', instruction: '逐项列出客户需要准备的证据材料，并说明各项用途。' },
      { label: '风险提示', instruction: '客户预期过高或想走偏门（造假/拖延/私了），委婉提示法律风险并给出正确路径。' },
    ],
  },
  {
    id: 'estate_insurance',
    name: '房产·保险销售',
    autoKeywords: ['楼盘', '置业', '房源', '首付', '按揭', '保险', '保单', '保费', '理赔', '户形', '看房'],
    description: '置业顾问/保险经纪微信跟进：邀约、异议、促成',
    sceneHint: `用户是房产置业顾问或保险经纪人，正在微信上跟进意向客户。
场景常识：客户已留过联系方式，处于观望、比较、犹豫阶段；常见动作是问价格、说"再考虑考虑"、拿竞品压价、已读不回。
话术规则：
1. 给选项不给压迫感：每次跟进带一个具体由头（新房源/费率调整/名额），让客户做选择题，不做填空题。
2. 已读不回正常化：不质问"为什么不回"，换个由头隔天再触达，一条消息只讲一个主题。
3. 异议处理：先认同再补充信息（价格贵→对比价值与分期方案），不与客户争辩。
4. 红线：不夸大升值与收益，不承诺"稳赚/保本/肯定涨"；不贬低竞品，只讲差异；保险讲清条款边界，不承诺"什么都赔"。`,
    intents: [
      { label: '破冰跟进', instruction: '长期未回复的客户，用新由头（房源上新/活动/政策变化）自然重启对话，不提"你怎么不回我"。' },
      { label: '邀约到访', instruction: '推进到线下，给出两个具体时间选项加地点，说明停车/时长等降低决策成本的信息。' },
      { label: '异议处理', instruction: '客户说"太贵了/再考虑"，先认同再给新信息（价值对比/分期/限时优惠），轻推一把不施压。' },
      { label: '方案对比', instruction: '客户拿竞品比较，客观讲差异点与适配人群，不贬低对方，引导到"看适不适合您"。' },
      { label: '促成提醒', instruction: '客户意向明确但拖延，用真实稀缺（名额/费率截止/房源状态）给行动理由，不虚报紧迫感。' },
    ],
  },
  {
    id: 'gov_docs',
    name: '公文·体制内',
    autoKeywords: ['请示', '批复', '公文', '纪要', '红头文件', '贯彻落实', '政务', '科室', '党组', '行文', '函件'],
    description: '体制内公文写作与汇报材料：规范格式、稳妥措辞（GB/T 9704 语体）',
    sceneHint: `用户是体制内工作人员，正在起草或润色党政机关公文/汇报材料。
场景常识：公文面向上级、平级或下级机关，语体遵循《党政机关公文格式》(GB/T 9704-2012) 的庄重平实传统；材料可能被领导逐字审阅。
行文规则：
1. 语体庄重平实、准确简明：用"应当""予以""按照""现就"等规范公文动词，杜绝网络语、口语叹词与夸张修辞。
2. 结构完整：依据—事项—要求层次分明；需要请示时一文一事，结尾按文种规范收束（"特此通知""妥否，请批示""此复"）。
3. 表述留有余地：不写绝对化承诺，涉及数字、时间、责任主体必须明确具体。
4. 红线：不编造政策依据与领导指示；政治性表述、领导人称谓与排序必须规范，不确定时提醒用户核实原文。`,
    intents: [
      { label: '口语转公文体', instruction: '把口语化草稿转成规范公文体：庄重平实、层次分明，用规范公文动词，去掉口语与感叹。' },
      { label: '拟通知', instruction: '按"依据—事项—要求"结构起草/润色通知，结尾用"特此通知"，事项表述可执行可核对。' },
      { label: '拟请示', instruction: '一文一事拟写请示：先依据再事项，结尾"妥否，请批示"，语气恳切不卑不亢。' },
      { label: '成稿润色', instruction: '保持文种与结构不变，仅修正语病、规范措辞与公文动词搭配，使行文更庄重严谨。' },
      { label: '汇报提纲', instruction: '整理成汇报提纲：基本情况—主要做法—下一步安排，每部分要点式表达，突出成效数据。' },
    ],
  },
];

/**
 * Provider metadata definition for UI selection.
 */
export interface ProviderPreset {
  id: ProviderType;
  name: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  description?: string;
}

/**
 * Default standard provider presets.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek (推荐)',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    description: '官方 API，中文表现出色且性价比高',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
    description: '全球领先的通用大模型',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow (硅基流动)',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    models: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-72B-Instruct'],
    description: '国内高速高并发模型分发云',
  },
  {
    id: 'ollama',
    name: 'Ollama (本地部署)',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:7b',
    models: ['qwen2.5:7b', 'llama3.1:8b', 'deepseek-r1:7b'],
    description: '本地私有化部署，数据 100% 隐私离线',
  },
  {
    id: 'custom',
    name: '自定义端点 (Custom)',
    baseUrl: '',
    defaultModel: '',
    models: [],
    description: '兼容 OpenAI API 规范的任意自定义中转或代理',
  },
];

/**
 * Human-readable localized names for polishing styles.
 */
export const STYLE_NAMES: Record<PolishStyle, string> = {
  polished: '通用润色',
  academic: '学术规范',
  business: '职场商务',
  literary: '文采飞扬',
  concise: '精简提炼',
  native_en: '地道英文',
  reply: '智能回复',
  translate: '翻译',
};

/**
 * 官方试用代理通道 baseUrl（OpenAI 兼容）。空串 = 服务端尚未上线，
 * 客户端记账与回退逻辑已就绪但默认关闭，避免对不存在的服务发请求。
 * ponytail: 上线时改这一个常量即可，无需迁移。
 */
export const TRIAL_PROXY_BASE_URL = '';

/** 新设备赠送的试用 token 额度（约 300 次润色）。 */
export const TRIAL_TOKEN_QUOTA = 100_000;

/**
 * 保守估算一次请求消耗的 token 数：中文按 ~1.5 字符/token、其他按 ~3.5 字符/token，
 * 偏高估防止超额；等服务端返回真实 usage 后可替换记账来源。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const other = text.length - cjk;
  return Math.ceil(cjk / 1.5 + other / 3.5);
}

/** 试用通道剩余额度；未开通通道时恒为 0。 */
export function trialRemainingTokens(trialTokensUsed?: number): number {
  if (!TRIAL_PROXY_BASE_URL) return 0;
  return Math.max(0, TRIAL_TOKEN_QUOTA - (trialTokensUsed ?? 0));
}

/**
 * Default fallback application configuration.
 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  triggerMode: 'capsule',
  enabled: true,
  blacklist: [],
  customPrompts: {},
  theme: 'system',
  shortcut: 'Alt+Space',
  industryPack: 'auto',
};
