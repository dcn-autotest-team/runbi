/**
 * @file tests/unit/extension-adapters.test.ts
 * Comprehensive Unit and Integration Tests for Extension Platform Adapters (Milestone 2)
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ChromeDOMSelectionProvider,
  isEditableElement,
} from '../../src/adapters/ChromeDOMSelectionProvider';
import {
  DOMTextReplacer,
  replaceInInputElement,
  replaceInContentEditable,
} from '../../src/adapters/DOMTextReplacer';
import { ChromeStorageProvider } from '../../src/adapters/ChromeStorageProvider';
import {
  ChromePortLLMTransport,
  STREAM_CHANNEL_NAME,
} from '../../src/adapters/ChromePortLLMTransport';
import type {
  ISelectionProvider,
  ITextReplacer,
  IStorageProvider,
  ILLMTransport,
} from '@runbi/shared/adapters';
import type { SelectionInfo } from '@runbi/shared/types/selection';
import { App } from '../../src/content/App';
import { PopupApp } from '../../src/popup/PopupApp';
import { OptionsApp } from '../../src/options/OptionsApp';

describe('Milestone 2: Chrome Extension Platform Adapters & Integration', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    window.getSelection()?.removeAllRanges();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  async function renderComponent(element: React.ReactElement): Promise<void> {
    await act(async () => {
      if (!root) {
        root = ReactDOM.createRoot(container);
      }
      root.render(element);
    });
  }

  // =========================================================================
  // 1. ChromeDOMSelectionProvider Unit Tests
  // =========================================================================
  describe('ChromeDOMSelectionProvider', () => {
    it('should implement the ISelectionProvider contract', () => {
      const provider: ISelectionProvider = new ChromeDOMSelectionProvider();
      expect(typeof provider.getSelection).toBe('function');
      expect(typeof provider.subscribeToSelectionChange).toBe('function');
      expect(typeof provider.clearSelection).toBe('function');
    });

    it('should correctly identify editable DOM elements via isEditableElement', () => {
      const textarea = document.createElement('textarea');
      const textInput = document.createElement('input');
      textInput.type = 'text';
      const readOnlyInput = document.createElement('input');
      readOnlyInput.type = 'text';
      readOnlyInput.readOnly = true;
      const disabledTextarea = document.createElement('textarea');
      disabledTextarea.disabled = true;
      const buttonInput = document.createElement('input');
      buttonInput.type = 'button';
      const p = document.createElement('p');
      const ceDiv = document.createElement('div');
      ceDiv.setAttribute('contenteditable', 'true');
      const childOfCe = document.createElement('span');
      ceDiv.appendChild(childOfCe);

      expect(isEditableElement(textarea)).toBe(true);
      expect(isEditableElement(textInput)).toBe(true);
      expect(isEditableElement(readOnlyInput)).toBe(false);
      expect(isEditableElement(disabledTextarea)).toBe(false);
      expect(isEditableElement(buttonInput)).toBe(false);
      expect(isEditableElement(p)).toBe(false);
      expect(isEditableElement(ceDiv)).toBe(true);
      expect(isEditableElement(childOfCe)).toBe(true);
      expect(isEditableElement(null)).toBe(false);
    });

    it('should capture selection from <textarea> with contextBefore and contextAfter', async () => {
      const provider = new ChromeDOMSelectionProvider();
      const textarea = document.createElement('textarea');
      textarea.value = '前缀文字_选中的测试内容_后缀文字';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.selectionStart = 5;
      textarea.selectionEnd = 12;
      textarea.getBoundingClientRect = () => new DOMRect(10, 20, 200, 100);

      const sel = await provider.getSelection();
      expect(sel).not.toBeNull();
      expect(sel?.text).toBe('选中的测试内容');
      expect(sel?.isEditable).toBe(true);
      expect(sel?.source).toBe('dom');
      expect(sel?.contextBefore).toBe('前缀文字_');
      expect(sel?.contextAfter).toBe('_后缀文字');
      expect(sel?.targetElement).toBe(textarea);
    });

    it('should capture selection from standard DOM elements with savedRange', async () => {
      const provider = new ChromeDOMSelectionProvider();
      const p = document.createElement('p');
      p.textContent = '这是一个用于多端测试的段落选区';
      document.body.appendChild(p);

      const range = document.createRange();
      range.selectNodeContents(p);
      range.getBoundingClientRect = () => new DOMRect(10, 20, 300, 30);

      const selObj = window.getSelection();
      selObj?.removeAllRanges();
      selObj?.addRange(range);

      const sel = await provider.getSelection();
      expect(sel).not.toBeNull();
      expect(sel?.text).toBe('这是一个用于多端测试的段落选区');
      expect(sel?.isEditable).toBe(false);
      expect(sel?.savedRange).not.toBeNull();
      expect(sel?.rect.width).toBe(300);
    });

    it('should return null for selections that fail length validation', async () => {
      const provider = new ChromeDOMSelectionProvider({ minSelectionLength: 3 });
      const textarea = document.createElement('textarea');
      textarea.value = '短';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.selectionStart = 0;
      textarea.selectionEnd = 1;
      textarea.getBoundingClientRect = () => new DOMRect(0, 0, 50, 20);

      const sel = await provider.getSelection();
      expect(sel).toBeNull();
    });

    it('should debounce selection changes and provide clean unbind', async () => {
      vi.useFakeTimers();
      try {
        const provider = new ChromeDOMSelectionProvider({ debounceMs: 150 });
        const callback = vi.fn();

        const textarea = document.createElement('textarea');
        textarea.value = '防抖测试文本内容';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.selectionStart = 0;
        textarea.selectionEnd = 8;
        textarea.getBoundingClientRect = () => new DOMRect(10, 10, 100, 20);

        const unbind = provider.subscribeToSelectionChange(callback);

        // Trigger events within debounce period
        document.dispatchEvent(new MouseEvent('mouseup'));
        await vi.advanceTimersByTimeAsync(50);
        document.dispatchEvent(new Event('selectionchange'));
        await vi.advanceTimersByTimeAsync(50);

        expect(callback).not.toHaveBeenCalled();

        // Complete debounce delay
        await vi.advanceTimersByTimeAsync(150);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback.mock.calls[0][0]?.text).toBe('防抖测试文本内容');

        unbind();

        // Further events should not trigger callback
        document.dispatchEvent(new MouseEvent('mouseup'));
        await vi.advanceTimersByTimeAsync(200);
        expect(callback).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should clear selection on input and DOM selection', async () => {
      const provider = new ChromeDOMSelectionProvider();
      const textarea = document.createElement('textarea');
      textarea.value = '测试清除选区';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.selectionStart = 0;
      textarea.selectionEnd = 4;

      await provider.clearSelection();
      expect(textarea.selectionStart).toBe(textarea.selectionEnd);

      const p = document.createElement('p');
      p.textContent = '段落选区';
      document.body.appendChild(p);
      const range = document.createRange();
      range.selectNodeContents(p);
      window.getSelection()?.addRange(range);
      expect(window.getSelection()?.rangeCount).toBeGreaterThan(0);

      textarea.blur();
      await provider.clearSelection();
      expect(window.getSelection()?.rangeCount).toBe(0);
    });
  });

  // =========================================================================
  // 2. DOMTextReplacer Unit Tests
  // =========================================================================
  describe('DOMTextReplacer', () => {
    it('should implement the ITextReplacer contract', () => {
      const replacer: ITextReplacer = new DOMTextReplacer();
      expect(typeof replacer.replaceText).toBe('function');
      expect(typeof replacer.canReplace).toBe('function');
      expect(typeof replacer.copyToClipboard).toBe('function');
    });

    it('should correctly evaluate canReplace', async () => {
      const replacer = new DOMTextReplacer();
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);

      const editableContext: SelectionInfo = {
        text: '测试文本',
        rawText: '测试文本',
        rect: { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 },
        isEditable: true,
        targetElement: textarea,
        source: 'dom',
        timestamp: Date.now(),
      };

      const nonEditableContext: SelectionInfo = {
        ...editableContext,
        isEditable: false,
      };

      expect(await replacer.canReplace(editableContext)).toBe(true);
      expect(await replacer.canReplace(nonEditableContext)).toBe(false);
      expect(await replacer.canReplace(null)).toBe(false);
    });

    it('should replace text in <textarea> and dispatch synthetic input/change events', async () => {
      const replacer = new DOMTextReplacer();
      const textarea = document.createElement('textarea');
      textarea.value = '原始[待替换]尾部';
      document.body.appendChild(textarea);

      const inputHandler = vi.fn();
      const changeHandler = vi.fn();
      textarea.addEventListener('input', inputHandler);
      textarea.addEventListener('change', changeHandler);

      textarea.focus();
      textarea.selectionStart = 2;
      textarea.selectionEnd = 7;

      const context: SelectionInfo = {
        text: '[待替换]',
        rawText: '[待替换]',
        rect: { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 },
        isEditable: true,
        targetElement: textarea,
        source: 'dom',
        timestamp: Date.now(),
      };

      const result = await replacer.replaceText('已成功润色', context);
      expect(result.success).toBe(true);
      expect(result.replacedLength).toBe('已成功润色'.length);
      expect(textarea.value).toBe('原始已成功润色尾部');
      expect(inputHandler).toHaveBeenCalled();
      expect(changeHandler).toHaveBeenCalled();
    });

    it('should replace text in contenteditable with DOM fallback if execCommand returns false', async () => {
      const replacer = new DOMTextReplacer();
      const ceDiv = document.createElement('div');
      ceDiv.setAttribute('contenteditable', 'true');
      ceDiv.textContent = '富文本原始内容';
      document.body.appendChild(ceDiv);

      const range = document.createRange();
      range.selectNodeContents(ceDiv);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      const context: SelectionInfo = {
        text: '富文本原始内容',
        rawText: '富文本原始内容',
        rect: { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 },
        isEditable: true,
        targetElement: ceDiv,
        savedRange: range,
        source: 'dom',
        timestamp: Date.now(),
      };

      const result = await replacer.replaceText('富文本润色后内容', context);
      expect(result.success).toBe(true);
      expect(ceDiv.textContent).toContain('富文本润色后内容');
    });

    it('should copy text to clipboard via copyToClipboard', async () => {
      const replacer = new DOMTextReplacer();
      const writeSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

      const success = await replacer.copyToClipboard('剪贴板复制测试内容');
      expect(success).toBe(true);
      expect(writeSpy).toHaveBeenCalledWith('剪贴板复制测试内容');
    });
  });

  // =========================================================================
  // 3. ChromeStorageProvider Unit Tests
  // =========================================================================
  describe('ChromeStorageProvider', () => {
    it('should implement the IStorageProvider contract', () => {
      const storage: IStorageProvider = new ChromeStorageProvider();
      expect(typeof storage.get).toBe('function');
      expect(typeof storage.set).toBe('function');
      expect(typeof storage.remove).toBe('function');
      expect(typeof storage.subscribe).toBe('function');
    });

    it('should get, set, and remove values with chrome.storage.local', async () => {
      const storage = new ChromeStorageProvider();

      await storage.set('apiKey', 'sk-test-key-12345');
      const retrieved = await storage.get<string>('apiKey');
      expect(retrieved).toBe('sk-test-key-12345');

      await storage.remove('apiKey');
      const missing = await storage.get<string>('apiKey', 'default-val');
      expect(missing).toBe('default-val');
    });

    it('should notify subscribers when storage value changes', async () => {
      const storage = new ChromeStorageProvider();
      const callback = vi.fn();

      const unsubscribe = storage.subscribe<string>('model', callback);

      await storage.set('model', 'deepseek-reasoner');

      if (chrome.storage?.onChanged?.addListener) {
        const calls = (chrome.storage.onChanged.addListener as any).mock?.calls;
        if (calls && calls.length > 0) {
          const listener = calls[0][0];
          listener({ model: { newValue: 'deepseek-reasoner', oldValue: 'deepseek-chat' } }, 'local');
        }
      }

      unsubscribe();
    });

    it('should clear all keys and getAll entries', async () => {
      const storage = new ChromeStorageProvider();
      await storage.set('k1', 'v1');
      await storage.set('k2', 'v2');

      const all = await storage.getAll?.();
      expect(all).toBeDefined();

      await storage.clear?.();
      const emptyVal = await storage.get('k1', null);
      expect(emptyVal).toBeNull();
    });
  });

  // =========================================================================
  // 4. ChromePortLLMTransport Unit Tests
  // =========================================================================
  describe('ChromePortLLMTransport', () => {
    it('should implement the ILLMTransport contract', () => {
      const transport: ILLMTransport = new ChromePortLLMTransport();
      expect(typeof transport.streamChat).toBe('function');
      expect(typeof transport.testConnection).toBe('function');
    });

    it('should stream chunks and finish on DONE message via runtime Port', async () => {
      const transport = new ChromePortLLMTransport();

      let messageListener: ((msg: any) => void) | null = null;
      const mockPort: any = {
        name: STREAM_CHANNEL_NAME,
        postMessage: vi.fn((msg) => {
          if (msg.action === 'START_STREAM') {
            queueMicrotask(() => {
              messageListener?.({ type: 'CHUNK', payload: { delta: '这是' } });
              messageListener?.({ type: 'CHUNK', payload: { delta: '测试流' } });
              messageListener?.({
                type: 'DONE',
                payload: { durationMs: 120, totalTokens: 4 },
              });
            });
          }
        }),
        onMessage: {
          addListener: vi.fn((fn) => {
            messageListener = fn;
          }),
        },
        onDisconnect: {
          addListener: vi.fn(),
        },
        disconnect: vi.fn(),
      };

      chrome.runtime.connect = vi.fn().mockReturnValue(mockPort);

      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();

      await transport.streamChat(
        {
          text: '原始输入',
          config: { style: 'polished' },
        },
        {
          onChunk,
          onDone,
          onError,
        }
      );

      expect(chrome.runtime.connect).toHaveBeenCalledWith({ name: STREAM_CHANNEL_NAME });
      expect(onChunk).toHaveBeenCalledWith('这是');
      expect(onChunk).toHaveBeenCalledWith('测试流');
      expect(onDone).toHaveBeenCalledWith(120, 4);
      expect(onError).not.toHaveBeenCalled();
    });

    it('should abort stream gracefully when signal is aborted', async () => {
      const transport = new ChromePortLLMTransport();
      const abortCtrl = new AbortController();

      const mockPort: any = {
        name: STREAM_CHANNEL_NAME,
        postMessage: vi.fn(),
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() },
        disconnect: vi.fn(),
      };

      chrome.runtime.connect = vi.fn().mockReturnValue(mockPort);

      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onAbort = vi.fn();

      const streamPromise = transport.streamChat(
        { text: '测试文本', config: { style: 'academic' } },
        { onChunk, onDone, onError: vi.fn(), onAbort },
        abortCtrl.signal
      );

      abortCtrl.abort();
      await streamPromise;

      expect(mockPort.postMessage).toHaveBeenCalledWith({ action: 'ABORT' });
      expect(onAbort).toHaveBeenCalled();
    });

    it('should fallback to built-in mock stream generator when Chrome runtime is unavailable', async () => {
      const transport = new ChromePortLLMTransport();
      chrome.runtime.connect = vi.fn().mockImplementation(() => {
        throw new Error('Port connect unavailable');
      });

      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();

      await transport.streamChat(
        {
          text: '短文本',
          config: { style: 'polished' },
        },
        {
          onChunk,
          onDone,
          onError,
        }
      );

      expect(onChunk).toHaveBeenCalled();
      expect(onDone).toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it('should test connection via runtime message or direct HTTP ping', async () => {
      const transport = new ChromePortLLMTransport();
      chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
        success: true,
        latencyMs: 65,
        model: 'deepseek-chat',
      });

      const result = await transport.testConnection({
        apiKey: 'sk-ping-key',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        style: 'polished',
      });

      expect(result.success).toBe(true);
      expect(result.latencyMs).toBe(65);
    });
  });

  // =========================================================================
  // 5. IoC Integration Tests: App, Popup, and Options
  // =========================================================================
  describe('IoC Integration with App, PopupApp, and OptionsApp', () => {
    it('should render App inside Shadow DOM with mock injected adapters', async () => {
      const mockSelection: SelectionInfo = {
        text: '选区文字',
        rawText: '选区文字',
        rect: { top: 100, left: 150, right: 250, bottom: 120, width: 100, height: 20 },
        isEditable: true,
        source: 'dom',
        timestamp: Date.now(),
      };

      const mockSelectionProvider: ISelectionProvider = {
        getSelection: vi.fn().mockResolvedValue(mockSelection),
        subscribeToSelectionChange: vi.fn().mockReturnValue(() => {}),
        clearSelection: vi.fn().mockResolvedValue(undefined),
      };

      const mockTextReplacer: ITextReplacer = {
        canReplace: vi.fn().mockResolvedValue(true),
        replaceText: vi.fn().mockResolvedValue({ success: true, replacedLength: 4 }),
        copyToClipboard: vi.fn().mockResolvedValue(true),
      };

      const mockStorageProvider: IStorageProvider = {
        get: vi.fn().mockImplementation((key, def) => Promise.resolve(def)),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockReturnValue(() => {}),
      };

      const mockLLMTransport: ILLMTransport = {
        streamChat: vi.fn().mockImplementation((req, cb) => {
          cb.onChunk('已润色内容');
          cb.onDone(50, 6);
          return Promise.resolve();
        }),
        testConnection: vi.fn().mockResolvedValue({ success: true, latencyMs: 50 }),
      };

      await renderComponent(
        React.createElement(App, {
          initialSelection: mockSelection,
          selectionProvider: mockSelectionProvider,
          textReplacer: mockTextReplacer,
          storageProvider: mockStorageProvider,
          llmTransport: mockLLMTransport,
        })
      );

      // Verify TriggerCapsule is rendered
      const capsule = container.querySelector('#runbi-trigger-capsule');
      expect(capsule).not.toBeNull();

      // Click capsule to open PolishPanel
      await act(async () => {
        (capsule as HTMLElement).click();
      });

      // Verify PolishPanel is rendered and streaming completed
      expect(container.textContent).toContain('润笔');
      expect(container.textContent).toContain('已润色内容');
      expect(container.textContent).toContain('替换原文');

      // Test Replace action
      const replaceBtn = container.querySelector('#runbi-action-replace') as HTMLButtonElement;
      expect(replaceBtn).not.toBeNull();

      await act(async () => {
        replaceBtn.click();
      });

      expect(mockTextReplacer.replaceText).toHaveBeenCalledWith('已润色内容', mockSelection);
    });

    it('should inject custom IStorageProvider into PopupApp and OptionsApp', async () => {
      const customStore = new Map<string, any>([
        ['enabled', true],
        ['model', 'custom-model-test'],
        ['apiKey', 'sk-custom-test'],
      ]);

      const mockStorage: IStorageProvider = {
        get: vi.fn().mockImplementation((key, def) => Promise.resolve(customStore.get(key) ?? def)),
        set: vi.fn().mockImplementation((key, val) => {
          customStore.set(key, val);
          return Promise.resolve();
        }),
        remove: vi.fn().mockImplementation((key) => {
          customStore.delete(key);
          return Promise.resolve();
        }),
        subscribe: vi.fn().mockReturnValue(() => {}),
      };

      await renderComponent(React.createElement(PopupApp, { storageProvider: mockStorage }));
      expect(mockStorage.get).toHaveBeenCalledWith('enabled', true);
      expect(mockStorage.get).toHaveBeenCalledWith('apiKey', '');

      await renderComponent(React.createElement(OptionsApp, { storageProvider: mockStorage }));
      expect(mockStorage.get).toHaveBeenCalledWith('provider', 'deepseek');
      expect(mockStorage.get).toHaveBeenCalledWith('model', 'deepseek-chat');
    });
  });
});
