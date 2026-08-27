/**
 * Selection Validation and Event Listener Engine
 * Part of Runbi Chrome Extension (Manifest V3)
 */

import type { SelectionInfo } from '../types/selection';

export const MIN_SELECTION_LENGTH = 2;
export const MAX_SELECTION_LENGTH = 5000;
export const DEFAULT_DEBOUNCE_MS = 150;

export type SelectionInvalidReason = 'EMPTY' | 'TOO_SHORT' | 'TOO_LONG';

export interface SelectionValidationResult {
  valid: boolean;
  text: string;
  rawText: string;
  reason?: SelectionInvalidReason;
}

/**
 * Validates text string for length and non-whitespace constraints.
 * Requirements: 2 <= trimmed.length <= 5000
 */
export function validateSelectionText(raw: string | null | undefined): SelectionValidationResult {
  if (!raw) {
    return { valid: false, text: '', rawText: '', reason: 'EMPTY' };
  }

  const trimmed = raw.trim();
  if (trimmed.length < MIN_SELECTION_LENGTH) {
    return {
      valid: false,
      text: trimmed,
      rawText: raw,
      reason: trimmed.length === 0 ? 'EMPTY' : 'TOO_SHORT',
    };
  }

  if (trimmed.length > MAX_SELECTION_LENGTH) {
    return {
      valid: false,
      text: trimmed,
      rawText: raw,
      reason: 'TOO_LONG',
    };
  }

  return {
    valid: true,
    text: trimmed,
    rawText: raw,
  };
}

/**
 * Checks if a given DOM element is an editable target
 * (<textarea>, text-like <input>, or [contenteditable="true"]).
 */
export function isEditableElement(element: Element | null): boolean {
  if (!element || !(element instanceof HTMLElement)) {
    return false;
  }

  const tagName = element.tagName.toUpperCase();

  if (tagName === 'TEXTAREA') {
    const textareaEl = element as HTMLTextAreaElement;
    return !textareaEl.readOnly && !textareaEl.disabled;
  }

  if (tagName === 'INPUT') {
    const inputEl = element as HTMLInputElement;
    if (inputEl.readOnly || inputEl.disabled) {
      return false;
    }
    const type = (inputEl.type || 'text').toLowerCase();
    return /^(text|search|url|tel|password)$/i.test(type);
  }

  if (element.isContentEditable) {
    const closestCE = element.closest?.('[contenteditable]');
    if (closestCE && closestCE.getAttribute('contenteditable') === 'false') {
      return false;
    }
    return true;
  }

  const closestCE = element.closest?.('[contenteditable]');
  if (closestCE) {
    const val = closestCE.getAttribute('contenteditable');
    if (val === 'false') {
      return false;
    }
    if (val === 'true' || val === '') {
      return true;
    }
  }

  return false;
}

/**
 * Extracts current selection information from the active DOM or input/textarea.
 */
export function getActiveSelection(): SelectionInfo | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return null;
  }
  const activeEl = document.activeElement;
  let text = '';
  let rawText = '';
  let rect: DOMRect | null = null;
  let isEditable = false;
  let targetElement: HTMLElement | null = null;
  let savedRange: Range | null = null;

  // Case 1: Active element is an input or textarea
  if (
    activeEl &&
    activeEl instanceof HTMLElement &&
    (activeEl.tagName === 'TEXTAREA' ||
      (activeEl.tagName === 'INPUT' &&
        /^(text|search|url|tel|password)$/i.test((activeEl as HTMLInputElement).type || 'text')))
  ) {
    const input = activeEl as HTMLInputElement | HTMLTextAreaElement;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;

    if (start !== end) {
      rawText = input.value.substring(start, end);
      text = rawText.trim();
      rect = input.getBoundingClientRect();
      isEditable = isEditableElement(input);
      targetElement = input;
      savedRange = null;
    }
  } else {
    // Case 2: Standard DOM Selection or ContentEditable
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
      rawText = sel.toString();
      text = rawText.trim();
      const range = sel.getRangeAt(0);
      rect = range.getBoundingClientRect();
      savedRange = range.cloneRange();

      let parent: Node | null = range.commonAncestorContainer;
      if (parent && parent.nodeType === Node.TEXT_NODE) {
        parent = parent.parentNode;
      }
      if (parent instanceof HTMLElement) {
        targetElement = parent;
        isEditable = isEditableElement(parent);
      }
    }
  }

  const validation = validateSelectionText(rawText);
  if (!validation.valid || !rect) {
    return null;
  }

  return {
    text: validation.text,
    rawText: validation.rawText,
    rect,
    isEditable,
    targetElement,
    savedRange,
  };
}

/**
 * Sets up a debounced listener for selection events (mouseup & selectionchange).
 * Returns an unbind function to cleanly remove event listeners.
 */
export function createDebouncedSelectionListener(
  onValidSelection: (selectionInfo: SelectionInfo) => void,
  onClearSelection: () => void,
  delayMs: number = DEFAULT_DEBOUNCE_MS
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let isMouseDown = false;

  const evaluate = () => {
    const info = getActiveSelection();
    if (info) {
      onValidSelection(info);
    } else {
      onClearSelection();
    }
  };

  const debouncedHandler = () => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      evaluate();
    }, delayMs);
  };

  const handleMouseDown = () => {
    isMouseDown = true;
  };

  const handleMouseUp = () => {
    isMouseDown = false;
    debouncedHandler();
  };

  const handleSelectionChange = () => {
    // If mouse is currently dragging, wait until mouseup so capsule doesn't jump prematurely
    if (isMouseDown) {
      return;
    }
    debouncedHandler();
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    // Support keyboard selection (Shift + Arrow keys, Ctrl+A)
    if (
      e.shiftKey ||
      e.key === 'a' ||
      e.key === 'A' ||
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)
    ) {
      debouncedHandler();
    }
  };

  document.addEventListener('mousedown', handleMouseDown);
  document.addEventListener('mouseup', handleMouseUp);
  document.addEventListener('selectionchange', handleSelectionChange);
  document.addEventListener('keyup', handleKeyUp);

  return () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    document.removeEventListener('mousedown', handleMouseDown);
    document.removeEventListener('mouseup', handleMouseUp);
    document.removeEventListener('selectionchange', handleSelectionChange);
    document.removeEventListener('keyup', handleKeyUp);
  };
}
