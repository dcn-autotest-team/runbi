/**
 * @file shared/types/selection.ts
 * Unified Selection and Coordinate Interface Contracts
 * Multi-Platform: Chrome Extension (DOM) & Desktop (Tauri 2.x / OS Selection)
 */

/**
 * Platform-agnostic 2D rectangle / bounding box.
 * Structurally compatible with browser DOMRect and OS screen coordinates.
 */
export interface SelectionRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width?: number;
  height?: number;
}

/**
 * Calculated viewport or screen positioning coordinates for floating UI elements
 * (TriggerCapsule, PolishPanel, Raycast floating window).
 */
export interface PositionCoordinates {
  top: number;
  left: number;
  placement: 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left' | string;
}

/**
 * Physical or virtual monitor working area bounding geometry.
 * Used for multi-monitor desktop positioning and window clamping.
 */
export interface MonitorWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor?: number;
}

/**
 * Unified text selection metadata payload.
 * Encapsulates the selected text, bounding rect, editable state, and optional DOM/OS handles.
 */
export interface SelectionInfo {
  /**
   * Trimmed text content ready for polishing.
   */
  text: string;

  /**
   * Exact original text including leading/trailing whitespaces and line breaks.
   */
  rawText: string;

  /**
   * Bounding rectangle of the selection in viewport/screen coordinates.
   */
  rect: SelectionRect;

  /**
   * Indicates whether the target element/source supports in-place text replacement.
   */
  isEditable: boolean;

  /**
   * Browser DOM element reference (null in Desktop / Headless environments).
   */
  targetElement?: HTMLElement | null | unknown;

  /**
   * Browser DOM Range reference (null in Desktop / Headless environments).
   */
  savedRange?: Range | null | unknown;

  /**
   * Optional surrounding text context for smarter AI disambiguation.
   */
  contextBefore?: string;
  contextAfter?: string;

  /**
   * Source of selection capture ('dom' | 'os_selection' | 'clipboard' | 'api').
   */
  source?: 'dom' | 'os_selection' | 'clipboard' | 'api';

  /**
   * Timestamp when the selection was captured (epoch ms).
   */
  timestamp?: number;

  /**
   * Foreground process/app name at capture time (desktop, e.g. "WeChat.exe").
   * Used by the context auto-sense classifier.
   */
  sourceApp?: string;

  /**
   * Foreground window title at capture time (desktop).
   */
  windowTitle?: string;
}

/**
 * Reason codes when selection validation fails.
 */
export type SelectionInvalidReason = 'EMPTY' | 'TOO_SHORT' | 'TOO_LONG';

/**
 * Result returned by selection validation engine.
 */
export interface SelectionValidationResult {
  valid: boolean;
  text: string;
  rawText: string;
  reason?: SelectionInvalidReason;
}

/**
 * Constants for selection validation boundaries.
 */
export const MIN_SELECTION_LENGTH = 2;
export const MAX_SELECTION_LENGTH = 5000;
export const DEFAULT_DEBOUNCE_MS = 150;
