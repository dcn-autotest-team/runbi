/**
 * In-Place Selection Replacer & Clipboard Engine
 * Part of Runbi Chrome Extension (Manifest V3)
 */

import type { SelectionInfo } from '../types/selection';

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
    console.error('[Runbi] Failed to replace text in input element:', err);
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
    const sel = window.getSelection();

    // 1. Focus editable container first so focus does not collapse restored selection range
    if (targetEl) {
      targetEl.focus();
    }

    // 2. Restore selection range if available
    if (savedRange && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }

    // 3. Primary: document.execCommand('insertText')
    let success = false;
    try {
      success = document.execCommand('insertText', false, replacementText);
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
    console.error('[Runbi] Failed to replace in contenteditable element:', err);
    return false;
  }
}

/**
 * High-level unified selection replacement dispatcher.
 */
export function replaceSelection(info: SelectionInfo, replacementText: string): boolean {
  if (!info.isEditable || !info.targetElement) {
    return false;
  }

  const el = info.targetElement;
  const tagName = el.tagName.toUpperCase();

  if (tagName === 'TEXTAREA' || tagName === 'INPUT') {
    return replaceInInputElement(el as HTMLInputElement | HTMLTextAreaElement, replacementText);
  }

  return replaceInContentEditable(info.savedRange, el, replacementText);
}

/**
 * Copies text to the system clipboard using navigator.clipboard API with
 * document.execCommand('copy') fallback.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to execCommand copy
  }

  try {
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
    console.error('[Runbi] Failed to copy text to clipboard:', err);
    return false;
  }
}
