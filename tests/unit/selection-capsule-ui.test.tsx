import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SelectionCapsule } from '../../desktop/src/components/SelectionCapsule';

describe('SelectionCapsule UI', () => {
  it('uses accessible SVG actions without emoji labels in correct order (agent first, search last)', () => {
    const html = renderToStaticMarkup(
      <SelectionCapsule
        visible
        onAgent={vi.fn()}
        onPolish={vi.fn()}
        onReply={vi.fn()}
        onTranslate={vi.fn()}
        onCopy={vi.fn()}
        onSearch={vi.fn()}
      />
    );

    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="智能体任务"');
    expect(html).toContain('aria-label="润色选中文本"');
    expect(html).toContain('aria-label="智能回复选中文本"');
    expect(html).toContain('aria-label="翻译选中文本"');
    expect(html).toContain('aria-label="复制选中文本"');
    expect(html).toContain('aria-label="在浏览器中搜索选中文本"');
    expect(html).not.toMatch(/[✨💬📋✅]/u);
    expect(html).not.toContain('data-tauri-drag-region');

    // Agent first, search last
    const agentIdx = html.indexOf('aria-label="智能体任务"');
    const polishIdx = html.indexOf('aria-label="润色选中文本"');
    const replyIdx = html.indexOf('aria-label="智能回复选中文本"');
    const transIdx = html.indexOf('aria-label="翻译选中文本"');
    const copyIdx = html.indexOf('aria-label="复制选中文本"');
    const searchIdx = html.indexOf('aria-label="在浏览器中搜索选中文本"');

    expect(agentIdx).toBeLessThan(polishIdx);
    expect(polishIdx).toBeLessThan(replyIdx);
    expect(replyIdx).toBeLessThan(transIdx);
    expect(transIdx).toBeLessThan(copyIdx);
    expect(copyIdx).toBeLessThan(searchIdx);
  });

  it('clicking capsule body invokes onAgent as default action', async () => {
    const onAgent = vi.fn();
    const onPolish = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <SelectionCapsule
          visible
          onAgent={onAgent}
          onPolish={onPolish}
          onReply={vi.fn()}
          onTranslate={vi.fn()}
          onCopy={vi.fn()}
          onSearch={vi.fn()}
        />
      );
    });

    const capsule = host.querySelector('[data-testid="selection-capsule"]') as HTMLDivElement;
    expect(capsule).not.toBeNull();

    await act(async () => {
      capsule.click();
    });

    expect(onAgent).toHaveBeenCalledTimes(1);
    expect(onPolish).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
