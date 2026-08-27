/**
 * @file tests/unit/adversarial-dom-adapters.test.ts
 * EMPIRICAL CHALLENGER: Adversarial Stress & Boundary Harness for Chrome Extension Adapters
 * Targets: ChromeDOMSelectionProvider & DOMTextReplacer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ChromeDOMSelectionProvider,
  isEditableElement,
  DEFAULT_DEBOUNCE_MS,
} from '../../src/adapters/ChromeDOMSelectionProvider';
import {
  DOMTextReplacer,
  replaceInInputElement,
  replaceInContentEditable,
} from '../../src/adapters/DOMTextReplacer';
import type { SelectionInfo } from '@runbi/shared/types/selection';

describe('EMPIRICAL CHALLENGER: DOMTextReplacer Adversarial Stress Harness', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'test-fixture-root';
    document.body.appendChild(container);
    window.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Complex DOM Trees & Deeply Nested Hierarchies
  // =========================================================================
  describe('Suite 1.1: Complex DOM Trees & Deeply Nested Hierarchy', () => {
    it('ADV-REP-1: should replace text in 10-level deep nested DOM structure without corrupting hierarchy (fallback path)', async () => {
      const replacer = new DOMTextReplacer();
      const ceDiv = document.createElement('div');
      ceDiv.setAttribute('contenteditable', 'true');
      
      // Build 10-level deep nesting
      let current: HTMLElement = ceDiv;
      const tags = ['section', 'article', 'main', 'aside', 'p', 'span', 'strong', 'em', 'code', 'mark'];
      for (const tag of tags) {
        const el = document.createElement(tag);
        current.appendChild(el);
        current = el;
      }
      current.textContent = '深度嵌套原始文本需要润色';
      container.appendChild(ceDiv);

      const textNode = current.firstChild as Text;
      expect(textNode).not.toBeNull();

      const prefix = '深度嵌套原始文本';
      const target = '需要润色';
      const range = document.createRange();
      range.setStart(textNode, prefix.length);
      range.setEnd(textNode, prefix.length + target.length); // "需要润色" (8 to 12)
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      const context: SelectionInfo = {
        text: target,
        rawText: target,
        rect: { top: 10, left: 10, right: 100, bottom: 30, width: 90, height: 20 },
        isEditable: true,
        targetElement: ceDiv,
        savedRange: range,
        source: 'dom',
        timestamp: Date.now(),
      };

      // Force fallback path
      vi.spyOn(document, 'execCommand').mockReturnValue(false);

      const result = await replacer.replaceText('极其文雅高贵', context);
      expect(result.success).toBe(true);
      expect(ceDiv.textContent).toBe('深度嵌套原始文本极其文雅高贵');

      // Verify DOM tree depth was preserved
      let depth = 0;
      let walker: HTMLElement | null = ceDiv;
      while (walker && walker.firstElementChild) {
        depth++;
        walker = walker.firstElementChild as HTMLElement;
      }
      expect(depth).toBe(10);
      expect(walker?.tagName.toLowerCase()).toBe('mark');
    });

    it('ADV-REP-2: should replace text spanning across sibling formatted nodes', async () => {
      const replacer = new DOMTextReplacer();
      const ceDiv = document.createElement('div');
      ceDiv.setAttribute('contenteditable', 'true');

      const span1 = document.createElement('span');
      span1.textContent = '前半部分';
      const bNode = document.createElement('b');
      bNode.textContent = '粗体跨界';
      const span2 = document.createElement('span');
      span2.textContent = '后半部分';

      ceDiv.appendChild(span1);
      ceDiv.appendChild(bNode);
      ceDiv.appendChild(span2);
      container.appendChild(ceDiv);

      // Select from end of span1 across bNode to start of span2
      const range = document.createRange();
      range.setStart(span1.firstChild as Text, 2); // "部分"
      range.setEnd(span2.firstChild as Text, 2);   // "后半"
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      const context: SelectionInfo = {
        text: '部分粗体跨界后半',
        rawText: '部分粗体跨界后半',
        rect: { top: 0, left: 0, right: 200, bottom: 20, width: 200, height: 20 },
        isEditable: true,
        targetElement: ceDiv,
        savedRange: range,
        source: 'dom',
        timestamp: Date.now(),
      };

      // Force fallback path to test DOM manipulation resilience
      vi.spyOn(document, 'execCommand').mockReturnValue(false);

      const result = await replacer.replaceText('[已整体重构]', context);
      expect(result.success).toBe(true);
      expect(ceDiv.textContent).toBe('前半[已整体重构]部分');
    });

    it('ADV-REP-3: should handle DOM tree with mixed images, icons, and comment nodes', async () => {
      const replacer = new DOMTextReplacer();
      const ceDiv = document.createElement('div');
      ceDiv.setAttribute('contenteditable', 'true');

      const text1 = document.createTextNode('前文描述 ');
      const img = document.createElement('img');
      img.src = 'data:image/png;base64,iVBORw0KGgo=';
      const comment = document.createComment('react-mount-marker');
      const targetSpan = document.createElement('span');
      targetSpan.textContent = '待替换的目标文本';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      ceDiv.appendChild(text1);
      ceDiv.appendChild(img);
      ceDiv.appendChild(comment);
      ceDiv.appendChild(targetSpan);
      ceDiv.appendChild(svg);
      container.appendChild(ceDiv);

      const range = document.createRange();
      range.selectNodeContents(targetSpan);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      const context: SelectionInfo = {
        text: '待替换的目标文本',
        rawText: '待替换的目标文本',
        rect: { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 },
        isEditable: true,
        targetElement: ceDiv,
        savedRange: range,
        source: 'dom',
        timestamp: Date.now(),
      };

      const result = await replacer.replaceText('精简优雅文本', context);
      expect(result.success).toBe(true);
      expect(ceDiv.textContent).toContain('前文描述');
      expect(ceDiv.textContent).toContain('精简优雅文本');
      expect(ceDiv.querySelector('img')).not.toBeNull();
      expect(ceDiv.querySelector('svg')).not.toBeNull();
    });
  });

  // =========================================================================
  // 2. Nested Formatting Spans & Partial Tag Boundaries
  // =========================================================================
  describe('Suite 1.2: Nested Formatting Spans & Boundary Handling', () => {
    it('ADV-REP-4: should handle partial span replacement in multiple formatting tags (strong/em/del/mark/u)', async () => {
      const replacer = new DOMTextReplacer();
      const ceDiv = document.createElement('div');
      ceDiv.setAttribute('contenteditable', 'true');

      const strong = document.createElement('strong');
      strong.textContent = '加粗前缀';
      const em = document.createElement('em');
      em.textContent = '斜体核心重点内容';
      const del = document.createElement('del');
      del.textContent = '删除后缀';

      ceDiv.appendChild(strong);
      ceDiv.appendChild(em);
      ceDiv.appendChild(del);
      container.appendChild(ceDiv);

      // Select inside em ("核心重点")
      const emText = em.firstChild as Text;
      const range = document.createRange();
      range.setStart(emText, 2);
      range.setEnd(emText, 6);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      vi.spyOn(document, 'execCommand').mockReturnValue(false);

      const context: SelectionInfo = {
        text: '核心重点',
        rawText: '核心重点',
        rect: { top: 0, left: 0, right: 80, bottom: 20, width: 80, height: 20 },
        isEditable: true,
        targetElement: ceDiv,
        savedRange: range,
        source: 'dom',
        timestamp: Date.now(),
      };

      const result = await replacer.replaceText('关键亮点', context);
      expect(result.success).toBe(true);
      expect(ceDiv.textContent).toBe('加粗前缀斜体关键亮点内容删除后缀');
      expect(ceDiv.querySelector('strong')).not.toBeNull();
      expect(ceDiv.querySelector('del')).not.toBeNull();
    });

    it('ADV-REP-5: should perform consecutive multiple replacements in the same container sequentially (fallback path)', async () => {
      const replacer = new DOMTextReplacer();
      const ceDiv = document.createElement('div');
      ceDiv.setAttribute('contenteditable', 'true');
      ceDiv.textContent = '第一句草稿。第二句草稿。第三句草稿。';
      container.appendChild(ceDiv);

      vi.spyOn(document, 'execCommand').mockReturnValue(false);

      // Replace first sentence
      let textNode = ceDiv.firstChild as Text;
      let range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 5); // "第一句草稿"
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      let context: SelectionInfo = {
        text: '第一句草稿',
        rawText: '第一句草稿',
        rect: { top: 0, left: 0, right: 50, bottom: 20, width: 50, height: 20 },
        isEditable: true,
        targetElement: ceDiv,
        savedRange: range,
        source: 'dom',
        timestamp: Date.now(),
      };

      let res = await replacer.replaceText('第一句华章', context);
      expect(res.success).toBe(true);
      expect(ceDiv.textContent).toContain('第一句华章。第二句草稿。第三句草稿。');

      // Replace third sentence
      const targetStr = '第三句草稿';
      let foundNode: Text | null = null;
      let foundIdx = -1;
      for (const node of Array.from(ceDiv.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent?.includes(targetStr)) {
          foundNode = node as Text;
          foundIdx = node.textContent.indexOf(targetStr);
          break;
        }
      }
      expect(foundNode).not.toBeNull();

      range = document.createRange();
      range.setStart(foundNode!, foundIdx);
      range.setEnd(foundNode!, foundIdx + targetStr.length);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      context = {
        text: targetStr,
        rawText: targetStr,
        rect: { top: 0, left: 100, right: 150, bottom: 20, width: 50, height: 20 },
        isEditable: true,
        targetElement: ceDiv,
        savedRange: range,
        source: 'dom',
        timestamp: Date.now(),
      };

      res = await replacer.replaceText('第三句明珠', context);
      expect(res.success).toBe(true);
      expect(ceDiv.textContent).toBe('第一句华章。第二句草稿。第三句明珠。');
    });
  });

  // =========================================================================
  // 3. ContentEditable Div with Linebreaks (<br>, <div>, <p>)
  // =========================================================================
  describe('Suite 1.3: ContentEditable with Linebreaks (<br>, <div>, <p>)', () => {
    it('ADV-REP-6: should handle contenteditable containing <br> linebreaks across multiline selection', async () => {
      const replacer = new DOMTextReplacer();
      const ceDiv = document.createElement('div');
      ceDiv.setAttribute('contenteditable', 'true');
      ceDiv.innerHTML = '第一行文本内容<br>第二行需要润色的内容<br>第三行结尾内容';
      container.appendChild(ceDiv);

      const range = document.createRange();
      // Select the second text node ("第二行需要润色的内容")
      const targetTextNode = ceDiv.childNodes[2] as Text;
      expect(targetTextNode.nodeType).toBe(Node.TEXT_NODE);
      range.selectNodeContents(targetTextNode);

      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      vi.spyOn(document, 'execCommand').mockReturnValue(false);

      const context: SelectionInfo = {
        text: '第二行需要润色的内容',
        rawText: '第二行需要润色的内容',
        rect: { top: 20, left: 0, right: 150, bottom: 40, width: 150, height: 20 },
        isEditable: true,
        targetElement: ceDiv,
        savedRange: range,
        source: 'dom',
        timestamp: Date.now(),
      };

      const result = await replacer.replaceText('第二行优美文段', context);
      expect(result.success).toBe(true);
      expect(ceDiv.innerHTML).toContain('第一行文本内容<br>');
      expect(ceDiv.innerHTML).toContain('第二行优美文段');
      expect(ceDiv.innerHTML).toContain('<br>第三行结尾内容');
    });

    it('ADV-REP-7: should replace multiline content containing paragraphs (<p>) and divs (<div>)', async () => {
      const replacer = new DOMTextReplacer();
      const ceDiv = document.createElement('div');
      ceDiv.setAttribute('contenteditable', 'true');
      ceDiv.innerHTML = '<p>段落一：起承</p><div>段落二：转折草稿</div><p>段落三：合卷</p>';
      container.appendChild(ceDiv);

      const divChild = ceDiv.querySelector('div') as HTMLElement;
      const textNode = divChild.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 4); // "转折草稿"
      range.setEnd(textNode, 8);

      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      vi.spyOn(document, 'execCommand').mockReturnValue(false);

      const context: SelectionInfo = {
        text: '转折草稿',
        rawText: '转折草稿',
        rect: { top: 30, left: 0, right: 80, bottom: 50, width: 80, height: 20 },
        isEditable: true,
        targetElement: ceDiv,
        savedRange: range,
        source: 'dom',
        timestamp: Date.now(),
      };

      const result = await replacer.replaceText('高潮迭起', context);
      expect(result.success).toBe(true);
      expect(ceDiv.innerHTML).toContain('<p>段落一：起承</p>');
      expect(ceDiv.innerHTML).toContain('段落二：高潮迭起');
      expect(ceDiv.innerHTML).toContain('<p>段落三：合卷</p>');
    });

    it('ADV-REP-8: should dispatch synthetic InputEvent with complete event metadata', async () => {
      const replacer = new DOMTextReplacer();
      const ceDiv = document.createElement('div');
      ceDiv.setAttribute('contenteditable', 'true');
      ceDiv.textContent = '测试InputEvent分发';
      container.appendChild(ceDiv);

      let capturedEvent: Event | null = null;
      ceDiv.addEventListener('input', (e) => {
        capturedEvent = e;
      });

      const range = document.createRange();
      range.selectNodeContents(ceDiv);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      vi.spyOn(document, 'execCommand').mockReturnValue(false);

      const context: SelectionInfo = {
        text: '测试InputEvent分发',
        rawText: '测试InputEvent分发',
        rect: { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 },
        isEditable: true,
        targetElement: ceDiv,
        savedRange: range,
        source: 'dom',
        timestamp: Date.now(),
      };

      await replacer.replaceText('事件验证通过', context);
      expect(capturedEvent).not.toBeNull();
      expect((capturedEvent as any)?.bubbles).toBe(true);
      expect((capturedEvent as any)?.composed).toBe(true);
    });
  });

  // =========================================================================
  // 4. Input & Textarea Selection Boundaries, Multibyte & Emojis
  // =========================================================================
  describe('Suite 1.4: Input & Textarea Boundaries, Surrogate Pairs & Emojis', () => {
    it('ADV-REP-9: should replace at exact start boundary (index 0) of <textarea>', () => {
      const textarea = document.createElement('textarea');
      const targetPrefix = '【待替换前缀】';
      textarea.value = targetPrefix + '这是一段长尾文本内容。';
      container.appendChild(textarea);

      textarea.selectionStart = 0;
      textarea.selectionEnd = targetPrefix.length; // 7 chars

      const ok = replaceInInputElement(textarea, '【全新标题】');
      expect(ok).toBe(true);
      expect(textarea.value).toBe('【全新标题】这是一段长尾文本内容。');
      expect(textarea.selectionStart).toBe('【全新标题】'.length);
      expect(textarea.selectionEnd).toBe('【全新标题】'.length);
    });

    it('ADV-REP-10: should replace at exact end boundary (index len) of <input type="text">', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = '用户名前缀_待修正尾缀';
      container.appendChild(input);

      const start = '用户名前缀_'.length;
      input.selectionStart = start;
      input.selectionEnd = input.value.length;

      const ok = replaceInInputElement(input, '终极版本');
      expect(ok).toBe(true);
      expect(input.value).toBe('用户名前缀_终极版本');
      expect(input.selectionStart).toBe(start + '终极版本'.length);
    });

    it('ADV-REP-11: should handle large text replacement (10,000+ characters) in textarea', () => {
      const textarea = document.createElement('textarea');
      const largePrefix = 'Prefix-'.repeat(500); // 3500 chars
      const target = 'OLD_TARGET';
      const largeSuffix = '-Suffix'.repeat(500); // 3500 chars
      textarea.value = largePrefix + target + largeSuffix;
      container.appendChild(textarea);

      const start = largePrefix.length;
      const end = start + target.length;
      textarea.selectionStart = start;
      textarea.selectionEnd = end;

      const largeReplacement = 'NEW_POLISHED_CONTENT_'.repeat(500); // 10,500 chars
      const ok = replaceInInputElement(textarea, largeReplacement);
      expect(ok).toBe(true);
      expect(textarea.value.length).toBe(largePrefix.length + largeReplacement.length + largeSuffix.length);
      expect(textarea.value.includes('OLD_TARGET')).toBe(false);
      expect(textarea.value.includes(largeReplacement)).toBe(true);
    });

    it('ADV-REP-12: should replace surrogate pairs, ZWJ sequences, and multibyte CJK characters correctly', () => {
      const textarea = document.createElement('textarea');
      // Contains CJK Extension B (𠮷), Emoji ZWJ (👨‍👩‍👧‍👦), Flag (🏳️‍🌈), Math symbols (∀x∈ℝ)
      textarea.value = '初始前缀 𠮷野家 👨‍👩‍👧‍👦 🏳️‍🌈 ∀x∈ℝ 结尾后缀';
      container.appendChild(textarea);

      const target = '👨‍👩‍👧‍👦 🏳️‍🌈';
      const start = textarea.value.indexOf(target);
      const end = start + target.length;
      textarea.selectionStart = start;
      textarea.selectionEnd = end;

      const replacement = '🌟🚀 润笔AI ✨🎯';
      const ok = replaceInInputElement(textarea, replacement);
      expect(ok).toBe(true);
      expect(textarea.value).toBe(`初始前缀 𠮷野家 ${replacement} ∀x∈ℝ 结尾后缀`);
      expect(textarea.selectionStart).toBe(start + replacement.length);
    });

    it('ADV-REP-13: should handle collapsed cursor position replacement (insertion at cursor)', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = 'HelloWorld';
      container.appendChild(input);

      // Cursor between "Hello" and "World"
      input.selectionStart = 5;
      input.selectionEnd = 5;

      const ok = replaceInInputElement(input, ' Beautiful ');
      expect(ok).toBe(true);
      expect(input.value).toBe('Hello Beautiful World');
      expect(input.selectionStart).toBe(5 + ' Beautiful '.length);
    });
  });

  // =========================================================================
  // 5. Read-Only, Disabled, and Non-Editable Elements
  // =========================================================================
  describe('Suite 1.5: Read-Only, Disabled, and Non-Editable Safeguards', () => {
    it('ADV-REP-14: should reject replacement when target element is not editable (static paragraph)', async () => {
      const replacer = new DOMTextReplacer();
      const p = document.createElement('p');
      p.textContent = '只读静态段落内容';
      container.appendChild(p);

      const context: SelectionInfo = {
        text: '只读静态段落内容',
        rawText: '只读静态段落内容',
        rect: { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 },
        isEditable: false,
        targetElement: p,
        source: 'dom',
        timestamp: Date.now(),
      };

      const can = await replacer.canReplace(context);
      expect(can).toBe(false);

      const result = await replacer.replaceText('非法替换尝试', context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not editable');
      expect(p.textContent).toBe('只读静态段落内容');
    });

    it('ADV-REP-15: should reject replacement when targetElement is null in context', async () => {
      const replacer = new DOMTextReplacer();
      const context: SelectionInfo = {
        text: '孤立选区文本',
        rawText: '孤立选区文本',
        rect: { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 },
        isEditable: true,
        targetElement: null,
        source: 'dom',
        timestamp: Date.now(),
      };

      const can = await replacer.canReplace(context);
      expect(can).toBe(false);

      const result = await replacer.replaceText('非法尝试', context);
      expect(result.success).toBe(false);
    });

    it('ADV-REP-15B: should reject replacement on readonly and disabled <input> and <textarea>', async () => {
      const replacer = new DOMTextReplacer();

      // Readonly input
      const readonlyInput = document.createElement('input');
      readonlyInput.type = 'text';
      readonlyInput.value = '只读输入框内容';
      readonlyInput.readOnly = true;
      container.appendChild(readonlyInput);

      expect(replaceInInputElement(readonlyInput, '非法写入')).toBe(false);
      expect(readonlyInput.value).toBe('只读输入框内容');

      const roContext: SelectionInfo = {
        text: '只读输入框内容',
        rawText: '只读输入框内容',
        rect: { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 },
        isEditable: true,
        targetElement: readonlyInput,
        source: 'dom',
        timestamp: Date.now(),
      };
      expect(await replacer.canReplace(roContext)).toBe(false);
      const roRes = await replacer.replaceText('非法写入', roContext);
      expect(roRes.success).toBe(false);

      // Disabled textarea
      const disabledTextarea = document.createElement('textarea');
      disabledTextarea.value = '禁用文本域内容';
      disabledTextarea.disabled = true;
      container.appendChild(disabledTextarea);

      expect(replaceInInputElement(disabledTextarea, '非法写入')).toBe(false);
      expect(disabledTextarea.value).toBe('禁用文本域内容');

      const disContext: SelectionInfo = {
        text: '禁用文本域内容',
        rawText: '禁用文本域内容',
        rect: { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 },
        isEditable: true,
        targetElement: disabledTextarea,
        source: 'dom',
        timestamp: Date.now(),
      };
      expect(await replacer.canReplace(disContext)).toBe(false);
      const disRes = await replacer.replaceText('非法写入', disContext);
      expect(disRes.success).toBe(false);
    });

    it('ADV-REP-15C: should call targetEl.focus() before restoring selection range in replaceInContentEditable', () => {
      const ceDiv = document.createElement('div');
      ceDiv.setAttribute('contenteditable', 'true');
      ceDiv.textContent = '段落内容待替换';
      container.appendChild(ceDiv);

      const textNode = ceDiv.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 4);
      range.setEnd(textNode, 7);

      const callOrder: string[] = [];
      const focusSpy = vi.spyOn(ceDiv, 'focus').mockImplementation(() => {
        callOrder.push('focus');
      });

      const sel = window.getSelection();
      const addRangeSpy = vi.spyOn(sel!, 'addRange').mockImplementation(() => {
        callOrder.push('addRange');
      });

      vi.spyOn(document, 'execCommand').mockImplementation(() => {
        callOrder.push('execCommand');
        return true;
      });

      const ok = replaceInContentEditable(range, ceDiv, '全新文字');
      expect(ok).toBe(true);
      expect(callOrder[0]).toBe('focus');
      expect(callOrder[1]).toBe('addRange');
      expect(callOrder[2]).toBe('execCommand');

      focusSpy.mockRestore();
      addRangeSpy.mockRestore();
    });
  });

  // =========================================================================
  // 6. Detached Nodes & Orphaned Selections
  // =========================================================================
  describe('Suite 1.6: Detached Nodes & Orphaned Selection Recovery', () => {
    it('ADV-REP-16: should reject replacement when target element is detached from DOM', async () => {
      const replacer = new DOMTextReplacer();
      const detachedTextarea = document.createElement('textarea');
      detachedTextarea.value = '已从DOM中被移除的文本框';
      // Notice: not attached to document.body or container

      const context: SelectionInfo = {
        text: '已从DOM中被移除',
        rawText: '已从DOM中被移除',
        rect: { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 },
        isEditable: true,
        targetElement: detachedTextarea,
        source: 'dom',
        timestamp: Date.now(),
      };

      const can = await replacer.canReplace(context);
      expect(can).toBe(false);

      const result = await replacer.replaceText('尝试写入游离节点', context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });

    it('ADV-REP-17: should safely handle target element removed after selection capture', async () => {
      const replacer = new DOMTextReplacer();
      const textarea = document.createElement('textarea');
      textarea.value = '初始文本内容';
      container.appendChild(textarea);

      const context: SelectionInfo = {
        text: '初始文本内容',
        rawText: '初始文本内容',
        rect: { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 },
        isEditable: true,
        targetElement: textarea,
        source: 'dom',
        timestamp: Date.now(),
      };

      // Simulate dynamic unmount / SPA page navigation removing target element
      container.removeChild(textarea);

      const can = await replacer.canReplace(context);
      expect(can).toBe(false);

      const result = await replacer.replaceText('已卸载写入', context);
      expect(result.success).toBe(false);
    });
  });
});

describe('EMPIRICAL CHALLENGER: ChromeDOMSelectionProvider Adversarial Stress Harness', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'selection-fixture-root';
    document.body.appendChild(container);
    window.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Empty, Collapsed, and Boundary Selections
  // =========================================================================
  describe('Suite 2.1: Empty, Collapsed, & Length Boundary Selections', () => {
    it('ADV-SEL-1: should return null when window selection is completely empty', async () => {
      const provider = new ChromeDOMSelectionProvider();
      window.getSelection()?.removeAllRanges();
      const sel = await provider.getSelection();
      expect(sel).toBeNull();
    });

    it('ADV-SEL-2: should return null when selection is collapsed (cursor click in DOM)', async () => {
      const provider = new ChromeDOMSelectionProvider();
      const p = document.createElement('p');
      p.textContent = '点击光标所在段落';
      container.appendChild(p);

      const range = document.createRange();
      range.setStart(p.firstChild as Text, 2);
      range.setEnd(p.firstChild as Text, 2); // collapsed!
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      const sel = await provider.getSelection();
      expect(sel).toBeNull();
    });

    it('ADV-SEL-3: should return null when textarea has collapsed selection (start === end)', async () => {
      const provider = new ChromeDOMSelectionProvider();
      const textarea = document.createElement('textarea');
      textarea.value = '光标闪烁位置测试';
      container.appendChild(textarea);
      textarea.focus();
      textarea.selectionStart = 3;
      textarea.selectionEnd = 3;

      const sel = await provider.getSelection();
      expect(sel).toBeNull();
    });

    it('ADV-SEL-4: should return null for pure whitespace, tabs, and newline selections', async () => {
      const provider = new ChromeDOMSelectionProvider();
      const p = document.createElement('p');
      p.textContent = '   \t\t\n\r\n   ';
      container.appendChild(p);

      const range = document.createRange();
      range.selectNodeContents(p);
      range.getBoundingClientRect = () => new DOMRect(0, 0, 50, 20);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      const sel = await provider.getSelection();
      expect(sel).toBeNull();
    });

    it('ADV-SEL-5: should enforce exact minSelectionLength boundary (2 chars pass, 1 char fails)', async () => {
      const provider = new ChromeDOMSelectionProvider({ minSelectionLength: 2 });
      const p = document.createElement('p');
      p.textContent = '测试字';
      container.appendChild(p);

      // Test 1 character ("测") -> should be rejected
      let range = document.createRange();
      range.setStart(p.firstChild as Text, 0);
      range.setEnd(p.firstChild as Text, 1);
      range.getBoundingClientRect = () => new DOMRect(0, 0, 20, 20);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      let sel = await provider.getSelection();
      expect(sel).toBeNull();

      // Test 2 characters ("测试") -> should pass
      range = document.createRange();
      range.setStart(p.firstChild as Text, 0);
      range.setEnd(p.firstChild as Text, 2);
      range.getBoundingClientRect = () => new DOMRect(0, 0, 40, 20);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      sel = await provider.getSelection();
      expect(sel).not.toBeNull();
      expect(sel?.text).toBe('测试');
    });

    it('ADV-SEL-6: should enforce maxSelectionLength boundary (5000 chars pass, 5001 chars fail)', async () => {
      const provider = new ChromeDOMSelectionProvider({ maxSelectionLength: 5000 });
      const textarea = document.createElement('textarea');
      container.appendChild(textarea);

      // 5000 characters -> valid
      textarea.value = 'A'.repeat(5000);
      textarea.focus();
      textarea.selectionStart = 0;
      textarea.selectionEnd = 5000;
      textarea.getBoundingClientRect = () => new DOMRect(0, 0, 500, 200);

      let sel = await provider.getSelection();
      expect(sel).not.toBeNull();
      expect(sel?.text.length).toBe(5000);

      // 5001 characters -> invalid
      textarea.value = 'A'.repeat(5001);
      textarea.selectionStart = 0;
      textarea.selectionEnd = 5001;

      sel = await provider.getSelection();
      expect(sel).toBeNull();
    });

    it('ADV-SEL-6B: should mark readOnly inputs/textareas as isEditable: false in getSelection and reject disabled elements', async () => {
      const provider = new ChromeDOMSelectionProvider();

      // Readonly input selection
      const readonlyInput = document.createElement('input');
      readonlyInput.type = 'text';
      readonlyInput.value = '只读输入框选区测试';
      readonlyInput.readOnly = true;
      container.appendChild(readonlyInput);
      readonlyInput.focus();
      readonlyInput.selectionStart = 0;
      readonlyInput.selectionEnd = 6;
      readonlyInput.getBoundingClientRect = () => new DOMRect(0, 0, 100, 20);

      const sel1 = await provider.getSelection();
      expect(sel1).not.toBeNull();
      expect(sel1?.text).toBe('只读输入框选');
      expect(sel1?.isEditable).toBe(false);

      container.removeChild(readonlyInput);

      // Readonly textarea selection
      const readonlyTextarea = document.createElement('textarea');
      readonlyTextarea.value = '只读文本域选区测试';
      readonlyTextarea.readOnly = true;
      container.appendChild(readonlyTextarea);
      readonlyTextarea.focus();
      readonlyTextarea.selectionStart = 0;
      readonlyTextarea.selectionEnd = 5;
      readonlyTextarea.getBoundingClientRect = () => new DOMRect(0, 0, 100, 20);

      const sel2 = await provider.getSelection();
      expect(sel2).not.toBeNull();
      expect(sel2?.text).toBe('只读文本域');
      expect(sel2?.isEditable).toBe(false);

      // Disabled inputs and textareas
      const disabledInput = document.createElement('input');
      disabledInput.type = 'text';
      disabledInput.disabled = true;
      expect(isEditableElement(disabledInput)).toBe(false);

      const disabledTextarea = document.createElement('textarea');
      disabledTextarea.disabled = true;
      expect(isEditableElement(disabledTextarea)).toBe(false);
    });

    it('ADV-SEL-6C: should identify contenteditable="false" nested inside contenteditable="true" as not editable', () => {
      const ceDiv = document.createElement('div');
      ceDiv.setAttribute('contenteditable', 'true');

      const nonEditableSpan = document.createElement('span');
      nonEditableSpan.setAttribute('contenteditable', 'false');
      nonEditableSpan.textContent = '不可编辑芯片';

      const childOfNonEditable = document.createElement('b');
      childOfNonEditable.textContent = '加粗芯片文字';
      nonEditableSpan.appendChild(childOfNonEditable);

      ceDiv.appendChild(nonEditableSpan);
      container.appendChild(ceDiv);

      expect(isEditableElement(ceDiv)).toBe(true);
      expect(isEditableElement(nonEditableSpan)).toBe(false);
      expect(isEditableElement(childOfNonEditable)).toBe(false);
    });
  });

  // =========================================================================
  // 2. Out-of-Bounds & Extreme Client Rects
  // =========================================================================
  describe('Suite 2.2: Out-of-Bounds & Extreme Client Rects', () => {
    it('ADV-SEL-7: should safely capture negative and extreme viewport coordinates', async () => {
      const provider = new ChromeDOMSelectionProvider();
      const p = document.createElement('p');
      p.textContent = '超出视口边界的选区文本';
      container.appendChild(p);

      const range = document.createRange();
      range.selectNodeContents(p);
      // Extreme negative coordinates (scrolled far off-screen)
      range.getBoundingClientRect = () => new DOMRect(-1500, -3200, 250, 40);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      const sel = await provider.getSelection();
      expect(sel).not.toBeNull();
      expect(sel?.rect.left).toBe(-1500);
      expect(sel?.rect.top).toBe(-3200);
      expect(sel?.rect.width).toBe(250);
      expect(sel?.rect.height).toBe(40);
    });

    it('ADV-SEL-8: should safely handle huge multi-monitor coordinates (e.g. 4K/8K secondary monitor)', async () => {
      const provider = new ChromeDOMSelectionProvider();
      const textarea = document.createElement('textarea');
      textarea.value = '多显示器极端坐标测试';
      container.appendChild(textarea);
      textarea.focus();
      textarea.selectionStart = 0;
      textarea.selectionEnd = 10;
      // Secondary monitor at x=3840, y=1080
      textarea.getBoundingClientRect = () => new DOMRect(3840, 1080, 400, 60);

      const sel = await provider.getSelection();
      expect(sel).not.toBeNull();
      expect(sel?.rect.left).toBe(3840);
      expect(sel?.rect.top).toBe(1080);
      expect(sel?.rect.right).toBe(4240);
      expect(sel?.rect.bottom).toBe(1140);
    });
  });

  // =========================================================================
  // 3. Multi-Range Selections
  // =========================================================================
  describe('Suite 2.3: Multi-Range Selections & Discontinuous Nodes', () => {
    it('ADV-SEL-9: should safely extract first valid range in multi-range environment without throwing IndexSizeError', async () => {
      const provider = new ChromeDOMSelectionProvider();
      const p1 = document.createElement('p');
      p1.textContent = '第一个段落选区内容';
      const p2 = document.createElement('p');
      p2.textContent = '第二个段落选区内容';
      container.appendChild(p1);
      container.appendChild(p2);

      const range1 = document.createRange();
      range1.selectNodeContents(p1);
      range1.getBoundingClientRect = () => new DOMRect(10, 10, 150, 20);

      const range2 = document.createRange();
      range2.selectNodeContents(p2);
      range2.getBoundingClientRect = () => new DOMRect(10, 40, 150, 20);

      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range1);
      // In supporting environments, add multiple ranges
      try {
        sel?.addRange(range2);
      } catch {
        // Some DOM implementations strictly enforce single range
      }

      const selInfo = await provider.getSelection();
      expect(selInfo).not.toBeNull();
      expect(selInfo?.text).toBe('第一个段落选区内容');
      expect(selInfo?.savedRange).not.toBeNull();
    });
  });

  // =========================================================================
  // 4. Rapid Mouseup, Keydown, and Drag Interleaving Events
  // =========================================================================
  describe('Suite 2.4: Rapid Mouseup, Keydown, & Drag Interleaving Stress', () => {
    it('ADV-SEL-10: should suppress debounced evaluation during mousedown dragging and fire exactly once on mouseup', async () => {
      vi.useFakeTimers();
      try {
        const provider = new ChromeDOMSelectionProvider({ debounceMs: 150 });
        const callback = vi.fn();

        const textarea = document.createElement('textarea');
        textarea.value = '鼠标拖拽选区测试内容';
        container.appendChild(textarea);
        textarea.focus();
        textarea.selectionStart = 0;
        textarea.selectionEnd = 8;
        textarea.getBoundingClientRect = () => new DOMRect(0, 0, 100, 20);

        const unbind = provider.subscribeToSelectionChange(callback);

        // 1. User presses mouse down (starts drag selection)
        document.dispatchEvent(new MouseEvent('mousedown'));

        // 2. Rapid selectionchange events fire during mouse drag
        for (let i = 0; i < 20; i++) {
          document.dispatchEvent(new Event('selectionchange'));
          await vi.advanceTimersByTimeAsync(10);
        }

        // Selection callback should NOT fire while mouse is held down
        expect(callback).not.toHaveBeenCalled();

        // 3. User releases mouse (drag complete)
        document.dispatchEvent(new MouseEvent('mouseup'));

        // Debounce timer running
        await vi.advanceTimersByTimeAsync(100);
        expect(callback).not.toHaveBeenCalled();

        // Complete debounce delay
        await vi.advanceTimersByTimeAsync(60);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback.mock.calls[0][0]?.text).toBe('鼠标拖拽选区测试');

        unbind();
      } finally {
        vi.useRealTimers();
      }
    });

    it('ADV-SEL-11: should handle rapid keyboard navigation bursts (Shift+Arrows, Ctrl+A, Home/End)', async () => {
      vi.useFakeTimers();
      try {
        const provider = new ChromeDOMSelectionProvider({ debounceMs: 100 });
        const callback = vi.fn();

        const p = document.createElement('p');
        p.textContent = '键盘选区防抖测试';
        container.appendChild(p);

        const range = document.createRange();
        range.selectNodeContents(p);
        range.getBoundingClientRect = () => new DOMRect(0, 0, 120, 20);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);

        const unbind = provider.subscribeToSelectionChange(callback);

        // Rapid keyup events simulating Shift + ArrowRight repeatedly
        for (let i = 0; i < 30; i++) {
          document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true }));
          await vi.advanceTimersByTimeAsync(15);
        }

        // Fire Ctrl+A
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', ctrlKey: true }));
        await vi.advanceTimersByTimeAsync(15);

        // Fire Home/End
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Home', shiftKey: true }));
        await vi.advanceTimersByTimeAsync(15);

        expect(callback).not.toHaveBeenCalled();

        // Wait for debounce timeout to settle
        await vi.advanceTimersByTimeAsync(110);
        expect(callback).toHaveBeenCalledTimes(1);

        unbind();
      } finally {
        vi.useRealTimers();
      }
    });

    it('ADV-SEL-12: should survive 100 rapid subscribe/unsubscribe cycles without timer leaks', async () => {
      vi.useFakeTimers();
      try {
        const provider = new ChromeDOMSelectionProvider({ debounceMs: 50 });
        const callbacks = Array.from({ length: 100 }, () => vi.fn());

        // Repeatedly subscribe and immediately unsubscribe
        for (let i = 0; i < 100; i++) {
          const unbind = provider.subscribeToSelectionChange(callbacks[i]);
          document.dispatchEvent(new MouseEvent('mouseup'));
          if (i % 2 === 0) {
            unbind(); // immediately unbind even indices
          }
        }

        await vi.advanceTimersByTimeAsync(100);

        // Even index callbacks must never have fired
        for (let i = 0; i < 100; i += 2) {
          expect(callbacks[i]).not.toHaveBeenCalled();
        }
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // =========================================================================
  // 5. Selection Clearing Lifecycle
  // =========================================================================
  describe('Suite 2.5: Selection Clearing Lifecycle', () => {
    it('ADV-SEL-13: should clear selection on active input element by collapsing to end', async () => {
      const provider = new ChromeDOMSelectionProvider();
      const input = document.createElement('input');
      input.type = 'text';
      input.value = '测试清除输入框选区';
      container.appendChild(input);
      input.focus();
      input.selectionStart = 0;
      input.selectionEnd = 5;

      expect(input.selectionStart).not.toBe(input.selectionEnd);

      await provider.clearSelection();
      expect(input.selectionStart).toBe(5);
      expect(input.selectionEnd).toBe(5);
    });

    it('ADV-SEL-14: should clear standard DOM window selection ranges', async () => {
      const provider = new ChromeDOMSelectionProvider();
      const p = document.createElement('p');
      p.textContent = '测试DOM选区清除';
      container.appendChild(p);

      const range = document.createRange();
      range.selectNodeContents(p);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      expect(window.getSelection()?.rangeCount).toBe(1);

      await provider.clearSelection();
      expect(window.getSelection()?.rangeCount).toBe(0);
    });

    it('ADV-SEL-15: should handle clearSelection gracefully when document or selection is empty', async () => {
      const provider = new ChromeDOMSelectionProvider();
      window.getSelection()?.removeAllRanges();
      await expect(provider.clearSelection()).resolves.toBeUndefined();
    });
  });
});
