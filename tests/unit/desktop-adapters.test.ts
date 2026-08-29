/**
 * @file tests/unit/desktop-adapters.test.ts
 * Unit tests for Tauri Desktop Platform Adapters
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TauriSelectionProvider,
  TauriTextReplacer,
  TauriStorageProvider,
  TauriIPCLLMTransport,
  createDesktopAdapters,
} from '../../desktop/src/adapters';

describe('Desktop Platform Adapters Unit Test Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('TauriSelectionProvider', () => {
    it('creates instance and implements ISelectionProvider contract', async () => {
      const provider = new TauriSelectionProvider();
      expect(provider).toBeDefined();
      expect(typeof provider.getSelection).toBe('function');
      expect(typeof provider.clearSelection).toBe('function');
      expect(typeof provider.subscribeToSelectionChange).toBe('function');
    });

    it('returns null or active selection when no text selected', async () => {
      const provider = new TauriSelectionProvider();
      const sel = await provider.getSelection();
      // In jsdom without selection or mock clipboard, returns null or fallback
      expect(sel === null || typeof sel?.text === 'string').toBe(true);
    });

    it('clears selection state properly', async () => {
      const provider = new TauriSelectionProvider();
      await provider.clearSelection();
      const sel = await provider.getSelection();
      expect(sel).toBeNull();
    });

    it('supports subscription listeners and unsubscription', () => {
      const provider = new TauriSelectionProvider();
      const listener = vi.fn();
      const unsubscribe = provider.subscribeToSelectionChange(listener);

      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });
  });

  describe('TauriTextReplacer', () => {
    it('creates instance and implements ITextReplacer contract', async () => {
      const replacer = new TauriTextReplacer();
      expect(replacer).toBeDefined();
      expect(typeof replacer.replaceText).toBe('function');
      expect(typeof replacer.canReplace).toBe('function');
      expect(typeof replacer.copyToClipboard).toBe('function');
    });

    it('handles empty replacement text gracefully', async () => {
      const replacer = new TauriTextReplacer();
      const res = await replacer.replaceText('');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Empty');
    });

    it('replaces text via clipboard copy fallback in test environment', async () => {
      const replacer = new TauriTextReplacer();
      const res = await replacer.replaceText('测试润色文本');
      expect(typeof res.success).toBe('boolean');
      expect(typeof res.replacedLength).toBe('number');
    });

    it('canReplace returns boolean', async () => {
      const replacer = new TauriTextReplacer();
      const can = await replacer.canReplace();
      expect(typeof can).toBe('boolean');
    });

    it('does not overwrite a clipboard that Rust explicitly protected', async () => {
      const invokeMock = vi.fn(async (cmd: string) => {
        if (cmd === 'replace_text') {
          return {
            success: false,
            safe_to_copy_fallback: false,
            error: '剪贴板中含文件，已取消贴回。',
          };
        }
        return null;
      });
      (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

      try {
        const replacer = new TauriTextReplacer();
        const copySpy = vi.spyOn(replacer, 'copyToClipboard');
        const result = await replacer.replaceText('润色结果');

        expect(result.success).toBe(false);
        expect(result.fallbackCopied).toBe(false);
        expect(copySpy).not.toHaveBeenCalled();
      } finally {
        delete (window as any).__TAURI_INTERNALS__;
      }
    });
  });

  describe('TauriStorageProvider', () => {
    it('stores, retrieves and removes key-value pairs', async () => {
      const storage = new TauriStorageProvider();

      await storage.set('theme', 'dark');
      const val = await storage.get<string>('theme');
      expect(val).toBe('dark');

      const fallback = await storage.get<string>('non_existent', 'default_val');
      expect(fallback).toBe('default_val');

      await storage.remove('theme');
      const removed = await storage.get<string>('theme');
      expect(removed).toBeUndefined();
    });

    it('notifies subscribers on value change', async () => {
      const storage = new TauriStorageProvider();
      const callback = vi.fn();

      const unsubscribe = storage.subscribe('apiKey', callback);
      await storage.set('apiKey', 'sk-test-12345');

      expect(callback).toHaveBeenCalledWith('sk-test-12345', undefined);
      unsubscribe();

      await storage.set('apiKey', 'sk-new');
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('clears all entries and returns all data', async () => {
      const storage = new TauriStorageProvider();
      await storage.set('k1', 'v1');
      await storage.set('k2', 'v2');

      const all = await storage.getAll();
      expect(all.k1).toBe('v1');
      expect(all.k2).toBe('v2');

      await storage.clear();
      const afterClear = await storage.getAll();
      expect(Object.keys(afterClear).length).toBe(0);
    });

    it('syncs with Rust load_app_config and save_app_config in Tauri environment', async () => {
      const mockSavedConfig: Record<string, any> = {
        apiKey: 'sk-rust-persisted',
        endpoint: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-chat',
        defaultStyle: 'academic',
        autoCopyPopup: true,
        autostart: true,
        wakeShortcut: 'Ctrl+Shift+Space',
        readChatScreenshot: true,
      };

      let rustSavedData: Record<string, any> = {};

      const originalWindow = global.window;
      const invokeMock = vi.fn(async (cmd: string, args?: any) => {
        if (cmd === 'load_app_config') {
          return mockSavedConfig;
        }
        if (cmd === 'save_app_config') {
          rustSavedData = args?.config || {};
          return null;
        }
        return null;
      });
      (window as any).__TAURI_INTERNALS__ = {
        invoke: invokeMock,
      };

      try {
        const storage = new TauriStorageProvider();
        const loadedKey = await storage.get<string>('apiKey');
        expect(loadedKey).toBe('sk-rust-persisted');

        const loadedAutostart = await storage.get<boolean>('autostart');
        expect(loadedAutostart).toBe(true);

        const all = await storage.getAll();
        expect(all.model).toBe('deepseek-chat');

        invokeMock.mockClear();
        await storage.setMany({
          model: 'deepseek-coder',
          apiKey: 'sk-updated',
          autoCopyPopup: false,
        });

        expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'save_app_config')).toHaveLength(1);
        expect(rustSavedData.model).toBe('deepseek-coder');
        expect(rustSavedData.apiKey).toBe('sk-updated');
        expect(rustSavedData.autoCopyPopup).toBe(false);
        expect(localStorage.getItem('runbi:apiKey')).toBeNull();

        invokeMock.mockClear();
        await storage.setMany({
          model: 'deepseek-coder',
          apiKey: 'sk-updated',
          autoCopyPopup: false,
        });
        expect(invokeMock).not.toHaveBeenCalled();
      } finally {
        delete (window as any).__TAURI_INTERNALS__;
      }
    });

    it('does not publish settings when the durable Rust save fails', async () => {
      const invokeMock = vi.fn(async (cmd: string) => {
        if (cmd === 'load_app_config') return {};
        if (cmd === 'save_app_config') throw new Error('disk full');
        return null;
      });
      (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

      try {
        const storage = new TauriStorageProvider();
        const subscriber = vi.fn();
        storage.subscribe('model', subscriber);

        await expect(storage.setMany({ model: 'deepseek-chat' })).rejects.toThrow('disk full');
        expect(await storage.get('model')).toBeUndefined();
        expect(localStorage.getItem('runbi:model')).toBeNull();
        expect(subscriber).not.toHaveBeenCalled();
      } finally {
        delete (window as any).__TAURI_INTERNALS__;
      }
    });
  });

  describe('TauriIPCLLMTransport', () => {
    it('streams mock response when apiKey is omitted', async () => {
      const transport = new TauriIPCLLMTransport();
      const chunks: string[] = [];
      let done = false;
      let duration = 0;
      let tokens = 0;

      await transport.streamChat(
        {
          text: '这是一段测试学术文本',
          config: {
            style: 'academic',
          },
        },
        {
          onChunk: (delta) => chunks.push(delta),
          onDone: (d, t) => {
            done = true;
            duration = d;
            tokens = t;
          },
          onError: () => {},
        }
      );

      expect(done).toBe(true);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join('')).toContain('学术规范');
      expect(duration).toBeGreaterThan(0);
      expect(tokens).toBeGreaterThan(0);
    });

    it('respects AbortSignal during streaming', async () => {
      const transport = new TauriIPCLLMTransport();
      const controller = new AbortController();
      controller.abort();

      let aborted = false;
      await transport.streamChat(
        {
          text: '测试中断',
          config: { style: 'concise' },
        },
        {
          onChunk: () => {},
          onDone: () => {},
          onError: () => {},
          onAbort: () => {
            aborted = true;
          },
        },
        controller.signal
      );

      expect(aborted).toBe(true);
    });

    it('testConnection returns success in mock mode', async () => {
      const transport = new TauriIPCLLMTransport();
      const res = await transport.testConnection({ style: 'business' });
      expect(res.success).toBe(true);
      expect(typeof res.latencyMs).toBe('number');
    });
  });

  describe('createDesktopAdapters Factory', () => {
    it('instantiates complete suite of desktop adapters', () => {
      const suite = createDesktopAdapters();
      expect(suite.selectionProvider).toBeInstanceOf(TauriSelectionProvider);
      expect(suite.textReplacer).toBeInstanceOf(TauriTextReplacer);
      expect(suite.storageProvider).toBeInstanceOf(TauriStorageProvider);
      expect(suite.llmTransport).toBeInstanceOf(TauriIPCLLMTransport);
    });
  });
});
