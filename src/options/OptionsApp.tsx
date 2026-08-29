/**
 * @file src/options/OptionsApp.tsx
 * Full BYOK & Model Settings Page
 * Consumes @runbi/shared, ChromeStorageProvider, and ChromePortLLMTransport
 * Part of Runbi Chrome Extension (Manifest V3)
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { PolishStyle, ProviderType, TriggerMode, ConnectionTestResult } from '@runbi/shared/types/stream';
import type { IStorageProvider, ILLMTransport } from '@runbi/shared/adapters';
import {
  PROVIDER_PRESETS,
  STYLE_NAMES,
  type ProviderPreset,
} from '@runbi/shared/types/settings';
import { DEFAULT_STYLE_PROMPTS } from '@runbi/shared/core/prompts';
import { ChromeStorageProvider } from '../adapters/ChromeStorageProvider';
import { ChromePortLLMTransport } from '../adapters/ChromePortLLMTransport';

export { PROVIDER_PRESETS, STYLE_NAMES, type ProviderPreset };

// Inline SVGs for lightweight, zero-dependency rendering
const SparklesIcon = ({ className = 'w-5 h-5' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" />
  </svg>
);

const CpuIcon = ({ className = 'w-5 h-5' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <rect x="9" y="9" width="6" height="6" />
    <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
  </svg>
);

const GlobeIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const KeyIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7.5" cy="15.5" r="5.5" />
    <path d="m21 2-9.6 9.6M15.5 7.5l3 3M18.5 4.5l3 3" />
  </svg>
);

const EyeIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20" />
  </svg>
);

const CheckIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const AlertCircleIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const RefreshCwIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
  </svg>
);

const SaveIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

const ShieldIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const SlidersIcon = ({ className = 'w-5 h-5' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </svg>
);

const RotateCcwIcon = ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

export interface OptionsAppProps {
  storageProvider?: IStorageProvider;
  llmTransport?: ILLMTransport;
}

export const OptionsApp: React.FC<OptionsAppProps> = ({
  storageProvider: injectedStorageProvider,
  llmTransport: injectedLLMTransport,
}) => {
  const storage = useMemo<IStorageProvider>(
    () => injectedStorageProvider || new ChromeStorageProvider(),
    [injectedStorageProvider]
  );
  const transport = useMemo<ILLMTransport>(
    () => injectedLLMTransport || new ChromePortLLMTransport(),
    [injectedLLMTransport]
  );

  // Settings States
  const [provider, setProvider] = useState<ProviderType>('deepseek');
  const [baseUrl, setBaseUrl] = useState<string>('https://api.deepseek.com/v1');
  const [apiKey, setApiKey] = useState<string>('');
  const [model, setModel] = useState<string>('deepseek-chat');
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [triggerMode, setTriggerMode] = useState<TriggerMode>('capsule');
  const [blacklistText, setBlacklistText] = useState<string>('');

  // Custom Prompts State for 6+ styles
  const [activePromptStyle, setActivePromptStyle] = useState<PolishStyle>('polished');
  const [customPrompts, setCustomPrompts] = useState<Partial<Record<PolishStyle, string>>>({});
  const [telemetryEnabled, setTelemetryEnabled] = useState<boolean>(false);
    const [telemetryDsn, setTelemetryDsn] = useState<string>('');
    const [feedbackText, setFeedbackText] = useState<string>('');
    const [feedbackSending, setFeedbackSending] = useState<boolean>(false);

  // Status & Feedback States
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState<boolean>(false);

  // Load configuration from storage on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const storedProvider = await storage.get<ProviderType>('provider', 'deepseek');
        const storedBaseUrl = await storage.get<string>('baseUrl', 'https://api.deepseek.com/v1');
        const storedApiKey = await storage.get<string>('apiKey', '');
        const storedModel = await storage.get<string>('model', 'deepseek-chat');
        const storedTriggerMode = await storage.get<TriggerMode>('triggerMode', 'capsule');
        const storedBlacklist = await storage.get<string[]>('blacklist', []);
        const storedCustomPrompts = await storage.get<Partial<Record<PolishStyle, string>>>('customPrompts', {});

        if (storedProvider) setProvider(storedProvider);
        if (storedBaseUrl !== undefined) setBaseUrl(storedBaseUrl);
        if (storedApiKey !== undefined) setApiKey(storedApiKey);
        if (storedModel !== undefined) setModel(storedModel);
        if (storedTriggerMode) setTriggerMode(storedTriggerMode);
        if (Array.isArray(storedBlacklist)) setBlacklistText(storedBlacklist.join('\n'));
        if (storedCustomPrompts) setCustomPrompts(storedCustomPrompts);

        const storedTelemetryEnabled = await storage.get<boolean>('telemetry.enabled', false);
        const storedTelemetryDsn = await storage.get<string>('telemetry.dsn', '');
        setTelemetryEnabled(Boolean(storedTelemetryEnabled));
        if (storedTelemetryDsn !== undefined) setTelemetryDsn(storedTelemetryDsn);
      } catch (_) {}
    }

    loadSettings();
  }, [storage]);

  // Handle Provider Preset Switch
  const handleSelectProvider = useCallback((newProvider: ProviderType) => {
    setProvider(newProvider);
    const preset = PROVIDER_PRESETS.find((p) => p.id === newProvider);
    if (preset) {
      if (newProvider !== 'custom') {
        setBaseUrl(preset.baseUrl);
        setModel(preset.defaultModel);
      }
    }
  }, []);

  // Handle Connection Test via ILLMTransport
  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);

    const testPayload = {
      apiKey,
      baseUrl: baseUrl || 'https://api.deepseek.com/v1',
      model: model || 'deepseek-chat',
      style: 'polished' as PolishStyle,
    };

    try {
      const response = await transport.testConnection(testPayload);
      setTestResult(response || { success: false, error: '未获取到测试响应' });
    } catch (err: any) {
      setTestResult({
        success: false,
        error: err?.message || '测试请求失败，请检查网络或配置',
      });
    } finally {
      setIsTesting(false);
    }
  }, [apiKey, baseUrl, model, transport]);

  // Handle Save Settings
  const handleSaveSettings = useCallback(async () => {
    const blacklist = blacklistText
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const payload = {
          provider,
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
          model: model.trim(),
          triggerMode,
          blacklist,
          customPrompts,
          'telemetry.enabled': telemetryEnabled,
          'telemetry.dsn': telemetryDsn.trim(),
        };

        try {
          // Self-healing permission grant: saving settings is a user gesture,
          // so request the exact endpoint origin here. This closes the loop
          // where a user who denied the popup's <all_urls> request had no
          // other in-product way to authorize their LLM endpoint.
          if (typeof chrome !== 'undefined' && chrome.permissions?.request && payload.baseUrl) {
            try {
              const origin = new URL(payload.baseUrl).origin;
              const already = await chrome.permissions.contains({ origins: [origin] });
              if (!already) {
                await chrome.permissions.request({ origins: [origin] });
              }
            } catch {
              // Invalid URL or user denial — streamHandler reports a clear
              // guidance message at request time, so stay silent here.
            }
          }

          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            await chrome.storage.local.set(payload);
          } else {
            await storage.set('provider', payload.provider);
            await storage.set('baseUrl', payload.baseUrl);
            await storage.set('apiKey', payload.apiKey);
            await storage.set('model', payload.model);
            await storage.set('triggerMode', payload.triggerMode);
            await storage.set('blacklist', payload.blacklist);
            await storage.set('customPrompts', payload.customPrompts);
            await storage.set('telemetry.enabled', telemetryEnabled);
            await storage.set('telemetry.dsn', telemetryDsn.trim());
          }
          setIsSaved(true);
          setToastMessage('✓ 配置已成功保存！');
          setTimeout(() => {
            setIsSaved(false);
            setToastMessage(null);
          }, 2500);
        } catch (err: any) {
          setToastMessage(`保存失败: ${err?.message || '未知错误'}`);
          setTimeout(() => setToastMessage(null), 3000);
        }
      }, [provider, baseUrl, apiKey, model, triggerMode, blacklistText, customPrompts, storage, telemetryEnabled, telemetryDsn]);

  // Submit user feedback (opt-in: forwarded to background SW, only sent when telemetry enabled)
  const handleSubmitFeedback = useCallback(async () => {
    const msg = feedbackText.trim();
    if (!msg) {
      setToastMessage('请先输入反馈内容');
      setTimeout(() => setToastMessage(null), 2500);
      return;
    }
    if (feedbackSending) return;
    setFeedbackSending(true);
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        const response = await chrome.runtime.sendMessage({ action: 'SUBMIT_FEEDBACK', payload: { message: msg } });
        if (response?.status === 'telemetry_disabled') {
          setToastMessage('错误上报未启用：请先在上方开启「错误上报」并填写 DSN 后重试');
        } else if (response?.success) {
          setToastMessage('反馈已提交，谢谢！');
        } else {
          setToastMessage('反馈提交失败，请稍后重试');
        }
      } else {
        setToastMessage('当前环境不支持提交反馈');
      }
      setFeedbackText('');
    } catch (err: any) {
      setToastMessage(`反馈提交失败：${err?.message || '未知错误'}`);
    } finally {
      setFeedbackSending(false);
      setTimeout(() => setToastMessage(null), 4500);
    }
  }, [feedbackText, feedbackSending]);

  // Handle Reset Current Prompt
  const handleResetCurrentPrompt = useCallback(() => {
    setCustomPrompts((prev) => {
      const next = { ...prev };
      delete next[activePromptStyle];
      return next;
    });
    setToastMessage(`已恢复【${STYLE_NAMES[activePromptStyle]}】默认 Prompt`);
    setTimeout(() => setToastMessage(null), 2000);
  }, [activePromptStyle]);

  // Current prompt text for active style tab
  const currentPromptContent = customPrompts[activePromptStyle] !== undefined
    ? customPrompts[activePromptStyle]
    : DEFAULT_STYLE_PROMPTS[activePromptStyle];

  const activePreset = PROVIDER_PRESETS.find((p) => p.id === provider) || PROVIDER_PRESETS[0];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-16 font-sans antialiased">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          id="settings-toast"
          className="fixed top-6 right-6 z-50 flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-xl border border-slate-700 animate-fade-in text-sm font-medium"
        >
          <CheckIcon className="w-4 h-4 text-[#00BFA5]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Container */}
      <div className="max-w-4xl mx-auto pt-10 px-6">
        {/* Header */}
        <header className="flex items-center justify-between pb-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#00BFA5] to-[#00897B] flex items-center justify-center text-white shadow-md shadow-[#00BFA5]/20">
              <SparklesIcon className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                润笔 (Runbi) 设置
                <span className="text-xs bg-[#00BFA5]/10 text-[#00897B] font-semibold px-2 py-0.5 rounded-full border border-[#00BFA5]/20">
                  v1.0.0
                </span>
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                配置大语言模型 API 密钥、端点参数与个性化润色提示词
              </p>
            </div>
          </div>
          <button
            id="save-settings-btn-top"
            onClick={handleSaveSettings}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#00BFA5] hover:bg-[#00897B] text-white text-sm font-medium rounded-lg shadow-sm transition active:scale-95 cursor-pointer"
          >
            <SaveIcon className="w-4 h-4" />
            <span>保存配置</span>
          </button>
        </header>

        <main className="mt-8 space-y-8">
          {/* Section 1: BYOK LLM Configuration */}
          <section className="bg-white rounded-xl shadow-sm border border-slate-200/80 p-6">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
              <CpuIcon className="w-5 h-5 text-[#00BFA5]" />
              <h2 className="text-lg font-semibold text-slate-800">
                模型与 API 服务配置 (BYOK)
              </h2>
            </div>

            {/* Provider Tabs */}
            <div className="mb-6">
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                推荐服务商预设
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2" id="provider-tabs">
                {PROVIDER_PRESETS.map((p) => {
                  const isSelected = provider === p.id;
                  return (
                    <button
                      key={p.id}
                      data-provider={p.id}
                      type="button"
                      onClick={() => handleSelectProvider(p.id)}
                      className={`px-3 py-2.5 rounded-lg text-xs font-medium border text-center transition flex flex-col items-center justify-center gap-1 cursor-pointer ${
                        isSelected
                          ? 'border-[#00BFA5] bg-[#00BFA5]/10 text-[#00897B] font-semibold ring-2 ring-[#00BFA5]/20'
                          : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100 text-slate-600'
                      }`}
                    >
                      <span>{p.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Base URL Input */}
              <div>
                <label
                  htmlFor="base-url-input"
                  className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5"
                >
                  <GlobeIcon className="w-4 h-4 text-slate-400" />
                  <span>Base URL (API 接口基地址)</span>
                </label>
                <input
                  id="base-url-input"
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.deepseek.com/v1"
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00BFA5]/30 focus:border-[#00BFA5] transition font-mono text-slate-800"
                />
                <p className="text-xs text-slate-400 mt-1">
                  标准兼容端点（如：/v1/chat/completions）
                </p>
              </div>

              {/* Model Name Input */}
              <div>
                <label
                  htmlFor="model-input"
                  className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5"
                >
                  <CpuIcon className="w-4 h-4 text-slate-400" />
                  <span>Model (模型名称)</span>
                </label>
                <div className="relative">
                  <input
                    id="model-input"
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="deepseek-chat"
                    list="model-preset-options"
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00BFA5]/30 focus:border-[#00BFA5] transition font-mono text-slate-800"
                  />
                  {activePreset.models.length > 0 && (
                    <datalist id="model-preset-options">
                      {activePreset.models.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  建议选择具备强中文润色与低延迟的模型
                </p>
              </div>
            </div>

            {/* API Key Input */}
            <div className="mt-5">
              <label
                htmlFor="api-key-input"
                className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center justify-between"
              >
                <span className="flex items-center gap-1.5">
                  <KeyIcon className="w-4 h-4 text-slate-400" />
                  <span>API Key (密钥)</span>
                </span>
                <span className="text-xs text-slate-400 font-normal">
                  留空将自动切换为内置 Mock 模式
                </span>
              </label>
              <div className="relative">
                <input
                  id="api-key-input"
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full pl-3.5 pr-10 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00BFA5]/30 focus:border-[#00BFA5] transition font-mono text-slate-800"
                />
                <button
                  id="toggle-key-visibility"
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition cursor-pointer"
                  title={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                >
                  {showApiKey ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                </button>
              </div>
              <div className="flex items-center gap-1 text-xs text-slate-400 mt-1.5">
                <ShieldIcon className="w-3.5 h-3.5 text-emerald-500" />
                <span>
                  所有 Key 均保存在本地 <code>chrome.storage.local</code>，绝不经由任何第三方中间服务器。
                </span>
              </div>
            </div>

            {/* Connection Test Action Bar */}
            <div className="mt-6 pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  id="test-connection-btn"
                  type="button"
                  disabled={isTesting}
                  onClick={handleTestConnection}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCwIcon className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin text-[#00BFA5]' : ''}`} />
                  <span>{isTesting ? '正在测试连通性...' : '测试连通性'}</span>
                </button>
              </div>

              {/* Ping Result Indicator */}
              {testResult && (
                <div
                  id="connection-status"
                  className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded-md font-medium ${
                    testResult.success
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-rose-50 text-rose-700 border border-rose-200'
                  }`}
                >
                  {testResult.success ? (
                    <>
                      <CheckIcon className="w-3.5 h-3.5 text-emerald-600" />
                      <span>
                        连接成功 (延时: {testResult.latencyMs}ms, 模型: {testResult.model})
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertCircleIcon className="w-3.5 h-3.5 text-rose-600" />
                      <span>连接失败: {testResult.error}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Telemetry (Error Reporting) — opt-in, default OFF */}
          <section className="bg-white rounded-xl shadow-sm border border-slate-200/80 p-6">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500">
                  <ShieldIcon className="w-4 h-4" />
                </span>
                <h2 className="text-sm font-bold text-slate-800">错误上报（可选）</h2>
              </div>
              <span className="text-[10px] bg-slate-100 text-slate-500 font-medium px-1.5 py-0.5 rounded">
                默认关闭
              </span>
            </div>

            <p className="text-xs text-slate-500 mb-4">
              用于收集崩溃与错误日志，帮助改进稳定性。为保护隐私，此功能<strong>默认关闭</strong>，仅在你主动开启并提供 DSN 地址时上报；上传内容不含文本正文，且可随时关闭。
            </p>

            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-700">启用错误上报</span>
              </div>
              <button
                id="telemetry-toggle-btn"
                type="button"
                role="switch"
                aria-checked={telemetryEnabled}
                onClick={() => setTelemetryEnabled(!telemetryEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none cursor-pointer ${
                  telemetryEnabled ? 'bg-[#00BFA5]' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    telemetryEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {telemetryEnabled && (
              <div className="mt-3">
                <label htmlFor="telemetry-dsn-input" className="block text-xs font-medium text-slate-600 mb-1">
                  DSN 地址（Sentry / GlitchTip 兼容）
                </label>
                <input
                  id="telemetry-dsn-input"
                  type="text"
                  value={telemetryDsn}
                  onChange={(e) => setTelemetryDsn(e.target.value)}
                  placeholder="https://your-dsn@sentry.example.com/1"
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00BFA5]/30 focus:border-[#00BFA5] transition font-mono text-slate-800"
                />
              </div>
            )}
          </section>

                    {/* User Feedback — submit issue/request to the same GlitchTip (opt-in) */}
                    <section className="bg-white rounded-xl shadow-sm border border-slate-200/80 p-6">
                      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <span className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500">
                            <ShieldIcon className="w-4 h-4" />
                          </span>
                          <h2 className="text-sm font-bold text-slate-800">问题反馈</h2>
                        </div>
                        <span className="text-[10px] bg-slate-100 text-slate-500 font-medium px-1.5 py-0.5 rounded">
                          随遥测一起发送
                        </span>
                      </div>

                      <p className="text-xs text-slate-500 mb-3">
                        遇到问题或想提建议？写下来发给我们。反馈通过<a className="text-[#00BFA5] font-medium" href="#telemetry-dsn-input">错误上报</a>通道发送，仅在开启遥测时生效；开启后状态栏会保留本地文案（可在 GlitchTip 按 <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">[用户反馈]</code> 前缀过滤）。
                      </p>

                      <textarea
                        id="feedback-text-input"
                        value={feedbackText}
                        onChange={(e) => setFeedbackText(e.target.value)}
                        rows={3}
                        maxLength={2000}
                        placeholder="描述你遇到的问题或建议…"
                        className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00BFA5]/30 focus:border-[#00BFA5] transition text-slate-800 resize-none"
                      />

                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-[11px] text-slate-400">
                          {feedbackText.length}/2000
                        </span>
                        <button
                          id="submit-feedback-btn"
                          type="button"
                          disabled={feedbackSending || !feedbackText.trim()}
                          onClick={handleSubmitFeedback}
                          className="px-3.5 py-1.5 bg-[#00BFA5] hover:bg-[#00A896] text-white text-xs font-semibold rounded-lg transition disabled:opacity-50 cursor-pointer"
                        >
                          {feedbackSending ? '提交中…' : '提交反馈'}
                        </button>
                      </div>
                    </section>

                    {/* Section 2: Custom Prompt Templates (6+ Tabs) */}
          <section className="bg-white rounded-xl shadow-sm border border-slate-200/80 p-6">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <SparklesIcon className="w-5 h-5 text-[#00BFA5]" />
                <h2 className="text-lg font-semibold text-slate-800">
                  润色风格 Prompt 自定义模板
                </h2>
              </div>
              <button
                id="reset-prompt-btn"
                type="button"
                onClick={handleResetCurrentPrompt}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition cursor-pointer"
                title="恢复当前风格为官方默认 Prompt"
              >
                <RotateCcwIcon className="w-3.5 h-3.5" />
                <span>恢复此风格默认</span>
              </button>
            </div>

            {/* 6+ Scene Style Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-3">
              {(Object.keys(STYLE_NAMES) as PolishStyle[]).map((styleKey) => {
                const isActive = activePromptStyle === styleKey;
                const isCustomized = customPrompts[styleKey] !== undefined;
                return (
                  <button
                    key={styleKey}
                    id={`prompt-style-tab-${styleKey}`}
                    type="button"
                    onClick={() => setActivePromptStyle(styleKey)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
                      isActive
                        ? 'bg-[#00BFA5] text-white border-[#00BFA5] shadow-sm'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <span>{STYLE_NAMES[styleKey]}</span>
                    {isCustomized && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isActive ? 'bg-white' : 'bg-[#00BFA5]'
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Prompt Textarea */}
            <div>
              <label
                htmlFor="custom-prompt-textarea"
                className="block text-xs font-medium text-slate-500 mb-1"
              >
                【{STYLE_NAMES[activePromptStyle]}】系统提示词定义：
              </label>
              <textarea
                id="custom-prompt-textarea"
                rows={4}
                value={currentPromptContent}
                onChange={(e) => {
                  const val = e.target.value;
                  setCustomPrompts((prev) => ({
                    ...prev,
                    [activePromptStyle]: val,
                  }));
                }}
                className="w-full p-3 text-xs bg-slate-50/50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00BFA5]/30 focus:border-[#00BFA5] font-sans leading-relaxed text-slate-700 transition"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                注意：系统会自动追加终稿输出规则与格式保护要求，此处仅需定义该风格的人设与表达要点。
              </p>
            </div>
          </section>

          {/* Section 3: Interaction & Blacklist Settings */}
          <section className="bg-white rounded-xl shadow-sm border border-slate-200/80 p-6">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
              <SlidersIcon className="w-5 h-5 text-[#00BFA5]" />
              <h2 className="text-lg font-semibold text-slate-800">
                交互模式与免打扰设置
              </h2>
            </div>

            {/* Trigger Mode */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                划词触发模式
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  id="trigger-mode-capsule-label"
                  className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition ${
                    triggerMode === 'capsule'
                      ? 'border-[#00BFA5] bg-[#00BFA5]/5 ring-1 ring-[#00BFA5]'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    id="trigger-mode-capsule"
                    type="radio"
                    name="triggerMode"
                    value="capsule"
                    checked={triggerMode === 'capsule'}
                    onChange={() => setTriggerMode('capsule')}
                    className="mt-0.5 text-[#00BFA5] focus:ring-[#00BFA5]"
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-800">
                      轻徽标模式 (推荐)
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      划选文字后出现 28px 悬浮微标，点击微标后再展开润色面板，避免阅读干扰。
                    </div>
                  </div>
                </label>

                <label
                  id="trigger-mode-direct-label"
                  className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition ${
                    triggerMode === 'direct'
                      ? 'border-[#00BFA5] bg-[#00BFA5]/5 ring-1 ring-[#00BFA5]'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    id="trigger-mode-direct"
                    type="radio"
                    name="triggerMode"
                    value="direct"
                    checked={triggerMode === 'direct'}
                    onChange={() => setTriggerMode('direct')}
                    className="mt-0.5 text-[#00BFA5] focus:ring-[#00BFA5]"
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-800">
                      极速模式
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      划选文字释放鼠标后，直接展开面板并自动发起流式润色。
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Blacklist Textarea */}
            <div>
              <label
                htmlFor="blacklist-textarea"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                网站黑名单 (每行一个域名)
              </label>
              <textarea
                id="blacklist-textarea"
                rows={3}
                value={blacklistText}
                onChange={(e) => setBlacklistText(e.target.value)}
                placeholder="leetcode.cn&#10;github.com"
                className="w-full p-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00BFA5]/30 focus:border-[#00BFA5] font-mono text-slate-700 transition"
              />
              <p className="text-xs text-slate-400 mt-1">
                在上述域名的网页中，润笔将自动静默，不弹出微标或面板。
              </p>
            </div>
          </section>

          {/* Bottom Save Action Bar */}
          <div className="flex items-center justify-end gap-3 pt-4">
            <button
              id="save-settings-btn"
              type="button"
              onClick={handleSaveSettings}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-white font-medium text-sm shadow-md transition active:scale-95 cursor-pointer ${
                isSaved ? 'bg-emerald-600' : 'bg-[#00BFA5] hover:bg-[#00897B]'
              }`}
            >
              {isSaved ? <CheckIcon className="w-4 h-4" /> : <SaveIcon className="w-4 h-4" />}
              <span>{isSaved ? '已保存！' : '保存所有配置'}</span>
            </button>
          </div>
        </main>
      </div>
    </div>
  );
};

export default OptionsApp;
