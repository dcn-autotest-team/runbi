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
  MarkdownRenderer,
  TranslateBar,
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
    it('should render all 5 style tabs and trigger style changes', async () => {
      const handleStyleChange = vi.fn();
      await renderElement(
        <StyleTabs activeStyle="polished" onStyleChange={handleStyleChange} />
      );

      const tabs = container.querySelectorAll('[role="menuitemradio"]');
      expect(tabs.length).toBe(5);

      const academicBtn = container.querySelector('[data-style="academic"]') as HTMLButtonElement;
      await act(async () => {
        academicBtn.click();
      });

      expect(handleStyleChange).toHaveBeenCalledWith('academic');
    });
  });

  describe('TranslateBar Component', () => {
    it('renders all 5 targets and reports the picked one', async () => {
      const handleTargetChange = vi.fn();
      await renderElement(
        <TranslateBar target="en" onTargetChange={handleTargetChange} />
      );

      const trigger = container.querySelector('[data-testid="translate-target-trigger"]') as HTMLButtonElement;
      expect(trigger).not.toBeNull();
      expect(trigger.textContent).toContain('英文');

      await act(async () => {
        trigger.click();
      });

      const options = container.querySelectorAll('[role="menuitemradio"]');
      expect(options.length).toBe(5);

      const ja = container.querySelector('[data-target="ja"]') as HTMLButtonElement;
      await act(async () => {
        ja.click();
      });
      expect(handleTargetChange).toHaveBeenCalledWith('ja');
    });
  });

  describe('StreamingView Component', () => {
    it('should render a clear ready state before generation starts', async () => {
      await renderElement(<StreamingView content="" isGenerating={false} />);

      expect(container.textContent).toContain('准备生成润色稿');
      expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
    });

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

    it('should hide stats when hideStats is true', async () => {
      await renderElement(
        <StreamingView
          content="翻译结果文本"
          isGenerating={false}
          durationMs={800}
          totalTokens={12}
          model="qwen3.8-27b"
          hideStats={true}
        />
      );

      expect(container.textContent).toContain('翻译结果文本');
      expect(container.textContent).not.toContain('Tokens');
      expect(container.textContent).not.toContain('qwen3.8-27b');
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

    it('should render markdown bold, inline code, and numbered lists properly', async () => {
      const markdown = `1. **夯实基础**: 重点掌握\`NumPy\`和\`Pandas\`。\n2. **框架实战**: 直接上手PyTorch。\n\n> 祝学习顺利！`;
      await renderElement(
        <StreamingView
          content={markdown}
          isGenerating={false}
        />
      );

      expect(container.textContent).toContain('夯实基础');
      expect(container.textContent).toContain('重点掌握');
      const strongs = container.querySelectorAll('strong');
      expect(strongs.length).toBe(2);
      expect(strongs[0].textContent).toBe('夯实基础');
      expect(strongs[1].textContent).toBe('框架实战');

      const codes = container.querySelectorAll('code');
      expect(codes.length).toBe(2);
      expect(codes[0].textContent).toBe('NumPy');

      expect(container.textContent).toContain('祝学习顺利！');
    });

    it('should render fenced code blocks properly', async () => {
      const markdown = '```bash\ngit status\necho done\n```';
      await renderElement(
        <MarkdownRenderer content={markdown} />
      );
      const pre = container.querySelector('pre');
      expect(pre).not.toBeNull();
      expect(pre?.textContent).toContain('git status');
      expect(pre?.textContent).toContain('echo done');
      expect(container.textContent).toContain('bash');
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

    it('should display attached files and submit with attached files', async () => {
      const handleSend = vi.fn();
      const files = [{ name: 'plan.md', content: 'Design specs', size: 100 }];
      await renderElement(<InstructionInput onSubmit={handleSend} attachedFiles={files} />);

      expect(container.textContent).toContain('plan.md');

      const sendBtn = container.querySelector('#runbi-instruction-send') as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(false);

      await act(async () => {
        sendBtn.click();
      });

      expect(handleSend).toHaveBeenCalledWith('请参考附加资料进行回复', files);
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
    });

    it('should render a clean and minimal interface in reply mode without clutter', async () => {
      const analysis = {
        conversation: [{ sender: 'other' as const, text: '能便宜点吗？' }],
        last_message_from_other: '能便宜点吗？',
        clarify_options: ['议价让步', '婉拒议价'],
        draft_reply: '亲，给你抹个零～',
      };

      await renderElement(
        <PolishPanel
          originalText="能便宜点吗？"
          polishedText="亲，给你抹个零～"
          isGenerating={false}
          activeStyle="reply"
          isDiffMode={false}
          isEditable={true}
          screenReplyAnalysis={analysis}
          replyQuickTags={[
            { label: '催付款', text: '礼貌催促客户完成付款' },
            { label: '要好评', text: '礼貌邀请客户给个好评' },
          ]}
          onClose={vi.fn()}
          onStyleChange={vi.fn()}
          onToggleDiff={vi.fn()}
          onStop={vi.fn()}
          onRegenerate={vi.fn()}
          onCopy={vi.fn()}
          onReplace={vi.fn()}
          onSendInstruction={vi.fn()}
        />
      );

      const text = container.textContent || '';
      expect(text).toContain('亲，给你抹个零～');
      expect(text).toContain('回复模式');
      // Clutter elements must NOT be present in reply mode
      expect(container.querySelector('#diff-toggle')).toBeNull();
      expect(container.querySelector('#original-preview')).toBeNull();
      expect(text).not.toContain('话术库');
      expect(text).not.toContain('高频意图');
      expect(text).not.toContain('补充要求');
      expect(text).not.toContain('Tokens');
    });

    it('should trigger clarify chip callback on number key 1 press when screenReplyAnalysis is present', async () => {
      const handleClarify = vi.fn();
      const analysis = {
        conversation: [{ sender: 'other' as const, text: '这版周五能给吗？' }],
        last_message_from_other: '这版周五能给吗？',
        clarify_options: ['热情答应', '委婉推迟', '追问细节'],
        draft_reply: '周五下班前准时交付！',
      };

      await renderElement(
        <PolishPanel
          originalText="聊天记录"
          polishedText="周五下班前准时交付！"
          isGenerating={false}
          activeStyle="reply"
          isDiffMode={false}
          isEditable={true}
          screenReplyAnalysis={analysis}
          onSelectClarifyChip={handleClarify}
          onClose={vi.fn()}
          onStyleChange={vi.fn()}
          onToggleDiff={vi.fn()}
          onStop={vi.fn()}
          onRegenerate={vi.fn()}
          onCopy={vi.fn()}
          onReplace={vi.fn()}
        />
      );

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
      });

      expect(handleClarify).toHaveBeenCalledWith('热情答应');
    });

    it('should render recommendation chips and script library button in reply mode', async () => {
      const handleClarify = vi.fn();
      const handleOpenLibrary = vi.fn();
      const analysis = {
        conversation: [{ sender: 'other' as const, text: '能优惠点吗？' }],
        last_message_from_other: '能优惠点吗？',
        clarify_options: ['同意优惠', '委婉拒绝', '申请赠品'],
        draft_reply: '亲，给您申请了精美礼品一份哦～',
      };

      await renderElement(
        <PolishPanel
          originalText="能优惠点吗？"
          polishedText="亲，给您申请了精美礼品一份哦～"
          isGenerating={false}
          activeStyle="reply"
          isDiffMode={false}
          isEditable={true}
          screenReplyAnalysis={analysis}
          onSelectClarifyChip={handleClarify}
          onOpenScriptLibrary={handleOpenLibrary}
          onClose={vi.fn()}
          onStyleChange={vi.fn()}
          onToggleDiff={vi.fn()}
          onStop={vi.fn()}
          onRegenerate={vi.fn()}
          onCopy={vi.fn()}
          onReplace={vi.fn()}
        />
      );

      const text = container.textContent || '';
      expect(text).toContain('回复模式');
      expect(text).toContain('话术模板库');
      expect(text).toContain('同意优惠');
      expect(text).toContain('委婉拒绝');
      expect(text).toContain('申请赠品');

      // Clicking script library button triggers callback
      const libBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('话术模板库')
      );
      expect(libBtn).toBeTruthy();
      await act(async () => {
        libBtn!.click();
      });
      expect(handleOpenLibrary).toHaveBeenCalledTimes(1);

      // Clicking recommendation chip triggers callback
      const chipBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('同意优惠')
      );
      expect(chipBtn).toBeTruthy();
      await act(async () => {
        chipBtn!.click();
      });
      expect(handleClarify).toHaveBeenCalledWith('同意优惠');
    });

    it('should render a clean and minimal interface in translate mode without clutter', async () => {
      await renderElement(
        <PolishPanel
          originalText="Hello world"
          polishedText="你好世界"
          isGenerating={false}
          activeStyle="translate"
          translateTarget="zh-Hans"
          onTranslateTargetChange={vi.fn()}
          isDiffMode={false}
          isEditable={true}
          durationMs={200}
          totalTokens={3}
          showOriginalPreview={true}
          replaceLabel="贴回"
          onClose={vi.fn()}
          onStyleChange={vi.fn()}
          onToggleDiff={vi.fn()}
          onStop={vi.fn()}
          onRegenerate={vi.fn()}
          onCopy={vi.fn()}
          onReplace={vi.fn()}
          onSendInstruction={vi.fn()}
          onOpenScriptLibrary={vi.fn()}
        />
      );

      const text = container.textContent || '';
      // Contains translated result and translate bar
      expect(text).toContain('你好世界');
      expect(text).toContain('简体中文');
      expect(text).toContain('贴回');

      // Clutter elements from the 4 red boxes must NOT be present
      expect(container.querySelector('#diff-toggle')).toBeNull();
      expect(container.querySelector('#original-preview')).toBeNull();
      expect(text).not.toContain('原文');
      expect(text).not.toContain('对比修改');
      expect(text).not.toContain('润色方式');
      expect(text).not.toContain('智能模式');
      expect(text).not.toContain('通用润色');
      expect(text).not.toContain('话术库');
      expect(text).not.toContain('高频意图');
      expect(text).not.toContain('补充要求');
      expect(text).not.toContain('Tokens');
    });

    it('embedded Polish mode hides clutter elements (original preview, diff toggle, script library, intent chips, instruction input, stats)', async () => {
      await renderElement(
        <PolishPanel
          embedded
          originalText="这是待润色的文字"
          polishedText="这是精炼后的文字"
          isGenerating={false}
          activeStyle="polished"
          isDiffMode={false}
          isEditable={true}
          durationMs={200}
          totalTokens={12}
          showOriginalPreview={false}
          replaceLabel="贴回"
          onClose={vi.fn()}
          onStyleChange={vi.fn()}
          onToggleDiff={vi.fn()}
          onStop={vi.fn()}
          onRegenerate={vi.fn()}
          onCopy={vi.fn()}
          onReplace={vi.fn()}
          onSendInstruction={vi.fn()}
          onOpenScriptLibrary={vi.fn()}
        />
      );

      const text = container.textContent || '';
      expect(text).toContain('这是精炼后的文字');
      expect(text).toContain('贴回');
      expect(text).toContain('润色方式');

      // Clutter elements from the 4 red boxes must NOT be present in embedded polish mode
      expect(container.querySelector('#diff-toggle')).toBeNull();
      expect(container.querySelector('#original-preview')).toBeNull();
      expect(text).not.toContain('原文 8字');
      expect(text).not.toContain('对比修改');
      expect(text).not.toContain('话术库');
      expect(text).not.toContain('高频意图');
      expect(text).not.toContain('补充要求');
      expect(text).not.toContain('Tokens');
    });
  });
});
