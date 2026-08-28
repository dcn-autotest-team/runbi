import { describe, expect, it } from 'vitest';
import { resolveEndpoint } from '@runbi/shared/core';

describe('resolveEndpoint (P0-4 regression guard)', () => {
  it('appends /chat/completions to a bare base URL', () => {
    expect(resolveEndpoint('https://api.deepseek.com/v1')).toBe(
      'https://api.deepseek.com/v1/chat/completions'
    );
  });

  it('does not double-append when URL already ends with /chat/completions', () => {
    expect(resolveEndpoint('https://api.deepseek.com/v1/chat/completions')).toBe(
      'https://api.deepseek.com/v1/chat/completions'
    );
  });

  it('strips trailing slashes before appending', () => {
    expect(resolveEndpoint('https://api.siliconflow.cn/v1/')).toBe(
      'https://api.siliconflow.cn/v1/chat/completions'
    );
  });

  it('falls back to DeepSeek default when empty', () => {
    expect(resolveEndpoint('')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(resolveEndpoint(undefined)).toBe('https://api.deepseek.com/v1/chat/completions');
  });
});
