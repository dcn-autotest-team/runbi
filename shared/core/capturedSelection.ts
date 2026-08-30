/**
 * @file shared/core/capturedSelection.ts
 * Contract for the `runbi://captured-selection` Tauri event payload.
 *
 * Three Rust emit sites (regression contract — keep in sync):
 *   - main.rs              trigger: screen-reply | shortcut | sensitive-blocked
 *                          keys: text, sourceApp, windowTitle, hasScreenshot, trigger
 *   - commands/mouse_hook.rs   trigger: selection, capsule: true
 *   - commands/clipboard_monitor.rs  trigger: clipboard, capsule: true
 *                          (screenshot key instead of hasScreenshot)
 *
 * Regression note (2026-08-29): the frontend gates screen-reply on
 * `trigger === 'screen-reply' && hasScreenshot`. The screenshot JPEG encoder
 * failed silently for weeks (RGBA8), so hasScreenshot was always false and
 * the panel never opened. These tests pin the exact payload shapes.
 */

export type CapturedSelectionTrigger =
  | 'screen-reply'
  | 'shortcut'
  | 'selection'
  | 'clipboard'
  | 'sensitive-blocked';

export interface CapturedSelectionPayload {
  text: string;
  sourceApp: string | null;
  windowTitle: string | null;
  /** true when Rust captured a screenshot BEFORE showing the panel */
  hasScreenshot?: boolean;
  /** legacy key (clipboard_monitor): full data URL or null */
  screenshot?: string | null;
  /** Selection and clipboard entry points must render the compact toolbar. */
  capsule?: boolean;
  trigger: CapturedSelectionTrigger;
}

/** Screen-reply gate: chat app foreground, no selection, screenshot captured. */
export function isScreenReplyPayload(
  payload: Partial<CapturedSelectionPayload> | null | undefined,
): boolean {
  return payload?.trigger === 'screen-reply' && Boolean(payload.hasScreenshot);
}
