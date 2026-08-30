/**
 * @file shared/core/expertAgents.ts
 * Built-in Expert Agent Library — lazy ?raw loader + filtering + system prompt builder.
 * 100% Pure Logic — Platform Agnostic
 */

import type { ExpertAgent, ExpertLibraryData } from '../types/library';

let cache: Promise<ExpertLibraryData> | null = null;

/** Lazy-load the bundled expert data (?raw keeps the JSON out of the main chunk). */
export function loadExpertLibrary(): Promise<ExpertLibraryData> {
  // 失败时清缓存，否则浮层的「重试」按钮拿到的永远是同一个 rejected promise
  cache ??= (async () => {
    const mod = (await import('../data/expert-agents.json?raw')) as unknown as { default: string };
    return JSON.parse(mod.default) as ExpertLibraryData;
  })().catch((e: unknown) => {
    cache = null;
    throw e;
  });
  return cache;
}

export interface ExpertFilter {
  query?: string;
  category?: string;
  limit?: number;
}

/** undefined/'all' category = all; query = lowercase substring over name+description. */
export function filterExperts(data: ExpertLibraryData, filter: ExpertFilter): ExpertAgent[] {
  const q = filter.query?.toLowerCase();
  const limit = filter.limit ?? 200;
  const out: ExpertAgent[] = [];
  for (const agent of data.agents) {
    if (filter.category !== undefined && filter.category !== 'all' && agent.category !== filter.category) continue;
    if (q !== undefined && !`${agent.name}${agent.description}`.toLowerCase().includes(q)) continue;
    out.push(agent);
    if (out.length >= limit) break;
  }
  return out;
}

/** Curated display order for the category picker. */
export const EXPERT_CATEGORY_ORDER: string[] = [
  'marketing', 'sales', 'support', 'company', 'product', 'design', 'engineering', 'legal',
  'finance', 'hr', 'strategy', 'project-management', 'supply-chain', 'security', 'testing',
  'academic', 'gis', 'game-development', 'spatial-computing', 'paid-media', 'integrations', 'specialized',
];

/** Wrap an expert persona into a ready-to-use system prompt. */
export function buildExpertSystemPrompt(expert: ExpertAgent): string {
  return `你是「${expert.name}」。请严格以下面的专家角色设定，来处理用户交给你的文本任务（默认：润色/改写用户提供的文本，保持原意；若有附加要求则按要求处理）。用该专家的专业视角、行业术语与表达习惯，直接输出处理后的成品文本。\n\n${expert.body}`;
}
