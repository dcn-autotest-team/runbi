/**
 * @file tests/unit/shared-selection.test.ts
 * Unit tests for Pure Selection Validation & Linguistic Statistics (@runbi/shared/core/selection)
 */

import { describe, it, expect } from 'vitest';
import {
  validateSelectionText,
  normalizeSelectionText,
  getSelectionStats,
  MIN_SELECTION_LENGTH,
  MAX_SELECTION_LENGTH,
} from '@runbi/shared/core/selection';

describe('Shared Core: Selection Validation & Linguistics Engine', () => {
  describe('validateSelectionText', () => {
    it('should return valid=false with EMPTY reason for null, undefined, or empty string', () => {
      expect(validateSelectionText(null)).toEqual({
        valid: false,
        text: '',
        rawText: '',
        reason: 'EMPTY',
      });

      expect(validateSelectionText(undefined)).toEqual({
        valid: false,
        text: '',
        rawText: '',
        reason: 'EMPTY',
      });

      expect(validateSelectionText('')).toEqual({
        valid: false,
        text: '',
        rawText: '',
        reason: 'EMPTY',
      });

      expect(validateSelectionText('   \n\t  ')).toEqual({
        valid: false,
        text: '',
        rawText: '   \n\t  ',
        reason: 'EMPTY',
      });
    });

    it('should return valid=false with TOO_SHORT reason for 1-character string', () => {
      const result = validateSelectionText(' a ');
      expect(result.valid).toBe(false);
      expect(result.text).toBe('a');
      expect(result.rawText).toBe(' a ');
      expect(result.reason).toBe('TOO_SHORT');
    });

    it('should return valid=true for valid string within boundaries (2 to 5000 chars)', () => {
      const result = validateSelectionText('  润笔  ');
      expect(result.valid).toBe(true);
      expect(result.text).toBe('润笔');
      expect(result.rawText).toBe('  润笔  ');
      expect(result.reason).toBeUndefined();
    });

    it('should return valid=false with TOO_LONG reason when exceeding MAX_SELECTION_LENGTH', () => {
      const longText = 'a'.repeat(MAX_SELECTION_LENGTH + 1);
      const result = validateSelectionText(longText);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('TOO_LONG');
    });

    it('should allow custom minLen and maxLen parameters', () => {
      expect(validateSelectionText('abc', 5, 10)).toEqual({
        valid: false,
        text: 'abc',
        rawText: 'abc',
        reason: 'TOO_SHORT',
      });

      expect(validateSelectionText('abcdef', 2, 4)).toEqual({
        valid: false,
        text: 'abcdef',
        rawText: 'abcdef',
        reason: 'TOO_LONG',
      });

      expect(validateSelectionText('abcd', 2, 4)).toEqual({
        valid: true,
        text: 'abcd',
        rawText: 'abcd',
      });
    });
  });

  describe('normalizeSelectionText', () => {
    it('should return empty string for empty input', () => {
      expect(normalizeSelectionText('')).toBe('');
    });

    it('should normalize CRLF and CR linebreaks to LF', () => {
      const input = 'Line 1\r\nLine 2\rLine 3\nLine 4';
      const output = normalizeSelectionText(input);
      expect(output).toBe('Line 1\nLine 2\nLine 3\nLine 4');
    });

    it('should strip non-printable ASCII control characters but preserve tab and newline', () => {
      const input = 'Valid text\x00\x07\x1B\t\nwith controls\x7F';
      const output = normalizeSelectionText(input);
      expect(output).toBe('Valid text\t\nwith controls');
    });
  });

  describe('getSelectionStats', () => {
    it('should return zero stats for empty string', () => {
      const stats = getSelectionStats('');
      expect(stats).toEqual({
        charCount: 0,
        trimmedLength: 0,
        cjkCharCount: 0,
        wordCount: 0,
        lineCount: 0,
        estimatedTokens: 0,
      });
    });

    it('should accurately calculate CJK character and word count', () => {
      const text = '润笔 Runbi 助力科研 123';
      const stats = getSelectionStats(text);

      expect(stats.charCount).toBe(text.length);
      expect(stats.trimmedLength).toBe(text.length);
      expect(stats.cjkCharCount).toBe(6); // 润, 笔, 助, 力, 科, 研
      // latin words: 'Runbi', '123' (2) + 6 CJK = 8
      expect(stats.wordCount).toBe(8);
      expect(stats.lineCount).toBe(1);
      expect(stats.estimatedTokens).toBeGreaterThanOrEqual(6);
    });

    it('should calculate multiline counts accurately', () => {
      const text = '第一行\n第二行\r\n第三行';
      const stats = getSelectionStats(text);
      expect(stats.lineCount).toBe(3);
    });
  });
});
