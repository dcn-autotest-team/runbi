/**
 * Unit Tests for Background SW Stream & Connection Engine
 * Milestone 4 (M4)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  STREAM_CHANNEL_NAME,
  DEFAULT_STYLE_PROMPTS,
  buildSystemPrompt,
  safePostMessage,
  streamRealCompletions,
  streamMockCompletions,
  testApiConnection,
  setupStreamPortHandler,
} from '../../src/background/streamHandler';
import '../../src/background/index';
import type { PolishStyle, StreamConfig, StreamServerMessage } from '../../src/types/stream';
import { MockPort } from '../setup';

function createMockSseResponse(chunks: string[], status = 200, statusText = 'OK'): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    statusText,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('Background SW Stream Engine (streamHandler.ts)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // =========================================================================
  // 1. buildSystemPrompt Tests
  // =========================================================================
  describe('buildSystemPrompt', () => {
    const styles: PolishStyle[] = [
      'polished',
      'academic',
      'business',
      'literary',
      'concise',
      'native_en',
    ];

    it('should generate system prompts for all 6 styles with strict guidelines', () => {
      for (const style of styles) {
        const prompt = buildSystemPrompt(style);
        expect(prompt).toContain(DEFAULT_STYLE_PROMPTS[style]);
        expect(prompt).toContain('【极其严苛的规则】');
        expect(prompt).toContain('直接输出润色后的终稿内容');
        expect(prompt).toContain('严禁包含任何前缀或后缀客套话');
      }
    });

    it('should use custom prompt override when provided', () => {
      const custom = '你是一个只用文言文的古风润色大师。';
      const prompt = buildSystemPrompt('literary', custom);
      expect(prompt).toContain(custom);
      expect(prompt).not.toContain(DEFAULT_STYLE_PROMPTS.literary);
      expect(prompt).toContain('【极其严苛的规则】');
    });

    it('should fallback to default if custom prompt is only whitespace', () => {
      const prompt = buildSystemPrompt('academic', '   ');
      expect(prompt).toContain(DEFAULT_STYLE_PROMPTS.academic);
    });
  });

  // =========================================================================
  // 2. safePostMessage Tests
  // =========================================================================
  describe('safePostMessage', () => {
    it('should post message to port when open', () => {
      const port = new MockPort(STREAM_CHANNEL_NAME);
      const postSpy = vi.spyOn(port, 'postMessage');
      const msg: StreamServerMessage = { type: 'CHUNK', payload: { delta: '测试' } };

      safePostMessage(port, msg);
      expect(postSpy).toHaveBeenCalledWith(msg);
    });

    it('should not throw error if port is disconnected', () => {
      const port = new MockPort(STREAM_CHANNEL_NAME);
      port.disconnect();

      expect(() => {
        safePostMessage(port, { type: 'CHUNK', payload: { delta: '测试' } });
      }).not.toThrow();
    });
  });

  // =========================================================================
  // 3. streamRealCompletions SSE Fetching Tests
  // =========================================================================
  describe('streamRealCompletions (Real SSE Fetch)', () => {
    it('should parse SSE chunks and emit CHUNK and DONE messages', async () => {
      const sseData = [
        'data: {"choices":[{"delta":{"content":"经过"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"深度润色"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      globalThis.fetch = vi.fn().mockResolvedValue(createMockSseResponse(sseData));

      const port = new MockPort(STREAM_CHANNEL_NAME);
      const messages: StreamServerMessage[] = [];
      vi.spyOn(port, 'postMessage').mockImplementation((msg: StreamServerMessage) => {
        messages.push(msg);
      });

      const config: StreamConfig = {
        apiKey: 'sk-test-key-123',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        style: 'polished',
      };

      const controller = new AbortController();
      await streamRealCompletions('待润色文本', config, port, controller.signal);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [endpoint, reqInit] = (globalThis.fetch as any).mock.calls[0];
      expect(endpoint).toBe('https://api.deepseek.com/v1/chat/completions');
      expect(reqInit.headers['Authorization']).toBe('Bearer sk-test-key-123');

      const chunkMsgs = messages.filter((m) => m.type === 'CHUNK');
      const doneMsg = messages.find((m) => m.type === 'DONE');

      expect(chunkMsgs).toHaveLength(2);
      if (chunkMsgs[0].type === 'CHUNK') expect(chunkMsgs[0].payload.delta).toBe('经过');
      if (chunkMsgs[1].type === 'CHUNK') expect(chunkMsgs[1].payload.delta).toBe('深度润色');

      expect(doneMsg).toBeDefined();
      if (doneMsg && doneMsg.type === 'DONE') {
        expect(doneMsg.payload.totalTokens).toBeGreaterThan(0);
        expect(doneMsg.payload.durationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('should handle 401 Unauthorized error response with friendly message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), {
          status: 401,
          statusText: 'Unauthorized',
        })
      );

      const port = new MockPort(STREAM_CHANNEL_NAME);
      const messages: StreamServerMessage[] = [];
      vi.spyOn(port, 'postMessage').mockImplementation((msg: StreamServerMessage) => {
        messages.push(msg);
      });

      const config: StreamConfig = {
        apiKey: 'invalid-key',
        baseUrl: 'https://api.deepseek.com/v1',
        style: 'polished',
      };

      const controller = new AbortController();
      await streamRealCompletions('测试', config, port, controller.signal);

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('ERROR');
      if (messages[0].type === 'ERROR') {
        expect(messages[0].error).toContain('401');
      }
    });

    it('should handle 429 Rate Limit error response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), {
          status: 429,
          statusText: 'Too Many Requests',
        })
      );

      const port = new MockPort(STREAM_CHANNEL_NAME);
      const messages: StreamServerMessage[] = [];
      vi.spyOn(port, 'postMessage').mockImplementation((msg: StreamServerMessage) => {
        messages.push(msg);
      });

      const config: StreamConfig = {
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        style: 'academic',
      };

      const controller = new AbortController();
      await streamRealCompletions('测试', config, port, controller.signal);

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('ERROR');
      if (messages[0].type === 'ERROR') {
        expect(messages[0].error).toContain('429');
      }
    });

    it('should handle 500 Server Error response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Internal Server Error', {
          status: 500,
          statusText: 'Internal Server Error',
        })
      );

      const port = new MockPort(STREAM_CHANNEL_NAME);
      const messages: StreamServerMessage[] = [];
      vi.spyOn(port, 'postMessage').mockImplementation((msg: StreamServerMessage) => {
        messages.push(msg);
      });

      const config: StreamConfig = {
        apiKey: 'sk-test',
        style: 'business',
      };

      const controller = new AbortController();
      await streamRealCompletions('测试', config, port, controller.signal);

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('ERROR');
      if (messages[0].type === 'ERROR') {
        expect(messages[0].error).toContain('500');
      }
    });

    it('should handle network connection failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch: Network Error'));

      const port = new MockPort(STREAM_CHANNEL_NAME);
      const messages: StreamServerMessage[] = [];
      vi.spyOn(port, 'postMessage').mockImplementation((msg: StreamServerMessage) => {
        messages.push(msg);
      });

      const config: StreamConfig = {
        apiKey: 'sk-test',
        baseUrl: 'http://invalid-url.local',
        style: 'concise',
      };

      const controller = new AbortController();
      await streamRealCompletions('测试', config, port, controller.signal);

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('ERROR');
      if (messages[0].type === 'ERROR') {
        expect(messages[0].error).toContain('Network Error');
      }
    });

    it('should abort stream when signal is triggered mid-fetch', async () => {
      const controller = new AbortController();

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n'));
          // Abort after first chunk
          controller.abort();
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      );

      const port = new MockPort(STREAM_CHANNEL_NAME);
      const messages: StreamServerMessage[] = [];
      vi.spyOn(port, 'postMessage').mockImplementation((msg: StreamServerMessage) => {
        messages.push(msg);
      });

      const config: StreamConfig = {
        apiKey: 'sk-test',
        style: 'literary',
      };

      await streamRealCompletions('测试', config, port, controller.signal);

      const abortedMsg = messages.find((m) => m.type === 'ABORTED');
      expect(abortedMsg).toBeDefined();
    });
  });

  // =========================================================================
  // 4. streamMockCompletions Tests
  // =========================================================================
  describe('streamMockCompletions (Built-in Mock Fallback)', () => {
    it('should stream mock messages and finish with DONE', async () => {
      const port = new MockPort(STREAM_CHANNEL_NAME);
      const messages: StreamServerMessage[] = [];
      vi.spyOn(port, 'postMessage').mockImplementation((msg: StreamServerMessage) => {
        messages.push(msg);
      });

      const config: StreamConfig = {
        style: 'academic',
      };

      const controller = new AbortController();
      await streamMockCompletions('测试句子', config, port, controller.signal);

      const chunkMsgs = messages.filter((m) => m.type === 'CHUNK');
      const doneMsg = messages.find((m) => m.type === 'DONE');

      expect(chunkMsgs.length).toBeGreaterThan(0);
      expect(doneMsg).toBeDefined();
    });

    it('should abort mock stream immediately when signal is aborted', async () => {
      const port = new MockPort(STREAM_CHANNEL_NAME);
      const messages: StreamServerMessage[] = [];
      vi.spyOn(port, 'postMessage').mockImplementation((msg: StreamServerMessage) => {
        messages.push(msg);
      });

      const controller = new AbortController();
      controller.abort();

      await streamMockCompletions('测试句子', { style: 'business' }, port, controller.signal);

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('ABORTED');
    });
  });

  // =========================================================================
  // 5. testApiConnection Tests
  // =========================================================================
  describe('testApiConnection', () => {
    it('should return error if API Key is empty', async () => {
      const res = await testApiConnection({ apiKey: '' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('请输入 API Key');
    });

    it('should return success and latency on 200 OK ping', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'Pong' } }] }), {
          status: 200,
        })
      );

      const res = await testApiConnection({
        apiKey: 'sk-valid-key',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
      });

      expect(res.success).toBe(true);
      expect(res.latencyMs).toBeDefined();
      expect(res.model).toBe('deepseek-chat');
    });

    it('should return 401 error message when key is unauthorized', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
      );

      const res = await testApiConnection({
        apiKey: 'sk-invalid',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('401');
    });

    it('should return 429 error message when rate limited', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Rate limited', { status: 429, statusText: 'Too Many Requests' })
      );

      const res = await testApiConnection({
        apiKey: 'sk-rate-limited',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('429');
    });

    it('should handle fetch rejection gracefully', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection timed out'));

      const res = await testApiConnection({
        apiKey: 'sk-timeout',
        baseUrl: 'https://unreachable.host',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Connection timed out');
    });
  });

  // =========================================================================
  // 6. Port Connection Lifecycle & Runtime Messages
  // =========================================================================
  describe('setupStreamPortHandler & Runtime Messages', () => {
    it('should handle port START_STREAM and route to mock stream when apiKey is missing', async () => {
      const clientPort = chrome.runtime.connect({ name: STREAM_CHANNEL_NAME });
      const messages: StreamServerMessage[] = [];

      await new Promise<void>((resolve) => {
        clientPort.onMessage.addListener((msg: StreamServerMessage) => {
          messages.push(msg);
          if (msg.type === 'DONE') {
            resolve();
          }
        });

        clientPort.postMessage({
          action: 'START_STREAM',
          payload: {
            text: '划词测试',
            config: { style: 'polished' },
          },
        });
      });

      expect(messages.length).toBeGreaterThan(0);
      const doneMsg = messages.find((m) => m.type === 'DONE');
      expect(doneMsg).toBeDefined();
    });

    it('should handle port ABORT action', async () => {
      const clientPort = chrome.runtime.connect({ name: STREAM_CHANNEL_NAME });
      const messages: StreamServerMessage[] = [];

      clientPort.onMessage.addListener((msg: StreamServerMessage) => {
        messages.push(msg);
      });

      clientPort.postMessage({
        action: 'START_STREAM',
        payload: {
          text: '较长的文本用于测试中断',
          config: { style: 'literary' },
        },
      });

      // Post ABORT shortly after start
      clientPort.postMessage({ action: 'ABORT' });

      await new Promise((r) => setTimeout(r, 100));
      const abortedMsg = messages.find((m) => m.type === 'ABORTED');
      expect(abortedMsg).toBeDefined();
    });

    it('should handle runtime sendMessage for TEST_CONNECTION', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'Pong' } }] }), {
          status: 200,
        })
      );

      const response = await chrome.runtime.sendMessage({
        action: 'TEST_CONNECTION',
        payload: { apiKey: 'sk-runtime-test' },
      });

      expect(response).toBeDefined();
      expect(response.success).toBe(true);
    });

    it('should handle runtime sendMessage for SAVE_CONFIG and GET_CONFIG', async () => {
      const saveRes = await chrome.runtime.sendMessage({
        action: 'SAVE_CONFIG',
        payload: { provider: 'siliconflow', model: 'deepseek-ai/DeepSeek-V3' },
      });
      expect(saveRes.success).toBe(true);

      const getRes = await chrome.runtime.sendMessage({
        action: 'GET_CONFIG',
        keys: ['provider', 'model'],
      });
      expect(getRes.success).toBe(true);
      expect(getRes.data.provider).toBe('siliconflow');
      expect(getRes.data.model).toBe('deepseek-ai/DeepSeek-V3');
    });
  });
});
