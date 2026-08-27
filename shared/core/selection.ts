/**
 * @file shared/core/selection.ts
 * Pure Selection Validation, Normalization & Linguistic Statistics
 * 100% Pure Logic — Platform Agnostic (Zero DOM Dependencies)
 */

import type {
  SelectionValidationResult,
  SelectionInvalidReason,
} from '../types/selection';
import {
  MIN_SELECTION_LENGTH,
  MAX_SELECTION_LENGTH,
} from '../types/selection';

export { MIN_SELECTION_LENGTH, MAX_SELECTION_LENGTH };

export interface SelectionStats {
  charCount: number;
  trimmedLength: number;
  cjkCharCount: number;
  wordCount: number;
  lineCount: number;
  estimatedTokens: number;
}

/**
 * Validates text string for length and non-whitespace constraints.
 * Requirements: MIN_SELECTION_LENGTH (2) <= trimmed.length <= MAX_SELECTION_LENGTH (5000)
 */
export function validateSelectionText(
  raw: string | null | undefined,
  minLen: number = MIN_SELECTION_LENGTH,
  maxLen: number = MAX_SELECTION_LENGTH
): SelectionValidationResult {
  if (!raw) {
    return { valid: false, text: '', rawText: '', reason: 'EMPTY' };
  }

  const trimmed = raw.trim();
  if (trimmed.length < minLen) {
    return {
      valid: false,
      text: trimmed,
      rawText: raw,
      reason: trimmed.length === 0 ? 'EMPTY' : 'TOO_SHORT',
    };
  }

  if (trimmed.length > maxLen) {
    return {
      valid: false,
      text: trimmed,
      rawText: raw,
      reason: 'TOO_LONG',
    };
  }

  return {
    valid: true,
    text: trimmed,
    rawText: raw,
  };
}

/**
 * Normalizes selection text by standardizing line breaks (CRLF -> LF)
 * and stripping non-printable control characters.
 */
export function normalizeSelectionText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Calculates linguistic and token statistics for selected text.
 */
export function getSelectionStats(text: string): SelectionStats {
  if (!text) {
    return {
      charCount: 0,
      trimmedLength: 0,
      cjkCharCount: 0,
      wordCount: 0,
      lineCount: 0,
      estimatedTokens: 0,
    };
  }

  const trimmed = text.trim();
  const cjkMatches = text.match(/[\u4e00-\u9fa5\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/g);
  const cjkCharCount = cjkMatches ? cjkMatches.length : 0;

  const latinMatches = text.match(/[a-zA-Z0-9_-]+/g);
  const wordCount = (latinMatches ? latinMatches.length : 0) + cjkCharCount;

  const lineCount = text.split(/\r\n|\r|\n/).length;

  // Approximate token count: 1 CJK char ≈ 1 token, 1 Latin word ≈ 1.3 tokens
  const estimatedTokens = Math.ceil(
    cjkCharCount + (latinMatches ? latinMatches.length * 1.3 : 0)
  );

  return {
    charCount: text.length,
    trimmedLength: trimmed.length,
    cjkCharCount,
    wordCount,
    lineCount,
    estimatedTokens: Math.max(1, estimatedTokens),
  };
}
