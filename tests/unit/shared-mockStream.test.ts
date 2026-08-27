/**
 * @file tests/unit/shared-mockStream.test.ts
 * Unit tests for Simulated Streaming Engine (@runbi/shared/core/mockStream)
 */

import { describe, it, expect } from 'vitest';
import {
  transformPreset,
  generateMockStream,
  generateMockStreamMessages,
  calculateStreamMetrics,
  MOCK_POLISH_RULES,
} from '@runbi/shared/core/mockStream';
import type { PolishStyle } from '@runbi/shared/types/stream';

describe('Shared Core: Simulated Typewriter Streaming Engine', () => {
  const styles: PolishStyle[] = [
    'polished',
    'academic',
    'business',
    'literary',
    'concise',
    'native_en',
    'reply',
  ];

  describe('transformPreset', () => {
    it('should generate distinct mock outputs for all 7 styles', () => {
      const text = '这是一段较长且需要润色的原始文本内容';
      const results = new Set<string>();
      for (const style of styles) {
        const transformed = transformPreset(text, style);
        expect(transformed).toBeDefined();
        expect(transformed.length).toBeGreaterThan(0);
        results.add(transformed);
      }
      expect(results.size).toBe(7);
    });

    it('should prioritize userInstruction when provided', () => {
      const text = '下周一开会';
      const instruction = '委婉推迟';
      const transformed = transformPreset(text, 'reply', instruction);

      expect(transformed).toContain('委婉推迟');
      expect(transformed).toContain('下周一开会');
    });
  });

  describe('generateMockStream (Raw chunks)', () => {
    it('should stream all chunks and return final stats', async () => {
      const text = '短文本测试';
      const stream = generateMockStream(text, 'polished', undefined, {
        minDelay: 1,
        maxDelay: 2,
      });

      let fullOutput = '';
      let chunkCount = 0;

      while (true) {
        const item = await stream.next();
        if (item.done) {
          expect(item.value.tokenCount).toBeGreaterThan(0);
          expect(item.value.durationMs).toBeGreaterThan(0);
          break;
        }
        fullOutput += item.value;
        chunkCount++;
      }

      expect(chunkCount).toBeGreaterThan(0);
      expect(fullOutput).toBe(transformPreset(text, 'polished'));
    });

    it('should abort cleanly when AbortSignal is aborted mid-stream', async () => {
      const controller = new AbortController();
      const text = '这是一个较长的文本用于测试提前中止流式生成的场景与特性';
      const stream = generateMockStream(text, 'academic', controller.signal, {
        minDelay: 20,
        maxDelay: 30,
      });

      let accumulated = '';
      const firstChunk = await stream.next();
      if (!firstChunk.done) {
        accumulated += firstChunk.value;
      }

      controller.abort();

      const secondChunk = await stream.next();
      expect(secondChunk.done).toBe(true);
    });
  });

  describe('generateMockStreamMessages (StreamServerMessage)', () => {
    it('should yield CHUNK messages followed by a DONE message', async () => {
      const text = '你好，世界';
      const stream = generateMockStreamMessages(text, 'business', undefined, {
        minDelay: 1,
        maxDelay: 2,
      });

      let receivedDone = false;
      let textBuffer = '';

      for await (const msg of stream) {
        if (msg.type === 'CHUNK') {
          textBuffer += msg.payload.delta;
        } else if (msg.type === 'DONE') {
          receivedDone = true;
          expect(msg.payload.totalTokens).toBeGreaterThan(0);
          expect(msg.payload.durationMs).toBeGreaterThan(0);
        }
      }

      expect(receivedDone).toBe(true);
      expect(textBuffer).toBe(transformPreset(text, 'business'));
    });

    it('should yield ABORTED message when signal is aborted before start', async () => {
      const controller = new AbortController();
      controller.abort();

      const stream = generateMockStreamMessages('测试', 'polished', controller.signal);
      const messages = [];

      for await (const msg of stream) {
        messages.push(msg);
      }

      expect(messages).toEqual([{ type: 'ABORTED' }]);
    });
  });

  describe('calculateStreamMetrics', () => {
    it('should compute valid charsPerSecond and tokensPerSecond', () => {
      const metrics = calculateStreamMetrics(100, 50, 2000); // 100 chars, 50 tokens in 2 seconds

      expect(metrics.durationMs).toBe(2000);
      expect(metrics.totalTokens).toBe(50);
      expect(metrics.charsPerSecond).toBe(50);
      expect(metrics.tokensPerSecond).toBe(25);
    });

    it('should prevent divide-by-zero on 0 durationMs', () => {
      const metrics = calculateStreamMetrics(10, 5, 0);
      expect(metrics.charsPerSecond).toBeGreaterThan(0);
      expect(metrics.tokensPerSecond).toBeGreaterThan(0);
    });
  });
});
