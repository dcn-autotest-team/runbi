/**
 * Compact desktop selection toolbar. It deliberately uses the shared SVG icon
 * language instead of emoji or text-heavy actions.
 */

import React, { useRef } from 'react';
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
  if (payload?.capsule === false) return false;
  return payload?.trigger === 'selection' || payload?.trigger === 'clipboard';
}

export function buildBrowserSearchUrl(text: string): string {
  return `https://www.baidu.com/s?wd=${encodeURIComponent(text.trim())}`;
}

const actionClass =
  'runbi-selection-action runbi-focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] cursor-pointer select-none';

// The low-level mouse hook sees pointer-up before WebView2 can reliably flush
// a button click. Start the action on pointer-up; onClick remains the DOM
// fallback for environments that do not dispatch pointer events.
export const SelectionCapsule: React.FC<SelectionCapsuleProps> = ({
  visible,
  copied = false,
  onSearch,
  onPolish,
  onReply,
  onTranslate,
  onCopy,
  onHoverChange,
}) => {
  const clickAfterPointerUpRef = useRef(false);

  const startAction = (action: () => void) => (event: React.SyntheticEvent<HTMLButtonElement>) => {
    // Pointer-up is the reliable desktop path, but browsers then dispatch a
    // click as well. Consume that paired click so search/copy cannot run twice.
    if (event.type === 'click' && clickAfterPointerUpRef.current) {
      clickAfterPointerUpRef.current = false;
      return;
    }
    if (event.type === 'pointerup') {
      clickAfterPointerUpRef.current = true;
      window.setTimeout(() => {
        clickAfterPointerUpRef.current = false;
      }, 0);
    }
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  return (
  <div
    onMouseEnter={() => onHoverChange?.(true)}
    onMouseLeave={() => onHoverChange?.(false)}
    onClick={(e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      onPolish();
    }}
    data-testid="selection-capsule"
    role="toolbar"
    aria-label="划词快捷操作"
    className={`runbi-selection-capsule flex h-11 w-[196px] items-center gap-0.5 p-1 cursor-pointer ${
      visible ? 'is-visible' : 'is-hidden'
    }`}
  >
    <button type="button" onPointerUp={startAction(onSearch)} onClick={startAction(onSearch)} aria-label="在浏览器中搜索选中文本" title="浏览器搜索" className={actionClass}>
      <Search className="h-[17px] w-[17px]" aria-hidden="true" />
    </button>
    <button type="button" onPointerUp={startAction(onPolish)} onClick={startAction(onPolish)} aria-label="润色选中文本" title="润色" className={actionClass}>
      <Sparkles className="h-[17px] w-[17px]" aria-hidden="true" />
    </button>
    <button type="button" onPointerUp={startAction(onReply)} onClick={startAction(onReply)} aria-label="智能回复选中文本" title="回复" className={actionClass}>
      <MessageCircle className="h-[17px] w-[17px]" aria-hidden="true" />
    </button>
    <button type="button" onPointerUp={startAction(onTranslate)} onClick={startAction(onTranslate)} aria-label="翻译选中文本" title="翻译" className={actionClass}>
      <Languages className="h-[17px] w-[17px]" aria-hidden="true" />
    </button>
    <button
      type="button"
      onPointerUp={startAction(onCopy)}
      onClick={startAction(onCopy)}
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
};

export default SelectionCapsule;
