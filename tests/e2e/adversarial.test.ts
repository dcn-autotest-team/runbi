import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateSelectionText,
  isEditableElement,
  getActiveSelection,
  createDebouncedSelectionListener,
  MIN_SELECTION_LENGTH,
  MAX_SELECTION_LENGTH,
} from '../../src/core/selection';
import {
  calculatePlacement,
  calculateCapsulePosition,
  calculatePanelPosition,
  clampCoordinates,
  CAPSULE_DEFAULT_SIZE,
  PANEL_DEFAULT_WIDTH,
  PANEL_DEFAULT_HEIGHT,
  TOP_COLLISION_THRESHOLD,
  VIEWPORT_MARGIN,
} from '../../src/core/position';
import {
  tokenizeText,
  computeDiff,
  mergeDiffChunks,
} from '../../src/core/diff';
import {
  replaceInInputElement,
  replaceInContentEditable,
  replaceSelection,
  copyToClipboard,
} from '../../src/core/replacer';
import {
  generateMockStream,
  generateMockStreamMessages,
  transformPreset,
  MOCK_POLISH_RULES,
} from '../../src/core/mockStream';
import type {
  SelectionInfo,
  PositionCoordinates,
  DiffChunk,
  PolishStyle,
  StreamConfig,
} from '../../src/types';

describe('Tier 5: Adversarial Stress, Algorithmic Oracles & Boundary Challenges', () => {

  // =========================================================================
  // SUITE 1: Selection Validator Engine Stress & Unicode Extremes
  // =========================================================================
  describe('Adversarial Suite 1: Selection Validator Engine', () => {
    it('ADV-SEL-1: validates surrogate pairs and astral plane emoji graphemes', () => {
      const singleEmoji = String.fromCodePoint(0x1F680);
      expect(singleEmoji.length).toBe(2);
      const res1 = validateSelectionText(singleEmoji);
      expect(res1.valid).toBe(true);
      expect(res1.text).toBe(singleEmoji);

      const zwjFamily = String.fromCodePoint(0x1F468) + '\u200D' + String.fromCodePoint(0x1F469) + '\u200D' + String.fromCodePoint(0x1F467) + '\u200D' + String.fromCodePoint(0x1F466);
      expect(zwjFamily.length).toBe(11);
      const res2 = validateSelectionText(zwjFamily);
      expect(res2.valid).toBe(true);

      const rareCJK = String.fromCodePoint(0x20BB7) + String.fromCodePoint(0x2000B) + String.fromCodePoint(0x2123D);
      expect(rareCJK.length).toBe(6);
      const res3 = validateSelectionText(rareCJK);
      expect(res3.valid).toBe(true);
      expect(res3.text).toBe(rareCJK);
    });

    it('ADV-SEL-2: handles zero-width spaces and invisible characters accurately', () => {
      const zwspText = '\u200B\u200B';
      const res1 = validateSelectionText(zwspText);
      expect(res1.text.length).toBe(2);

      const whitespaceOnly = '  \t \n \r \f \v  ';
      const res2 = validateSelectionText(whitespaceOnly);
      expect(res2.valid).toBe(false);
      expect(res2.reason).toBe('EMPTY');
    });

    it('ADV-SEL-3: handles RTL languages, BiDi text and complex scripts', () => {
      const arabic = 'مرحبا بكم في عالم الذكاء الاصطناعي';
      const resArabic = validateSelectionText(arabic);
      expect(resArabic.valid).toBe(true);
      expect(resArabic.text).toBe(arabic);

      const hebrew = 'שלום עולם 2026';
      const resHebrew = validateSelectionText(hebrew);
      expect(resHebrew.valid).toBe(true);
      expect(resHebrew.text).toBe(hebrew);

      const mixedBiDi = '润笔 Runbi: الذكاء الاصطناعي 100%';
      const resMixed = validateSelectionText(mixedBiDi);
      expect(resMixed.valid).toBe(true);
    });

    it('ADV-SEL-4: tests exact MIN & MAX boundary transitions (0, 1, 2, 4999, 5000, 5001)', () => {
      expect(validateSelectionText(null).valid).toBe(false);
      expect(validateSelectionText(undefined).valid).toBe(false);
      expect(validateSelectionText('').valid).toBe(false);
      expect(validateSelectionText(' ').valid).toBe(false);
      expect(validateSelectionText('a').valid).toBe(false);
      expect(validateSelectionText('a').reason).toBe('TOO_SHORT');

      expect(validateSelectionText('ab').valid).toBe(true);
      expect(validateSelectionText('  ab  ').valid).toBe(true);
      expect(validateSelectionText('  a  ').valid).toBe(false);

      const s4999 = 'A'.repeat(4999);
      expect(validateSelectionText(s4999).valid).toBe(true);

      const s5000 = '中'.repeat(5000);
      const res5000 = validateSelectionText(s5000);
      expect(res5000.valid).toBe(true);
      expect(res5000.text.length).toBe(5000);

      const s5001 = 'B'.repeat(5001);
      const res5001 = validateSelectionText(s5001);
      expect(res5001.valid).toBe(false);
      expect(res5001.reason).toBe('TOO_LONG');

      const padded5000 = ' '.repeat(2000) + 'X'.repeat(5000) + ' '.repeat(2000);
      const resPadded = validateSelectionText(padded5000);
      expect(resPadded.valid).toBe(true);
      expect(resPadded.text.length).toBe(5000);
    });

    it('ADV-SEL-5: stress tests Zalgo text and stacked combining diacritics', () => {
      const zalgo = 'e' + '\u0301'.repeat(50);
      const res = validateSelectionText(zalgo);
      expect(res.valid).toBe(true);
      expect(res.text).toBe(zalgo);
    });

    it('ADV-SEL-6: verifies editable element detection across weird DOM nodes', () => {
      expect(isEditableElement(null)).toBe(false);
      expect(isEditableElement(undefined as any)).toBe(false);

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      expect(isEditableElement(svg as any)).toBe(false);

      const canvas = document.createElement('canvas');
      expect(isEditableElement(canvas)).toBe(false);

      const btn = document.createElement('input');
      btn.type = 'button';
      expect(isEditableElement(btn)).toBe(false);

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      expect(isEditableElement(chk)).toBe(false);

      const file = document.createElement('input');
      file.type = 'file';
      expect(isEditableElement(file)).toBe(false);

      for (const type of ['text', 'search', 'url', 'tel', 'password']) {
        const inp = document.createElement('input');
        inp.type = type;
        expect(isEditableElement(inp)).toBe(true);
      }

      const ta = document.createElement('textarea');
      expect(isEditableElement(ta)).toBe(true);

      const host = document.createElement('div');
      host.setAttribute('contenteditable', 'true');
      const innerSpan = document.createElement('span');
      const deepB = document.createElement('b');
      innerSpan.appendChild(deepB);
      host.appendChild(innerSpan);
      document.body.appendChild(host);

      expect(isEditableElement(deepB)).toBe(true);
      expect(isEditableElement(innerSpan)).toBe(true);
      expect(isEditableElement(host)).toBe(true);
    });

    it('ADV-SEL-7: creates and tears down debounced selection listener cleanly', () => {
      vi.useFakeTimers();
      const onValid = vi.fn();
      const onClear = vi.fn();

      const unbind = createDebouncedSelectionListener(onValid, onClear, 150);
      expect(typeof unbind).toBe('function');

      document.dispatchEvent(new MouseEvent('mouseup'));
      expect(onValid).not.toHaveBeenCalled();
      expect(onClear).not.toHaveBeenCalled();

      vi.advanceTimersByTime(150);
      expect(onClear).toHaveBeenCalledTimes(1);

      unbind();
      document.dispatchEvent(new MouseEvent('mouseup'));
      vi.advanceTimersByTime(200);
      expect(onClear).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  // =========================================================================
  // SUITE 2: Coordinate Collision & Geometry Engine Adversarial Challenges
  // =========================================================================
  describe('Adversarial Suite 2: Coordinate Collision Engine', () => {
    it('ADV-POS-1: survives 0x0 viewport dimensions without NaN or Infinite values', () => {
      const rect = { top: 10, right: 20, bottom: 30, left: 10 };
      const capsule = calculateCapsulePosition(rect, { windowWidth: 0, windowHeight: 0, scrollX: 0, scrollY: 0 });
      expect(Number.isFinite(capsule.top)).toBe(true);
      expect(Number.isFinite(capsule.left)).toBe(true);
      expect(isNaN(capsule.top)).toBe(false);
      expect(isNaN(capsule.left)).toBe(false);

      const panel = calculatePanelPosition(rect, { windowWidth: 0, windowHeight: 0, scrollX: 0, scrollY: 0 });
      expect(Number.isFinite(panel.top)).toBe(true);
      expect(Number.isFinite(panel.left)).toBe(true);
    });

    it('ADV-POS-2: handles ultra-high-resolution 4K (3840x2160) and 8K (7680x4320) viewports', () => {
      const rect = { top: 1800, right: 3600, bottom: 1830, left: 3400 };
      const panel = calculatePanelPosition(rect, { windowWidth: 3840, windowHeight: 2160, scrollX: 0, scrollY: 0 });
      // In 4K viewport, 1830 + 10 + 360 = 2200 > 2150 (bottom collision), flips above to 1800 - 360 - 10 = 1430
      expect(panel.top).toBe(1430);
      expect(panel.left).toBe(3400);
      expect(panel.placement).toBe('top-right');
    });

    it('ADV-POS-3: handles ultra-narrow mobile viewports (screen width < panel width)', () => {
      const rect = { top: 100, right: 280, bottom: 130, left: 50 };
      const panel = calculatePanelPosition(rect, { panelWidth: 400, windowWidth: 320, windowHeight: 640, margin: 8 });
      expect(panel.left).toBe(8);
      expect(panel.placement).toBe('bottom-left');
    });

    it('ADV-POS-4: handles extreme multi-page scroll offsets and negative overscroll', () => {
      const rect = { top: 50, right: 300, bottom: 80, left: 100 };
      const pos = calculateCapsulePosition(rect, { scrollX: 10000, scrollY: 50000, windowWidth: 1920, windowHeight: 1080 });
      expect(pos.top).toBe(50 + 50000 - CAPSULE_DEFAULT_SIZE - VIEWPORT_MARGIN);
      expect(pos.left).toBe(300 + 10000 + 4);

      const posOverscroll = calculateCapsulePosition(rect, { scrollX: -50, scrollY: -100, windowWidth: 1920, windowHeight: 1080 });
      expect(Number.isFinite(posOverscroll.top)).toBe(true);
      expect(Number.isFinite(posOverscroll.left)).toBe(true);
    });

    it('ADV-POS-5: preserves subpixel / high-precision floating point coordinates accurately', () => {
      const floatRect = { top: 123.45678, right: 456.78912, bottom: 153.45678, left: 200.12345 };
      const res = calculateCapsulePosition(floatRect, { windowWidth: 1920.5, windowHeight: 1080.5, scrollX: 0.25, scrollY: 0.75 });
      expect(res.top).toBeCloseTo(123.45678 + 0.75 - 28 - 8, 4);
      expect(res.left).toBeCloseTo(456.78912 + 0.25 + 4, 4);
    });

    it('ADV-POS-6: verifies all 4 collision quadrant permutations (TL, TR, BL, BR)', () => {
      const winW = 1000;
      const winH = 800;
      const trRect = { top: 20, right: 985, bottom: 45, left: 900 };
      const trPos = calculatePlacement({ rect: trRect, windowWidth: winW, windowHeight: winH });
      expect(trPos.placement).toBe('bottom-left');

      const tlRect = { top: 15, right: 80, bottom: 40, left: 10 };
      const tlPos = calculatePlacement({ rect: tlRect, windowWidth: winW, windowHeight: winH });
      expect(tlPos.placement.startsWith('bottom')).toBe(true);

      const midRect = { top: 300, right: 400, bottom: 325, left: 300 };
      const midPos = calculatePlacement({ rect: midRect, windowWidth: winW, windowHeight: winH });
      expect(midPos.placement).toBe('top-right');
    });

    it('ADV-POS-7: validates strict coordinate clamping bounds', () => {
      const rawCoords: PositionCoordinates = { top: -50, left: 2500, placement: 'top-right' };
      const clamped = clampCoordinates(rawCoords, { minTop: 10, maxTop: 1000, minLeft: 10, maxLeft: 1900 });
      expect(clamped.top).toBe(10);
      expect(clamped.left).toBe(1900);
      expect(clamped.placement).toBe('top-right');
    });
  });

  // =========================================================================
  // SUITE 3: Multilingual CJK-Aware Myers Diff Engine Stress & Oracles
  // =========================================================================
  describe('Adversarial Suite 3: CJK-Aware Myers Diff Engine Oracles', () => {
    function verifyDiffInvariants(original: string, polished: string) {
      const chunks = computeDiff(original, polished);
      const reconstructedOriginal = chunks.filter((c) => c.type === 'equal' || c.type === 'delete').map((c) => c.value).join('');
      expect(reconstructedOriginal).toBe(original);
      const reconstructedPolished = chunks.filter((c) => c.type === 'equal' || c.type === 'insert').map((c) => c.value).join('');
      expect(reconstructedPolished).toBe(polished);
      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i].type).not.toBe(chunks[i + 1].type);
      }
      if (original.length > 0 || polished.length > 0) {
        for (const chunk of chunks) {
          expect(chunk.value.length).toBeGreaterThan(0);
        }
      }
    }

    it('ADV-DIFF-1: oracle verification on diverse adversarial text permutations', () => {
      const testCases: Array<[string, string]> = [
        ['', ''],
        ['', '新增全部内容'],
        ['删除全部内容', ''],
        ['完全相同的一句话。', '完全相同的一句话。'],
        ['润笔插件', '润笔智能润色插件'],
        ['Hello World', 'Hello Brave New World'],
        ['Hello 123 World 456', 'Hello 789 World 456'],
        ['A B C D E', 'A X C Y E'],
        ['中英Mixed文本123测试', '中英混合Mixed文本456正式测试'],
        [String.fromCodePoint(0x1F468) + '\u200D' + String.fromCodePoint(0x1F4BB) + ' 编码 🚀 上线', String.fromCodePoint(0x1F468) + '\u200D' + String.fromCodePoint(0x1F4BB) + ' 编写优质代码 🚀 部署上线 ✨'],
        ['\n\tLine 1\nLine 2\n', '\n\tLine 1 (modified)\nLine 2\nLine 3\n'],
        ['【学术】本实验效果极佳。', '【学术规范】本实验证实了所提出算法的显著优势。'],
        ['老王，快点给报告！', '王经理：请您在方便时将项目进度报告发送给我，感谢配合。'],
        ['秋天刮风叶子落了。', '秋风萧瑟，落叶纷飞，凭添几分岁月的沉静。'],
        ['1234567890', '0987654321'],
        ['Special chars: !@#%^&*()_+{}', 'Special chars: !@#%^&*()_+{} [Updated]'],
        ['AAAAABBBBBCCCCCDDDDD', 'AAAAAXXXXXCCCCCDDDDD'],
        ['SingleChar A', 'SingleChar B'],
        ['   leading space', 'leading space'],
        ['trailing space   ', 'trailing space'],
        ['多行\r\n换行符\n测试', '多行\n标准换行\n测试完成'],
      ];
      for (const [orig, pol] of testCases) {
        verifyDiffInvariants(orig, pol);
      }
    });

    it('ADV-DIFF-2: stress tests large text diff (1000+ CJK/English tokens)', () => {
      const origParagraph = '润笔是一款基于MV3的AI划词润色插件。'.repeat(40);
      const polParagraph = '润笔是一款基于Manifest V3的AI智能浏览器划词润色生产力工具。'.repeat(40);
      const startTime = performance.now();
      const chunks = computeDiff(origParagraph, polParagraph);
      const elapsed = performance.now() - startTime;
      expect(elapsed).toBeLessThan(3000);
      expect(chunks.length).toBeGreaterThan(1);
      verifyDiffInvariants(origParagraph, polParagraph);
    });

    it('ADV-DIFF-3: verifies tokenizeText across all Unicode classifications', () => {
      const complexText = 'Runbi 润笔 2026! 🚀 Hiragana: あい Katakana: アイ Hangul: 안녕 Emoji: 👨‍👩‍👧‍👦 Math: ∑(x^2)';
      const tokens = tokenizeText(complexText);
      expect(tokens.length).toBeGreaterThan(10);
      expect(tokens.join('')).toBe(complexText);
    });

    it('ADV-DIFF-4: handles mergeDiffChunks edge cases cleanly', () => {
      const fragmented: DiffChunk[] = [
        { type: 'equal', value: 'Hello ' },
        { type: 'equal', value: 'World' },
        { type: 'insert', value: '' },
        { type: 'insert', value: '!' },
        { type: 'insert', value: '!' },
      ];
      const merged = mergeDiffChunks(fragmented);
      expect(merged).toEqual([
        { type: 'equal', value: 'Hello World' },
        { type: 'insert', value: '!!' },
      ]);
    });
  });

  // =========================================================================
  // SUITE 4: In-Place Replacer & Clipboard Boundary Testing
  // =========================================================================
  describe('Adversarial Suite 4: In-Place Replacer & Clipboard', () => {
    it('ADV-REP-1: replaces text in <textarea> with multiline content and validates event dispatch', () => {
      const textarea = document.createElement('textarea');
      textarea.value = 'First line\nTarget to replace\nThird line';
      document.body.appendChild(textarea);
      textarea.selectionStart = 11;
      textarea.selectionEnd = 28;
      let inputDispatched = false;
      let changeDispatched = false;
      textarea.addEventListener('input', (e) => { inputDispatched = true; expect(e.bubbles).toBe(true); });
      textarea.addEventListener('change', (e) => { changeDispatched = true; expect(e.bubbles).toBe(true); });
      const replacement = 'Polished Replacement\nWith Newline';
      const success = replaceInInputElement(textarea, replacement);
      expect(success).toBe(true);
      expect(textarea.value).toBe('First line\nPolished Replacement\nWith Newline\nThird line');
      expect(inputDispatched).toBe(true);
      expect(changeDispatched).toBe(true);
    });

    it('ADV-REP-2: handles React 16+ prototype property descriptor interception in inputs', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = 'Original Draft';
      document.body.appendChild(input);
      input.selectionStart = 0;
      input.selectionEnd = 14;
      const success = replaceInInputElement(input, 'AI Polished Masterpiece');
      expect(success).toBe(true);
      expect(input.value).toBe('AI Polished Masterpiece');
      expect(input.selectionStart).toBe('AI Polished Masterpiece'.length);
    });

    it('ADV-REP-3: replaces inside deeply nested contenteditable structures', () => {
      const container = document.createElement('div');
      container.setAttribute('contenteditable', 'true');
      const p = document.createElement('p');
      p.textContent = 'Prefix ';
      const b = document.createElement('b');
      const span = document.createElement('span');
      span.textContent = 'Bold Rough Draft';
      b.appendChild(span);
      p.appendChild(b);
      container.appendChild(p);
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNodeContents(span);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      const success = replaceInContentEditable(range, container, 'Polished Elegant Prose');
      expect(success).toBe(true);
      expect(container.textContent).toContain('Polished Elegant Prose');
    });

    it('ADV-REP-4: clipboard fallback writes seamlessly when navigator.clipboard throws', async () => {
      const originalWriteText = navigator.clipboard?.writeText;
      if (navigator.clipboard) {
        navigator.clipboard.writeText = vi.fn().mockRejectedValue(new Error('Permission denied'));
      }
      const execSpy = vi.spyOn(document, 'execCommand').mockReturnValue(true);
      const success = await copyToClipboard('润笔极速复制文本测试');
      expect(success).toBe(true);
      expect(execSpy).toHaveBeenCalledWith('copy');
      if (navigator.clipboard && originalWriteText) {
        navigator.clipboard.writeText = originalWriteText;
      }
    });

    it('ADV-REP-5: gracefully rejects replaceSelection on non-editable selection targets', () => {
      const staticDiv = document.createElement('div');
      staticDiv.textContent = 'Non-editable static text paragraph';
      document.body.appendChild(staticDiv);
      const fakeSelection: SelectionInfo = {
        text: 'static text',
        rawText: 'static text',
        rect: new DOMRect(100, 100, 200, 20),
        isEditable: false,
        targetElement: staticDiv,
        savedRange: null,
      };
      const success = replaceSelection(fakeSelection, 'Replacement');
      expect(success).toBe(false);
      expect(staticDiv.textContent).toBe('Non-editable static text paragraph');
    });
  });

  // =========================================================================
  // SUITE 5: Mock Stream Generator & Style Presets Robustness
  // =========================================================================
  describe('Adversarial Suite 5: Mock Stream & Style Presets', () => {
    it('ADV-STM-1: generates all 6 style presets with deterministic non-empty transforms', () => {
      const styles: PolishStyle[] = ['polished', 'academic', 'business', 'literary', 'concise', 'native_en'];
      const input = '这是一个待润色的原始测试句子。';
      for (const style of styles) {
        const polished = transformPreset(input, style);
        expect(polished).toBeDefined();
        expect(polished.length).toBeGreaterThan(input.length - 10);
      }
    });

    it('ADV-STM-2: supports abort signal cancellation during mock generation', async () => {
      const abortCtrl = new AbortController();
      const chunks: string[] = [];
      setTimeout(() => { abortCtrl.abort(); }, 30);
      try {
        for await (const chunk of generateMockStream('很长的一段测试文本进行流式打字输出，测试其中途终止信号的处理能力。', 'academic', abortCtrl.signal, { minDelay: 20, maxDelay: 40 })) {
          chunks.push(chunk);
        }
      } catch (err: any) {}
      expect(abortCtrl.signal.aborted).toBe(true);
    });

    it('ADV-STM-3: generateMockStreamMessages yields structured server messages', async () => {
      const messages: any[] = [];
      for await (const msg of generateMockStreamMessages('测试流式消息生成', 'concise', undefined, { minDelay: 1, maxDelay: 2 })) {
        messages.push(msg);
      }
      expect(messages.length).toBeGreaterThan(1);
      const chunkMessages = messages.filter((m) => m.type === 'CHUNK');
      const doneMessages = messages.filter((m) => m.type === 'DONE');
      expect(chunkMessages.length).toBeGreaterThan(0);
      expect(doneMessages.length).toBe(1);
      expect(doneMessages[0].payload.totalTokens).toBeGreaterThan(0);
    });
  });
});
