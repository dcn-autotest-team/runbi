/**
 * @file tests/unit/adversarial-contracts-and-components.test.tsx
 * Comprehensive Adversarial Challenge Suite for:
 * 1. Platform Adapter Contracts (ISelectionProvider, ITextReplacer, IStorageProvider, ILLMTransport)
 * 2. Shared UI Components (PolishPanel, StyleTabs, StreamingView, DiffViewer, ActionBar, InstructionInput, OriginalPreview, Toast)
 *
 * Targets: Edge cases, null/undefined inputs, rejected promises, rapid concurrency,
 * boundary coordinates, extreme payloads, and complete UI state transitions.
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  ISelectionProvider,
  ITextReplacer,
  IStorageProvider,
  ILLMTransport,
  LLMStreamRequest,
  StreamCallbacks,
  ReplacementResult,
} from '@runbi/shared/adapters';
import type { SelectionInfo, SelectionRect } from '@runbi/shared/types/selection';
import type { StreamConfig, ConnectionTestResult, PolishStyle } from '@runbi/shared/types/stream';
import {
  PolishPanel,
  StyleTabs,
  StreamingView,
  DiffViewer,
  ActionBar,
  InstructionInput,
  OriginalPreview,
  Toast,
  STYLE_OPTIONS,
} from '@runbi/shared/components';

// ============================================================================
// PART 1: ADVERSARIAL PLATFORM ADAPTER CONTRACTS
// ============================================================================

describe('Adversarial Platform Adapter Contracts', () => {
  // --------------------------------------------------------------------------
  // 1.1 ISelectionProvider Adversarial Scenarios
  // --------------------------------------------------------------------------
  describe('ISelectionProvider Adversarial Tests', () => {
    class AdversarialSelectionProvider implements ISelectionProvider {
      private selection: SelectionInfo | null = null;
      private subscribers: Set<(sel: SelectionInfo | null) => void> = new Set();
      public getSelectionCallCount = 0;
      public shouldReject = false;

      async getSelection(): Promise<SelectionInfo | null> {
        this.getSelectionCallCount++;
        if (this.shouldReject) {
          throw new Error('Selection capture hardware fault');
        }
        return this.selection;
      }

      subscribeToSelectionChange(callback: (selection: SelectionInfo | null) => void): () => void {
        this.subscribers.add(callback);
        return () => {
          this.subscribers.delete(callback);
        };
      }

      async clearSelection(): Promise<void> {
        if (this.shouldReject) {
          throw new Error('Selection clear failed');
        }
        this.selection = null;
        this.notify(null);
      }

      public setSelection(sel: SelectionInfo | null) {
        this.selection = sel;
        this.notify(sel);
      }

      private notify(sel: SelectionInfo | null) {
        // Copy set to prevent mutation during iteration
        const list = Array.from(this.subscribers);
        for (const sub of list) {
          try {
            sub(sel);
          } catch {
            // Fault isolation: subscriber errors must not crash provider
          }
        }
      }
    }

    it('ADV-SEL-1: handles extreme and degenerate SelectionRect coordinates', async () => {
      const provider = new AdversarialSelectionProvider();

      // Degenerate coordinates: negative, infinite, zero
      const degenerateRects: SelectionRect[] = [
        { top: -9999, left: -9999, right: -9900, bottom: -9900, width: 99, height: 99 },
        { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 },
        { top: Number.MAX_SAFE_INTEGER, left: Number.MAX_SAFE_INTEGER, right: Number.MAX_SAFE_INTEGER + 10, bottom: Number.MAX_SAFE_INTEGER + 10 },
      ];

      for (const rect of degenerateRects) {
        const info: SelectionInfo = {
          text: '极限坐标测试',
          rawText: '  极限坐标测试  \n',
          rect,
          isEditable: false,
          source: 'os_selection',
          contextBefore: undefined,
          contextAfter: undefined,
          targetElement: null,
          savedRange: null,
        };

        provider.setSelection(info);
        const retrieved = await provider.getSelection();
        expect(retrieved).toEqual(info);
        expect(retrieved?.rect.top).toBe(rect.top);
      }
    });

    it('ADV-SEL-2: handles 100 concurrent getSelection calls without state corruption', async () => {
      const provider = new AdversarialSelectionProvider();
      const info: SelectionInfo = {
        text: '并发选区',
        rawText: '并发选区',
        rect: { top: 50, left: 50, right: 100, bottom: 80 },
        isEditable: true,
      };
      provider.setSelection(info);

      const promises = Array.from({ length: 100 }, () => provider.getSelection());
      const results = await Promise.all(promises);

      expect(results).toHaveLength(100);
      expect(provider.getSelectionCallCount).toBe(100);
      results.forEach((res) => {
        expect(res).toEqual(info);
      });
    });

    it('ADV-SEL-3: subscriber exceptions do not crash provider notification loop', async () => {
      const provider = new AdversarialSelectionProvider();
      const faultySubscriber = vi.fn().mockImplementation(() => {
        throw new Error('Exploding UI subscriber');
      });
      const healthySubscriber = vi.fn();

      const unsub1 = provider.subscribeToSelectionChange(faultySubscriber);
      const unsub2 = provider.subscribeToSelectionChange(healthySubscriber);

      const info: SelectionInfo = {
        text: '异常隔离测试',
        rawText: '异常隔离测试',
        rect: { top: 10, left: 10, right: 20, bottom: 20 },
        isEditable: true,
      };

      // Setting selection should notify healthy subscriber even if faulty subscriber throws
      expect(() => provider.setSelection(info)).not.toThrow();
      expect(faultySubscriber).toHaveBeenCalledWith(info);
      expect(healthySubscriber).toHaveBeenCalledWith(info);

      // Unsubscribe idempotency
      unsub1();
      unsub1(); // Double call should not throw
      unsub2();
    });

    it('ADV-SEL-4: cleanly propagates rejected promises on hardware/IPC fault', async () => {
      const provider = new AdversarialSelectionProvider();
      provider.shouldReject = true;

      await expect(provider.getSelection()).rejects.toThrow('Selection capture hardware fault');
      await expect(provider.clearSelection()).rejects.toThrow('Selection clear failed');
    });
  });

  // --------------------------------------------------------------------------
  // 1.2 ITextReplacer Adversarial Scenarios
  // --------------------------------------------------------------------------
  describe('ITextReplacer Adversarial Tests', () => {
    class AdversarialTextReplacer implements ITextReplacer {
      public history: string[] = [];
      public shouldReject = false;

      async canReplace(context?: SelectionInfo | null): Promise<boolean> {
        if (this.shouldReject) throw new Error('DOM query exception');
        if (!context) return false;
        return Boolean(context.isEditable);
      }

      async replaceText(newText: string, context?: SelectionInfo | null): Promise<ReplacementResult> {
        if (this.shouldReject) {
          throw new Error('IPC Replacer Native Crash');
        }
        if (!context || !context.isEditable) {
          return {
            success: false,
            error: 'Target context is read-only or invalid',
          };
        }
        this.history.push(newText);
        return {
          success: true,
          replacedLength: newText.length,
          restoredClipboard: true,
        };
      }

      async copyToClipboard(text: string): Promise<boolean> {
        if (this.shouldReject) throw new Error('Clipboard lock failed');
        this.history.push(`CLIPBOARD:${text}`);
        return true;
      }
    }

    it('ADV-REP-1: handles null, undefined, and malformed context in canReplace and replaceText', async () => {
      const replacer = new AdversarialTextReplacer();

      expect(await replacer.canReplace(null)).toBe(false);
      expect(await replacer.canReplace(undefined)).toBe(false);

      const nullResult = await replacer.replaceText('测试替换', null);
      expect(nullResult.success).toBe(false);
      expect(nullResult.error).toBeDefined();

      const undefResult = await replacer.replaceText('测试替换', undefined);
      expect(undefResult.success).toBe(false);
      expect(undefResult.error).toBeDefined();
    });

    it('ADV-REP-2: handles massive 100k character text and extreme Unicode payloads', async () => {
      const replacer = new AdversarialTextReplacer();
      const validContext: SelectionInfo = {
        text: '原文',
        rawText: '原文',
        rect: { top: 0, left: 0, right: 10, bottom: 10 },
        isEditable: true,
      };

      // 1. Massive string
      const hugeString = '润笔'.repeat(50000); // 100,000 chars
      const hugeResult = await replacer.replaceText(hugeString, validContext);
      expect(hugeResult.success).toBe(true);
      expect(hugeResult.replacedLength).toBe(100000);

      // 2. Extreme Unicode: Emojis, RTL, ZWJ sequences, Control characters, XSS script injection
      const extremeUnicode = '👨‍👩‍👧‍👦 🇨🇳 ﷽ \u0000\u001F\t\r\n <script>alert("xss")</script> 𝕽𝖚𝖓𝖇𝖎';
      const unicodeResult = await replacer.replaceText(extremeUnicode, validContext);
      expect(unicodeResult.success).toBe(true);
      expect(unicodeResult.replacedLength).toBe(extremeUnicode.length);
      expect(replacer.history).toContain(extremeUnicode);
    });

    it('ADV-REP-3: handles promise rejections gracefully', async () => {
      const replacer = new AdversarialTextReplacer();
      replacer.shouldReject = true;

      await expect(replacer.canReplace(null)).rejects.toThrow('DOM query exception');
      await expect(replacer.replaceText('abc', null)).rejects.toThrow('IPC Replacer Native Crash');
      await expect(replacer.copyToClipboard('abc')).rejects.toThrow('Clipboard lock failed');
    });
  });

  // --------------------------------------------------------------------------
  // 1.3 IStorageProvider Adversarial Scenarios
  // --------------------------------------------------------------------------
  describe('IStorageProvider Adversarial Tests', () => {
    class AdversarialStorageProvider implements IStorageProvider {
      private map = new Map<string, unknown>();
      private listeners = new Map<string, Set<(nv: any, ov: any) => void>>();

      async get<T>(key: string, defaultValue?: T): Promise<T> {
        if (this.map.has(key)) {
          return this.map.get(key) as T;
        }
        return defaultValue as T;
      }

      async set<T>(key: string, value: T): Promise<void> {
        const oldVal = this.map.get(key);
        this.map.set(key, value);
        const list = this.listeners.get(key);
        if (list) {
          list.forEach((cb) => {
            try {
              cb(value, oldVal);
            } catch {
              // Subscriber fault isolation
            }
          });
        }
      }

      async remove(key: string): Promise<void> {
        const oldVal = this.map.get(key);
        this.map.delete(key);
        const list = this.listeners.get(key);
        if (list) {
          list.forEach((cb) => {
            try {
              cb(undefined, oldVal);
            } catch {}
          });
        }
      }

      subscribe<T>(key: string, callback: (newValue: T, oldValue: T) => void): () => void {
        if (!this.listeners.has(key)) {
          this.listeners.set(key, new Set());
        }
        const set = this.listeners.get(key)!;
        set.add(callback);
        return () => {
          set.delete(callback);
        };
      }

      async clear(): Promise<void> {
        this.map.clear();
      }

      async getAll(): Promise<Record<string, unknown>> {
        return Object.fromEntries(this.map.entries());
      }
    }

    it('ADV-STO-1: handles prototype pollution keys and exotic Unicode keys', async () => {
      const storage = new AdversarialStorageProvider();
      const dangerousKeys = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', '🔥key🔥', '', '   '];

      for (const key of dangerousKeys) {
        await storage.set(key, `val-${key}`);
        expect(await storage.get(key)).toBe(`val-${key}`);
        await storage.remove(key);
        expect(await storage.get(key, 'DEFAULT')).toBe('DEFAULT');
      }
    });

    it('ADV-STO-2: correctly distinguishes stored null/false/0 from defaultValue', async () => {
      const storage = new AdversarialStorageProvider();

      await storage.set('falsy_bool', false);
      await storage.set('falsy_num', 0);
      await storage.set('falsy_null', null);
      await storage.set('falsy_str', '');

      expect(await storage.get('falsy_bool', true)).toBe(false);
      expect(await storage.get('falsy_num', 999)).toBe(0);
      expect(await storage.get('falsy_null', { fallback: true })).toBeNull();
      expect(await storage.get('falsy_str', 'fallback_str')).toBe('');
    });

    it('ADV-STO-3: stores and retrieves deeply nested objects and arrays', async () => {
      const storage = new AdversarialStorageProvider();
      const complexObject = {
        level1: {
          level2: {
            level3: {
              array: [1, 'two', { three: true }, [4, 5]],
              emptyObj: {},
            },
          },
        },
      };

      await storage.set('deep_config', complexObject);
      const retrieved = await storage.get('deep_config');
      expect(retrieved).toEqual(complexObject);

      const all = await storage.getAll();
      expect(all['deep_config']).toEqual(complexObject);
    });

    it('ADV-STO-4: observer notification resilience and double unsubscription', async () => {
      const storage = new AdversarialStorageProvider();
      const explodingSubscriber = vi.fn().mockImplementation(() => {
        throw new Error('Subscriber exception');
      });
      const healthySubscriber = vi.fn();

      const unsub1 = storage.subscribe('theme', explodingSubscriber);
      const unsub2 = storage.subscribe('theme', healthySubscriber);

      await storage.set('theme', 'dark');
      expect(explodingSubscriber).toHaveBeenCalledWith('dark', undefined);
      expect(healthySubscriber).toHaveBeenCalledWith('dark', undefined);

      // Unsubscribe both
      unsub1();
      unsub1(); // Idempotent
      unsub2();

      await storage.set('theme', 'light');
      expect(healthySubscriber).toHaveBeenCalledTimes(1); // Not called again
    });
  });

  // --------------------------------------------------------------------------
  // 1.4 ILLMTransport Adversarial Scenarios
  // --------------------------------------------------------------------------
  describe('ILLMTransport Adversarial Tests', () => {
    class AdversarialLLMTransport implements ILLMTransport {
      public simulatedChunks: string[] = [];
      public throwOnChunk = false;
      public throwOnStart = false;
      public abortDelayMs = 0;

      async streamChat(
        request: LLMStreamRequest,
        callbacks: StreamCallbacks,
        signal?: AbortSignal
      ): Promise<void> {
        if (this.throwOnStart) {
          throw new Error('Network offline or handshake failure');
        }

        if (signal?.aborted) {
          callbacks.onAbort?.();
          return;
        }

        const onAbortListener = () => {
          callbacks.onAbort?.();
        };
        signal?.addEventListener('abort', onAbortListener);

        try {
          let tokenCount = 0;
          for (const chunk of this.simulatedChunks) {
            if (signal?.aborted) {
              return;
            }

            if (this.throwOnChunk) {
              callbacks.onError('Chunk parsing corrupted JSON SSE stream');
              return;
            }

            tokenCount += chunk.length;
            callbacks.onChunk(chunk);

            if (this.abortDelayMs > 0) {
              await new Promise((r) => setTimeout(r, this.abortDelayMs));
            }
          }

          if (!signal?.aborted) {
            callbacks.onDone(150, tokenCount);
          }
        } finally {
          signal?.removeEventListener('abort', onAbortListener);
        }
      }

      async testConnection(config: StreamConfig): Promise<ConnectionTestResult> {
        if (!config.apiKey && !config.baseUrl?.includes('localhost')) {
          return {
            success: false,
            error: 'Missing API Key for remote endpoint',
          };
        }
        if (config.baseUrl === 'https://invalid-nonexistent-domain.xyz') {
          return {
            success: false,
            error: 'DNS_PROBE_FINISHED_NXDOMAIN',
          };
        }
        return {
          success: true,
          latencyMs: 42,
          model: config.model ?? 'DeepSeek-V3',
        };
      }
    }

    it('ADV-TRP-1: handles pre-aborted and mid-stream aborted signals cleanly', async () => {
      const transport = new AdversarialLLMTransport();
      transport.simulatedChunks = ['Chunk 1', 'Chunk 2', 'Chunk 3'];

      // 1. Pre-aborted signal
      const preAborted = AbortSignal.abort();
      const abortSpy1 = vi.fn();
      const chunkSpy1 = vi.fn();
      const doneSpy1 = vi.fn();

      await transport.streamChat(
        { text: 'test', config: { style: 'polished' } },
        { onChunk: chunkSpy1, onDone: doneSpy1, onError: vi.fn(), onAbort: abortSpy1 },
        preAborted
      );

      expect(abortSpy1).toHaveBeenCalledTimes(1);
      expect(chunkSpy1).not.toHaveBeenCalled();
      expect(doneSpy1).not.toHaveBeenCalled();

      // 2. Mid-stream abort
      transport.abortDelayMs = 20;
      const controller = new AbortController();
      const abortSpy2 = vi.fn();
      const receivedChunks: string[] = [];

      const streamPromise = transport.streamChat(
        { text: 'test', config: { style: 'polished' } },
        {
          onChunk: (c) => {
            receivedChunks.push(c);
            if (receivedChunks.length === 1) {
              controller.abort();
            }
          },
          onDone: doneSpy1,
          onError: vi.fn(),
          onAbort: abortSpy2,
        },
        controller.signal
      );

      await streamPromise;
      expect(abortSpy2).toHaveBeenCalled();
      expect(receivedChunks.length).toBeLessThan(3);
    });

    it('ADV-TRP-2: handles error emission and stream startup failure', async () => {
      const transport = new AdversarialLLMTransport();
      transport.simulatedChunks = ['First piece', 'Corrupt piece'];
      transport.throwOnChunk = true;

      const errorSpy = vi.fn();
      const doneSpy = vi.fn();

      await transport.streamChat(
        { text: 'test', config: { style: 'polished' } },
        { onChunk: vi.fn(), onDone: doneSpy, onError: errorSpy }
      );

      expect(errorSpy).toHaveBeenCalledWith('Chunk parsing corrupted JSON SSE stream');
      expect(doneSpy).not.toHaveBeenCalled();

      // Network startup rejection
      transport.throwOnStart = true;
      await expect(
        transport.streamChat(
          { text: 'test', config: { style: 'polished' } },
          { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
        )
      ).rejects.toThrow('Network offline or handshake failure');
    });

    it('ADV-TRP-3: validates connection config error states', async () => {
      const transport = new AdversarialLLMTransport();

      // Missing API key on remote host
      const res1 = await transport.testConnection({ style: 'academic' });
      expect(res1.success).toBe(false);
      expect(res1.error).toContain('Missing API Key');

      // Invalid domain
      const res2 = await transport.testConnection({
        style: 'academic',
        baseUrl: 'https://invalid-nonexistent-domain.xyz',
        apiKey: 'sk-test',
      });
      expect(res2.success).toBe(false);
      expect(res2.error).toContain('NXDOMAIN');

      // Valid connection
      const res3 = await transport.testConnection({
        style: 'academic',
        baseUrl: 'http://localhost:11434',
        model: 'deepseek-r1:8b',
      });
      expect(res3.success).toBe(true);
      expect(res3.latencyMs).toBe(42);
    });
  });
});

// ============================================================================
// PART 2: ADVERSARIAL SHARED REACT UI COMPONENTS
// ============================================================================

describe('Adversarial Shared React UI Components', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  async function renderUI(element: React.ReactElement): Promise<void> {
    await act(async () => {
      if (!root) {
        root = ReactDOM.createRoot(container);
      }
      root.render(element);
    });
  }

  // --------------------------------------------------------------------------
  // 2.1 PolishPanel Full State Matrix & Boundary Stress
  // --------------------------------------------------------------------------
  describe('PolishPanel Component State Matrix & Adversarial Scenarios', () => {
    it('ADV-UI-1: State 1 - Initial Empty State renders cleanly with zero text', async () => {
      await renderUI(
        <PolishPanel
          originalText=""
          polishedText=""
          isGenerating={false}
          activeStyle="polished"
          isDiffMode={false}
          isEditable={false}
          onClose={vi.fn()}
          onStyleChange={vi.fn()}
          onToggleDiff={vi.fn()}
          onStop={vi.fn()}
          onRegenerate={vi.fn()}
          onCopy={vi.fn()}
          onReplace={vi.fn()}
        />
      );

      const panel = container.querySelector('#runbi-panel');
      expect(panel).not.toBeNull();
      // Replace button disabled
      const replaceBtn = container.querySelector('#runbi-action-replace') as HTMLButtonElement;
      expect(replaceBtn.disabled).toBe(true);
    });

    it('ADV-UI-2: State 2 - Generating & Loading State with Pulsing Placeholder', async () => {
      await renderUI(
        <PolishPanel
          originalText="这是待润色内容"
          polishedText=""
          isGenerating={true}
          activeStyle="academic"
          isDiffMode={false}
          isEditable={true}
          onClose={vi.fn()}
          onStyleChange={vi.fn()}
          onToggleDiff={vi.fn()}
          onStop={vi.fn()}
          onRegenerate={vi.fn()}
          onCopy={vi.fn()}
          onReplace={vi.fn()}
        />
      );

      expect(container.textContent).toContain('润笔沉思中');
      // Style tabs must be disabled during generation
      const tabs = container.querySelectorAll('[role="tab"]');
      tabs.forEach((tab) => {
        expect((tab as HTMLButtonElement).disabled).toBe(true);
      });
      // Stop button must be present
      expect(container.textContent).toContain('中止生成');
    });

    it('ADV-UI-3: State 3 - Active Streaming with Metrics (Duration & Tokens)', async () => {
      const handleStop = vi.fn();
      await renderUI(
        <PolishPanel
          originalText="待润色段落"
          polishedText="正在输出流畅且优美的语句"
          isGenerating={true}
          durationMs={2450}
          totalTokens={38}
          activeStyle="literary"
          isDiffMode={false}
          isEditable={true}
          onClose={vi.fn()}
          onStyleChange={vi.fn()}
          onToggleDiff={vi.fn()}
          onStop={handleStop}
          onRegenerate={vi.fn()}
          onCopy={vi.fn()}
          onReplace={vi.fn()}
        />
      );

      expect(container.textContent).toContain('正在输出流畅且优美的语句');
      expect(container.textContent).toContain('2.5s');
      expect(container.textContent).toContain('38 Tokens');

      // Click Stop button
      const stopBtn = container.querySelector('button[type="button"] span:last-child');
      const stopButtonElement = stopBtn?.closest('button');
      if (stopButtonElement) {
        await act(async () => {
          stopButtonElement.click();
        });
        expect(handleStop).toHaveBeenCalled();
      }
    });

    it('ADV-UI-4: State 4 - Error Banner State renders with custom error message', async () => {
      await renderUI(
        <PolishPanel
          originalText="待润色段落"
          polishedText=""
          isGenerating={false}
          error="API 速率超限 (429 Too Many Requests)，请稍后重试"
          activeStyle="polished"
          isDiffMode={false}
          isEditable={true}
          onClose={vi.fn()}
          onStyleChange={vi.fn()}
          onToggleDiff={vi.fn()}
          onStop={vi.fn()}
          onRegenerate={vi.fn()}
          onCopy={vi.fn()}
          onReplace={vi.fn()}
        />
      );

      expect(container.textContent).toContain('429 Too Many Requests');
    });

    it('ADV-UI-5: State 5 - Diff Mode State with Split/Inline toggling', async () => {
      const handleToggleDiff = vi.fn();
      await renderUI(
        <PolishPanel
          originalText="润笔是一款优秀的工具"
          polishedText="润笔是一款极具创新且高效的AI润色工具"
          isGenerating={false}
          activeStyle="polished"
          isDiffMode={true}
          isEditable={true}
          onClose={vi.fn()}
          onStyleChange={vi.fn()}
          onToggleDiff={handleToggleDiff}
          onStop={vi.fn()}
          onRegenerate={vi.fn()}
          onCopy={vi.fn()}
          onReplace={vi.fn()}
        />
      );

      // Diff Viewer must be present
      expect(container.querySelector('#runbi-diff-content')).not.toBeNull();
      expect(container.textContent).toContain('优化新增');
      expect(container.textContent).toContain('精简删除');

      // Diff Toggle Button
      const diffToggleBtn = container.querySelector('#diff-toggle') as HTMLButtonElement;
      expect(diffToggleBtn.textContent).toBe('终稿');
      await act(async () => {
        diffToggleBtn.click();
      });
      expect(handleToggleDiff).toHaveBeenCalledTimes(1);
    });

    it('ADV-UI-6: State 6 - Collapse/Expand State toggle hides and shows body content', async () => {
      await renderUI(
        <PolishPanel
          originalText="原文"
          polishedText="润色稿"
          isGenerating={false}
          activeStyle="polished"
          isDiffMode={false}
          isEditable={true}
          defaultCollapsed={false}
          onClose={vi.fn()}
          onStyleChange={vi.fn()}
          onToggleDiff={vi.fn()}
          onStop={vi.fn()}
          onRegenerate={vi.fn()}
          onCopy={vi.fn()}
          onReplace={vi.fn()}
        />
      );

      // Initially expanded: action bar is visible
      expect(container.querySelector('#runbi-action-copy')).not.toBeNull();

      // Click collapse
      const collapseBtn = container.querySelector('#collapse-btn') as HTMLButtonElement;
      await act(async () => {
        collapseBtn.click();
      });

      // Body should now be hidden
      expect(container.querySelector('#runbi-action-copy')).toBeNull();

      // Click again to expand
      await act(async () => {
        collapseBtn.click();
      });
      expect(container.querySelector('#runbi-action-copy')).not.toBeNull();
    });

    it('ADV-UI-7: State 7 - Extreme Positioning Coordinates and Fluid Container mode', async () => {
      // Fluid mode (no top/left provided)
      await renderUI(
        <PolishPanel
          originalText="原文"
          polishedText="润色稿"
          isGenerating={false}
          activeStyle="polished"
          isDiffMode={false}
          isEditable={true}
          onClose={vi.fn()}
          onStyleChange={vi.fn()}
          onToggleDiff={vi.fn()}
          onStop={vi.fn()}
          onRegenerate={vi.fn()}
          onCopy={vi.fn()}
          onReplace={vi.fn()}
        />
      );

      const panelFluid = container.querySelector('#runbi-panel') as HTMLElement;
      expect(panelFluid.style.position).not.toBe('absolute');

      // Extreme absolute coordinates
      await renderUI(
        <PolishPanel
          top={-500}
          left={10000}
          originalText="原文"
          polishedText="润色稿"
          isGenerating={false}
          activeStyle="polished"
          isDiffMode={false}
          isEditable={true}
          onClose={vi.fn()}
          onStyleChange={vi.fn()}
          onToggleDiff={vi.fn()}
          onStop={vi.fn()}
          onRegenerate={vi.fn()}
          onCopy={vi.fn()}
          onReplace={vi.fn()}
        />
      );

      const panelAbsolute = container.querySelector('#runbi-panel') as HTMLElement;
      expect(panelAbsolute.style.top).toBe('-500px');
      expect(panelAbsolute.style.left).toBe('10000px');
      expect(panelAbsolute.style.position).toBe('absolute');
    });

    it('ADV-UI-8: State 8 - Massive 50,000 character text render stability', async () => {
      const hugeOriginal = '这是一段非常冗长的原始输入文档。'.repeat(1500);
      const hugePolished = '这是一段经过高阶智能深度润色提炼的精美文本。'.repeat(1500);

      await renderUI(
        <PolishPanel
          originalText={hugeOriginal}
          polishedText={hugePolished}
          isGenerating={false}
          activeStyle="polished"
          isDiffMode={false}
          isEditable={true}
          showOriginalPreview={true}
          onClose={vi.fn()}
          onStyleChange={vi.fn()}
          onToggleDiff={vi.fn()}
          onStop={vi.fn()}
          onRegenerate={vi.fn()}
          onCopy={vi.fn()}
          onReplace={vi.fn()}
        />
      );

      const panel = container.querySelector('#runbi-panel');
      expect(panel).not.toBeNull();
      expect(container.textContent).toContain('精美文本');
    });
  });

  // --------------------------------------------------------------------------
  // 2.2 DiffViewer Adversarial Boundary Tests
  // --------------------------------------------------------------------------
  describe('DiffViewer Component Adversarial Boundary Tests', () => {
    it('ADV-DIFF-1: handles completely empty strings', async () => {
      await renderUI(<DiffViewer originalText="" polishedText="" />);
      expect(container.textContent).toContain('精简删除 (0字)');
      expect(container.textContent).toContain('优化新增 (0字)');
    });

    it('ADV-DIFF-2: handles identical strings without false positives', async () => {
      const identicalText = '这段文字完全相同，没有任何变更。';
      await renderUI(<DiffViewer originalText={identicalText} polishedText={identicalText} />);

      expect(container.textContent).toContain('精简删除 (0字)');
      expect(container.textContent).toContain('优化新增 (0字)');
      expect(container.querySelectorAll('[data-diff-type="delete"]')).toHaveLength(0);
      expect(container.querySelectorAll('[data-diff-type="insert"]')).toHaveLength(0);
    });

    it('ADV-DIFF-3: handles completely disjoint strings', async () => {
      await renderUI(<DiffViewer originalText="AAAA" polishedText="BBBB" />);

      expect(container.textContent).toContain('精简删除 (4字)');
      expect(container.textContent).toContain('优化新增 (4字)');
    });

    it('ADV-DIFF-4: handles split mode layout with deletions and insertions', async () => {
      await renderUI(<DiffViewer originalText="删除这段" polishedText="新增这段" mode="split" />);

      expect(container.textContent).toContain('原文');
      expect(container.textContent).toContain('润色稿');
      expect(container.querySelector('[data-diff-type="delete"]')?.textContent).toBe('删除');
      expect(container.querySelector('[data-diff-type="insert"]')?.textContent).toBe('新增');
      expect(container.querySelector('[data-diff-type="equal"]')?.textContent).toBe('这段');
    });
  });

  // --------------------------------------------------------------------------
  // 2.3 StyleTabs Adversarial Scenarios
  // --------------------------------------------------------------------------
  describe('StyleTabs Adversarial Tests', () => {
    it('ADV-TAB-1: handles unknown activeStyle without runtime error', async () => {
      const handleStyleChange = vi.fn();
      await renderUI(
        <StyleTabs
          activeStyle={'unknown_custom_style' as PolishStyle}
          onStyleChange={handleStyleChange}
        />
      );

      const tabs = container.querySelectorAll('[role="tab"]');
      expect(tabs.length).toBe(STYLE_OPTIONS.length);

      // None of the preset tabs should be selected
      tabs.forEach((tab) => {
        expect(tab.getAttribute('aria-selected')).toBe('false');
      });
    });

    it('ADV-TAB-2: handles empty custom styles list', async () => {
      await renderUI(
        <StyleTabs
          activeStyle="polished"
          onStyleChange={vi.fn()}
          styles={[]}
        />
      );

      expect(container.querySelectorAll('[role="tab"]').length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // 2.4 ActionBar State Variations
  // --------------------------------------------------------------------------
  describe('ActionBar Adversarial Tests', () => {
    it('ADV-ACT-1: enforces strict disabled states for non-editable and generating flags', async () => {
      const copySpy = vi.fn();
      const replaceSpy = vi.fn();
      const regenSpy = vi.fn();

      await renderUI(
        <ActionBar
          onCopy={copySpy}
          onReplace={replaceSpy}
          onRegenerate={regenSpy}
          isEditable={false}
          isGenerating={true}
        />
      );

      const copyBtn = container.querySelector('#runbi-action-copy') as HTMLButtonElement;
      const replaceBtn = container.querySelector('#runbi-action-replace') as HTMLButtonElement;
      const regenBtn = container.querySelector('#runbi-action-regenerate') as HTMLButtonElement;

      expect(replaceBtn.disabled).toBe(true);
      expect(regenBtn.disabled).toBe(true);

      await act(async () => {
        replaceBtn.click();
        regenBtn.click();
      });

      expect(replaceSpy).not.toHaveBeenCalled();
      expect(regenSpy).not.toHaveBeenCalled();
    });

    it('ADV-ACT-2: supports fully custom action labels', async () => {
      await renderUI(
        <ActionBar
          onCopy={vi.fn()}
          onReplace={vi.fn()}
          onRegenerate={vi.fn()}
          isEditable={true}
          isGenerating={false}
          copyLabel="Copy Markdown"
          replaceLabel="Inject Text"
          regenerateLabel="Try Another Style"
        />
      );

      expect(container.textContent).toContain('Copy Markdown');
      expect(container.textContent).toContain('Inject Text');
      expect(container.textContent).toContain('Try Another Style');
    });
  });

  // --------------------------------------------------------------------------
  // 2.5 InstructionInput Adversarial Boundary Tests
  // --------------------------------------------------------------------------
  describe('InstructionInput Adversarial Tests', () => {
    it('ADV-INS-1: blocks submission for empty and whitespace-only inputs', async () => {
      const submitSpy = vi.fn();
      await renderUI(<InstructionInput onSubmit={submitSpy} />);

      const input = container.querySelector('#runbi-instruction-input') as HTMLInputElement;
      const sendBtn = container.querySelector('#runbi-instruction-send') as HTMLButtonElement;

      // Enter on empty
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      expect(submitSpy).not.toHaveBeenCalled();

      // Whitespace only
      await act(async () => {
        input.value = '    \t\n   ';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        sendBtn.click();
      });
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('ADV-INS-2: disables input and send button during generation', async () => {
      const submitSpy = vi.fn();
      await renderUI(<InstructionInput onSubmit={submitSpy} isGenerating={true} />);

      const input = container.querySelector('#runbi-instruction-input') as HTMLInputElement;
      const sendBtn = container.querySelector('#runbi-instruction-send') as HTMLButtonElement;

      expect(input.disabled).toBe(true);
      expect(sendBtn.disabled).toBe(true);

      const quickChips = container.querySelectorAll('button[type="button"]');
      quickChips.forEach((chip) => {
        expect((chip as HTMLButtonElement).disabled).toBe(true);
      });
    });
  });

  // --------------------------------------------------------------------------
  // 2.6 Toast Feedback Pill Lifecycle Tests
  // --------------------------------------------------------------------------
  describe('Toast Adversarial Tests', () => {
    it('ADV-TST-1: renders all toast variants (success, error, info)', async () => {
      // Success
      await renderUI(<Toast message="操作成功" visible={true} type="success" />);
      expect(container.querySelector('#runbi-toast')).not.toBeNull();
      expect(container.textContent).toContain('操作成功');

      // Error
      await renderUI(<Toast message="操作失败" visible={true} type="error" />);
      expect(container.querySelector('#runbi-toast')).not.toBeNull();
      expect(container.textContent).toContain('操作失败');

      // Info
      await renderUI(<Toast message="提示信息" visible={true} type="info" />);
      expect(container.querySelector('#runbi-toast')).not.toBeNull();
      expect(container.textContent).toContain('提示信息');

      // Hidden
      await renderUI(<Toast message="隐藏" visible={false} />);
      expect(container.querySelector('#runbi-toast')).toBeNull();
    });

    it('ADV-TST-2: unmounting before duration timer cleans up timer cleanly', async () => {
      vi.useFakeTimers();
      const dismissSpy = vi.fn();

      await renderUI(<Toast message="测试销毁" visible={true} durationMs={3000} onDismiss={dismissSpy} />);

      // Advance partially
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      // Unmount before 3000ms
      await act(async () => {
        root?.unmount();
        root = null;
      });

      // Advance remaining time
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      expect(dismissSpy).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});
