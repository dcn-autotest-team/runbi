/**
 * ActionBar - Action Operations Bar (Regenerate, Copy, In-place Replace)
 * Part of Runbi Chrome Extension (Manifest V3)
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
}

export const ActionBar: React.FC<ActionBarProps> = ({
  onCopy,
  onReplace,
  onRegenerate,
  isEditable,
  isGenerating,
  disabled = false,
  className = '',
}) => {
  return (
    <div
      className={`flex items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-700/60 select-none ${className}`}
    >
      {/* 🔄 换个说法 (Regenerate) */}
      <button
        id="runbi-action-regenerate"
        type="button"
        disabled={isGenerating || disabled}
        onClick={onRegenerate}
        title="换个说法，重新生成"
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors focus:outline-none ${
          isGenerating || disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
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
        <span>换个说法</span>
      </button>

      <div className="flex items-center gap-2">
        {/* 📋 复制结果 (Copy) */}
        <button
          id="runbi-action-copy"
          type="button"
          disabled={disabled}
          onClick={onCopy}
          title="复制润色结果到剪贴板"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors focus:outline-none cursor-pointer"
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
          <span>复制结果</span>
        </button>

        {/* ⚡ 替换原文 (Replace) */}
        <button
          id="runbi-action-replace"
          type="button"
          disabled={!isEditable || isGenerating || disabled}
          onClick={onReplace}
          title={isEditable ? '将润色内容替换到网页输入框' : '当前非可编辑区域，无法直接替换'}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all focus:outline-none ${
            isEditable && !isGenerating && !disabled
              ? 'bg-[#00BFA5] hover:bg-[#00A892] text-white shadow-sm hover:shadow active:scale-95 cursor-pointer font-semibold'
              : 'bg-slate-100 text-slate-400 dark:bg-slate-800/60 dark:text-slate-500 border border-slate-200/60 dark:border-slate-700/50 cursor-not-allowed opacity-60'
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
          <span>替换原文</span>
        </button>
      </div>
    </div>
  );
};

export default ActionBar;
