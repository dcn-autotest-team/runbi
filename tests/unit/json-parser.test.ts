/**
 * @file tests/unit/json-parser.test.ts
 * Unit tests for Robust LLM JSON Parser (parseModelJson)
 */

import { describe, it, expect } from 'vitest';
import { parseModelJson, extractCleanDraftReply, isInternalOrNegativeReply } from '@runbi/shared/core';

describe('Shared Core: Robust LLM JSON Parser (parseModelJson)', () => {
  it('should parse standard valid JSON object', () => {
    const raw = JSON.stringify({
      has_new_question: true,
      latest_message_from: 'other',
      suggested_reply: '收到，马上处理！',
    });
    const parsed = parseModelJson<any>(raw);
    expect(parsed.has_new_question).toBe(true);
    expect(parsed.latest_message_from).toBe('other');
    expect(parsed.suggested_reply).toBe('收到，马上处理！');
  });

  it('should parse raw output wrapped in markdown ```json code block', () => {
    const raw = `
这里是分析结果：
\`\`\`json
{
  "has_new_question": false,
  "latest_message_from": "none",
  "suggested_reply": ""
}
\`\`\`
请参考。
`;
    const parsed = parseModelJson<any>(raw);
    expect(parsed.has_new_question).toBe(false);
    expect(parsed.latest_message_from).toBe('none');
  });

  it('should strip <think> reasoning blocks before parsing', () => {
    const raw = `
<think>
用户发了一张截图，底部是一句表情包，无需回复。
has_new_question 应为 false。
</think>
{
  "has_new_question": false,
  "latest_message_from": "other"
}
`;
    const parsed = parseModelJson<any>(raw);
    expect(parsed.has_new_question).toBe(false);
    expect(parsed.latest_message_from).toBe('other');
  });

  it('should parse YAML-style key-values without outer braces (The reported bug scenario)', () => {
    // The exact error reported by user: Unexpected token 'h', "has_new_qu"... is not valid JSON
    const raw = `has_new_question: false
latest_message_from: none
latest_message_text: 好的收到
question_summary:
suggested_reply:
`;
    const parsed = parseModelJson<any>(raw);
    expect(parsed.has_new_question).toBe(false);
    expect(parsed.latest_message_from).toBe('none');
    expect(parsed.latest_message_text).toBe('好的收到');
  });

  it('should parse JSON keys without outer braces', () => {
    const raw = `"has_new_question": true,
"latest_message_from": "other",
"suggested_reply": "没问题"`;
    const parsed = parseModelJson<any>(raw);
    expect(parsed.has_new_question).toBe(true);
    expect(parsed.latest_message_from).toBe('other');
    expect(parsed.suggested_reply).toBe('没问题');
  });

  it('should auto-repair unquoted keys and single quotes', () => {
    const raw = `{
  has_new_question: false,
  latest_message_from: 'none',
  suggested_reply: '好的',
}`;
    const parsed = parseModelJson<any>(raw);
    expect(parsed.has_new_question).toBe(false);
    expect(parsed.latest_message_from).toBe('none');
    expect(parsed.suggested_reply).toBe('好的');
  });

  it('should auto-repair unquoted word literals like other / me / none', () => {
    const raw = `{
  "has_new_question": false,
  "latest_message_from": none
}`;
    const parsed = parseModelJson<any>(raw);
    expect(parsed.has_new_question).toBe(false);
    expect(parsed.latest_message_from).toBe('none');
  });

  it('should auto-repair truncated JSON missing closing brace', () => {
    const raw = `{
  "has_new_question": true,
  "suggested_reply": "正在为您查询"`;
    const parsed = parseModelJson<any>(raw);
    expect(parsed.has_new_question).toBe(true);
    expect(parsed.suggested_reply).toBe('正在为您查询');
  });

  it('should normalize Chinese/loose boolean values', () => {
    const raw = `has_new_question: 否
latest_message_from: other
suggested_reply: 好的`;
    const parsed = parseModelJson<any>(raw);
    expect(parsed.has_new_question).toBe(false);
    expect(parsed.latest_message_from).toBe('other');
  });

  describe('extractCleanDraftReply', () => {
    it('returns direct plain text draft_reply', () => {
      const parsed = { draft_reply: '好的，我马上跟进处理' };
      expect(extractCleanDraftReply(parsed)).toBe('好的，我马上跟进处理');
    });

    it('extracts alias keys such as suggested_reply or reply', () => {
      expect(extractCleanDraftReply({ suggested_reply: '没问题，明天交付' })).toBe('没问题，明天交付');
      expect(extractCleanDraftReply({ reply: '已收到，核实中' })).toBe('已收到，核实中');
    });

    it('strictly rejects raw JSON strings and never returns raw JSON to UI', () => {
      const rawJson = '{\n"conversation": [{"sender": "other", "text": "有会议纪要吗"}]\n}';
      const result = extractCleanDraftReply({ draft_reply: rawJson }, [{ sender: 'other', text: '有会议纪要吗' }], '有会议纪要吗');
      expect(result).not.toContain('{');
      expect(result).not.toContain('conversation');
      expect(result).toContain('有会议纪要吗');
    });

    it('gracefully falls back when draft_reply is missing and last turn is from me', () => {
      const parsed = {
        conversation: [
          { sender: 'other', text: '有会议纪要吗' },
          { sender: 'me', text: '有的，我整理一下发你' },
        ],
        last_message_from_other: '有会议纪要吗',
      };
      const result = extractCleanDraftReply(parsed, parsed.conversation, parsed.last_message_from_other);
      expect(result).not.toContain('{');
      expect(result).toContain('有会议纪要吗');
    });

    it('returns empty string when fallbackToGuidance is false and no draft reply exists', () => {
      const parsed = {
        conversation: [
          { sender: 'other', text: '好，我盯着呢' },
        ],
        last_message_from_other: '好，我盯着呢',
      };
      const result = extractCleanDraftReply(parsed, parsed.conversation, parsed.last_message_from_other, false);
      expect(result).toBe('');
    });

    it('isInternalOrNegativeReply identifies prompt guidance and negative signals', () => {
      expect(isInternalOrNegativeReply('已根据对方消息“好，我盯着呢”提炼上下文，可点击下方快捷标签或输入具体要求生成回复。')).toBe(true);
      expect(isInternalOrNegativeReply('已感知屏幕对话上下文，点击下方快捷标签或直接输入要求生成回复。')).toBe(true);
      expect(isInternalOrNegativeReply('无需回复')).toBe(true);
      expect(isInternalOrNegativeReply('暂无新消息')).toBe(true);
      expect(isInternalOrNegativeReply('')).toBe(true);
      expect(isInternalOrNegativeReply(null)).toBe(true);
      expect(isInternalOrNegativeReply('好的，我马上看下')).toBe(false);
      expect(isInternalOrNegativeReply('没问题！')).toBe(false);
    });
  });
});
