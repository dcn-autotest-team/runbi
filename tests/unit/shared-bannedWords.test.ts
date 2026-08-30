/**
 * @file tests/unit/shared-bannedWords.test.ts
 * 广告法极限词检测最小回归检查
 */

import { describe, it, expect } from 'vitest';
import { BANNED_WORDS, findBannedWords } from '@runbi/shared/core';

describe('Shared Core: Banned Words (广告法极限词)', () => {
  it('should detect banned words in generated replies', () => {
    const hits = findBannedWords('这款产品全网第一，用了彻底根治，代理稳赚不赔！');
    expect(hits).toContain('全网第一');
    expect(hits).toContain('彻底根治');
    expect(hits).toContain('稳赚不赔');
  });

  it('should return empty for clean everyday replies', () => {
    expect(findBannedWords('好的，周五前给你，主体已经跑通了')).toEqual([]);
    // 单独"第一"不在词表中,避免日常误报
    expect(findBannedWords('第一次见面聊得不错，下周约')).toEqual([]);
  });

  it('should keep the word list clean (no dup / no placeholder)', () => {
    expect(new Set(BANNED_WORDS).size).toBe(BANNED_WORDS.length);
    for (const w of BANNED_WORDS) {
      expect(w.length).toBeGreaterThanOrEqual(2);
      expect(w).not.toContain('??');
    }
  });
});

describe('Shared Core: Custom banned words (用户禁忌词合并)', () => {
  it('merges user custom words with the builtin ad-law list', () => {
    const hits = findBannedWords('这个方案纯属废话，稳赚不赔', ['废话', '不靠谱']);
    expect(hits).toContain('稳赚不赔');
    expect(hits).toContain('废话');
    expect(hits).not.toContain('不靠谱');
  });

  it('dedupes custom words already covered by the builtin list', () => {
    const hits = findBannedWords('稳赚不赔', ['稳赚不赔', ' 稳赚不赔 ']);
    expect(hits.filter((w) => w === '稳赚不赔')).toHaveLength(1);
  });
});
