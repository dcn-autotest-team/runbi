/**
 * @file tests/unit/adapters-contract.test.ts
 * Unit tests for Platform Adapter Interface Contracts & Structural Invariants (@runbi/shared/adapters)
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  ISelectionProvider,
  ITextReplacer,
  IStorageProvider,
  ILLMTransport,
  LLMStreamRequest,
  StreamCallbacks,
  ReplacementResult,
} from '@runbi/shared/adapters';
import type { SelectionInfo } from '@runbi/shared/types/selection';
import type { StreamConfig } from '@runbi/shared/types/stream';

describe('Shared Adapters: Inversion-of-Control (IoC) Contracts', () => {
  describe('ISelectionProvider Contract', () => {
    class MockSelectionProvider implements ISelectionProvider {
      private currentSelection: SelectionInfo | null = null;
      private listeners: Set<(sel: SelectionInfo | null) => void> = new Set();

      setMockSelection(sel: SelectionInfo | null) {
        this.currentSelection = sel;
        this.listeners.forEach((fn) => fn(sel));
      }

      async getSelection(): Promise<SelectionInfo | null> {
        return this.currentSelection;
      }

      subscribeToSelectionChange(callback: (selection: SelectionInfo | null) => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
      }

      async clearSelection(): Promise<void> {
        this.setMockSelection(null);
      }
    }

    it('should conform to ISelectionProvider and handle selection lifecycle', async () => {
      const provider: ISelectionProvider = new MockSelectionProvider();
      const mockImpl = provider as MockSelectionProvider;

      expect(await provider.getSelection()).toBeNull();

      const listener = vi.fn();
      const unsubscribe = provider.subscribeToSelectionChange!(listener);

      const testSelection: SelectionInfo = {
        text: '测试文本',
        rawText: '测试文本',
        rect: { top: 100, left: 100, right: 200, bottom: 120 },
        isEditable: true,
        source: 'dom',
      };

      mockImpl.setMockSelection(testSelection);
      expect(listener).toHaveBeenCalledWith(testSelection);
      expect(await provider.getSelection()).toEqual(testSelection);

      await provider.clearSelection();
      expect(listener).toHaveBeenCalledWith(null);
      expect(await provider.getSelection()).toBeNull();

      unsubscribe();
    });
  });

  describe('ITextReplacer Contract', () => {
    class MockTextReplacer implements ITextReplacer {
      public replacedText: string = '';
      public clipboardText: string = '';

      async canReplace(context?: SelectionInfo | null): Promise<boolean> {
        return context?.isEditable ?? false;
      }

      async replaceText(newText: string, context?: SelectionInfo | null): Promise<ReplacementResult> {
        if (!context?.isEditable) {
          return { success: false, error: 'Target is not editable' };
        }
        this.replacedText = newText;
        return {
          success: true,
          replacedLength: newText.length,
          restoredClipboard: true,
        };
      }

      async copyToClipboard(text: string): Promise<boolean> {
        this.clipboardText = text;
        return true;
      }
    }

    it('should validate canReplace and execute replacement when editable', async () => {
      const replacer: ITextReplacer = new MockTextReplacer();
      const mockContext: SelectionInfo = {
        text: '原文',
        rawText: '原文',
        rect: { top: 10, left: 10, right: 50, bottom: 30 },
        isEditable: true,
      };

      expect(await replacer.canReplace(mockContext)).toBe(true);

      const result = await replacer.replaceText('润色稿', mockContext);
      expect(result.success).toBe(true);
      expect(result.replacedLength).toBe(3);

      // Test non-editable context
      const readonlyContext: SelectionInfo = { ...mockContext, isEditable: false };
      expect(await replacer.canReplace(readonlyContext)).toBe(false);

      const failResult = await replacer.replaceText('润色稿', readonlyContext);
      expect(failResult.success).toBe(false);
      expect(failResult.error).toContain('not editable');

      // Test copyToClipboard
      const copied = await replacer.copyToClipboard!('复制内容');
      expect(copied).toBe(true);
      expect((replacer as MockTextReplacer).clipboardText).toBe('复制内容');
    });
  });

  describe('IStorageProvider Contract', () => {
    class MockStorageProvider implements IStorageProvider {
      private store = new Map<string, unknown>();
      private listeners = new Map<string, Set<(n: any, o: any) => void>>();

      async get<T>(key: string, defaultValue?: T): Promise<T> {
        return this.store.has(key) ? (this.store.get(key) as T) : (defaultValue as T);
      }

      async set<T>(key: string, value: T): Promise<void> {
        const oldVal = this.store.get(key);
        this.store.set(key, value);
        const keyListeners = this.listeners.get(key);
        if (keyListeners) {
          keyListeners.forEach((fn) => fn(value, oldVal));
        }
      }

      async remove(key: string): Promise<void> {
        const oldVal = this.store.get(key);
        this.store.delete(key);
        const keyListeners = this.listeners.get(key);
        if (keyListeners) {
          keyListeners.forEach((fn) => fn(undefined, oldVal));
        }
      }

      subscribe<T>(key: string, callback: (newValue: T, oldValue: T) => void): () => void {
        if (!this.listeners.has(key)) {
          this.listeners.set(key, new Set());
        }
        const set = this.listeners.get(key)!;
        set.add(callback);
        return () => set.delete(callback);
      }

      async clear(): Promise<void> {
        this.store.clear();
      }

      async getAll(): Promise<Record<string, unknown>> {
        return Object.fromEntries(this.store.entries());
      }
    }

    it('should store, retrieve, remove, and notify on key-value changes', async () => {
      const storage: IStorageProvider = new MockStorageProvider();

      expect(await storage.get('theme', 'system')).toBe('system');

      const changeSpy = vi.fn();
      const unsub = storage.subscribe('theme', changeSpy);

      await storage.set('theme', 'dark');
      expect(await storage.get('theme')).toBe('dark');
      expect(changeSpy).toHaveBeenCalledWith('dark', undefined);

      await storage.remove('theme');
      expect(await storage.get('theme', 'light')).toBe('light');

      unsub();
    });
  });

  describe('ILLMTransport Contract', () => {
    class MockLLMTransport implements ILLMTransport {
      async streamChat(
        request: LLMStreamRequest,
        callbacks: StreamCallbacks,
        signal?: AbortSignal
      ): Promise<void> {
        if (signal?.aborted) {
          callbacks.onAbort?.();
          return;
        }

        callbacks.onChunk('Chunk 1: ');
        callbacks.onChunk('Chunk 2');
        callbacks.onDone(120, 15);
      }

      async testConnection(config: StreamConfig): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
        if (!config.apiKey && config.baseUrl?.includes('error')) {
          return { success: false, error: 'Invalid configuration' };
        }
        return { success: true, latencyMs: 88 };
      }
    }

    it('should stream chat responses through callback events', async () => {
      const transport: ILLMTransport = new MockLLMTransport();
      const chunks: string[] = [];
      const doneSpy = vi.fn();
      const errorSpy = vi.fn();

      await transport.streamChat(
        {
          text: 'Hello',
          config: { style: 'polished' },
        },
        {
          onChunk: (delta) => chunks.push(delta),
          onDone: doneSpy,
          onError: errorSpy,
        }
      );

      expect(chunks).toEqual(['Chunk 1: ', 'Chunk 2']);
      expect(doneSpy).toHaveBeenCalledWith(120, 15);
      expect(errorSpy).not.toHaveBeenCalled();

      // Test connection
      const conn = await transport.testConnection({ style: 'polished' });
      expect(conn.success).toBe(true);
      expect(conn.latencyMs).toBe(88);
    });
  });
});
