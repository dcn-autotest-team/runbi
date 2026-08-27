/**
 * @file shared/adapters/selection.ts
 * Selection Provider Abstract Interface Contract
 * Multi-Platform Inversion-of-Control (IoC) Definition
 */

import type { SelectionInfo } from '../types/selection';

/**
 * Platform adapter contract for capturing and observing text selections.
 * - Chrome Extension implementation: captures DOM Selection / Input selection.
 * - Desktop Tauri implementation: simulates Ctrl+C / GetSelection API on active window.
 */
export interface ISelectionProvider {
  /**
   * Retrieves the current text selection and its bounding coordinates / context.
   * Returns null if no active or valid selection is present.
   */
  getSelection(): Promise<SelectionInfo | null>;

  /**
   * Subscribes to selection change events (optional for push-based selection like browser DOM).
   * Returns an unbind / unsubscribe function to cleanly remove event listeners.
   */
  subscribeToSelectionChange?(callback: (selection: SelectionInfo | null) => void): () => void;

  /**
   * Clears or cancels the active selection in the host environment.
   */
  clearSelection(): Promise<void>;
}
