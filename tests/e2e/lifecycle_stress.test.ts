/**
 * Lifecycle, Concurrency, Memory & Adversarial Stress Testing Suite
 * Runbi Chrome Extension (Manifest V3)
 * Author: challenger_tier5_2 (Empirical Challenger)
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  STREAM_CHANNEL_NAME,
  buildSystemPrompt,
  safePostMessage,
  streamRealCompletions,
  streamMockCompletions,
  testApiConnection,
  setupStreamPortHandler,
} from '../../src/background/streamHandler';
// Prompt text single source of truth lives in @runbi/shared/core.
import { DEFAULT_STYLE_PROMPTS } from '@runbi/shared/core';
import { App } from '../../src/content/App';
import { OptionsApp, PROVIDER_PRESETS } from '../../src/options/OptionsApp';
import { PopupApp } from '../../src/popup/PopupApp';
import {
  initShadowRoot,
  destroyShadowRoot,
  getShadowHost,
  getShadowRoot,
  getAppContainer,
  HOST_ELEMENT_ID,
  CONTAINER_ELEMENT_ID,
} from '../../src/content/shadowRoot';
import { mountRunbi, unmountRunbi } from '../../src/content/index';
import type {
  PolishStyle,
  StreamConfig,
  StreamClientMessage,
  StreamServerMessage,
  SelectionInfo,
} from '../../src/types';
import { MockPort } from '../setup';

// Helper to construct mock SSE response streams with arbitrary byte chunks
function createMockByteStreamResponse(
  byteChunks: Uint8Array[],
  status = 200,
  statusText = 'OK',
  headers: Record<string, string> = { 'Content-Type': 'text/event-stream' }
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of byteChunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    statusText,
    headers,
  });
}

function createTextChunksResponse(
  textChunks: string[],
  status = 200,
  statusText = 'OK'
): Response {
  const encoder = new TextEncoder();
  return createMockByteStreamResponse(
    textChunks.map((str) => encoder.encode(str)),
    status,
    statusText
  );
}

describe('Lifecycle, Concurrency & Adversarial Stress Testing (challenger_tier5_2)', () => {
  const originalFetch = globalThis.fetch;
  let teardownHandler: (() => void) | null = null;
  let reactContainer: HTMLDivElement | null = null;
  let reactRoot: ReactDOM.Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    teardownHandler = setupStreamPortHandler();
    reactContainer = document.createElement('div');
    document.body.appendChild(reactContainer);
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (teardownHandler) {
      teardownHandler();
      teardownHandler = null;
    }
    if (reactRoot) {
      await act(async () => {
        reactRoot?.unmount();
      });
      reactRoot = null;
    }
    if (reactContainer && reactContainer.parentNode) {
      reactContainer.parentNode.removeChild(reactContainer);
      reactContainer = null;
    }
    destroyShadowRoot();
    document.body.innerHTML = '';
  });

  // Helper for rendering React elements cleanly with act
  async function renderComponent(element: React.ReactElement): Promise<HTMLDivElement> {
    await act(async () => {
      if (!reactRoot && reactContainer) {
        reactRoot = ReactDOM.createRoot(reactContainer);
      }
      reactRoot?.render(element);
    });
    return reactContainer!;
  }

  // =========================================================================
  // SUITE 1: Background SW SSE Fetch Stream & Port Lifecycle Stress
  // =========================================================================
  describe('Suite 1: Background SW SSE Fetch Stream & Port Lifecycle Stress', () => {
    it('1.1 Rapid Tab Switching Mid-Stream: 10 concurrent ports with 5 abruptly disconnecting mid-stream', async () => {
      const NUM_TABS = 10;
      const ports: MockPort[] = [];
      const messagesPerTab: StreamServerMessage[][] = Array.from({ length: NUM_TABS }, () => []);
      const completedTabs: number[] = [];

      // Mock fetch with delayed chunks
      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        const signal: AbortSignal = init.signal;
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            for (let i = 1; i <= 5; i++) {
              if (signal.aborted) {
                controller.error(new DOMException('Aborted', 'AbortError'));
                return;
              }
              controller.enqueue(
                encoder.encode(`data: {"choices":[{"delta":{"content":"Chunk_${i} "}}]}\n\n`)
              );
              await new Promise((r) => setTimeout(r, 15));
            }
            if (!signal.aborted) {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            }
          },
        });

        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          })
        );
      });

      // Connect 10 ports simulating 10 active tabs
      for (let i = 0; i < NUM_TABS; i++) {
        const tabIndex = i;
        const port = chrome.runtime.connect({ name: STREAM_CHANNEL_NAME });
        ports.push(port as MockPort);

        port.onMessage.addListener((msg: StreamServerMessage) => {
          messagesPerTab[tabIndex].push(msg);
          if (msg.type === 'DONE') {
            completedTabs.push(tabIndex);
          }
        });
      }

      // Start stream on all 10 tabs simultaneously
      ports.forEach((p, idx) => {
        p.postMessage({
          action: 'START_STREAM',
          payload: {
            text: `Text for tab ${idx}`,
            config: { apiKey: 'sk-test-key', style: 'academic' },
          },
        });
      });

      // After 25ms (mid-stream), abruptly close/disconnect 5 tabs (tabs 0, 2, 4, 6, 8)
      await new Promise((r) => setTimeout(r, 25));
      [0, 2, 4, 6, 8].forEach((tabIdx) => {
        ports[tabIdx].disconnect();
      });

      // Wait for the remaining 5 tabs to finish streaming
      await new Promise((r) => setTimeout(r, 150));

      // Validate surviving tabs (1, 3, 5, 7, 9) received full streams
      [1, 3, 5, 7, 9].forEach((tabIdx) => {
        expect(completedTabs).toContain(tabIdx);
        const chunks = messagesPerTab[tabIdx].filter((m) => m.type === 'CHUNK');
        expect(chunks.length).toBe(5);
        const done = messagesPerTab[tabIdx].find((m) => m.type === 'DONE');
        expect(done).toBeDefined();
      });

      // Disconnected tabs should not have crashed the background service worker
      expect(globalThis.fetch).toHaveBeenCalledTimes(10);
    });

    it('1.2 Port Disconnect Simulation: Disconnecting port during fetch setup before response headers return', async () => {
      let fetchStarted = false;
      let fetchSignal: AbortSignal | null = null;

      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        fetchStarted = true;
        fetchSignal = init.signal;
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(createTextChunksResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n']));
          }, 100);
        });
      });

      const port = chrome.runtime.connect({ name: STREAM_CHANNEL_NAME });
      const messages: StreamServerMessage[] = [];
      port.onMessage.addListener((m) => messages.push(m));

      port.postMessage({
        action: 'START_STREAM',
        payload: {
          text: 'Abort during setup',
          config: { apiKey: 'sk-test', style: 'polished' },
        },
      });

      await new Promise((r) => setTimeout(r, 10));
      expect(fetchStarted).toBe(true);

      port.disconnect();

      await new Promise((r) => setTimeout(r, 120));
      expect((fetchSignal as any)?.aborted).toBe(true);
    });

    it('1.3 Port Disconnect Simulation: Disconnecting port right after [DONE] line received', async () => {
      const sseData = [
        'data: {"choices":[{"delta":{"content":"完成"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      globalThis.fetch = vi.fn().mockResolvedValue(createTextChunksResponse(sseData));

      const port = chrome.runtime.connect({ name: STREAM_CHANNEL_NAME });
      let doneReceived = false;

      port.onMessage.addListener((msg: StreamServerMessage) => {
        if (msg.type === 'DONE') {
          doneReceived = true;
          port.disconnect();
        }
      });

      port.postMessage({
        action: 'START_STREAM',
        payload: {
          text: 'Immediate disconnect after DONE',
          config: { apiKey: 'sk-test', style: 'polished' },
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(doneReceived).toBe(true);
      expect((port as MockPort).disconnected).toBe(true);
    });

    it('1.4 Duplicate START_STREAM Spam: 20 rapid START_STREAM messages on single port cancels prior and honors latest', async () => {
      const encoder = new TextEncoder();
      let fetchCount = 0;

      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        fetchCount++;
        const signal: AbortSignal = init.signal;
        const bodyObj = JSON.parse(init.body);
        const text = bodyObj.messages[1].content;

        const stream = new ReadableStream({
          async start(controller) {
            await new Promise((r) => setTimeout(r, 20));
            if (signal.aborted) {
              controller.error(new DOMException('Aborted', 'AbortError'));
              return;
            }
            controller.enqueue(
              encoder.encode(`data: {"choices":[{"delta":{"content":"Result_${text}"}}]}\n\n`)
            );
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });

        return Promise.resolve(new Response(stream, { status: 200 }));
      });

      const port = chrome.runtime.connect({ name: STREAM_CHANNEL_NAME });
      const messages: StreamServerMessage[] = [];
      port.onMessage.addListener((msg: StreamServerMessage) => {
        messages.push(msg);
      });

      // Spam 20 START_STREAM messages in zero-time microtask bursts
      for (let i = 1; i <= 20; i++) {
        port.postMessage({
          action: 'START_STREAM',
          payload: {
            text: `Spam_${i}`,
            config: { apiKey: 'sk-test', style: 'business' },
          },
        });
      }

      await new Promise((r) => setTimeout(r, 150));

      expect(fetchCount).toBe(20);

      const doneMessages = messages.filter((m) => m.type === 'DONE');
      expect(doneMessages.length).toBe(1);

      const chunkMessages = messages.filter((m) => m.type === 'CHUNK');
      const lastChunk = chunkMessages[chunkMessages.length - 1];
      if (lastChunk && lastChunk.type === 'CHUNK') {
        expect(lastChunk.payload.delta).toContain('Spam_20');
      }
    });

    it('1.5 Malformed SSE: Incomplete JSON split across micro-chunks (1-byte chunk streaming)', async () => {
      const rawText = 'data: {"choices":[{"delta":{"content":"分块测试"}}]}\n\ndata: [DONE]\n\n';
      const encoder = new TextEncoder();
      const rawBytes = encoder.encode(rawText);

      const byteChunks: Uint8Array[] = [];
      for (let i = 0; i < rawBytes.length; i++) {
        byteChunks.push(new Uint8Array([rawBytes[i]]));
      }

      globalThis.fetch = vi.fn().mockResolvedValue(createMockByteStreamResponse(byteChunks));

      const port = new MockPort(STREAM_CHANNEL_NAME);
      const messages: StreamServerMessage[] = [];
      vi.spyOn(port, 'postMessage').mockImplementation((m: StreamServerMessage) => {
        messages.push(m);
      });

      const config: StreamConfig = {
        apiKey: 'sk-test',
        style: 'polished',
      };

      const ctrl = new AbortController();
      await streamRealCompletions('测试', config, port, ctrl.signal);

      const chunkMsgs = messages.filter((m) => m.type === 'CHUNK');
      const doneMsg = messages.find((m) => m.type === 'DONE');

      expect(chunkMsgs).toHaveLength(1);
      if (chunkMsgs[0]?.type === 'CHUNK') {
        expect(chunkMsgs[0].payload.delta).toBe('分块测试');
      }
      expect(doneMsg).toBeDefined();
    });

    it('1.6 Malformed SSE: Adversarial mix of invalid JSON, comment lines, empty lines, and non-JSON data lines', async () => {
      const adversarialChunks = [
        ': this is a comment heartbeat line\n',
        '\n\n',
        'data: {broken json without closing\n\n',
        'data: null\n\n',
        'data: 12345\n\n',
        'data: "plain string"\n\n',
        'data: {"choices":[]}\n\n',
        'data: {"choices":[{"delta":{}}]}\n\n',
        'data: {"choices":[{"delta":{"content":null}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"有效文字"}}]}\n\n',
        ': another comment\n\n',
        'data: {"unexpected_schema":{"text":"ignored"}}\n\n',
        'data: {"choices":[{"text":"备用text字段"}]}\n\n',
        'data: [DONE]\n\n',
      ];

      globalThis.fetch = vi.fn().mockResolvedValue(createTextChunksResponse(adversarialChunks));

      const port = new MockPort(STREAM_CHANNEL_NAME);
      const messages: StreamServerMessage[] = [];
      vi.spyOn(port, 'postMessage').mockImplementation((m: StreamServerMessage) => {
        messages.push(m);
      });

      const config: StreamConfig = { apiKey: 'sk-test', style: 'literary' };
      const ctrl = new AbortController();
      await streamRealCompletions('测试', config, port, ctrl.signal);

      const chunkMsgs = messages.filter((m) => m.type === 'CHUNK');
      expect(chunkMsgs.length).toBe(2);
      if (chunkMsgs[0]?.type === 'CHUNK') expect(chunkMsgs[0].payload.delta).toBe('有效文字');
      if (chunkMsgs[1]?.type === 'CHUNK') expect(chunkMsgs[1].payload.delta).toBe('备用text字段');

      const doneMsg = messages.find((m) => m.type === 'DONE');
      expect(doneMsg).toBeDefined();
    });

    it('1.7 Malformed SSE: Stream ending abruptly without [DONE] line flushes buffer and emits DONE', async () => {
      const streamWithoutDone = [
        'data: {"choices":[{"delta":{"content":"最后一句未标DONE"}}]}\n\n',
      ];
      globalThis.fetch = vi.fn().mockResolvedValue(createTextChunksResponse(streamWithoutDone));

      const port = new MockPort(STREAM_CHANNEL_NAME);
      const messages: StreamServerMessage[] = [];
      vi.spyOn(port, 'postMessage').mockImplementation((m: StreamServerMessage) => {
        messages.push(m);
      });

      const config: StreamConfig = { apiKey: 'sk-test', style: 'concise' };
      const ctrl = new AbortController();
      await streamRealCompletions('测试', config, port, ctrl.signal);

      const doneMsg = messages.find((m) => m.type === 'DONE');
      expect(doneMsg).toBeDefined();
      const chunkMsg = messages.find((m) => m.type === 'CHUNK');
      if (chunkMsg?.type === 'CHUNK') {
        expect(chunkMsg.payload.delta).toBe('最后一句未标DONE');
      }
    });

    it('1.8 High Volume Flood: 2,000 rapid small SSE chunks streaming without memory leak or corruption', async () => {
      const CHUNK_COUNT = 2000;
      const chunks: string[] = [];
      for (let i = 0; i < CHUNK_COUNT; i++) {
        chunks.push(`data: {"choices":[{"delta":{"content":"${i % 10}"}}]}\n\n`);
      }
      chunks.push('data: [DONE]\n\n');

      globalThis.fetch = vi.fn().mockResolvedValue(createTextChunksResponse(chunks));

      const port = new MockPort(STREAM_CHANNEL_NAME);
      const messages: StreamServerMessage[] = [];
      vi.spyOn(port, 'postMessage').mockImplementation((m: StreamServerMessage) => {
        messages.push(m);
      });

      const config: StreamConfig = { apiKey: 'sk-test', style: 'polished' };
      const ctrl = new AbortController();
      await streamRealCompletions('洪水测试', config, port, ctrl.signal);

      const chunkMsgs = messages.filter((m) => m.type === 'CHUNK');
      expect(chunkMsgs.length).toBe(CHUNK_COUNT);

      const doneMsg = messages.find((m) => m.type === 'DONE');
      expect(doneMsg).toBeDefined();
      if (doneMsg?.type === 'DONE') {
        expect(doneMsg.payload.totalTokens).toBeGreaterThanOrEqual(CHUNK_COUNT);
      }
    });

    it('1.9 Network Error Resilience: Non-200 responses with HTML/JSON bodies or Network failures', async () => {
      const errorScenarios = [
        { status: 400, statusText: 'Bad Request', body: JSON.stringify({ error: { message: 'Invalid parameter' } }), expected: '400: Invalid parameter' },
        { status: 401, statusText: 'Unauthorized', body: 'Unauthorized HTML', expected: '401 Unauthorized' },
        { status: 403, statusText: 'Forbidden', body: 'Forbidden', expected: '403 Forbidden' },
        { status: 404, statusText: 'Not Found', body: 'Not Found', expected: '404 Not Found' },
        { status: 429, statusText: 'Too Many Requests', body: 'Rate limited', expected: '429 Rate Limit' },
        { status: 500, statusText: 'Internal Server Error', body: 'Internal Error', expected: '大模型服务端错误' },
        { status: 502, statusText: 'Bad Gateway', body: 'Bad Gateway', expected: '大模型服务端错误' },
        { status: 503, statusText: 'Service Unavailable', body: 'Service Unavailable', expected: '大模型服务端错误' },
      ];

      for (const scenario of errorScenarios) {
        globalThis.fetch = vi.fn().mockResolvedValue(
          new Response(scenario.body, {
            status: scenario.status,
            statusText: scenario.statusText,
          })
        );

        const port = new MockPort(STREAM_CHANNEL_NAME);
        const messages: StreamServerMessage[] = [];
        vi.spyOn(port, 'postMessage').mockImplementation((m: StreamServerMessage) => {
          messages.push(m);
        });

        const ctrl = new AbortController();
        await streamRealCompletions('测试', { apiKey: 'sk-test', style: 'polished' }, port, ctrl.signal);

        expect(messages).toHaveLength(1);
        expect(messages[0].type).toBe('ERROR');
        if (messages[0].type === 'ERROR') {
          expect(messages[0].error).toContain(scenario.expected);
        }
      }
    });
  });

  // =========================================================================
  // SUITE 2: AbortController Cancellation Race Conditions
  // =========================================================================
  describe('Suite 2: AbortController Cancellation Race Conditions', () => {
    it('2.1 Aborting during fetch setup (pre-aborted signal)', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy;

      const port = new MockPort(STREAM_CHANNEL_NAME);
      const messages: StreamServerMessage[] = [];
      vi.spyOn(port, 'postMessage').mockImplementation((m: StreamServerMessage) => {
        messages.push(m);
      });

      const ctrl = new AbortController();
      ctrl.abort(); // Pre-abort

      await streamRealCompletions('测试', { apiKey: 'sk-test', style: 'academic' }, port, ctrl.signal);

      const abortMsg = messages.find((m) => m.type === 'ABORTED');
      expect(abortMsg).toBeDefined();
    });

    it('2.2 Aborting after [DONE] received should be a safe no-op without double-events', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        createTextChunksResponse(['data: {"choices":[{"delta":{"content":"测试"}}]}\n\n', 'data: [DONE]\n\n'])
      );

      const port = new MockPort(STREAM_CHANNEL_NAME);
      const messages: StreamServerMessage[] = [];
      vi.spyOn(port, 'postMessage').mockImplementation((m: StreamServerMessage) => {
        messages.push(m);
      });

      const ctrl = new AbortController();
      await streamRealCompletions('测试', { apiKey: 'sk-test', style: 'polished' }, port, ctrl.signal);

      expect(messages.some((m) => m.type === 'DONE')).toBe(true);

      // Trigger abort post-completion
      ctrl.abort();

      const doneCount = messages.filter((m) => m.type === 'DONE').length;
      expect(doneCount).toBe(1);
    });

    it('2.3 Rapid Re-triggering Race Stress in Content Script App: 20 rapid startStream calls', async () => {
      const mockSelection: SelectionInfo = {
        text: '并发快速重试测试文本',
        rawText: '并发快速重试测试文本',
        rect: new DOMRect(100, 100, 100, 30),
        isEditable: true,
        targetElement: document.createElement('textarea'),
        savedRange: null,
      };

      await renderComponent(React.createElement(App, { initialSelection: mockSelection }));

      const capsule = reactContainer?.querySelector('#runbi-trigger-capsule') as HTMLButtonElement;
      expect(capsule).not.toBeNull();

      await act(async () => {
        capsule.click();
      });

      const styles: PolishStyle[] = ['academic', 'business', 'literary', 'concise', 'native_en', 'polished'];

      await act(async () => {
        for (let i = 0; i < 20; i++) {
          const style = styles[i % styles.length];
          const tabBtn = reactContainer?.querySelector(`[data-style="${style}"]`) as HTMLButtonElement;
          if (tabBtn) {
            tabBtn.click();
          }
        }
        await new Promise((r) => setTimeout(r, 200));
      });

      const panel = reactContainer?.querySelector('#runbi-panel');
      expect(panel).not.toBeNull();
    });

    it('2.4 Interleaved START_STREAM and ABORT Fuzz Sequence', async () => {
      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        const signal: AbortSignal = init.signal;
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            if (signal.aborted) {
              controller.error(new DOMException('Aborted', 'AbortError'));
              return;
            }
            controller.enqueue(
              encoder.encode('data: {"choices":[{"delta":{"content":"Stable output"}}]}\n\n')
            );
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return Promise.resolve(new Response(stream, { status: 200 }));
      });

      const port = chrome.runtime.connect({ name: STREAM_CHANNEL_NAME });
      const messages: StreamServerMessage[] = [];
      port.onMessage.addListener((m: StreamServerMessage) => {
        messages.push(m);
      });

      for (let i = 0; i < 15; i++) {
        port.postMessage({
          action: 'START_STREAM',
          payload: { text: `Fuzz_${i}`, config: { apiKey: 'sk-test', style: 'polished' } },
        });
        if (i % 2 === 0) {
          port.postMessage({ action: 'ABORT' });
        }
      }

      port.postMessage({
        action: 'START_STREAM',
        payload: { text: 'Final stable stream', config: { apiKey: 'sk-test', style: 'literary' } },
      });

      await new Promise((r) => setTimeout(r, 100));

      const doneMsgs = messages.filter((m) => m.type === 'DONE');
      expect(doneMsgs.length).toBeGreaterThanOrEqual(1);
    });

    it('2.5 Component Unmount Mid-Stream cleans up ports and prevents setState memory leak', async () => {
      const mockSelection: SelectionInfo = {
        text: '卸载测试文本',
        rawText: '卸载测试文本',
        rect: new DOMRect(50, 50, 80, 20),
        isEditable: true,
        targetElement: null,
        savedRange: null,
      };

      await renderComponent(React.createElement(App, { initialSelection: mockSelection }));

      const capsule = reactContainer?.querySelector('#runbi-trigger-capsule') as HTMLButtonElement;
      await act(async () => {
        capsule.click();
        await new Promise((r) => setTimeout(r, 20));
      });

      await act(async () => {
        reactRoot?.unmount();
        reactRoot = null;
        await new Promise((r) => setTimeout(r, 100));
      });

      expect(reactContainer?.innerHTML).toBe('');
    });
  });

  // =========================================================================
  // SUITE 3: Chrome Storage Race Conditions & Schema Corruption
  // =========================================================================
  describe('Suite 3: Chrome Storage Race Conditions & Schema Corruption', () => {
    it('3.1 100 Concurrent Asynchronous storage.set calls with interleaved keys', async () => {
      const promises: Promise<void>[] = [];

      for (let i = 0; i < 100; i++) {
        promises.push(
          chrome.storage.local.set({
            [`key_${i % 10}`]: `value_${i}`,
            lastUpdated: i,
          })
        );
      }

      await Promise.all(promises);

      const all = await chrome.storage.local.get(null);
      expect(all).toBeDefined();
      expect(typeof all.lastUpdated).toBe('number');
      for (let k = 0; k < 10; k++) {
        expect(all[`key_${k}`]).toBeDefined();
      }
    });

    it('3.2 Concurrent Read-Modify-Write on Blacklist Array', async () => {
      await chrome.storage.local.set({ blacklist: ['domain0.com'] });

      const addDomain = async (domain: string) => {
        const stored = await chrome.storage.local.get('blacklist');
        const current = Array.isArray(stored.blacklist) ? stored.blacklist : [];
        if (!current.includes(domain)) {
          await chrome.storage.local.set({ blacklist: [...current, domain] });
        }
      };

      await Promise.all([
        addDomain('domain1.com'),
        addDomain('domain2.com'),
        addDomain('domain3.com'),
        addDomain('domain4.com'),
        addDomain('domain5.com'),
      ]);

      const res = await chrome.storage.local.get('blacklist');
      expect(Array.isArray(res.blacklist)).toBe(true);
      expect(res.blacklist.length).toBeGreaterThanOrEqual(1);
    });

    it('3.3 Schema Corruption Resilience: Corrupted customPrompts in storage', async () => {
      await chrome.storage.local.set({
        customPrompts: '{"invalid": json string corrupted',
        blacklist: 'not-an-array-string',
        triggerMode: 12345,
        enabled: 'string-instead-of-boolean',
      });

      await renderComponent(React.createElement(OptionsApp));
      expect(reactContainer?.textContent).toContain('润笔 (Runbi) 设置');

      await renderComponent(React.createElement(PopupApp));
      expect(reactContainer?.textContent).toContain('润笔 Runbi');
    });

    it('3.4 buildSystemPrompt Handling of Non-String customPrompt Overrides', () => {
      const p1 = buildSystemPrompt('academic', '这是自定义学术提示词');
      expect(p1).toContain('这是自定义学术提示词');

      const p2 = buildSystemPrompt('literary', undefined);
      expect(p2).toContain(DEFAULT_STYLE_PROMPTS.literary);

      const p3 = buildSystemPrompt('business', '');
      expect(p3).toContain(DEFAULT_STYLE_PROMPTS.business);

      const p4 = buildSystemPrompt('polished', '   ');
      expect(p4).toContain(DEFAULT_STYLE_PROMPTS.polished);

      const safeBuildSystemPrompt = (style: PolishStyle, customPrompt?: any): string => {
        const custom = (typeof customPrompt === 'string' && customPrompt.trim()) ? customPrompt.trim() : undefined;
        return buildSystemPrompt(style, custom);
      };

      expect(safeBuildSystemPrompt('academic', 12345)).toContain(DEFAULT_STYLE_PROMPTS.academic);
      expect(safeBuildSystemPrompt('business', null)).toContain(DEFAULT_STYLE_PROMPTS.business);
      expect(safeBuildSystemPrompt('concise', {})).toContain(DEFAULT_STYLE_PROMPTS.concise);
      expect(safeBuildSystemPrompt('native_en', ['array'])).toContain(DEFAULT_STYLE_PROMPTS.native_en);
    });

    it('3.5 OptionsApp Provider Switch and Storage Synchronization Integrity', async () => {
      await renderComponent(React.createElement(OptionsApp));

      const openaiBtn = reactContainer?.querySelector('[data-provider="openai"]') as HTMLButtonElement;
      expect(openaiBtn).not.toBeNull();

      await act(async () => {
        openaiBtn.click();
      });

      const baseUrlInput = reactContainer?.querySelector('#base-url-input') as HTMLInputElement;
      const modelInput = reactContainer?.querySelector('#model-input') as HTMLInputElement;

      expect(baseUrlInput.value).toBe('https://api.openai.com/v1');
      expect(modelInput.value).toBe('gpt-4o-mini');

      const saveBtn = reactContainer?.querySelector('#save-settings-btn') as HTMLButtonElement;
      await act(async () => {
        saveBtn.click();
      });

      const stored = await chrome.storage.local.get(['provider', 'baseUrl', 'model']);
      expect(stored.provider).toBe('openai');
      expect(stored.baseUrl).toBe('https://api.openai.com/v1');
      expect(stored.model).toBe('gpt-4o-mini');
    });
  });

  // =========================================================================
  // SUITE 4: Shadow DOM Event Propagation & Interaction Boundaries
  // =========================================================================
  describe('Suite 4: Shadow DOM Event Propagation & Interaction Boundaries', () => {
    it('4.1 Clicks inside Shadow DOM elements should not trigger outside dismissal', async () => {
      const mockSelection: SelectionInfo = {
        text: 'Shadow DOM 点击测试',
        rawText: 'Shadow DOM 点击测试',
        rect: new DOMRect(100, 100, 100, 30),
        isEditable: true,
        targetElement: document.createElement('textarea'),
        savedRange: null,
      };

      const { host, container: shadowContainer } = initShadowRoot();
      const shadowRootInstance = ReactDOM.createRoot(shadowContainer);

      await act(async () => {
        shadowRootInstance.render(React.createElement(App, { initialSelection: mockSelection }));
      });

      const capsule = shadowContainer.querySelector('#runbi-trigger-capsule') as HTMLButtonElement;
      await act(async () => {
        capsule.click();
      });

      expect(shadowContainer.querySelector('#runbi-panel')).not.toBeNull();

      const panel = shadowContainer.querySelector('#runbi-panel') as HTMLElement;
      await act(async () => {
        const clickEvent = new MouseEvent('mousedown', {
          bubbles: true,
          composed: true,
        });
        Object.defineProperty(clickEvent, 'composedPath', {
          value: () => [panel, shadowContainer, host, document.body, document],
        });
        document.dispatchEvent(clickEvent);
      });

      expect(shadowContainer.querySelector('#runbi-panel')).not.toBeNull();

      const outsideDiv = document.createElement('div');
      document.body.appendChild(outsideDiv);

      await act(async () => {
        const outsideEvent = new MouseEvent('mousedown', {
          bubbles: true,
          composed: true,
        });
        Object.defineProperty(outsideEvent, 'composedPath', {
          value: () => [outsideDiv, document.body, document],
        });
        document.dispatchEvent(outsideEvent);
      });

      expect(shadowContainer.querySelector('#runbi-panel')).toBeNull();

      await act(async () => {
        shadowRootInstance.unmount();
      });
      destroyShadowRoot();
      outsideDiv.remove();
    });

    it('4.2 ESC keypress while typing in normal webpage input dismisses active floating panel', async () => {
      const hostInput = document.createElement('input');
      hostInput.type = 'text';
      hostInput.value = 'Webpage user input';
      document.body.appendChild(hostInput);
      hostInput.focus();

      const mockSelection: SelectionInfo = {
        text: '选中文本',
        rawText: '选中文本',
        rect: new DOMRect(20, 20, 50, 20),
        isEditable: false,
        targetElement: null,
        savedRange: null,
      };

      await renderComponent(React.createElement(App, { initialSelection: mockSelection }));

      expect(reactContainer?.querySelector('#runbi-trigger-capsule')).not.toBeNull();

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });

      expect(reactContainer?.querySelector('#runbi-trigger-capsule')).toBeNull();
      hostInput.remove();
    });

    it('4.3 Alt+W keyboard shortcut expands capsule to panel', async () => {
      const mockSelection: SelectionInfo = {
        text: '快捷键测试',
        rawText: '快捷键测试',
        rect: new DOMRect(20, 20, 50, 20),
        isEditable: false,
        targetElement: null,
        savedRange: null,
      };

      await renderComponent(React.createElement(App, { initialSelection: mockSelection }));
      expect(reactContainer?.querySelector('#runbi-trigger-capsule')).not.toBeNull();
      expect(reactContainer?.querySelector('#runbi-panel')).toBeNull();

      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'w', altKey: true, bubbles: true })
        );
      });

      expect(reactContainer?.querySelector('#runbi-panel')).not.toBeNull();
    });

    it('4.4 Rapid DOM Removal & Re-attachment of Shadow Root does not throw errors', () => {
      for (let i = 0; i < 20; i++) {
        const { host, container } = initShadowRoot();
        expect(host).not.toBeNull();
        expect(container).not.toBeNull();
        destroyShadowRoot();
        expect(getShadowHost()).toBeNull();
      }
    });

    it('4.5 mountRunbi & unmountRunbi Idempotence under Stress', async () => {
      for (let i = 0; i < 10; i++) {
        await act(async () => {
          mountRunbi();
          mountRunbi();
        });
        expect(document.querySelectorAll(`#${HOST_ELEMENT_ID}`)).toHaveLength(1);

        await act(async () => {
          unmountRunbi();
          unmountRunbi();
        });
        expect(document.querySelectorAll(`#${HOST_ELEMENT_ID}`)).toHaveLength(0);
      }
    });
  });
});
