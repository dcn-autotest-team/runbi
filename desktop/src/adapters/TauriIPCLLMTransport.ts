/**
 * @file desktop/src/adapters/TauriIPCLLMTransport.ts
 * Desktop LLM Transport Implementation
 *
 * Implements ILLMTransport for the Runbi Tauri Desktop Client.
 * When API key is missing or in mock mode, provides an instant, zero-config
 * fallback using the shared generateMockStreamMessages generator.
 * When in Tauri, coordinates streaming completions and testConnection with
 * optional Rust backend IPC or standard fetch streaming.
 */

import type { ILLMTransport, LLMStreamRequest, StreamCallbacks } from '@runbi/shared/adapters';
import type { StreamConfig, ConnectionTestResult } from '@runbi/shared/types';
import { generateMockStreamMessages } from '@runbi/shared/core';

export class TauriIPCLLMTransport implements ILLMTransport {
  private isTauri(): boolean {
    return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
  }

  /**
   * Starts a streaming chat completion.
   */
  public async streamChat(
    request: LLMStreamRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    const startTime = Date.now();
    const { text, config } = request;

    // Check if abort already signaled
    if (signal?.aborted) {
      callbacks.onAbort?.();
      return;
    }

    // Zero-config or Mock fallback when API key is absent
    const apiKey = config.apiKey?.trim();
    if (!apiKey) {
      try {
        const stream = generateMockStreamMessages(text, config.style, signal, {
          userInstruction: config.userInstruction,
        });
        let totalTokens = 0;

        for await (const message of stream) {
          if (signal?.aborted) {
            callbacks.onAbort?.();
            return;
          }

          if (message.type === 'CHUNK' && message.payload?.delta) {
            totalTokens++;
            callbacks.onChunk(message.payload.delta);
          } else if (message.type === 'DONE') {
            const durationMs = Date.now() - startTime;
            callbacks.onDone(durationMs, message.payload.totalTokens ?? totalTokens);
            return;
          } else if (message.type === 'ERROR') {
            callbacks.onError(message.error ?? 'Mock stream error');
            return;
          } else if (message.type === 'ABORTED') {
            callbacks.onAbort?.();
            return;
          }
        }

        callbacks.onDone(Date.now() - startTime, totalTokens);
      } catch (err: any) {
        if (signal?.aborted) {
          callbacks.onAbort?.();
        } else {
          callbacks.onError(err?.message || 'Mock streaming failed');
        }
      }
      return;
    }

    // Real API stream execution via Fetch SSE
    try {
      const endpoint = config.baseUrl?.trim() || 'https://api.deepseek.com/v1/chat/completions';
      const model = config.model?.trim() || 'deepseek-chat';

      const promptSystem = `You are Runbi (润笔), an elite AI writing and text polishing assistant. Polish the user's text according to the requested style: ${config.style}. Return ONLY the polished text without meta commentary.`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: promptSystem },
            { role: 'user', content: text },
          ],
          stream: true,
          temperature: config.temperature ?? 0.7,
        }),
        signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText);
        callbacks.onError(`API Request failed (${response.status}): ${errText}`);
        return;
      }

      if (!response.body) {
        callbacks.onError('Response body is null');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let totalTokens = 0;

      while (true) {
        if (signal?.aborted) {
          await reader.cancel();
          callbacks.onAbort?.();
          return;
        }

        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed === 'data: [DONE]') {
            callbacks.onDone(Date.now() - startTime, totalTokens);
            return;
          }
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              const delta = data.choices?.[0]?.delta?.content;
              if (delta) {
                totalTokens++;
                callbacks.onChunk(delta);
              }
            } catch {
              // Ignore partial JSON parse errors in SSE chunks
            }
          }
        }
      }

      callbacks.onDone(Date.now() - startTime, totalTokens);
    } catch (err: any) {
      if (signal?.aborted || err?.name === 'AbortError') {
        callbacks.onAbort?.();
      } else {
        callbacks.onError(err?.message || 'Streaming transport encountered an error');
      }
    }
  }

  /**
   * Tests connection with given provider configuration.
   */
  public async testConnection(config: StreamConfig): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    const apiKey = config.apiKey?.trim();

    if (!apiKey) {
      // Mock mode connection is always valid
      return {
        success: true,
        latencyMs: 15,
      };
    }

    try {
      const endpoint = config.baseUrl?.trim() || 'https://api.deepseek.com/v1/chat/completions';
      const model = config.model?.trim() || 'deepseek-chat';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
      });

      const latencyMs = Date.now() - startTime;

      if (response.ok) {
        return { success: true, latencyMs, model };
      }

      const errBody = await response.text().catch(() => '');
      return {
        success: false,
        latencyMs,
        error: `HTTP ${response.status}: ${errBody || response.statusText}`,
      };
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        error: err?.message || 'Network connection failed',
      };
    }
  }
}
