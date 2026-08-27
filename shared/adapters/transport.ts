/**
 * @file shared/adapters/transport.ts
 * LLM Transport Abstract Interface Contract
 * Multi-Platform Inversion-of-Control (IoC) Definition
 */

import type { StreamConfig, ConnectionTestResult } from '../types/stream';

/**
 * Request payload for initiating an LLM streaming completion.
 */
export interface LLMStreamRequest {
  /**
   * Original source text to be polished or processed.
   */
  text: string;

  /**
   * Stream parameters including style, API keys, endpoints, and custom instructions.
   */
  config: StreamConfig;
}

/**
 * Callback handlers for streaming events.
 */
export interface StreamCallbacks {
  /**
   * Invoked each time a new token chunk delta is received.
   */
  onChunk: (delta: string) => void;

  /**
   * Invoked when stream completion finishes successfully.
   */
  onDone: (durationMs: number, totalTokens: number) => void;

  /**
   * Invoked if a fatal error occurs during transport or generation.
   */
  onError: (error: string) => void;

  /**
   * Invoked if the stream was intentionally aborted/cancelled by the user.
   */
  onAbort?: () => void;
}

/**
 * Platform adapter contract for LLM network transport and connectivity verification.
 * - Chrome Extension implementation: posts messages to MV3 Background Service Worker Port.
 * - Desktop Tauri implementation: invokes Tauri Rust Reqwest SSE command or native fetch.
 */
export interface ILLMTransport {
  /**
   * Starts a streaming chat completion.
   *
   * @param request - Source text and stream configuration.
   * @param callbacks - Event callbacks for stream chunks, completion, error, and abort.
   * @param signal - Optional AbortSignal to cancel the active stream.
   */
  streamChat(
    request: LLMStreamRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<void>;

  /**
   * Tests connection with given provider configuration (e.g. for BYOK verification).
   *
   * @param config - Stream configuration to validate.
   * @returns Promise resolving to ConnectionTestResult.
   */
  testConnection(
    config: StreamConfig
  ): Promise<ConnectionTestResult>;
}
