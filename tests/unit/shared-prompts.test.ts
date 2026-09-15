/**
 * @file tests/unit/shared-prompts.test.ts
 * Unit tests for Prompt Templates & Dynamic Builder Engine (@runbi/shared/core/prompts)
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STYLE_PROMPTS,
  STYLE_PRESETS,
  SYSTEM_GUARDRAILS,
  REPLY_GUARDRAILS,
  buildSystemPrompt,
  buildUserPrompt,
  interpolateTemplate,
  buildScreenReplySystemPrompt,
  buildScreenReplyUserPrompt,
  buildScreenReplyRefinePrompt,
  buildTextReplySystemPrompt,
  buildTextReplyUserPrompt,
  INTENT_CHIPS,
  buildGlossaryPrompt,
  buildStyleSamplesPrompt,
  buildAppStylePrompt,
  hasLatexMarkers,
  extractLatexTokens,
  findLatexViolations,
  buildTranslateSystemPrompt,
  resolveTranslateTarget,
  TRANSLATE_TARGETS,
} from '@runbi/shared/core/prompts';
import type { PolishStyle } from '@runbi/shared/types/stream';
import { INDUSTRY_PACKS } from '@runbi/shared/types/settings';

describe('Shared Core: Prompt Engine & Dynamic Builder', () => {
  const styles: PolishStyle[] = [
    'polished',
    'academic',
    'business',
    'literary',
    'concise',
    'native_en',
    'reply',
    'translate',
  ];

  describe('Presets and Guardrails Configuration', () => {
    it('should define distinct system prompts for all 8 styles', () => {
      for (const style of styles) {
        expect(DEFAULT_STYLE_PROMPTS[style]).toBeDefined();
        expect(DEFAULT_STYLE_PROMPTS[style].length).toBeGreaterThan(10);
      }
    });

    it('should contain metadata for each style preset in STYLE_PRESETS', () => {
      expect(STYLE_PRESETS.length).toBe(8);
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

  describe('Reply Human-Feel Guardrails (anti AI-flavor)', () => {
    it('should append REPLY_GUARDRAILS to every reply-path system prompt', () => {
      const singleShot = buildSystemPrompt({ style: 'reply' });
      const vision = buildSystemPrompt({ style: 'reply', hasVisionContext: true });
      const textReply = buildSystemPrompt({
        style: 'reply',
        customPromptOverride: buildTextReplySystemPrompt(),
      });
      const screenReply = buildSystemPrompt({
        style: 'reply',
        customPromptOverride: buildScreenReplySystemPrompt(),
      });

      for (const prompt of [singleShot, vision, textReply, screenReply]) {
        expect(prompt).toContain('真人感铁律');
        expect(prompt).toContain('禁止脑补细节硬答');
      }
    });

    it('should not append reply guardrails to polish styles', () => {
      expect(buildSystemPrompt({ style: 'polished' })).not.toContain('真人感铁律');
    });

    it('should keep reply prompts free of AI-flavor wording', () => {
      const replyPrompt = DEFAULT_STYLE_PROMPTS.reply;
      expect(replyPrompt).not.toContain('高情商');
      expect(replyPrompt).not.toContain('逻辑严密');
      expect(buildSystemPrompt({ style: 'reply', hasVisionContext: true })).not.toContain('全面呼应');
    });

    it('should define the guardrail rules against customer-service tone', () => {
      expect(REPLY_GUARDRAILS).toContain('不说客服腔');
      expect(REPLY_GUARDRAILS).toContain('禁止分点列表');
    });
  });

  describe('Industry Pack Injection', () => {
    const csPack = INDUSTRY_PACKS.find((p) => p.id === 'we_commerce')!;
    const generalPack = INDUSTRY_PACKS.find((p) => p.id === 'general')!;

    it('should inject scene rules and pack-aligned clarify options into reply prompts', () => {
      const screenPrompt = buildScreenReplySystemPrompt(undefined, csPack);
      expect(screenPrompt).toContain('【行业场景规则】：');
      expect(screenPrompt).toContain('微商');
      expect(screenPrompt).toContain('"clarify_options": ["催付款","报物流"');

      const textPrompt = buildTextReplySystemPrompt(undefined, csPack);
      expect(textPrompt).toContain('【行业场景规则】：');
      expect(textPrompt).toContain('"clarify_options": ["催付款","报物流"');
    });

    it('should keep prompts byte-identical when no pack or general pack is given', () => {
      expect(buildScreenReplySystemPrompt()).toBe(buildScreenReplySystemPrompt(undefined, generalPack));
      expect(buildTextReplySystemPrompt()).toBe(buildTextReplySystemPrompt(undefined, generalPack));
      expect(buildScreenReplySystemPrompt()).not.toContain('行业场景规则');
    });

    it('should inject packPrompt into system and refine prompts', () => {
      const sys = buildSystemPrompt({ style: 'reply', packPrompt: '测试行业规则XYZ' });
      expect(sys).toContain('【行业场景规则】：\n测试行业规则XYZ');

      const refine = buildScreenReplyRefinePrompt(
        [{ sender: 'other', text: '你好' }],
        '确认',
        undefined,
        '测试行业规则XYZ'
      );
      expect(refine).toContain('【行业场景规则】：\n测试行业规则XYZ');
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

    it('should ground sender identity in bubble alignment, not guessing', () => {
      const prompt = buildScreenReplySystemPrompt();
      expect(prompt).toContain('身份判定铁律');
      expect(prompt).toContain('头像在气泡右侧的是"我"');
      expect(prompt).toContain('头像在气泡左侧的是"对方"');
      expect(prompt).toContain('禁止计入 conversation');
      expect(buildScreenReplyUserPrompt()).toContain('再判断身份');
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

describe('Personal Moat Prompt Builders (词库/文风样本/宿主适配/LaTeX 保护)', () => {
  it('buildGlossaryPrompt compiles replace/keep/ban rules into a hard-constraint block', () => {
    const block = buildGlossaryPrompt([
      { id: '1', kind: 'replace', from: '用户', to: '客户' },
      { id: '2', kind: 'keep', from: 'DCN' },
      { id: '3', kind: 'ban', from: '综上所述' },
    ]);
    expect(block).toContain('【个人词库硬约束】');
    expect(block).toContain('"用户"一律写作"客户"');
    expect(block).toContain('DCN');
    expect(block).toContain('综上所述');
  });

  it('buildGlossaryPrompt ignores incomplete rules and returns empty without rules', () => {
    expect(buildGlossaryPrompt([])).toBe('');
    expect(buildGlossaryPrompt(undefined)).toBe('');
    expect(buildGlossaryPrompt([{ id: 'x', kind: 'replace', from: 'A' }])).toBe('');
  });

  it('buildStyleSamplesPrompt caps at 3 samples and truncates long ones', () => {
    const long = '长'.repeat(400);
    const block = buildStyleSamplesPrompt(['样本一', long, '样本三', '样本四']);
    expect(block).toContain('【我的文风标杆】');
    expect(block).toContain('【标杆样本 3】');
    expect(block).not.toContain('【标杆样本 4】');
    expect(block).not.toContain('长'.repeat(301));
  });

  it('buildAppStylePrompt maps foreground apps to style hints', () => {
    expect(buildAppStylePrompt('WeChat.exe')).toContain('聊天软件');
    expect(buildAppStylePrompt('WeChat')).toContain('聊天软件');
    expect(buildAppStylePrompt('WINWORD.EXE')).toContain('办公文档');
    expect(buildAppStylePrompt('Code.exe')).toContain('commit message');
    expect(buildAppStylePrompt('Foxmail.exe')).toContain('祝颂语');
    expect(buildAppStylePrompt('unknown.exe')).toBe('');
    expect(buildAppStylePrompt('')).toBe('');
    expect(buildAppStylePrompt(null)).toBe('');
  });

  it('extractLatexTokens finds math and commands; violations report lost tokens', () => {
    const orig = '结果如 $E=mc^2$ 所示\\cite{nature2024}，见 \\ref{fig:1}。';
    expect(hasLatexMarkers(orig)).toBe(true);
    const tokens = extractLatexTokens(orig);
    expect(tokens).toContain('$E=mc^2$');
    expect(tokens).toContain('\\cite{nature2024}');
    const violations = findLatexViolations(orig, '结果如 $E=mc^2$ 所示，见图。');
    expect(violations).toContain('\\cite{nature2024}');
    expect(violations).toContain('\\ref{fig:1}');
    expect(findLatexViolations(orig, orig)).toEqual([]);
    expect(hasLatexMarkers('普通中文，没有公式')).toBe(false);
  });

  it('buildSystemPrompt appends glossary/sample/appStyle/latex sections when provided', () => {
    const sys = buildSystemPrompt({
      style: 'polished',
      glossaryPrompt: '\n【个人词库硬约束】：测试',
      styleSamplesPrompt: '\n【我的文风标杆】：测试',
      appStylePrompt: '\n【宿主应用适配】：测试',
      latexGuard: true,
    });
    expect(sys).toContain('【个人词库硬约束】');
    expect(sys).toContain('【我的文风标杆】');
    expect(sys).toContain('【宿主应用适配】');
    expect(sys).toContain('【LaTeX 源码保护】');

    const bare = buildSystemPrompt({ style: 'polished' });
    expect(bare).not.toContain('【个人词库硬约束】');
    expect(bare).not.toContain('【LaTeX 源码保护】');
  });

  it('INTENT_CHIPS covers the roadmap scenarios with label+instruction', () => {
    expect(INTENT_CHIPS.length).toBeGreaterThanOrEqual(5);
    expect(INTENT_CHIPS.map((c) => c.label)).toEqual(
      expect.arrayContaining(['委婉推脱', '礼貌催促', '去AI味'])
    );
    for (const c of INTENT_CHIPS) {
      expect(c.instruction.length).toBeGreaterThan(5);
    }
  });

  describe('Translate Mode (划词翻译)', () => {
    it('TRANSLATE_TARGETS covers the 5 reference languages', () => {
      expect(TRANSLATE_TARGETS.map((t) => t.id)).toEqual([
        'en', 'zh-Hans', 'zh-Hant', 'ja', 'ko',
      ]);
      for (const t of TRANSLATE_TARGETS) {
        expect(t.label.length).toBeGreaterThan(0);
      }
    });

    it('buildTranslateSystemPrompt names the target language and forbids commentary', () => {
      const en = buildTranslateSystemPrompt('en');
      expect(en).toContain('英文');
      expect(en).toContain('只输出译文本体');
      expect(buildTranslateSystemPrompt('ja')).toContain('日文');
      expect(buildTranslateSystemPrompt('zh-Hant')).toContain('繁体中文');
      // guardrails appended via buildSystemPrompt keep output clean
      const withGuardrails = buildSystemPrompt({ style: 'translate', customPromptOverride: buildTranslateSystemPrompt('en') });
      expect(withGuardrails).toContain('严禁包含任何前缀或后缀客套话');
    });

    it('resolveTranslateTarget correctly detects Chinese to English and English to Chinese', () => {
      // 划词为中文 -> 翻译为英文 ('en')
      expect(resolveTranslateTarget('你好世界')).toBe('en');
      expect(resolveTranslateTarget('这是一个测试')).toBe('en');
      expect(resolveTranslateTarget('在 React 项目中如何使用 Tailwind CSS？')).toBe('en');
      expect(resolveTranslateTarget('字里行间，笔墨生香')).toBe('en');
      expect(resolveTranslateTarget('繁體中文測試')).toBe('en');

      // 划词为英文 -> 翻译为简体中文 ('zh-Hans')
      expect(resolveTranslateTarget('Hello world')).toBe('zh-Hans');
      expect(resolveTranslateTarget('Runbi is an AI text polishing tool.')).toBe('zh-Hans');
      expect(resolveTranslateTarget('Fix the translation logic bug')).toBe('zh-Hans');
      expect(resolveTranslateTarget('OK')).toBe('zh-Hans');

      // 英文句子夹带个别中文专名 -> 仍以英文为主，翻译为简体中文
      expect(resolveTranslateTarget('The concept of "guanxi" (关系) is essential in Chinese culture.')).toBe('zh-Hans');

      // 日韩文外文 -> 翻译为简体中文
      expect(resolveTranslateTarget('こんにちは、世界')).toBe('zh-Hans');
      expect(resolveTranslateTarget('안녕하세요')).toBe('zh-Hans');

      // 空白/无文本兜底
      expect(resolveTranslateTarget('')).toBe('en');
      expect(resolveTranslateTarget('   ')).toBe('en');
    });

    it('buildTranslateSystemPrompt resolves target language automatically when omitted or auto', () => {
      const promptZh = buildTranslateSystemPrompt(undefined, '你好，请帮我翻译这段话');
      expect(promptZh).toContain('英文');

      const promptEn = buildTranslateSystemPrompt(undefined, 'Please help me translate this sentence.');
      expect(promptEn).toContain('简体中文');
    });

    it('buildTranslateSystemPrompt resolves conflicting targets automatically (English text with en target -> zh-Hans)', () => {
      // Even if targetId was passed as 'en' (e.g. from previous Chinese translation session), English text resolves to '简体中文'
      const promptEn = buildTranslateSystemPrompt('en', 'real WebView direct entry');
      expect(promptEn).toContain('简体中文');
      expect(promptEn).not.toContain('【英文】');

      // Even if targetId was passed as 'zh-Hans', Chinese text resolves to '英文'
      const promptZh = buildTranslateSystemPrompt('zh-Hans', '现有的翻译逻辑不正确');
      expect(promptZh).toContain('英文');
      expect(promptZh).not.toContain('【简体中文】');

      // Explicit third language remains unchanged
      const promptJa = buildTranslateSystemPrompt('ja', 'real WebView direct entry');
      expect(promptJa).toContain('日文');
    });

    it('buildSystemPrompt for translate style does not append polish-specific guardrails', () => {
      const prompt = buildSystemPrompt({
        style: 'translate',
        customPromptOverride: buildTranslateSystemPrompt(undefined, 'real WebView direct entry'),
      });
      expect(prompt).not.toContain('直接输出润色后的终稿内容');
      expect(prompt).toContain('必须输出【简体中文】译文');
    });
  });
});
