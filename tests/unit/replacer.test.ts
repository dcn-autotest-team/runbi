import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  replaceInInputElement,
  replaceInContentEditable,
  replaceSelection,
  copyToClipboard,
} from '../../src/core/replacer';
import type { SelectionInfo } from '../../src/types/selection';

describe('src/core/replacer.ts Unit Tests', () => {
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
  // 1. replaceInInputElement Tests
  // =========================================================================
  describe('replaceInInputElement', () => {
    it('should replace selected text inside <textarea> and dispatch events', () => {
      const textarea = document.createElement('textarea');
      textarea.value = '原始草稿：这是一段需要润色的文本。';
      document.body.appendChild(textarea);

      const onInput = vi.fn();
      const onChange = vi.fn();
      textarea.addEventListener('input', onInput);
      textarea.addEventListener('change', onChange);

      // Select "需要润色"
      const start = textarea.value.indexOf('需要润色');
      const end = start + '需要润色'.length;
      textarea.selectionStart = start;
      textarea.selectionEnd = end;

      const success = replaceInInputElement(textarea, '极其优美高雅');

      expect(success).toBe(true);
      expect(textarea.value).toBe('原始草稿：这是一段极其优美高雅的文本。');
      expect(onInput).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(textarea.selectionStart).toBe(start + '极其优美高雅'.length);
      expect(textarea.selectionEnd).toBe(start + '极其优美高雅'.length);
    });

    it('should replace selected text inside <input type="text">', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = 'Hello World';
      document.body.appendChild(input);

      input.selectionStart = 6;
      input.selectionEnd = 11;

      const success = replaceInInputElement(input, 'Universe');
      expect(success).toBe(true);
      expect(input.value).toBe('Hello Universe');
    });

    it('should reject replacement on readOnly and disabled inputs', () => {
      const readonlyInput = document.createElement('input');
      readonlyInput.type = 'text';
      readonlyInput.value = 'ReadOnly Value';
      readonlyInput.readOnly = true;
      document.body.appendChild(readonlyInput);

      expect(replaceInInputElement(readonlyInput, 'New')).toBe(false);
      expect(readonlyInput.value).toBe('ReadOnly Value');

      const disabledTextarea = document.createElement('textarea');
      disabledTextarea.value = 'Disabled Value';
      disabledTextarea.disabled = true;
      document.body.appendChild(disabledTextarea);

      expect(replaceInInputElement(disabledTextarea, 'New')).toBe(false);
      expect(disabledTextarea.value).toBe('Disabled Value');
    });

    it('should invoke prototype setter for React controlled component compatibility', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = 'Initial';
      document.body.appendChild(input);

      const setterSpy = vi.spyOn(HTMLInputElement.prototype, 'value', 'set');

      input.selectionStart = 0;
      input.selectionEnd = 7;
      replaceInInputElement(input, 'Replaced');

      expect(setterSpy).toHaveBeenCalled();
      setterSpy.mockRestore();
      expect(input.value).toBe('Replaced');
    });
  });

  // =========================================================================
  // 2. replaceInContentEditable Tests
  // =========================================================================
  describe('replaceInContentEditable', () => {
    it('should replace text in contenteditable via document.execCommand', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerText = '富文本初始内容';
      document.body.appendChild(div);
      div.focus();

      const range = document.createRange();
      range.selectNodeContents(div);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      const success = replaceInContentEditable(range, div, '润色后的富文本内容');
      expect(success).toBe(true);
      expect(div.innerText).toBe('润色后的富文本内容');
    });

    it('should fallback to DOM node replacement if execCommand fails', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = '测试DOM回退';
      document.body.appendChild(div);

      // Force execCommand to return false
      vi.spyOn(document, 'execCommand').mockReturnValue(false);

      const onInput = vi.fn();
      div.addEventListener('input', onInput);

      const range = document.createRange();
      range.selectNodeContents(div);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      const success = replaceInContentEditable(range, div, '回退成功内容');
      expect(success).toBe(true);
      expect(div.textContent).toBe('回退成功内容');
      expect(onInput).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 3. replaceSelection Tests
  // =========================================================================
  describe('replaceSelection', () => {
    it('should return false if selectionInfo is not editable', () => {
      const p = document.createElement('p');
      p.textContent = '静态内容';
      document.body.appendChild(p);

      const info: SelectionInfo = {
        text: '静态内容',
        rawText: '静态内容',
        rect: new DOMRect(0, 0, 100, 20),
        isEditable: false,
        targetElement: p,
        savedRange: null,
      };

      const result = replaceSelection(info, '新内容');
      expect(result).toBe(false);
    });

    it('should dispatch to replaceInInputElement when target is textarea', () => {
      const textarea = document.createElement('textarea');
      textarea.value = '待替换内容';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.selectionStart = 0;
      textarea.selectionEnd = 5;

      const info: SelectionInfo = {
        text: '待替换内容',
        rawText: '待替换内容',
        rect: new DOMRect(0, 0, 100, 20),
        isEditable: true,
        targetElement: textarea,
        savedRange: null,
      };

      const result = replaceSelection(info, '已完成替换');
      expect(result).toBe(true);
      expect(textarea.value).toBe('已完成替换');
    });
  });

  // =========================================================================
  // 4. copyToClipboard Tests
  // =========================================================================
  describe('copyToClipboard', () => {
    it('should write text using navigator.clipboard API', async () => {
      const writeSpy = vi.spyOn(navigator.clipboard, 'writeText');
      const success = await copyToClipboard('测试剪贴板写入');

      expect(success).toBe(true);
      expect(writeSpy).toHaveBeenCalledWith('测试剪贴板写入');
    });

    it('should fallback to document.execCommand copy if clipboard API throws', async () => {
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Permission denied'));
      const execSpy = vi.spyOn(document, 'execCommand').mockReturnValue(true);

      const success = await copyToClipboard('回退复制内容');
      expect(success).toBe(true);
      expect(execSpy).toHaveBeenCalledWith('copy');
    });
  });
});
