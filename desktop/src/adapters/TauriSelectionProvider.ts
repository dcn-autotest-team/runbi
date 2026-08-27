/**
 * @file desktop/src/adapters/TauriSelectionProvider.ts
 * Desktop Selection Provider Implementation
 *
 * Implements ISelectionProvider for the Runbi Tauri Desktop Client.
 * When running in Tauri environment, delegates to Rust backend command
 * `get_current_selection` which captures active window selection via Win32 SendInput.
 * Provides fallback to clipboard / DOM selection when running in web preview / vitest.
 */

import type { ISelectionProvider } from '@runbi/shared/adapters';
import type { SelectionInfo } from '@runbi/shared/types';
import { normalizeSelectionText, validateSelectionText } from '@runbi/shared/core';

interface TauriSelectionResult {
  text: string;
  sourceApp?: string;
  cursorX?: number;
  cursorY?: number;
}

export class TauriSelectionProvider implements ISelectionProvider {
  private lastSelection: SelectionInfo | null = null;
  private subscribers: Set<(selection: SelectionInfo | null) => void> = new Set();

  /**
   * Check if running in a native Tauri environment
   */
  private isTauri(): boolean {
    return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
  }

  /**
   * Captures the current selection from the active window.
   */
  public async getSelection(): Promise<SelectionInfo | null> {
    if (this.isTauri()) {
      try {
        const modName = '@tauri-apps/api/core';
        const { invoke } = await import(/* @vite-ignore */ modName);
        const result = (await invoke('get_current_selection')) as TauriSelectionResult;

        if (result && result.text) {
          const cleaned = normalizeSelectionText(result.text).trim();
          const validation = validateSelectionText(cleaned);
          if (validation.valid) {
            const posX = result.cursorX ?? window.screenX ?? 0;
            const posY = result.cursorY ?? window.screenY ?? 0;
            const selection: SelectionInfo = {
              text: cleaned,
              rawText: result.text,
              rect: {
                top: posY,
                left: posX,
                bottom: posY,
                right: posX,
                width: 0,
                height: 0,
              },
              isEditable: true,
              source: 'os_selection',
              timestamp: Date.now(),
            };
            this.lastSelection = selection;
            this.notifySubscribers(selection);
            return selection;
          }
        }
      } catch (err) {
        console.warn('[TauriSelectionProvider] invoke get_current_selection failed, falling back:', err);
      }
    }

    // Fallback: Web Clipboard or DOM Selection (development / mock mode)
    if (typeof window !== 'undefined') {
      // 1. Check window.getSelection
      const domSelection = window.getSelection?.();
      const domText = domSelection?.toString() ?? '';
      if (domText.trim().length > 0) {
        const cleaned = normalizeSelectionText(domText).trim();
        const validation = validateSelectionText(cleaned);
        if (validation.valid) {
          let top = 100;
          let left = 100;
          let bottom = 100;
          let right = 100;
          let width = 0;
          let height = 0;

          if (domSelection && domSelection.rangeCount > 0) {
            const range = domSelection.getRangeAt(0);
            const domRect = range.getBoundingClientRect();
            top = domRect.top;
            left = domRect.left;
            bottom = domRect.bottom;
            right = domRect.right;
            width = domRect.width;
            height = domRect.height;
          }
          const sel: SelectionInfo = {
            text: cleaned,
            rawText: domText,
            rect: { top, left, bottom, right, width, height },
            isEditable: true,
            source: 'dom',
            timestamp: Date.now(),
          };
          this.lastSelection = sel;
          this.notifySubscribers(sel);
          return sel;
        }
      }

      // 2. Check navigator.clipboard
      if (navigator.clipboard && navigator.clipboard.readText) {
        try {
          const clipText = await navigator.clipboard.readText();
          if (clipText && clipText.trim().length > 0) {
            const cleaned = normalizeSelectionText(clipText).trim();
            const validation = validateSelectionText(cleaned);
            if (validation.valid) {
              const sel: SelectionInfo = {
                text: cleaned,
                rawText: clipText,
                rect: { top: 200, left: 200, bottom: 200, right: 200, width: 0, height: 0 },
                isEditable: true,
                source: 'clipboard',
                timestamp: Date.now(),
              };
              this.lastSelection = sel;
              this.notifySubscribers(sel);
              return sel;
            }
          }
        } catch {
          // Clipboard access might be denied in some web contexts
        }
      }
    }

    return this.lastSelection;
  }

  /**
   * Clears selection state
   */
  public async clearSelection(): Promise<void> {
    this.lastSelection = null;
    this.notifySubscribers(null);
    if (typeof window !== 'undefined' && window.getSelection) {
      window.getSelection()?.removeAllRanges();
    }
  }

  /**
   * Subscribes to selection change events
   */
  public subscribeToSelectionChange(callback: (selection: SelectionInfo | null) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private notifySubscribers(selection: SelectionInfo | null): void {
    for (const callback of this.subscribers) {
      try {
        callback(selection);
      } catch (err) {
        console.error('[TauriSelectionProvider] Subscriber error:', err);
      }
    }
  }
}
