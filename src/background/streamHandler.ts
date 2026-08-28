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
import { resolveEndpoint } from '@runbi/shared/core';

export const STREAM_CHANNEL_NAME = 'runbi-stream-channel';

export const DEFAULT_STYLE_PROMPTS: Record<PolishStyle, string> = {
  polished: '你是一名文字润色专家。你的唯一职责是对用户的文本进行通用润色，消除语病，表达通顺自然，保持原意与语气。',
  academic: '你是一名文字润色专家。你的唯一职责是对用户的文本进行学术规范化润色，符合SCI/顶会论文风格，用词客观、精炼、高级，论证严谨，消除中式口语。',
  business: '你是一名文字润色专家。你的唯一职责是对用户的文本进行职场商务润色，礼貌得体、自信专业，适合邮件与汇报沟通。',
  literary: '你是一名文字润色专家。你的唯一职责是对用户的文本进行文学润色，增强词藻意境，比喻生动，修辞优雅。',
  concise: '你是一名文字润色专家。你的唯一职责是对用户的文本进行精简提炼，剔除冗词废话，字数缩减30%~50%，直奔主题。',
  native_en: '你是一名文字润色与翻译专家。若原文为中文则意译为地道母语级英文；若原文为英文则地道化俚语与语法，表达纯正典雅。',
  reply: '你是一名专业的文本回复与沟通助手。你的职责是针对用户提供的文本生成得体、逻辑严密、恰如其分的回复内容。',
};

/**
 * Builds the strict system prompt according to style, custom prompt overrides, and user custom instruction.
 */
export function buildSystemPrompt(style: PolishStyle, customPrompt?: string, userInstruction?: string): string {
  let base = (customPrompt && customPrompt.trim())
    ? customPrompt.trim()
    : (DEFAULT_STYLE_PROMPTS[style] || DEFAULT_STYLE_PROMPTS.polished);

  if (userInstruction && userInstruction.trim()) {
    base += `\n用户提出了特定的回复与处理要求：“${userInstruction.trim()}”。请在生成时重点满足该要求。`;
  }

  return `${base}\n\n【极其严苛的规则】：\n1. 直接输出润色后的终稿内容。\n2. 严禁包含任何前缀或后缀客套话（如“好的，这是润色后的版本：”、“希望对你有帮助”等）。\n3. 严禁添加引号包裹，严禁自行添加 markdown 标题。\n4. 保持原文的段落排版格式。`;
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
