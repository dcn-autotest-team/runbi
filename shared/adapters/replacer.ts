/**
 * @file shared/adapters/replacer.ts
 * Text Replacer Abstract Interface Contract
 * Multi-Platform Inversion-of-Control (IoC) Definition
 */

import type { SelectionInfo } from '../types/selection';

/**
 * Result payload returned after an in-place text replacement attempt.
 */
export interface ReplacementResult {
  /**
   * Whether the replacement succeeded.
   */
  success: boolean;

  /**
   * Error message if the replacement failed.
   */
  error?: string;

  /**
   * Number of characters written.
   */
  replacedLength?: number;

  /**
   * Whether the previous clipboard state was restored (in Desktop simulation).
   */
  restoredClipboard?: boolean;

  /**
   * True when pasting failed but the text was copied to the clipboard as a
   * fallback — the UI must NOT claim "已贴回原文" in this case.
   */
  fallbackCopied?: boolean;
}

/**
 * Platform adapter contract for in-place text replacement and clipboard operations.
 * - Chrome Extension implementation: replaces text in DOM <textarea>, <input>, or [contenteditable].
 * - Desktop Tauri implementation: writes to system clipboard and simulates Ctrl+V via Win32 SendInput.
 */
export interface ITextReplacer {
  /**
   * Replaces the selected text with the new polished text.
   *
   * @param newText - The replacement string to insert.
   * @param context - Optional selection metadata context from ISelectionProvider.
   * @param hideWindow - Desktop only: hide the panel window before pasting so the
   *   target app regains focus. Extensions ignore it.
   * @returns Promise resolving to ReplacementResult.
   */
  replaceText(newText: string, context?: SelectionInfo | null, hideWindow?: boolean): Promise<ReplacementResult>;

  /**
   * Checks if in-place text replacement is currently possible in the target context.
   *
   * @param context - Optional selection metadata context.
   * @returns Promise resolving to true if replacement can be performed.
   */
  canReplace(context?: SelectionInfo | null): Promise<boolean>;

  /**
   * Optional helper to copy text to the platform clipboard directly.
   *
   * @param text - Text string to copy.
   * @returns Promise resolving to boolean success.
   */
  copyToClipboard?(text: string): Promise<boolean>;
}
