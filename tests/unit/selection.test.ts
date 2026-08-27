import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateSelectionText,
  isEditableElement,
  getActiveSelection,
  createDebouncedSelectionListener,
  MIN_SELECTION_LENGTH,
  MAX_SELECTION_LENGTH,
} from '../../src/core/selection';

describe('src/core/selection.ts Unit Tests', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. validateSelectionText Tests
  // =========================================================================
  describe('validateSelectionText', () => {
    it('should validate exact minimum boundary (2 chars)', () => {
      const res = validateSelectionText('ab');
      expect(res.valid).toBe(true);
      expect(res.text).toBe('ab');
      expect(res.rawText).toBe('ab');
      expect(res.reason).toBeUndefined();
    });

    it('should validate Chinese characters (2 chars)', () => {
      const res = validateSelectionText('润笔');
      expect(res.valid).toBe(true);
      expect(res.text).toBe('润笔');
    });

    it('should validate exact maximum boundary (5000 chars)', () => {
      const text5000 = 'x'.repeat(5000);
      const res = validateSelectionText(text5000);
      expect(res.valid).toBe(true);
      expect(res.text.length).toBe(5000);
    });

    it('should reject text exceeding 5000 chars with TOO_LONG', () => {
      const text5001 = 'a'.repeat(5001);
      const res = validateSelectionText(text5001);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('TOO_LONG');
    });

    it('should reject single character with TOO_SHORT', () => {
      const res1 = validateSelectionText('a');
      expect(res1.valid).toBe(false);
      expect(res1.reason).toBe('TOO_SHORT');

      const res2 = validateSelectionText('字');
      expect(res2.valid).toBe(false);
      expect(res2.reason).toBe('TOO_SHORT');
    });

    it('should reject empty, null, or undefined strings with EMPTY', () => {
      expect(validateSelectionText('').valid).toBe(false);
      expect(validateSelectionText('').reason).toBe('EMPTY');

      expect(validateSelectionText(null).valid).toBe(false);
      expect(validateSelectionText(null).reason).toBe('EMPTY');

      expect(validateSelectionText(undefined).valid).toBe(false);
      expect(validateSelectionText(undefined).reason).toBe('EMPTY');
    });

    it('should reject pure whitespace, tabs, and newlines with EMPTY', () => {
      const res = validateSelectionText('   \t\r\n   \n');
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('EMPTY');
      expect(res.text).toBe('');
    });

    it('should trim surrounding whitespaces while retaining rawText', () => {
      const raw = '   \n  优质润色文本 \t  ';
      const res = validateSelectionText(raw);
      expect(res.valid).toBe(true);
      expect(res.text).toBe('优质润色文本');
      expect(res.rawText).toBe(raw);
    });

    it('should accept zero-width characters when trimmed length >= 2', () => {
      const zeroWidth = '\u200B\u200B';
      const res = validateSelectionText(zeroWidth);
      expect(res.valid).toBe(true);
      expect(res.text.length).toBe(2);
    });
  });

  // =========================================================================
  // 2. isEditableElement Tests
  // =========================================================================
  describe('isEditableElement', () => {
    it('should identify <textarea> as editable', () => {
      const textarea = document.createElement('textarea');
      expect(isEditableElement(textarea)).toBe(true);
    });

    it('should identify supported <input> types as editable', () => {
      const types = ['text', 'search', 'url', 'tel', 'password'];
      for (const type of types) {
        const input = document.createElement('input');
        input.type = type;
        expect(isEditableElement(input)).toBe(true);
      }
    });

    it('should identify default <input> (type unset) as editable', () => {
      const input = document.createElement('input');
      expect(isEditableElement(input)).toBe(true);
    });

    it('should reject non-text input types like checkbox, submit, button, file', () => {
      const unsupported = ['checkbox', 'radio', 'submit', 'button', 'file', 'color', 'range'];
      for (const type of unsupported) {
        const input = document.createElement('input');
        input.type = type;
        expect(isEditableElement(input)).toBe(false);
      }
    });

    it('should identify [contenteditable="true"] and [contenteditable=""] as editable', () => {
      const div1 = document.createElement('div');
      div1.setAttribute('contenteditable', 'true');
      expect(isEditableElement(div1)).toBe(true);

      const div2 = document.createElement('div');
      div2.setAttribute('contenteditable', '');
      expect(isEditableElement(div2)).toBe(true);
    });

    it('should identify children inside a contenteditable parent as editable', () => {
      const parent = document.createElement('div');
      parent.setAttribute('contenteditable', 'true');
      const childSpan = document.createElement('span');
      parent.appendChild(childSpan);
      document.body.appendChild(parent);

      expect(isEditableElement(childSpan)).toBe(true);
    });

    it('should reject readOnly and disabled <input> and <textarea> elements', () => {
      const roInput = document.createElement('input');
      roInput.type = 'text';
      roInput.readOnly = true;
      expect(isEditableElement(roInput)).toBe(false);

      const disInput = document.createElement('input');
      disInput.type = 'text';
      disInput.disabled = true;
      expect(isEditableElement(disInput)).toBe(false);

      const roTextarea = document.createElement('textarea');
      roTextarea.readOnly = true;
      expect(isEditableElement(roTextarea)).toBe(false);

      const disTextarea = document.createElement('textarea');
      disTextarea.disabled = true;
      expect(isEditableElement(disTextarea)).toBe(false);
    });

    it('should reject [contenteditable="false"] elements and their children', () => {
      const div = document.createElement('div');
      div.setAttribute('contenteditable', 'false');
      expect(isEditableElement(div)).toBe(false);

      const parentCe = document.createElement('div');
      parentCe.setAttribute('contenteditable', 'true');
      const nestedNonCe = document.createElement('span');
      nestedNonCe.setAttribute('contenteditable', 'false');
      const innerChild = document.createElement('b');
      nestedNonCe.appendChild(innerChild);
      parentCe.appendChild(nestedNonCe);
      document.body.appendChild(parentCe);

      expect(isEditableElement(parentCe)).toBe(true);
      expect(isEditableElement(nestedNonCe)).toBe(false);
      expect(isEditableElement(innerChild)).toBe(false);
    });

    it('should reject static DOM elements (p, div, span, h1)', () => {
      expect(isEditableElement(document.createElement('p'))).toBe(false);
      expect(isEditableElement(document.createElement('div'))).toBe(false);
      expect(isEditableElement(document.createElement('span'))).toBe(false);
      expect(isEditableElement(document.createElement('h1'))).toBe(false);
      expect(isEditableElement(null)).toBe(false);
    });
  });

  // =========================================================================
  // 3. getActiveSelection Tests
  // =========================================================================
  describe('getActiveSelection', () => {
    it('should extract selection from focused <textarea>', () => {
      const textarea = document.createElement('textarea');
      textarea.value = '测试输入框内的文本段落';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.selectionStart = 2;
      textarea.selectionEnd = 8;

      // Mock getBoundingClientRect
      textarea.getBoundingClientRect = () => new DOMRect(100, 200, 300, 100);

      const info = getActiveSelection();
      expect(info).not.toBeNull();
      expect(info?.text).toBe('输入框内的文');
      expect(info?.isEditable).toBe(true);
      expect(info?.targetElement).toBe(textarea);
      expect(info?.savedRange).toBeNull();
    });

    it('should extract selection from focused <input type="text">', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = '搜索关键词测试';
      document.body.appendChild(input);
      input.focus();
      input.selectionStart = 0;
      input.selectionEnd = 4;
      input.getBoundingClientRect = () => new DOMRect(50, 50, 150, 30);

      const info = getActiveSelection();
      expect(info).not.toBeNull();
      expect(info?.text).toBe('搜索关键');
      expect(info?.isEditable).toBe(true);
      expect(info?.targetElement).toBe(input);
    });

    it('should extract selection from standard DOM selection', () => {
      const p = document.createElement('p');
      p.textContent = '这是一个用于划词测试的段落';
      document.body.appendChild(p);

      const range = document.createRange();
      range.selectNodeContents(p);
      range.getBoundingClientRect = () => new DOMRect(10, 20, 200, 40);

      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      const info = getActiveSelection();
      expect(info).not.toBeNull();
      expect(info?.text).toBe('这是一个用于划词测试的段落');
      expect(info?.isEditable).toBe(false);
      expect(info?.savedRange).not.toBeNull();
    });

    it('should return null if selection is empty or collapsed', () => {
      window.getSelection()?.removeAllRanges();
      expect(getActiveSelection()).toBeNull();
    });
  });

  // =========================================================================
  // 4. createDebouncedSelectionListener Tests
  // =========================================================================
  describe('createDebouncedSelectionListener', () => {
    it('should debounce rapid mouseup/selectionchange events by specified ms', () => {
      vi.useFakeTimers();
      const onValid = vi.fn();
      const onClear = vi.fn();

      const p = document.createElement('p');
      p.textContent = '防抖测试文本内容';
      document.body.appendChild(p);

      const range = document.createRange();
      range.selectNodeContents(p);
      range.getBoundingClientRect = () => new DOMRect(10, 20, 100, 30);

      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      const unbind = createDebouncedSelectionListener(onValid, onClear, 150);

      document.dispatchEvent(new MouseEvent('mouseup'));
      vi.advanceTimersByTime(50);
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(50);
      document.dispatchEvent(new MouseEvent('mouseup'));

      expect(onValid).not.toHaveBeenCalled();

      vi.advanceTimersByTime(150);
      expect(onValid).toHaveBeenCalledTimes(1);
      expect(onValid.mock.calls[0][0].text).toBe('防抖测试文本内容');

      unbind();
      vi.useRealTimers();
    });

    it('should call onClear when unselected or collapsed', () => {
      vi.useFakeTimers();
      const onValid = vi.fn();
      const onClear = vi.fn();

      window.getSelection()?.removeAllRanges();
      const unbind = createDebouncedSelectionListener(onValid, onClear, 100);

      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(100);

      expect(onClear).toHaveBeenCalledTimes(1);
      expect(onValid).not.toHaveBeenCalled();

      unbind();
      vi.useRealTimers();
    });

    it('should stop triggering after unbind is called', () => {
      vi.useFakeTimers();
      const onValid = vi.fn();
      const onClear = vi.fn();

      const unbind = createDebouncedSelectionListener(onValid, onClear, 100);
      unbind();

      document.dispatchEvent(new MouseEvent('mouseup'));
      vi.advanceTimersByTime(200);

      expect(onValid).not.toHaveBeenCalled();
      expect(onClear).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
