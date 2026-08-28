/**
 * StreamingView - 60fps Typewriter Streaming Presentation with Stats & Controls
 * Platform-agnostic component for Runbi (@runbi/shared/components)
 */

import React, { useRef, useEffect } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';

export interface StreamingViewProps {
  content: string;
  isGenerating: boolean;
  durationMs?: number;
  totalTokens?: number;
  error?: string | null;
  onStop?: () => void;
  onRegenerate?: () => void;
  className?: string;
  placeholder?: string;
  /** Optional model name shown in the meta row (embedded mode). */
  model?: string;
}

export const StreamingView: React.FC<StreamingViewProps> = ({
  content,
  isGenerating,
  durationMs,
  totalTokens,
  error,
  onStop,
  onRegenerate,
  className = '',
  placeholder = '润笔沉思中，正在字斟句酌...',
  model,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom during streaming
  useEffect(() => {
    if (isGenerating && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, isGenerating]);

  // Formatted duration string
  const formattedTime =
    typeof durationMs === 'number'
      ? `${(durationMs / 1000).toFixed(1)}s`
      : '0.0s';

  const tokenCountDisplay = totalTokens ?? (content ? Math.ceil(content.length * 1.2) : 0);

  return (
    <div className={`flex min-h-0 flex-col gap-2 ${className}`}>
      {/* Content Container */}
      <div
        ref={scrollRef}
        aria-live="polite"
        aria-busy={isGenerating}
        className="relative min-h-[64px] flex-1 overflow-y-auto rounded-xl border border-slate-200/70 bg-white/50 px-3.5 py-2.5 text-[13px] leading-[1.8] text-slate-800 transition-all runbi-scrollbar dark:border-white/[0.08] dark:bg-black/30 dark:text-slate-100"
      >
        {error ? (
          <div className="flex h-full min-h-[64px] flex-col items-center justify-center gap-2 text-center">
            <div className="flex items-start gap-2 max-w-[90%] text-rose-600 dark:text-rose-400 text-xs">
              <svg
                className="w-4 h-4 flex-shrink-0 mt-0.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="text-left leading-relaxed">{error}</span>
            </div>
            {onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                className="runbi-focus-ring flex items-center gap-1.5 rounded-lg border border-teal-400/30 bg-teal-400/10 px-3 py-1.5 text-xs font-medium text-teal-600 transition-colors hover:bg-teal-400/20 cursor-pointer dark:text-teal-300"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                  <polyline points="21 3 21 9 15 9" />
                </svg>
                重试
              </button>
            )}
          </div>
        ) : content.length === 0 && isGenerating ? (
          <div className="flex h-full min-h-[64px] items-center justify-center gap-2 text-xs text-slate-400 dark:text-slate-400">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-teal-400" />
            </span>
            <span>{placeholder}</span>
          </div>
        ) : content.length === 0 ? (
          <div className="flex h-full min-h-[64px] flex-col items-center justify-center text-center">
            <div className="mb-1.5 flex h-8 w-8 items-center justify-center rounded-xl border border-teal-400/20 bg-teal-400/10 text-teal-400">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
              </svg>
            </div>
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">准备生成润色稿</p>
            <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">选择润色方式，或在下方补充具体要求</p>
          </div>
        ) : (
          <MarkdownRenderer
            content={content}
            isGenerating={isGenerating}
            className="font-sans text-[13px] leading-[1.8]"
          />
        )}
      </div>

      {/* Real-time stats & stop control */}
      <div className="flex items-center justify-between px-1 text-[11px] text-slate-400 select-none dark:text-slate-400 font-medium shrink-0 pt-0.5">
        <div className="flex items-center gap-1.5">
          {model && (
            <>
              <span className="font-medium">{model}</span>
              <span>·</span>
            </>
          )}
          <span>{formattedTime}</span>
          <span>·</span>
          <span>
            {tokenCountDisplay} Tokens
          </span>
        </div>

        {isGenerating && onStop && (
          <button
            type="button"
            onClick={onStop}
            className="runbi-focus-ring flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-xs text-rose-600 transition-colors hover:bg-rose-50 cursor-pointer dark:border-rose-800/60 dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            <span className="w-2 h-2 bg-rose-600 dark:bg-rose-400 rounded-sm" />
            <span>中止生成</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default StreamingView;
