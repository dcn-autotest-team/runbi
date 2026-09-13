/**
 * @file tests/unit/library.test.ts
 * 内置话术库 & 专家库数据管道最小回归检查
 */

import { describe, it, expect, vi } from 'vitest';
import {
  loadScriptLibrary,
  loadExpertLibrary,
  filterTemplates,
  filterExperts,
  isChineseTemplate,
  matchIndustry,
  matchPlatform,
  buildExpertSystemPrompt,
  EXPERT_CATEGORY_ORDER,
  buildCopilotScriptPrompt,
  buildFeishuCopilotSystemPrompt,
} from '@runbi/shared/core';
import type { ScriptLibraryData, ExpertLibraryData } from '@runbi/shared/types';

const PHASES = ['presales', 'sales', 'aftersales'] as const;

describe('Shared Core: Script Library (内置话术库)', () => {
  let data: ScriptLibraryData;

  it('failed load resets cache so the picker retry button can succeed', async () => {
    // 首次解析抛错 → load 拒绝；缓存被清 → 第二次调用重新解析并成功
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(loadScriptLibrary()).rejects.toThrow('boom');
    parseSpy.mockRestore();
    const retried = await loadScriptLibrary();
    expect(retried.items.length).toBeGreaterThan(0);
  });

  it('loads with plausible item count', async () => {
    data = await loadScriptLibrary();
    expect(data.items.length).toBeGreaterThanOrEqual(1400);
    expect(Object.keys(data.industries).length).toBeGreaterThan(20);
    expect(Object.keys(data.platforms).length).toBeGreaterThan(10);
  });

  it('has well-formed unique items', async () => {
    data ??= await loadScriptLibrary();
    const ids = new Set<string>();
    for (const item of data.items) {
      expect(item.template.length).toBeGreaterThan(0);
      expect(PHASES).toContain(item.phase);
      expect(data.industries[item.industry]).toBeTruthy();
      expect(data.platforms[item.platform]).toBeTruthy();
      expect(['general', 'industry', 'platform']).toContain(item.group);
      expect(ids.has(item.id)).toBe(false);
      ids.add(item.id);
    }
  });

  it('filterTemplates matches query and industry', async () => {
    data ??= await loadScriptLibrary();
    const hits = filterTemplates(data, { query: '退货' });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(`${h.sectionTitle}${h.scenario}${h.template}`.toLowerCase()).toContain('退货');
    }
    const teas = filterTemplates(data, { industry: 'tea' });
    expect(teas.length).toBeGreaterThan(0);
    for (const t of teas) expect(t.industry).toBe('tea');
    // limit 生效
    expect(filterTemplates(data, { limit: 5 }).length).toBe(5);
  });

  it('matchIndustry / matchPlatform resolve hints to slugs', async () => {
    data ??= await loadScriptLibrary();
    expect(matchIndustry(data, '这款茶叶适合送礼吗')?.slug).toBe('tea');
    expect(matchPlatform(data, '淘宝客服')?.slug).toBe('taobao');
    expect(matchPlatform(data, 'no match here 在火星购物')).toBeNull();
  });

  it('isChineseTemplate separates Chinese templates from English originals (含中文占位符不算)', async () => {
    data ??= await loadScriptLibrary();
    const zh = data.items.filter(isChineseTemplate);
    expect(zh.length).toBeGreaterThan(500);
    expect(data.items.length - zh.length).toBeGreaterThan(200);
    // 英文正文夹中文占位符 → 判为英文
    expect(isChineseTemplate({
      id: 'x', sectionTitle: 's', scenario: 'c', phase: 'sales',
      template: "Our return policy: [订单号] days from delivery", variables: [], group: 'general', platform: 'general', industry: 'general',
    } as never)).toBe(false);
    expect(isChineseTemplate({
      id: 'y', sectionTitle: 's', scenario: 'c', phase: 'sales',
      template: '亲您好！这款[酒品名称]是明星产品～', variables: [], group: 'general', platform: 'general', industry: 'general',
    } as never)).toBe(true);
  });

  it('filterTemplates without limit returns all matches (回归:曾默认截断 80 条导致弹窗分页失效)', async () => {
    data ??= await loadScriptLibrary();
    expect(filterTemplates(data, {}).length).toBe(data.items.length);
  });

  it('buildCopilotScriptPrompt formats matched script templates and auto-matches intent', async () => {
    data ??= await loadScriptLibrary();
    const autoPrompt = buildCopilotScriptPrompt(data, 'auto', '发票退换货处理');
    expect(autoPrompt).toContain('【话术参考');
    expect(autoPrompt.length).toBeGreaterThan(10);

    const aftersalesPrompt = buildCopilotScriptPrompt(data, 'aftersales');
    expect(aftersalesPrompt).toContain('【话术参考');

    const copilotSys = buildFeishuCopilotSystemPrompt('热情专业', aftersalesPrompt);
    expect(copilotSys).toContain('【参考行业话术规范】');
    expect(copilotSys).toContain('【我的人设风格偏好】');
    expect(copilotSys).toContain('"draft_reply"');
  });
});

describe('Shared Core: Expert Library (专家库)', () => {
  let data: ExpertLibraryData;

  it('loads with plausible agent count', async () => {
    data = await loadExpertLibrary();
    // 上游 AGENT-LIST.md 记录 276 个智能体；仓库里其余 md 为非智能体文档（playbooks/README），按规则跳过
    expect(data.agents.length).toBeGreaterThanOrEqual(270);
    expect(Object.keys(data.categories).length).toBe(22);
    expect(EXPERT_CATEGORY_ORDER).toHaveLength(22);
  });

  it('has well-formed unique agents', async () => {
    data ??= await loadExpertLibrary();
    const ids = new Set<string>();
    for (const agent of data.agents) {
      expect(agent.name.length).toBeGreaterThan(0);
      expect(agent.body.length).toBeGreaterThan(0);
      expect(data.categories[agent.category]).toBeTruthy();
      expect(ids.has(agent.id)).toBe(false);
      ids.add(agent.id);
    }
  });

  it('filterExperts matches query and category', async () => {
    data ??= await loadExpertLibrary();
    const ui = filterExperts(data, { query: 'UI' });
    expect(ui.some((a) => a.id === 'design/design-ui-designer')).toBe(true);
    expect(filterExperts(data, { category: 'engineering' }).length).toBeGreaterThan(0);
    expect(filterExperts(data, { category: 'all', limit: data.agents.length }).length).toBe(data.agents.length);
  });

  it('buildExpertSystemPrompt embeds name and body', async () => {
    data ??= await loadExpertLibrary();
    const agent = data.agents.find((a) => a.id === 'design/design-ui-designer')!;
    const prompt = buildExpertSystemPrompt(agent);
    expect(prompt).toContain(`「${agent.name}」`);
    expect(prompt).toContain(agent.body);
  });
});
