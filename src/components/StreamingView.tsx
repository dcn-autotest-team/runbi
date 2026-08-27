/**
 * StreamingView - 60fps Typewriter Streaming Presentation with Stats & Controls
 * Part of Runbi Chrome Extension (Manifest V3)
 */

import React, { useRef, useEffect } from 'react';

export interface StreamingViewProps {
  content: string;
  isGenerating: boolean;
  durationMs?: number;
  totalTokens?: number;
  error?: string | null;
  onStop?: () => void;
  onRegenerate?: () => void;
  className?: string;
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
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Content Container */}
      <div
        ref={scrollRef}
        className="relative min-h-[96px] max-h-[220px] p-3 overflow-y-auto bg-slate-50/90 dark:bg-slate-800/60 rounded-xl border border-slate-200/70 dark:border-slate-700/60 text-slate-800 dark:text-slate-100 text-sm leading-relaxed runbi-scrollbar transition-all"
      >
        {error ? (
          <div className="flex items-start gap-2 text-rose-600 dark:text-rose-400 text-xs">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        ) : content.length === 0 && isGenerating ? (
          <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-xs italic py-2">
            <span className="inline-block w-2 h-2 rounded-full bg-[#00BFA5] animate-ping" />
            <span>润笔沉思中，正在字斟句酌...</span>
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words font-sans">
            {content}
            {isGenerating && (
              <span className="inline-block w-1.5 h-4 ml-0.5 bg-[#00BFA5] animate-cursor-blink align-middle rounded-sm" />
            )}
          </div>
        )}
      </div>

      {/* Real-time stats & stop control */}
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1 select-none">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="text-amber-500">⏱</span>
            <span>{formattedTime}</span>
          </span>
          <span>·</span>
          <span>
            {tokenCountDisplay} Tokens
          </span>
        </div>

        {isGenerating && onStop && (
          <button
            type="button"
            onClick={onStop}
            className="flex items-center gap-1 px-2 py-0.5 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded border border-rose-200 dark:border-rose-800/60 transition-colors cursor-pointer"
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
