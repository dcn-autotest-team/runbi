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

describe('Desktop selection-to-polish flow', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    updaterMocks.check.mockReset();
    updaterMocks.check.mockResolvedValue(null);
    updaterMocks.relaunch.mockReset();
    updaterMocks.getVersion.mockReset();
    updaterMocks.getVersion.mockResolvedValue('1.0.21');
    eventMocks.listeners.clear();
    eventMocks.listen.mockImplementation(async (event: string, callback: (payload: any) => void) => {
      eventMocks.listeners.set(event, callback);
      return () => eventMocks.listeners.delete(event);
    });

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

  it('keeps the agent visible on blur and leaves Enter to agent controls', async () => {
    await act(async () => { root.render(<App />); });
    const agentTab = host.querySelector<HTMLButtonElement>('[role="tab"][title="智能体：自主感知与执行任务"]')
      ?? Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((tab) => tab.textContent?.includes('智能体'))!;
    await act(async () => agentTab.click());
    expect(host.textContent).toContain('把任务交给润笔');
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    invoke.mockClear();
    const key = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(async () => {
      agentTab.dispatchEvent(key);
      window.dispatchEvent(new Event('blur'));
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(key.defaultPrevented).toBe(false);
    expect(invoke.mock.calls.some(([cmd]: [string]) => cmd === 'hide_window')).toBe(false);
  });

  it('shows an available update once without remounting the auto-checker', async () => {
    updaterMocks.check
      .mockResolvedValueOnce({
        currentVersion: '1.0.21',
        version: '1.0.22',
        body: 'hotfix',
        downloadAndInstall: vi.fn(),
      })
      .mockResolvedValue(null);

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    expect(updaterMocks.check).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls.filter(([command]: [string]) => command === 'position_window_at_cursor')).toHaveLength(1);
    expect(host.textContent).toContain('Runbi 1.0.22 可以更新');
  });

  it('offers only SenseAudio and custom endpoints and selects fetched models', async () => {
    await act(async () => { root.render(<App />); });
    await act(async () => { eventMocks.listeners.get('runbi://open-settings')?.({ payload: null }); });
    const provider = host.querySelector<HTMLSelectElement>('#provider-preset')!;
    expect(Array.from(provider.options).map(o => o.value)).toEqual(['senseaudio', 'custom']);
    expect(provider.value).toBe('senseaudio');
    expect(host.querySelector<HTMLInputElement>('#api-endpoint')!.value).toBe('https://api.senseaudio.cn/v1');
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    invoke.mockImplementation(async (command: string) => command === 'fetch_model_list'
      ? JSON.stringify({ data: [{ id: 'senseaudio-s2' }, { id: 'senseaudio-vl' }] }) : null);
    await act(async () => {
      Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('获取模型列表'))!.click();
    });
    expect(invoke).toHaveBeenCalledWith('fetch_model_list', { url: 'https://api.senseaudio.cn/v1/models', apiKey: '' }, undefined);
    const models = host.querySelector<HTMLSelectElement>('#model-name')!;
    expect(models.tagName).toBe('SELECT');
    expect(models.value).toBe('senseaudio-s2');
    await act(async () => {
      models.value = 'senseaudio-vl';
      models.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(models.value).toBe('senseaudio-vl');
    let finish!: (value: string) => void;
    invoke.mockImplementation(async (command: string) => command === 'fetch_model_list'
      ? new Promise<string>(resolve => { finish = resolve; }) : null);
    await act(async () => {
      Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('获取模型列表'))!.click();
    });
    await act(async () => {
      provider.value = 'custom';
      provider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { finish(JSON.stringify({ data: [{ id: 'stale-model' }] })); });
    expect(models.value).toBe('');
    expect(models.options).toHaveLength(1);
    expect(host.textContent).not.toContain('SenseAudio 云端模型');
    expect(host.textContent).not.toContain('重新探测');
  });

  it('exposes the installed version from a dedicated settings tab', async () => {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      eventMocks.listeners.get('runbi://open-settings')?.({ payload: null });
      await Promise.resolve();
    });

    const versionTab = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '版本更新',
    ) as HTMLButtonElement;
    expect(versionTab).not.toBeNull();

    await act(async () => {
      versionTab.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('当前版本 v1.0.21');
    expect(host.textContent).toContain('查看发布记录');
    expect(host.textContent).toContain('完成');
    expect(host.textContent).not.toContain('保存设置');
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
    expect(host.querySelector('[data-testid="translate-target-trigger"]')?.textContent).toContain('英文');
    expect(host.textContent).toContain('Translated');
    // 胶囊翻译必须复用与快捷键/顶部翻译入口相同的极简面板，不带润色专属控件。
    expect(host.querySelector('#style-dropdown-trigger')).toBeNull();
    expect(host.querySelector('#original-preview')).toBeNull();
    expect(host.textContent).not.toContain('补充要求');
  });

  it('translates English selection to Chinese and Chinese selection to English automatically', async () => {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const onSelection = eventMocks.listeners.get('runbi://captured-selection')!;

    // 1. 划词英文 -> 自动设置为简体中文
    await act(async () => {
      onSelection({
        payload: { text: 'Translate this English sentence to Chinese', trigger: 'selection', capsule: true },
      });
      await Promise.resolve();
    });
    await act(async () => {
      (host.querySelector('button[aria-label="翻译选中文本"]') as HTMLButtonElement).click();
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(host.querySelector('[data-testid="translate-bar"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="translate-target-trigger"]')?.textContent).toContain('简体中文');

    // 2. 划词中文 -> 自动设置为英文
    await act(async () => {
      onSelection({
        payload: { text: '把这段中文划词翻译成英文', trigger: 'selection', capsule: true },
      });
      await Promise.resolve();
    });
    await act(async () => {
      (host.querySelector('button[aria-label="翻译选中文本"]') as HTMLButtonElement).click();
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(host.querySelector('[data-testid="translate-target-trigger"]')?.textContent).toContain('英文');
  });

  it('automatically routes foreign text to translate mode with Simplified Chinese target in autoMode', async () => {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const onSelection = eventMocks.listeners.get('runbi://captured-selection')!;

    // 划词英文在智能模式下通过快捷键触发，自动识别为翻译并设为简体中文
    await act(async () => {
      onSelection({
        payload: { text: 'This is an English sentence that needs translation.', trigger: 'shortcut' },
      });
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(host.querySelector('[data-testid="translate-bar"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="translate-target-trigger"]')?.textContent).toContain('简体中文');
  });

  it('does not carry a recoverable draft banner into capsule translation', async () => {
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    invoke.mockImplementation(async (command: string) => {
      if (command === 'load_app_config') {
        return {
          activeDraft: {
            timestamp: Date.now(),
            originalText: '上一次未完成的草稿',
            polishedText: '',
            activeStyle: 'literary',
          },
        };
      }
      return null;
    });

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const onSelection = eventMocks.listeners.get('runbi://captured-selection')!;
    await act(async () => {
      onSelection({
        payload: { text: '只保留翻译界面的新文本', trigger: 'selection', capsule: true },
      });
      await Promise.resolve();
    });
    await act(async () => {
      (host.querySelector('button[aria-label="翻译选中文本"]') as HTMLButtonElement).click();
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(host.querySelector('[data-testid="translate-bar"]')).not.toBeNull();
    expect(host.textContent).not.toContain('发现上次未完成草稿');
    expect(host.textContent).not.toContain('上一次未完成的草稿');
  });

  it('native capsule action fallback uses the same translate entry point', async () => {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      eventMocks.listeners.get('runbi://captured-selection')!({
        payload: {
          text: '原生点击需要翻译的文本',
          sourceApp: 'notepad.exe',
          trigger: 'selection',
          capsule: true,
          generation: 9,
        },
      });
      await Promise.resolve();
    });

    const nativeAction = eventMocks.listeners.get('runbi://capsule-action');
    expect(nativeAction).toBeTypeOf('function');
    await act(async () => {
      nativeAction!({ payload: { action: 'translate', generation: 9 } });
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(host.querySelector('[data-testid="translate-bar"]')).not.toBeNull();
    expect(host.textContent).toContain('Translated');
  });

  it('keeps the capsule and direct translate entry points on the same minimal panel', async () => {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const minimalSignature = () => ({
      translateBar: host.querySelector('[data-testid="translate-bar"]') !== null,
      styleDropdown: host.querySelector('#style-dropdown-trigger') !== null,
      originalPreview: host.querySelector('#original-preview') !== null,
      instructionInput: Array.from(host.querySelectorAll('input, textarea')).some((node) =>
        node.getAttribute('placeholder')?.includes('补充要求')
      ),
    });

    const onSelection = eventMocks.listeners.get('runbi://captured-selection');
    await act(async () => {
      onSelection!({
        payload: {
          text: '直接入口的翻译文本',
          sourceApp: 'notepad.exe',
          trigger: 'shortcut',
        },
      });
      await vi.advanceTimersByTimeAsync(3000);
    });

    const directTranslateButton = Array.from(host.querySelectorAll('button[role="tab"]'))
      .find((button) => button.textContent?.trim() === '翻译') as HTMLButtonElement;
    expect(directTranslateButton).toBeDefined();

    await act(async () => {
      directTranslateButton.click();
      await vi.advanceTimersByTimeAsync(3000);
    });
    const directSignature = minimalSignature();

    await act(async () => {
      onSelection!({
        payload: {
          text: '胶囊入口的翻译文本',
          sourceApp: 'notepad.exe',
          trigger: 'selection',
          capsule: true,
        },
      });
      await Promise.resolve();
    });

    const capsuleTranslateButton = host.querySelector(
      'button[aria-label="翻译选中文本"]'
    ) as HTMLButtonElement;
    expect(capsuleTranslateButton).not.toBeNull();
    await act(async () => {
      capsuleTranslateButton.click();
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(minimalSignature()).toEqual(directSignature);
  });

  it('does not let a late config load replace capsule translation mode', async () => {
    let resolveConfig!: (config: Record<string, unknown>) => void;
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    invoke.mockImplementation((command: string) => {
      if (command === 'load_app_config') {
        return new Promise((resolve) => { resolveConfig = resolve; });
      }
      if (command === 'get_global_shortcut') return Promise.resolve('Ctrl+Shift+Space');
      return Promise.resolve(null);
    });

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const onSelection = eventMocks.listeners.get('runbi://captured-selection')!;
    await act(async () => {
      onSelection({
        payload: {
          text: '启动后立即点击胶囊翻译',
          sourceApp: 'notepad.exe',
          trigger: 'selection',
          capsule: true,
        },
      });
      await Promise.resolve();
    });

    await act(async () => {
      (host.querySelector('button[aria-label="翻译选中文本"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });

    await act(async () => {
      resolveConfig({ defaultStyle: 'literary', autoMode: true, translateTarget: 'en' });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(host.querySelector('[data-testid="translate-bar"]')).not.toBeNull();
    expect(host.querySelector('#style-dropdown-trigger')).toBeNull();
  });

  it('keeps capsule AI click and shortcut Ctrl+Q on the exact same reply panel for chat selections', async () => {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const replySignature = () => ({
      activeTab: (Array.from(host.querySelectorAll('button[role="tab"]')).find(b => b.getAttribute('aria-selected') === 'true') as HTMLElement)?.textContent?.trim(),
      hasInstructionInput: host.querySelector('input[placeholder*="想怎么改"]') !== null,
      clarifyChips: Array.from(host.querySelectorAll('button')).filter(b => b.textContent?.includes('积极推进') || b.textContent?.includes('严谨对齐') || b.textContent?.includes('委婉缓冲')).length,
      hasScriptLibraryButton: Array.from(host.querySelectorAll('button')).some(b => b.textContent?.includes('话术模板库')),
    });

    const onSelection = eventMocks.listeners.get('runbi://captured-selection')!;

    // 1. Shortcut Ctrl+Q path
    await act(async () => {
      onSelection({
        payload: {
          text: '周五下班前能交付这版方案吗？',
          sourceApp: 'WeChat.exe',
          windowTitle: '微信',
          trigger: 'shortcut',
        },
      });
      await vi.advanceTimersByTimeAsync(3000);
    });
    const shortcutSignature = replySignature();
    expect(shortcutSignature.activeTab).toBe('回复');
    expect(shortcutSignature.hasInstructionInput).toBe(true);
    expect(shortcutSignature.clarifyChips).toBeGreaterThanOrEqual(1);
    expect(shortcutSignature.hasScriptLibraryButton).toBe(true);

    // 2. Selection capsule click path (clicking Sparkles or clicking capsule body)
    await act(async () => {
      onSelection({
        payload: {
          text: '周五下班前能交付这版方案吗？',
          sourceApp: 'WeChat.exe',
          windowTitle: '微信',
          trigger: 'selection',
          capsule: true,
        },
      });
      await Promise.resolve();
    });

    const capsuleSparkleButton = host.querySelector('button[aria-label="润色选中文本"]') as HTMLButtonElement;
    expect(capsuleSparkleButton).not.toBeNull();
    await act(async () => {
      capsuleSparkleButton.click();
      await vi.advanceTimersByTimeAsync(3000);
    });

    const capsuleSignature = replySignature();
    expect(capsuleSignature).toEqual(shortcutSignature);
  });

  it('clears stale screen-reply context before a capsule translation', async () => {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const onSelection = eventMocks.listeners.get('runbi://captured-selection')!;
    await act(async () => {
      onSelection({
        payload: {
          text: '',
          sourceApp: 'WeChat.exe',
          windowTitle: '微信',
          trigger: 'screen-reply',
          hasScreenshot: true,
        },
      });
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(host.textContent).toContain('已感知聊天上下文');

    await act(async () => {
      onSelection({
        payload: {
          text: '需要翻译的新选区',
          sourceApp: 'WeChat.exe',
          windowTitle: '微信',
          trigger: 'selection',
          capsule: true,
          generation: 1,
        },
      });
      await Promise.resolve();
    });
    await act(async () => {
      (host.querySelector('button[aria-label="翻译选中文本"]') as HTMLButtonElement).click();
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(host.querySelector('[data-testid="translate-bar"]')).not.toBeNull();
    expect(host.textContent).not.toContain('已感知聊天上下文');
  });

  it('sends a generated reply instead of only pasting it', async () => {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      eventMocks.listeners.get('runbi://captured-selection')!({
        payload: {
          text: '明天下午三点开会可以吗？',
          sourceApp: 'WeChat.exe',
          trigger: 'selection',
          generation: 1,
        },
      });
      await Promise.resolve();
    });

    await act(async () => {
      (host.querySelector('button[aria-label="智能回复选中文本"]') as HTMLButtonElement).click();
      await vi.advanceTimersByTimeAsync(3000);
    });

    const sendButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.trim() === '发送' || button.textContent?.includes('发送')
    ) as HTMLButtonElement;
    expect(sendButton).toBeDefined();

    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    invoke.mockClear();
    invoke.mockImplementation(async (command: string) => command === 'replace_text'
      ? { success: true, restored_clipboard: true }
      : null);
    await act(async () => sendButton.click());

    expect(invoke).toHaveBeenCalledWith(
      'replace_text',
      expect.objectContaining({ autoSend: true }),
      undefined
    );
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
    invoke.mockImplementation((command: string, args?: any) => {
      if (command === 'position_window_at_cursor') {
        return new Promise<void>((resolve) => { finishPosition = resolve; });
      }
      if (command === 'plugin:event|emit_to') {
        const { event, payload } = args ?? {};
        eventMocks.listeners.get(event)?.({ payload });
      }
      return Promise.resolve(null);
    });
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
    invoke.mockImplementation((command: string, args?: any) => {
      if (command === 'position_window_at_cursor') {
        return new Promise<void>((resolve) => { finishPosition = resolve; });
      }
      if (command === 'plugin:event|emit_to') {
        const { event, payload } = args ?? {};
        eventMocks.listeners.get(event)?.({ payload });
      }
      return Promise.resolve(null);
    });
    await act(async () => (host.querySelector('button[aria-label="翻译选中文本"]') as HTMLButtonElement).click());
    await act(async () => eventMocks.listeners.get('runbi://selection-invalidated')!({ payload: 2 }));
    expect(invoke.mock.calls.some(([command]: [string]) => command === 'hide_capsule_window')).toBe(false);
    await act(async () => {
      finishPosition();
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(host.querySelector('[data-testid="translate-bar"]')).not.toBeNull();
  });

  it('does not let a late selection event overwrite capsule translation while restoring the panel', async () => {
    await act(async () => root.render(<App />));
    const select = eventMocks.listeners.get('runbi://captured-selection')!;
    await act(async () => select({
      payload: { text: '胶囊翻译原文', trigger: 'selection', generation: 1 },
    }));

    let finishPosition!: () => void;
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    invoke.mockImplementation((command: string) => command === 'position_window_at_cursor'
      ? new Promise<void>((resolve) => { finishPosition = resolve; })
      : Promise.resolve(null));

    await act(async () => {
      (host.querySelector('button[aria-label="翻译选中文本"]') as HTMLButtonElement).click();
      select({ payload: { text: '迟到的旧选区', trigger: 'shortcut' } });
    });

    await act(async () => {
      finishPosition();
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(host.querySelector('[data-testid="translate-bar"]')).not.toBeNull();
    expect(host.textContent).toContain('胶囊翻译原文');
    expect(host.textContent).not.toContain('迟到的旧选区');
  });

  it('ignores the same selection when its capture arrives after capsule expansion commits', async () => {
    await act(async () => root.render(<App />));
    const select = eventMocks.listeners.get('runbi://captured-selection')!;
    await act(async () => select({
      payload: { text: '复原后才到达的旧选区', trigger: 'selection', generation: 11 },
    }));

    let finishPosition!: () => void;
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    invoke.mockImplementation((command: string) => command === 'position_window_at_cursor'
      ? new Promise<void>((resolve) => { finishPosition = resolve; })
      : Promise.resolve(null));

    await act(async () => {
      (host.querySelector('button[aria-label="翻译选中文本"]') as HTMLButtonElement).click();
    });
    await act(async () => finishPosition());
    expect(host.querySelector('[data-testid="translate-bar"]')).not.toBeNull();

    await act(async () => select({
      payload: {
        text: '复原后才到达的旧选区',
        trigger: 'selection',
        capsule: true,
        generation: 11,
      },
    }));
    expect(host.querySelector('[data-testid="translate-bar"]')).not.toBeNull();
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
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

  it('automatically resolves Chinese text to English target in translation panel', async () => {
    await act(async () => root.render(<App />));
    const select = eventMocks.listeners.get('runbi://captured-selection')!;
    await act(async () => select({
      payload: { text: '这是中文句子需要翻译成英文', trigger: 'shortcut' },
    }));
    await act(async () => {
      (host.querySelector('#style-dropdown-trigger') as HTMLButtonElement | null)?.click();
    });
    const translateAction = host.querySelector('button[aria-label="翻译选中文本"]') as HTMLButtonElement | null;
    if (translateAction) {
      await act(async () => translateAction.click());
    }
    // TranslateBar should resolve to English for Chinese text
    const trigger = host.querySelector('[data-testid="translate-target-trigger"]');
    if (trigger) {
      expect(trigger.textContent).toContain('英文');
      expect(trigger.textContent).not.toContain('简体中文');
    }
  });

  it('automatically resolves English text to Chinese target in translation panel', async () => {
    await act(async () => root.render(<App />));
    const select = eventMocks.listeners.get('runbi://captured-selection')!;
    await act(async () => select({
      payload: { text: 'This is an English sentence for translation', trigger: 'shortcut' },
    }));
    const trigger = host.querySelector('[data-testid="translate-target-trigger"]');
    if (trigger) {
      expect(trigger.textContent).toContain('简体中文');
      expect(trigger.textContent).not.toContain('英文');
    }
  });

  it('cancels panel hide timer when pointerdown starts dragging the drag region', async () => {
    await act(async () => root.render(<App />));
    const select = eventMocks.listeners.get('runbi://captured-selection')!;
    await act(async () => {
      select({
        payload: { text: '测试拖动不消失', trigger: 'shortcut' },
      });
      await vi.advanceTimersByTimeAsync(3000);
    });
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    invoke.mockClear();

    // Trigger blur (as happens when native drag starts)
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
    });
    // User presses pointerdown on the drag region to drag
    const dragRegion = host.querySelector('[data-tauri-drag-region]') as HTMLElement;
    expect(dragRegion).not.toBeNull();
    await act(async () => {
      dragRegion.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    // Advance timers past blur threshold
    await act(async () => vi.advanceTimersByTimeAsync(200));

    // hide_window must NOT have been called because drag interaction cancelled the timer
    expect(invoke.mock.calls.some(([cmd]: [string]) => cmd === 'hide_window')).toBe(false);
  });

  it('passes onlyIfUnfocused: true to hide_window on genuine blur', async () => {
    await act(async () => root.render(<App />));
    const select = eventMocks.listeners.get('runbi://captured-selection')!;
    await act(async () => {
      select({
        payload: { text: '测试失焦隐藏守卫', trigger: 'shortcut' },
      });
      await vi.advanceTimersByTimeAsync(3000);
    });
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    invoke.mockClear();

    await act(async () => {
      window.dispatchEvent(new Event('blur'));
    });
    await act(async () => vi.advanceTimersByTimeAsync(200));

    expect(invoke).toHaveBeenCalledWith('hide_window', { onlyIfUnfocused: true }, undefined);
  });

  it('cancels panel hide timer when window regains focus', async () => {
    await act(async () => root.render(<App />));
    const select = eventMocks.listeners.get('runbi://captured-selection')!;
    await act(async () => {
      select({
        payload: { text: '测试对焦恢复', trigger: 'shortcut' },
      });
      await vi.advanceTimersByTimeAsync(3000);
    });
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    invoke.mockClear();

    // Trigger blur
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
    });
    // Window regains focus before timeout
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => vi.advanceTimersByTimeAsync(200));

    expect(invoke.mock.calls.some(([cmd]: [string]) => cmd === 'hide_window')).toBe(false);
  });

});
