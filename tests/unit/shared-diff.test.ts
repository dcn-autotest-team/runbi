/**
 * @file tests/unit/shared-diff.test.ts
 * Unit tests for Multilingual CJK-Aware Myers Diff Engine (@runbi/shared/core/diff)
 */

import { describe, it, expect } from 'vitest';
import {
  tokenizeText,
  computeDiff,
  mergeDiffChunks,
  computeDiffStats,
  reconstructOriginal,
  reconstructPolished,
  formatInlineDiff,
} from '@runbi/shared/core/diff';

describe('Shared Core: Multilingual CJK-Aware Myers Diff Engine', () => {
  describe('tokenizeText', () => {
    it('should return empty array for empty or null string', () => {
      expect(tokenizeText('')).toEqual([]);
    });

    it('should tokenize CJK characters individually', () => {
      const tokens = tokenizeText('润笔系统');
      expect(tokens).toEqual(['润', '笔', '系', '统']);
    });

    it('should tokenize Japanese Hiragana and Katakana individually', () => {
      const tokens = tokenizeText('あいうカキク');
      expect(tokens).toEqual(['あ', 'い', 'う', 'カ', 'キ', 'ク']);
    });

    it('should tokenize Korean Hangul characters individually', () => {
      const tokens = tokenizeText('안녕하세요');
      expect(tokens).toEqual(['안', '녕', '하', '세', '요']);
    });

    it('should tokenize English / Latin words as contiguous tokens', () => {
      const tokens = tokenizeText('Runbi is awesome!');
      expect(tokens).toEqual(['Runbi', ' ', 'is', ' ', 'awesome', '!']);
    });

    it('should preserve multi-byte emojis as single atomic units', () => {
      const tokens = tokenizeText('润笔 🚀 ✨');
      expect(tokens).toEqual(['润', '笔', ' ', '🚀', ' ', '✨']);
    });

    it('should handle mixed CJK, Latin, numbers, punctuation and spaces', () => {
      const tokens = tokenizeText('润笔 Runbi v2.0 版本！');
      expect(tokens).toEqual(['润', '笔', ' ', 'Runbi', ' ', 'v2', '.', '0', ' ', '版', '本', '！']);
    });
  });

  describe('computeDiff - Fast Paths & Basics', () => {
    it('should return single equal chunk for identical texts', () => {
      const text = '今天天气非常好，阳光明媚。';
      const chunks = computeDiff(text, text);
      expect(chunks).toEqual([{ type: 'equal', value: text }]);
    });

    it('should handle empty original as pure insertion', () => {
      const chunks = computeDiff('', '新增加的文字');
      expect(chunks).toEqual([{ type: 'insert', value: '新增加的文字' }]);
    });

    it('should handle empty polished as pure deletion', () => {
      const chunks = computeDiff('被删除的文字', '');
      expect(chunks).toEqual([{ type: 'delete', value: '被删除的文字' }]);
    });

    it('should return single equal chunk for two empty strings', () => {
      const chunks = computeDiff('', '');
      expect(chunks).toEqual([{ type: 'equal', value: '' }]);
    });
  });

  describe('computeDiff - CJK and Multilingual Changes', () => {
    it('should accurately detect character-level CJK replacement', () => {
      const original = '该方案还行，但是细节不太到位。';
      const polished = '该方案完备，但在执行细节上有优化空间。';

      const chunks = computeDiff(original, polished);

      expect(chunks.length).toBeGreaterThan(1);
      expect(reconstructOriginal(chunks)).toBe(original);
      expect(reconstructPolished(chunks)).toBe(polished);

      const hasDeletes = chunks.some((c) => c.type === 'delete');
      const hasInserts = chunks.some((c) => c.type === 'insert');
      const hasEquals = chunks.some((c) => c.type === 'equal');

      expect(hasDeletes).toBe(true);
      expect(hasInserts).toBe(true);
      expect(hasEquals).toBe(true);
    });

    it('should handle Latin word-level additions and deletions', () => {
      const original = 'The fast brown fox jumps.';
      const polished = 'The quick brown fox leaps over.';

      const chunks = computeDiff(original, polished);
      expect(reconstructOriginal(chunks)).toBe(original);
      expect(reconstructPolished(chunks)).toBe(polished);
    });

    it('should handle mixed CJK and English transformations', () => {
      const original = '使用 DeepSeek 进行 prompt 调优';
      const polished = '利用 DeepSeek-V3 对 Prompt 进行深度调优';

      const chunks = computeDiff(original, polished);
      expect(reconstructOriginal(chunks)).toBe(original);
      expect(reconstructPolished(chunks)).toBe(polished);
    });
  });

  describe('Prefix and Suffix Optimization & Large Text Performance', () => {
    it('should execute in linear time for large texts with localized middle edits', () => {
      const prefix = '一'.repeat(1000);
      const suffix = '二'.repeat(1000);
      const original = prefix + '旧' + suffix;
      const polished = prefix + '新' + suffix;

      const t0 = performance.now();
      const chunks = computeDiff(original, polished);
      const elapsed = performance.now() - t0;

      expect(elapsed).toBeLessThan(50); // fast < 50ms
      expect(reconstructOriginal(chunks)).toBe(original);
      expect(reconstructPolished(chunks)).toBe(polished);
      expect(chunks[0]).toEqual({ type: 'equal', value: prefix });
      expect(chunks[chunks.length - 1]).toEqual({ type: 'equal', value: suffix });
    });
  });

  describe('mergeDiffChunks', () => {
    it('should merge contiguous chunks of the same type and remove empty chunks', () => {
      const raw = [
        { type: 'equal' as const, value: 'Hello' },
        { type: 'equal' as const, value: ' World' },
        { type: 'delete' as const, value: '' },
        { type: 'delete' as const, value: 'foo' },
        { type: 'delete' as const, value: 'bar' },
        { type: 'insert' as const, value: 'baz' },
      ];

      const merged = mergeDiffChunks(raw);
      expect(merged).toEqual([
        { type: 'equal', value: 'Hello World' },
        { type: 'delete', value: 'foobar' },
        { type: 'insert', value: 'baz' },
      ]);
    });
  });

  describe('computeDiffStats', () => {
    it('should calculate accurate character stats and changeRatio', () => {
      const original = '润色前';
      const polished = '润色之后的文本';
      const stats = computeDiffStats(original, polished);

      expect(stats.originalCharCount).toBe(3);
      expect(stats.polishedCharCount).toBe(7);
      expect(stats.unchanged).toBe(2); // '润色'
      expect(stats.deletions).toBe(1); // '前'
      expect(stats.insertions).toBe(5); // '之后的文本'
      expect(stats.changeRatio).toBeGreaterThan(0);
      expect(stats.changeRatio).toBeLessThanOrEqual(1);
    });

    it('should return zero changeRatio for identical texts', () => {
      const text = '保持不变的文本';
      const stats = computeDiffStats(text, text);
      expect(stats.insertions).toBe(0);
      expect(stats.deletions).toBe(0);
      expect(stats.unchanged).toBe(text.length);
      expect(stats.changeRatio).toBe(0);
    });
  });

  describe('formatInlineDiff', () => {
    it('should annotate deletions with [- -] and insertions with {+ +}', () => {
      const chunks = [
        { type: 'equal' as const, value: '这是' },
        { type: 'delete' as const, value: '旧' },
        { type: 'insert' as const, value: '新' },
        { type: 'equal' as const, value: '内容' },
      ];

      const inline = formatInlineDiff(chunks);
      expect(inline).toBe('这是[-旧-]{+新+}内容');
    });
  });
});
