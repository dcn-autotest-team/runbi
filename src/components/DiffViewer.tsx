/**
 * DiffViewer - CJK-Aware Myers Diff Visualizer
 * Part of Runbi Chrome Extension (Manifest V3)
 */

import React, { useMemo } from 'react';
import { computeDiff, type DiffChunk } from '../core/diff';

export interface DiffViewerProps {
  originalText: string;
  polishedText: string;
  className?: string;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  originalText,
  polishedText,
  className = '',
}) => {
  const diffChunks = useMemo<DiffChunk[]>(() => {
    return computeDiff(originalText, polishedText);
  }, [originalText, polishedText]);

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Diff Content Box */}
      <div
        id="runbi-diff-content"
        className="min-h-[96px] max-h-[220px] p-3 overflow-y-auto bg-slate-50/90 dark:bg-slate-800/60 rounded-xl border border-slate-200/70 dark:border-slate-700/60 text-sm leading-relaxed runbi-scrollbar whitespace-pre-wrap break-words font-sans"
      >
        {diffChunks.map((chunk, index) => {
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
        })}
      </div>

      {/* Diff Legend */}
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1 select-none">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-100 border border-red-300 dark:bg-red-950 dark:border-red-800" />
            <span>精简删除</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-100 border border-emerald-300 dark:bg-emerald-950 dark:border-emerald-800" />
            <span>优化新增</span>
          </span>
        </div>
      </div>
    </div>
  );
};

export default DiffViewer;
