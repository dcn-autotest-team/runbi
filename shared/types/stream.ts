/**
 * @file shared/types/stream.ts
 * Stream Messages, Polishing Styles & LLM Config Interface Contracts
 * Multi-Platform: Service Worker Port, Tauri IPC & Web Fetch
 */

/**
 * Polishing Style Presets supported across all platforms.
 */
export type PolishStyle =
  | 'polished'
  | 'academic'
  | 'business'
  | 'literary'
  | 'concise'
  | 'native_en'
  | 'reply'
  | 'translate';

/**
 * Supported LLM Provider Types.
 */
export type ProviderType = 'deepseek' | 'openai' | 'siliconflow' | 'ollama' | 'custom';

/**
 * Floating Capsule trigger mode on selection.
 */
export type TriggerMode = 'capsule' | 'direct';

/**
 * Runtime configuration passed to LLM stream generation.
 */
export interface StreamConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  style: PolishStyle;
  customPrompt?: string;
  userInstruction?: string;
  personaPrompt?: string;
  packPrompt?: string;
  /** 个人词库硬约束段（buildGlossaryPrompt 产物，含标题行），'' = 未配置。 */
  glossaryPrompt?: string;
  /** 文风标杆 few-shot 段（buildStyleSamplesPrompt 产物），'' = 未配置。 */
  styleSamplesPrompt?: string;
  /** 宿主应用细粒度风格附注（buildAppStylePrompt 产物），'' = 无匹配。 */
  appStylePrompt?: string;
  /** 原文含 LaTeX 标记时追加语法保护段。 */
  latexGuard?: boolean;
  temperature?: number;
  maxTokens?: number;
  imageDataUrl?: string;
  /** Pull the last Rust-captured screenshot instead of passing image bytes over IPC. */
  useLastScreenshot?: boolean;
}

/**
 * Result returned by provider connection ping/test.
 */
export interface ConnectionTestResult {
  success: boolean;
  latencyMs?: number;
  model?: string;
  error?: string;
}

/**
 * Client-to-Server stream control messages.
 */
export type StreamClientMessage =
  | { action: 'START_STREAM'; payload: { text: string; config: StreamConfig } }
  | { action: 'ABORT' };

/**
 * Server-to-Client stream event messages.
 */
export type StreamServerMessage =
  | { type: 'CHUNK'; payload: { delta: string } }
  | { type: 'DONE'; payload: { durationMs: number; totalTokens: number } }
  | { type: 'ERROR'; error: string }
  | { type: 'ABORTED' };

/**
 * High-level stream execution status.
 */
export type StreamStatus =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'completed'
  | 'error'
  | 'aborted';

/**
 * Performance & token throughput metrics for stream completions.
 */
export interface StreamMetrics {
  durationMs: number;
  totalTokens: number;
  charsPerSecond?: number;
  tokensPerSecond?: number;
}
