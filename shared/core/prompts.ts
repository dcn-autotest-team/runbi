/**
 * @file shared/core/prompts.ts
 * 6+ Preset Scene Prompts & Dynamic Prompt Template Builder
 * 100% Pure Logic — Platform Agnostic
 */

import type { PolishStyle } from '../types/stream';
import type { GlossaryRule, IndustryIntent, IndustryPack } from '../types/settings';

export interface StylePresetMetadata {
  id: PolishStyle;
  name: string;
  shortName: string;
  description: string;
  icon: string;
  placeholder: string;
  shortcutKey: string;
  defaultTemperature: number;
  systemPrompt: string;
}

/**
 * Default System Prompts for all 7 styles.
 */
export const DEFAULT_STYLE_PROMPTS: Record<PolishStyle, string> = {
  polished:
    '你是一名文字润色专家。你的唯一职责是对用户的文本进行通用润色，消除语病，表达通顺自然，保持原意与语气。',
  academic:
    '你是一名文字润色专家。你的唯一职责是对用户的文本进行学术规范化润色，符合SCI/顶会论文风格，用词客观、精炼、高级，论证严谨，消除中式口语。',
  business:
    '你是一名文字润色专家。你的唯一职责是对用户的文本进行职场商务润色，礼貌得体、自信专业，适合邮件与汇报沟通。',
  literary:
    '你是一名文字润色专家。你的唯一职责是对用户的文本进行文学润色，增强词藻意境，比喻生动，修辞优雅。',
  concise:
    '你是一名文字润色专家。你的唯一职责是对用户的文本进行精简提炼，剔除冗词废话，字数缩减30%~50%，直奔主题。',
  native_en:
    '你是一名文字润色与翻译专家。若原文为中文则意译为地道母语级英文；若原文为英文则地道化俚语与语法，表达纯正典雅。',
  reply:
    '你是帮用户在微信、企业微信、钉钉等聊天软件里回消息的助手。根据对方消息起草一条可以直接发送的回复，必须像用户本人平时打字的样子，绝不能有 AI 腔、客服腔。',
  translate:
    '你是一名专业翻译。把用户发来的内容忠实翻译成目标语言，译文自然地道，不增不减、不加解释。',
};

/**
 * Comprehensive metadata registry for all 7 styles.
 */
export const STYLE_PRESETS: StylePresetMetadata[] = [
  {
    id: 'polished',
    name: '通用润色',
    shortName: '通用',
    description: '修正错别字与语病，理顺逻辑，使语言地道流畅',
    icon: 'Sparkles',
    placeholder: '输入额外润色要求（如：保持活泼、口吻亲切）...',
    shortcutKey: '1',
    defaultTemperature: 0.3,
    systemPrompt: DEFAULT_STYLE_PROMPTS.polished,
  },
  {
    id: 'academic',
    name: '学术规范',
    shortName: '学术',
    description: 'SCI/顶会论文风格，用词严谨客观，去除口语化',
    icon: 'GraduationCap',
    placeholder: '输入论文领域或风格要求（如：IEEE 格式、偏被动语态）...',
    shortcutKey: '2',
    defaultTemperature: 0.2,
    systemPrompt: DEFAULT_STYLE_PROMPTS.academic,
  },
  {
    id: 'business',
    name: '职场商务',
    shortName: '商务',
    description: '专业得体、自信高效，适用于邮件、周报与方案汇报',
    icon: 'Briefcase',
    placeholder: '输入商务沟通背景（如：向领导汇报、对外部客户）...',
    shortcutKey: '3',
    defaultTemperature: 0.3,
    systemPrompt: DEFAULT_STYLE_PROMPTS.business,
  },
  {
    id: 'literary',
    name: '文采飞扬',
    shortName: '文采',
    description: '增强修辞意境，词藻生动优美，富于感染力',
    icon: 'Feather',
    placeholder: '输入修辞风格偏好（如：诗意优美、古典韵味）...',
    shortcutKey: '4',
    defaultTemperature: 0.6,
    systemPrompt: DEFAULT_STYLE_PROMPTS.literary,
  },
  {
    id: 'concise',
    name: '精简提炼',
    shortName: '精简',
    description: '去粗取精，提炼核心论点，大幅精简字数',
    icon: 'Scissors',
    placeholder: '输入精简目标（如：压缩至100字内、提取要点）...',
    shortcutKey: '5',
    defaultTemperature: 0.2,
    systemPrompt: DEFAULT_STYLE_PROMPTS.concise,
  },
  {
    id: 'native_en',
    name: '地道英文',
    shortName: '英文',
    description: '母语级地道表达，杜绝中式英语，符合国际学术与商务标准',
    icon: 'Globe',
    placeholder: '输入受众与语境（如：American English / Academic / Casual）...',
    shortcutKey: '6',
    defaultTemperature: 0.3,
    systemPrompt: DEFAULT_STYLE_PROMPTS.native_en,
  },
  {
    id: 'reply',
    name: '智能回复',
    shortName: '回复',
    description: '针对他人发来的消息，快速构思得体、高情商的回复',
    icon: 'MessageSquare',
    placeholder: '输入回复意向（如：委婉拒绝、表示感谢并推迟交付）...',
    shortcutKey: '7',
    defaultTemperature: 0.4,
    systemPrompt: DEFAULT_STYLE_PROMPTS.reply,
  },
  {
    id: 'translate',
    name: '翻译',
    shortName: '翻译',
    description: '划词翻译为英文/简体中文/繁体中文/日文/韩文',
    icon: 'Languages',
    placeholder: '输入翻译要求（如：更口语化、保留术语）...',
    shortcutKey: '8',
    defaultTemperature: 0.2,
    systemPrompt: DEFAULT_STYLE_PROMPTS.translate,
  },
];

/**
 * 翻译模式目标语言表（划词翻译下拉，顺序即展示顺序）。
 */
export const TRANSLATE_TARGETS = [
  { id: 'en', label: '英文' },
  { id: 'zh-Hans', label: '简体中文' },
  { id: 'zh-Hant', label: '繁体中文' },
  { id: 'ja', label: '日文' },
  { id: 'ko', label: '韩文' },
] as const;

export type TranslateTargetId = (typeof TRANSLATE_TARGETS)[number]['id'];

export function translateTargetLabel(id: string): string {
  return TRANSLATE_TARGETS.find((t) => t.id === id)?.label ?? '英文';
}

/**
 * 翻译模式系统提示词：经 customPromptOverride 注入，目标语言逐次替换。
 */
export function buildTranslateSystemPrompt(targetId: string): string {
  return `你是一名专业翻译。把用户发来的全部内容忠实地翻译成【${translateTargetLabel(targetId)}】，只输出译文本体：
1. 信达雅：语义不增不减，不解释、不注音、不复述原文。
2. 专有名词、代码、命令、网址、数学公式保持原样。
3. 术语在全文中保持一致译法。`;
}

/**
 * Strict System Guardrails appended to all polishing prompts.
 */
export const SYSTEM_GUARDRAILS = `
【极其严苛的规则】：
1. 直接输出润色后的终稿内容。
2. 严禁包含任何前缀或后缀客套话（如“好的，这是润色后的版本：”、“希望对你有帮助”等）。
3. 严禁添加引号包裹，严禁自行添加 markdown 标题。
4. 保持原文的段落排版格式与换行符。`;

/**
 * Anti-AI-flavor rules for chat replies, appended to every reply-path prompt.
 * The output gets pasted straight into IM apps, so it must read like the user typing.
 */
export const REPLY_GUARDRAILS = `
【真人感铁律】生成的回复会被直接粘贴进聊天软件发送，必须像用户本人随手打出来的字；若与前面任何规则冲突，以本铁律为准：
1. 短：默认一句话，能短则短；只有对方一次交代多件事时才逐件简短回应，禁止长篇大论。
2. 语气跟对方走：对方随意你就随意（可用"哈""行""好嘞""嗯嗯"这类口语），对方正式你才正式，永远不比对方更客气。
3. 不说客服腔：不用"好的""收到""没问题！""当然可以！"这类开头，直接回应事情本身，或干脆只回一个"好"。
4. 不面面俱到：只回应最关键的一件事，不复述对方的话，不用总结句（"总之""希望对你有帮助""有问题随时找我"）。
5. 禁止分点列表、排比句，不用"首先/其次/另外"这类书面连接词。
6. emoji 只在对方用了的时候跟随，最多一个；对方没用就一个也不发。
7. 允许口语化的不完美：语气词收尾、省略主语、半截句，都比完整通顺的书面语更像真人。
8. 信息不够就简短问回去（"几点？""在哪碰头？"），禁止脑补细节硬答。`;

export interface PromptBuildOptions {
  style: PolishStyle;
  customPromptOverride?: string;
  userInstruction?: string;
  hasVisionContext?: boolean;
  personaPrompt?: string;
  packPrompt?: string;
  /** 个人词库硬约束层（buildGlossaryPrompt 产物，含前导换行）。 */
  glossaryPrompt?: string;
  /** 文风标杆 few-shot（buildStyleSamplesPrompt 产物，含前导换行）。 */
  styleSamplesPrompt?: string;
  /** 宿主应用细粒度风格附注（buildAppStylePrompt 产物，含前导换行）。 */
  appStylePrompt?: string;
  /** 原文含 LaTeX 标记时追加语法保护段。 */
  latexGuard?: boolean;
}

export interface UserPromptOptions {
  text: string;
  userInstruction?: string;
  hasVisionContext?: boolean;
}

/**
 * Builds the strict system prompt for LLM completions.
 */
export function buildSystemPrompt(options: PromptBuildOptions): string {
  const { style, customPromptOverride, userInstruction, hasVisionContext, personaPrompt, packPrompt } = options;

  let base =
    customPromptOverride && customPromptOverride.trim()
      ? customPromptOverride.trim()
      : DEFAULT_STYLE_PROMPTS[style] || DEFAULT_STYLE_PROMPTS.polished;

  if (style === 'reply' && hasVisionContext) {
    base =
      '你是帮用户回聊天消息的助手。仔细观察截图中完整的聊天上下文（各方消息与对方的真实诉求），针对用户划选的目标消息，起草一条可以直接发送的回复。注意身份判定：气泡靠窗口右侧、头像在右侧的是用户自己（我）的消息，靠左侧、头像在左侧的是对方——只按对齐方向判定，消息内容不得用于判定身份；[视频通话]/转账/红包等系统消息不算发言。回复必须像用户本人随手打出来的字，绝不能有 AI 腔。';
  }

  if (style === 'reply') {
    base += REPLY_GUARDRAILS;
  }

  if (personaPrompt && personaPrompt.trim()) {
    base += `\n【用户人设风格偏好】：${personaPrompt.trim()}\n生成时请深度契合此人设特征。`;
  }

  if (packPrompt && packPrompt.trim()) {
    base += `\n【行业场景规则】：\n${packPrompt.trim()}`;
  }

  if (options.appStylePrompt && options.appStylePrompt.trim()) {
    base += options.appStylePrompt;
  }

  if (options.styleSamplesPrompt && options.styleSamplesPrompt.trim()) {
    base += options.styleSamplesPrompt;
  }

  // 词库硬约束放在最靠近 userInstruction 的位置：越靠后优先级越高，压过风格/行业规则。
  if (options.glossaryPrompt && options.glossaryPrompt.trim()) {
    base += options.glossaryPrompt;
  }

  if (options.latexGuard) {
    base += LATEX_GUARD_PROMPT;
  }

  if (userInstruction && userInstruction.trim()) {
    base += `\n用户提出了特定的回复与处理要求：“${userInstruction.trim()}”。请在生成时重点满足该要求。`;
  }

  return `${base}\n${SYSTEM_GUARDRAILS}`.trim();
}

/**
 * Builds the structured user prompt payload.
 */
export function buildUserPrompt(options: UserPromptOptions): string {
  const { text, userInstruction, hasVisionContext } = options;

  if (hasVisionContext) {
    let prompt = `【划选的目标消息】：\n"""\n${text}\n"""\n\n请结合屏幕截图中该消息前后的完整聊天记录背景，直接为我输出一条最合适、能精准呼应全部上文的回复内容。`;
    if (userInstruction && userInstruction.trim()) {
      prompt += `\n\n【我的具体回复要求】：\n${userInstruction.trim()}`;
    }
    return prompt;
  }

  if (userInstruction && userInstruction.trim()) {
    return `【参考文本】：\n"""\n${text}\n"""\n\n【我的具体处理要求】：\n${userInstruction.trim()}`;
  }

  return text;
}

/**
 * Replaces `{variable}` placeholders in template strings with actual values.
 */
export function interpolatePrompt(
  template: string,
  variables: Record<string, string | number | boolean | undefined>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const val = variables[key];
    return val !== undefined ? String(val) : match;
  });
}

export const interpolateTemplate = interpolatePrompt;

export interface ScreenReplyAnalysis {
  conversation: Array<{ sender: 'me' | 'other'; text: string }>;
  last_message_from_other: string;
  ambiguity?: string;
  clarify_options?: string[];
  draft_reply: string;
}

/**
 * Industry pack scene-rules section for reply system prompts ('' when no pack).
 */
function buildPackSection(pack?: IndustryPack): string {
  if (!pack || !pack.sceneHint.trim()) return '';
  return `\n【行业场景规则】：\n${pack.sceneHint.trim()}\n`;
}

/**
 * clarify_options example aligned with pack intents (null = generic defaults).
 */
function packIntentLabels(pack?: IndustryPack): string[] | null {
  return pack && pack.intents.length ? pack.intents.map((i) => i.label) : null;
}

/**
 * Builds system prompt for Round 1 screen reply analysis (structured JSON extraction).
 */
export function buildScreenReplySystemPrompt(personaPrompt?: string, pack?: IndustryPack): string {
  const personaSection = personaPrompt && personaPrompt.trim()
    ? `\n【用户人设风格偏好】：${personaPrompt.trim()}\n在提取意图并生成草稿时深度契合此人设风格。\n`
    : '';
  const clarifyExample = packIntentLabels(pack) || ['更正式一点', '热情答应', '婉言谢绝'];
  return `你是一名顶级的即时通讯与对话理解专家。你的任务是深入分析聊天窗口截图中呈现的对话记录，提炼上下文与对方的核心意图，并构思回复建议。${personaSection}${buildPackSection(pack)}
【身份判定铁律】（sender 标错会导致回复立场完全颠倒，必须逐条核对）：
1. 主流 IM（微信/QQ/企业微信/钉钉/飞书/Telegram 等）中：气泡靠窗口右侧、头像在气泡右侧的是"我"发的消息；气泡靠左侧、头像在气泡左侧的是"对方"。
2. 微信中自己的气泡为绿色/深色，对方的气泡为白色/浅灰色，可用颜色与对齐方向互相印证。
3. [视频通话]、转账、红包、拍一拍、时间戳、撤回提示等系统消息不是任何一方的发言，禁止计入 conversation；转账/红包须在 ambiguity 中写明金额与状态（如"对方发来¥200转账，已被领取"）。
4. 只依据"气泡在窗口中的左右位置"判定身份，这是唯一可靠的依据；消息内容、称呼、语气一律不得用于判定（用户可能转发、引用任何人的话）。
5. 划选的目标消息同样按其对齐方向判定：它可能在左侧（对方发的，需要我回应）也可能在右侧（我自己发的，如需修改措辞则以润色语气处理）。
6. 输出前逐条自查：每条 sender 是否与该气泡的左右对齐方向一致；确实无法判断时在 ambiguity 中说明，禁止凭文本内容猜测身份。
【极其严格的格式要求】：
1. 必须输出且仅输出一个合法的 JSON 对象，格式必须完全符合如下结构：
{
  "conversation": [
    {"sender": "other", "text": "对方发的消息内容"},
    {"sender": "me", "text": "我发的消息内容"}
  ],
  "last_message_from_other": "对方最新的消息或动作，是我需要回应的对象",
  "ambiguity": "简要说明对话背景、对方期望或信息要点（转账/红包写明金额与状态）",
  "clarify_options": ${JSON.stringify(clarifyExample)},
  "draft_reply": "默认回复草稿：简短口语化、像真人随手打的字"
}
2. 严禁输出任何 markdown 代码块外部的客套话或多余文字。`;
}

/**
 * Builds user prompt for Round 1 screen reply analysis.
 */
export function buildScreenReplyUserPrompt(): string {
  return `请仔细观察屏幕截图中的聊天界面，提取对话（"me" 代表自己，"other" 代表对方，依据气泡对齐方向与头像位置判定身份，系统消息不计入），分析对方最新诉求，并输出符合要求的 JSON 分析与默认回复草稿。`;
}

/**
 * Builds prompt for Round 2 screen reply refinement (based on conversation context + user chip / input).
 */
export function buildScreenReplyRefinePrompt(
  conversation: Array<{ sender: 'me' | 'other'; text: string }>,
  instruction: string,
  personaPrompt?: string,
  packPrompt?: string,
  glossaryPrompt?: string
): string {
  const historyText = conversation
    .map((c) => `[${c.sender === 'me' ? '我' : '对方'}]: ${c.text}`)
    .join('\n');
  return [
    `【历史对话记录】：\n${historyText}`,
    `【我的回复要求/语气偏好】：\n${instruction}`,
    personaPrompt && personaPrompt.trim() ? `【我的人设风格偏好】：\n${personaPrompt.trim()}` : '',
    packPrompt && packPrompt.trim() ? `【行业场景规则】：\n${packPrompt.trim()}` : '',
    glossaryPrompt && glossaryPrompt.trim() ? glossaryPrompt.trim() : '',
    '请直接生成最终的回复内容。',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Builds system prompt for text-only reply analysis (structured JSON extraction for selected chat messages).
 */
export function buildTextReplySystemPrompt(personaPrompt?: string, pack?: IndustryPack): string {
  const personaSection = personaPrompt && personaPrompt.trim()
    ? `\n【用户人设风格偏好】：${personaPrompt.trim()}\n在构思回复建议与草稿时深度契合此人设风格。\n`
    : '';
  const clarifyExample = packIntentLabels(pack) || ['积极推进/正面答复', '严谨对齐/确认细节', '委婉缓冲/礼貌借过'];
  return `你是帮用户回聊天消息的助手。针对用户提供的对方消息，理解对方的真实诉求与情境，并构思回复建议。${personaSection}${buildPackSection(pack)}
【极其严格的格式要求】：
1. 必须输出且仅输出一个合法的 JSON 对象，格式必须完全符合如下结构：
{
  "conversation": [
    {"sender": "other", "text": "对方发来的核心消息（若划选消息疑似用户自己发的，则该条 sender 标为 me 并说明）"}
  ],
  "last_message_from_other": "对方发来的核心消息",
  "ambiguity": "简要说明对话背景或对方期望",
  "clarify_options": ${JSON.stringify(clarifyExample)},
  "draft_reply": "默认回复草稿：简短口语化、像真人随手打的字"
}
2. 严禁输出任何 markdown 代码块外部的客套话或多余文字。`;
}

/**
 * Builds user prompt for text-only reply analysis.
 */
export function buildTextReplyUserPrompt(message: string): string {
  return `【划选的目标消息】：\n"""\n${message}\n"""\n\n注意：这条消息在聊天窗口中的对齐方向决定它是"对方发的"还是"我自己发的"——只有它确实是对方发来的，才需要你构思回复；如果它看起来像用户自己说过的话（如自我陈述、工作汇报、转发摘要），请在 ambiguity 中说明并以润色语气而非回复立场处理。输出符合要求的 JSON 分析与默认回复草稿。`;
}

/**
 * 润色模式通用高频微意图芯片：点击即以该意图生成，可与补充要求叠加。
 * 与"润色方式"下拉（文风）互补——这里解决的是"这段话要达成什么目的"。
 */
export const INTENT_CHIPS: IndustryIntent[] = [
  { label: '委婉推脱', instruction: '在不伤和气的前提下婉拒或推脱当前请求，给一个台阶或替代方案，不生硬说不。' },
  { label: '礼貌催促', instruction: '催促对方推进或交付，语气礼貌、给对方留台阶，不带指责感。' },
  { label: '去AI味', instruction: '消除 AI 腔与翻译腔：去掉套路化连接词与空洞总结句，用自然、具体、有具体细节的表达。' },
  { label: '向上汇报', instruction: '转成向上汇报口吻：结论先行、要点清晰、措辞稳妥，突出进展与下一步安排。' },
  { label: '分点提炼', instruction: '把内容整理成清晰的分点结构，每点一句话，可执行可核对。' },
];

/**
 * 个人词库硬约束层（缺陷5 Glossary & Rulebook）。
 * 返回带前导换行的完整段落，'' = 无规则。
 */
export function buildGlossaryPrompt(glossary?: GlossaryRule[]): string {
  const rules = glossary ?? [];
  const replace = rules.filter((r) => r.kind === 'replace' && r.from.trim() && r.to?.trim());
  const keep = rules.filter((r) => r.kind === 'keep' && r.from.trim());
  const ban = rules.filter((r) => r.kind === 'ban' && r.from.trim());

  const lines: string[] = [];
  if (replace.length) {
    lines.push(`术语映射（必须严格执行）：${replace.map((r) => `"${r.from}"一律写作"${r.to}"`).join('；')}。`);
  }
  if (keep.length) {
    lines.push(`受保护词（保持原样，禁止翻译、改写、展开或加注）：${keep.map((r) => r.from).join('、')}。`);
  }
  if (ban.length) {
    lines.push(`禁忌词（输出中绝对不得出现）：${ban.map((r) => r.from).join('、')}，遇到时换用自然的中性表达。`);
  }
  if (!lines.length) return '';
  return `\n【个人词库硬约束】（优先级最高，与任何风格/行业规则冲突时以本节为准）：\n${lines
    .map((l, i) => `${i + 1}. ${l}`)
    .join('\n')}`;
}

/**
 * 文风标杆 few-shot（缺陷5 样本学风）。最多取 3 段、每段截断 300 字防止 prompt 膨胀。
 */
export function buildStyleSamplesPrompt(samples?: string[]): string {
  const picked = (samples ?? [])
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .slice(0, 3);
  if (!picked.length) return '';
  const blocks = picked
    .map((s, i) => `【标杆样本 ${i + 1}】\n${s.length > 300 ? `${s.slice(0, 300)}…` : s}`)
    .join('\n\n');
  return `\n【我的文风标杆】以下是我本人写过的文字。输出必须模仿这些样本的断句习惯、用词、语气与标点风格，让人读起来就像我亲手写的一样：\n${blocks}`;
}

/**
 * 前景应用 → 细粒度风格附注（缺陷6 宿主感知最后一层）。
 * sourceApp 为进程映像文件名（如 "WeChat.exe"，带不带 .exe 均可）。
 */
const PER_APP_STYLE_RULES: Array<{ pattern: RegExp; hint: string }> = [
  {
    pattern: /wechat|weixin|dingtalk|feishu|lark|wework|qq/i,
    hint: '输出将直接用于微信/钉钉/飞书等聊天软件：短句、口语化、高情商、带一点人情味，禁止书面腔与长篇大论。',
  },
  {
    pattern: /winword|wps|excel|powerpnt/i,
    hint: '输出将粘贴进 Word/WPS 等办公文档：规范书面语、严谨标点、完整句式，允许正式庄重。',
  },
  {
    pattern: /code|devenv|sublime|pycharm|idea64|goland/i,
    hint: '输出用于代码场景：注释与提交信息要简洁精准；英文遵循 commit message 惯例（祈使句、行尾不加句号）。',
  },
  {
    pattern: /outlook|foxmail|thunderbird|mail/i,
    hint: '输出为电子邮件正文：开头得体问候，结尾规范祝颂语（如"顺颂商祺"/"祝好"），段落清晰、一事一段。',
  },
];

export function buildAppStylePrompt(sourceApp?: string | null): string {
  if (!sourceApp) return '';
  const hit = PER_APP_STYLE_RULES.find((r) => r.pattern.test(sourceApp));
  return hit ? `\n【宿主应用适配】：${hit.hint}` : '';
}

/**
 * LaTeX 语法保护（缺陷8 学术模式）。
 * ponytail: 用正则提取而非真正解析 TeX——够覆盖 $...$、$$...$$、\cite/\ref/\label 与常见命令，
 * 误报代价只是多一句提示；完整 TeX 解析属于过度工程。
 */
const LATEX_TOKEN_RE = /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\[a-zA-Z]+\s*(?:\{[^{}\n]*\})?/g;

export function hasLatexMarkers(text: string): boolean {
  if (!text) return false;
  LATEX_TOKEN_RE.lastIndex = 0;
  return LATEX_TOKEN_RE.test(text);
}

/** 提取原文中不可篡改的 LaTeX token（按出现顺序去重）。 */
export function extractLatexTokens(text: string): string[] {
  if (!text) return [];
  LATEX_TOKEN_RE.lastIndex = 0;
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const m of text.matchAll(LATEX_TOKEN_RE)) {
    const t = m[0].trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      tokens.push(t);
    }
  }
  return tokens;
}

/**
 * 校验润色结果是否保留了原文的全部 LaTeX token。
 * 返回被丢失/篡改的 token 列表（空数组 = 通过）。
 */
export function findLatexViolations(original: string, result: string): string[] {
  return extractLatexTokens(original).filter((t) => !(result || '').includes(t));
}

export const LATEX_GUARD_PROMPT = `
【LaTeX 源码保护】原文包含 LaTeX 标记，以下内容为不可篡改部分：所有数学公式（$...$、$$...$$）与命令序列（\\cite{}、\\ref{}、\\label{}、\\begin{} 等）必须逐字符原样保留，禁止翻译、改写、增删空格或花括号；只润色公式与命令之外的自然语言。`;

