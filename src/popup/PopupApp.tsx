/**
 * @file src/popup/PopupApp.tsx
 * Popup Quick Settings Page
 * Consumes @runbi/shared and ChromeStorageProvider
 * Part of Runbi Chrome Extension (Manifest V3)
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { TriggerMode, ProviderType } from '@runbi/shared/types/stream';
import type { IStorageProvider } from '@runbi/shared/adapters';
import { ChromeStorageProvider } from '../adapters/ChromeStorageProvider';

// Inline SVGs for fast, lightweight rendering
const SparklesIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" />
  </svg>
);

const PowerIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10" />
  </svg>
);

const SlidersIcon = ({ className = 'w-3 h-3' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
  </svg>
);

const SettingsIcon = ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const GlobeIcon = ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const ShieldAlertIcon = ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const KeyboardIcon = ({ className = 'w-3 h-3' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M8 12h.001M12 12h.001M16 12h.001M7 16h10" />
  </svg>
);

const ChevronRightIcon = ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const CheckIcon = ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export interface PopupAppProps {
  storageProvider?: IStorageProvider;
}

export const PopupApp: React.FC<PopupAppProps> = ({ storageProvider: injectedStorageProvider }) => {
  const storage = useMemo<IStorageProvider>(
    () => injectedStorageProvider || new ChromeStorageProvider(),
    [injectedStorageProvider]
  );

  const [enabled, setEnabled] = useState<boolean>(true);
  const [triggerMode, setTriggerMode] = useState<TriggerMode>('capsule');
  const [provider, setProvider] = useState<ProviderType>('deepseek');
  const [model, setModel] = useState<string>('deepseek-chat');
  const [apiKey, setApiKey] = useState<string>('');
  const [currentDomain, setCurrentDomain] = useState<string>('');
  const [isDomainDisabled, setIsDomainDisabled] = useState<boolean>(false);
  const [blacklist, setBlacklist] = useState<string[]>([]);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [hostGranted, setHostGranted] = useState<boolean | null>(null);

  // Load current settings and active tab domain
  useEffect(() => {
    async function loadSettings() {
      try {
        const storedEnabled = await storage.get<boolean>('enabled', true);
        const storedTriggerMode = await storage.get<TriggerMode>('triggerMode', 'capsule');
        const storedProvider = await storage.get<ProviderType>('provider', 'deepseek');
        const storedModel = await storage.get<string>('model', 'deepseek-chat');
        const storedApiKey = await storage.get<string>('apiKey', '');
        const storedBlacklist = await storage.get<string[]>('blacklist', []);

        setEnabled(storedEnabled);
        setTriggerMode(storedTriggerMode);
        setProvider(storedProvider);
        setModel(storedModel);
        setApiKey(storedApiKey);
        setBlacklist(Array.isArray(storedBlacklist) ? storedBlacklist : []);
      } catch (_) {}
    }

    loadSettings();

    // Query active tab domain if in extension context
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]?.url) {
          try {
            const url = new URL(tabs[0].url);
            if (url.protocol.startsWith('http')) {
              setCurrentDomain(url.hostname);
            }
          } catch (_) {}
        }
      });
    }
  }, [storage]);

  // Update domain disabled status when currentDomain or blacklist changes
  useEffect(() => {
    if (currentDomain && blacklist.includes(currentDomain)) {
      setIsDomainDisabled(true);
    } else {
      setIsDomainDisabled(false);
    }
  }, [currentDomain, blacklist]);

  // Master switch toggle
  const handleToggleEnabled = useCallback(async () => {
    const nextVal = !enabled;
    setEnabled(nextVal);
    try {
      await storage.set('enabled', nextVal);
      setSaveToast(nextVal ? '已开启划词功能' : '已暂停划词功能');
      setTimeout(() => setSaveToast(null), 1500);
    } catch (_) {}
  }, [enabled, storage]);

  // Trigger mode change
  const handleTriggerModeChange = useCallback(async (mode: TriggerMode) => {
    setTriggerMode(mode);
    try {
      await storage.set('triggerMode', mode);
      setSaveToast(mode === 'capsule' ? '已设为轻徽标模式' : '已设为极速直出模式');
      setTimeout(() => setSaveToast(null), 1500);
    } catch (_) {}
  }, [storage]);

  // Toggle blacklist for current domain
  const handleToggleCurrentDomain = useCallback(async () => {
    if (!currentDomain) return;

    let updatedList: string[];
    if (isDomainDisabled) {
      updatedList = blacklist.filter((d) => d !== currentDomain);
    } else {
      updatedList = [...blacklist, currentDomain];
    }

    setBlacklist(updatedList);
    try {
      await storage.set('blacklist', updatedList);
      setSaveToast(isDomainDisabled ? `已恢复在 ${currentDomain} 启用` : `已在 ${currentDomain} 禁用`);
      setTimeout(() => setSaveToast(null), 1500);
    } catch (_) {}
  }, [currentDomain, isDomainDisabled, blacklist, storage]);

  // Check whether the https://*/* optional host permission is already granted
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.permissions?.contains) {
      return;
    }
    let cancelled = false;
    chrome.permissions.contains({ origins: ['https://*/*'] }).then((granted) => {
      if (!cancelled) setHostGranted(granted);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Grant cross-origin access so the extension can reach the configured LLM API.
  // Must run inside a user gesture (popup button click).
  const handleGrantHostAccess = useCallback(async () => {
    if (typeof chrome === 'undefined' || !chrome.permissions?.request) {
      setSaveToast('当前环境不支持权限申请');
      setTimeout(() => setSaveToast(null), 1500);
      return;
    }
    try {
      const granted = await chrome.permissions.request({ origins: ['https://*/*'] });
      setHostGranted(granted);
      setSaveToast(granted ? '已授权访问所有 HTTPS 站点' : '未授予访问权限');
      setTimeout(() => setSaveToast(null), 1500);
    } catch (err: any) {
      setSaveToast(`授权失败: ${err?.message || String(err)}`);
      setTimeout(() => setSaveToast(null), 2000);
    }
  }, []);

  // Open Options page
  const handleOpenOptions = useCallback(() => {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
        chrome.tabs.create({ url: chrome.runtime?.getURL?.('src/options/index.html') || 'src/options/index.html' });
      } else {
        window.open('src/options/index.html', '_blank');
      }
    } catch (_) {}
  }, []);

  const hasApiKey = Boolean(apiKey && apiKey.trim().length > 0);

  return (
    <div className="w-80 bg-white text-slate-800 font-sans p-4 shadow-xl select-none antialiased">
      {/* Toast Feedback */}
      {saveToast && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5 animate-fade-in whitespace-nowrap">
          <CheckIcon className="w-3.5 h-3.5 text-[#00BFA5]" />
          <span>{saveToast}</span>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#00BFA5] flex items-center justify-center text-white shadow-sm shadow-[#00BFA5]/30">
            <SparklesIcon className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-900 leading-tight">润笔 Runbi</h1>
            <p className="text-[10px] text-slate-400">轻划选词，妙笔生花</p>
          </div>
        </div>
        <span className="text-[10px] bg-slate-100 text-slate-500 font-medium px-1.5 py-0.5 rounded">
          v1.0.0
        </span>
      </header>

      {/* Master Toggle Switch */}
      <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 mb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PowerIcon className={`w-4 h-4 ${enabled ? 'text-[#00BFA5]' : 'text-slate-400'}`} />
            <div>
              <div className="text-xs font-semibold text-slate-800">划词功能开关</div>
              <div className="text-[10px] text-slate-500">
                {enabled ? '选中文本浮现润色微标' : '划词助手已暂停'}
              </div>
            </div>
          </div>
          <button
            id="master-toggle-btn"
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={handleToggleEnabled}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none cursor-pointer ${
              enabled ? 'bg-[#00BFA5]' : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Trigger Mode Selector */}
      <div className="mb-3">
        <div className="text-[11px] font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
          <SlidersIcon className="w-3 h-3" />
          <span>触发模式</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 bg-slate-100 p-1 rounded-lg">
          <button
            id="mode-capsule-btn"
            type="button"
            onClick={() => handleTriggerModeChange('capsule')}
            className={`py-1 text-xs font-medium rounded-md transition text-center cursor-pointer ${
              triggerMode === 'capsule'
                ? 'bg-white text-[#00897B] font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            轻徽标 (推荐)
          </button>
          <button
            id="mode-direct-btn"
            type="button"
            onClick={() => handleTriggerModeChange('direct')}
            className={`py-1 text-xs font-medium rounded-md transition text-center cursor-pointer ${
              triggerMode === 'direct'
                ? 'bg-white text-[#00897B] font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            极速直出
          </button>
        </div>
      </div>

      {/* Model & Provider Status */}
      <div className="mb-3 p-2.5 rounded-lg border border-slate-200/70 bg-white">
        <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1">
          当前推理引擎
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 overflow-hidden">
            <span
              className={`w-2 h-2 rounded-full ${
                hasApiKey ? 'bg-emerald-500 ring-2 ring-emerald-100' : 'bg-amber-500 ring-2 ring-amber-100'
              }`}
            />
            <span className="text-xs font-medium text-slate-800 truncate" id="active-model-name">
              {hasApiKey ? model || 'deepseek-chat' : '内置 Mock 模拟模式'}
            </span>
          </div>
          <span
            id="active-provider-badge"
            className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-slate-100 text-slate-600 whitespace-nowrap"
          >
            {hasApiKey ? provider.toUpperCase() : 'ZERO-CONFIG'}
          </span>
        </div>
      </div>

      {/* Domain Blacklist Fast Toggle */}
      {currentDomain && (
        <div className="mb-3">
          <button
            id="toggle-domain-btn"
            type="button"
            onClick={handleToggleCurrentDomain}
            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium border transition cursor-pointer ${
              isDomainDisabled
                ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span className="flex items-center gap-1.5 truncate">
              {isDomainDisabled ? (
                <ShieldAlertIcon className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              ) : (
                <GlobeIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              )}
              <span className="truncate">在 {currentDomain} 禁用</span>
            </span>
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                isDomainDisabled ? 'bg-rose-200 text-rose-800' : 'bg-slate-200 text-slate-600'
              }`}
            >
              {isDomainDisabled ? '已禁用' : '已启用'}
            </span>
          </button>
        </div>
      )}

      {/* Cross-origin permissions notice (requested on demand in MV3) */}
      {hostGranted === false && (
        <div className="mb-3 p-2.5 rounded-lg border border-amber-200 bg-amber-50">
          <div className="text-[11px] font-semibold text-amber-800 mb-1 flex items-center gap-1">
            <ShieldAlertIcon className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>需要访问 HTTPS 站点以连接模型 API</span>
          </div>
          <p className="text-[10px] text-amber-700 mb-2">
            授权后润色请求才能发送到你的模型服务（仅 HTTPS 站点）。
          </p>
          <button
            id="grant-host-access-btn"
            type="button"
            onClick={handleGrantHostAccess}
            className="w-full py-1.5 rounded-lg text-xs font-semibold bg-[#00BFA5] text-white hover:bg-[#00A896] transition cursor-pointer"
          >
            一键授权划词
          </button>
        </div>
      )}
      {hostGranted === true && (
        <div className="mb-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] font-medium">
          <CheckIcon className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>已授权访问 HTTPS 站点</span>
        </div>
      )}

      {/* Shortcut & Options Navigation */}
      <div className="pt-2 border-t border-slate-100 space-y-1.5">
        <button
          id="open-options-btn"
          type="button"
          onClick={handleOpenOptions}
          className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 rounded-lg transition font-medium cursor-pointer"
        >
          <span className="flex items-center gap-1.5">
            <SettingsIcon className="w-3.5 h-3.5 text-[#00BFA5]" />
            <span>详细设置 (API Key / 提示词)</span>
          </span>
          <ChevronRightIcon className="w-3.5 h-3.5 text-slate-400" />
        </button>

        <div className="flex items-center justify-between px-2.5 py-1 text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <KeyboardIcon className="w-3 h-3" />
            <span>快捷呼出</span>
          </span>
          <kbd className="font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200 text-[10px]">
            Alt + W
          </kbd>
        </div>
      </div>
    </div>
  );
};

export default PopupApp;
