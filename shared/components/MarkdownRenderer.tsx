/**
 * @file shared/components/MarkdownRenderer.tsx
 * Lightweight, streaming-safe and XSS-safe Markdown Renderer for AI Polishing outputs
 * Supports bold (**text**), italic (*text*), inline code (`code`), lists (1., -, *), quotes (>) and headings (#).
 */

import React from 'react';

/**
 * Parses inline markdown tokens (bold, italic, inline code) into React nodes.
 */
export function renderInlineMarkdown(text: string): React.ReactNode[] {
  if (!text) return [];
  const tokens: React.ReactNode[] = [];
  // Match `code`, **bold**, or *italic*
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const raw = match[0];
    if (raw.startsWith('`') && raw.endsWith('`')) {
      tokens.push(
        <code
          key={match.index}
          className="mx-0.5 rounded bg-black/20 px-1.5 py-0.5 font-mono text-[12px] text-teal-600 dark:bg-white/10 dark:text-teal-300"
        >
          {raw.slice(1, -1)}
        </code>
      );
    } else if (
      (raw.startsWith('**') && raw.endsWith('**')) ||
      (raw.startsWith('__') && raw.endsWith('__'))
    ) {
      tokens.push(
        <strong key={match.index} className="font-semibold text-slate-900 dark:text-white">
          {raw.slice(2, -2)}
        </strong>
      );
    } else if (
      (raw.startsWith('*') && raw.endsWith('*')) ||
      (raw.startsWith('_') && raw.endsWith('_'))
    ) {
      tokens.push(
        <em key={match.index} className="italic text-slate-800 dark:text-slate-200">
          {raw.slice(1, -1)}
        </em>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }

  return tokens;
}

export interface MarkdownRendererProps {
  content: string;
  className?: string;
  isGenerating?: boolean;
}

/**
 * Streaming-safe Markdown Renderer for AI responses.
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = '',
  isGenerating = false,
}) => {
  const lines = content.split('\n');

  return (
    <div className={`space-y-1.5 break-words select-text ${className}`}>
      {lines.map((line, idx) => {
        const isLastLine = idx === lines.length - 1;
        const trimmed = line.trim();

        // Empty line spacing
        if (!trimmed) {
          return (
            <div key={idx} className="h-1.5">
              {isLastLine && isGenerating && (
                <span className="inline-block h-3.5 w-1.5 rounded-sm bg-[#00BFA5] align-middle animate-cursor-blink" />
              )}
            </div>
          );
        }

        // Ordered list: 1. 2. 3.
        const numMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
        if (numMatch) {
          return (
            <div key={idx} className="flex items-start gap-1.5 pl-0.5 leading-relaxed">
              <span className="shrink-0 select-none font-mono font-medium text-teal-600 dark:text-teal-400">
                {numMatch[2]}.
              </span>
              <div className="min-w-0 flex-1 break-words">
                {renderInlineMarkdown(numMatch[3])}
                {isLastLine && isGenerating && (
                  <span className="ml-1 inline-block h-3.5 w-1.5 rounded-sm bg-[#00BFA5] align-middle animate-cursor-blink" />
                )}
              </div>
            </div>
          );
        }

        // Unordered list: - * •
        const bulletMatch = line.match(/^(\s*)([-*•])\s+(.*)$/);
        if (bulletMatch) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-0.5 leading-relaxed">
              <span className="shrink-0 select-none font-bold text-teal-500">•</span>
              <div className="min-w-0 flex-1 break-words">
                {renderInlineMarkdown(bulletMatch[3])}
                {isLastLine && isGenerating && (
                  <span className="ml-1 inline-block h-3.5 w-1.5 rounded-sm bg-[#00BFA5] align-middle animate-cursor-blink" />
                )}
              </div>
            </div>
          );
        }

        // Headings: ### ## #
        const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const headingClass =
            level === 1
              ? 'text-sm font-bold text-slate-900 dark:text-white pt-1'
              : level === 2
                ? 'text-[13px] font-bold text-slate-900 dark:text-white pt-0.5'
                : 'text-xs font-semibold text-slate-800 dark:text-slate-200';
          return (
            <div key={idx} className={headingClass}>
              {renderInlineMarkdown(headingMatch[2])}
              {isLastLine && isGenerating && (
                <span className="ml-1 inline-block h-3.5 w-1.5 rounded-sm bg-[#00BFA5] align-middle animate-cursor-blink" />
              )}
            </div>
          );
        }

        // Blockquote: >
        if (line.startsWith('>')) {
          return (
            <div
              key={idx}
              className="border-l-2 border-teal-500/50 pl-2.5 py-0.5 text-slate-600 italic dark:text-slate-300"
            >
              {renderInlineMarkdown(line.slice(1).trim())}
              {isLastLine && isGenerating && (
                <span className="ml-1 inline-block h-3.5 w-1.5 rounded-sm bg-[#00BFA5] align-middle animate-cursor-blink" />
              )}
            </div>
          );
        }

        // Standard text paragraph
        return (
          <div key={idx} className="leading-relaxed">
            {renderInlineMarkdown(line)}
            {isLastLine && isGenerating && (
              <span className="ml-1 inline-block h-3.5 w-1.5 rounded-sm bg-[#00BFA5] align-middle animate-cursor-blink" />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default MarkdownRenderer;
