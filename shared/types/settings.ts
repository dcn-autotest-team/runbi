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
    name: '标准得体 (默认)',
    description: '自然大方、情商在线，适用于绝大多数日常与职场场景',
    prompt: '自然大方、高情商且语调适中，符合礼貌得体的社交规范。',
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
 * Human-readable localized names for 7 polishing styles.
 */
export const STYLE_NAMES: Record<PolishStyle, string> = {
  polished: '通用润色',
  academic: '学术规范',
  business: '职场商务',
  literary: '文采飞扬',
  concise: '精简提炼',
  native_en: '地道英文',
  reply: '智能回复',
};

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
};
