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

  it('keeps a capsule recoverable when the pointer re-enters during fade-out', async () => {
    await act(async () => root.render(<App />));
    await act(async () => eventMocks.listeners.get('runbi://captured-selection')!({
      payload: { text: '可恢复的选区', trigger: 'selection', generation: 1 },
    }));
    const toolbar = host.querySelector('[role="toolbar"]') as HTMLElement;
    toolbar.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    toolbar.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(toolbar.className).toContain('is-visible');
    await act(async () => vi.advanceTimersByTimeAsync(220));
    expect(host.querySelector('[role="toolbar"]')).not.toBeNull();
  });

  it('serializes capsule expansion clicks while native positioning is pending', async () => {
    await act(async () => root.render(<App />));
    await act(async () => eventMocks.listeners.get('runbi://captured-selection')!({
      payload: { text: '只展开一次', trigger: 'selection', generation: 1 },
    }));
    let finishPosition!: () => void;
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    invoke.mockImplementation((command: string) => command === 'position_window_at_cursor'
      ? new Promise<void>((resolve) => { finishPosition = resolve; })
      : Promise.resolve(null));
    const translate = host.querySelector('button[aria-label="翻译选中文本"]') as HTMLButtonElement;
    const polish = host.querySelector('button[aria-label="润色选中文本"]') as HTMLButtonElement;
    await act(async () => {
      translate.click();
      polish.click();
    });
    expect(invoke.mock.calls.filter(([command]: [string]) => command === 'position_window_at_cursor')).toHaveLength(1);
    await act(async () => finishPosition());
  });

  it('switches directly to the panel when a shortcut supersedes a capsule', async () => {
    await act(async () => root.render(<App />));
    const select = eventMocks.listeners.get('runbi://captured-selection')!;
    await act(async () => select({
      payload: { text: '旧胶囊内容', trigger: 'selection', generation: 1 },
    }));
    expect(host.querySelector('[role="toolbar"]')).not.toBeNull();
    await act(async () => select({
      payload: { text: '快捷键新内容', trigger: 'shortcut' },
    }));
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
  });

  it('hides an unfocused capsule on selection invalidation without advancing timers', async () => {
    await act(async () => root.render(<App />));
    const select = eventMocks.listeners.get('runbi://captured-selection')!;
    const invalidate = eventMocks.listeners.get('runbi://selection-invalidated');
    expect(invalidate).toBeTypeOf('function');
    await act(async () => select({ payload: { text: '选中文本', trigger: 'selection', generation: 1 } }));
    expect(host.querySelector('[role="toolbar"]')).not.toBeNull();

    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    invoke.mockClear();
    await act(async () => invalidate!({ payload: 2 }));
    // Rust has already hidden the native window; do not send a delayed hide IPC.
    expect(invoke.mock.calls.some(([command]: [string]) => command === 'hide_capsule_window')).toBe(false);
    expect(host.querySelector('[role="toolbar"]')).toBeNull();

    // A late UIA/clipboard result must not resurrect the cancelled selection.
    await act(async () => select({ payload: { text: '旧选区', trigger: 'selection', generation: 1 } }));
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
    await act(async () => select({ payload: { text: '新选区', trigger: 'selection', generation: 2 } }));
    expect(host.querySelector('[role="toolbar"]')).not.toBeNull();
    // A delayed invalidation belonging to an older interaction must be ignored.
    await act(async () => invalidate!({ payload: 1 }));
    expect(host.querySelector('[role="toolbar"]')).not.toBeNull();
    await act(async () => invalidate!({ payload: 2 }));
    expect(host.querySelector('[role="toolbar"]')).not.toBeNull();
  });

  it('does not hide a panel while capsule expansion is awaiting native positioning', async () => {
    await act(async () => root.render(<App />));
    await act(async () => eventMocks.listeners.get('runbi://captured-selection')!({
      payload: { text: '需要翻译的选区', trigger: 'selection', generation: 1 },
    }));
    let finishPosition!: () => void;
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    invoke.mockImplementation((command: string) => command === 'position_window_at_cursor'
      ? new Promise<void>((resolve) => { finishPosition = resolve; })
      : Promise.resolve(null));
    await act(async () => (host.querySelector('button[aria-label="翻译选中文本"]') as HTMLButtonElement).click());
    await act(async () => eventMocks.listeners.get('runbi://selection-invalidated')!({ payload: 2 }));
    expect(invoke.mock.calls.some(([command]: [string]) => command === 'hide_capsule_window')).toBe(false);
    await act(async () => finishPosition());
    expect(host.querySelector('[data-testid="translate-bar"]')).not.toBeNull();
  });

  it('keeps a newer capsule when an older native hide completes late', async () => {
    await act(async () => root.render(<App />));
    const select = eventMocks.listeners.get('runbi://captured-selection')!;
    await act(async () => select({ payload: { text: '旧选区', trigger: 'selection', generation: 1 } }));
    let finishHide!: () => void;
    (window as any).__TAURI_INTERNALS__.invoke.mockImplementation((command: string) =>
      command === 'hide_capsule_window'
        ? new Promise<void>((resolve) => { finishHide = resolve; })
        : Promise.resolve(null));
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect((window as any).__TAURI_INTERNALS__.invoke).toHaveBeenCalledWith('hide_capsule_window', { generation: 1 }, undefined);
    await act(async () => select({ payload: { text: '新选区', trigger: 'selection', generation: 2 } }));
    await act(async () => finishHide());
    expect(host.querySelector('[role="toolbar"]')).not.toBeNull();
  });

  it('clears 50 successive invalidations without timers or a native hide round trip', async () => {
    await act(async () => root.render(<App />));
    const select = eventMocks.listeners.get('runbi://captured-selection')!;
    const invalidate = eventMocks.listeners.get('runbi://selection-invalidated')!;
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    invoke.mockClear();
    for (let generation = 1; generation < 100; generation += 2) {
      await act(async () => select({ payload: { text: '重复划词', trigger: 'selection', generation } }));
      expect(host.querySelector('[role="toolbar"]')).not.toBeNull();
      await act(async () => invalidate({ payload: generation + 1 }));
      expect(host.querySelector('[role="toolbar"]')).toBeNull();
      await act(async () => select({ payload: { text: '过期结果', trigger: 'selection', generation } }));
      expect(host.querySelector('[role="toolbar"]')).toBeNull();
    }
    expect(invoke.mock.calls.some(([command]: [string]) => command === 'hide_capsule_window')).toBe(false);
  });

});

