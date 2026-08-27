/**
 * StyleTabs - 6+ Scene Preset Selection Tabs
 * Platform-agnostic component for Runbi (@runbi/shared/components)
 */

import React from 'react';
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
  return (
    <div
      className={`flex items-center gap-1 p-1 bg-slate-100/90 dark:bg-slate-800/80 rounded-xl overflow-x-auto runbi-scrollbar select-none ${className}`}
      role="tablist"
      aria-label="润色风格切换"
    >
      {styles.map((opt) => {
        const isActive = activeStyle === opt.id;
        return (
          <button
            key={opt.id}
            role="tab"
            type="button"
            data-style={opt.id}
            aria-selected={isActive}
            disabled={disabled}
            title={`${opt.label} - ${opt.description}`}
            onClick={() => onStyleChange(opt.id)}
            className={`flex-1 min-w-[54px] py-1 px-2 text-xs text-center font-medium rounded-lg transition-all duration-150 whitespace-nowrap focus:outline-none ${
              isActive
                ? 'bg-[#00BFA5] text-white shadow-sm font-semibold scale-[1.02]'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/70 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-700/60'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

export default StyleTabs;
