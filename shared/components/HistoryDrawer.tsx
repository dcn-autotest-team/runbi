/**
 * @file shared/components/HistoryDrawer.tsx
 * Generation History & Draft Archive Component
 * Renders as a dedicated, full-pane view inside the Raycast container.
 */

import React, { useState, useMemo } from 'react';
import type { HistoryRecord } from '../types/history';
import { STYLE_NAMES } from '../types/settings';
import { MarkdownRenderer } from './MarkdownRenderer';

export interface HistoryDrawerProps {
  isOpen: boolean;
  history: HistoryRecord[];
  onClose: () => void;
  onRestore: (record: HistoryRecord) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onCopyText: (text: string) => void;
}

function formatTimeAgo(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  isOpen,
  history,
  onClose,
  onRestore,
  onDelete,
  onClearAll,
  onCopyText,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const filteredHistory = useMemo(() => {
    if (!searchTerm.trim()) return history;
    const term = searchTerm.toLowerCase().trim();
    return history.filter(
      (h) =>
        h.originalText.toLowerCase().includes(term) ||
        h.polishedText.toLowerCase().includes(term) ||
        (h.instruction && h.instruction.toLowerCase().includes(term))
    );
  }, [history, searchTerm]);

  if (!isOpen) return null;

  return (
    <div
      id="runbi-history-drawer"
      role="region"
      aria-label="时光机草稿箱"
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#13191c] text-slate-200"
    >
      {/* Sub-Header / Search & Controls */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-2.5 bg-black/20">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-white">时光机草稿箱</span>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-400 font-mono">
            共 {history.length} 条记录
          </span>
        </div>

        <div className="flex items-center gap-2">
          {history.length > 0 && (
            confirmClear ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onClearAll();
                    setConfirmClear(false);
                  }}
                  className="rounded px-2 py-1 text-[11px] font-medium text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                >
                  确认清空
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="rounded px-1.5 py-1 text-[11px] text-slate-400 hover:text-white cursor-pointer"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="rounded px-2 py-1 text-[11px] text-slate-400 hover:text-rose-300 hover:bg-white/5 transition-colors cursor-pointer"
              >
                清空全部
              </button>
            )
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="返回主界面"
            className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          >
            返回
          </button>
        </div>
      </div>

      {/* Search Bar (if more than 2 items) */}
      {history.length > 2 && (
        <div className="shrink-0 border-b border-white/5 px-3 py-2 bg-black/10">
          <div className="relative flex items-center">
            <svg className="absolute left-2.5 h-3.5 w-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="搜索历史记录..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/40 py-1 pl-8 pr-3 text-xs text-white placeholder-slate-500 outline-none focus:border-teal-500/50"
            />
          </div>
        </div>
      )}

      {/* Card Feed */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3.5 space-y-3 runbi-scrollbar">
        {filteredHistory.length === 0 ? (
          <div className="flex h-full min-h-[220px] flex-col items-center justify-center text-center p-6">
            <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-slate-500">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <p className="text-xs font-medium text-slate-300">暂无历史记录</p>
            <p className="mt-1 text-[11px] text-slate-500">
              每次润色与智能回复生成完毕后，都将在此安全归档
            </p>
          </div>
        ) : (
          filteredHistory.map((item) => {
            const styleLabel = STYLE_NAMES[item.style] || item.style || '通用润色';
            return (
              <div
                key={item.id}
                className="group relative rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-all hover:border-teal-500/30 hover:bg-white/[0.05]"
              >
                {/* Meta Header */}
                <div className="flex items-center justify-between gap-2 pb-2 text-[11px] text-slate-400 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-teal-400">{formatTimeAgo(item.timestamp)}</span>
                    <span className="rounded bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium text-teal-300 border border-teal-500/20">
                      {styleLabel}
                    </span>
                    {item.sourceApp && (
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">
                        {item.sourceApp}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onRestore(item)}
                      className="rounded border border-teal-500/30 bg-teal-500/15 px-2 py-0.5 text-[10px] font-medium text-teal-300 hover:bg-teal-500/25 transition-colors cursor-pointer"
                    >
                      恢复至主界面
                    </button>
                    <button
                      type="button"
                      onClick={() => onCopyText(item.polishedText)}
                      className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      复制
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(item.id)}
                      aria-label="删除此条记录"
                      className="rounded p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                    >
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Original snippet if present */}
                {item.originalText && (
                  <div className="mt-2 text-[11px] text-slate-400 line-clamp-1 italic">
                    原文: “{item.originalText}”
                  </div>
                )}

                {/* Polished Result Preview */}
                <div className="mt-2 rounded-lg bg-black/40 p-2.5 text-xs text-slate-200 border border-white/5">
                  <MarkdownRenderer content={item.polishedText} isGenerating={false} />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-white/10 bg-black/30 px-4 py-2 text-[10px] text-slate-500 flex items-center justify-between">
        <span>按 Esc 返回润色主面板</span>
        <span>最多保留 100 条记录</span>
      </div>
    </div>
  );
};

export default HistoryDrawer;
