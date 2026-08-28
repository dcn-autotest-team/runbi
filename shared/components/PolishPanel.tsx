import React, { useState, useEffect } from 'react';
import type { PolishStyle } from '../types/stream';
import type { ScreenReplyAnalysis } from '../core/prompts';
import StyleTabs from './StyleTabs';
import StreamingView from './StreamingView';
import DiffViewer from './DiffViewer';
import ActionBar from './ActionBar';
import Toast from './Toast';
import InstructionInput, { type AttachedFileContext } from './InstructionInput';
import OriginalPreview from './OriginalPreview';

export interface PolishPanelProps {
  top?: number;
  left?: number;
  originalText: string;
  polishedText: string;
  isGenerating: boolean;
  activeStyle: PolishStyle;
  isDiffMode: boolean;
  isEditable: boolean;
  durationMs?: number;
  totalTokens?: number;
  error?: string | null;
  modelName?: string;
  toastMessage?: string;
  toastVisible?: boolean;
  showOriginalPreview?: boolean;
  defaultCollapsed?: boolean;
  screenReplyAnalysis?: ScreenReplyAnalysis | null;
  onClose: () => void;
  onStyleChange: (style: PolishStyle) => void;
  onToggleDiff: () => void;
  onStop: () => void;
  onRegenerate: () => void;
  onCopy: () => void;
  onReplace: () => void;
  onSendInstruction?: (instruction: string, attachedFiles?: AttachedFileContext[]) => void;
  onSelectClarifyChip?: (chipText: string) => void;
  onToastDismiss?: () => void;
  className?: string;
  style?: React.CSSProperties;
  /** Embedded mode (desktop): no inner header, fills parent width, chips only in reply style. */
  embedded?: boolean;
  onManualGrab?: () => void;
  replaceLabel?: string;
  /** Optional attached files for context enrichment */
  attachedFiles?: AttachedFileContext[];
  onAttachFile?: (file: AttachedFileContext) => void;
  onRemoveFile?: (index: number) => void;
  /** Optional clipboard text reference */
  clipboardReference?: string | null;
  onAttachClipboard?: () => void;
}

export const PolishPanel: React.FC<PolishPanelProps> = ({
  top,
  left,
  originalText,
  polishedText,
  isGenerating,
  activeStyle,
  isDiffMode,
  isEditable,
  durationMs,
  totalTokens,
  error,
  modelName = 'DeepSeek-V3',
  toastMessage = '已复制到剪贴板',
  toastVisible = false,
  showOriginalPreview = false,
  defaultCollapsed = false,
  screenReplyAnalysis,
  onClose,
  onStyleChange,
  onToggleDiff,
  onStop,
  onRegenerate,
  onCopy,
  onReplace,
  onSendInstruction,
  onSelectClarifyChip,
  onToastDismiss,
  className = '',
  style = {},
  embedded = false,
  onManualGrab,
  replaceLabel,
  attachedFiles,
  onAttachFile,
  onRemoveFile,
  clipboardReference,
  onAttachClipboard,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [showConvSummary, setShowConvSummary] = useState(true);

  // Keyboard shortcut listener for Attitude/Intent chips (1, 2, 3...)
  useEffect(() => {
    if (!screenReplyAnalysis?.clarify_options || screenReplyAnalysis.clarify_options.length === 0) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (
        activeTag === 'input' ||
        activeTag === 'textarea' ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= screenReplyAnalysis.clarify_options!.length) {
        e.preventDefault();
        onSelectClarifyChip?.(screenReplyAnalysis.clarify_options![num - 1]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [screenReplyAnalysis, onSelectClarifyChip]);

  const diffToggleButton = (
    <button
      id="diff-toggle"
      type="button"
      aria-label={isDiffMode ? '切换到终稿视图' : '切换到差异对比'}
      onClick={onToggleDiff}
      className={`runbi-focus-ring h-8 px-2.5 text-[11px] font-medium rounded-lg transition-colors cursor-pointer border ${
        isDiffMode
          ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-700'
          : 'bg-transparent text-slate-500 border-slate-200 hover:bg-slate-100 dark:bg-transparent dark:text-slate-400 dark:border-slate-700 dark:hover:bg-slate-800'
      }`}
    >
      {isDiffMode ? '查看终稿' : '对比修改'}
    </button>
  );

  // Compute positioning style: if top/left provided, use absolute floating; otherwise fluid container
  const positionStyle: React.CSSProperties = {
    ...(typeof top === 'number' && typeof left === 'number'
      ? { top: `${top}px`, left: `${left}px`, position: 'absolute' as const }
      : {}),
    pointerEvents: 'auto',
    ...style,
  };

  return (
    <div
      id="runbi-panel"
      role="dialog"
      aria-label="润笔划词润色面板"
      onMouseDown={(e) => {
        // Prevent clicks inside panel from triggering outside-click dismissal
        e.stopPropagation();
      }}
      style={positionStyle}
      className={embedded
        ? `z-[2147483647] pointer-events-auto flex min-h-0 w-full flex-col text-slate-800 dark:text-slate-100 select-none font-sans ${className}`
        : `z-[2147483647] pointer-events-auto w-[400px] max-w-[90vw] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-panel dark:shadow-panel-dark text-slate-800 dark:text-slate-100 animate-panel-in select-none font-sans overflow-hidden ${className}`}
    >
      {/* Toast Feedback */}
      <Toast
        message={toastMessage}
        visible={toastVisible}
        durationMs={1500}
        onDismiss={onToastDismiss}
      />

      {/* Header (floating mode only; embedded delegates chrome to the host window) */}
      {!embedded && (
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50/80 dark:bg-slate-800/80 border-b border-slate-200/70 dark:border-slate-700/60">
        {/* Brand */}
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-[#00BFA5] flex items-center justify-center text-white shadow-xs">
            <svg
              className="w-3 h-3 transform -rotate-12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19l7-7 3 3-7 7-3-3z" />
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
            </svg>
          </div>
          <span className="text-xs font-bold tracking-tight text-slate-800 dark:text-slate-100 flex items-center gap-1">
            <span>润笔</span>
            <span className="text-[10px] font-normal text-slate-400">Runbi</span>
          </span>

          {/* Model Badge */}
          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-teal-50 dark:bg-teal-950/60 text-[#00BFA5] border border-teal-200 dark:border-teal-800/50">
            {modelName}
          </span>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-1.5">
          {/* Diff Toggle Switch */}
          {diffToggleButton}

          {/* Minimize / Collapse Button */}
          <button
            id="collapse-btn"
            type="button"
            aria-label={isCollapsed ? '展开面板' : '折叠面板'}
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 dark:hover:text-slate-200 dark:hover:bg-slate-700/60 transition-colors cursor-pointer"
          >
            <svg
              className={`w-3.5 h-3.5 transform transition-transform ${isCollapsed ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>

          {/* Close Button */}
          <button
            id="close-btn"
            type="button"
            aria-label="关闭面板"
            title="关闭面板 (Esc)"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/60 transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      )}

      {/* Main Body */}
      {!isCollapsed && (
        <div className={embedded ? 'flex min-h-0 flex-1 flex-col gap-3 px-4 py-3' : 'p-4 flex flex-col gap-3.5'}>
          {/* Optional Original Preview */}
          {showOriginalPreview && (
            <OriginalPreview
              originalText={originalText}
              compact={embedded}
              actionSlot={
                embedded && onManualGrab ? (
                  <button
                    type="button"
                    onClick={onManualGrab}
                    title="读取剪贴板"
                    aria-label="重新读取选中文本"
                    className="runbi-focus-ring flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
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
                      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                      <path d="M21 3v5h-5" />
                      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                      <path d="M8 16H3v5" />
                    </svg>
                  </button>
                ) : undefined
              }
              rightSlot={embedded ? diffToggleButton : undefined}
            />
          )}

          {/* Style Selector (only for non-reply polish styles) */}
          {activeStyle !== 'reply' && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-400">润色方式</span>
              <StyleTabs
                activeStyle={activeStyle}
                onStyleChange={onStyleChange}
                disabled={isGenerating}
              />
            </div>
          )}

          {/* Screen Reply: Context Badge, Conversation Summary & Attitude Chips */}
          {screenReplyAnalysis && (
            <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-slate-50/90 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 text-xs">
              {/* Visual Context Header Badge */}
              <div className="flex items-center justify-between pb-0.5 text-xs text-teal-600 dark:text-teal-400 font-medium select-none">
                <span className="flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00BFA5] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00BFA5]"></span>
                  </span>
                  <span>💡 已感知聊天上下文</span>
                </span>
                {screenReplyAnalysis.conversation && screenReplyAnalysis.conversation.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowConvSummary((prev) => !prev)}
                    className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  >
                    {showConvSummary ? '收起记录 ▴' : `展开记录(${screenReplyAnalysis.conversation.length}) ▾`}
                  </button>
                )}
              </div>

              {/* Highlighted Other Party Message / Request */}
              {screenReplyAnalysis.last_message_from_other && (
                <div className="px-2.5 py-1.5 rounded-lg bg-slate-100/90 dark:bg-slate-750/70 border border-slate-200/60 dark:border-slate-700/60 text-[11px] leading-snug">
                  <span className="font-semibold text-slate-500 dark:text-slate-400 mr-1.5">对方诉求:</span>
                  <span className="text-slate-800 dark:text-slate-100 font-medium">{screenReplyAnalysis.last_message_from_other}</span>
                </div>
              )}

              {/* Conversation Summary (Collapsible) */}
              {showConvSummary && screenReplyAnalysis.conversation && screenReplyAnalysis.conversation.length > 0 && (
                <div className="flex flex-col gap-1 mt-0.5 pl-1 max-h-24 overflow-y-auto runbi-scrollbar border-l-2 border-teal-200 dark:border-teal-800/80">
                  {screenReplyAnalysis.conversation.map((msg, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 text-[11px]">
                      <span
                        className={`px-1 py-0.2 rounded text-[10px] font-semibold flex-shrink-0 ${
                          msg.sender === 'me'
                            ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-300'
                            : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {msg.sender === 'me' ? '我' : '对方'}
                      </span>
                      <span className="text-slate-700 dark:text-slate-300 leading-snug break-words">{msg.text}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Attitude / Intent Chips with [1]/[2]/[3] Number Badges */}
              {screenReplyAnalysis.clarify_options && screenReplyAnalysis.clarify_options.length > 0 && (
                <div className="flex flex-col gap-1 pt-1 border-t border-slate-200/50 dark:border-slate-700/40">
                  <span className="text-[10px] text-slate-400 select-none">快捷意图倾向 (按数字键 1/2/3 切换):</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {screenReplyAnalysis.clarify_options.map((opt, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => onSelectClarifyChip?.(opt)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-full bg-white dark:bg-slate-700/80 hover:bg-teal-50 dark:hover:bg-teal-950/60 text-[#00BFA5] border border-teal-200/80 dark:border-teal-800/60 hover:border-teal-400 transition-colors cursor-pointer font-medium shadow-2xs active:scale-95"
                      >
                        <kbd className="px-1 py-0.2 rounded bg-teal-100 dark:bg-teal-900/80 text-teal-800 dark:text-teal-300 font-mono text-[9px] font-bold">
                          {idx + 1}
                        </kbd>
                        <span>{opt}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Content Area (Diff or Plain/Streaming) */}
          <div className={embedded ? 'min-h-0 flex-1' : 'content'}>
            {isDiffMode ? (
              <DiffViewer
                originalText={originalText}
                polishedText={polishedText}
              />
            ) : (
              <StreamingView
                content={polishedText}
                isGenerating={isGenerating}
                durationMs={durationMs}
                totalTokens={totalTokens}
                error={error}
                model={embedded ? modelName : undefined}
                className={embedded ? 'h-full' : ''}
                onStop={onStop}
                onRegenerate={onRegenerate}
              />
            )}
          </div>

          {/* User Custom Instruction / Reply Input */}
          {onSendInstruction && (
            <InstructionInput
              onSubmit={onSendInstruction}
              isGenerating={isGenerating}
              placeholder={
                activeStyle === 'reply'
                  ? '针对选中文本输入具体回复要求 (Enter 发送)...'
                  : '想怎么改？直接说…'
              }
              showQuickTags={!embedded || activeStyle === 'reply'}
              attachedFiles={attachedFiles}
              onAttachFile={onAttachFile}
              onRemoveFile={onRemoveFile}
              clipboardReference={clipboardReference}
              onAttachClipboard={onAttachClipboard}
            />
          )}

          {/* Action Bar */}
          <ActionBar
            onCopy={onCopy}
            onReplace={onReplace}
            onRegenerate={onRegenerate}
            isEditable={isEditable}
            isGenerating={isGenerating}
            disabled={!polishedText && !isGenerating}
            replaceLabel={replaceLabel || (embedded ? '贴回' : '替换原文')}
            leftSlot={embedded && !showOriginalPreview ? diffToggleButton : undefined}
          />
        </div>
      )}
    </div>
  );
};

export default PolishPanel;
