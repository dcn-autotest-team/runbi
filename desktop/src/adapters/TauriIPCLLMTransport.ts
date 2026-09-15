/**
 * @file desktop/src/adapters/TauriIPCLLMTransport.ts
 * Desktop LLM Transport Implementation
 *
 * Implements ILLMTransport for the Runbi Tauri Desktop Client.
 * When API key is missing or in mock mode, provides an instant, zero-config
 * fallback using the shared generateMockStreamMessages generator.
 * When in Tauri, leverages Rust native IPC streaming (via reqwest) to bypass
 * all browser CORS/CSP restrictions and deliver instant streaming with clear error handling.
 */

import type { ILLMTransport, LLMStreamRequest, StreamCallbacks } from '@runbi/shared/adapters';
import type { StreamConfig, ConnectionTestResult } from '@runbi/shared/types';
import { generateMockStreamMessages, buildSystemPrompt, buildUserPrompt, resolveEndpoint } from '@runbi/shared/core';
import * as core from '@tauri-apps/api/core';

const { invoke } = core;
const Channel = (core as any).Channel;

interface StreamEvent {
  type: 'Chunk' | 'Done' | 'Error';
  payload: any;
}

export class TauriIPCLLMTransport implements ILLMTransport {
  private isTauri(): boolean {
    return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
  }

  /**
   * Monotonic id minted for every stream. The Rust side stops only the stream
   * whose id matches exactly, so a late report for an already-finished stream
   * can never kill a newer one.
   */
  private nextStreamId = 0;

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

    const endpoint = resolveEndpoint(config.baseUrl);
    const model = config.model?.trim() || 'deepseek-chat';
    const hasVisionContext = Boolean(config.imageDataUrl);
    const systemPrompt = buildSystemPrompt({
      style: config.style,
      userInstruction: config.userInstruction,
      customPromptOverride: config.customPrompt,
      personaPrompt: config.personaPrompt,
      packPrompt: config.packPrompt,
      glossaryPrompt: config.glossaryPrompt,
      styleSamplesPrompt: config.styleSamplesPrompt,
      appStylePrompt: config.appStylePrompt,
      latexGuard: config.latexGuard,
      hasVisionContext,
    });
    const userPrompt = buildUserPrompt({
      text,
      userInstruction: config.userInstruction,
      hasVisionContext,
    });

    // 1. In Tauri: Use Native Rust reqwest Streaming IPC (Bypasses Browser CORS/CSP)
    if (this.isTauri()) {
      try {
        const channel = new Channel();
        const streamId = ++this.nextStreamId;

        channel.onmessage = (event: StreamEvent) => {
          if (signal?.aborted) return;
          if (event.type === 'Chunk') {
            callbacks.onChunk(event.payload.delta);
          } else if (event.type === 'Done') {
            callbacks.onDone(event.payload.duration_ms, event.payload.total_tokens);
          } else if (event.type === 'Error') {
            callbacks.onError(event.payload.message);
          }
        };

        // Stop the Rust SSE read loop the moment the user aborts. Without this
        // the frontend only stopped rendering; the socket kept draining a full
        // generation, holding the model busy for the NEXT request.
        //
        // The AbortSignal `onabort` setter in the jsdom runtime has no usable
        // type, so poll the flag on a short timer and clear it on every exit
        // path below. `abort_llm_stream` is idempotent, so at most one extra
        // call escapes the clear.
        let abortWatch: number | null = setInterval(() => {
          if (signal?.aborted) {
            if (abortWatch !== null) {
              clearInterval(abortWatch);
              abortWatch = null;
            }
            invoke('abort_llm_stream', { streamId }).catch(() => {});
          }
        }, 50) as unknown as number;
        const storpAbortWatch = () => {
          if (abortWatch !== null) {
            clearInterval(abortWatch);
            abortWatch = null;
          }
        };

        try {
          await invoke('stream_llm_chat', {
            endpoint,
            apiKey,
            model,
            systemPrompt,
            userPrompt,
            temperature: config.temperature ?? 0.7,
            imageDataUrl: config.imageDataUrl || null,
            useLastScreenshot: config.useLastScreenshot ?? false,
            streamId,
            channel,
          });
        } finally {
          storpAbortWatch();
        }
        return;
      } catch (err: any) {
        if (signal?.aborted) {
          callbacks.onAbort?.();
        } else {
          callbacks.onError(String(err?.message || err));
        }
        return;
      }
    }

    // 2. Web/Fallback: Fetch SSE
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
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

    if (this.isTauri()) {
      try {
        const res = await invoke<any>('test_llm_connection', {
          req: {
            endpoint: resolveEndpoint(config.baseUrl),
            api_key: apiKey,
            model: config.model?.trim() || 'deepseek-chat',
          },
        });
        return {
          success: res.success,
          latencyMs: res.latency_ms,
          error: res.error,
          model: config.model,
        };
      } catch (err: any) {
        return {
          success: false,
          latencyMs: Date.now() - startTime,
          error: String(err?.message || err),
        };
      }
    }

    try {
      const endpoint = resolveEndpoint(config.baseUrl);
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
