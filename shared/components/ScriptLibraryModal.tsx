/**
 * @file shared/components/ScriptLibraryModal.tsx
 * 话术模板库 (Script Template Library) — full-pane overlay picker for the built-in
 * e-commerce customer-service script corpus (~1480 templates). Fills the parent
 * `relative` container; data loads lazily on first open and stays mounted across
 * open/close (load once).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ScriptLibraryData, ScriptPhase, ScriptTemplate } from '../types/library';
import { loadScriptLibrary, filterTemplates, isChineseTemplate, matchIndustry, matchPlatform } from '../core/scriptLibrary';

export interface ScriptLibraryModalProps {
  open: boolean;
  onClose: () => void;
  /** 当前窗口标题+选中文字，用于自动匹配行业/平台并预置筛选 */
  contextHint?: string;
  /** 用户选定模板后的动作：copy=直接复制原文；reference=作为参考模板交给 AI 生成 */
  onUseTemplate: (template: ScriptTemplate, mode: 'copy' | 'reference') => void;
}

const PAGE_SIZE = 80;
const PHASES: ScriptPhase[] = ['presales', 'sales', 'aftersales'];
const CHIP = 'rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-400';
/* glass.css ships .runbi-form-control after Tailwind utilities, so h-8/min-h-0
   utilities lose the cascade — inline style is the only way to keep selects compact. */
const SELECT_STYLE = { minHeight: '2rem' } as const;
const SELECT_CLS = 'runbi-form-control flex-1 cursor-pointer text-xs';

export const ScriptLibraryModal: React.FC<ScriptLibraryModalProps> = ({
  open,
  onClose,
  contextHint,
  onUseTemplate,
}) => {
  const [data, setData] = useState<ScriptLibraryData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState('');
  const [industry, setIndustry] = useState('');
  const [platform, setPlatform] = useState('');
  // 默认只推中文模板：库内 1/3 是英文原文模板,误选会让「参考生成」输出英文
  const [zhOnly, setZhOnly] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hint, setHint] = useState<{ field: 'industry' | 'platform'; label: string } | null>(null);
  const hintDoneRef = useRef(false);

  // Lazy load on first open; skip once loaded (retry via `attempt`).
  useEffect(() => {
    if (!open || data) return;
    let cancelled = false;
    setLoadFailed(false);
    loadScriptLibrary()
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

  // Context auto-match: computed once when data first arrives, never on later opens.
  useEffect(() => {
    if (!data || hintDoneRef.current) return;
    hintDoneRef.current = true;
    if (!contextHint) return;
    const ind = matchIndustry(data, contextHint);
    if (ind) {
      setIndustry(ind.slug);
      setHint({ field: 'industry', label: ind.label });
      return;
    }
    const plat = matchPlatform(data, contextHint);
    if (plat) {
      setPlatform(plat.slug);
      setHint({ field: 'platform', label: plat.label });
    }
  }, [data, contextHint]);

  // Any filter change collapses pagination back to the first page.
  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [query, industry, platform, phase, zhOnly]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const hits = filterTemplates(data, {
      query: query.trim() || undefined,
      industry: industry || undefined,
      platform: platform || undefined,
      phase: (phase || undefined) as ScriptPhase | undefined,
    });
    return zhOnly ? hits.filter(isChineseTemplate) : hits;
  }, [data, query, industry, platform, phase, zhOnly]);

  const shown = filtered.slice(0, limit);
  const remaining = filtered.length - shown.length;
  const total = data?.items.length ?? 0;

  if (!open) return null;

  const clearHint = () => {
    if (hint?.field === 'industry') setIndustry('');
    else if (hint?.field === 'platform') setPlatform('');
    setHint(null);
  };

  return (
    <div
      className="absolute inset-0 z-[2147483647] flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[var(--runbi-panel-bg)] text-slate-200 shadow-2xl"
      role="dialog"
      aria-label="话术模板库"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-black/20 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">话术模板库</span>
          <span className="rounded-full border border-teal-400/20 bg-teal-400/10 px-2 py-0.5 text-[10px] text-teal-300">{total} 条模板</span>
        </div>
        <button type="button" aria-label="关闭话术库" onClick={onClose} className="runbi-icon-button cursor-pointer">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </header>

      {data && (
        <div className="flex shrink-0 flex-col gap-2 border-b border-white/10 px-4 py-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索话术、场景、关键词…"
            className="runbi-form-control"
          />
          <div className="flex gap-2">
            {PHASES.some((p) => data.scenes[p]) && (
              <select aria-label="场景阶段" value={phase} onChange={(e) => setPhase(e.target.value)} className={SELECT_CLS} style={SELECT_STYLE}>
                <option value="">全部</option>
                {PHASES.filter((p) => data.scenes[p]).map((p) => (
                  <option key={p} value={p}>{data.scenes[p]}</option>
                ))}
              </select>
            )}
            {Object.keys(data.industries).length > 0 && (
              <select aria-label="行业" value={industry} onChange={(e) => setIndustry(e.target.value)} className={SELECT_CLS} style={SELECT_STYLE}>
                <option value="">全部</option>
                {Object.entries(data.industries).map(([slug, label]) => (
                  <option key={slug} value={slug}>{label}</option>
                ))}
              </select>
            )}
            {Object.keys(data.platforms).length > 0 && (
              <select aria-label="平台" value={platform} onChange={(e) => setPlatform(e.target.value)} className={SELECT_CLS} style={SELECT_STYLE}>
                <option value="">全部</option>
                {Object.entries(data.platforms).map(([slug, label]) => (
                  <option key={slug} value={slug}>{label}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              aria-pressed={zhOnly}
              onClick={() => setZhOnly((v) => !v)}
              title="库内约三分之一是英文原文模板，开启后只显示中文模板，避免「参考生成」输出英文"
              className={`runbi-focus-ring shrink-0 cursor-pointer rounded-lg px-2 text-xs font-medium transition-colors ${
                zhOnly ? 'bg-teal-500/20 text-teal-200' : 'text-slate-400 hover:bg-white/10 hover:text-slate-200'
              }`}
              style={SELECT_STYLE}
            >
              中文
            </button>
          </div>
          {hint && (
            <div className="flex items-center gap-1 text-[11px] text-teal-300/90">
              <span>已根据当前内容匹配「{hint.label}」，可点击</span>
              <button
                type="button"
                aria-label="清除自动匹配筛选"
                onClick={clearHint}
                className="runbi-focus-ring cursor-pointer rounded-full border border-teal-400/30 px-1 text-[10px] leading-4 hover:bg-white/10"
              >
                ×
              </button>
              <span>改回全部</span>
            </div>
          )}
        </div>
      )}

      {loadFailed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8">
          <p className="text-xs text-slate-500">话术库加载失败，请重试</p>
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="runbi-focus-ring cursor-pointer rounded-lg border border-white/10 px-3 py-1 text-[11px] hover:bg-white/10"
          >
            重试
          </button>
        </div>
      ) : !data ? (
        <div className="flex flex-1 items-center justify-center py-8 text-xs text-slate-500">加载话术库…</div>
      ) : (
        <div className="runbi-scrollbar flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-2">
          {shown.length === 0 && (
            <div className="py-8 text-center text-xs text-slate-500">
              无匹配模板，换个关键词试试{zhOnly ? '（或关闭「中文」筛选查看英文原文模板）' : ''}
            </div>
          )}
          {shown.map((t) => {
            const expanded = expandedId === t.id;
            return (
              <div
                key={t.id}
                className={`rounded-xl border bg-white/[0.03] transition-colors ${
                  expanded ? 'border-teal-500/30 bg-white/[0.05]' : 'border-white/10 hover:border-teal-500/30 hover:bg-white/[0.05]'
                }`}
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? null : t.id)}
                  className="runbi-focus-ring flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-medium text-slate-200">{t.sectionTitle}</span>
                    <span className="truncate text-[10px] text-slate-400">{t.scenario}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className={CHIP}>{data.scenes[t.phase] || t.phase}</span>
                    {t.industry && t.industry !== 'general' && (
                      <span className={CHIP}>{data.industries[t.industry] || t.industry}</span>
                    )}
                    {t.platform && t.platform !== 'general' && (
                      <span className={CHIP}>{data.platforms[t.platform] || t.platform}</span>
                    )}
                  </span>
                </button>

                {expanded && (
                  <div className="flex flex-col gap-2 px-2.5 pb-2.5">
                    <div className="runbi-scrollbar max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/20 p-2.5 text-[11px] leading-relaxed text-slate-200">
                      {t.template}
                    </div>
                    {t.variables.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        {t.variables.map((v) => (
                          <span key={v} className={`${CHIP} font-mono`}>[{v}]</span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onUseTemplate(t, 'copy')}
                        className="runbi-focus-ring cursor-pointer rounded-lg border border-white/10 px-2.5 py-1 text-[11px] hover:bg-white/10"
                      >
                        复制模板
                      </button>
                      <button
                        type="button"
                        title="以上方原文为素材，参考该模板交给 AI 生成"
                        onClick={() => onUseTemplate(t, 'reference')}
                        className="runbi-focus-ring cursor-pointer rounded-lg bg-teal-500/20 px-2.5 py-1 text-[11px] text-teal-200 hover:bg-teal-500/30"
                      >
                        参考生成
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setLimit((l) => l + PAGE_SIZE)}
              className="runbi-focus-ring mx-auto shrink-0 cursor-pointer rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-slate-400 hover:bg-white/10 hover:text-slate-200"
            >
              显示更多（剩余 {remaining} 条）
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ScriptLibraryModal;
