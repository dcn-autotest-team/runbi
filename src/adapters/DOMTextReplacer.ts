/**
 * @file src/adapters/DOMTextReplacer.ts
 * Chrome Extension DOM Text Replacer Platform Adapter
 * Implements ITextReplacer from @runbi/shared/adapters
 */

import type { ITextReplacer, ReplacementResult } from '@runbi/shared/adapters';
import type { SelectionInfo } from '@runbi/shared/types/selection';

/**
 * In-place text replacement for <textarea> and <input> elements.
 * Supports React controlled inputs by invoking prototype property descriptor setters,
 * adjusting cursor positions, and dispatching synthetic input/change events.
 */
export function replaceInInputElement(
  inputEl: HTMLInputElement | HTMLTextAreaElement,
  replacementText: string
): boolean {
  try {
    if (inputEl.readOnly || inputEl.disabled) {
      return false;
    }

    inputEl.focus();
    const start = inputEl.selectionStart ?? 0;
    const end = inputEl.selectionEnd ?? inputEl.value.length;
    const originalVal = inputEl.value;

    const nextVal = originalVal.slice(0, start) + replacementText + originalVal.slice(end);

    // Bypass React 16+ controlled component internal value trackers
    const proto =
      inputEl instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    if (setter) {
      setter.call(inputEl, nextVal);
    } else {
      inputEl.value = nextVal;
    }

    // Set cursor position at end of inserted text
    const newCursor = start + replacementText.length;
    if (typeof inputEl.setSelectionRange === 'function') {
      inputEl.setSelectionRange(newCursor, newCursor);
    }

    // Dispatch synthetic input and change events with bubble and composition flags
    inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    return true;
  } catch (err) {
    console.error('[DOMTextReplacer] Failed to replace text in input element:', err);
    return false;
  }
}

/**
 * In-place text replacement for [contenteditable="true"] rich text elements.
 * Restores selection range, attempts document.execCommand('insertText') for undo/redo
 * stack integration, and falls back to DOM range mutation + synthetic InputEvent.
 */
export function replaceInContentEditable(
  savedRange: Range | null,
  targetEl: HTMLElement | null,
  replacementText: string
): boolean {
  try {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;

    // 1. Focus editable container first so focus does not collapse restored selection range
    if (targetEl) {
      targetEl.focus();
    }

    // 2. Restore selection range if available
    if (savedRange && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }

    // 3. Primary: document.execCommand('insertText') for undo/redo preservation
    let success = false;
    try {
      if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
        success = document.execCommand('insertText', false, replacementText);
      }
    } catch {
      success = false;
    }

    if (success) {
      return true;
    }

    // 4. Fallback: Direct DOM node replacement
    if (savedRange && sel) {
      savedRange.deleteContents();
      const textNode = document.createTextNode(replacementText);
      savedRange.insertNode(textNode);
      savedRange.setStartAfter(textNode);
      savedRange.setEndAfter(textNode);
      sel.removeAllRanges();
      sel.addRange(savedRange);
    } else if (targetEl) {
      targetEl.textContent = replacementText;
    }

    // 5. Dispatch synthetic InputEvent
    if (targetEl) {
      try {
        targetEl.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertReplacementText',
            data: replacementText,
            composed: true,
          })
        );
      } catch {
        targetEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      }
    }

    return true;
  } catch (err) {
    console.error('[DOMTextReplacer] Failed to replace in contenteditable element:', err);
    return false;
  }
}

/**
 * Chrome Extension DOM Text Replacer Platform Adapter.
 */
export class DOMTextReplacer implements ITextReplacer {
  /**
   * Checks if in-place text replacement is currently possible in the target context.
   */
  public async canReplace(context?: SelectionInfo | null): Promise<boolean> {
    if (context) {
      if (!context.isEditable || !context.targetElement) {
        return false;
      }
      if (context.targetElement instanceof Element) {
        if (!context.targetElement.isConnected) {
          return false;
        }
      }
      if (
        context.targetElement instanceof HTMLInputElement ||
        context.targetElement instanceof HTMLTextAreaElement
      ) {
        if (context.targetElement.readOnly || context.targetElement.disabled) {
          return false;
        }
      }
      return true;
    }

    // Check active element if no explicit context provided
    if (typeof document === 'undefined') {
      return false;
    }

    const activeEl = document.activeElement;
    if (!activeEl) {
      return false;
    }

    if (
      activeEl instanceof HTMLTextAreaElement ||
      (activeEl instanceof HTMLInputElement &&
        /^(text|search|url|tel|password)$/i.test(activeEl.type || 'text'))
    ) {
      if (activeEl.readOnly || activeEl.disabled) {
        return false;
      }
      return true;
    }

    if (activeEl instanceof HTMLElement && activeEl.isContentEditable) {
      return true;
    }

    return false;
  }

  /**
   * Replaces the selected text with the new polished text.
   */
  public async replaceText(
    newText: string,
    context?: SelectionInfo | null
  ): Promise<ReplacementResult> {
    const isReplaceable = await this.canReplace(context);
    if (!isReplaceable) {
      return {
        success: false,
        error: 'Target element is not editable or not connected to DOM',
      };
    }

    let targetEl: HTMLElement | null = null;
    let savedRange: Range | null = null;

    if (context?.targetElement instanceof HTMLElement) {
      targetEl = context.targetElement;
    } else if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      targetEl = document.activeElement;
    }

    if (context?.savedRange instanceof Range) {
      savedRange = context.savedRange;
    }

    if (!targetEl) {
      return {
        success: false,
        error: 'No valid target element found for text replacement',
      };
    }

    try {
      const tagName = targetEl.tagName.toUpperCase();

      if (tagName === 'TEXTAREA' || tagName === 'INPUT') {
        const ok = replaceInInputElement(
          targetEl as HTMLInputElement | HTMLTextAreaElement,
          newText
        );
        if (ok) {
          return {
            success: true,
            replacedLength: newText.length,
          };
        }
        return {
          success: false,
          error: 'Failed to write text into input/textarea element',
        };
      }

      // ContentEditable / Rich text replacement
      const ok = replaceInContentEditable(savedRange, targetEl, newText);
      if (ok) {
        return {
          success: true,
          replacedLength: newText.length,
        };
      }

      return {
        success: false,
        error: 'Failed to write text into contenteditable element',
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error)?.message || 'Unexpected replacement failure',
      };
    }
  }

  /**
   * Helper to copy text to the platform clipboard directly.
   */
  public async copyToClipboard(text: string): Promise<boolean> {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fallback to execCommand copy
    }

    try {
      if (typeof document === 'undefined') {
        return false;
      }

      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-999999px';
      textarea.style.top = '-999999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      return successful;
    } catch (err) {
      console.error('[DOMTextReplacer] Failed to copy text to clipboard:', err);
      return false;
    }
  }
}

export const domTextReplacer = new DOMTextReplacer();
export default DOMTextReplacer;
