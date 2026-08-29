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

  it('starts polishing immediately when Rust emits captured selection text', async () => {
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
          trigger: 'selection',
        },
      });
      // Advance only through the finite mock stream. `runAllTimers` also chases
      // the panel's recurring UI timers and correctly treats them as infinite.
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(host.textContent).toContain('经过润色与调整后');
    expect(host.textContent).toContain('这是一份需要优化表达的普通文本。');
  });
});
