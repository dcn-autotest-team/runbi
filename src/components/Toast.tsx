/**
 * Toast - Auto-Dismissing Feedback Notification
 * Part of Runbi Chrome Extension (Manifest V3)
 */

import React, { useEffect } from 'react';

export interface ToastProps {
  message: string;
  visible: boolean;
  durationMs?: number;
  onDismiss?: () => void;
  className?: string;
}

export const Toast: React.FC<ToastProps> = ({
  message,
  visible,
  durationMs = 1500,
  onDismiss,
  className = '',
}) => {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      if (onDismiss) {
        onDismiss();
      }
    }, durationMs);

    return () => clearTimeout(timer);
  }, [visible, durationMs, onDismiss]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      id="runbi-toast"
      className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[2147483647] flex items-center gap-1.5 px-4 py-2 bg-slate-900/90 dark:bg-slate-950/95 text-white text-xs font-medium rounded-full shadow-xl border border-slate-700/50 backdrop-blur-md animate-toast-in pointer-events-none select-none ${className}`}
    >
      <svg
        className="w-3.5 h-3.5 text-[#00BFA5] flex-shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span>{message}</span>
    </div>
  );
};

export default Toast;
