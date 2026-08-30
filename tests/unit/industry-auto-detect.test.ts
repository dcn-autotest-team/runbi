/**
 * @file tests/unit/industry-auto-detect.test.ts
 * 智能行业识别 detectIndustryPack —— AI 自动决策（迭代2）的核心纯逻辑检查
 */
import { describe, expect, it } from 'vitest';
import { INDUSTRY_PACKS, detectIndustryPack } from '@runbi/shared/types/settings';

describe('detectIndustryPack 智能行业识别', () => {
  it('窗口标题含电商关键词 → 命中微商·私域客服包', () => {
    const pack = detectIndustryPack('淘宝网 - 亲，这款还有库存吗\n客户问发货');
    expect(pack?.id).toBe('we_commerce');
  });

  it('选中文本含法律关键词 → 命中律所·法务咨询包', () => {
    const pack = detectIndustryPack('我想委托律师处理这个案件，需要准备什么证据');
    expect(pack?.id).toBe('legal');
  });

  it('含保险关键词 → 命中房产·保险销售包', () => {
    const pack = detectIndustryPack('这份保单的保费每年多少，理赔流程复杂吗');
    expect(pack?.id).toBe('estate_insurance');
  });

  it('无任何关键词命中 → 返回 null（调用方回退通用行为）', () => {
    expect(detectIndustryPack('帮我润色一下这段周报')).toBeNull();
    expect(detectIndustryPack('')).toBeNull();
  });

  it('auto 选项存在且为推荐默认，通用包不含行业关键词', () => {
    expect(INDUSTRY_PACKS[0].id).toBe('auto');
    expect(INDUSTRY_PACKS[0].sceneHint).toBe('');
    expect(INDUSTRY_PACKS.find((p) => p.id === 'general')?.autoKeywords ?? []).toHaveLength(0);
  });
});
