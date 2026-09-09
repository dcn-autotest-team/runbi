/**
 * @file tests/unit/json-parser.test.ts
 * Unit tests for Robust LLM JSON Parser (parseModelJson)
 */

import { describe, it, expect } from 'vitest';
import { parseModelJson } from '@runbi/shared/core';

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
});
