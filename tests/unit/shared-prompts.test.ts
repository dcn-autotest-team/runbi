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
});
