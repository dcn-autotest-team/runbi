/**
 * @file tests/unit/local-models-and-quota.test.ts
 * 本地模型零配置探测 + 试用额度记账的最小回归检查
 */

import { describe, it, expect } from 'vitest';
import { probeLocalModels, LOCAL_PROBE_TARGETS } from '@runbi/shared/core';
import { estimateTokens, trialRemainingTokens } from '@runbi/shared/types';

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

describe('Local model zero-config probe (Ollama / LM Studio)', () => {
  it('parses ollama /api/tags and lmstudio /v1/models payloads', () => {
    const ollama = LOCAL_PROBE_TARGETS[0];
    expect(ollama!.parse({ models: [{ name: 'qwen2.5:7b' }, { name: 'deepseek-r1:8b' }] })).toEqual([
      'qwen2.5:7b',
      'deepseek-r1:8b',
    ]);
    const lmstudio = LOCAL_PROBE_TARGETS[1];
    expect(lmstudio!.parse({ data: [{ id: 'qwen2.5-7b-instruct' }] })).toEqual(['qwen2.5-7b-instruct']);
    expect(ollama!.parse({})).toEqual([]);
    expect(lmstudio!.parse(null)).toEqual([]);
  });

  it('collects only healthy endpoints and swallows failures', async () => {
    const fetchImpl = (async (url: unknown) => {
      if (String(url).includes('11434')) return jsonResponse({ models: [{ name: 'qwen2.5:7b' }] });
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    const results = await probeLocalModels(fetchImpl);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ providerId: 'ollama', baseUrl: 'http://localhost:11434/v1' });
    expect(results[0]!.models).toEqual(['qwen2.5:7b']);
  });

  it('returns [] when nothing responds or payload has no models', async () => {
    const emptyModels = (async () => jsonResponse({ models: [] })) as unknown as typeof fetch;
    expect(await probeLocalModels(emptyModels)).toEqual([]);

    const failing = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    expect(await probeLocalModels(failing)).toEqual([]);
  });
});

describe('Trial quota accounting (试用额度)', () => {
  it('estimates tokens conservatively for CJK and latin text', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('一二三四五六')).toBe(4);
    expect(estimateTokens('abcdefgh')).toBeGreaterThan(0);
  });

  it('trialRemainingTokens stays 0 while the proxy channel is not configured', () => {
    expect(trialRemainingTokens(0)).toBe(0);
    expect(trialRemainingTokens(undefined)).toBe(0);
  });
});
