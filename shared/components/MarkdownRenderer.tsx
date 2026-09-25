/** Shared CommonMark/GFM rendering for streaming replies and saved history. */
import React, { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './markdown.css';

const plugins = [remarkGfm];
const components: Components = {
  a: ({ node: _node, children, ...props }) => <a {...props} target={props.href?.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a>,
  // Model-generated image URLs must not trigger background requests.
  img: ({ alt }) => <span role="img" aria-label={alt || '图片'}>[图片：{alt || '无描述'}]</span>,
  table: ({ node: _node, children, ...props }) => (
    <div className="runbi-markdown-table" tabIndex={0} role="region" aria-label="表格，可横向滚动"><table {...props}>{children}</table></div>
  ),
  pre: ({ children }) => {
    const child = React.isValidElement<{ className?: string }>(children) ? children : null;
    const language = child?.props.className?.match(/language-([^\s]+)/)?.[1];
    return <div className="runbi-markdown-code">
      {language && <div className="runbi-markdown-code-label">{language}</div>}
      <pre tabIndex={0} aria-label={language ? `${language} 代码` : '代码块'}>{children}</pre>
    </div>;
  },
  input: ({ node: _node, ...props }) => <input {...props} disabled aria-label={props.checked ? '已完成' : '未完成'} />,
};

// Keep the existing inline helper API for shared-component consumers.
export function renderInlineMarkdown(text: string): React.ReactNode[] {
  return text ? [<Markdown key="inline" remarkPlugins={plugins} components={{ ...components, p: ({ children }) => <span>{children}</span> }}>{text}</Markdown>] : [];
}

export interface MarkdownRendererProps {
  content: string;
  className?: string;
  isGenerating?: boolean;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className = '', isGenerating = false }: MarkdownRendererProps) {
  return <div className={`runbi-markdown select-text ${className}`}>
    <Markdown remarkPlugins={plugins} components={components}>{content}</Markdown>
    {isGenerating && <span className="runbi-markdown-cursor" aria-hidden="true" />}
  </div>;
});

export default MarkdownRenderer;
