import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SelectionCapsule } from '../../desktop/src/components/SelectionCapsule';

describe('SelectionCapsule UI', () => {
  it('uses accessible SVG actions without emoji labels', () => {
    const html = renderToStaticMarkup(
      <SelectionCapsule
        visible
        onSearch={vi.fn()}
        onPolish={vi.fn()}
        onReply={vi.fn()}
        onTranslate={vi.fn()}
        onCopy={vi.fn()}
      />
    );

    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="在浏览器中搜索选中文本"');
    expect(html).toContain('aria-label="润色选中文本"');
    expect(html).toContain('aria-label="智能回复选中文本"');
    expect(html).toContain('aria-label="翻译选中文本"');
    expect(html).toContain('aria-label="复制选中文本"');
    expect(html).not.toMatch(/[✨💬📋✅]/u);
    expect(html).not.toContain('data-tauri-drag-region');
  });
});
