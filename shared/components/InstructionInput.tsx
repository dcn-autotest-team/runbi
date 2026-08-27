/**
 * InstructionInput - Interactive Custom Instruction & Quick Intent Chips
 * Platform-agnostic component for Runbi (@runbi/shared/components)
 */

import React, { useState } from 'react';

export interface QuickReplyTag {
  label: string;
  text: string;
}

export interface InstructionInputProps {
  onSubmit: (instruction: string) => void;
  isGenerating?: boolean;
  placeholder?: string;
  quickTags?: QuickReplyTag[];
  className?: string;
}

export const DEFAULT_QUICK_TAGS: QuickReplyTag[] = [
  { label: '赞同补充', text: '赞同该观点，并补充细节与论据' },
  { label: '委婉拒绝', text: '礼貌、委婉地予以拒绝并表达感谢' },
  { label: '礼貌致谢', text: '真诚致谢并提出后续合作或跟进期望' },
  { label: '幽默风趣', text: '用生动、幽默、高情商的语气予以回复' },
];

export const InstructionInput: React.FC<InstructionInputProps> = ({
  onSubmit,
  isGenerating = false,
  placeholder = '输入回复意向或自定义要求 (Enter 发送)...',
  quickTags = DEFAULT_QUICK_TAGS,
  className = '',
}) => {
  const [value, setValue] = useState('');

  const handleSubmit = (overrideText?: string) => {
    const textToSubmit = (overrideText ?? value).trim();
    if (!textToSubmit || isGenerating) return;
    onSubmit(textToSubmit);
    if (!overrideText) {
      setValue('');
    }
  };

  const handleChipClick = (text: string) => {
    setValue(text);
    handleSubmit(text);
  };

  return (
    <div className={`flex flex-col gap-1.5 select-none ${className}`}>
      {/* Quick Reply Chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto runbi-scrollbar py-0.5">
        <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium whitespace-nowrap flex items-center gap-0.5">
          <span>💡</span> 快捷意向:
        </span>
        {quickTags.map((tag) => (
          <button
            key={tag.label}
            type="button"
            disabled={isGenerating}
            onClick={() => handleChipClick(tag.text)}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            title={tag.text}
            className="px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 bg-slate-100/90 dark:bg-slate-800/80 hover:bg-teal-50 hover:text-[#00BFA5] dark:hover:bg-teal-950/50 dark:hover:text-teal-300 rounded-md border border-slate-200/60 dark:border-slate-700/60 transition-all whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {tag.label}
          </button>
        ))}
      </div>

      {/* Input Box Bar */}
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50/90 dark:bg-slate-800/70 rounded-xl border border-slate-200/80 dark:border-slate-700/70 focus-within:border-[#00BFA5] focus-within:ring-2 focus-within:ring-[#00BFA5]/20 transition-all"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Chat / Pen Icon */}
        <svg
          className="w-3.5 h-3.5 text-[#00BFA5] flex-shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>

        <input
          id="runbi-instruction-input"
          type="text"
          value={value}
          disabled={isGenerating}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none font-sans"
        />

        {/* Send Button */}
        <button
          id="runbi-instruction-send"
          type="button"
          aria-label="发送自定义回复指令"
          disabled={!value.trim() || isGenerating}
          onClick={() => handleSubmit()}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className={`flex items-center justify-center w-6 h-6 rounded-lg transition-all focus:outline-none ${
            value.trim() && !isGenerating
              ? 'bg-[#00BFA5] hover:bg-[#00A892] text-white shadow-sm active:scale-95 cursor-pointer'
              : 'bg-slate-200/70 dark:bg-slate-700/60 text-slate-400 dark:text-slate-500 cursor-not-allowed'
          }`}
        >
          {isGenerating ? (
            <svg
              className="w-3 h-3 animate-spin text-slate-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
          ) : (
            <svg
              className="w-3 h-3 transform rotate-45 -translate-x-0.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
};

export default InstructionInput;
