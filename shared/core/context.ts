/**
 * @file shared/core/context.ts
 * Context Auto-Sense & Intent Classifier
 *
 * Automatically detects the user's intent from multi-dimensional signals:
 * 1. Foreground Application (WeChat, Word, Feishu, Browser, IDE)
 * 2. Window Title (Chat, Doc, Meeting Memo, Email)
 * 3. Text Semantic & Linguistic Features (Questions, Academic Terms, Workplace Jargon, English Ratio, Length)
 *
 * Returns the recommended PolishStyle (reply, academic, business, native_en, concise, literary, polished).
 */

import type { PolishStyle } from '../types/stream';

export type ContextMode = 'polish' | 'reply';

export interface ContextSignals {
  /** Captured text. */
  text: string;
  /** Foreground process name, e.g. "WeChat.exe", "WINWORD.EXE" (desktop only). */
  sourceApp?: string;
  /** Foreground window title, e.g. "与张三的聊天", "Q3 业务方案汇报.docx". */
  windowTitle?: string;
}

export interface ContextClassification {
  mode: ContextMode;
  style: PolishStyle;
  confidence: number;
  reason: string;
}

export function getChatAppName(sourceApp?: string | null, windowTitle?: string | null): string {
  const s = (sourceApp || '').toLowerCase();
  const w = (windowTitle || '').toLowerCase();
  if (s.includes('weixin') || s.includes('wechat') || w.includes('微信')) return '微信';
  if (s.includes('feishu') || s.includes('lark') || w.includes('飞书')) return '飞书';
  if (s.includes('dingtalk') || w.includes('钉钉')) return '钉钉';
  if (s.includes('qq') || s.includes('tim') || w.includes('qq')) return 'QQ';
  if (s.includes('slack') || w.includes('slack')) return 'Slack';
  if (s.includes('telegram') || w.includes('telegram')) return 'Telegram';
  if (s.includes('teams') || w.includes('teams')) return 'Teams';
  if (s.includes('wework') || w.includes('企业微信')) return '企业微信';
  if (s.includes('whatsapp') || w.includes('whatsapp')) return 'WhatsApp';
  return '聊天';
}

const CHAT_APP_PATTERN =
  /wechat|weixin|微信|企业微信|dingtalk|钉钉|feishu|lark|飞书|telegram|slack|teams|discord|whatsapp|\bqq|tim\b/i;

const OFFICE_APP_PATTERN =
  /winword|word|powerpnt|powerpoint|excel|outlook|foxmail|wps|kso|notion|onenote/i;

const CHAT_TITLE_PATTERN = /聊天|会话|对话|消息|chat|conversation|群聊/i;
const OFFICE_TITLE_PATTERN = /文档|汇报|周报|月报|方案|纪要|邮件|report|doc|memo|email/i;

const REPLY_PATTERN =
  /(吗[?？]|呢[?？]|吧[?？]|什么时候|怎么办|怎么看|能不能|可不可以|是否可以|请问|帮忙|麻烦你|收到请回复|辛苦|安排一下|几点|谢谢|收到|好的|[?？]|@)/;

const ACADEMIC_PATTERN =
  /(et al\.|abstract|conclusion|methodology|proposed|framework|综上所述|本研究|实证分析|文献综述|实验表明|图表所示|定理|参考文献|数据集|消融实验|损失函数|评估指标|基于.*模型)/i;

const BUSINESS_PATTERN =
  /(汇报|方案|周报|月报|审批|各部门|推进|会议纪要|同步|协同|跟进|KPI|OKR|复盘|对齐|交付|预算|流程|请领导审阅|发函|商务|合作)/i;

const TRANSLATION_PATTERN = /(翻译|translate|英文怎么说|地道英文|中译英|英译中)/i;

const LITERARY_PATTERN =
  /(如诗如画|春水|笔墨|意境|袅袅|落霞|秋水|沉醉|风华|诗意|倾城|烟雨|红尘)/;

/**
 * Multi-dimensional Context & Intent Classifier.
 */
export function classifyContext(signals: ContextSignals): ContextClassification {
  const text = (signals.text || '').trim();
  const sourceApp = signals.sourceApp || '';
  const windowTitle = signals.windowTitle || '';

  // 1. Reply Check (Chat / Instant Messaging / Question / Requests)
  // 无实质内容(纯标点/空白)不应被当沟通措辞送进回复链路
  const hasSubstance = /[a-zA-Z0-9\u4e00-\u9fa5]/.test(text);
  let replyScore = 0;
  const replyReasons: string[] = [];

  if (sourceApp && CHAT_APP_PATTERN.test(sourceApp)) {
    replyScore += 0.6;
    replyReasons.push(`来源应用 ${sourceApp}`);
  }
  if (windowTitle && CHAT_TITLE_PATTERN.test(windowTitle)) {
    replyScore += 0.25;
    replyReasons.push('会话窗口');
  }
  const questionMarks = (text.match(/[?？]/g) || []).length;
  if (hasSubstance && questionMarks > 0) {
    replyScore += Math.min(0.35, 0.2 * questionMarks);
    replyReasons.push('包含疑问标点');
  }
  if (hasSubstance && REPLY_PATTERN.test(text)) {
    replyScore += 0.3;
    replyReasons.push('包含沟通/提问措辞');
  }

  if (replyScore >= 0.5) {
    return {
      mode: 'reply',
      style: 'reply',
      confidence: Math.min(1, replyScore),
      reason: replyReasons.join(' + ') || '检测到沟通会话',
    };
  }

  // 2. English / Translation Check
  if (TRANSLATION_PATTERN.test(text)) {
    return {
      mode: 'polish',
      style: 'native_en',
      confidence: 0.9,
      reason: '包含翻译指令',
    };
  }

  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  const cjkChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const letterTotal = latinChars + cjkChars;
  // Near-pure English only: mixed Chinese text carrying technical tokens
  // (model names, shortcuts, code) must NOT be shipped to the translator.
  if (letterTotal > 20 && cjkChars / letterTotal < 0.15) {
    return {
      mode: 'polish',
      style: 'native_en',
      confidence: 0.85,
      reason: '纯英文文本',
    };
  }

  // 3. Academic Check
  if (ACADEMIC_PATTERN.test(text)) {
    return {
      mode: 'polish',
      style: 'academic',
      confidence: 0.85,
      reason: '学术论文/论证规范术语',
    };
  }

  // 4. Business / Office Check
  let businessScore = 0;
  const businessReasons: string[] = [];

  if (sourceApp && OFFICE_APP_PATTERN.test(sourceApp)) {
    businessScore += 0.5;
    businessReasons.push(`来源办公应用 ${sourceApp}`);
  }
  if (windowTitle && OFFICE_TITLE_PATTERN.test(windowTitle)) {
    businessScore += 0.3;
    businessReasons.push('办公文档窗口');
  }
  if (BUSINESS_PATTERN.test(text)) {
    businessScore += 0.4;
    businessReasons.push('职场商务/公文汇报措辞');
  }

  if (businessScore >= 0.5) {
    return {
      mode: 'polish',
      style: 'business',
      confidence: Math.min(1, businessScore),
      reason: businessReasons.join(' + ') || '职场公文场景',
    };
  }

  // 5. Literary Check
  if (LITERARY_PATTERN.test(text)) {
    return {
      mode: 'polish',
      style: 'literary',
      confidence: 0.8,
      reason: '文学修辞意境',
    };
  }

  // 6. Concise Check (Long Paragraphs >= 350 chars)
  if (text.length >= 350) {
    return {
      mode: 'polish',
      style: 'concise',
      confidence: 0.7,
      reason: '长段落文本',
    };
  }

  // 7. Default Polish
  return {
    mode: 'polish',
    style: 'polished',
    confidence: 0.6,
    reason: '通用润色',
  };
}

/**
 * 微胶囊（Mini Capsule）防误触过滤（缺陷2）：
 * 短选区——无 CJK 时 ≤4 个字符，或有 CJK 时 ≤2 个汉字——多半是双击选词/看字数，
 * 不弹胶囊，静默忽略。
 */
export function shouldSuppressCapsule(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return true;
  const cjk = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (cjk > 0) return cjk <= 2;
  return t.length <= 4;
}
