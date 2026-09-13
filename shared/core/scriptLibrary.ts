/**
 * @file shared/core/scriptLibrary.ts
 * Built-in Script Template Library — lazy ?raw loader + filtering + industry/platform matching.
 * 100% Pure Logic — Platform Agnostic
 */

import type { ScriptLibraryData, ScriptPhase, ScriptTemplate } from '../types/library';

let cache: Promise<ScriptLibraryData> | null = null;

/** Lazy-load the bundled template data (?raw keeps the ~1MB JSON out of the main chunk). */
export function loadScriptLibrary(): Promise<ScriptLibraryData> {
  // 失败时清缓存，否则浮层的「重试」按钮拿到的永远是同一个 rejected promise
  cache ??= (async () => {
    const mod = (await import('../data/script-templates.json?raw')) as unknown as { default: string };
    return JSON.parse(mod.default) as ScriptLibraryData;
  })().catch((e: unknown) => {
    cache = null;
    throw e;
  });
  return cache;
}

export interface TemplateFilter {
  query?: string;
  industry?: string;
  platform?: string;
  phase?: ScriptPhase;
  limit?: number;
}

/**
 * 中文模板判定：中文字符数 > 0 且达到拉丁字母数的一半。
 * 排除"英文正文夹 [订单号] 等中文占位符"的模板——它们作为「参考生成」的参考
 * 会把输出带成英文（默认只推中文的依据）。
 */
export function isChineseTemplate(item: ScriptTemplate): boolean {
  const t = item.template || '';
  const cjk = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
  const latin = (t.match(/[a-zA-Z]/g) || []).length;
  return cjk > 0 && cjk * 2 >= latin;
}

/** undefined filter fields = no constraint; query = lowercase substring over title+scenario+template. */
export function filterTemplates(data: ScriptLibraryData, filter: TemplateFilter): ScriptTemplate[] {
  const q = filter.query?.toLowerCase();
  const limit = filter.limit ?? Infinity;
  const out: ScriptTemplate[] = [];
  for (const item of data.items) {
    if (filter.industry !== undefined && item.industry !== filter.industry) continue;
    if (filter.platform !== undefined && item.platform !== filter.platform) continue;
    if (filter.phase !== undefined && item.phase !== filter.phase) continue;
    if (q !== undefined && !`${item.sectionTitle}${item.scenario}${item.template}`.toLowerCase().includes(q)) continue;
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** 行业别名 → slug，用于标签匹配不到时的兜底。 */
const INDUSTRY_ALIASES: Record<string, string[]> = {
  tea: ['普洱', '龙井', '乌龙茶'],
  skincare: ['护肤', '面膜', '精华液'],
  makeup: ['口红', '粉底'],
  maternity: ['月子', '孕期'],
  toys: ['乐高'],
  diapers: ['纸尿裤'],
};

/** Match free text (user hint) to an industry by label (longest first) then alias. */
export function matchIndustry(data: ScriptLibraryData, hintText: string): { slug: string; label: string } | null {
  const q = hintText.toLowerCase();
  for (const [slug, label] of Object.entries(data.industries).sort((a, b) => b[1].length - a[1].length)) {
    if (slug !== 'general' && q.includes(label.toLowerCase())) return { slug, label };
  }
  for (const [slug, aliases] of Object.entries(INDUSTRY_ALIASES)) {
    if (aliases.some((a) => q.includes(a.toLowerCase()))) return { slug, label: data.industries[slug] ?? slug };
  }
  return null;
}

/** Match free text (user hint) to a platform by label (longest first). */
export function matchPlatform(data: ScriptLibraryData, hintText: string): { slug: string; label: string } | null {
  const q = hintText.toLowerCase();
  for (const [slug, label] of Object.entries(data.platforms).sort((a, b) => b[1].length - a[1].length)) {
    if (slug !== 'general' && q.includes(label.toLowerCase())) return { slug, label };
  }
  return null;
}

/**
 * Builds a compact reference script prompt from the script library for Chat Copilot / Auto Reply.
 * Supports auto-detection based on hint keywords or specific category filtering.
 */
export function buildCopilotScriptPrompt(
  data: ScriptLibraryData | null | undefined,
  categoryOrAuto: string = 'auto',
  queryHint?: string
): string {
  if (!data || !data.items || data.items.length === 0) return '';

  const chineseTemplates = data.items.filter(isChineseTemplate);
  let matched: ScriptTemplate[] = [];

  const category = (categoryOrAuto || 'auto').trim();
  if (category !== 'auto' && category !== '') {
    // Specific category selected (e.g. 'aftersales', 'presales', 'general', or specific industry)
    matched = chineseTemplates.filter(
      (item) => item.phase === category || item.industry === category || item.platform === category
    );
  }

  // If auto or category search returned empty, use keyword search from queryHint
  if (matched.length === 0 && queryHint && queryHint.trim()) {
    const q = queryHint.trim().toLowerCase();
    matched = chineseTemplates.filter((item) =>
      `${item.sectionTitle} ${item.scenario} ${item.template}`.toLowerCase().includes(q)
    );
  }

  // If still no specific match, fallback to general Chinese templates
  if (matched.length === 0) {
    matched = chineseTemplates.slice(0, 3);
  }

  // Pick top 2 most relevant templates and format cleanly
  const selected = matched.slice(0, 2);
  const formatted = selected.map((item, idx) => {
    const cleanTemplate = item.template
      .replace(/\[([^\]]+)\]/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    return `【话术参考 ${idx + 1}·${item.sectionTitle || item.scenario}】：${cleanTemplate}`;
  });

  return formatted.join('\n');
}

