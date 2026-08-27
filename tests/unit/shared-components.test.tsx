/**
 * @file tests/unit/shared-components.test.tsx
 * Unit tests for Shared React UI Components (@runbi/shared/components)
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OriginalPreview,
  StyleTabs,
  StreamingView,
  DiffViewer,
  ActionBar,
  InstructionInput,
  Toast,
  PolishPanel,
} from '@runbi/shared/components';

describe('Shared UI Components (@runbi/shared/components)', () => {
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
  });

  async function renderElement(element: React.ReactElement): Promise<void> {
    await act(async () => {
      if (!root) {
        root = ReactDOM.createRoot(container);
      }
      root.render(element);
    });
  }

  describe('OriginalPreview Component', () => {
    it('should render null when originalText is empty', async () => {
      await renderElement(<OriginalPreview originalText="" />);
      expect(container.firstChild).toBeNull();
    });

    it('should render title and character count, toggle content on click', async () => {
      const handleToggle = vi.fn();
      await renderElement(
        <OriginalPreview
          originalText="这是待润色的原文段落"
          title="参考原文"
          onToggle={handleToggle}
        />
      );

      expect(container.textContent).toContain('参考原文');
      expect(container.textContent).toContain('10 字');
      expect(container.querySelector('#runbi-original-preview-content')).toBeNull();

      const btn = container.querySelector('button') as HTMLButtonElement;
      await act(async () => {
        btn.click();
      });

      expect(handleToggle).toHaveBeenCalledWith(true);
      expect(container.querySelector('#runbi-original-preview-content')).not.toBeNull();
      expect(container.querySelector('#runbi-original-preview-content')?.textContent).toBe('这是待润色的原文段落');
    });
  });

  describe('StyleTabs Component', () => {
    it('should render all 7 style tabs and trigger style changes', async () => {
      const handleStyleChange = vi.fn();
      await renderElement(
        <StyleTabs activeStyle="polished" onStyleChange={handleStyleChange} />
      );

      const tabs = container.querySelectorAll('[role="tab"]');
      expect(tabs.length).toBe(7);

      const academicBtn = container.querySelector('[data-style="academic"]') as HTMLButtonElement;
      await act(async () => {
        academicBtn.click();
      });

      expect(handleStyleChange).toHaveBeenCalledWith('academic');
    });
  });

  describe('StreamingView Component', () => {
    it('should render streaming content and stats', async () => {
      await renderElement(
        <StreamingView
          content="流式生成测试"
          isGenerating={true}
          durationMs={1200}
          totalTokens={25}
        />
      );

      expect(container.textContent).toContain('流式生成测试');
      expect(container.textContent).toContain('1.2s');
      expect(container.textContent).toContain('25 Tokens');
    });

    it('should render stop button during generation', async () => {
      const handleStop = vi.fn();
      await renderElement(
        <StreamingView
          content="部分内容"
          isGenerating={true}
          onStop={handleStop}
        />
      );

      const stopBtn = container.querySelector('button');
      expect(stopBtn?.textContent).toContain('中止生成');

      await act(async () => {
        stopBtn?.click();
      });
      expect(handleStop).toHaveBeenCalledTimes(1);
    });
  });

  describe('DiffViewer Component', () => {
    it('should render deletions and insertions', async () => {
      await renderElement(
        <DiffViewer originalText="旧内容" polishedText="新内容" mode="inline" />
      );

      expect(container.querySelector('#runbi-diff-content')).not.toBeNull();
      const deletes = container.querySelectorAll('[data-diff-type="delete"]');
      const inserts = container.querySelectorAll('[data-diff-type="insert"]');

      expect(deletes.length).toBeGreaterThan(0);
      expect(inserts.length).toBeGreaterThan(0);
    });

    it('should support split mode grid layout', async () => {
      await renderElement(
        <DiffViewer originalText="旧文本" polishedText="新文本" mode="split" />
      );

      expect(container.textContent).toContain('原文');
      expect(container.textContent).toContain('润色稿');
    });
  });

  describe('ActionBar Component', () => {
    it('should trigger actions and handle disabled states', async () => {
      const handleCopy = vi.fn();
      const handleReplace = vi.fn();
      const handleRegen = vi.fn();

      await renderElement(
        <ActionBar
          onCopy={handleCopy}
          onReplace={handleReplace}
          onRegenerate={handleRegen}
          isEditable={true}
          isGenerating={false}
        />
      );

      const copyBtn = container.querySelector('#runbi-action-copy') as HTMLButtonElement;
      const replaceBtn = container.querySelector('#runbi-action-replace') as HTMLButtonElement;
      const regenBtn = container.querySelector('#runbi-action-regenerate') as HTMLButtonElement;

      await act(async () => {
        copyBtn.click();
        replaceBtn.click();
        regenBtn.click();
      });

      expect(handleCopy).toHaveBeenCalledTimes(1);
      expect(handleReplace).toHaveBeenCalledTimes(1);
      expect(handleRegen).toHaveBeenCalledTimes(1);
    });
  });

  describe('InstructionInput Component', () => {
    it('should handle custom instruction input and quick tag click', async () => {
      const handleSend = vi.fn();
      await renderElement(<InstructionInput onSubmit={handleSend} />);

      const quickTag = container.querySelector('button[title*="赞同该观点"]') as HTMLButtonElement;
      await act(async () => {
        quickTag.click();
      });

      expect(handleSend).toHaveBeenCalledWith('赞同该观点，并补充细节与论据');
    });
  });

  describe('Toast Component', () => {
    it('should render toast feedback and auto dismiss', async () => {
      vi.useFakeTimers();
      const handleDismiss = vi.fn();

      await renderElement(
        <Toast message="操作成功" visible={true} durationMs={1000} onDismiss={handleDismiss} />
      );

      expect(container.querySelector('#runbi-toast')).not.toBeNull();
      expect(container.textContent).toContain('操作成功');

      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(handleDismiss).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });
  });

  describe('PolishPanel Component', () => {
    it('should render complete modal with all subcomponents and handle interaction', async () => {
      const handleClose = vi.fn();
      const handleToggleDiff = vi.fn();
      const handleStyleChange = vi.fn();
      const handleInstruction = vi.fn();

      await renderElement(
        <PolishPanel
          top={100}
          left={200}
          originalText="这是原文"
          polishedText="这是润色后的文本"
          isGenerating={false}
          activeStyle="polished"
          isDiffMode={false}
          isEditable={true}
          durationMs={500}
          totalTokens={20}
          showOriginalPreview={true}
          onClose={handleClose}
          onStyleChange={handleStyleChange}
          onToggleDiff={handleToggleDiff}
          onStop={vi.fn()}
          onRegenerate={vi.fn()}
          onCopy={vi.fn()}
          onReplace={vi.fn()}
          onSendInstruction={handleInstruction}
        />
      );

      const panel = container.querySelector('#runbi-panel') as HTMLElement;
      expect(panel).not.toBeNull();
      expect(panel.style.top).toBe('100px');
      expect(panel.style.left).toBe('200px');

      // Test close button
      const closeBtn = container.querySelector('#close-btn') as HTMLButtonElement;
      await act(async () => {
        closeBtn.click();
      });
      expect(handleClose).toHaveBeenCalledTimes(1);

      // Test diff toggle
      const diffBtn = container.querySelector('#diff-toggle') as HTMLButtonElement;
      await act(async () => {
        diffBtn.click();
      });
      expect(handleToggleDiff).toHaveBeenCalledTimes(1);
    });
  });
});
