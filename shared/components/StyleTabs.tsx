/**
 * @file shared/components/StyleTabs.tsx
 * Compact Scene Preset Dropdown Trigger & Floating Menu
 * Platform-agnostic component for Runbi (@runbi/shared/components)
 */

import React, { useState, useRef, useEffect } from 'react';
import type { PolishStyle } from '../types/stream';

export interface StyleOption {
  id: PolishStyle;
  label: string;
  shortLabel: string;
  icon?: string;
  description: string;
}

export const STYLE_OPTIONS: StyleOption[] = [
  { id: 'polished', label: '通用润色', shortLabel: '通用', description: '提升文笔连贯与流畅度' },
  { id: 'academic', label: '学术规范', shortLabel: '学术', description: '严谨规范、学术语调' },
  { id: 'business', label: '职场商务', shortLabel: '商务', description: '得体专业、职场沟通' },
  { id: 'literary', label: '文采飞扬', shortLabel: '文采', description: '辞藻优美、生动灵动' },
  { id: 'concise', label: '精简提炼', shortLabel: '精简', description: '言简意赅、去粗取精' },
  { id: 'native_en', label: '地道英文', shortLabel: '英文', description: '母语级地道表达' },
  { id: 'reply', label: '智能回复', shortLabel: '回复', description: '针对选中文本撰写得体回复' },
];

export interface StyleTabsProps {
  activeStyle: PolishStyle;
  onStyleChange: (style: PolishStyle) => void;
  disabled?: boolean;
  className?: string;
  styles?: StyleOption[];
}

export const StyleTabs: React.FC<StyleTabsProps> = ({
  activeStyle,
  onStyleChange,
  disabled = false,
  className = '',
  styles = STYLE_OPTIONS,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentOption =
    (styles && styles.find((s) => s.id === activeStyle)) ||
    (styles && styles[0]) ||
    { id: activeStyle, label: activeStyle || '通用', shortLabel: activeStyle || '通用', description: '' };

  // Close dropdown on outside click or Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div
      ref={containerRef}
      className={`relative inline-block select-none z-30 ${className}`}
      aria-label="润色风格切换"
    >
      {/* Compact Single-line Trigger (Height <= 28px) */}
      <button
        id="style-dropdown-trigger"
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="runbi-style-menu"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`runbi-focus-ring flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-all duration-150 ${
          isOpen
            ? 'bg-[#00BFA5]/20 text-[#00BFA5] border-[#00BFA5]/50 shadow-sm'
            : 'bg-black/20 hover:bg-black/30 dark:bg-white/5 dark:hover:bg-white/10 text-teal-400 dark:text-teal-300 border-teal-500/30 hover:border-teal-500/50'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {currentOption.label}
        <svg
          className={`w-3 h-3 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Floating Glassmorphic Dropdown Menu */}
      <div
        id="runbi-style-menu"
        role="menu"
        aria-label="风格选择列表"
        className={`absolute left-0 top-full mt-1.5 w-48 origin-top-left bg-[#162023]/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-xl border border-white/15 dark:border-slate-700 shadow-2xl p-1 z-50 flex flex-col gap-0.5 transition-[opacity,scale,visibility] duration-150 ease-out ${
          isOpen ? 'visible opacity-100 scale-100' : 'invisible opacity-0 scale-95 pointer-events-none'
        }`}
      >
        {(styles || []).map((opt) => {
          const isActive = activeStyle === opt.id;
          return (
            <button
              key={opt.id}
              role="menuitemradio"
              type="button"
              data-style={opt.id}
              aria-checked={isActive}
              disabled={disabled}
              title={`${opt.label} - ${opt.description}`}
              onClick={() => {
                onStyleChange(opt.id);
                setIsOpen(false);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left cursor-pointer ${
                isActive
                  ? 'bg-[#00BFA5] text-black font-semibold shadow-xs'
                  : 'text-slate-300 hover:text-white hover:bg-white/10 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default StyleTabs;
