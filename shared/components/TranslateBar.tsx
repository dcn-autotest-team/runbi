/**
 * @file shared/components/TranslateBar.tsx
 * 划词翻译语言条：自动检测 → 目标语言下拉（旗帜 + 名称），参考主流翻译工具布局。
 * Windows 不渲染 emoji 旗帜，故用内联 SVG 小旗。
 */

import React, { useState, useRef, useEffect } from 'react';
import { TRANSLATE_TARGETS, type TranslateTargetId } from '../core/prompts';

export interface TranslateBarProps {
  target: TranslateTargetId;
  onTargetChange: (id: TranslateTargetId) => void;
  disabled?: boolean;
}

/** 20×14 简笔旗帜：够识别即可，不追求精确国徽细节。 */
const Flag: React.FC<{ id: string; className?: string }> = ({ id, className = 'h-3.5 w-5' }) => {
  const common = 'shrink-0 rounded-[2px] ring-1 ring-black/10 ' + className;
  switch (id) {
    case 'zh-Hans':
      return (
        <svg viewBox="0 0 20 14" className={common} aria-hidden="true">
          <rect width="20" height="14" fill="#DE2910" />
          <path d="M4 2.2 4.9 4.9 7.6 4.9 5.4 6.6 6.2 9.3 4 7.7 1.8 9.3 2.6 6.6 0.4 4.9 3.1 4.9Z" fill="#FFDE00" transform="scale(0.72) translate(0.8 0.6)" />
        </svg>
      );
    case 'zh-Hant':
      return (
        <svg viewBox="0 0 20 14" className={common} aria-hidden="true">
          <rect width="20" height="14" fill="#DE2910" />
          <g fill="#fff" transform="translate(10 7)">
            {[0, 72, 144, 216, 288].map((deg) => (
              <ellipse key={deg} rx="1.1" ry="3" transform={`rotate(${deg}) translate(0 -2.2)`} />
            ))}
          </g>
        </svg>
      );
    case 'ja':
      return (
        <svg viewBox="0 0 20 14" className={common} aria-hidden="true">
          <rect width="20" height="14" fill="#fff" />
          <circle cx="10" cy="7" r="3.4" fill="#BC002D" />
        </svg>
      );
    case 'ko':
      return (
        <svg viewBox="0 0 20 14" className={common} aria-hidden="true">
          <rect width="20" height="14" fill="#fff" />
          <path d="M6.6 7a3.4 3.4 0 0 1 6.8 0Z" fill="#CD2E3A" />
          <path d="M6.6 7a3.4 3.4 0 0 0 6.8 0Z" fill="#0047A0" />
        </svg>
      );
    default:
      // en: 星条旗简笔（红底 + 白横条 + 蓝角落）
      return (
        <svg viewBox="0 0 20 14" className={common} aria-hidden="true">
          <rect width="20" height="14" fill="#B22234" />
          <rect y="2.4" width="20" height="1.9" fill="#fff" />
          <rect y="6.2" width="20" height="1.9" fill="#fff" />
          <rect y="10" width="20" height="1.9" fill="#fff" />
          <rect width="9" height="8.1" fill="#3C3B6E" />
        </svg>
      );
  }
};

export const TranslateBar: React.FC<TranslateBarProps> = ({ target, onTargetChange, disabled = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  const current = TRANSLATE_TARGETS.find((t) => t.id === target) ?? TRANSLATE_TARGETS[0];

  return (
    <div className="flex items-center gap-2" data-testid="translate-bar">
      <span
        className="flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-black/[0.03] px-2 text-[11px] text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400"
        title="源语言自动检测"
      >
        自动检测
      </span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true">
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </svg>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          data-testid="translate-target-trigger"
          onClick={() => setIsOpen((p) => !p)}
          className={`runbi-focus-ring flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10 ${
            disabled ? 'cursor-not-allowed opacity-50' : ''
          }`}
        >
          <Flag id={current.id} />
          {current.label}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-2.5 w-2.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <div
          role="menu"
          aria-label="翻译目标语言"
          className={`absolute left-0 top-full z-50 mt-1.5 w-36 origin-top-left rounded-xl border border-slate-200 bg-white/95 p-1 shadow-2xl backdrop-blur-xl transition-[opacity,scale,visibility] duration-150 ease-out dark:border-slate-700 dark:bg-slate-900/95 ${
            isOpen ? 'visible scale-100 opacity-100' : 'invisible scale-95 opacity-0 pointer-events-none'
          }`}
        >
          {TRANSLATE_TARGETS.map((opt) => {
            const active = opt.id === target;
            return (
              <button
                key={opt.id}
                role="menuitemradio"
                type="button"
                data-target={opt.id}
                aria-checked={active}
                onClick={() => {
                  onTargetChange(opt.id);
                  setIsOpen(false);
                }}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                  active
                    ? 'bg-slate-200 font-semibold text-slate-900 dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Flag id={opt.id} />
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TranslateBar;
