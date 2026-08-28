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
import { invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

interface TauriReplacerResult {
  success: boolean;
  error?: string;
  replacedLength?: number;
  replaced_length?: number;
  restoredClipboard?: boolean;
  restored_clipboard?: boolean;
  safeToCopyFallback?: boolean;
  safe_to_copy_fallback?: boolean;
}

export class TauriTextReplacer implements ITextReplacer {
  private isTauri(): boolean {
    return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
  }

  /**
   * Replaces the selected text with the new polished text.
   */
  public async replaceText(newText: string, context?: SelectionInfo | null, hideWindow: boolean = true): Promise<ReplacementResult> {
    if (!newText || newText.trim().length === 0) {
      return { success: false, error: 'Empty replacement text provided' };
    }

    if (this.isTauri()) {
      try {
        const result = (await invoke('replace_text', {
          newText,
          restoreOriginalClipboard: true,
          hideWindow,
        })) as TauriReplacerResult;

        if (result.success) {
          return {
            success: true,
            replacedLength: result.replacedLength ?? result.replaced_length ?? newText.length,
            restoredClipboard: result.restoredClipboard ?? result.restored_clipboard ?? true,
          };
        }

        const fallbackAllowed = result.safeToCopyFallback ?? result.safe_to_copy_fallback ?? true;
        if (!fallbackAllowed) {
          return {
            success: false,
            fallbackCopied: false,
            error: result.error,
            replacedLength: 0,
          };
        }

        // Rust reported failure (e.g. empty text) — fall back to clipboard copy
        // and tell the UI the truth via fallbackCopied.
        const copied = await this.copyToClipboard(newText);
        return {
          success: false,
          fallbackCopied: copied,
          error: result.error,
          replacedLength: 0,
        };
      } catch (err) {
        console.warn('[TauriTextReplacer] invoke replace_text failed, attempting clipboard copy:', err);
        const copied = await this.copyToClipboard(newText);
        return {
          success: false,
          fallbackCopied: copied,
          error: copied ? undefined : String(err),
          replacedLength: 0,
        };
      }
    }

    // Web Fallback: write to clipboard and attempt document.execCommand if in web preview
    const copied = await this.copyToClipboard(newText);
    return {
      success: copied,
      fallbackCopied: true,
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
