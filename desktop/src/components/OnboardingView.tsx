/**
 * @file desktop/src/components/OnboardingView.tsx
 * Ultra-sleek first-run micro-onboarding view.
 * Displays a 5s countdown, explains the core 3-step loop, and features a live simulator.
 */

import React, { useState, useEffect, useRef } from 'react';
import { RunbiLogo } from './Icons';

export interface OnboardingViewProps {
  onDismiss: () => void;
  shortcut?: string;
  autoCloseSeconds?: number;
}

export const OnboardingView: React.FC<OnboardingViewProps> = ({
  onDismiss,
  shortcut = 'Ctrl+Shift+Space',
  autoCloseSeconds = 5,
}) => {
  const [countdown, setCountdown] = useState(autoCloseSeconds);
  const [isPaused, setIsPaused] = useState(false);
  const [demoState, setDemoState] = useState<'idle' | 'polished'>('idle');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-dismiss countdown timer (pauses when user hovers)
  useEffect(() => {
    if (isPaused) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          onDismiss();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, onDismiss]);

  // Keyboard shortcut to dismiss
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
        e.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss]);

  return (
    <div
      id="runbi-onboarding-view"
      role="dialog"
      aria-label="新手快速引导"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onMouseOver={() => setIsPaused(true)}
      onMouseOut={() => setIsPaused(false)}
      className="flex min-h-0 flex-1 flex-col justify-between overflow-hidden bg-[#12181b] p-5 text-slate-200 select-none animate-in fade-in zoom-in-95 duration-200"
    >
      {/* Top Brand Banner */}
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20 shadow-inner">
            <RunbiLogo className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white tracking-wide">润笔 Runbi</h2>
              <span className="rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-medium text-teal-300 border border-teal-500/30">
                就绪
              </span>
            </div>
            <p className="text-[11px] text-slate-400">原生·毫秒级·沉浸式 AI 划词润色</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="跳过并收入托盘"
          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-slate-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
        >
          跳过
        </button>
      </div>

      {/* Core 3-Step Flow */}
      <div className="my-auto py-2">
        <div className="grid grid-cols-3 gap-2.5">
          {/* Step 1 */}
          <div className="flex flex-col items-center rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center transition-all hover:bg-white/[0.04] hover:border-white/10">
            <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/10 text-teal-400">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                <path d="m13 13 6 6" />
              </svg>
            </div>
            <span className="text-xs font-medium text-slate-200">1. 鼠标划选</span>
            <p className="mt-1 text-[10px] text-slate-400 leading-tight">
              在微信/浏览器/Word中选中任意文字
            </p>
          </div>

          {/* Step 2 */}
          <div className="flex flex-col items-center rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center transition-all hover:bg-white/[0.04] hover:border-white/10">
            <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
              </svg>
            </div>
            <span className="text-xs font-medium text-slate-200">2. 极速润色</span>
            <p className="mt-1 text-[10px] text-slate-400 leading-tight">
              面板自动呼出，多种文风毫秒呈现
            </p>
          </div>

          {/* Step 3 */}
          <div className="flex flex-col items-center rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center transition-all hover:bg-white/[0.04] hover:border-white/10">
            <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 10 4 15 9 20" />
                <path d="M20 4v7a4 4 0 0 1-4 4H4" />
              </svg>
            </div>
            <span className="text-xs font-medium text-slate-200">3. 回车贴回</span>
            <p className="mt-1 text-[10px] text-slate-400 leading-tight">
              按 Enter 原地替换，按 Esc 随时隐藏
            </p>
          </div>
        </div>

        {/* Interactive Try-it Demo Simulator */}
        <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
            <span>✨ 模拟体验区（点击感受润色效果）</span>
            <span className="text-[10px] text-teal-400/80">交互演示</span>
          </div>

          <div
            onClick={() => setDemoState((prev) => (prev === 'idle' ? 'polished' : 'idle'))}
            role="button"
            tabIndex={0}
            className="group cursor-pointer rounded-lg border border-white/5 bg-white/[0.02] p-2.5 transition-all hover:border-teal-500/40 hover:bg-teal-500/[0.03]"
          >
            {demoState === 'idle' ? (
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-300">
                  <span className="text-slate-500 mr-1.5">划选原文:</span>
                  “这个方案不行，完全没法用。”
                </p>
                <span className="rounded bg-teal-500/20 px-2 py-0.5 text-[10px] font-medium text-teal-300 group-hover:bg-teal-500/30 transition-colors">
                  点击润色
                </span>
              </div>
            ) : (
              <div className="animate-in fade-in duration-200">
                <div className="flex items-center gap-1.5 text-[10px] text-teal-400 font-medium mb-1">
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>润笔·职场商务：</span>
                </div>
                <p className="text-xs text-teal-200/90 leading-relaxed">
                  “关于当前方案在落地实施层面，仍有一定优化空间，建议结合实际资源进一步评估与细化。”
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Dismiss & Auto-close Bar */}
      <div className="flex shrink-0 items-center justify-between border-t border-white/10 pt-3">
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span>随时呼出：</span>
          <kbd className="rounded border border-white/15 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
            {shortcut}
          </kbd>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="runbi-focus-ring flex items-center gap-1.5 rounded-lg border border-teal-500/40 bg-teal-500/20 px-3.5 py-1.5 text-xs font-medium text-teal-300 hover:bg-teal-500/30 transition-all cursor-pointer shadow-sm shadow-teal-950"
        >
          <span>立即体验 · 收入托盘</span>
          <span className="rounded-full bg-teal-400/20 px-1.5 py-0.2 font-mono text-[10px] text-teal-200">
            {isPaused ? '已暂停' : `${countdown}s`}
          </span>
        </button>
      </div>
    </div>
  );
};

export default OnboardingView;
