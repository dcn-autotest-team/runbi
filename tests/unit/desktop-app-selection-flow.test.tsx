import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const eventMocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: any) => void>(),
  listen: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: eventMocks.listen,
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: vi.fn(async () => ''),
  writeText: vi.fn(async () => undefined),
}));

import { App } from '../../desktop/src/App';

describe('Desktop selection-to-polish flow', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    eventMocks.listeners.clear();
    eventMocks.listen.mockImplementation(async (event: string, callback: (payload: any) => void) => {
      eventMocks.listeners.set(event, callback);
      return () => eventMocks.listeners.delete(event);
    });

    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn(async (command: string) => {
        if (command === 'load_app_config') return {};
        if (command === 'get_global_shortcut') return 'Ctrl+Shift+Space';
        if (command === 'is_autostart_enabled') return false;
        return null;
      }),
    };

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    delete (window as any).__TAURI_INTERNALS__;
    vi.useRealTimers();
  });

  it('starts polishing immediately only for a shortcut-originated selection', async () => {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const onSelection = eventMocks.listeners.get('runbi://captured-selection');
    expect(onSelection).toBeTypeOf('function');

    await act(async () => {
      onSelection!({
        payload: {
          text: '这是一份需要优化表达的普通文本。',
          sourceApp: 'notepad.exe',
          windowTitle: '记事本',
          trigger: 'shortcut',
        },
      });
      // Advance only through the finite mock stream. `runAllTimers` also chases
      // the panel's recurring UI timers and correctly treats them as infinite.
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(host.textContent).toContain('经过润色与调整后');
    expect(host.textContent).toContain('这是一份需要优化表达的普通文本。');
  });

  it('shows the compact toolbar even for a short desktop selection', async () => {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const onSelection = eventMocks.listeners.get('runbi://captured-selection');
    await act(async () => {
      onSelection!({
        payload: {
          text: '好',
          sourceApp: 'notepad.exe',
          trigger: 'selection',
        },
      });
      await Promise.resolve();
    });

    expect(host.querySelector('[role="toolbar"]')).not.toBeNull();
    expect(host.textContent).not.toMatch(/[✨💬📋✅]/u);
  });

  it('capsule translate button expands the panel and starts translating', async () => {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const onSelection = eventMocks.listeners.get('runbi://captured-selection');
    await act(async () => {
      onSelection!({
        payload: {
          text: '这是一段需要翻译的中文',
          sourceApp: 'notepad.exe',
          trigger: 'selection',
          capsule: true,
        },
      });
      await Promise.resolve();
    });

    const translateBtn = host.querySelector('button[aria-label="翻译选中文本"]') as HTMLButtonElement;
    expect(translateBtn).not.toBeNull();

    await act(async () => {
      translateBtn.click();
      // 走完 mock 流式输出的打字节奏
      await vi.advanceTimersByTimeAsync(3000);
    });

    // 面板已展开：翻译语言条可见，mock 翻译结果已流出
    expect(host.querySelector('[data-testid="translate-bar"]')).not.toBeNull();
    expect(host.textContent).toContain('Translated');
  });
});
