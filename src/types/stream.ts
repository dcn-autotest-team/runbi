/**
 * Stream Messages & Config Interface Contracts
 * Part of Runbi Chrome Extension (Manifest V3)
 */

export type PolishStyle =
  | 'polished'
  | 'academic'
  | 'business'
  | 'literary'
  | 'concise'
  | 'native_en'
  | 'reply';

export type ProviderType = 'deepseek' | 'openai' | 'siliconflow' | 'ollama' | 'custom';
export type TriggerMode = 'capsule' | 'direct';

export interface StreamConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  style: PolishStyle;
  customPrompt?: string;
  userInstruction?: string;
}

export interface AppSettings {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  provider?: ProviderType;
  triggerMode?: TriggerMode;
  enabled?: boolean;
  blacklist?: string[];
  customPrompts?: Partial<Record<PolishStyle, string>>;
}

export interface ConnectionTestResult {
  success: boolean;
  latencyMs?: number;
  model?: string;
  error?: string;
}

export type StreamClientMessage =
  | { action: 'START_STREAM'; payload: { text: string; config: StreamConfig } }
  | { action: 'ABORT' };

export type StreamServerMessage =
  | { type: 'CHUNK'; payload: { delta: string } }
  | { type: 'DONE'; payload: { durationMs: number; totalTokens: number } }
  | { type: 'ERROR'; error: string }
  | { type: 'ABORTED' };
