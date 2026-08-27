/**
 * PolishPanel - Main Floating Glassmorphism Polishing Modal Container
 * Platform-agnostic component for Runbi (@runbi/shared/components)
 */

import React, { useState } from 'react';
import type { PolishStyle } from '../types/stream';
import StyleTabs from './StyleTabs';
import StreamingView from './StreamingView';
import DiffViewer from './DiffViewer';
import ActionBar from './ActionBar';
import Toast from './Toast';
import InstructionInput from './InstructionInput';
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
  onClose: () => void;
  onStyleChange: (style: PolishStyle) => void;
  onToggleDiff: () => void;
  onStop: () => void;
  onRegenerate: () => void;
  onCopy: () => void;
  onReplace: () => void;
  onSendInstruction?: (instruction: string) => void;
  onToastDismiss?: () => void;
  className?: string;
  style?: React.CSSProperties;
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
  onClose,
  onStyleChange,
  onToggleDiff,
  onStop,
  onRegenerate,
  onCopy,
  onReplace,
  onSendInstruction,
  onToastDismiss,
  className = '',
  style = {},
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

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
      className={`z-[2147483647] pointer-events-auto w-[400px] max-w-[90vw] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-panel dark:shadow-panel-dark text-slate-800 dark:text-slate-100 animate-panel-in select-none font-sans overflow-hidden ${className}`}
    >
      {/* Toast Feedback */}
      <Toast
        message={toastMessage}
        visible={toastVisible}
        durationMs={1500}
        onDismiss={onToastDismiss}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50/80 dark:bg-slate-800/80 border-b border-slate-200/70 dark:border-slate-700/60">
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
          <button
            id="diff-toggle"
            type="button"
            aria-label={isDiffMode ? '切换到终稿视图' : '切换到差异对比'}
            onClick={onToggleDiff}
            className={`px-2 py-0.5 text-xs font-medium rounded-md transition-colors cursor-pointer border ${
              isDiffMode
                ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-700'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-700'
            }`}
          >
            {isDiffMode ? '终稿' : 'Diff'}
          </button>

          {/* Minimize / Collapse Button */}
          <button
            id="collapse-btn"
            type="button"
            aria-label={isCollapsed ? '展开面板' : '折叠面板'}
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 dark:hover:text-slate-200 dark:hover:bg-slate-700/60 transition-colors cursor-pointer"
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
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/60 transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Body */}
      {!isCollapsed && (
        <div className="p-3 flex flex-col gap-3">
          {/* Optional Original Preview */}
          {showOriginalPreview && (
            <OriginalPreview originalText={originalText} />
          )}

          {/* Style Tabs */}
          <StyleTabs
            activeStyle={activeStyle}
            onStyleChange={onStyleChange}
            disabled={isGenerating}
          />

          {/* Content Area (Diff or Plain/Streaming) */}
          <div className="content">
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
              placeholder="针对选中文本输入具体回复要求 (Enter 发送)..."
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
          />
        </div>
      )}
    </div>
  );
};

export default PolishPanel;
