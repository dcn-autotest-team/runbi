/**
 * ActionBar - Action Operations Bar (Regenerate, Copy, In-place Replace)
 * Platform-agnostic component for Runbi (@runbi/shared/components)
 */

import React from 'react';

export interface ActionBarProps {
  onCopy: () => void;
  onReplace: () => void;
  onRegenerate: () => void;
  isEditable: boolean;
  isGenerating: boolean;
  disabled?: boolean;
  className?: string;
  copyLabel?: string;
  replaceLabel?: string;
  regenerateLabel?: string;
  /** Optional inline control rendered at the left edge (e.g. Diff toggle in embedded mode). */
  leftSlot?: React.ReactNode;
}

export const ActionBar: React.FC<ActionBarProps> = ({
  onCopy,
  onReplace,
  onRegenerate,
  isEditable,
  isGenerating,
  disabled = false,
  className = '',
  copyLabel = '复制结果',
  replaceLabel = '替换原文',
  regenerateLabel = '换个说法',
  leftSlot,
}) => {
  return (
    <div
      className={`flex shrink-0 items-center justify-between gap-2 border-t border-slate-200/70 pt-2.5 select-none dark:border-white/[0.08] ${className}`}
    >
      {/* 换个说法 (Regenerate) */}
      <div className="flex items-center gap-1.5">
        {leftSlot}
        <button
          id="runbi-action-regenerate"
          type="button"
          disabled={isGenerating || disabled}
          onClick={onRegenerate}
          title="换个说法，重新生成"
          className={`runbi-focus-ring flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[0.07] dark:hover:text-slate-100 ${
            isGenerating || disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'
          }`}
        >
        <svg
          className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
        </svg>
        <span>{regenerateLabel}</span>
        </button>
      </div>

      <div className="flex items-center gap-2">
        {/* 复制结果 (Copy) */}
        <button
          id="runbi-action-copy"
          type="button"
          disabled={disabled}
          onClick={onCopy}
          title="复制润色结果到剪贴板"
          className={`runbi-focus-ring flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
            disabled
              ? 'cursor-not-allowed border-slate-200/60 text-slate-400 opacity-45 dark:border-white/[0.06] dark:text-slate-500'
              : 'cursor-pointer border-slate-200/80 text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-white/10 dark:text-slate-300 dark:hover:border-white/20 dark:hover:bg-white/[0.07] dark:hover:text-white'
          }`}
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span>{copyLabel}</span>
        </button>

        {/* 替换原文 (Replace) */}
        <button
          id="runbi-action-replace"
          type="button"
          disabled={!isEditable || isGenerating || disabled}
          onClick={onReplace}
          aria-keyshortcuts="Enter"
          title={isEditable ? '将润色内容替换到输入区域 (Enter)' : '当前非可编辑区域，无法直接替换'}
          className={`runbi-focus-ring relative flex min-h-9 items-center gap-1.5 rounded-lg px-4 text-xs font-medium transition-all ${
            isEditable && !isGenerating && !disabled
              ? 'cursor-pointer bg-teal-400 font-semibold text-slate-950 shadow-[0_8px_20px_-10px_rgba(45,212,191,0.95)] hover:bg-teal-300 active:scale-[0.97] active:bg-teal-500'
              : 'cursor-not-allowed border border-slate-200/60 bg-slate-100 text-slate-400 opacity-50 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-500'
          }`}
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span>{replaceLabel}</span>
          <kbd className="pointer-events-none absolute -right-1 -top-1 flex h-[14px] min-w-[14px] select-none items-center justify-center rounded border border-white/20 bg-black/50 px-1 font-mono text-[9px] leading-none text-white shadow-xs">
            ⏎
          </kbd>
        </button>
      </div>
    </div>
  );
};

export default ActionBar;
