/**
 * @file desktop/src/adapters/TauriTextReplacer.ts
 * Desktop Text Replacer Implementation
 *
 * Implements ITextReplacer for the Runbi Tauri Desktop Client.
 * When in Tauri environment, delegates to Rust backend command `replace_text`
 * which sets system clipboard and simulates Ctrl+V via Win32 SendInput.
 * Provides web clipboard fallback for development and testing.
 */

import type { ITextReplacer, ReplacementResult } from '@runbi/shared/adapters';
import type { SelectionInfo } from '@runbi/shared/types';

interface TauriReplacerResult {
  success: boolean;
  error?: string;
  replacedLength?: number;
  restoredClipboard?: boolean;
}

export class TauriTextReplacer implements ITextReplacer {
  private isTauri(): boolean {
    return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
  }

  /**
   * Replaces the selected text with the new polished text.
   */
  public async replaceText(newText: string, context?: SelectionInfo | null): Promise<ReplacementResult> {
    if (!newText || newText.trim().length === 0) {
      return { success: false, error: 'Empty replacement text provided' };
    }

    if (this.isTauri()) {
      try {
        const modName = '@tauri-apps/api/core';
        const { invoke } = await import(/* @vite-ignore */ modName);
        const result = (await invoke('replace_text', {
          newText,
          restoreOriginalClipboard: true,
        })) as TauriReplacerResult;

        return {
          success: result.success,
          error: result.error,
          replacedLength: result.replacedLength ?? newText.length,
          restoredClipboard: result.restoredClipboard ?? true,
        };
      } catch (err) {
        console.warn('[TauriTextReplacer] invoke replace_text failed, attempting clipboard copy:', err);
        const copied = await this.copyToClipboard(newText);
        return {
          success: copied,
          error: copied ? undefined : String(err),
          replacedLength: copied ? newText.length : 0,
        };
      }
    }

    // Web Fallback: write to clipboard and attempt document.execCommand if in web preview
    const copied = await this.copyToClipboard(newText);
    return {
      success: copied,
      replacedLength: copied ? newText.length : 0,
      restoredClipboard: false,
    };
  }

  /**
   * Checks if replacement can be performed.
   */
  public async canReplace(context?: SelectionInfo | null): Promise<boolean> {
    if (this.isTauri()) {
      return true;
    }
    return typeof navigator !== 'undefined' && !!navigator.clipboard;
  }

  /**
   * Direct copy to clipboard helper.
   */
  public async copyToClipboard(text: string): Promise<boolean> {
    try {
      if (this.isTauri()) {
        try {
          const modName = '@tauri-apps/plugin-clipboard-manager';
          const { writeText } = await import(/* @vite-ignore */ modName);
          await writeText(text);
          return true;
        } catch {
          // fall through to navigator.clipboard
        }
      }

      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      console.error('[TauriTextReplacer] copyToClipboard failed:', err);
    }
    return false;
  }
}
