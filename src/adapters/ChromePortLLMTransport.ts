/**
 * @file src/adapters/ChromePortLLMTransport.ts
 * Chrome Extension Runtime Port LLM Transport Adapter
 * Implements ILLMTransport (@runbi/shared/adapters)
 */

import type {
  ILLMTransport,
  LLMStreamRequest,
  StreamCallbacks,
} from '@runbi/shared/adapters';
import type {
  StreamConfig,
  StreamClientMessage,
  StreamServerMessage,
  ConnectionTestResult,
} from '@runbi/shared/types/stream';
import { generateMockStreamMessages, resolveEndpoint } from '@runbi/shared/core';

export const STREAM_CHANNEL_NAME = 'runbi-stream-channel';

/**
 * Transport adapter connecting Chrome Extension Content Script / UI to MV3 Background Service Worker.
 * Communicates over long-lived chrome.runtime.Port channel for low-latency token streaming.
 */
export class ChromePortLLMTransport implements ILLMTransport {
  private channelName: string;

  constructor(channelName: string = STREAM_CHANNEL_NAME) {
    this.channelName = channelName;
  }

  /**
   * Checks if Chrome runtime API is available.
   */
  private isRuntimeAvailable(): boolean {
    try {
      return typeof chrome !== 'undefined' && Boolean(chrome?.runtime?.connect);
    } catch {
      return false;
    }
  }

  /**
   * Fallback runner using client-side mock streaming generator.
   */
  private async runMockStreamFallback(
    request: LLMStreamRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    const startTime = Date.now();
    let totalTokens = 0;

    try {
      const iterator = generateMockStreamMessages(
        request.text,
        request.config.style,
        signal,
        { userInstruction: request.config.userInstruction }
      );

      for await (const msg of iterator) {
        if (signal?.aborted) {
          callbacks.onAbort?.();
          return;
        }

        switch (msg.type) {
          case 'CHUNK':
            totalTokens++;
            callbacks.onChunk(msg.payload.delta);
            break;
          case 'DONE':
            callbacks.onDone(
              msg.payload.durationMs || Math.max(1, Date.now() - startTime),
              msg.payload.totalTokens || Math.max(1, totalTokens)
            );
            return;
          case 'ERROR':
            callbacks.onError(msg.error);
            return;
          case 'ABORTED':
            callbacks.onAbort?.();
            return;
        }
      }
    } catch (err: any) {
      if (signal?.aborted || err?.name === 'AbortError') {
        callbacks.onAbort?.();
      } else {
        callbacks.onError(err?.message || 'Mock 流式生成发生错误');
      }
    }
  }

  /**
   * Initiates a streaming LLM completion over Chrome runtime Port.
   *
   * @param request - Source text and generation configuration.
   * @param callbacks - Event handlers for chunks, completion, errors, and abort.
   * @param signal - Optional AbortSignal to cancel the active stream.
   */
  async streamChat(
    request: LLMStreamRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    if (signal?.aborted) {
      callbacks.onAbort?.();
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      let port: chrome.runtime.Port | null = null;
      let isSettled = false;

      const cleanup = () => {
        if (isSettled) return;
        isSettled = true;

        if (signal) {
          signal.removeEventListener('abort', onAbortListener);
        }

        if (port) {
          try {
            port.disconnect();
          } catch (_) {}
          port = null;
        }
      };

      const onAbortListener = () => {
        if (isSettled) return;
        try {
          if (port) {
            const abortMsg: StreamClientMessage = { action: 'ABORT' };
            port.postMessage(abortMsg);
          }
        } catch (_) {}
        cleanup();
        callbacks.onAbort?.();
        resolve();
      };

      if (signal) {
        signal.addEventListener('abort', onAbortListener, { once: true });
      }

      if (this.isRuntimeAvailable()) {
        try {
          port = chrome.runtime.connect({ name: this.channelName });
        } catch (err) {
          console.warn(`[ChromePortLLMTransport] Failed to open port "${this.channelName}":`, err);
          port = null;
        }
      }

      if (!port) {
        // Fallback to client-side mock streaming
        this.runMockStreamFallback(request, callbacks, signal)
          .then(() => {
            cleanup();
            resolve();
          })
          .catch((err) => {
            cleanup();
            callbacks.onError(err?.message || 'Transport fallback failed');
            resolve();
          });
        return;
      }

      // Handle Port Incoming Server Messages
      port.onMessage.addListener((msg: StreamServerMessage) => {
        if (isSettled) return;

        switch (msg.type) {
          case 'CHUNK':
            callbacks.onChunk(msg.payload.delta);
            break;
          case 'DONE':
            cleanup();
            callbacks.onDone(msg.payload.durationMs, msg.payload.totalTokens);
            resolve();
            break;
          case 'ERROR':
            cleanup();
            callbacks.onError(msg.error);
            resolve();
            break;
          case 'ABORTED':
            cleanup();
            callbacks.onAbort?.();
            resolve();
            break;
        }
      });

      // Handle Port Unexpected Disconnects
      port.onDisconnect.addListener(() => {
        if (!isSettled) {
          const lastError = chrome.runtime?.lastError;
          const errorMsg = lastError?.message || '后台服务连接已中断 (Service worker port closed)';
          cleanup();
          callbacks.onError(errorMsg);
          resolve();
        }
      });

      // Send START_STREAM payload to background worker
      try {
        const startMessage: StreamClientMessage = {
          action: 'START_STREAM',
          payload: {
            text: request.text,
            config: request.config,
          },
        };
        port.postMessage(startMessage);
      } catch (err: any) {
        cleanup();
        callbacks.onError(err?.message || '无法向后台 Port 发生 START_STREAM 请求');
        resolve();
      }
    });
  }

  /**
   * Tests API connectivity for given provider credentials and endpoints.
   * Sends TEST_CONNECTION message to background service worker, with direct HTTP ping fallback.
   *
   * @param config - Provider configuration to test.
   * @returns ConnectionTestResult containing success, latency, and diagnostics.
   */
  async testConnection(config: StreamConfig): Promise<ConnectionTestResult> {
    if (typeof chrome !== 'undefined' && Boolean(chrome?.runtime?.sendMessage)) {
      try {
        const response: ConnectionTestResult = await chrome.runtime.sendMessage({
          action: 'TEST_CONNECTION',
          payload: config,
        });
        if (response && typeof response === 'object' && typeof response.success === 'boolean') {
          return response;
        }
      } catch (err: any) {
        console.warn('[ChromePortLLMTransport] chrome.runtime.sendMessage failed, trying direct HTTP ping:', err);
      }
    }

    return this.directHttpPing(config);
  }

  /**
   * Direct HTTP fetch ping for options testing when background message listener is unavailable.
   */
  private async directHttpPing(config: StreamConfig): Promise<ConnectionTestResult> {
    if (!config.apiKey || !config.apiKey.trim()) {
      return {
        success: false,
        error: '请输入 API Key',
      };
    }

    const endpoint = resolveEndpoint(config.baseUrl);
    const model = config.model || 'deepseek-chat';
    const startTime = Date.now();

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Ping' }],
          max_tokens: 5,
          temperature: 0.1,
        }),
      });

      const latencyMs = Math.max(1, Date.now() - startTime);

      if (response.ok) {
        return {
          success: true,
          latencyMs,
          model,
        };
      }

      if (response.status === 401) {
        return {
          success: false,
          error: '401 Unauthorized: API Key 无效或已过期',
        };
      }

      if (response.status === 429) {
        return {
          success: false,
          error: '429 Rate Limit: 账户额度不足或请求受限',
        };
      }

      if (response.status === 404) {
        return {
          success: false,
          error: `404 Not Found: 接口路径不存在 (${endpoint})`,
        };
      }

      let errorDetail = `${response.status} ${response.statusText}`;
      try {
        const errJson = await response.json();
        if (errJson?.error?.message) {
          errorDetail = errJson.error.message;
        }
      } catch (_) {}

      return {
        success: false,
        error: `HTTP 错误: ${errorDetail}`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || '网络连接超时或无法访问该地址，请检查 Base URL',
      };
    }
  }
}

export const chromeLLMTransport = new ChromePortLLMTransport();
export default ChromePortLLMTransport;
