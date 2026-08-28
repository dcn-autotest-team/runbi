/**
 * DiffViewer - CJK-Aware Myers Diff Visualizer (Inline & Side-by-Side)
 * Platform-agnostic component for Runbi (@runbi/shared/components)
 */

import React, { useMemo } from 'react';
import { computeDiff, type DiffChunk } from '../core/diff';

export interface DiffViewerProps {
  originalText: string;
  polishedText: string;
  mode?: 'inline' | 'split';
  className?: string;
  maxHeight?: string;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  originalText,
  polishedText,
  mode = 'inline',
  className = '',
  maxHeight = '220px',
}) => {
  const diffChunks = useMemo<DiffChunk[]>(() => {
    return computeDiff(originalText, polishedText);
  }, [originalText, polishedText]);

  // Compute summary stats
  const { deleteCount, insertCount } = useMemo(() => {
    let del = 0;
    let ins = 0;
    for (const chunk of diffChunks) {
      if (chunk.type === 'delete') del += chunk.value.length;
      if (chunk.type === 'insert') ins += chunk.value.length;
    }
    return { deleteCount: del, insertCount: ins };
  }, [diffChunks]);

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Diff Content Box */}
      <div
        id="runbi-diff-content"
        style={{ maxHeight }}
        className="min-h-[110px] px-0.5 py-1.5 overflow-y-auto runbi-scrollbar whitespace-pre-wrap break-words font-sans select-text text-slate-800 dark:text-slate-100 text-sm leading-[1.8]"
      >
        {mode === 'split' ? (
          <div className="grid grid-cols-2 gap-3 divide-x divide-slate-200/60 dark:divide-slate-700/60">
            {/* Left: Original with Deletions */}
            <div className="pr-2">
              <div className="text-[11px] font-semibold text-slate-400 mb-1">原文</div>
              {diffChunks.map((chunk, index) => {
                if (chunk.type === 'delete') {
                  return (
                    <span
                      key={index}
                      data-diff-type="delete"
                      className="bg-red-100 text-red-700 dark:bg-red-950/70 dark:text-red-300 line-through rounded px-0.5 mx-0.5"
                    >
                      {chunk.value}
                    </span>
                  );
                }
                if (chunk.type === 'equal') {
                  return (
                    <span key={index} data-diff-type="equal" className="text-slate-800 dark:text-slate-100">
                      {chunk.value}
                    </span>
                  );
                }
                return null;
              })}
            </div>

            {/* Right: Polished with Insertions */}
            <div className="pl-3">
              <div className="text-[11px] font-semibold text-[#00BFA5] mb-1">润色稿</div>
              {diffChunks.map((chunk, index) => {
                if (chunk.type === 'insert') {
                  return (
                    <span
                      key={index}
                      data-diff-type="insert"
                      className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 underline decoration-emerald-500 underline-offset-2 rounded px-0.5 mx-0.5"
                    >
                      {chunk.value}
                    </span>
                  );
                }
                if (chunk.type === 'equal') {
                  return (
                    <span key={index} data-diff-type="equal" className="text-slate-800 dark:text-slate-100">
                      {chunk.value}
                    </span>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ) : (
          diffChunks.map((chunk, index) => {
            if (chunk.type === 'delete') {
              return (
                <span
                  key={index}
                  data-diff-type="delete"
                  className="bg-red-100 text-red-700 dark:bg-red-950/70 dark:text-red-300 line-through rounded px-0.5 mx-0.5 select-none"
                >
                  {chunk.value}
                </span>
              );
            }
            if (chunk.type === 'insert') {
              return (
                <span
                  key={index}
                  data-diff-type="insert"
                  className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 underline decoration-emerald-500 underline-offset-2 rounded px-0.5 mx-0.5"
                >
                  {chunk.value}
                </span>
              );
            }
            return (
              <span key={index} data-diff-type="equal" className="text-slate-800 dark:text-slate-100">
                {chunk.value}
              </span>
            );
          })
        )}
      </div>

      {/* Diff Legend & Change Stats */}
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1 select-none">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-100 border border-red-300 dark:bg-red-950 dark:border-red-800" />
            <span>精简删除 ({deleteCount}字)</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-100 border border-emerald-300 dark:bg-emerald-950 dark:border-emerald-800" />
            <span>优化新增 ({insertCount}字)</span>
          </span>
        </div>
      </div>
    </div>
  );
};

export default DiffViewer;
