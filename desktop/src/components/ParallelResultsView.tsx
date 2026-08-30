/**
 * @file desktop/src/components/ParallelResultsView.tsx
 * 多专家并行结果视图：同一输入同时发给 2-4 位专家，网格对比各自流式输出。
 * Desktop-only (extension 面板宽度不够，不暴露此视图)。
 */

import React from 'react';
import { StreamingView } from '@runbi/shared/components';

export interface ParallelSession {
  id: string;
  expertId: string;
  /** 展示名，如「UI 设计师」 */
  expertName: string;
  text: string;
  status: 'streaming' | 'done' | 'error';
  error?: string;
  durationMs?: number;
  totalTokens?: number;
}

export interface ParallelResultsViewProps {
  inputText: string;
  sessions: ParallelSession[];
  onClose: () => void;
  onStopAll: () => void;
  onStopOne: (id: string) => void;
  onCopyText: (text: string) => void;
  onReplaceText: (text: string) => void;
}

const StatusDot: React.FC<{ status: ParallelSession['status'] }> = ({ status }) => {
  if (status === 'streaming') {
    return (
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-400" />
      </span>
    );
  }
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${status === 'done' ? 'bg-emerald-400' : 'bg-rose-400'}`}
    />
  );
};

export const ParallelResultsView: React.FC<ParallelResultsViewProps> = ({
  inputText,
  sessions,
  onClose,
  onStopAll,
  onStopOne,
  onCopyText,
  onReplaceText,
}) => {
  const runningCount = sessions.filter((s) => s.status === 'streaming').length;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--runbi-panel-bg)] text-slate-200">
      {/* 顶栏：标题 + 输入摘要 + 全局操作 */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-black/20 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs font-semibold">多专家并行</span>
          <span className="truncate text-[10px] text-slate-500" title={inputText}>
            {inputText.slice(0, 60) || '（无输入文本）'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {runningCount > 0 && (
            <button
              type="button"
              onClick={onStopAll}
              className="runbi-focus-ring rounded-lg border border-rose-400/30 px-2 py-1 text-[11px] text-rose-300 transition-colors hover:bg-rose-500/10 cursor-pointer"
            >
              全部停止 ({runningCount})
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="runbi-focus-ring rounded-lg border border-white/10 px-2 py-1 text-[11px] text-slate-300 transition-colors hover:bg-white/10 cursor-pointer"
          >
            关闭对比
          </button>
        </div>
      </div>

      {/* 结果网格 */}
      {sessions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-slate-500">
          从专家库选择 2-4 位专家开始并行生成
        </div>
      ) : (
        <div
          className={`runbi-scrollbar grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto p-3 sm:grid-cols-2 ${
            sessions.length <= 2 ? 'content-start' : 'auto-rows-fr content-start'
          }`}
        >
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`flex min-h-[200px] flex-col rounded-xl border border-white/10 bg-black/20 ${
                sessions.length === 1 ? 'sm:col-span-2' : ''
              }`}
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/5 px-3 py-1.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <StatusDot status={s.status} />
                  <span className="truncate text-[11px] font-medium">{s.expertName}</span>
                  {s.status === 'done' && typeof s.durationMs === 'number' && (
                    <span className="shrink-0 text-[9px] text-slate-500">
                      {(s.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {s.status === 'streaming' ? (
                    <button
                      type="button"
                      onClick={() => onStopOne(s.id)}
                      className="runbi-focus-ring rounded px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                    >
                      停止
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={!s.text.trim()}
                        onClick={() => onCopyText(s.text)}
                        className="runbi-focus-ring rounded px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        复制
                      </button>
                      <button
                        type="button"
                        disabled={!s.text.trim()}
                        onClick={() => onReplaceText(s.text)}
                        className="runbi-focus-ring rounded bg-teal-500/20 px-1.5 py-0.5 text-[10px] text-teal-200 hover:bg-teal-500/30 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        贴回
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="min-h-0 flex-1 px-3 py-2">
                <StreamingView
                  content={s.text}
                  isGenerating={s.status === 'streaming'}
                  error={s.status === 'error' ? s.error || '生成失败' : null}
                  durationMs={s.durationMs}
                  totalTokens={s.totalTokens}
                  placeholder="该专家正在思考..."
                  className="h-full"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ParallelResultsView;
