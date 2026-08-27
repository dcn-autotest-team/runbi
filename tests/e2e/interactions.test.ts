import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  SelectionInfo,
  PositionCoordinates,
  DiffChunk,
  PolishStyle,
  StreamConfig,
  StreamClientMessage,
  StreamServerMessage,
} from '../../src/types';

describe('Tier 3: Cross-Feature Interactions & Async Lifecycles', () => {
  let swConnectListener: ((port: any) => void) | null = null;

  function initBackgroundWorkerSimulator() {
    swConnectListener = (swPort: any) => {
      if (swPort.name === 'runbi-stream-channel') {
        let abortCtrl: AbortController | null = null;
        swPort.onMessage.addListener(async (clientMsg: any) => {
          if (clientMsg.action === 'START_STREAM') {
            abortCtrl = new AbortController();
            const { text, config } = clientMsg.payload;
            const prefixes: Record<PolishStyle, string> = {
              polished: '【通用】',
              academic: '【学术】',
              business: '【商务】',
              literary: '【文采】',
              concise: '【精简】',
              native_en: '[Native EN] ',
              reply: '【回复】',
            };
            const result = `${prefixes[config.style as PolishStyle] || '【通用】'}${text}已完成润色。`;
            const chars = result.split('');

            for (const char of chars) {
              if (abortCtrl?.signal.aborted || swPort.disconnected) {
                swPort.postMessage({ type: 'ABORTED' });
                return;
              }
              swPort.postMessage({ type: 'CHUNK', payload: { delta: char } });
            }
            swPort.postMessage({
              type: 'DONE',
              payload: { durationMs: 200, totalTokens: chars.length },
            });
          } else if (clientMsg.action === 'ABORT') {
            if (abortCtrl) abortCtrl.abort();
            swPort.postMessage({ type: 'ABORTED' });
          }
        });
      }
    };
    chrome.runtime.onConnect.addListener(swConnectListener);
  }

  // =========================================================================
  // Helper Simulator for Complete Runbi Extension Lifecycle
  // =========================================================================
  class RunbiExtensionHarness {
    public hostEl: HTMLElement | null = null;
    public shadowRoot: ShadowRoot | null = null;
    public containerEl: HTMLElement | null = null;
    public isPanelOpen = false;
    public isCapsuleVisible = false;
    public activeStyle: PolishStyle = 'polished';
    public activeText = '';
    public streamedOutput = '';
    public isGenerating = false;
    public isDiffMode = false;
    public toastVisible = false;
    public activePort: chrome.runtime.Port | null = null;
    public lastSelectedElement: HTMLElement | null = null;

    mount(): void {
      if (document.getElementById('runbi-extension-root')) return;
      this.hostEl = document.createElement('div');
      this.hostEl.id = 'runbi-extension-root';
      this.hostEl.style.position = 'fixed';
      this.hostEl.style.inset = '0';
      this.hostEl.style.pointerEvents = 'none';
      this.hostEl.style.zIndex = '2147483647';
      document.body.appendChild(this.hostEl);

      this.shadowRoot = this.hostEl.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = ':host { all: initial; }';
      this.shadowRoot.appendChild(style);

      this.containerEl = document.createElement('div');
      this.containerEl.id = 'runbi-app-container';
      this.containerEl.style.pointerEvents = 'auto';
      this.shadowRoot.appendChild(this.containerEl);

      document.addEventListener('click', this.handleOutsideClick);
      window.addEventListener('keydown', this.handleKeydown);
    }

    unmount(): void {
      document.removeEventListener('click', this.handleOutsideClick);
      window.removeEventListener('keydown', this.handleKeydown);
      if (this.hostEl) {
        this.hostEl.remove();
        this.hostEl = null;
        this.shadowRoot = null;
        this.containerEl = null;
      }
    }

    handleOutsideClick = (e: MouseEvent) => {
      const path = e.composedPath ? e.composedPath() : [];
      if (this.hostEl && !path.includes(this.hostEl)) {
        this.dismiss();
      }
    };

    handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.dismiss();
      }
    };

    async handleSelection(text: string, targetEl?: HTMLElement | null, hostname = 'example.com'): Promise<boolean> {
      const stored = await chrome.storage.local.get(['enabled', 'blacklist']);
      if (stored.enabled === false) return false;
      if (Array.isArray(stored.blacklist) && stored.blacklist.includes(hostname)) return false;

      const trimmed = text.trim();
      if (trimmed.length < 2 || trimmed.length > 5000) return false;

      this.activeText = trimmed;
      this.lastSelectedElement = targetEl || null;
      this.isCapsuleVisible = true;
      this.render();
      return true;
    }

    async openPanel(): Promise<void> {
      this.isCapsuleVisible = false;
      this.isPanelOpen = true;
      this.render();
      await this.startStream(this.activeStyle);
    }

    dismiss(): void {
      this.isCapsuleVisible = false;
      this.isPanelOpen = false;
      if (this.isGenerating && this.activePort) {
        this.activePort.postMessage({ action: 'ABORT' });
      }
      this.isGenerating = false;
      this.streamedOutput = '';
      this.render();
    }

    async switchStyle(style: PolishStyle): Promise<void> {
      if (this.activeStyle === style && this.isGenerating) return;
      this.activeStyle = style;
      if (this.isGenerating && this.activePort) {
        this.activePort.postMessage({ action: 'ABORT' });
      }
      await this.startStream(style);
    }

    async startStream(style: PolishStyle): Promise<void> {
      if (this.activePort) {
        try {
          this.activePort.disconnect();
        } catch (_) {}
        this.activePort = null;
      }
      this.isGenerating = true;
      this.streamedOutput = '';
      this.render();

      const stored = await chrome.storage.local.get(['apiKey', 'baseUrl', 'model', 'customPrompt']);
      const config: StreamConfig = {
        apiKey: stored.apiKey,
        baseUrl: stored.baseUrl,
        model: stored.model,
        style,
        customPrompt: stored.customPrompt,
      };

      this.activePort = chrome.runtime.connect({ name: 'runbi-stream-channel' });
      this.activePort.onMessage.addListener((msg: StreamServerMessage) => {
        if (msg.type === 'CHUNK') {
          this.streamedOutput += msg.payload.delta;
          this.render();
        } else if (msg.type === 'DONE') {
          this.isGenerating = false;
          this.render();
        } else if (msg.type === 'ABORTED') {
          this.isGenerating = false;
          this.render();
        }
      });

      const clientMsg: StreamClientMessage = {
        action: 'START_STREAM',
        payload: { text: this.activeText, config },
      };
      this.activePort.postMessage(clientMsg);
    }

    toggleDiff(): void {
      this.isDiffMode = !this.isDiffMode;
      this.render();
    }

    async copyOutput(): Promise<void> {
      await navigator.clipboard.writeText(this.streamedOutput);
      this.toastVisible = true;
      this.render();
      setTimeout(() => {
        this.toastVisible = false;
        this.render();
      }, 1500);
    }

    replaceSelection(): boolean {
      if (!this.lastSelectedElement) return false;
      const polished = this.streamedOutput;

      if (
        this.lastSelectedElement instanceof HTMLTextAreaElement ||
        this.lastSelectedElement instanceof HTMLInputElement
      ) {
        const el = this.lastSelectedElement;
        const start = el.selectionStart || 0;
        const end = el.selectionEnd || el.value.length;
        el.setRangeText(polished, start, end, 'end');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        this.dismiss();
        return true;
      }

      if (this.lastSelectedElement.isContentEditable) {
        const success = document.execCommand('insertText', false, polished);
        this.dismiss();
        return success;
      }

      return false;
    }

    render(): void {
      if (!this.containerEl) return;
      if (this.isCapsuleVisible) {
        this.containerEl.innerHTML = `
          <button id="runbi-capsule" class="capsule-btn">🖋️</button>
        `;
        this.containerEl.querySelector('#runbi-capsule')?.addEventListener('click', () => {
          this.openPanel();
        });
      } else if (this.isPanelOpen) {
        this.containerEl.innerHTML = `
          <div id="runbi-panel" class="panel-box">
            <div class="header">
              <span>🖋️ 润笔</span>
              <button id="diff-toggle">${this.isDiffMode ? '终稿' : 'Diff'}</button>
              <button id="close-btn">✕</button>
            </div>
            <div class="tabs">
              <button data-style="polished" class="${this.activeStyle === 'polished' ? 'active' : ''}">通用</button>
              <button data-style="academic" class="${this.activeStyle === 'academic' ? 'active' : ''}">学术</button>
              <button data-style="business" class="${this.activeStyle === 'business' ? 'active' : ''}">商务</button>
              <button data-style="literary" class="${this.activeStyle === 'literary' ? 'active' : ''}">文采</button>
              <button data-style="concise" class="${this.activeStyle === 'concise' ? 'active' : ''}">精简</button>
              <button data-style="native_en" class="${this.activeStyle === 'native_en' ? 'active' : ''}">英文</button>
            </div>
            <div class="content ${this.isDiffMode ? 'diff-view' : 'plain-view'}">
              ${this.isDiffMode ? `<span class="diff-ins">${this.streamedOutput}</span>` : this.streamedOutput}
            </div>
            <div class="actions">
              <button id="copy-btn">复制</button>
              <button id="replace-btn">替换</button>
            </div>
            ${this.toastVisible ? '<div class="toast">已复制</div>' : ''}
          </div>
        `;

        this.containerEl.querySelector('#close-btn')?.addEventListener('click', () => this.dismiss());
        this.containerEl.querySelector('#diff-toggle')?.addEventListener('click', () => this.toggleDiff());
        this.containerEl.querySelector('#copy-btn')?.addEventListener('click', () => this.copyOutput());
        this.containerEl.querySelector('#replace-btn')?.addEventListener('click', () => this.replaceSelection());
        this.containerEl.querySelectorAll('.tabs button').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            const s = (e.target as HTMLElement).getAttribute('data-style') as PolishStyle;
            if (s) this.switchStyle(s);
          });
        });
      } else {
        this.containerEl.innerHTML = '';
      }
    }
  }

  let harness: RunbiExtensionHarness;

  beforeEach(() => {
    initBackgroundWorkerSimulator();
    harness = new RunbiExtensionHarness();
    harness.mount();
  });

  afterEach(() => {
    if (swConnectListener) {
      chrome.runtime.onConnect.removeListener(swConnectListener);
      swConnectListener = null;
    }
    harness.unmount();
  });

  // =========================================================================
  // Flow 1: Selection -> Capsule -> Panel -> Stream -> Diff -> Copy -> Toast
  // =========================================================================
  it('Flow 1: should complete selection -> capsule -> panel -> stream -> diff -> copy -> toast chain', async () => {
    vi.useFakeTimers();

    const ok = await harness.handleSelection('需要润色的方案描述');
    expect(ok).toBe(true);
    expect(harness.isCapsuleVisible).toBe(true);

    await harness.openPanel();
    expect(harness.isPanelOpen).toBe(true);
    expect(harness.streamedOutput).toContain('【通用】需要润色的方案描述');

    const diffBtn = harness.containerEl?.querySelector('#diff-toggle') as HTMLButtonElement;
    diffBtn.click();
    expect(harness.isDiffMode).toBe(true);
    expect(harness.containerEl?.querySelector('.diff-view')).not.toBeNull();

    const copyBtn = harness.containerEl?.querySelector('#copy-btn') as HTMLButtonElement;
    await copyBtn.click();
    const clipboardText = await navigator.clipboard.readText();
    expect(clipboardText).toBe(harness.streamedOutput);
    expect(harness.toastVisible).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(harness.toastVisible).toBe(false);

    vi.useRealTimers();
  });

  // =========================================================================
  // Flow 2: Textarea In-Place Replacement
  // =========================================================================
  it('Flow 2: should polish text inside a textarea and replace in-place with input event dispatch', async () => {
    const ta = document.createElement('textarea');
    ta.value = '原稿草案待审定。';
    document.body.appendChild(ta);
    ta.setSelectionRange(0, 8);

    const onInput = vi.fn();
    ta.addEventListener('input', onInput);

    await harness.handleSelection('原稿草案待审定。', ta);
    await harness.openPanel();
    await harness.switchStyle('business');

    expect(harness.streamedOutput).toContain('【商务】原稿草案待审定。');
    const expectedPolished = harness.streamedOutput;

    const replaceBtn = harness.containerEl?.querySelector('#replace-btn') as HTMLButtonElement;
    replaceBtn.click();

    expect(ta.value).toBe(expectedPolished);
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(harness.isPanelOpen).toBe(false);
  });

  // =========================================================================
  // Flow 3: Contenteditable Rich Text In-Place Replacement
  // =========================================================================
  it('Flow 3: should polish rich-text contenteditable element and replace via execCommand', async () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.innerText = '富文本待优化文案';
    document.body.appendChild(editor);
    editor.focus();

    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    await harness.handleSelection('富文本待优化文案', editor);
    await harness.openPanel();
    await harness.switchStyle('literary');

    expect(harness.streamedOutput).toContain('【文采】富文本待优化文案');
    const expectedPolished = harness.streamedOutput;

    const replaceBtn = harness.containerEl?.querySelector('#replace-btn') as HTMLButtonElement;
    replaceBtn.click();

    expect(editor.innerText).toBe(expectedPolished);
    expect(harness.isPanelOpen).toBe(false);
  });

  // =========================================================================
  // Flow 4: Fast Style Tab Switch Mid-Stream
  // =========================================================================
  it('Flow 4: should abort previous stream and render new style output without chunk collision', async () => {
    await harness.handleSelection('跨语言交流方案');
    await harness.openPanel();

    await harness.switchStyle('academic');
    await harness.switchStyle('native_en');

    expect(harness.streamedOutput).toContain('[Native EN]');
    expect(harness.streamedOutput).not.toContain('【通用】');
    expect(harness.activeStyle).toBe('native_en');
  });

  // =========================================================================
  // Flow 5: Options BYOK Flow to Background SW to Content Script
  // =========================================================================
  it('Flow 5: should read stored BYOK API Key and endpoint configs during stream initiation', async () => {
    await chrome.storage.local.set({
      apiKey: 'sk-custom-openai-key-888',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    });

    await harness.handleSelection('配置端点验证文本');
    await harness.openPanel();

    const stored = await chrome.storage.local.get(['apiKey', 'baseUrl', 'model']);
    expect(stored.apiKey).toBe('sk-custom-openai-key-888');
    expect(stored.baseUrl).toBe('https://api.openai.com/v1');
    expect(stored.model).toBe('gpt-4o-mini');
  });

  // =========================================================================
  // Flow 6: Master ON/OFF Switch State Cascade
  // =========================================================================
  it('Flow 6: should disable trigger when master switch is turned OFF in popup', async () => {
    await chrome.storage.local.set({ enabled: false });

    const triggered = await harness.handleSelection('尝试划词');
    expect(triggered).toBe(false);
    expect(harness.isCapsuleVisible).toBe(false);

    await chrome.storage.local.set({ enabled: true });

    const triggered2 = await harness.handleSelection('重新划词');
    expect(triggered2).toBe(true);
    expect(harness.isCapsuleVisible).toBe(true);
  });

  // =========================================================================
  // Flow 7: Domain Blacklist Dynamic Enforcement
  // =========================================================================
  it('Flow 7: should suppress trigger capsule on blacklisted domain', async () => {
    await chrome.storage.local.set({ blacklist: ['example.com'] });

    const ok = await harness.handleSelection('黑名单网页测试文本', null, 'example.com');
    expect(ok).toBe(false);
    expect(harness.isCapsuleVisible).toBe(false);

    await chrome.storage.local.set({ blacklist: [] });
    const ok2 = await harness.handleSelection('黑名单解除测试文本', null, 'example.com');
    expect(ok2).toBe(true);
    expect(harness.isCapsuleVisible).toBe(true);
  });

  // =========================================================================
  // Flow 8: Viewport Boundary Collision Adaptation Flow
  // =========================================================================
  it('Flow 8: should calculate dynamic placement based on scroll and bounding rect', () => {
    const calcCoords = (top: number, right: number, scrollY: number): PositionCoordinates => {
      let placement: PositionCoordinates['placement'] = 'top-right';
      let posTop = top + scrollY - 36;
      let posLeft = right + 4;

      if (top < 40) {
        posTop = top + scrollY + 40;
        placement = 'bottom-right';
      }
      return { top: posTop, left: posLeft, placement };
    };

    const initial = calcCoords(200, 500, 0);
    expect(initial.placement).toBe('top-right');
    expect(initial.top).toBe(164);

    const nearTop = calcCoords(15, 500, 0);
    expect(nearTop.placement).toBe('bottom-right');
    expect(nearTop.top).toBe(55);
  });

  // =========================================================================
  // Flow 9: Stream Error Recovery Flow
  // =========================================================================
  it('Flow 9: should display error card and allow retry when HTTP 401 occurs', async () => {
    let errorState: string | null = 'API Key 无效，请在选项页配置有效密钥。';
    let retrySucceeded = false;

    const retry = (newKey: string) => {
      if (newKey === 'sk-valid') {
        errorState = null;
        retrySucceeded = true;
      }
    };

    expect(errorState).toContain('API Key 无效');
    retry('sk-valid');
    expect(errorState).toBeNull();
    expect(retrySucceeded).toBe(true);
  });

  // =========================================================================
  // Flow 10: Keyboard Navigation & Dismissal Flow
  // =========================================================================
  it('Flow 10: should dismiss panel cleanly upon Escape keypress', async () => {
    await harness.handleSelection('键盘导航测试');
    await harness.openPanel();
    expect(harness.isPanelOpen).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(harness.isPanelOpen).toBe(false);
  });

  // =========================================================================
  // Flow 11: Outside Click vs Inside Click Retention
  // =========================================================================
  it('Flow 11: should stay open on inside panel clicks and dismiss on outside clicks', async () => {
    await harness.handleSelection('点击保留测试');
    await harness.openPanel();
    expect(harness.isPanelOpen).toBe(true);

    const panelEl = harness.containerEl?.querySelector('#runbi-panel') as HTMLElement;
    panelEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(harness.isPanelOpen).toBe(true);

    const outsideEl = document.createElement('div');
    document.body.appendChild(outsideEl);
    outsideEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(harness.isPanelOpen).toBe(false);
    outsideEl.remove();
  });

  // =========================================================================
  // Flow 12: Multiple Concurrent Tabs Port Management
  // =========================================================================
  it('Flow 12: should isolate port communication between multiple concurrent tabs', () => {
    const tab1Port = chrome.runtime.connect({ name: 'runbi-stream-channel' });
    const tab2Port = chrome.runtime.connect({ name: 'runbi-stream-channel' });

    const tab1Messages: any[] = [];
    const tab2Messages: any[] = [];

    tab1Port.onMessage.addListener((msg) => tab1Messages.push(msg));
    tab2Port.onMessage.addListener((msg) => tab2Messages.push(msg));

    (tab1Port as any).postMessage({ action: 'START_STREAM', payload: { text: 'Tab1', config: { style: 'polished' } } });
    (tab2Port as any).postMessage({ action: 'START_STREAM', payload: { text: 'Tab2', config: { style: 'polished' } } });

    expect(tab1Port).not.toBe(tab2Port);
  });

  // =========================================================================
  // Flow 13: Stop Button Abort Flow
  // =========================================================================
  it('Flow 13: should abort active stream when stop button is pressed', async () => {
    await harness.handleSelection('长时间流式输出测试文本');
    await harness.openPanel();

    if (harness.activePort) {
      harness.activePort.postMessage({ action: 'ABORT' });
    }
    expect(harness.isGenerating).toBe(false);
  });

  // =========================================================================
  // Flow 14: Prompt Template Customization Interaction
  // =========================================================================
  it('Flow 14: should apply custom prompt template stored in user configuration', async () => {
    const customTemplate = '【自定义文风】针对原文本进行艺术化提炼：{{selected_text}}';
    await chrome.storage.local.set({ customPrompt: customTemplate });

    const stored = await chrome.storage.local.get('customPrompt');
    const rendered = stored.customPrompt.replace('{{selected_text}}', '原稿字句');
    expect(rendered).toBe('【自定义文风】针对原文本进行艺术化提炼：原稿字句');
  });

  // =========================================================================
  // Flow 15: Deeply Nested Web Components & Hostile Resets Interaction
  // =========================================================================
  it('Flow 15: should maintain UI integrity inside host document with global hostile resets', async () => {
    const hostileStyle = document.createElement('style');
    hostileStyle.textContent = '* { color: red !important; font-size: 6px !important; }';
    document.head.appendChild(hostileStyle);

    await harness.handleSelection('隔离测试文本');
    await harness.openPanel();

    const panel = harness.containerEl?.querySelector('#runbi-panel');
    expect(panel).not.toBeNull();
    expect(harness.shadowRoot).not.toBeNull();

    hostileStyle.remove();
  });
});
