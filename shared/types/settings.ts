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
}

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
