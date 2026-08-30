/**
 * @file shared/types/library.ts
 * Built-in Script Template Library & Expert Agent Library Types
 */

/** 售前/售中/售后 phase of a customer-service script. */
export type ScriptPhase = 'presales' | 'sales' | 'aftersales';

export interface ScriptTemplate {
  id: string;
  /** 模板标题，如「退货政策说明」 */
  sectionTitle: string;
  /** 适用场景描述，如「客户询问退货政策」 */
  scenario: string;
  phase: ScriptPhase;
  /** 话术正文，含 [变量] 占位符 */
  template: string;
  /** 模板中的 [变量] 列表 */
  variables: string[];
  /** 来源分组：general(通用) | industry(行业) | platform(平台) */
  group: 'general' | 'industry' | 'platform';
  /** 平台 slug，见 ScriptLibraryData.platforms */
  platform: string;
  /** 行业 slug，见 ScriptLibraryData.industries */
  industry: string;
}

export interface ScriptLibraryData {
  source?: string;
  industries: Record<string, string>;
  platforms: Record<string, string>;
  scenes: Record<string, string>;
  items: ScriptTemplate[];
}

export interface ExpertAgent {
  id: string;
  name: string;
  emoji: string;
  description: string;
  /** 分类目录 slug，见 ExpertLibraryData.categories */
  category: string;
  /** 完整专家提示词正文 */
  body: string;
}

export interface ExpertLibraryData {
  source?: string;
  categories: Record<string, string>;
  agents: ExpertAgent[];
}
