import { describe, it, expect, vi } from 'vitest';
import {
  MOCK_POLISH_RULES,
  transformPreset,
  generateMockStream,
  generateMockStreamMessages,
} from '../../src/core/mockStream';
import type { PolishStyle, StreamServerMessage } from '../../src/types/stream';

describe('src/core/mockStream.ts Unit Tests', () => {
  const sampleText = '这是一段关于技术架构与产品设计的草稿。';

  // =========================================================================
  // 1. transformPreset Tests (6 Scene Styles)
  // =========================================================================
  describe('transformPreset (6 Scene Styles)', () => {
    const allStyles: PolishStyle[] = [
      'polished',
      'academic',
      'business',
      'literary',
      'concise',
      'native_en',
      'reply',
    ];

    it('should have predefined transform rules for all 7 styles', () => {
      for (const style of allStyles) {
        expect(MOCK_POLISH_RULES[style]).toBeDefined();
        const res = transformPreset(sampleText, style);
        expect(res).toBeDefined();
        expect(res.length).toBeGreaterThan(0);
      }
    });

    it('should format academic style with formal discourse', () => {
      const res = transformPreset(sampleText, 'academic');
      expect(res).toContain('学术规范');
      expect(res).toContain(sampleText);
    });

    it('should format business style with workplace tone', () => {
      const res = transformPreset(sampleText, 'business');
      expect(res).toContain('您好');
      expect(res).toContain(sampleText);
    });

    it('should format reply style with polite response', () => {
      const res = transformPreset(sampleText, 'reply');
      expect(res).toContain('评估');
      expect(res).toContain(sampleText);
    });

    it('should format custom user instruction when provided', () => {
      const res = transformPreset(sampleText, 'polished', '委婉拒绝并感谢');
      expect(res).toContain('委婉拒绝并感谢');
      expect(res).toContain(sampleText);
    });

    it('should format concise style with shortened summary', () => {
      const longText = '这是一个非常长非常详细的原始描述文本内容用于测试精简算法';
      const res = transformPreset(longText, 'concise');
      expect(res.length).toBeLessThan(longText.length + 10);
      expect(res).toContain('精炼提炼');
    });

    it('should format native English transformation', () => {
      const res = transformPreset(sampleText, 'native_en');
      expect(res).toContain('Regarding');
      expect(res).toContain('conceptual clarity');
    });

    it('should fallback to polished style for unknown style key', () => {
      const res = transformPreset(sampleText, 'unknown_custom_style');
      const expected = MOCK_POLISH_RULES.polished(sampleText);
      expect(res).toBe(expected);
    });
  });

  // =========================================================================
  // 2. generateMockStream Tests
  // =========================================================================
  describe('generateMockStream', () => {
    it('should stream chunks yielding full expected text', async () => {
      const text = '测试划词流式生成';
      const generator = generateMockStream(text, 'polished', undefined, { minDelay: 0, maxDelay: 1 });
      const chunks: string[] = [];

      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      const combined = chunks.join('');
      const expected = transformPreset(text, 'polished');
      expect(combined).toBe(expected);
    });

    it('should return valid durationMs and tokenCount upon completion', async () => {
      const generator = generateMockStream('简单测试', 'concise', undefined, { minDelay: 0, maxDelay: 1 });
      let finalStats: { durationMs: number; tokenCount: number } | undefined;

      while (true) {
        const next = await generator.next();
        if (next.done) {
          finalStats = next.value;
          break;
        }
      }

      expect(finalStats).toBeDefined();
      expect(finalStats?.tokenCount).toBeGreaterThan(0);
      expect(finalStats?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should abort immediately when AbortSignal is pre-aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const generator = generateMockStream('测试文本', 'academic', controller.signal, { minDelay: 0, maxDelay: 1 });
      const chunks: string[] = [];

      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(0);
    });

    it('should stop emission mid-stream when aborted', async () => {
      const controller = new AbortController();
      const generator = generateMockStream(
        '这是一段很长很长的文本用来测试中途取消打字机输出的效果',
        'literary',
        controller.signal,
        { minDelay: 5, maxDelay: 10 }
      );

      const chunks: string[] = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
        if (chunks.length === 2) {
          controller.abort();
        }
      }

      const full = transformPreset('这是一段很长很长的文本用来测试中途取消打字机输出的效果', 'literary');
      expect(chunks.join('').length).toBeLessThan(full.length);
    });
  });

  // =========================================================================
  // 3. generateMockStreamMessages Tests
  // =========================================================================
  describe('generateMockStreamMessages', () => {
    it('should yield CHUNK messages followed by DONE message', async () => {
      const generator = generateMockStreamMessages('测试流消息', 'business', undefined, { minDelay: 0, maxDelay: 1 });
      const messages: StreamServerMessage[] = [];

      for await (const msg of generator) {
        messages.push(msg);
      }

      expect(messages.length).toBeGreaterThan(1);
      const chunkMsgs = messages.filter((m) => m.type === 'CHUNK');
      const doneMsg = messages.find((m) => m.type === 'DONE');

      expect(chunkMsgs.length).toBeGreaterThan(0);
      expect(doneMsg).toBeDefined();
      if (doneMsg?.type === 'DONE') {
        expect(doneMsg.payload.totalTokens).toBe(chunkMsgs.length);
      }
    });

    it('should emit ABORTED message when aborted mid-stream', async () => {
      const controller = new AbortController();
      const generator = generateMockStreamMessages(
        '这是一段较长的流式消息测试文本',
        'polished',
        controller.signal,
        { minDelay: 5, maxDelay: 10 }
      );

      const messages: StreamServerMessage[] = [];
      for await (const msg of generator) {
        messages.push(msg);
        if (messages.length === 2) {
          controller.abort();
        }
      }

      const lastMsg = messages[messages.length - 1];
      expect(lastMsg.type).toBe('ABORTED');
    });

    it('should emit ABORTED message immediately when pre-aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const generator = generateMockStreamMessages('测试', 'polished', controller.signal);
      const messages: StreamServerMessage[] = [];

      for await (const msg of generator) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('ABORTED');
    });
  });
});
