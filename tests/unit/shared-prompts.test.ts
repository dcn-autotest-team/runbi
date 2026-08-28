/**
 * @file tests/unit/shared-prompts.test.ts
 * Unit tests for Prompt Templates & Dynamic Builder Engine (@runbi/shared/core/prompts)
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STYLE_PROMPTS,
  STYLE_PRESETS,
  SYSTEM_GUARDRAILS,
  buildSystemPrompt,
  buildUserPrompt,
  interpolateTemplate,
  buildScreenReplySystemPrompt,
  buildScreenReplyUserPrompt,
  buildScreenReplyRefinePrompt,
  buildTextReplySystemPrompt,
  buildTextReplyUserPrompt,
} from '@runbi/shared/core/prompts';
import type { PolishStyle } from '@runbi/shared/types/stream';

describe('Shared Core: Prompt Engine & Dynamic Builder', () => {
  const styles: PolishStyle[] = [
    'polished',
    'academic',
    'business',
    'literary',
    'concise',
    'native_en',
    'reply',
  ];

  describe('Presets and Guardrails Configuration', () => {
    it('should define distinct system prompts for all 7 styles', () => {
      for (const style of styles) {
        expect(DEFAULT_STYLE_PROMPTS[style]).toBeDefined();
        expect(DEFAULT_STYLE_PROMPTS[style].length).toBeGreaterThan(10);
      }
    });

    it('should contain metadata for each style preset in STYLE_PRESETS', () => {
      expect(STYLE_PRESETS.length).toBe(7);
      const presetIds = STYLE_PRESETS.map((p) => p.id);
      expect(presetIds).toEqual(styles);

      for (const preset of STYLE_PRESETS) {
        expect(preset.name).toBeTruthy();
        expect(preset.shortName).toBeTruthy();
        expect(preset.description).toBeTruthy();
        expect(preset.icon).toBeTruthy();
        expect(preset.shortcutKey).toBeTruthy();
        expect(preset.defaultTemperature).toBeGreaterThan(0);
      }
    });

    it('should specify 4 strict anti-hallucination rules in SYSTEM_GUARDRAILS', () => {
      expect(SYSTEM_GUARDRAILS).toContain('【极其严苛的规则】：');
      expect(SYSTEM_GUARDRAILS).toContain('1. 直接输出润色后的终稿内容。');
      expect(SYSTEM_GUARDRAILS).toContain('2. 严禁包含任何前缀或后缀客套话');
      expect(SYSTEM_GUARDRAILS).toContain('3. 严禁添加引号包裹，严禁自行添加 markdown 标题。');
      expect(SYSTEM_GUARDRAILS).toContain('4. 保持原文的段落排版格式与换行符。');
    });
  });

  describe('buildSystemPrompt', () => {
    it('should build system prompt with style default and guardrails', () => {
      const prompt = buildSystemPrompt({ style: 'academic' });
      expect(prompt).toContain(DEFAULT_STYLE_PROMPTS.academic);
      expect(prompt).toContain(SYSTEM_GUARDRAILS.trim());
    });

    it('should use customPromptOverride when provided', () => {
      const custom = '你是一名资深代码审阅专家。';
      const prompt = buildSystemPrompt({
        style: 'polished',
        customPromptOverride: custom,
      });

      expect(prompt).toContain(custom);
      expect(prompt).not.toContain(DEFAULT_STYLE_PROMPTS.polished);
      expect(prompt).toContain(SYSTEM_GUARDRAILS.trim());
    });

    it('should include userInstruction when specified', () => {
      const prompt = buildSystemPrompt({
        style: 'business',
        userInstruction: '请使用委婉敬语，对象是重要客户',
      });

      expect(prompt).toContain('请使用委婉敬语，对象是重要客户');
      expect(prompt).toContain(SYSTEM_GUARDRAILS.trim());
    });
  });

  describe('buildUserPrompt', () => {
    it('should return raw text if no userInstruction is provided', () => {
      const text = '这是待润色的原文';
      expect(buildUserPrompt({ text })).toBe(text);
    });

    it('should wrap text in delimiters and append instruction when userInstruction is given', () => {
      const text = '下周一我们需要提交报告。';
      const instruction = '补充具体工作计划并表达感谢';
      const result = buildUserPrompt({ text, userInstruction: instruction });

      expect(result).toContain('【参考文本】：');
      expect(result).toContain('"""\n下周一我们需要提交报告。\n"""');
      expect(result).toContain('【我的具体处理要求】：\n补充具体工作计划并表达感谢');
    });
  });

  describe('interpolateTemplate', () => {
    it('should substitute variables matching {varName}', () => {
      const template = '请将文本“{text}”润色为{style}风格，要求：{instruction}。';
      const result = interpolateTemplate(template, {
        text: '原文',
        style: '学术',
        instruction: '去除口语',
      });

      expect(result).toBe('请将文本“原文”润色为学术风格，要求：去除口语。');
    });

    it('should leave unknown placeholders untouched', () => {
      const template = 'Hello {name}, your score is {score} in {course}.';
      const result = interpolateTemplate(template, {
        name: 'Alice',
        score: 95,
      });

      expect(result).toBe('Hello Alice, your score is 95 in {course}.');
    });
  });

  describe('Screen Reply (Zero-selection) Prompt Builder', () => {
    it('should build screen reply system prompt with JSON schema requirements', () => {
      const prompt = buildScreenReplySystemPrompt();
      expect(prompt).toContain('JSON');
      expect(prompt).toContain('"conversation"');
      expect(prompt).toContain('"last_message_from_other"');
      expect(prompt).toContain('"clarify_options"');
      expect(prompt).toContain('"draft_reply"');
    });

    it('should build screen reply user prompt for vision parsing', () => {
      const userPrompt = buildScreenReplyUserPrompt();
      expect(userPrompt).toContain('屏幕截图');
      expect(userPrompt).toContain('JSON');
    });

    it('should build screen reply refine prompt from conversation history and user chip', () => {
      const conversation = [
        { sender: 'other' as const, text: '明天上午有空开会吗？' },
        { sender: 'me' as const, text: '我上午有个评审。' },
        { sender: 'other' as const, text: '那下午两点方便吗？' },
      ];
      const prompt = buildScreenReplyRefinePrompt(conversation, '热情答应并约定地点');
      expect(prompt).toContain('[对方]: 明天上午有空开会吗？');
      expect(prompt).toContain('[我]: 我上午有个评审。');
      expect(prompt).toContain('[对方]: 那下午两点方便吗？');
      expect(prompt).toContain('【我的回复要求/语气偏好】：\n热情答应并约定地点');
    });

    it('should build text reply system and user prompts with JSON schema and message content', () => {
      const sysPrompt = buildTextReplySystemPrompt();
      expect(sysPrompt).toContain('JSON');
      expect(sysPrompt).toContain('"last_message_from_other"');
      expect(sysPrompt).toContain('"clarify_options"');

      const userPrompt = buildTextReplyUserPrompt('这周五能交付吗？');
      expect(userPrompt).toContain('这周五能交付吗？');
    });

    it('should inject persona prompt into system and refine prompts when provided', () => {
      const persona = '沉稳严谨、逻辑清晰、用词得体自信，符合高质量职场商务标准。';
      const sysPrompt = buildSystemPrompt({ style: 'business', personaPrompt: persona });
      expect(sysPrompt).toContain('【用户人设风格偏好】：');
      expect(sysPrompt).toContain(persona);

      const screenSysPrompt = buildScreenReplySystemPrompt(persona);
      expect(screenSysPrompt).toContain('【用户人设风格偏好】：');
      expect(screenSysPrompt).toContain(persona);

      const textSysPrompt = buildTextReplySystemPrompt(persona);
      expect(textSysPrompt).toContain('【用户人设风格偏好】：');
      expect(textSysPrompt).toContain(persona);

      const refinePrompt = buildScreenReplyRefinePrompt(
        [{ sender: 'other', text: '你好' }],
        '确认收到',
        persona
      );
      expect(refinePrompt).toContain('【我的人设风格偏好】：');
      expect(refinePrompt).toContain(persona);
    });
  });
});
