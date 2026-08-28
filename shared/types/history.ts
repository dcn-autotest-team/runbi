/**
 * @file shared/types/history.ts
 * Generation History, Draft Snapshots & Revert State Contracts
 * Multi-Platform: Tauri Desktop & Chrome Extension
 */

import type { PolishStyle } from './stream';

/**
 * Single historical record of text polishing or intelligent reply generation.
 */
export interface HistoryRecord {
  /** Unique ID (UUID or timestamp-random) */
  id: string;
  /** Unix timestamp (ms) when created */
  timestamp: number;
  /** Original user selection or chat prompt */
  originalText: string;
  /** Final polished or generated reply text */
  polishedText: string;
  /** Polishing style or 'reply' */
  style: PolishStyle;
  /** Optional custom instruction/prompt specified by user */
  instruction?: string;
  /** Target foreground application name (e.g. WeChat, Feishu) */
  sourceApp?: string;
  /** Target window title */
  windowTitle?: string;
  /** Model used for generation */
  model?: string;
  /** Total tokens consumed */
  tokens?: number;
  /** Generation duration in ms */
  durationMs?: number;
  /** Whether this record was applied/replaced back into host app */
  applied?: boolean;
}

/**
 * Temporary draft snapshot to prevent data loss on accidental window close or crash.
 */
export interface DraftSnapshot {
  timestamp: number;
  originalText: string;
  polishedText?: string;
  currentInstruction?: string;
  activeStyle: PolishStyle;
  sourceApp?: string;
  windowTitle?: string;
}

/**
 * Last replacement snapshot for undo/revert capability.
 */
export interface LastReplacementSnapshot {
  timestamp: number;
  originalText: string;
  replacedText: string;
  sourceApp?: string;
}
