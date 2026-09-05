/**
 * @file src/adapters/ChromeDOMSelectionProvider.ts
 * Chrome Extension DOM Selection Provider Platform Adapter
 * Implements ISelectionProvider from @runbi/shared/adapters
 */

import type { ISelectionProvider } from '@runbi/shared/adapters';
import type { SelectionInfo, SelectionRect } from '@runbi/shared/types/selection';
import {
  validateSelectionText,
  MIN_SELECTION_LENGTH,
  MAX_SELECTION_LENGTH,
} from '@runbi/shared/core';

export const DEFAULT_DEBOUNCE_MS = 150;

export interface ChromeDOMSelectionProviderOptions {
  /**
   * Debounce delay for selection change notifications in milliseconds.
   * @default 150
   */
  debounceMs?: number;

  /**
   * Minimum text length required for a valid selection.
   * @default 2
   */
  minSelectionLength?: number;

  /**
   * Maximum text length allowed for a valid selection.
   * @default 5000
   */
  maxSelectionLength?: number;
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
 * Chrome Extension DOM Selection Provider.
 * Extracts selections and listens to viewport selection lifecycle.
 */
export class ChromeDOMSelectionProvider implements ISelectionProvider {
  private readonly debounceMs: number;
  private readonly minSelectionLength: number;
  private readonly maxSelectionLength: number;

  constructor(options: ChromeDOMSelectionProviderOptions = {}) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.minSelectionLength = options.minSelectionLength ?? MIN_SELECTION_LENGTH;
    this.maxSelectionLength = options.maxSelectionLength ?? MAX_SELECTION_LENGTH;
  }

  /**
   * Retrieves current text selection and its bounding coordinates / context.
   * Returns null if no active or valid selection is present.
   */
  public async getSelection(): Promise<SelectionInfo | null> {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return null;
    }

    const activeEl = document.activeElement;
    let rawText = '';
    let rect: SelectionRect | null = null;
    let isEditable = false;
    let targetElement: HTMLElement | null = null;
    let savedRange: Range | null = null;
    let contextBefore: string | undefined = undefined;
    let contextAfter: string | undefined = undefined;

    // Privacy guard: never capture text from password fields. Browser-
    // autofilled credentials selected in a login form would otherwise be
    // forwarded verbatim to the configured LLM endpoint.
    if (activeEl instanceof HTMLInputElement && (activeEl.type || '').toLowerCase() === 'password') {
      return null;
    }

    // Case 1: Active element is an input or textarea
    if (
      activeEl &&
      activeEl instanceof HTMLElement &&
      (activeEl.tagName === 'TEXTAREA' ||
        (activeEl.tagName === 'INPUT' &&
          /^(text|search|url|tel|password)$/i.test((activeEl as HTMLInputElement).type || 'text')))
    ) {
      const input = activeEl as HTMLInputElement | HTMLTextAreaElement;

      // Second guard for shadow-DOM password inputs focused indirectly
      if (input instanceof HTMLInputElement && (input.type || '').toLowerCase() === 'password') {
        return null;
      }

      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? 0;

      if (start !== end) {
        rawText = input.value.substring(start, end);
        const domRect = input.getBoundingClientRect();
        rect = {
          top: domRect.top,
          left: domRect.left,
          right: domRect.right,
          bottom: domRect.bottom,
          width: domRect.width,
          height: domRect.height,
        };
        isEditable = isEditableElement(input);
        targetElement = input;
        savedRange = null;

        // Context extraction (up to 200 surrounding characters)
        const ctxStart = Math.max(0, start - 200);
        const ctxEnd = Math.min(input.value.length, end + 200);
        contextBefore = input.value.substring(ctxStart, start);
        contextAfter = input.value.substring(end, ctxEnd);
      }
    } else {
      // Case 2: Standard DOM Selection or ContentEditable
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        rawText = sel.toString();
        const range = sel.getRangeAt(0);
        const domRect = range.getBoundingClientRect();
        rect = {
          top: domRect.top,
          left: domRect.left,
          right: domRect.right,
          bottom: domRect.bottom,
          width: domRect.width,
          height: domRect.height,
        };
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

    const validation = validateSelectionText(
      rawText,
      this.minSelectionLength,
      this.maxSelectionLength
    );

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
      contextBefore,
      contextAfter,
      source: 'dom',
      timestamp: Date.now(),
    };
  }

  /**
   * Subscribes to selection change events with debounce.
   * Listens to mouseup, selectionchange, and keyup (keyboard navigation).
   * Returns an unbind function to cleanly remove event listeners.
   */
  public subscribeToSelectionChange(
    callback: (selection: SelectionInfo | null) => void
  ): () => void {
    if (typeof document === 'undefined') {
      return () => {};
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let isMouseDown = false;
    let revision = 0;

    const handleSelectionChange = async () => {
      const current = ++revision;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      const info = await this.getSelection();
      if (current !== revision) return;
      // Clearing a selection is urgent, including while a new drag is starting.
      if (!info) {
        callback(null);
      } else if (!isMouseDown) {
        timer = setTimeout(() => {
          timer = null;
          if (current === revision) callback(info);
        }, this.debounceMs);
      }
    };

    const handleMouseDown = () => {
      isMouseDown = true;
      ++revision;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const handleMouseUp = () => {
      isMouseDown = false;
      void handleSelectionChange();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (
        e.shiftKey ||
        e.key === 'a' ||
        e.key === 'A' ||
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)
      ) {
        void handleSelectionChange();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('keyup', handleKeyUp);

    return () => {
      ++revision;
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

  /**
   * Clears or cancels the active selection in the host browser environment.
   */
  public async clearSelection(): Promise<void> {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const activeEl = document.activeElement;
    if (
      activeEl &&
      (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement)
    ) {
      const pos = activeEl.selectionEnd ?? activeEl.value.length;
      if (typeof activeEl.setSelectionRange === 'function') {
        activeEl.setSelectionRange(pos, pos);
      }
    }

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      sel.removeAllRanges();
    }
  }
}

export const chromeDOMSelection = new ChromeDOMSelectionProvider();
export default ChromeDOMSelectionProvider;

