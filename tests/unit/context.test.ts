import { describe, it, expect } from 'vitest';
import { classifyContext } from '@runbi/shared/core';

describe('Context Auto-Sense Classifier', () => {
  it('detects chat app + question text as reply', () => {
    const c = classifyContext({
      text: '这个方案能不能明天给我？',
      sourceApp: 'WeChat.exe',
    });
    expect(c.mode).toBe('reply');
    expect(c.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('keeps long prose without questions as polish', () => {
    const c = classifyContext({ text: '本文提出了针对该问题的解决方案，实验表明效果显著。'.repeat(10) });
    expect(c.mode).toBe('polish');
  });

  it('defaults to polish without signals', () => {
    expect(classifyContext({ text: '随便一句话' }).mode).toBe('polish');
  });

  it('chat window title boosts reply confidence', () => {
    const c = classifyContext({ text: '在吗？', windowTitle: '与张三的聊天' });
    expect(c.mode).toBe('reply');
  });

  it('feishu + request wording switches to reply', () => {
    const c = classifyContext({
      text: '麻烦你把周报整理一下发我，谢谢！',
      sourceApp: 'Feishu.exe',
    });
    expect(c.mode).toBe('reply');
  });

  it('mixed Chinese with technical tokens is NOT sent to the English translator', () => {
    const mixed = '唤醒键已经是 Ctrl+2（配置里两个文件都是）——如果按习惯按 Ctrl+Shift+Space，永远没反应。模型 qwen3.8-27b 跑在 deepseek-v4-flash-0731 上。';
    const c = classifyContext({ text: mixed });
    expect(c.style).not.toBe('native_en');
  });

  it('near-pure English still maps to native_en', () => {
    const c = classifyContext({
      text: 'The quick brown fox jumps over the lazy dog again and again without any stop.',
    });
    expect(c.style).toBe('native_en');
  });

  it('chat app beats mixed-text heuristics', () => {
    const c = classifyContext({
      text: '唤醒键已经是 Ctrl+2（配置里两个文件都是）——如果按习惯按 Ctrl+Shift+Space，永远没反应。',
      sourceApp: 'Weixin.exe',
    });
    expect(c.style).toBe('reply');
  });
});
