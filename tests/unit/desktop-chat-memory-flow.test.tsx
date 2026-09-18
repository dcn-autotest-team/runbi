/**
 * @file tests/unit/desktop-chat-memory-flow.test.tsx
 * 回复模式的跨屏聊天上下文记忆：接线层验证（渲染真实 App，走划词 → 回复分析 → 写盘）。
 *
 * 单独成文件的原因：这些用例要求干净的 localStorage（用标记按用例累积，残留会让
 * 划词路径走进别的分支），而 desktop-app-selection-flow.test.tsx 里的既有用例是
 * 彼此共享状态的。vitest 按文件隔离 jsdom，分文件即可各管各的。
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const eventMocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: any) => void>(),
  listen: vi.fn(),
}));

const updaterMocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  getVersion: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: eventMocks.listen,
}));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: vi.fn(async () => ''),
  writeText: vi.fn(async () => undefined),
}));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: updaterMocks.check }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: updaterMocks.relaunch }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: updaterMocks.getVersion }));

import { App } from '../../desktop/src/App';
import { globalChatMemory } from '@runbi/shared/core';

const CHAT_KEY = 'wechat.exe::与张三的聊天';

describe('Desktop cross-screen chat memory', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    updaterMocks.check.mockReset();
    updaterMocks.check.mockResolvedValue(null);
    updaterMocks.relaunch.mockReset();
    updaterMocks.getVersion.mockReset();
    updaterMocks.getVersion.mockResolvedValue('1.0.23');
    eventMocks.listeners.clear();
    eventMocks.listen.mockImplementation(async (event: string, callback: (payload: any) => void) => {
      eventMocks.listeners.set(event, callback);
      return () => eventMocks.listeners.delete(event);
    });

    // 记忆是模块级单例、storage 会缓存进 localStorage：每个用例都从干净状态开始
    globalChatMemory.clearAll();
    window.localStorage.clear();

    (window as any).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' } },
      invoke: vi.fn(async (command: string, args?: any) => {
        if (command === 'load_app_config') return {};
        if (command === 'get_global_shortcut') return 'Ctrl+Shift+Space';
        if (command === 'is_autostart_enabled') return false;
        if (command === 'plugin:event|emit_to') {
          const { event, payload } = args ?? {};
          eventMocks.listeners.get(event)?.({ payload });
        }
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

  const renderApp = () =>
    act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

  /** 一轮 = 划词 → 点「智能回复」。测试环境没有 apiKey，走内置 mock 分析，conversation 即解析结果。 */
  const replyRound = async (text: string, generation: number) => {
    await act(async () => {
      eventMocks.listeners.get('runbi://captured-selection')!({
        payload: { text, sourceApp: 'WeChat.exe', windowTitle: '与张三的聊天', trigger: 'selection', generation },
      });
      await Promise.resolve();
    });
    await act(async () => {
      (host.querySelector('button[aria-label="智能回复选中文本"]') as HTMLButtonElement).click();
      await vi.advanceTimersByTimeAsync(3000);
    });
  };

  it('accumulates cross-screen context and persists it on disk', async () => {
    await renderApp();

    await replyRound('明天下午三点开会可以吗？', 1);
    expect(globalChatMemory.getHistory(CHAT_KEY).map((m) => m.text)).toEqual(['明天下午三点开会可以吗？']);

    // 滚动聊天窗口后重截：上一轮解析出的对话必须还在，新的一条接在后面
    await replyRound('那改到周四上午十点？', 2);
    expect(globalChatMemory.getHistory(CHAT_KEY).map((m) => m.text)).toEqual([
      '明天下午三点开会可以吗？',
      '那改到周四上午十点？',
    ]);

    // 去抖写盘后，落盘快照里带着累计的聊天记忆
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    const persisted = invoke.mock.calls
      .filter(([command]: [string]) => command === 'save_app_config')
      .map(([, args]: [string, any]) => args?.config?.chatMemory)
      .filter(Boolean);
    expect(persisted.length).toBeGreaterThan(0);
    expect(persisted[persisted.length - 1].sessions[CHAT_KEY]).toHaveLength(2);
  });

  it('keeps different chats apart', async () => {
    await renderApp();
    await replyRound('张三那边的问题', 1);

    await act(async () => {
      eventMocks.listeners.get('runbi://captured-selection')!({
        payload: { text: '李四那边的问题', sourceApp: 'WeChat.exe', windowTitle: '与李四的聊天', trigger: 'selection', generation: 2 },
      });
      await Promise.resolve();
    });
    await act(async () => {
      (host.querySelector('button[aria-label="智能回复选中文本"]') as HTMLButtonElement).click();
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(globalChatMemory.getHistory(CHAT_KEY).map((m) => m.text)).toEqual(['张三那边的问题']);
    expect(globalChatMemory.getHistory('wechat.exe::与李四的聊天').map((m) => m.text)).toEqual(['李四那边的问题']);
  });

  it('clear-memory control drops the accumulated context in memory and on disk', async () => {
    await renderApp();
    await replyRound('明天下午三点开会可以吗？', 1);

    expect(globalChatMemory.getHistory(CHAT_KEY)).toHaveLength(1);
    expect(host.textContent).toContain('已感知聊天上下文');

    const clearButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('清空记忆')) as HTMLButtonElement;
    expect(clearButton).toBeDefined();
    await act(async () => {
      clearButton.click();
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(globalChatMemory.getHistory(CHAT_KEY)).toEqual([]);
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    const persisted = invoke.mock.calls
      .filter(([command]: [string]) => command === 'save_app_config')
      .map(([, args]: [string, any]) => args?.config?.chatMemory)
      .filter(Boolean);
    expect(persisted[persisted.length - 1].sessions[CHAT_KEY]).toBeUndefined();
  });
});
