/**
 * Comprehensive Unit Tests for Runbi UI Components & Shadow DOM
 * Milestone 3 (M3)
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TriggerCapsule,
  PolishPanel,
  StyleTabs,
  StreamingView,
  DiffViewer,
  ActionBar,
  Toast,
  InstructionInput,
} from '../../src/components';
import {
  initShadowRoot,
  destroyShadowRoot,
  getShadowHost,
  getShadowRoot,
  getAppContainer,
} from '../../src/content/shadowRoot';
import { mountRunbi, unmountRunbi } from '../../src/content/index';
import { App } from '../../src/content/App';
import type { PolishStyle } from '../../src/types/stream';

describe('Milestone 3: UI Components & Shadow DOM Integration', () => {
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
    destroyShadowRoot();
  });

  // Helper to render React element
  async function renderElement(element: React.ReactElement): Promise<void> {
    await act(async () => {
      if (!root) {
        root = ReactDOM.createRoot(container);
      }
      root.render(element);
    });
  }

  // =========================================================================
  // 1. TriggerCapsule Tests
  // =========================================================================
  describe('TriggerCapsule Component', () => {
    it('should render 28px capsule at specified coordinates with jade styling', async () => {
      const handleClick = vi.fn();
      await renderElement(
        <TriggerCapsule top={120} left={250} onClick={handleClick} />
      );

      const capsule = container.querySelector('#runbi-trigger-capsule') as HTMLButtonElement;
      expect(capsule).not.toBeNull();
      expect(capsule.style.top).toBe('120px');
      expect(capsule.style.left).toBe('250px');
      expect(capsule.className).toContain('w-7');
      expect(capsule.className).toContain('h-7');
      expect(capsule.className).toContain('bg-[#00BFA5]');
      expect(capsule.querySelector('svg')).not.toBeNull();
    });

    it('should trigger onClick when capsule button is clicked', async () => {
      const handleClick = vi.fn();
      await renderElement(
        <TriggerCapsule top={50} left={100} onClick={handleClick} />
      );

      const capsule = container.querySelector('#runbi-trigger-capsule') as HTMLButtonElement;
      await act(async () => {
        capsule.click();
      });
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 2. StyleTabs Tests
  // =========================================================================
  describe('StyleTabs Component', () => {
    it('should render all 7 preset style options with active indicator', async () => {
      const handleStyleChange = vi.fn();
      await renderElement(
        <StyleTabs activeStyle="polished" onStyleChange={handleStyleChange} />
      );

      const tabs = container.querySelectorAll('[role="tab"]');
      expect(tabs.length).toBe(7);

      const activeTab = container.querySelector('[aria-selected="true"]');
      expect(activeTab).not.toBeNull();
      expect(activeTab?.getAttribute('data-style')).toBe('polished');
    });

    it('should trigger onStyleChange when another style tab is clicked', async () => {
      const handleStyleChange = vi.fn();
      await renderElement(
        <StyleTabs activeStyle="polished" onStyleChange={handleStyleChange} />
      );

      const academicTab = container.querySelector('[data-style="academic"]') as HTMLButtonElement;
      expect(academicTab).not.toBeNull();

      await act(async () => {
        academicTab.click();
      });
      expect(handleStyleChange).toHaveBeenCalledWith('academic');
    });

    it('should respect disabled prop when isGenerating', async () => {
      const handleStyleChange = vi.fn();
      await renderElement(
        <StyleTabs activeStyle="polished" onStyleChange={handleStyleChange} disabled={true} />
      );

      const buttons = container.querySelectorAll('button');
      buttons.forEach((btn) => {
        expect(btn.disabled).toBe(true);
      });
    });
  });

  // =========================================================================
  // InstructionInput Component Tests
  // =========================================================================
  describe('InstructionInput Component', () => {
    it('should render input field, quick chips, and send button', async () => {
      const handleSubmit = vi.fn();
      await renderElement(
        <InstructionInput onSubmit={handleSubmit} />
      );

      const input = container.querySelector('#runbi-instruction-input') as HTMLInputElement;
      const sendBtn = container.querySelector('#runbi-instruction-send') as HTMLButtonElement;
      expect(input).not.toBeNull();
      expect(sendBtn).not.toBeNull();
      expect(sendBtn.disabled).toBe(true);
    });

    it('should submit instruction when quick chip is clicked', async () => {
      const handleSubmit = vi.fn();
      await renderElement(
        <InstructionInput onSubmit={handleSubmit} />
      );

      const chipBtn = container.querySelector('button[title*="赞同该观点"]') as HTMLButtonElement;
      expect(chipBtn).not.toBeNull();

      await act(async () => {
        chipBtn.click();
      });

      expect(handleSubmit).toHaveBeenCalledWith('赞同该观点，并补充细节与论据');
    });

    it('should submit typed instruction on enter keypress', async () => {
      const handleSubmit = vi.fn();
      await renderElement(
        <InstructionInput onSubmit={handleSubmit} />
      );

      const input = container.querySelector('#runbi-instruction-input') as HTMLInputElement;

      await act(async () => {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        nativeInputValueSetter?.call(input, '请帮我写一段幽默回复');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });

      expect(handleSubmit).toHaveBeenCalledWith('请帮我写一段幽默回复');
    });
  });

  // =========================================================================
  // 3. StreamingView Tests
  // =========================================================================
  describe('StreamingView Component', () => {
    it('should display streaming content, cursor blink, and elapsed time / token stats', async () => {
      await renderElement(
        <StreamingView
          content="正在流式输出的文本内容..."
          isGenerating={true}
          durationMs={800}
          totalTokens={42}
        />
      );

      expect(container.textContent).toContain('正在流式输出的文本内容...');
      expect(container.textContent).toContain('0.8s'); // 800ms -> 0.8s
      expect(container.textContent).toContain('42 Tokens');
      expect(container.querySelector('.animate-cursor-blink')).not.toBeNull();
    });

    it('should render placeholder when content is empty and generating', async () => {
      await renderElement(
        <StreamingView
          content=""
          isGenerating={true}
        />
      );

      expect(container.textContent).toContain('润笔沉思中');
    });

    it('should render stop button during generation and trigger onStop', async () => {
      const handleStop = vi.fn();
      await renderElement(
        <StreamingView
          content="部分输出"
          isGenerating={true}
          onStop={handleStop}
        />
      );

      const stopBtn = container.querySelector('button');
      expect(stopBtn).not.toBeNull();
      expect(stopBtn?.textContent).toContain('中止生成');

      await act(async () => {
        stopBtn?.click();
      });
      expect(handleStop).toHaveBeenCalledTimes(1);
    });

    it('should render error alert when error prop is provided', async () => {
      await renderElement(
        <StreamingView
          content=""
          isGenerating={false}
          error="API 密钥未配置"
        />
      );

      expect(container.textContent).toContain('API 密钥未配置');
    });
  });

  // =========================================================================
  // 4. DiffViewer Tests
  // =========================================================================
  describe('DiffViewer Component', () => {
    it('should compute and highlight deletions and insertions using Myers diff', async () => {
      const original = '该方案还行，但是细节不太到位。';
      const polished = '该方案完备，但在执行细节上有优化空间。';

      await renderElement(
        <DiffViewer originalText={original} polishedText={polished} />
      );

      const diffContent = container.querySelector('#runbi-diff-content');
      expect(diffContent).not.toBeNull();

      const deletes = container.querySelectorAll('[data-diff-type="delete"]');
      const inserts = container.querySelectorAll('[data-diff-type="insert"]');
      const equals = container.querySelectorAll('[data-diff-type="equal"]');

      expect(deletes.length).toBeGreaterThan(0);
      expect(inserts.length).toBeGreaterThan(0);
      expect(equals.length).toBeGreaterThan(0);

      // Verify deletion class styling
      expect(deletes[0].className).toContain('line-through');
      expect(deletes[0].className).toContain('bg-red-100');

      // Verify insertion class styling
      expect(inserts[0].className).toContain('underline');
      expect(inserts[0].className).toContain('bg-emerald-100');
    });
  });

  // =========================================================================
  // 5. Toast Tests
  // =========================================================================
  describe('Toast Component', () => {
    it('should render when visible is true and hide when false', async () => {
      await renderElement(<Toast message="测试提示" visible={true} />);
      expect(container.querySelector('#runbi-toast')).not.toBeNull();
      expect(container.textContent).toContain('测试提示');

      await renderElement(<Toast message="测试提示" visible={false} />);
      expect(container.querySelector('#runbi-toast')).toBeNull();
    });

    it('should invoke onDismiss after specified duration', async () => {
      vi.useFakeTimers();
      const handleDismiss = vi.fn();

      await renderElement(
        <Toast message="已复制" visible={true} durationMs={1500} onDismiss={handleDismiss} />
      );

      expect(handleDismiss).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(handleDismiss).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  // =========================================================================
  // 6. ActionBar Tests
  // =========================================================================
  describe('ActionBar Component', () => {
    it('should handle regenerate, copy, and replace button interactions', async () => {
      const handleRegenerate = vi.fn();
      const handleCopy = vi.fn();
      const handleReplace = vi.fn();

      await renderElement(
        <ActionBar
          onRegenerate={handleRegenerate}
          onCopy={handleCopy}
          onReplace={handleReplace}
          isEditable={true}
          isGenerating={false}
        />
      );

      const regenBtn = container.querySelector('#runbi-action-regenerate') as HTMLButtonElement;
      const copyBtn = container.querySelector('#runbi-action-copy') as HTMLButtonElement;
      const replaceBtn = container.querySelector('#runbi-action-replace') as HTMLButtonElement;

      expect(regenBtn).not.toBeNull();
      expect(copyBtn).not.toBeNull();
      expect(replaceBtn).not.toBeNull();
      expect(replaceBtn.disabled).toBe(false);

      await act(async () => {
        regenBtn.click();
        copyBtn.click();
        replaceBtn.click();
      });

      expect(handleRegenerate).toHaveBeenCalledTimes(1);
      expect(handleCopy).toHaveBeenCalledTimes(1);
      expect(handleReplace).toHaveBeenCalledTimes(1);
    });

    it('should disable replace button when isEditable is false', async () => {
      const handleReplace = vi.fn();
      await renderElement(
        <ActionBar
          onRegenerate={vi.fn()}
          onCopy={vi.fn()}
          onReplace={handleReplace}
          isEditable={false}
          isGenerating={false}
        />
      );

      const replaceBtn = container.querySelector('#runbi-action-replace') as HTMLButtonElement;
      expect(replaceBtn.disabled).toBe(true);
      expect(replaceBtn.className).toContain('cursor-not-allowed');

      await act(async () => {
        replaceBtn.click();
      });
      expect(handleReplace).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 7. PolishPanel Full Modal Tests
  // =========================================================================
  describe('PolishPanel Component', () => {
    it('should render header, model badge, diff toggle, style tabs, content, and action bar', async () => {
      const handleToggleDiff = vi.fn();
      const handleClose = vi.fn();
      const handleStyleChange = vi.fn();

      await renderElement(
        <PolishPanel
          top={100}
          left={150}
          originalText="原文本内容"
          polishedText="已润色的文本内容"
          isGenerating={false}
          activeStyle="polished"
          isDiffMode={false}
          isEditable={true}
          durationMs={650}
          totalTokens={30}
          modelName="DeepSeek-V3"
          onClose={handleClose}
          onStyleChange={handleStyleChange}
          onToggleDiff={handleToggleDiff}
          onStop={vi.fn()}
          onRegenerate={vi.fn()}
          onCopy={vi.fn()}
          onReplace={vi.fn()}
        />
      );

      const panel = container.querySelector('#runbi-panel') as HTMLElement;
      expect(panel).not.toBeNull();
      expect(panel.style.top).toBe('100px');
      expect(panel.style.left).toBe('150px');
      expect(panel.textContent).toContain('润笔');
      expect(panel.textContent).toContain('DeepSeek-V3');
      expect(panel.textContent).toContain('已润色的文本内容');

      // Test Diff switch click
      const diffToggle = container.querySelector('#diff-toggle') as HTMLButtonElement;
      await act(async () => {
        diffToggle.click();
      });
      expect(handleToggleDiff).toHaveBeenCalledTimes(1);

      // Test Close button click
      const closeBtn = container.querySelector('#close-btn') as HTMLButtonElement;
      await act(async () => {
        closeBtn.click();
      });
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('should render DiffViewer when isDiffMode is true', async () => {
      await renderElement(
        <PolishPanel
          top={100}
          left={150}
          originalText="原文本"
          polishedText="润色后文本"
          isGenerating={false}
          activeStyle="polished"
          isDiffMode={true}
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

      expect(container.querySelector('#runbi-diff-content')).not.toBeNull();
    });

    it('should collapse and expand body when collapse button is clicked', async () => {
      await renderElement(
        <PolishPanel
          top={100}
          left={150}
          originalText="原文本"
          polishedText="润色后文本"
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

      expect(container.querySelector('.content')).not.toBeNull();

      const collapseBtn = container.querySelector('#collapse-btn') as HTMLButtonElement;
      await act(async () => {
        collapseBtn.click();
      });

      // After collapse, body content is hidden
      expect(container.querySelector('.content')).toBeNull();

      // Click again to expand
      await act(async () => {
        collapseBtn.click();
      });
      expect(container.querySelector('.content')).not.toBeNull();
    });
  });

  // =========================================================================
  // 8. Shadow DOM Host & Encapsulation Tests
  // =========================================================================
  describe('Shadow DOM Host & Encapsulation (shadowRoot.ts)', () => {
    it('should create #runbi-extension-root with open #shadow-root and style tag', () => {
      const { host, shadowRoot, container: appContainer } = initShadowRoot();

      expect(host.id).toBe('runbi-extension-root');
      expect(host.style.position).toBe('absolute');
      expect(host.style.zIndex).toBe('2147483647');
      expect(host.style.pointerEvents).toBe('none');

      expect(shadowRoot).not.toBeNull();
      expect(shadowRoot.mode).toBe('open');

      const styleEl = shadowRoot.querySelector('style');
      expect(styleEl).not.toBeNull();

      expect(appContainer.id).toBe('runbi-app-container');
      expect(appContainer.style.pointerEvents).toBe('none');

      // Check getters
      expect(getShadowHost()).toBe(host);
      expect(getShadowRoot()).toBe(shadowRoot);
      expect(getAppContainer()).toBe(appContainer);

      // Clean up
      destroyShadowRoot();
      expect(getShadowHost()).toBeNull();
    });

    it('should mount and unmount React application via mountRunbi / unmountRunbi', async () => {
      await act(async () => {
        mountRunbi();
      });
      expect(getShadowHost()).not.toBeNull();
      expect(getAppContainer()).not.toBeNull();

      await act(async () => {
        unmountRunbi();
      });
      expect(getShadowHost()).toBeNull();
    });
  });

  // =========================================================================
  // 9. React App State Machine & LifeCycle Tests
  // =========================================================================
  describe('React App State Machine (App.tsx)', () => {
    it('should start in capsule mode when initialSelection is passed, expand to panel on capsule click', async () => {
      const mockSelection = {
        text: '选中的测试句子',
        rawText: '选中的测试句子',
        rect: new DOMRect(100, 200, 80, 20),
        isEditable: true,
        targetElement: document.createElement('textarea'),
        savedRange: null,
      };

      await renderElement(<App initialSelection={mockSelection} />);

      const capsule = container.querySelector('#runbi-trigger-capsule') as HTMLButtonElement;
      expect(capsule).not.toBeNull();

      // Click capsule to expand panel
      await act(async () => {
        capsule.click();
        await new Promise((r) => setTimeout(r, 150));
      });

      const panel = container.querySelector('#runbi-panel');
      expect(panel).not.toBeNull();

      // Ensure all streaming settled before test cleanup
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    });

    it('should dismiss upon Escape keypress', async () => {
      const mockSelection = {
        text: '选中的测试句子',
        rawText: '选中的测试句子',
        rect: new DOMRect(100, 200, 80, 20),
        isEditable: true,
        targetElement: document.createElement('textarea'),
        savedRange: null,
      };

      await renderElement(<App initialSelection={mockSelection} />);
      expect(container.querySelector('#runbi-trigger-capsule')).not.toBeNull();

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(container.querySelector('#runbi-trigger-capsule')).toBeNull();
      expect(container.querySelector('#runbi-panel')).toBeNull();
    });
  });
});
