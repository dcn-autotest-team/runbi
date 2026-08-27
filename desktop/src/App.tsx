/**
 * @file desktop/src/App.tsx
 * Runbi Desktop Client - Raycast-like AI Text Polishing Assistant
 * Powered by Tauri 2.x + React 18 + Tailwind CSS + @runbi/shared
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { PolishStyle, StreamConfig } from '@runbi/shared/types';
import { PolishPanel } from '@runbi/shared/components';
import { createDesktopAdapters } from './adapters';
import { Sparkles, Settings, X, Pin, PinOff, RefreshCw } from './components/Icons';

export const App: React.FC = () => {
  const [adapters] = useState(() => createDesktopAdapters());

  // Core State
  const [originalText, setOriginalText] = useState<string>('润笔是一款现代、轻量、纯粹的 AI 划词润色与文采修饰工具。');
  const [polishedText, setPolishedText] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [activeStyle, setActiveStyle] = useState<PolishStyle>('academic');
  const [isDiffMode, setIsDiffMode] = useState<boolean>(false);
  const [durationMs, setDurationMs] = useState<number>(0);
  const [totalTokens, setTotalTokens] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string>('');
  const [toastVisible, setToastVisible] = useState<boolean>(false);
  const [isPinned, setIsPinned] = useState<boolean>(true);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  // Settings State
  const [apiKey, setApiKey] = useState<string>('');
  const [endpoint, setEndpoint] = useState<string>('https://api.deepseek.com/v1/chat/completions');
  const [model, setModel] = useState<string>('deepseek-chat');

  const abortControllerRef = useRef<AbortController | null>(null);

  const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  // Show Toast
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setToastVisible(true);
    setTimeout(() => {
      setToastVisible(false);
    }, 2000);
  }, []);

  // Load Saved Settings on Mount
  useEffect(() => {
    const loadConfig = async () => {
      const savedKey = await adapters.storageProvider.get<string>('apiKey', '');
      const savedEndpoint = await adapters.storageProvider.get<string>('endpoint', 'https://api.deepseek.com/v1/chat/completions');
      const savedModel = await adapters.storageProvider.get<string>('model', 'deepseek-chat');
      const savedStyle = await adapters.storageProvider.get<PolishStyle>('defaultStyle', 'academic');

      if (savedKey) setApiKey(savedKey);
      if (savedEndpoint) setEndpoint(savedEndpoint);
      if (savedModel) setModel(savedModel);
      if (savedStyle) setActiveStyle(savedStyle);
    };

    loadConfig();

    // In Tauri, signal that frontend is ready to avoid white flash
    if (isTauri) {
      const modCore = '@tauri-apps/api/core';
      import(/* @vite-ignore */ modCore).then(({ invoke }) => {
        invoke('app_ready').catch(() => {});
      }).catch(() => {});

      // Listen for selection events from Rust global shortcut
      const modEvent = '@tauri-apps/api/event';
      import(/* @vite-ignore */ modEvent).then(({ listen }) => {
        listen('runbi://captured-selection', (event: any) => {
          if (event?.payload?.text) {
            setOriginalText(event.payload.text);
            handleStartPolish(event.payload.text, activeStyle);
          }
        });
      }).catch(() => {});
    }
  }, [adapters, isTauri]);

  // Save Settings
  const handleSaveSettings = async () => {
    await adapters.storageProvider.set('apiKey', apiKey.trim());
    await adapters.storageProvider.set('endpoint', endpoint.trim());
    await adapters.storageProvider.set('model', model.trim());
    await adapters.storageProvider.set('defaultStyle', activeStyle);
    setShowSettings(false);
    showToast('配置已保存');
  };

  // Trigger Polishing Process
  const handleStartPolish = useCallback(async (text: string, style: PolishStyle, customInstruction?: string) => {
    if (!text || text.trim().length === 0) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsGenerating(true);
    setError(null);
    setPolishedText('');
    setDurationMs(0);
    setTotalTokens(0);

    const streamConfig: StreamConfig = {
      style,
      userInstruction: customInstruction,
      apiKey: apiKey || undefined,
      baseUrl: endpoint || undefined,
      model: model || undefined,
      temperature: 0.7,
    };

    await adapters.llmTransport.streamChat(
      { text, config: streamConfig },
      {
        onChunk: (delta) => {
          setPolishedText((prev) => prev + delta);
        },
        onDone: (duration, tokens) => {
          setIsGenerating(false);
          setDurationMs(duration);
          setTotalTokens(tokens);
          abortControllerRef.current = null;
        },
        onError: (err) => {
          setIsGenerating(false);
          setError(err);
          abortControllerRef.current = null;
        },
        onAbort: () => {
          setIsGenerating(false);
          abortControllerRef.current = null;
        },
      },
      abortController.signal
    );
  }, [adapters, apiKey, endpoint, model]);

  // Initial trigger if text is present
  useEffect(() => {
    if (originalText && !polishedText && !isGenerating) {
      handleStartPolish(originalText, activeStyle);
    }
  }, []);

  // Stop Generation
  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsGenerating(false);
      showToast('已停止生成');
    }
  };

  // Regenerate
  const handleRegenerate = () => {
    handleStartPolish(originalText, activeStyle);
  };

  // Style Change
  const handleStyleChange = (newStyle: PolishStyle) => {
    setActiveStyle(newStyle);
    handleStartPolish(originalText, newStyle);
  };

  // Copy to Clipboard
  const handleCopy = async () => {
    const textToCopy = polishedText || originalText;
    const ok = await adapters.textReplacer.copyToClipboard(textToCopy);
    if (ok) {
      showToast('已复制到剪贴板');
    }
  };

  // Replace Text Back to Host Application
  const handleReplace = async () => {
    const textToInsert = polishedText || originalText;
    const res = await adapters.textReplacer.replaceText(textToInsert);
    if (res.success) {
      showToast('已贴回原文');
      if (isTauri && !isPinned) {
        const modCore = '@tauri-apps/api/core';
        import(/* @vite-ignore */ modCore).then(({ invoke }) => {
          invoke('hide_window').catch(() => {});
        }).catch(() => {});
      }
    } else {
      showToast(res.error || '替换失败，已复制到剪贴板');
    }
  };

  // Close / Hide Window
  const handleClose = () => {
    if (isTauri) {
      const modCore = '@tauri-apps/api/core';
      import(/* @vite-ignore */ modCore).then(({ invoke }) => {
        invoke('hide_window').catch(() => {});
      }).catch(() => {});
    }
  };

  // Toggle Pin on Top
  const handleTogglePin = async () => {
    const nextPinned = !isPinned;
    setIsPinned(nextPinned);
    if (isTauri) {
      try {
        const modWin = '@tauri-apps/api/window';
        const { getCurrentWindow } = await import(/* @vite-ignore */ modWin);
        await getCurrentWindow().setAlwaysOnTop(nextPinned);
        showToast(nextPinned ? '已开启始终置顶' : '已取消置顶');
      } catch (e) {
        console.warn('setAlwaysOnTop failed:', e);
      }
    }
  };

  // Manual Grab from Clipboard
  const handleManualGrab = async () => {
    const sel = await adapters.selectionProvider.getSelection();
    if (sel && sel.text) {
      setOriginalText(sel.text);
      handleStartPolish(sel.text, activeStyle);
      showToast('已获取最新剪贴板内容');
    } else {
      showToast('剪贴板中未检测到有效文本');
    }
  };

  return (
    <div className="w-screen h-screen flex flex-col justify-start items-center p-3 bg-transparent font-sans select-none overflow-hidden">
      {/* Raycast Container */}
      <div className="w-full max-w-[540px] flex flex-col bg-[#121A1C]/90 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl overflow-hidden transition-all duration-200">
        
        {/* Title & Drag Region */}
        <div
          data-tauri-drag-region
          className="flex items-center justify-between px-3.5 py-2.5 bg-black/20 border-b border-white/10 cursor-grab active:cursor-grabbing"
        >
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-teal-500/20 border border-teal-500/40 flex items-center justify-center text-teal-400">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <span className="text-sm font-semibold text-white tracking-wide">润笔 (Runbi)</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/10 text-slate-400 font-mono">
              Desktop
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleManualGrab}
              title="读取剪贴板"
              className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleTogglePin}
              title={isPinned ? '取消置顶' : '始终置顶'}
              className={`p-1 rounded-md transition-colors ${
                isPinned ? 'text-teal-400 bg-teal-500/10' : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              title="设置"
              className={`p-1 rounded-md transition-colors ${
                showSettings ? 'text-teal-400 bg-teal-500/10' : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleClose}
              title="隐藏窗口 (Esc)"
              className="p-1 rounded-md text-slate-400 hover:text-red-400 hover:bg-white/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Settings Modal Body */}
        {showSettings ? (
          <div className="p-4 space-y-3 bg-[#162023] text-xs text-slate-200">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="font-semibold text-sm text-white">模型与服务配置</span>
              <span className="text-[11px] text-teal-400 font-mono">BYOK 模式</span>
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">DeepSeek / OpenAI API Key</label>
              <input
                type="password"
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 text-white focus:border-teal-500 outline-none font-mono"
              />
              <p className="text-[10px] text-slate-500">留空将自动调用内置零配置 Mock 模拟流。</p>
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">API Endpoint</label>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 text-white focus:border-teal-500 outline-none font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-400">Model Name</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 text-white focus:border-teal-500 outline-none font-mono"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setShowSettings(false)}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveSettings}
                className="px-3 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-400 text-black font-medium transition-colors"
              >
                保存配置
              </button>
            </div>
          </div>
        ) : (
          /* Main Polish Panel Component */
          <PolishPanel
            originalText={originalText}
            polishedText={polishedText}
            isGenerating={isGenerating}
            activeStyle={activeStyle}
            isDiffMode={isDiffMode}
            isEditable={true}
            durationMs={durationMs}
            totalTokens={totalTokens}
            error={error}
            modelName={apiKey ? model : 'DeepSeek-Mock'}
            toastMessage={toastMessage}
            toastVisible={toastVisible}
            showOriginalPreview={true}
            onClose={handleClose}
            onStyleChange={handleStyleChange}
            onToggleDiff={() => setIsDiffMode(!isDiffMode)}
            onStop={handleStop}
            onRegenerate={handleRegenerate}
            onCopy={handleCopy}
            onReplace={handleReplace}
            onSendInstruction={(inst) => handleStartPolish(originalText, activeStyle, inst)}
            onToastDismiss={() => setToastVisible(false)}
            className="!static !shadow-none !border-none !rounded-none !bg-transparent"
          />
        )}

        {/* Raycast Bottom Keyboard Hints */}
        <div className="px-3 py-1.5 bg-black/30 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-white/10 text-[10px] text-slate-300 font-mono">Alt+Space</kbd> 唤醒
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-white/10 text-[10px] text-slate-300 font-mono">Enter</kbd> 替换贴回
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-white/10 text-[10px] text-slate-300 font-mono">Esc</kbd> 隐藏
            </span>
          </div>
          <span className="text-[10px] text-teal-400/80 font-mono">Tauri 2.x</span>
        </div>

      </div>
    </div>
  );
};

export default App;
