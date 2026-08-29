/**
 * Background Service Worker Stream & Connection Engine
 * Part of Runbi Chrome Extension (Manifest V3)
 */

import type {
  PolishStyle,
  StreamConfig,
  StreamClientMessage,
  StreamServerMessage,
  ConnectionTestResult,
} from '../types/stream';
import { generateMockStreamMessages } from '../core/mockStream';
import { resolveEndpoint, buildSystemPrompt as sharedBuildSystemPrompt } from '@runbi/shared/core';

export const STREAM_CHANNEL_NAME = 'runbi-stream-channel';

/**
 * Checks whether the extension already has cross-origin permission for the
 * given endpoint. NOTE: this only *detects*; it never calls
 * `chrome.permissions.request()` — that API must be invoked from a user
 * gesture (popup/options page click), not from the background service worker.
 * Returns an error message directing the user to grant access when missing.
 */
export async function ensureOriginPermission(endpoint: string): Promise<string | null> {
  let origin: string;
  try {
    origin = new URL(endpoint).origin;
  } catch (_) {
    return `无法解析请求地址: ${endpoint}`;
  }

  if (typeof chrome === 'undefined' || !chrome.permissions) {
    // Non-extension context (tests / dev fallback): nothing to check.
    return null;
  }

  try {
    const granted = await chrome.permissions.contains({ origins: [origin] });
    if (granted) {
      return null;
    }
  } catch (_) {
    // contains() rejected in this context — treat as not verified.
  }

  return `尚未授权访问 ${origin}。请点击扩展图标，在弹窗中点击「一键授权划词」，或到扩展详情页开启「网站访问权限」后重试。`;
}

/**
 * Builds the strict system prompt.
 *
 * Single source of truth is `@runbi/shared/core/prompts.ts` — the desktop
 * client and this background worker MUST produce identical prompts for the
 * same style/instruction pair. Do NOT re-declare prompt text here.
 */
export function buildSystemPrompt(style: PolishStyle, customPrompt?: string, userInstruction?: string): string {
  return sharedBuildSystemPrompt({
    style,
    customPromptOverride: customPrompt,
    userInstruction,
  });
}

/**
 * Safely posts message to a Chrome runtime Port.
 */
export function safePostMessage(port: chrome.runtime.Port, message: StreamServerMessage): void {
  try {
    port.postMessage(message);
  } catch (_) {
    // Port may have been disconnected by client
  }
}

/**
 * Streams real OpenAI / DeepSeek compatible SSE chunks to client port.
 */
export async function streamRealCompletions(
  text: string,
  config: StreamConfig,
  port: chrome.runtime.Port,
  signal: AbortSignal
): Promise<void> {
  const endpoint = resolveEndpoint(config.baseUrl);
  const startTime = Date.now();
  let totalTokens = 0;

  const denyReason = await ensureOriginPermission(endpoint);
  if (denyReason) {
    safePostMessage(port, { type: 'ERROR', error: denyReason });
    return;
  }

  const userPrompt = config.userInstruction && config.userInstruction.trim()
    ? `【参考文本】：\n"""\n${text}\n"""\n\n【我的具体回复要求/意向】：\n${config.userInstruction.trim()}`
    : text;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey?.trim()}`,
      },
      body: JSON.stringify({
        model: config.model || 'deepseek-chat',
        messages: [
          { role: 'system', content: buildSystemPrompt(config.style, config.customPrompt, config.userInstruction) },
          { role: 'user', content: userPrompt },
        ],
        stream: true,
        temperature: 0.3,
      }),
      signal,
    });

    if (!response.ok) {
      let errMsg = `请求失败 (${response.status} ${response.statusText})`;
      if (response.status === 401) {
        errMsg = '401 Unauthorized: API Key 无效或未授权，请前往设置页检查配置';
      } else if (response.status === 429) {
        errMsg = '429 Rate Limit: 请求过于频繁或账户额度已耗尽';
      } else if (response.status >= 500) {
        errMsg = `大模型服务端错误 (${response.status} ${response.statusText})，请稍后重试`;
      } else {
        try {
          const errorJson = await response.json();
          if (errorJson?.error?.message) {
            errMsg = `${response.status}: ${errorJson.error.message}`;
          }
        } catch (_) {}
      }
      safePostMessage(port, { type: 'ERROR', error: errMsg });
      return;
    }

    if (!response.body) {
      safePostMessage(port, { type: 'ERROR', error: '响应流为空' });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let doneReceived = false;

    while (true) {
      if (signal.aborted) {
        safePostMessage(port, { type: 'ABORTED' });
        try {
          await reader.cancel();
        } catch (_) {}
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed === 'data: [DONE]') {
          doneReceived = true;
          const durationMs = Math.max(1, Date.now() - startTime);
          safePostMessage(port, {
            type: 'DONE',
            payload: { durationMs, totalTokens: Math.max(1, totalTokens) },
          });
          break;
        }

        if (trimmed.startsWith('data:')) {
          const jsonStr = trimmed.replace(/^data:\s*/, '');
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.text ?? '';
            if (delta && typeof delta === 'string') {
              totalTokens += Math.max(1, Math.ceil(delta.length / 2));
              safePostMessage(port, {
                type: 'CHUNK',
                payload: { delta },
              });
            }
          } catch (_) {}
        }
      }

      if (doneReceived) break;
    }

    // Flush any remaining buffer if stream ended without [DONE] line
    if (!doneReceived && !signal.aborted) {
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data:')) {
          const jsonStr = trimmed.replace(/^data:\s*/, '');
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.text ?? '';
            if (delta && typeof delta === 'string') {
              totalTokens += Math.max(1, Math.ceil(delta.length / 2));
              safePostMessage(port, {
                type: 'CHUNK',
                payload: { delta },
              });
            }
          } catch (_) {}
        }
      }
      const durationMs = Math.max(1, Date.now() - startTime);
      safePostMessage(port, {
        type: 'DONE',
        payload: { durationMs, totalTokens: Math.max(1, totalTokens) },
      });
    }
  } catch (err: any) {
    if (err?.name === 'AbortError' || signal.aborted) {
      safePostMessage(port, { type: 'ABORTED' });
    } else {
      safePostMessage(port, {
        type: 'ERROR',
        error: err?.message || '网络连接异常，无法连接到大模型服务器',
      });
    }
  }
}

/**
 * Fallback to built-in zero-config mock stream generator.
 */
export async function streamMockCompletions(
  text: string,
  config: StreamConfig,
  port: chrome.runtime.Port,
  signal: AbortSignal
): Promise<void> {
  try {
    const iterator = generateMockStreamMessages(text, config.style, signal, {
      userInstruction: config.userInstruction,
    });
    for await (const msg of iterator) {
      if (signal.aborted) {
        safePostMessage(port, { type: 'ABORTED' });
        return;
      }
      safePostMessage(port, msg);
    }
  } catch (err: any) {
    if (signal.aborted || err?.name === 'AbortError') {
      safePostMessage(port, { type: 'ABORTED' });
    } else {
      safePostMessage(port, {
        type: 'ERROR',
        error: err?.message || 'Mock 生成失败',
      });
    }
  }
}

/**
 * Tests API connectivity for BYOK validation.
 */
export async function testApiConnection(
  config: Partial<StreamConfig>
): Promise<ConnectionTestResult> {
  if (!config.apiKey || !config.apiKey.trim()) {
    return {
      success: false,
      error: '请输入 API Key',
    };
  }

  const endpoint = resolveEndpoint(config.baseUrl);
  const model = config.model || 'deepseek-chat';
  const startTime = Date.now();

  const denyReason = await ensureOriginPermission(endpoint);
  if (denyReason) {
    return { success: false, error: denyReason };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey.trim()}`,
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

/**
 * Initializes and registers the port listener for 'runbi-stream-channel'.
 */
export function setupStreamPortHandler(): () => void {
  const onConnectListener = (port: chrome.runtime.Port) => {
    if (port.name !== STREAM_CHANNEL_NAME) return;

    let currentAbortController: AbortController | null = null;

    const onMessageListener = async (msg: StreamClientMessage) => {
      if (msg.action === 'START_STREAM') {
        if (currentAbortController) {
          currentAbortController.abort();
        }
        currentAbortController = new AbortController();
        const signal = currentAbortController.signal;
        const { text, config } = msg.payload;

        if (config.apiKey && config.apiKey.trim()) {
          await streamRealCompletions(text, config, port, signal);
        } else {
          await streamMockCompletions(text, config, port, signal);
        }
      } else if (msg.action === 'ABORT') {
        if (currentAbortController) {
          currentAbortController.abort();
          currentAbortController = null;
        }
        safePostMessage(port, { type: 'ABORTED' });
      }
    };

    const onDisconnectListener = () => {
      if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
      }
    };

    port.onMessage.addListener(onMessageListener);
    port.onDisconnect.addListener(onDisconnectListener);
  };

  chrome.runtime.onConnect.addListener(onConnectListener);

  return () => {
    chrome.runtime.onConnect.removeListener(onConnectListener);
  };
}
