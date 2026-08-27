import { describe, it, expect } from 'vitest';
import { tokenizeText, computeDiff, mergeDiffChunks, DiffChunk } from '../../src/core/diff';

describe('src/core/diff.ts Unit Tests', () => {
  // =========================================================================
  // 1. tokenizeText Tests
  // =========================================================================
  describe('tokenizeText', () => {
    it('should tokenize Chinese characters individually', () => {
      const tokens = tokenizeText('润笔工具');
      expect(tokens).toEqual(['润', '笔', '工', '具']);
    });

    it('should tokenize English words and numbers as whole units', () => {
      const tokens = tokenizeText('Runbi v1 is fast 2026');
      expect(tokens).toEqual(['Runbi', ' ', 'v1', ' ', 'is', ' ', 'fast', ' ', '2026']);
    });

    it('should handle hybrid CJK, English, numbers, and whitespaces', () => {
      const tokens = tokenizeText('这是 Runbi 插件');
      expect(tokens).toEqual(['这', '是', ' ', 'Runbi', ' ', '插', '件']);
    });

    it('should tokenize emojis and symbols properly', () => {
      const tokens = tokenizeText('你好👋世界🌍！');
      expect(tokens).toEqual(['你', '好', '👋', '世', '界', '🌍', '！']);
    });

    it('should return empty array for empty string', () => {
      expect(tokenizeText('')).toEqual([]);
    });
  });

  // =========================================================================
  // 2. computeDiff Tests
  // =========================================================================
  describe('computeDiff', () => {
    it('should return a single equal chunk for identical strings', () => {
      const text = '文本内容完全一致没有任何改动';
      const chunks = computeDiff(text, text);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ type: 'equal', value: text });
    });

    it('should handle pure insertion when original is empty', () => {
      const chunks = computeDiff('', '新插入的润色文本');
      expect(chunks).toEqual([{ type: 'insert', value: '新插入的润色文本' }]);
    });

    it('should handle pure deletion when modified is empty', () => {
      const chunks = computeDiff('需要全部删除的内容', '');
      expect(chunks).toEqual([{ type: 'delete', value: '需要全部删除的内容' }]);
    });

    it('should handle both original and modified being empty', () => {
      const chunks = computeDiff('', '');
      expect(chunks).toEqual([{ type: 'equal', value: '' }]);
    });

    it('should identify pure Chinese character deletions', () => {
      const original = '这个方案整体还行';
      const polished = '这个方案整体';
      const chunks = computeDiff(original, polished);

      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toEqual({ type: 'equal', value: '这个方案整体' });
      expect(chunks[1]).toEqual({ type: 'delete', value: '还行' });
    });

    it('should identify pure Chinese character insertions', () => {
      const original = '方案完备';
      const polished = '方案构架完备';
      const chunks = computeDiff(original, polished);

      expect(chunks).toEqual([
        { type: 'equal', value: '方案' },
        { type: 'insert', value: '构架' },
        { type: 'equal', value: '完备' },
      ]);
    });

    it('should identify replacements with delete and insert', () => {
      const original = '方案还行';
      const polished = '方案构架完备';
      const chunks = computeDiff(original, polished);

      expect(chunks[0]).toEqual({ type: 'equal', value: '方案' });
      const del = chunks.find((c) => c.type === 'delete');
      const ins = chunks.find((c) => c.type === 'insert');
      expect(del?.value).toBe('还行');
      expect(ins?.value).toBe('构架完备');
    });

    it('should reconstruct original and modified text perfectly', () => {
      const original = '该方案整体还行，但是细节不太到位。';
      const modified = '该方案整体构架完备，但在执行细节与边界考量上仍有优化空间。';
      const chunks = computeDiff(original, modified);

      const reconstructedOriginal = chunks
        .filter((c) => c.type === 'equal' || c.type === 'delete')
        .map((c) => c.value)
        .join('');
      const reconstructedModified = chunks
        .filter((c) => c.type === 'equal' || c.type === 'insert')
        .map((c) => c.value)
        .join('');

      expect(reconstructedOriginal).toBe(original);
      expect(reconstructedModified).toBe(modified);
    });

    it('should handle English word-level diffs correctly', () => {
      const orig = 'The quick brown fox jumps over the lazy dog';
      const mod = 'The fast brown fox leaped over the sleepy dog';
      const chunks = computeDiff(orig, mod);

      const reconstructedOrig = chunks
        .filter((c) => c.type === 'equal' || c.type === 'delete')
        .map((c) => c.value)
        .join('');
      const reconstructedMod = chunks
        .filter((c) => c.type === 'equal' || c.type === 'insert')
        .map((c) => c.value)
        .join('');

      expect(reconstructedOrig).toBe(orig);
      expect(reconstructedMod).toBe(mod);
    });

    it('should handle large texts (5000 chars) without stack overflow or performance degradation', () => {
      const orig = '原'.repeat(2500) + '中间部分' + '尾'.repeat(2400);
      const mod = '原'.repeat(2500) + '修改后内容' + '尾'.repeat(2400);
      const startTime = Date.now();
      const chunks = computeDiff(orig, mod);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000); // Must be fast
      expect(chunks.length).toBeGreaterThanOrEqual(3);
      expect(chunks.some((c) => c.type === 'delete' && c.value === '中间部分')).toBe(true);
      expect(chunks.some((c) => c.type === 'insert' && c.value === '修改后内容')).toBe(true);
    });
  });

  // =========================================================================
  // 3. mergeDiffChunks Tests
  // =========================================================================
  describe('mergeDiffChunks', () => {
    it('should merge contiguous chunks of identical type', () => {
      const raw: DiffChunk[] = [
        { type: 'equal', value: '这是' },
        { type: 'equal', value: '一段' },
        { type: 'delete', value: '旧' },
        { type: 'delete', value: '文字' },
        { type: 'insert', value: '新' },
        { type: 'insert', value: '内容' },
      ];

      const merged = mergeDiffChunks(raw);
      expect(merged).toEqual([
        { type: 'equal', value: '这是一段' },
        { type: 'delete', value: '旧文字' },
        { type: 'insert', value: '新内容' },
      ]);
    });

    it('should filter out empty value chunks', () => {
      const raw: DiffChunk[] = [
        { type: 'equal', value: '有效' },
        { type: 'delete', value: '' },
        { type: 'insert', value: '' },
        { type: 'insert', value: '新' },
      ];

      const merged = mergeDiffChunks(raw);
      expect(merged).toEqual([
        { type: 'equal', value: '有效' },
        { type: 'insert', value: '新' },
      ]);
    });
  });
});
