/**
 * @file shared/types/diff.ts
 * Multilingual CJK-Aware Myers Diff Type Definitions
 * Multi-Platform: Chrome Extension & Desktop Client
 */

/**
 * Type of textual edit operation in diff output.
 */
export type DiffType = 'equal' | 'delete' | 'insert';

/**
 * Individual atomic diff chunk.
 */
export interface DiffChunk {
  type: DiffType;
  value: string;
}

/**
 * Statistical summary of diff changes between original and polished text.
 */
export interface DiffStats {
  insertions: number;
  deletions: number;
  unchanged: number;
  originalCharCount: number;
  polishedCharCount: number;
  changeRatio: number;
}

/**
 * Configuration options for Myers diff calculation.
 */
export interface DiffOptions {
  /**
   * Whether to treat contiguous whitespace sequences as single tokens.
   * Default: false
   */
  ignoreWhitespace?: boolean;

  /**
   * Enable CJK-aware segmentation (character-level for CJK, word-level for Latin).
   * Default: true
   */
  cjkAware?: boolean;
}
