/**
 * OriginalPreview - Collapsible Source Text Viewer
 * Platform-agnostic component for Runbi (@runbi/shared/components)
 */

import React, { useState } from 'react';

export interface OriginalPreviewProps {
  originalText: string;
  defaultExpanded?: boolean;
  maxHeight?: string;
  className?: string;
  title?: string;
  onToggle?: (expanded: boolean) => void;
}

export const OriginalPreview: React.FC<OriginalPreviewProps> = ({
  originalText,
  defaultExpanded = false,
  maxHeight = '120px',
  className = '',
  title = '原文预览',
  onToggle,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!originalText) return null;

  const handleToggle = () => {
    const next = !isExpanded;
    setIsExpanded(next);
    onToggle?.(next);
  };

  const charCount = originalText.length;

  return (
    <div
      className={`rounded-xl border border-slate-200/70 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/50 overflow-hidden select-none transition-all ${className}`}
    >
      {/* Accordion Header */}
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls="runbi-original-preview-content"
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-1.5 font-medium">
          <svg
            className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <span>{title}</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200/70 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400">
            {charCount} 字
          </span>
        </div>

        <div className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
          <span>{isExpanded ? '收起' : '展开'}</span>
          <svg
            className={`w-3.5 h-3.5 transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {/* Accordion Content */}
      {isExpanded && (
        <div
          id="runbi-original-preview-content"
          style={{ maxHeight }}
          className="p-2.5 pt-1 text-xs text-slate-700 dark:text-slate-200 leading-relaxed font-sans overflow-y-auto runbi-scrollbar whitespace-pre-wrap break-words border-t border-slate-200/50 dark:border-slate-700/40 select-text"
        >
          {originalText}
        </div>
      )}
    </div>
  );
};

export default OriginalPreview;
