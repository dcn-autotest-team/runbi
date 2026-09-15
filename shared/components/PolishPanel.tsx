import React, { useState, useEffect } from 'react';
import type { PolishStyle } from '../types/stream';
import type { ScreenReplyAnalysis } from '../core/prompts';
import StyleTabs from './StyleTabs';
import StreamingView from './StreamingView';
import DiffViewer from './DiffViewer';
import ActionBar from './ActionBar';
import Toast from './Toast';
import InstructionInput, { type AttachedFileContext, type QuickReplyTag } from './InstructionInput';
import TranslateBar from './TranslateBar';
import type { TranslateTargetId } from '../core/prompts';

/** Fallback quick tags for reply mode (no industry pack, no clarify_options). */
export const REPLY_QUICK_TAGS: QuickReplyTag[] = [
  { label: '热情周全', text: '请用更加热情、周到诚恳且积极的语气回复' },
  { label: '商务沉稳', text: '请用严谨专业、得体沉稳的职场商务口吻回复' },
  { label: '委婉缓冲', text: '请委婉表示目前手头有安排，礼貌推迟或缓冲' },
  { label: '幽默接梗', text: '请用高情商、轻松幽默的方式接梗回复' },
  { label: '极简一句话', text: '请精简为一句话直接切中要点回复' },
];

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
  replaceLabel?: string;
  /** Optional attached files for context enrichment */
  attachedFiles?: AttachedFileContext[];
  onAttachFile?: (file: AttachedFileContext) => void;
  onRemoveFile?: (index: number) => void;
  /** Optional clipboard text reference */
  clipboardReference?: string | null;
  onAttachClipboard?: () => void;
  /** Active industry pack name, shown in the reply context badge. */
  packName?: string;
  /** Industry-pack intents + user-defined actions, always shown as chips in reply mode. */
  replyQuickTags?: QuickReplyTag[];
  /** 润色模式意图芯片的追加项（用户自定义动作），内置 INTENT_CHIPS 之后渲染。 */
  extraIntentChips?: QuickReplyTag[];
  /** 广告法极限词命中列表(来自共享核 findBannedWords),非空时在操作栏上方警示。 */
  bannedWords?: string[];
  /** 打开内置话术模板库(桌面端传入才显示入口)。 */
  onOpenScriptLibrary?: () => void;
  /** 智能模式：AI 自动判断风格与行业(默认)。 */
  autoMode?: boolean;
  onAutoMode?: () => void;
  /** 当前生效的领域专家(由风格下拉统一承载,存在时替代风格显示)。 */
  expert?: { name: string; emoji: string } | null;
  /** 清除专家,回到风格模式。 */
  onClearExpert?: () => void;
  /** 打开专家提示词库(风格下拉底部入口)。 */
  onOpenExperts?: () => void;
  /** 翻译模式：当前目标语言与切换回调(传入才显示语言条)。 */
  translateTarget?: TranslateTargetId;
  onTranslateTargetChange?: (id: TranslateTargetId) => void;
  /** 重新截屏：传入才在屏幕上下文场景显示按钮(桌面端)。 */
  onRecapture?: () => void;
  isRecapturing?: boolean;
}

/** 细线警示图标(替代 emoji,单色跟随文字颜色) */
const InlineWarningIcon: React.FC<{ className?: string }> = ({ className = 'h-3.5 w-3.5' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`} aria-hidden>
    <path
      d="M12 9v4m0 4h.01M10.29 3.86l-8.14 14A2 2 0 0 0 3.86 21h16.28a2 2 0 0 0 1.71-3.14l-8.14-14a2 2 0 0 0-3.42 0z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

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
  replaceLabel,
  attachedFiles,
  onAttachFile,
  onRemoveFile,
  clipboardReference,
  onAttachClipboard,
  packName,
  replyQuickTags,
  extraIntentChips,
  bannedWords,
  onOpenScriptLibrary,
  autoMode,
  onAutoMode,
  expert,
  onClearExpert,
  onOpenExperts,
  translateTarget,
  onTranslateTargetChange,
  onRecapture,
  isRecapturing = false,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [showConvSummary, setShowConvSummary] = useState(false);

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
          <div className="w-5 h-5 rounded-full bg-gray-300 flex items-center justify-center text-gray-900 shadow-xs">
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
          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-teal-50 dark:bg-teal-950/60 text-gray-300 border border-teal-200 dark:border-teal-800/50">
            {modelName}
          </span>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-1.5">
          {activeStyle !== 'translate' && activeStyle !== 'reply' && diffToggleButton}

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
        <div className={embedded ? 'flex min-h-0 flex-1 flex-col gap-2.5 px-4 py-3 overflow-y-auto runbi-scrollbar' : 'p-4 flex flex-col gap-3.5'}>
          {/* 方式选择：仅润色模式显示 */}
          {activeStyle !== 'reply' && activeStyle !== 'translate' && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-400">
                {expert ? '处理方式 · 专家' : autoMode ? '润色方式 · AI 自动' : '润色方式'}
              </span>
              <StyleTabs
                activeStyle={activeStyle}
                onStyleChange={onStyleChange}
                disabled={isGenerating}
                autoMode={autoMode}
                onAutoMode={onAutoMode}
                expert={expert}
                onClearExpert={onClearExpert}
                onOpenExperts={onOpenExperts}
              />
            </div>
          )}

          {/* 翻译模式：源→目标语言条 */}
          {activeStyle === 'translate' && onTranslateTargetChange && (
            <TranslateBar
              target={translateTarget ?? 'en'}
              originalText={originalText}
              onTargetChange={onTranslateTargetChange}
              disabled={isGenerating}
            />
          )}

          {/* 回复模式说明与话术模板库入口 */}
          {(activeStyle === 'reply' || screenReplyAnalysis) && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] leading-relaxed text-slate-400">
                {screenReplyAnalysis
                  ? '回复模式：AI 结合上下文构思得体回复'
                  : '回复模式：AI 针对选中文本构思得体回复'}
              </span>
              {onOpenScriptLibrary && (
                <button
                  type="button"
                  onClick={onOpenScriptLibrary}
                  title="内置话术模板库，一键参考或套用客服/职场常见模板"
                  className="runbi-focus-ring flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-teal-500/30 bg-teal-500/10 px-2.5 text-[11px] font-medium text-teal-300 transition-colors hover:bg-teal-500/20 active:scale-95"
                >
                  <svg className="h-3.5 w-3.5 text-teal-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                  <span>话术模板库</span>
                </button>
              )}
            </div>
          )}

          {/* Screen Reply: Context Badge & Collapsible Conversation Summary */}
          {screenReplyAnalysis && (
            <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-slate-50/90 dark:bg-white/[0.04] border border-slate-200/60 dark:border-white/10 text-xs shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex h-2 w-2 relative shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-400"></span>
                  </span>
                  <span className="text-xs font-semibold text-teal-600 dark:text-teal-300 shrink-0">
                    已感知聊天上下文
                  </span>
                  {packName && (
                    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-violet-50 dark:bg-violet-950/60 text-violet-600 dark:text-violet-300 border border-violet-200 dark:border-violet-800/50 shrink-0">
                      {packName}
                    </span>
                  )}
                  {screenReplyAnalysis.last_message_from_other && (
                    <span className="text-slate-800 dark:text-slate-200 font-medium truncate">
                      · 对方诉求: “{screenReplyAnalysis.last_message_from_other}”
                    </span>
                  )}
                </div>
                {screenReplyAnalysis.conversation && screenReplyAnalysis.conversation.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setShowConvSummary((prev) => !prev)}
                    className="text-[11px] text-slate-400 hover:text-teal-600 dark:hover:text-teal-300 cursor-pointer transition-colors shrink-0 ml-2"
                  >
                    {showConvSummary ? '收起记录 ▴' : `展开记录(${screenReplyAnalysis.conversation.length}) ▾`}
                  </button>
                )}
              </div>

              {showConvSummary && screenReplyAnalysis.conversation && screenReplyAnalysis.conversation.length > 1 && (
                <div className="flex flex-col gap-1.5 pt-1.5 pb-0.5 px-2 max-h-28 overflow-y-auto runbi-scrollbar border-l-2 border-teal-500/40 bg-black/20 rounded-r-lg">
                  {screenReplyAnalysis.conversation.map((msg, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${
                          msg.sender === 'me'
                            ? 'bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-300'
                            : 'bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-slate-300'
                        }`}
                      >
                        {msg.sender === 'me' ? '我' : '对方'}
                      </span>
                      <span className="text-slate-800 dark:text-slate-200 leading-relaxed break-words">{msg.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Content Area */}
          <div className={embedded ? 'min-h-0 flex-1' : 'content'}>
            {isDiffMode && activeStyle !== 'translate' ? (
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
                hideStats={embedded || activeStyle === 'translate' || activeStyle === 'reply'}
              emptyTitle={
                activeStyle === 'translate'
                  ? '准备翻译'
                  : activeStyle === 'reply'
                  ? '准备生成回复'
                  : '准备生成润色稿'
              }
              emptySubtitle={
                activeStyle === 'translate'
                  ? '选择目标语言即可自动翻译'
                  : activeStyle === 'reply'
                  ? '选中消息后自动构思得体回复'
                  : '选择润色方式即可自动润色'
              }
              placeholder={
                activeStyle === 'translate'
                  ? '正在翻译中...'
                  : activeStyle === 'reply'
                  ? '正在构思回复...'
                  : '润笔沉思中，正在字斟句酌...'
              }
              className={embedded ? 'h-full' : ''}
              onStop={onStop}
              onRegenerate={onRegenerate}
            />
          )}
          </div>

          {/* 回复模式专用：意图推荐框 (clarify_options) + 用户自定义指令输入 */}
          {(activeStyle === 'reply' || screenReplyAnalysis) && (
            <InstructionInput
              onSubmit={(instruction, files) => {
                const clarifyTexts = screenReplyAnalysis?.clarify_options || [];
                if (clarifyTexts.includes(instruction) && onSelectClarifyChip) {
                  onSelectClarifyChip(instruction);
                } else if (onSendInstruction) {
                  onSendInstruction(instruction, files);
                }
              }}
              isGenerating={isGenerating}
              placeholder="想怎么改？点击上方快捷标签或直接输入 (Enter 发送)..."
              showQuickTags={true}
              quickTags={(() => {
                const clarifyTags: QuickReplyTag[] = (screenReplyAnalysis?.clarify_options ?? []).map(
                  (opt, idx) => ({ label: `${idx + 1} ${opt}`, text: opt })
                );
                const merged = [...clarifyTags, ...(replyQuickTags ?? [])];
                return merged.length > 0 ? merged : REPLY_QUICK_TAGS;
              })()}
              attachedFiles={attachedFiles}
              onAttachFile={onAttachFile}
              onRemoveFile={onRemoveFile}
              clipboardReference={clipboardReference}
              onAttachClipboard={onAttachClipboard}
            />
          )}

          {/* 广告法极限词警示 */}
          {bannedWords && bannedWords.length > 0 && (
            <div
              role="alert"
              className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 rounded-lg px-2 py-1.5"
            >
              <InlineWarningIcon />
              <span>
                含 {bannedWords.length} 个广告法极限词：
                <span className="font-semibold">{bannedWords.slice(0, 8).join('、')}</span>
                {bannedWords.length > 8 && ' 等'}
                　贴回前建议替换
              </span>
            </div>
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
          />
        </div>
      )}
    </div>
  );
};

export default PolishPanel;
