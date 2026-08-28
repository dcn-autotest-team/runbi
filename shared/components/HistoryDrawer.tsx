/**
 * @file shared/components/HistoryDrawer.tsx
 * Generation History & Draft Archive Drawer Component
 * Allows users to inspect, search, restore, and copy past generations.
 */

import React, { useState, useMemo } from 'react';
import type { HistoryRecord } from '../types/history';
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

/**
 * Formats timestamp to human friendly relative or date string.
 */
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
      role="dialog"
      aria-modal="true"
      aria-label="生成历史与时光机草稿箱"
      className="absolute inset-0 z-50 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#12181b] text-slate-200 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3 bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-teal-500/10 text-teal-400">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div>
            <h2 className="text-xs font-semibold text-white">时光机草稿箱</h2>
            <p className="text-[10px] text-slate-400">
              共 {history.length} 条记录 · 本地加密保存
            </p>
          </div>
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
                  className="rounded px-2 py-1 text-[10px] font-medium text-rose-400 hover:bg-rose-500/10"
                >
                  确认清空
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="rounded px-1.5 py-1 text-[10px] text-slate-400 hover:text-white"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="rounded px-2 py-1 text-[10px] text-slate-400 hover:text-rose-300 hover:bg-white/5 transition-colors"
              >
                清空
              </button>
            )
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭历史抽屉"
            className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search Input */}
      {history.length > 3 && (
        <div className="shrink-0 border-b border-white/5 px-3 py-2">
          <div className="relative flex items-center">
            <svg className="absolute left-2.5 h-3.5 w-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="搜索历史记录关键词..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 outline-none focus:border-teal-500/50"
            />
          </div>
        </div>
      )}

      {/* History List */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2.5 runbi-scrollbar">
        {filteredHistory.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center p-6">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-slate-500">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <p className="text-xs font-medium text-slate-300">暂无历史记录</p>
            <p className="mt-1 text-[11px] text-slate-500">
              每次润色与智能回复生成完毕后，都将在此安全归档
            </p>
          </div>
        ) : (
          filteredHistory.map((item) => (
            <div
              key={item.id}
              className="group relative rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-all hover:border-teal-500/30 hover:bg-white/[0.05]"
            >
              {/* Card Meta Row */}
              <div className="flex items-center justify-between gap-2 pb-2 text-[10px] text-slate-400 border-b border-white/5">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-teal-400">{formatTimeAgo(item.timestamp)}</span>
                  {item.sourceApp && (
                    <span className="rounded bg-white/5 px-1.5 py-0.5 font-medium text-slate-300">
                      {item.sourceApp}
                    </span>
                  )}
                  {item.style && (
                    <span className="rounded border border-white/10 px-1.5 py-0.5 text-slate-400">
                      {item.style}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onRestore(item)}
                    className="rounded px-2 py-1 text-[10px] font-medium text-teal-400 hover:bg-teal-500/15 transition-colors"
                  >
                    恢复至主界面
                  </button>
                  <button
                    type="button"
                    onClick={() => onCopyText(item.polishedText)}
                    className="rounded px-1.5 py-1 text-[10px] text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    复制
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(item.id)}
                    aria-label="删除此条记录"
                    className="rounded p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Original snippet if present */}
              {item.originalText && (
                <div className="mt-2 text-[11px] text-slate-400 line-clamp-2 italic">
                  原文: “{item.originalText}”
                </div>
              )}

              {/* Polished Result Preview */}
              <div className="mt-2 rounded-lg bg-black/30 p-2.5 text-xs text-slate-200">
                <MarkdownRenderer content={item.polishedText} isGenerating={false} />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-white/10 bg-black/20 px-4 py-2.5 text-[11px] text-slate-400 flex items-center justify-between">
        <span>快捷键: Esc 退出历史</span>
        <span>按时间倒序自动清理早期记录</span>
      </div>
    </div>
  );
};

export default HistoryDrawer;
