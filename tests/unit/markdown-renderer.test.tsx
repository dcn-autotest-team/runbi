import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { MarkdownRenderer } from '../../shared/components/MarkdownRenderer';

describe('Shared Markdown rendering', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  const render = (content: string, isGenerating = false) => act(() => root.render(<MarkdownRenderer content={content} isGenerating={isGenerating} />));

  it('renders semantic headings, nested emphasis, nested lists, quotes, and horizontal rules', () => {
    render('# 标题\n\n**粗体里有 *斜体***\n\n1. 第一项\n   - 子项\n\n> 引用 **重点**\n\n---\n\n###### 六级标题');
    expect(host.querySelector('h1')?.textContent).toBe('标题');
    expect(host.querySelector('h6')?.textContent).toBe('六级标题');
    expect(host.querySelector('strong em')?.textContent).toBe('斜体');
    expect(host.querySelector('ol li ul li')?.textContent).toBe('子项');
    expect(host.querySelector('blockquote strong')?.textContent).toBe('重点');
    expect(host.querySelector('hr')).not.toBeNull();
  });

  it('renders GFM tables, task lists, strikethrough, links, and preserves identifiers', () => {
    render('| 名称 | 状态 |\n| :--- | ---: |\n| **模块** | `a_b_c` |\n\n- [x] 完成\n- [ ] 待办\n\n~~删除~~ [文档](https://example.com/docs?q=1)\n\nfile_name_here');
    expect(host.querySelectorAll('th')).toHaveLength(2);
    expect(host.querySelector('td strong')?.textContent).toBe('模块');
    expect(host.querySelector('td code')?.textContent).toBe('a_b_c');
    expect(host.querySelector<HTMLTableCellElement>('td:last-child')?.style.textAlign).toBe('right');
    const boxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(Array.from(boxes).map((box) => [box.checked, box.disabled])).toEqual([[true, true], [false, true]]);
    expect(host.querySelector('del')?.textContent).toBe('删除');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.com/docs?q=1');
    expect(host.textContent).toContain('file_name_here');
  });

  it('preserves streamed code verbatim and respects nested fence lengths', () => {
    const content = '## 输出\r\n\r\n````markdown\r\n```js\r\n  const x = "**literal**";\r\n```\r\n````';
    for (let end = 1; end <= content.length; end++) render(content.slice(0, end), true);
    expect(host.querySelector('pre code')?.textContent?.replace(/\r\n/g, '\n')).toBe('```js\n  const x = "**literal**";\n```\n');
    expect(host.querySelector('pre strong')).toBeNull();
    expect(host.querySelector('.runbi-markdown-cursor')).not.toBeNull();
    render(content);
    expect(host.querySelector('.runbi-markdown-cursor')).toBeNull();
    render('~~~python\nprint("中文🙂")', true);
    expect(host.querySelector('pre code')?.textContent).toContain('print("中文🙂")');
    expect(host.querySelector('.runbi-markdown-code-label')?.textContent).toBe('python');
  });

  it('does not execute HTML, allow unsafe links, or automatically fetch model images', () => {
    render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[危险](javascript:alert%281%29)\n\n![远程图片](https://example.com/tracker.png)\n\n`<script>literal</script>`');
    expect(host.querySelector('script, img, iframe')).toBeNull();
    expect(host.querySelector('a')?.getAttribute('href')).toBe('');
    expect(host.querySelector('code')?.textContent).toBe('<script>literal</script>');
    expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('远程图片');
  });
});
