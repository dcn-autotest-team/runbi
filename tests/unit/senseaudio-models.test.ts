/**
 * @file tests/unit/senseaudio-models.test.ts
 * SenseAudio /v1/models 自动获取模型列表 + AdvancedSettings 模型选择卡的最小回归检查。
 * 真实契约：GET https://api.senseaudio.cn/v1/models + Bearer → {"object":"list","data":[{"id":...}]}
 * （2026-09-15 用 SENSEAUDIO_API_KEY 实测：senseaudio-s2 / senseaudio-vl-* 等）
 */

import { describe, it, expect } from 'vitest';
import { fetchCompatibleModels, fetchSenseAudioModels, SENSEAUDIO_BASE_URL } from '@runbi/shared/core';

/** 与真实端点同形的 /v1/models 响应（截取）。 */
const REAL_SHAPE = {
  object: 'list',
  data: [
    { id: 'senseaudio-s2', object: 'model', mode: 'llm' },
    { id: 'senseaudio-vl-lite-1.0-260319', object: 'model', mode: 'llm' },
  ],
};

describe('fetchSenseAudioModels', () => {
  it('parses the real /v1/models payload into model ids', async () => {
    let calledUrl = '';
    const fetchImpl = (async (url: unknown) => {
      calledUrl = String(url);
      return { ok: true, status: 200, json: async () => REAL_SHAPE } as unknown as Response;
    }) as unknown as typeof fetch;
    const { models, error } = await fetchSenseAudioModels(fetchImpl, undefined, 'sk-test');
    expect(calledUrl).toBe('https://api.senseaudio.cn/v1/models');
    expect(error).toBeUndefined();
    expect(models).toEqual(['senseaudio-s2', 'senseaudio-vl-lite-1.0-260319']);
    expect(SENSEAUDIO_BASE_URL).toBe('https://api.senseaudio.cn/v1');
  });

  it('returns an error for HTTP 401 without throwing (failure path)', async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 401, statusText: 'Unauthorized' } as unknown as Response)) as unknown as typeof fetch;
    const { models, error } = await fetchSenseAudioModels(fetchImpl, undefined, 'bad-key');
    expect(models).toEqual([]);
    expect(error).toBe('HTTP 401 Unauthorized');
  });

  it('returns a key-missing error and sends no request', async () => {
    const fetchImpl = (async () => {
      throw new Error('should not be called');
    }) as unknown as typeof fetch;
    const { models, error } = await fetchSenseAudioModels(fetchImpl, undefined, '  ');
    expect(models).toEqual([]);
    expect(error).toContain('API Key');
  });

  it('swallows network errors', async () => {
    const fetchImpl = (async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    const { models, error } = await fetchSenseAudioModels(fetchImpl, undefined, 'sk-test');
    expect(models).toEqual([]);
    expect(error).toBe('connection refused');
  });
});

describe('compatible model lists', () => {
  it.each(['http://localhost:11434/v1/', 'http://localhost:11434/v1/chat/completions/'])(
    'normalizes %s and permits a keyless local service', async (baseUrl) => {
      const fetchImpl = (async (url, init) => {
        expect(url).toBe('http://localhost:11434/v1/models');
        expect(init?.headers).toEqual({});
        return { ok: true, json: async () => ({ data: [{ id: 'qwen' }, { id: 'qwen' }, null] }) } as Response;
      }) as typeof fetch;
      expect(await fetchCompatibleModels(fetchImpl, baseUrl)).toEqual({ models: ['qwen'] });
    });
  it('reports an empty model list', async () => {
    const fetchImpl = (async () => ({ ok: true, json: async () => ({ data: [] }) })) as unknown as typeof fetch;
    expect((await fetchCompatibleModels(fetchImpl)).error).toContain('未返回可用模型');
  });
});
