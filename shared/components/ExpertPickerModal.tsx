/**
 * @file shared/components/ExpertPickerModal.tsx
 * 专家提示词库 (Expert Agent Library) — full-pane overlay picker for the built-in
 * expert-agent prompt corpus. Supports single-apply (set as the
 * current polish expert) and multi-select (2-4 experts) for parallel generation.
 * Fills the parent `relative` container; data loads lazily on first open and
 * stays mounted across open/close (load once).
 */

import React, { useEffect, useMemo, useState } from 'react';
import type { ExpertAgent, ExpertLibraryData } from '../types/library';
import { loadExpertLibrary, filterExperts, EXPERT_CATEGORY_ORDER } from '../core/expertAgents';

export interface ExpertPickerModalProps {
  open: boolean;
  onClose: () => void;
  /** 当前已应用的单个专家 id（高亮标注） */
  activeExpertId?: string | null;
  /** 单选使用：把该专家设为当前润色专家 */
  onApplyExpert: (expert: ExpertAgent) => void;
  /** 并行对比：用同一输入让 2-4 个专家同时生成 */
  onStartParallel: (experts: ExpertAgent[]) => void;
}

const MAX_PARALLEL = 4;
/* glass.css ships .runbi-form-control after Tailwind utilities; kept for parity
   with ScriptLibraryModal — no fixed height needed for the text input here. */
const CHIP = 'rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-400';
const CHECK_SQUARE = 'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border';

export const ExpertPickerModal: React.FC<ExpertPickerModalProps> = ({
  open,
  onClose,
  activeExpertId,
  onApplyExpert,
  onStartParallel,
}) => {
  const [data, setData] = useState<ExpertLibraryData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Lazy load on first open; skip once loaded (retry via `attempt`).
  useEffect(() => {
    if (!open || data) return;
    let cancelled = false;
    setLoadFailed(false);
    loadExpertLibrary()
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [open, data, attempt]);

  // Escape closes while open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Category chips: curated order first, then any data-only slugs; only non-empty ones.
  const categoryOrder = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, number>();
    for (const a of data.agents) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
    const known = EXPERT_CATEGORY_ORDER.filter((slug) => counts.has(slug));
    const extra = [...counts.keys()].filter((slug) => !EXPERT_CATEGORY_ORDER.includes(slug));
    return [...known, ...extra];
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return filterExperts(data, {
      query: query.trim() || undefined,
      category: category || undefined,
      // filterExperts caps at 200 by default — raise it so all ~316 agents list.
      limit: Infinity,
    });
  }, [data, query, category]);

  const selectedAgents = useMemo(
    () => (data ? data.agents.filter((a) => selected.has(a.id)) : []),
    [data, selected],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_PARALLEL) next.add(id); // 5th pick silently ignored
      return next;
    });
  };

  if (!open) return null;

  const count = selectedAgents.length;

  return (
    <div
      className="absolute inset-0 z-[2147483647] flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[var(--runbi-panel-bg)] text-slate-200 shadow-2xl"
      role="dialog"
      aria-label="专家提示词库"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-black/20 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">专家提示词库</span>
          <span className="rounded-full border border-teal-400/20 bg-teal-400/10 px-2 py-0.5 text-[10px] text-teal-300">
            {data?.agents.length ?? 0} 位专家
          </span>
        </div>
        <button type="button" aria-label="关闭专家库" onClick={onClose} className="runbi-icon-button cursor-pointer">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </header>

      {data && (
        <div className="flex shrink-0 flex-col gap-2 border-b border-white/10 px-3 py-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索专家名称或专长…"
            className="runbi-form-control"
          />
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setCategory('')}
              className={`cursor-pointer rounded-full border px-2 py-0.5 text-[10px] ${
                category === '' ? 'border-teal-500/50 bg-teal-500/15 text-teal-300' : 'border-white/10 text-slate-400 hover:text-slate-200'
              }`}
            >
              全部
            </button>
            {categoryOrder.map((slug) => (
              <button
                key={slug}
                type="button"
                onClick={() => setCategory(slug)}
                className={`cursor-pointer rounded-full border px-2 py-0.5 text-[10px] ${
                  category === slug ? 'border-teal-500/50 bg-teal-500/15 text-teal-300' : 'border-white/10 text-slate-400 hover:text-slate-200'
                }`}
              >
                {data.categories[slug] || slug}
              </button>
            ))}
          </div>
        </div>
      )}

      {loadFailed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8">
          <p className="text-xs text-slate-500">专家库加载失败，请重试</p>
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="runbi-focus-ring cursor-pointer rounded-lg border border-white/10 px-3 py-1 text-[11px] hover:bg-white/10"
          >
            重试
          </button>
        </div>
      ) : !data ? (
        <div className="flex flex-1 items-center justify-center py-8 text-xs text-slate-500">加载专家库…</div>
      ) : (
        <div className="runbi-scrollbar flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-2">
          {filtered.length === 0 && (
            <div className="py-8 text-center text-xs text-slate-500">无匹配专家</div>
          )}
          {filtered.map((a) => {
            const checked = selected.has(a.id);
            const expanded = expandedId === a.id;
            return (
              <div
                key={a.id}
                className={`rounded-xl border bg-white/[0.03] transition-colors ${
                  expanded ? 'border-teal-500/30 bg-white/[0.05]' : 'border-white/10 hover:border-teal-500/30 hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <button
                    type="button"
                    aria-pressed={checked}
                    aria-label={checked ? `取消选择 ${a.name}` : `选择 ${a.name}`}
                    onClick={() => toggle(a.id)}
                    className="runbi-focus-ring flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg text-left"
                  >
                    <span className={`${CHECK_SQUARE} ${checked ? 'border-teal-400 bg-teal-500 text-white' : 'border-white/20'}`}>
                      {checked && (
                        <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg>
                      )}
                    </span>
                    <span className="shrink-0 text-xs font-medium text-slate-200">{a.name}</span>
                    <span className={CHIP}>{data.categories[a.category] || a.category}</span>
                    {a.id === activeExpertId && (
                      <span className="shrink-0 rounded bg-teal-500/15 px-1.5 py-0.5 text-[9px] text-teal-300">当前</span>
                    )}
                    <span className="line-clamp-1 min-w-0 flex-1 text-[10px] text-slate-400">{a.description}</span>
                  </button>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : a.id)}
                    className="runbi-focus-ring shrink-0 cursor-pointer rounded text-[10px] text-slate-400 hover:text-teal-300"
                  >
                    预览
                  </button>
                </div>

                {expanded && (
                  <div className="flex flex-col gap-2 px-2 pb-2.5">
                    <p className="text-[10px] text-slate-400">{a.description}</p>
                    <div className="runbi-scrollbar max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/20 p-2 text-[10px] text-slate-300">
                      {a.body.slice(0, 400)}
                    </div>
                    <button
                      type="button"
                      onClick={() => onApplyExpert(a)}
                      className="runbi-focus-ring cursor-pointer self-start rounded-lg bg-teal-500/20 px-2.5 py-1 text-[11px] text-teal-200 hover:bg-teal-500/30"
                    >
                      以此专家身份生成
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-white/10 bg-black/20 px-4 py-2.5">
        <span className="text-[10px] text-slate-500">已选 {count}/{MAX_PARALLEL} · 并行对比将用同一文本分别让所选专家生成</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={count !== 1}
            onClick={() => onApplyExpert(selectedAgents[0])}
            className="runbi-focus-ring cursor-pointer rounded-lg border border-white/10 px-3 py-1 text-xs hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            使用专家
          </button>
          <button
            type="button"
            title={count >= MAX_PARALLEL ? `最多选择 ${MAX_PARALLEL} 位专家并行对比` : undefined}
            disabled={count < 2 || count > MAX_PARALLEL}
            onClick={() => onStartParallel(selectedAgents)}
            className="runbi-focus-ring cursor-pointer rounded-lg bg-teal-500/20 px-3 py-1 text-xs font-medium text-teal-200 hover:bg-teal-500/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            并行对比 ({count})
          </button>
        </div>
      </footer>
    </div>
  );
};

export default ExpertPickerModal;
