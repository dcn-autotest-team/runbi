/**
 * Compact desktop selection toolbar. It deliberately uses the shared SVG icon
 * language instead of emoji or text-heavy actions.
 */

import React from 'react';
import { Check, Copy, Languages, MessageCircle, Search, Sparkles } from './Icons';

export interface SelectionCapsuleProps {
  visible: boolean;
  copied?: boolean;
  onSearch: () => void;
  onPolish: () => void;
  onReply: () => void;
  onTranslate: () => void;
  onCopy: () => void;
  onHoverChange?: (hovered: boolean) => void;
}

export function shouldShowCapsule(
  payload: { trigger?: string; capsule?: boolean } | null | undefined
): boolean {
  return payload?.trigger === 'selection' || payload?.trigger === 'clipboard';
}

export function buildBrowserSearchUrl(text: string): string {
  return `https://www.baidu.com/s?wd=${encodeURIComponent(text.trim())}`;
}

const actionClass =
  'runbi-selection-action runbi-focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] cursor-pointer select-none';

export const SelectionCapsule: React.FC<SelectionCapsuleProps> = ({
  visible,
  copied = false,
  onSearch,
  onPolish,
  onReply,
  onTranslate,
  onCopy,
  onHoverChange,
}) => (
  <div
    onMouseEnter={() => onHoverChange?.(true)}
    onMouseLeave={() => onHoverChange?.(false)}
    data-testid="selection-capsule"
    role="toolbar"
    aria-label="划词快捷操作"
    className={`runbi-selection-capsule flex h-11 w-[196px] items-center gap-0.5 p-1 ${
      visible ? 'is-visible' : 'is-hidden'
    }`}
  >
    <button type="button" onClick={onSearch} aria-label="在浏览器中搜索选中文本" title="浏览器搜索" className={actionClass}>
      <Search className="h-[17px] w-[17px]" aria-hidden="true" />
    </button>
    <button type="button" onClick={onPolish} aria-label="润色选中文本" title="润色" className={actionClass}>
      <Sparkles className="h-[17px] w-[17px]" aria-hidden="true" />
    </button>
    <button type="button" onClick={onReply} aria-label="智能回复选中文本" title="回复" className={actionClass}>
      <MessageCircle className="h-[17px] w-[17px]" aria-hidden="true" />
    </button>
    <button type="button" onClick={onTranslate} aria-label="翻译选中文本" title="翻译" className={actionClass}>
      <Languages className="h-[17px] w-[17px]" aria-hidden="true" />
    </button>
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? '已复制选中文本' : '复制选中文本'}
      title={copied ? '已复制' : '复制'}
      className={`${actionClass} ${copied ? 'is-success' : ''}`}
    >
      {copied
        ? <Check className="h-[17px] w-[17px]" aria-hidden="true" />
        : <Copy className="h-[17px] w-[17px]" aria-hidden="true" />}
    </button>
  </div>
);

export default SelectionCapsule;
