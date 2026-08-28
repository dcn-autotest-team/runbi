/**
 * @file shared/core/prompts.ts
 * 6+ Preset Scene Prompts & Dynamic Prompt Template Builder
 * 100% Pure Logic — Platform Agnostic
 */

import type { PolishStyle } from '../types/stream';

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
    '你是一名专业的文本回复与沟通助手。你的职责是针对用户提供的文本生成得体、逻辑严密、恰如其分的回复内容。',
};

/**
 * Comprehensive metadata registry for all 7 styles.
 */
export const STYLE_PRESETS: StylePresetMetadata[] = [
  {
    id: 'polished',
    name: '通用润色',
    shortName: '通用',
    description: '修正语病与错别字，理顺逻辑，使语言地道流畅',
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
];

/**
 * Strict System Guardrails appended to all polishing prompts.
 */
export const SYSTEM_GUARDRAILS = `
【极其严苛的规则】：
1. 直接输出润色后的终稿内容。
2. 严禁包含任何前缀或后缀客套话（如“好的，这是润色后的版本：”、“希望对你有帮助”等）。
3. 严禁添加引号包裹，严禁自行添加 markdown 标题。
4. 保持原文的段落排版格式与换行符。`;

export interface PromptBuildOptions {
  style: PolishStyle;
  customPromptOverride?: string;
  userInstruction?: string;
  hasVisionContext?: boolean;
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
  const { style, customPromptOverride, userInstruction, hasVisionContext } = options;

  let base =
    customPromptOverride && customPromptOverride.trim()
      ? customPromptOverride.trim()
      : DEFAULT_STYLE_PROMPTS[style] || DEFAULT_STYLE_PROMPTS.polished;

  if (style === 'reply' && hasVisionContext) {
    base =
      '你是一名顶级的即时通讯与会话回复专家。你的职责是：仔细观察截图中呈现的完整聊天上下文（包括上下文各发言人的消息、对方的真实诉求与对话背景），针对用户划选的目标消息，生成一条自然得体、高情商且全面呼应上文所有要点的精准回复。';
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
 * Interpolates variables in custom template string (e.g. `{text}`, `{instruction}`).
 */
export function interpolateTemplate(
  template: string,
  variables: Record<string, string | number | undefined>
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    const val = variables[key];
    return val !== undefined ? String(val) : match;
  });
}

export interface ScreenReplyAnalysis {
  conversation: Array<{ sender: 'me' | 'other'; text: string }>;
  last_message_from_other: string;
  ambiguity?: string;
  clarify_options?: string[];
  draft_reply: string;
}

/**
 * Builds system prompt for Round 1 screen reply analysis (structured JSON extraction).
 */
export function buildScreenReplySystemPrompt(): string {
  return `你是一名顶级的即时通讯与对话理解专家。你的任务是深入分析聊天窗口截图中呈现的对话记录，提炼上下文与对方的核心意图，并构思回复建议。
【极其严格的格式要求】：
1. 必须输出且仅输出一个合法的 JSON 对象，格式必须完全符合如下结构：
{
  "conversation": [
    {"sender": "other", "text": "对方发的消息内容"},
    {"sender": "me", "text": "我发的消息内容"}
  ],
  "last_message_from_other": "对方最新发送的、需要我回复的消息",
  "ambiguity": "简要说明对话背景、对方期望或信息要点",
  "clarify_options": ["更正式一点", "热情答应", "婉言谢绝"],
  "draft_reply": "基于现有信息生成的默认自然、高情商回复草稿"
}
2. 严禁输出任何 markdown 代码块外部的客套话或多余文字。`;
}

/**
 * Builds user prompt for Round 1 screen reply analysis.
 */
export function buildScreenReplyUserPrompt(): string {
  return `请仔细观察屏幕截图中的聊天界面，提取对话（"me" 代表自己，"other" 代表对方），分析对方最新诉求，并输出符合要求的 JSON 分析与默认回复草稿。`;
}

/**
 * Builds prompt for Round 2 screen reply refinement (based on conversation context + user chip / input).
 */
export function buildScreenReplyRefinePrompt(
  conversation: Array<{ sender: 'me' | 'other'; text: string }>,
  instruction: string
): string {
  const historyText = conversation
    .map((c) => `[${c.sender === 'me' ? '我' : '对方'}]: ${c.text}`)
    .join('\n');
  return `【历史对话记录】：\n${historyText}\n\n【我的回复要求/语气偏好】：\n${instruction}\n\n请直接生成最终的回复内容。`;
}
