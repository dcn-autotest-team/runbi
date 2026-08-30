/**
 * @file tests/unit/selection-capsule.test.ts
 * Automatic text capture always uses the capsule; only shortcut-originated
 * events may open the full panel directly.
 */

import { describe, it, expect } from 'vitest';
import { buildBrowserSearchUrl, shouldShowCapsule } from '../../desktop/src/components/SelectionCapsule';

describe('SelectionCapsule routing (微胶囊分流)', () => {
  it('routes selection and clipboard events to the capsule regardless of advisory flags', () => {
    expect(shouldShowCapsule({ trigger: 'selection', capsule: true })).toBe(true);
    expect(shouldShowCapsule({ trigger: 'selection', capsule: false })).toBe(true);
    expect(shouldShowCapsule({ trigger: 'selection' })).toBe(true);
    expect(shouldShowCapsule({ trigger: 'clipboard', capsule: true })).toBe(true);
    expect(shouldShowCapsule({ trigger: 'clipboard' })).toBe(true);
    expect(shouldShowCapsule({ trigger: 'shortcut', capsule: true })).toBe(false);
    expect(shouldShowCapsule({ trigger: 'screen-reply' })).toBe(false);
    expect(shouldShowCapsule({ trigger: 'sensitive-blocked' })).toBe(false);
    expect(shouldShowCapsule(null)).toBe(false);
    expect(shouldShowCapsule(undefined)).toBe(false);
  });
});

describe('SelectionCapsule browser search', () => {
  it('trims and safely encodes the selected text', () => {
    expect(buildBrowserSearchUrl(' 润笔 搜索&测试 ')).toBe(
      'https://www.baidu.com/s?wd=%E6%B6%A6%E7%AC%94%20%E6%90%9C%E7%B4%A2%26%E6%B5%8B%E8%AF%95'
    );
  });
});
