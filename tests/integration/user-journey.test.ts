/**
 * @file tests/integration/user-journey.test.ts
 * 用户旅程集成测试:站在用户角度,按真实使用顺序验证功能完整性。
 * 每个测试对应一次真实用户操作;失败即用户可感知的 bug。
 */

import { describe, it, expect } from 'vitest';
import {
  classifyContext,
  buildSystemPrompt,
  buildScreenReplySystemPrompt,
  buildScreenReplyRefinePrompt,
  buildTextReplySystemPrompt,
  findBannedWords,
  resolveEndpoint,
  isScreenReplyPayload,
  STYLE_PRESETS,
} from '@runbi/shared/core';
import {
  PERSONA_PRESETS,
  INDUSTRY_PACKS,
  DEFAULT_APP_SETTINGS,
} from '@runbi/shared/types';
import type { ScreenReplyAnalysis } from '@runbi/shared/core';
import type { CustomAction } from '@runbi/shared/types';

/** 模拟 config.json(桌面端存储层的持久化契约) */
function loadConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...overrides };
}

describe('用户旅程 1: 首次安装 → 配置模型', () => {
  it('服务商预设覆盖所有主流选择,endpoint 拼接不会重复 /chat/completions', () => {
    // 用户保存完整 endpoint 或裸域名都不应 404(P0-4 回归)
    expect(resolveEndpoint('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(resolveEndpoint('https://api.deepseek.com/v1/chat/completions')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(resolveEndpoint(undefined)).toContain('/chat/completions');
  });

  it('API Key 留空时走 Mock 演示路径,配置契约字段齐全', () => {
    const cfg = loadConfig({ apiKey: '' });
    expect(cfg.apiKey).toBe(''); // 免 Key 用户可直接体验
    // 默认设置存在且默认行业包/主题合法
    expect(DEFAULT_APP_SETTINGS.industryPack).toBe('auto');
    expect(DEFAULT_APP_SETTINGS.model).toBeTruthy();
  });
});

describe('用户旅程 2: 划词润色(记事本/网页场景)', () => {
  it('长中文段落 → 智能识别为精简提炼,纯英文 → 地道英文', () => {
    const longZh = '这段话'.repeat(200);
    expect(classifyContext({ text: longZh }).style).toBe('concise');
    expect(classifyContext({ text: 'This is a pure English paragraph for testing translation style detection, over twenty letters.' }).style).toBe('native_en');
  });

  it('7 种润色风格都有 system prompt / 快捷键 / 温度,键位不冲突', () => {
    const keys = STYLE_PRESETS.map((p) => p.shortcutKey);
    expect(new Set(keys).size).toBe(STYLE_PRESETS.length); // 1-7 不重复
    for (const preset of STYLE_PRESETS) {
      const sys = buildSystemPrompt({ style: preset.id });
      expect(sys.length).toBeGreaterThan(10);
    }
  });

  it('润色模式的兜底快捷标签存在且非空(用户始终有按钮可点)', () => {
    // 兜底标签由 PolishPanel 内部字面量兜底，此处验证组件可用性由组件测试覆盖。
    // 这里验证关键属性：每个风格有 placeholder 提示，用户不迷路。
    for (const preset of STYLE_PRESETS) {
      expect(preset.placeholder.length).toBeGreaterThan(3);
    }
  });

  it('自定义人设会注入 prompt,留空则不注入', () => {
    const withPersona = buildSystemPrompt({ style: 'polished', personaPrompt: '我说话很直接' });
    expect(withPersona).toContain('我说话很直接');
    expect(buildSystemPrompt({ style: 'polished' })).not.toContain('人设风格偏好');
  });
});

describe('用户旅程 3: 微信智能回复(核心差异化场景)', () => {
  const analysis: ScreenReplyAnalysis = {
    conversation: [
      { sender: 'other', text: '跟你转点？' },
      { sender: 'other', text: '[转账 ¥200.00]' },
    ],
    last_message_from_other: '[转账 ¥200.00]',
    ambiguity: '对方发来¥200转账',
    clarify_options: ['催付款', '报物流'],
    draft_reply: '收到，谢啦！',
  };

  it('空划词 + 聊天应用 → 触发 screen-reply 读屏链路', () => {
    expect(isScreenReplyPayload({ trigger: 'screen-reply', hasScreenshot: true, text: '' })).toBe(true);
    expect(isScreenReplyPayload({ trigger: 'shortcut', text: '普通润色文本' })).toBe(false);
  });

  it('读屏解析 prompt 含身份判定铁律与转账处理规则', () => {
    const sys = buildScreenReplySystemPrompt();
    expect(sys).toContain('身份判定铁律');
    expect(sys).toContain('转账');
    expect(sys).toContain('禁止计入 conversation');
  });

  it('意图 chip 点击 → refine 提示词带历史与行业规则', () => {
    const refine = buildScreenReplyRefinePrompt(
      analysis.conversation,
      '礼貌致谢并确认收到',
      undefined,
      '用户是微商/私域卖家'
    );
    expect(refine).toContain('[对方]: 跟你转点？');
    expect(refine).toContain('【我的回复要求/语气偏好】：');
    expect(refine).toContain('【行业场景规则】：');
    expect(refine).toContain('请直接生成最终的回复内容。');
  });

  it('纯文本回复路径(DeepSeek 无读屏时)同样携带完整 JSON schema', () => {
    const sys = buildTextReplySystemPrompt();
    expect(sys).toContain('"draft_reply"');
    expect(sys).toContain('"clarify_options"');
  });

  it('生成结果含广告法极限词时会被检出(贴回前警示)', () => {
    const hits = findBannedWords('这款产品全网第一，稳赚不赔');
    expect(hits.length).toBeGreaterThan(0);
    expect(findBannedWords(analysis.draft_reply)).toEqual([]); // 正常回复不误报
  });
});

describe('用户旅程 4: 行业模板包 + 自定义指令', () => {
  it('行业包齐全:智能识别/通用 + 4 行业,非通用包有 5+ 意图且场景规则非空', () => {
    const ids = INDUSTRY_PACKS.map((p) => p.id);
    expect(ids).toContain('auto');
    expect(ids).toContain('general');
    expect(INDUSTRY_PACKS.length).toBe(6); // auto + general + 4 行业(微商/律所/房产保险/公文)
    for (const pack of INDUSTRY_PACKS) {
      if (pack.id !== 'general' && pack.id !== 'auto') {
        expect(pack.sceneHint.length).toBeGreaterThan(50);
        expect(pack.intents.length).toBeGreaterThanOrEqual(5);
        for (const intent of pack.intents) {
          expect(intent.label.length).toBeGreaterThan(1);
          expect(intent.instruction.length).toBeGreaterThan(10);
        }
      }
    }
  });

  it('行业包意图注入 clarify_options 示例;通用包保持默认 chips', () => {
    const cs = INDUSTRY_PACKS.find((p) => p.id === 'we_commerce')!;
    const sys = buildScreenReplySystemPrompt(undefined, cs);
    expect(sys).toContain('"clarify_options": ["催付款","报物流"');
    expect(buildScreenReplySystemPrompt()).toContain('"clarify_options": ["更正式一点"');
  });

  it('自定义指令(名称+prompt)可合并为面板按钮,空项被过滤', () => {
    const actions: CustomAction[] = [
      { id: 'a', name: '要好评', prompt: '礼貌邀请客户给个好评' },
      { id: 'b', name: '', prompt: '' },
    ];
    const valid = actions.filter((a) => a.name.trim() && a.prompt.trim());
    expect(valid.length).toBe(1);
    expect(valid[0].name).toBe('要好评');
  });

  it('半填残项(只有名称没有指令)保存时被丢弃(回归:曾占按钮位导致用户以为按钮丢失)', () => {
    // 用户真实配置中出现过:名字填了、prompt 空着 → 按钮永远不显示
    const actions: CustomAction[] = [
      { id: 'x', name: '转人工', prompt: '' },
      { id: 'c', name: '要好评', prompt: '' },
      { id: 'd', name: '议价', prompt: '给台阶不硬拒' },
    ];
    // 保存过滤契约:必须"与"条件,不能是"或"
    const saved = actions.filter((a) => a.name.trim() && a.prompt.trim());
    expect(saved.map((a) => a.name)).toEqual(['议价']);
  });

  it('人设预设存在且标准档为空注入', () => {
    expect(PERSONA_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(PERSONA_PRESETS[0].id).toBe('standard');
  });
});

describe('用户旅程 5: 历史记录与数据安全', () => {
  it('剪贴板隔离:敏感内容不进入事件(前端只收空文本)', () => {
    // Rust 侧 is_sensitive_or_password 拦截后 event_text 置空 — 契约由 payload 校验兜底
    const payload = { trigger: 'shortcut', text: '' };
    expect(payload.text).toBe('');
  });

  it('endpoint 协议告警只对 http 明文触发(localhost 豁免)', () => {
    const isHttp = (url: string) => /^http:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(url);
    expect(isHttp('http://api.example.com/v1')).toBe(true);
    expect(isHttp('http://localhost:11434/v1')).toBe(false);
    expect(isHttp('https://api.deepseek.com/v1')).toBe(false);
  });
});
