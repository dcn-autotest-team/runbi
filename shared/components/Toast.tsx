/**
 * Toast - Auto-Dismissing Feedback Notification Pill
 * Platform-agnostic component for Runbi (@runbi/shared/components)
 */

import React, { useEffect, useState } from 'react';

export interface ToastProps {
  message: string;
  visible: boolean;
  durationMs?: number;
  type?: 'success' | 'error' | 'info';
  onDismiss?: () => void;
  className?: string;
}

export const Toast: React.FC<ToastProps> = ({
  message,
  visible,
  durationMs = 1500,
  type = 'success',
  onDismiss,
  className = '',
}) => {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      onDismiss?.();
    }, durationMs);

    return () => clearTimeout(timer);
  }, [visible, durationMs, onDismiss]);

  // Exit animation: keep mounted briefly after visible=false to play toast-out.
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (visible) {
      setLeaving(false);
      return;
    }
    if (!message) return;
    setLeaving(true);
    const t = setTimeout(() => setLeaving(false), 140);
    return () => clearTimeout(t);
  }, [visible, message]);

  if (!visible && !leaving) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      id="runbi-toast"
      className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[2147483647] flex items-center gap-1.5 px-4 py-2 bg-slate-900/90 dark:bg-slate-950/95 text-white text-xs font-medium rounded-full shadow-xl border border-slate-700/50 backdrop-blur-md pointer-events-none select-none ${
        visible ? 'animate-toast-in' : 'animate-toast-out'
      } ${className}`}
    >
      {type === 'success' && (
        <svg
          className="w-3.5 h-3.5 text-gray-300 flex-shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {type === 'error' && (
        <svg
          className="w-3.5 h-3.5 text-rose-400 flex-shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      )}
      {type === 'info' && (
        <svg
          className="w-3.5 h-3.5 text-sky-400 flex-shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      )}
      <span>{message}</span>
    </div>
  );
};

export default Toast;
