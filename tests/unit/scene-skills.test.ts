/**
 * @file tests/unit/scene-skills.test.ts
 * Unit tests for 场景 Skills (Scene Skills Template Presets & Engine)
 */

import { describe, it, expect } from 'vitest';
import {
  SCENE_SKILLS,
  getSceneSkill,
  buildSkillSystemPrompt,
  buildSystemPrompt,
  MOCK_POLISH_RULES,
  generateMockStreamMessages,
} from '@runbi/shared/core';

describe('场景 Skills (Scene Skills Presets & Registry)', () => {
  it('should contain all 6 core scene skills', () => {
    const expectedSkillIds = [
      'meeting',
      'work_report',
      'project_push',
      'marketing_copy',
      'email_polish',
      'vibe_coding',
    ];

    const actualIds = SCENE_SKILLS.map((s) => s.id);
    expect(actualIds).toEqual(expectedSkillIds);

    for (const skill of SCENE_SKILLS) {
      expect(skill.name).toBeTruthy();
      expect(skill.shortName).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.icon).toBeTruthy();
      expect(skill.systemPrompt.length).toBeGreaterThan(50);
    }
  });

  it('should retrieve skill by id via getSceneSkill', () => {
    const meeting = getSceneSkill('meeting');
    expect(meeting).toBeDefined();
    expect(meeting?.name).toBe('会议纪要');
    expect(meeting?.systemPrompt).toContain('Action Items');

    const vibeCoding = getSceneSkill('vibe_coding');
    expect(vibeCoding).toBeDefined();
    expect(vibeCoding?.name).toBe('Vibe Coding 提示词');
    expect(vibeCoding?.systemPrompt).toContain('AI 编程助手');

    expect(getSceneSkill('non_existent')).toBeUndefined();
  });

  it('should build skill system prompt and append guardrails in buildSystemPrompt', () => {
    const meetingSkill = getSceneSkill('meeting')!;
    const promptWithSkillId = buildSystemPrompt({
      style: 'polished',
      skillId: 'meeting',
    });

    expect(promptWithSkillId).toContain('会议纪要');
    expect(promptWithSkillId).toContain('Action Items');
    expect(promptWithSkillId).toContain('极其严苛的规则');

    const vibePrompt = buildSystemPrompt({
      style: 'polished',
      skillPrompt: meetingSkill.systemPrompt,
    });
    expect(vibePrompt).toContain('Action Items');
  });

  it('should provide deterministic mock transform rules for all 6 scene skills', () => {
    const text = '下周二上线登录重构';
    for (const skill of SCENE_SKILLS) {
      const transform = MOCK_POLISH_RULES[skill.id];
      expect(typeof transform).toBe('function');
      const output = transform(text);
      expect(output).toContain(text);
      expect(output.length).toBeGreaterThan(text.length);
    }
  });

  it('should stream mock completions for scene skills', async () => {
    const text = '完成用户鉴权功能开发';
    const stream = generateMockStreamMessages(text, 'vibe_coding');
    const chunks: string[] = [];
    let done = false;

    for await (const msg of stream) {
      if (msg.type === 'CHUNK' && msg.payload?.delta) {
        chunks.push(msg.payload.delta);
      } else if (msg.type === 'DONE') {
        done = true;
      }
    }

    expect(done).toBe(true);
    const fullText = chunks.join('');
    expect(fullText).toContain('Role & Objective');
    expect(fullText).toContain(text);
  });
});
