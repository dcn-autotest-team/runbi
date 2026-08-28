/**
 * InstructionInput - Interactive Custom Instruction & Quick Intent Chips
 * Platform-agnostic component for Runbi (@runbi/shared/components)
 */

import React, { useState } from 'react';

export interface QuickReplyTag {
  label: string;
  text: string;
}

export interface AttachedFileContext {
  name: string;
  content: string;
  size?: number;
}

export interface InstructionInputProps {
  onSubmit: (instruction: string, attachedFiles?: AttachedFileContext[]) => void;
  isGenerating?: boolean;
  placeholder?: string;
  quickTags?: QuickReplyTag[];
  className?: string;
  /** Show the quick-intent chips row (defaults to true; embedders may hide it). */
  showQuickTags?: boolean;
  /** Optional external attached files */
  attachedFiles?: AttachedFileContext[];
  onAttachFile?: (file: AttachedFileContext) => void;
  onRemoveFile?: (index: number) => void;
  /** Optional clipboard reference text */
  clipboardReference?: string | null;
  onAttachClipboard?: () => void;
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
  placeholder = '想怎么改？直接说…',
  quickTags = DEFAULT_QUICK_TAGS,
  className = '',
  showQuickTags = true,
  attachedFiles,
  onAttachFile,
  onRemoveFile,
  clipboardReference,
  onAttachClipboard,
}) => {
  const [value, setValue] = useState('');
  const [localFiles, setLocalFiles] = useState<AttachedFileContext[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const currentFiles = attachedFiles ?? localFiles;

  const handleRemoveFile = (index: number) => {
    if (onRemoveFile) {
      onRemoveFile(index);
    } else {
      setLocalFiles((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isGenerating) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (isGenerating) return;

    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      try {
        // Read text content for files under 100KB
        if (file.size > 100 * 1024) continue;
        const text = await file.text();
        if (text && text.trim()) {
          const item: AttachedFileContext = {
            name: file.name,
            content: text.trim(),
            size: file.size,
          };
          if (onAttachFile) {
            onAttachFile(item);
          } else {
            setLocalFiles((prev) => [...prev, item]);
          }
        }
      } catch {
        // Ignore unreadable binary files
      }
    }
  };

  const handleSubmit = (overrideText?: string) => {
    const textToSubmit = (overrideText ?? value).trim();
    if ((!textToSubmit && currentFiles.length === 0) || isGenerating) return;
    const finalInstruction = textToSubmit || '请参考附加资料进行回复';
    if (currentFiles.length > 0) {
      onSubmit(finalInstruction, currentFiles);
    } else {
      onSubmit(finalInstruction);
    }
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
      {showQuickTags && (
      <div className="flex items-center gap-1.5 overflow-x-auto runbi-scrollbar py-0.5">
        {quickTags.map((tag) => {
          const match = tag.label.match(/^(\d+)\s+(.*)$/);
          return (
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
              className="runbi-focus-ring cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 rounded-lg bg-white/80 dark:bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 transition-all hover:bg-teal-50 hover:text-teal-600 dark:hover:bg-teal-500/20 dark:hover:text-teal-200 border border-slate-200/60 dark:border-white/10 shadow-2xs active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {match ? (
                <>
                  <kbd className="flex items-center justify-center w-4 h-4 rounded bg-teal-100 dark:bg-teal-400/20 text-teal-800 dark:text-teal-300 font-mono text-[10px] font-bold">
                    {match[1]}
                  </kbd>
                  <span>{match[2]}</span>
                </>
              ) : (
                <span>{tag.label}</span>
              )}
            </button>
          );
        })}
      </div>
      )}

      {/* Attached Files & Clipboard Reference Chips */}
      {(currentFiles.length > 0 || clipboardReference) && (
        <div className="flex items-center gap-1.5 flex-wrap px-0.5 py-0.5">
          {currentFiles.map((file, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/60 border border-teal-200/80 dark:border-teal-800/80 text-[#00BFA5] text-[11px]"
            >
              <svg className="w-3 h-3 text-teal-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <span className="truncate max-w-[150px]">{file.name}</span>
              <button
                type="button"
                disabled={isGenerating}
                onClick={() => handleRemoveFile(idx)}
                className="hover:text-rose-500 transition-colors ml-0.5 cursor-pointer font-bold"
                title="移除参考文件"
              >
                ✕
              </button>
            </span>
          ))}
          {clipboardReference && (
            <button
              type="button"
              disabled={isGenerating}
              onClick={onAttachClipboard}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-[#00BFA5] text-[11px] border border-dashed border-slate-300 dark:border-slate-700 cursor-pointer active:scale-95 transition-all font-medium"
              title="点击引用剪贴板中的资料"
            >
              <svg className="w-3 h-3 text-slate-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
              </svg>
              <span>附带剪贴板参考</span>
            </button>
          )}
        </div>
      )}

      {/* Input Box Bar */}
      <div
        className={`flex min-h-10 items-center gap-2 rounded-xl border px-2.5 py-1.5 transition-all ${
          isDragging
            ? 'border-[#00BFA5] bg-teal-50/30 dark:bg-teal-950/30 ring-2 ring-[#00BFA5]/20'
            : 'bg-slate-50/90 dark:bg-slate-800/70 border-slate-200/80 dark:border-slate-700/70 focus-within:border-[#00BFA5] focus-within:ring-2 focus-within:ring-[#00BFA5]/20'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
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
          aria-label="自定义润色要求"
          value={value}
          disabled={isGenerating}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={isDragging ? '松开鼠标以添加参考文件…' : placeholder}
          className="min-w-0 flex-1 bg-transparent font-sans text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder-slate-500"
        />

        {/* Send Button */}
        <button
          id="runbi-instruction-send"
          type="button"
          aria-label="发送自定义回复指令"
          disabled={(!value.trim() && currentFiles.length === 0) || isGenerating}
          onClick={() => handleSubmit()}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className={`runbi-focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all ${
            (value.trim() || currentFiles.length > 0) && !isGenerating
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
