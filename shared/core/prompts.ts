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
}

export interface UserPromptOptions {
  text: string;
  userInstruction?: string;
}

/**
 * Builds the strict system prompt for LLM completions.
 */
export function buildSystemPrompt(options: PromptBuildOptions): string {
  const { style, customPromptOverride, userInstruction } = options;

  let base =
    customPromptOverride && customPromptOverride.trim()
      ? customPromptOverride.trim()
      : DEFAULT_STYLE_PROMPTS[style] || DEFAULT_STYLE_PROMPTS.polished;

  if (userInstruction && userInstruction.trim()) {
    base += `\n用户提出了特定的回复与处理要求：“${userInstruction.trim()}”。请在生成时重点满足该要求。`;
  }

  return `${base}\n${SYSTEM_GUARDRAILS}`.trim();
}

/**
 * Builds the structured user prompt payload.
 */
export function buildUserPrompt(options: UserPromptOptions): string {
  const { text, userInstruction } = options;

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
