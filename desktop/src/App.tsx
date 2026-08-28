/**
 * @file desktop/src/App.tsx
 * Runbi Desktop Client - Raycast-like AI Text Polishing Assistant
 * Powered by Tauri 2.x + React 18 + Tailwind CSS + @runbi/shared
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { PolishStyle, StreamConfig } from '@runbi/shared/types';
import { PolishPanel, type AttachedFileContext } from '@runbi/shared/components';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createDesktopAdapters } from './adapters';
import {
  classifyContext,
  buildScreenReplySystemPrompt,
  buildScreenReplyUserPrompt,
  buildScreenReplyRefinePrompt,
  type ScreenReplyAnalysis,
} from '@runbi/shared/core';
import { RunbiLogo, Settings, X, Pin, PinOff, RefreshCw } from './components/Icons';

const STYLE_NAMES: Record<PolishStyle, string> = {
  polished: '通用润色',
  academic: '学术规范',
  business: '职场商务',
  literary: '文采飞扬',
  concise: '精简提炼',
  native_en: '地道英文',
  reply: '智能回复',
};

const DEFAULT_SHORTCUT = 'Ctrl+Shift+Space';

const PROVIDER_PRESETS: Record<string, { label: string; endpoint: string; model: string }> = {
  deepseek: {
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
  },
  zhipu: {
    label: '智谱 glm-4',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4',
  },
  openai: {
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
  },
  custom: {
    label: '自定义',
    endpoint: '',
    model: '',
  },
};

const SettingsToggle: React.FC<{
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, description, checked, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className="runbi-settings-card runbi-focus-ring flex w-full items-center justify-between gap-4 px-3 py-2.5 text-left transition-colors hover:border-white/15 hover:bg-white/[0.045]"
  >
    <span className="min-w-0">
      <span className="block text-xs font-medium text-slate-200">{label}</span>
      <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-400">{description}</span>
    </span>
    <span
      aria-hidden="true"
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
        checked
          ? 'border-teal-300/50 bg-teal-500 shadow-[0_0_14px_rgba(0,191,165,0.22)]'
          : 'border-white/10 bg-white/10'
      }`}
    >
      <span
        className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-[20px]' : 'translate-x-0.5'
        }`}
      />
    </span>
  </button>
);

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
  const [isPinned, setIsPinned] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  // Settings State
  const [apiKey, setApiKey] = useState<string>('');
  const [endpoint, setEndpoint] = useState<string>('https://api.deepseek.com/v1/chat/completions');
  const [model, setModel] = useState<string>('deepseek-chat');
  const [wakeShortcut, setWakeShortcut] = useState<string>(DEFAULT_SHORTCUT);
  const [autoCopyPopup, setAutoCopyPopup] = useState<boolean>(false);
  const [autostart, setAutostart] = useState<boolean>(false);
  const [readChatScreenshot, setReadChatScreenshot] = useState<boolean>(true);
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false);
  const [connectionTest, setConnectionTest] = useState<{
    status: 'idle' | 'testing' | 'success' | 'error';
    message: string;
  }>({ status: 'idle', message: '' });
  const [currentScreenshot, setCurrentScreenshot] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'idle' | 'capsule' | 'panel'>(autoCopyPopup ? 'panel' : 'capsule');
  const [screenReplyAnalysis, setScreenReplyAnalysis] = useState<ScreenReplyAnalysis | null>(null);
  const [showEpoch, setShowEpoch] = useState<number>(0);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFileContext[]>([]);
  const [clipboardRef, setClipboardRef] = useState<string | null>(null);

  const getProviderPreset = (ep: string, md: string) => {
    if (ep === PROVIDER_PRESETS.deepseek.endpoint && md === PROVIDER_PRESETS.deepseek.model) return 'deepseek';
    if (ep === PROVIDER_PRESETS.zhipu.endpoint && md === PROVIDER_PRESETS.zhipu.model) return 'zhipu';
    if (ep === PROVIDER_PRESETS.openai.endpoint && md === PROVIDER_PRESETS.openai.model) return 'openai';
    return 'custom';
  };

  const handleSelectPreset = (key: string) => {
    if (key !== 'custom' && PROVIDER_PRESETS[key]) {
      setEndpoint(PROVIDER_PRESETS[key].endpoint);
      setModel(PROVIDER_PRESETS[key].model);
    }
    setConnectionTest({ status: 'idle', message: '' });
  };

  const abortControllerRef = useRef<AbortController | null>(null);

  // Refs so global event listeners and background handlers always access latest values.
  const stateRef = useRef({
    apiKey,
    endpoint,
    model,
    activeStyle,
    originalText,
    currentScreenshot,
    isGenerating,
    showSettings,
    isPinned,
    readChatScreenshot,
    autoCopyPopup,
    viewMode,
    screenReplyAnalysis,
    handleStartPolish: (_t: string, _s: PolishStyle, _c?: string, _img?: string | null) => {},
    handleStartScreenReplyAnalysis: (_ss: string, _hint?: string) => {},
  });
  stateRef.current.apiKey = apiKey;
  stateRef.current.endpoint = endpoint;
  stateRef.current.model = model;
  stateRef.current.activeStyle = activeStyle;
  stateRef.current.originalText = originalText;
  stateRef.current.currentScreenshot = currentScreenshot;
  stateRef.current.isGenerating = isGenerating;
  stateRef.current.showSettings = showSettings;
  stateRef.current.isPinned = isPinned;
  stateRef.current.readChatScreenshot = readChatScreenshot;
  stateRef.current.autoCopyPopup = autoCopyPopup;
  stateRef.current.screenReplyAnalysis = screenReplyAnalysis;
  stateRef.current.viewMode = viewMode;

  const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  // Show Toast
  const showToast = useCallback((msg: string, durationMs = 2000) => {
    setToastMessage(msg);
    setToastVisible(true);
    setTimeout(() => {
      setToastVisible(false);
    }, durationMs);
  }, []);

  // Helper to read clipboard text in Tauri or Web environment
  const readClipboardText = useCallback(async (): Promise<string> => {
    try {
      if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
        const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
        const t = await readText();
        if (t) return t;
      }
    } catch {
      // fallback
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return '';
      }
    }
    return '';
  }, []);

  const handleAttachClipboard = useCallback(async () => {
    try {
      const text = await readClipboardText();
      if (text && text.trim()) {
        const newFile: AttachedFileContext = {
          name: '剪贴板参考',
          content: text.trim(),
          size: text.length,
        };
        setAttachedFiles((prev) => [...prev, newFile]);
        setClipboardRef(null);
        showToast('📋 已将剪贴板内容作为参考资料附带');
      }
    } catch (e) {
      console.warn('read clipboard failed:', e);
    }
  }, [readClipboardText, showToast]);

  // Trigger Polishing Process
  const handleStartPolish = useCallback(async (
    text: string,
    style: PolishStyle,
    customInstruction?: string,
    screenshotUrl?: string | null
  ) => {
    if (!text || text.trim().length === 0) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const currentSignal = abortController.signal;

    setIsGenerating(true);
    setError(null);
    setPolishedText('');
    setDurationMs(0);
    setTotalTokens(0);

    const currentApiKey = stateRef.current.apiKey || apiKey;
    const currentEndpoint = stateRef.current.endpoint || endpoint;
    const currentModel = stateRef.current.model || model;

    const useScreenshot = Boolean(style === 'reply' && stateRef.current.readChatScreenshot && screenshotUrl);

    if (useScreenshot) {
      adapters.storageProvider.get<boolean>('hasShownVisionNotice', false).then((shown) => {
        if (!shown) {
          showToast('💡 智能回复已启用视觉上下文感知，将基于真实聊天历史生成回复');
          adapters.storageProvider.set('hasShownVisionNotice', true).catch((e) => {
            console.warn('save vision notice state failed:', e);
          });
        }
      }).catch((e) => console.warn('load vision notice state failed:', e));
    }

    const streamConfig: StreamConfig = {
      style,
      userInstruction: customInstruction,
      apiKey: currentApiKey || undefined,
      baseUrl: currentEndpoint || undefined,
      model: currentModel || undefined,
      temperature: 0.7,
      imageDataUrl: useScreenshot ? (screenshotUrl as string) : undefined,
    };

    const runStream = async (config: StreamConfig): Promise<void> => {
      await adapters.llmTransport.streamChat(
        { text, config },
        {
          onChunk: (delta) => {
            if (currentSignal.aborted) return;
            setPolishedText((prev) => prev + delta);
          },
          onDone: (duration, tokens) => {
            if (currentSignal.aborted) return;
            setIsGenerating(false);
            setDurationMs(duration);
            setTotalTokens(tokens);
            if (abortControllerRef.current === abortController) {
              abortControllerRef.current = null;
            }
          },
          onError: async (err) => {
            if (currentSignal.aborted) return;
            // Silent fallback to text-only mode if vision failed or rejected by endpoint
            if (config.imageDataUrl) {
              console.warn('[Vision Fallback] Vision failed, retrying in text-only mode:', err);
              const textOnlyConfig = { ...config, imageDataUrl: undefined };
              try {
                setPolishedText('');
                await runStream(textOnlyConfig);
                return;
              } catch {
                // fall through
              }
            }
            setIsGenerating(false);
            setError(err);
            if (abortControllerRef.current === abortController) {
              abortControllerRef.current = null;
            }
          },
          onAbort: () => {
            if (currentSignal.aborted && abortControllerRef.current === abortController) {
              setIsGenerating(false);
              abortControllerRef.current = null;
            }
          },
        },
        currentSignal
      );
    };

    try {
      await runStream(streamConfig);
    } catch (err: any) {
      if (!currentSignal.aborted) {
        setIsGenerating(false);
        setError(String(err?.message || err));
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    }
  }, [adapters, apiKey, endpoint, model]);

  // Global shortcut and mouse-selection listeners are registered once. Keep the
  // callback they invoke fresh instead of leaving the initial no-op placeholder.
  stateRef.current.handleStartPolish = handleStartPolish;

  // Round 1: Vision Screen Understanding (Output JSON)
  const handleStartScreenReplyAnalysis = useCallback(async (screenshotUrl: string, existingHint?: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const currentSignal = abortController.signal;

    setIsGenerating(true);
    setError(null);
    setPolishedText('正在智能识别屏幕对话上下文...');
    setDurationMs(0);
    setTotalTokens(0);

    const currentApiKey = stateRef.current.apiKey || apiKey;
    const currentEndpoint = stateRef.current.endpoint || endpoint;
    let currentModel = stateRef.current.model || model;

    // Offline / Mock fallback when no API key is set
    if (!currentApiKey) {
      setTimeout(() => {
        if (currentSignal.aborted) return;
        setIsGenerating(false);
        const hint = existingHint?.trim() || '这版方案周五前能交付吗？客户那边在催进度了';
        const mockAnalysis: ScreenReplyAnalysis = {
          conversation: [
            { sender: 'other', text: hint },
            { sender: 'me', text: '正在全力推进中，细节还在核对' },
          ],
          last_message_from_other: hint,
          draft_reply: '周五下班前准时交付，目前核心流程已跑通，请放心！',
          clarify_options: ['积极承诺（周五准时交付）', '委婉缓冲（周五给初稿）', '追问细节（对齐确认清单）'],
        };
        setScreenReplyAnalysis(mockAnalysis);
        setPolishedText(mockAnalysis.draft_reply);
        setOriginalText(mockAnalysis.last_message_from_other);
        stateRef.current.originalText = mockAnalysis.last_message_from_other;
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }, 600);
      return;
    }

    // Auto-select vision model for known providers if a text-only alias is configured
    if (currentEndpoint.includes('bigmodel.cn') && currentModel === 'glm-4-flash') {
      currentModel = 'glm-4v-flash';
    } else if (currentEndpoint.includes('api.openai.com') && !currentModel.includes('gpt-4')) {
      currentModel = 'gpt-4o-mini';
    }

    let rawOutput = '';

    const streamConfig: StreamConfig = {
      style: 'reply',
      customPrompt: buildScreenReplySystemPrompt(),
      apiKey: currentApiKey || undefined,
      baseUrl: currentEndpoint || undefined,
      model: currentModel || undefined,
      temperature: 0.3,
      imageDataUrl: screenshotUrl,
    };

    try {
      await adapters.llmTransport.streamChat(
        { text: buildScreenReplyUserPrompt(), config: streamConfig },
        {
          onChunk: (delta) => {
            if (currentSignal.aborted) return;
            rawOutput += delta;
          },
          onDone: (duration, tokens) => {
            if (currentSignal.aborted) return;
            setIsGenerating(false);
            setDurationMs(duration);
            setTotalTokens(tokens);
            if (abortControllerRef.current === abortController) {
              abortControllerRef.current = null;
            }

            // Parse JSON
            let parsed: ScreenReplyAnalysis | null = null;
            try {
              const cleaned = rawOutput
                .replace(/^```json\s*/i, '')
                .replace(/^```\s*/i, '')
                .replace(/\s*```$/i, '')
                .trim();
              parsed = JSON.parse(cleaned);
            } catch {
              const fallbackMsg = existingHint?.trim() || '对方发来的消息';
              parsed = {
                conversation: [],
                last_message_from_other: fallbackMsg,
                draft_reply: rawOutput.trim(),
                clarify_options: ['更正式一点', '热情答应', '婉言谢绝'],
              };
            }

            if (parsed) {
              setScreenReplyAnalysis(parsed);
              const draft = parsed.draft_reply || rawOutput.trim();
              setPolishedText(draft);
              const targetMsg = parsed.last_message_from_other || existingHint?.trim() || '屏幕聊天历史';
              setOriginalText(targetMsg);
              stateRef.current.originalText = targetMsg;
            }
          },
          onError: async (err) => {
            if (currentSignal.aborted) return;
            console.warn('[Screen Reply] Vision analysis error:', err);
            // Fallback: If endpoint rejects image input (e.g. text-only model),
            // do NOT fake a context-free reply — tell the user the truth and
            // point to the two working paths (vision model / select-text flow).
            if (streamConfig.imageDataUrl) {
              setIsGenerating(false);
              setPolishedText('');
              setScreenReplyAnalysis(null);
              setError(
                '当前模型不支持读图，无法分析聊天窗口。两个办法：① 设置里换视觉模型（如 qwen-vl-plus / glm-4v-flash）；② 选中要回复的消息文字后按快捷键（文本回复）。',
              );
              showToast('当前模型不支持读图，零划词回复需要视觉模型', 4000);
              return;
            }
            setIsGenerating(false);
            setError(`屏幕对话识别失败: ${err}`);
            if (abortControllerRef.current === abortController) {
              abortControllerRef.current = null;
            }
          },
          onAbort: () => {
            if (currentSignal.aborted && abortControllerRef.current === abortController) {
              setIsGenerating(false);
              abortControllerRef.current = null;
            }
          },
        },
        currentSignal
      );
    } catch (e: any) {
      if (!currentSignal.aborted) {
        setIsGenerating(false);
        setError(String(e?.message || e));
      }
    }
  }, [adapters, apiKey, endpoint, model, showToast, handleStartPolish]);

  stateRef.current.handleStartScreenReplyAnalysis = handleStartScreenReplyAnalysis;

  // Round 2: Refine Screen Reply using Conversation Context + Chip / Instruction + Attached Files
  const handleSelectClarifyChip = useCallback((chipText: string) => {
    const analysis = stateRef.current.screenReplyAnalysis;
    const conversation = analysis?.conversation || [];
    let instruction = chipText;
    if (attachedFiles.length > 0) {
      const fileSummaries = attachedFiles
        .map((f) => `【参考文件: ${f.name}】\n${f.content.slice(0, 3000)}`)
        .join('\n\n');
      instruction = `${chipText}\n\n${fileSummaries}`;
    }
    const refinePrompt = buildScreenReplyRefinePrompt(conversation, instruction);
    handleStartPolish(refinePrompt, 'reply', chipText, undefined);
  }, [handleStartPolish, attachedFiles]);

  // Load Saved Settings on Mount
  useEffect(() => {
    const loadConfig = async () => {
      const savedKey = await adapters.storageProvider.get<string>('apiKey', '');
      const savedEndpoint = await adapters.storageProvider.get<string>('endpoint', 'https://api.deepseek.com/v1/chat/completions');
      const savedModel = await adapters.storageProvider.get<string>('model', 'deepseek-chat');
      const savedStyle = await adapters.storageProvider.get<PolishStyle>('defaultStyle', 'academic');
      const savedAutoPopup = await adapters.storageProvider.get<boolean>('autoCopyPopup', false);
      const savedReadScreenshot = await adapters.storageProvider.get<boolean>('readChatScreenshot', true);
      const savedWakeShortcut = await adapters.storageProvider.get<string>('wakeShortcut', DEFAULT_SHORTCUT);
      const savedAutostart = await adapters.storageProvider.get<boolean>('autostart', false);

      if (savedKey) setApiKey(savedKey);
      if (savedEndpoint) setEndpoint(savedEndpoint);
      if (savedModel) setModel(savedModel);
      if (savedStyle) setActiveStyle(savedStyle);
      setAutoCopyPopup(savedAutoPopup);
      stateRef.current.autoCopyPopup = savedAutoPopup;
      const initialMode = savedAutoPopup ? 'panel' : 'capsule';
      setViewMode(initialMode);
      stateRef.current.viewMode = initialMode;
      setReadChatScreenshot(savedReadScreenshot);
      stateRef.current.readChatScreenshot = savedReadScreenshot;
      if (savedWakeShortcut) setWakeShortcut(savedWakeShortcut);
      setAutostart(savedAutostart);

      // Load the persisted global wake shortcut and clipboard monitor state from Rust.
      if (isTauri) {
        let sc = '';
        try {
          sc = await invoke<string>('get_global_shortcut');
          if (sc) {
            setWakeShortcut(sc);
          }
          await invoke('set_clipboard_monitor_enabled', { enabled: savedAutoPopup });
          await invoke('set_selection_monitor_enabled', { enabled: true });
          await invoke('set_auto_popup_enabled', { enabled: savedAutoPopup });
          const autoStartEnabled = await invoke<boolean>('is_autostart_enabled');
          setAutostart(Boolean(autoStartEnabled));
        } catch (e) {
          console.warn('load shortcut/monitor/autostart state failed:', e);
        }

        // First-run onboarding: teach the core loop once (6s so it's readable).
        const onboarded = await adapters.storageProvider.get<boolean>('onboardingDone', false);
        if (!onboarded) {
          showToast(`选中文字后自动润色 → Enter 贴回；${sc || 'Ctrl+Shift+Space'} 可随时唤起`, 6000);
          await adapters.storageProvider.set('onboardingDone', true).catch((e) => {
            console.warn('save onboarding state failed:', e);
          });
        }
      }
    };

    loadConfig().catch((e) => {
      console.warn('load app config failed:', e);
      showToast('配置加载失败，请打开设置重试', 4000);
    });

    // In Tauri, signal that frontend is ready to avoid white flash
    if (isTauri) {
      invoke('app_ready').catch((e) => console.warn('app_ready failed:', e));

      // Listen for selection events from Rust global shortcut or mouse hook
      listen('runbi://captured-selection', (event: any) => {
        setShowEpoch((n) => n + 1); // remount panel container → replay enter animation
        const isSensitiveBlocked = event?.payload?.trigger === 'sensitive-blocked';
        const isScreenReply = event?.payload?.trigger === 'screen-reply' && Boolean(event?.payload?.screenshot);

        if (isSensitiveBlocked) {
          setClipboardRef(null);
        } else {
          readClipboardText().then((clip: string) => {
            const trimmed = clip?.trim();
            if (trimmed && trimmed.length > 5 && (!event?.payload?.text || trimmed !== event.payload.text.trim())) {
              setClipboardRef(trimmed);
            } else {
              setClipboardRef(null);
            }
          }).catch(() => {});
        }

        if (isSensitiveBlocked) {
          setCurrentScreenshot(null);
          setScreenReplyAnalysis(null);
          setOriginalText('');
          stateRef.current.originalText = '';
          setPolishedText('');
          setError(null);
          setViewMode('panel');
          stateRef.current.viewMode = 'panel';
          showToast('已拦截疑似密码或密钥，内容未发送给模型', 4000);
        } else if (isScreenReply && stateRef.current.readChatScreenshot) {
          const screenshot = event.payload.screenshot;
          setCurrentScreenshot(screenshot);
          stateRef.current.currentScreenshot = screenshot;
          setViewMode('panel');
          stateRef.current.viewMode = 'panel';
          setActiveStyle('reply');
          stateRef.current.activeStyle = 'reply';
          const hint = event.payload.text?.trim() || '';
          const previewText = hint ? `对话线索: ${hint}` : '正在分析屏幕对话...';
          setOriginalText(previewText);
          stateRef.current.originalText = previewText;
          setScreenReplyAnalysis(null);
          showToast('💡 已捕获聊天界面，正在识别对话并构思回复...');

          stateRef.current.handleStartScreenReplyAnalysis(screenshot, hint);
        } else if (event?.payload?.text) {
          setScreenReplyAnalysis(null);
          const captured = event.payload.text;
          const screenshot = event.payload.screenshot || null;
          setCurrentScreenshot(screenshot);
          setOriginalText(captured);
          stateRef.current.originalText = captured;
          stateRef.current.currentScreenshot = screenshot;

          // Context auto-sense: multi-dimensional intent detection across all 7 styles
          const cls = classifyContext({
            text: captured,
            sourceApp: event.payload.sourceApp,
            windowTitle: event.payload.windowTitle,
          });
          const targetStyle = cls.style;
          stateRef.current.activeStyle = targetStyle;
          setActiveStyle(targetStyle);

          setViewMode('panel');
          stateRef.current.viewMode = 'panel';
          if (cls.confidence >= 0.7 && targetStyle !== 'polished') {
            showToast(`💡 智能识别【${STYLE_NAMES[targetStyle]}】(${cls.reason})`);
          }
          stateRef.current.handleStartPolish(captured, targetStyle, undefined, screenshot);
        } else if (event?.payload?.trigger === 'shortcut') {
          setViewMode('panel');
          stateRef.current.viewMode = 'panel';
          showToast('未检测到选中文本');
        }
      }).catch((e) => console.warn('listen captured-selection failed:', e));

      // Tray "设置" menu → show window & open the settings form
      listen('runbi://open-settings', () => {
        setViewMode('panel');
        stateRef.current.viewMode = 'panel';
        setShowEpoch((n) => n + 1);
        setShowSettings(true);
      }).catch((e) => console.warn('listen open-settings failed:', e));
    }
  }, [adapters, isTauri]);

  const handleTestConnection = async () => {
    const key = apiKey.trim();
    const targetEndpoint = endpoint.trim();
    const targetModel = model.trim();

    if (!key) {
      setConnectionTest({ status: 'error', message: '请先填写 API Key；留空时仅运行演示模式。' });
      return;
    }
    if (!targetEndpoint || !targetModel) {
      setConnectionTest({ status: 'error', message: '请填写接口地址和模型名称。' });
      return;
    }

    setConnectionTest({ status: 'testing', message: '正在发送最小测试请求…' });
    const result = await adapters.llmTransport.testConnection({
      style: activeStyle,
      apiKey: key,
      baseUrl: targetEndpoint,
      model: targetModel,
    });

    if (result.success) {
      const latency = typeof result.latencyMs === 'number' ? ` · ${result.latencyMs} ms` : '';
      setConnectionTest({ status: 'success', message: `连接成功${latency}` });
    } else {
      const reason = (result.error || '请检查密钥、地址与模型名称').replace(/\s+/g, ' ').slice(0, 180);
      setConnectionTest({ status: 'error', message: `连接失败：${reason}` });
    }
  };

  // Save Settings
  const handleSaveSettings = async () => {
    if (isSavingSettings) return;
    setIsSavingSettings(true);
    const sc = wakeShortcut.trim() || DEFAULT_SHORTCUT;
    try {
      const saveConfig = adapters.storageProvider.setMany({
        apiKey: apiKey.trim(),
        endpoint: endpoint.trim(),
        model: model.trim(),
        defaultStyle: activeStyle,
        autoCopyPopup,
        readChatScreenshot,
        autostart,
        wakeShortcut: sc,
      });

      if (isTauri) {
        await Promise.all([
          saveConfig,
          invoke('set_selection_monitor_enabled', { enabled: true }),
          invoke('set_auto_popup_enabled', { enabled: autoCopyPopup }),
          invoke('set_clipboard_monitor_enabled', { enabled: autoCopyPopup }),
          invoke('set_autostart', { enabled: autostart }),
          invoke('set_global_shortcut', { shortcut: sc }),
        ]);
      } else {
        await saveConfig;
      }

      stateRef.current.autoCopyPopup = autoCopyPopup;
      stateRef.current.readChatScreenshot = readChatScreenshot;
      setShowSettings(false);
      showToast('设置已安全保存并即时生效');
    } catch (e) {
      showToast(`保存失败：${String(e)}`, 4000);
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Record a new global wake shortcut from the next key combination pressed.
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setRecording(false); return; }
      // Modifier keys alone are not a complete shortcut — keep waiting for the real key.
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Super');
      let k = e.key;
      if (k === ' ') k = 'Space';
      else if (k.length === 1) k = k.toUpperCase();
      // Require at least one modifier so we don't swallow a plain letter globally.
      if (parts.length > 0 && k !== 'Dead' && k !== 'Unidentified') {
        parts.push(k);
        setWakeShortcut(parts.join('+'));
      }
      setRecording(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording]);

  // Stop Generation
  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
  };

  // Regenerate
  const handleRegenerate = () => {
    handleStartPolish(originalText, activeStyle, undefined, currentScreenshot);
  };

  // Style Change
  const handleStyleChange = (newStyle: PolishStyle) => {
    setActiveStyle(newStyle);
    handleStartPolish(originalText, newStyle, undefined, currentScreenshot);
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
    const shouldHide = !stateRef.current.isPinned;
    const res = await (adapters.textReplacer as any).replaceText(textToInsert, null, shouldHide);
    if (res.success) {
      setAttachedFiles([]);
      setClipboardRef(null);
      showToast(stateRef.current.isPinned ? '已贴回原文 (窗口保持置顶)' : '已贴回原文');
      if (shouldHide) {
        const nextMode = stateRef.current.autoCopyPopup ? 'panel' : 'capsule';
        setViewMode(nextMode);
        stateRef.current.viewMode = nextMode;
      }
    } else if (res.fallbackCopied) {
      // Pasting failed but the text IS on the clipboard — keep the panel open
      // and tell the truth about what happened.
      showToast('贴回失败，已复制到剪贴板，Ctrl+V 粘贴即可', 3500);
    } else {
      showToast(res.error || '替换失败', 3500);
    }
  };

  // Close / Hide Window
  const handleClose = () => {
    if (stateRef.current.isPinned) {
      showToast('窗口已置顶锁定，请先取消置顶');
      return;
    }
    setAttachedFiles([]);
    setClipboardRef(null);
    const nextMode = stateRef.current.autoCopyPopup ? 'panel' : 'capsule';
    setViewMode(nextMode);
    stateRef.current.viewMode = nextMode;
    if (isTauri) {
      // Play the exit animation first, then hide (fallback hides immediately).
      const el = document.querySelector('.runbi-window');
      if (el) {
        el.classList.add('runbi-exit');
        setTimeout(() => {
          invoke('hide_window').catch((e) => console.warn('hide_window failed:', e));
          el.classList.remove('runbi-exit');
        }, 120);
      } else {
        invoke('hide_window').catch((e) => console.warn('hide_window failed:', e));
      }
    }
  };

  // Toggle Pin on Top
  const handleTogglePin = async () => {
    const nextPinned = !isPinned;
    setIsPinned(nextPinned);
    if (isTauri) {
      try {
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
      let screenshot: string | null = null;
      if (stateRef.current.readChatScreenshot && isTauri) {
        screenshot = await invoke<string>('capture_foreground_screenshot').catch(() => null);
      }
      setCurrentScreenshot(screenshot);

      setOriginalText(sel.text);
      const cls = classifyContext({
        text: sel.text,
        sourceApp: sel.sourceApp,
        windowTitle: sel.windowTitle,
      });
      const targetStyle = cls.style;
      if (cls.confidence >= 0.7 && targetStyle !== 'polished') {
        showToast(`💡 智能识别【${STYLE_NAMES[targetStyle]}】(${cls.reason})`);
      } else {
        showToast('已获取剪贴板内容');
      }
      stateRef.current.activeStyle = targetStyle;
      setActiveStyle(targetStyle);
      handleStartPolish(sel.text, targetStyle, undefined, screenshot);
    } else {
      showToast('剪贴板中未检测到有效文本');
    }
  };

  // ---- Keyboard Flow: Enter paste-back+hide, Esc close; Tab remains native for accessibility ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = stateRef.current;

      // While typing in an input/textarea, let the field own Enter.
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        e.preventDefault();
        if (s.showSettings) {
          setShowSettings(false);
          return;
        }
        if (s.isGenerating) {
          abortControllerRef.current?.abort();
          setIsGenerating(false);
          showToast('已停止生成');
          return;
        }
        if (s.isPinned) {
          showToast('窗口已置顶锁定 (按 Esc 不隐藏)');
          return;
        }
        handleClose();
        return;
      }

      // Don't hijack keys while the user is editing a field or in settings.
      if (typing || s.showSettings) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        if (s.isGenerating) {
          abortControllerRef.current?.abort();
        } else {
          handleReplace();
        }
        return;
      }

    };

    const onBlur = () => {
      const s = stateRef.current;
      // Raycast behavior: hide whenever focus leaves, unless pinned / generating /
      // in settings / showing screen-reply analysis (user may peek at the chat).
      if (!s.isPinned && !s.isGenerating && !s.showSettings && !s.screenReplyAnalysis) {
        if (isTauri) {
          invoke('hide_window').catch(() => {});
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [handleReplace, handleStyleChange, isTauri]);

  if (viewMode === 'capsule') {
    return (
      <div className="w-screen h-screen flex justify-start items-start p-1 bg-transparent select-none overflow-hidden">
        <button
          id="runbi-trigger-capsule"
          type="button"
          aria-label="打开润笔面板"
          onClick={async () => {
            setShowEpoch((n) => n + 1);
            setViewMode('panel');
            stateRef.current.viewMode = 'panel';
            if (isTauri) {
              await invoke('position_window_at_cursor', { isCapsule: false }).catch(() => {});
            }
            const captured = stateRef.current.originalText;
            const targetStyle = stateRef.current.activeStyle;
            stateRef.current.handleStartPolish(captured, targetStyle, undefined, stateRef.current.currentScreenshot);
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          className="runbi-focus-ring flex h-9 w-9 cursor-pointer select-none items-center justify-center rounded-full border border-teal-100/60 bg-teal-500 text-white shadow-[0_4px_16px_rgba(0,191,165,0.58)] transition-all duration-150 ease-out hover:scale-105 hover:bg-teal-400 hover:shadow-[0_6px_22px_rgba(0,191,165,0.72)] active:scale-95"
          title="点击展开润笔润色"
        >
          <RunbiLogo className="w-5 h-5 text-white drop-shadow-sm" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-start overflow-hidden bg-transparent p-3 font-sans select-none">
      {/* Raycast Container (keyed by showEpoch so enter animation replays on each summon) */}
      <div key={showEpoch} className="runbi-window runbi-enter flex h-full min-h-0 w-full max-w-[540px] flex-col overflow-hidden rounded-2xl backdrop-blur-xl">
        
        {/* Title & Drag Region */}
        <div
          data-tauri-drag-region
          className="flex shrink-0 items-center justify-between border-b border-white/10 bg-black/20 px-3 py-2 cursor-grab active:cursor-grabbing"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-teal-500/30 bg-teal-500/15 text-teal-300 shadow-[0_0_12px_rgba(45,212,191,0.16)]">
              <RunbiLogo className="h-4 w-4" />
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleTogglePin}
              aria-label={isPinned ? '取消置顶' : '始终置顶'}
              aria-pressed={isPinned}
              title={isPinned ? '取消置顶' : '始终置顶'}
              className={`runbi-icon-button ${
                isPinned ? 'bg-teal-500/10 !text-teal-300' : ''
              }`}
            >
              {isPinned ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => setShowSettings(!showSettings)}
              aria-label={showSettings ? '返回润色面板' : '打开设置'}
              aria-pressed={showSettings}
              title="设置"
              className={`runbi-icon-button ${
                showSettings ? 'bg-teal-500/10 !text-teal-300' : ''
              }`}
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              id="close-btn"
              type="button"
              onClick={handleClose}
              aria-label={isPinned ? '窗口已置顶，暂时无法关闭' : '关闭窗口'}
              title={isPinned ? '窗口已置顶锁定 (请先取消置顶)' : '关闭 (Esc)'}
              className={`runbi-icon-button ${
                isPinned ? '!text-slate-600' : 'hover:!bg-rose-500/10 hover:!text-rose-300'
              }`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Settings Modal Body */}
        {showSettings ? (
          <form
            id="runbi-settings-panel"
            className="flex min-h-0 flex-1 flex-col bg-[var(--runbi-panel-bg)] text-xs text-slate-200"
            onSubmit={(event) => {
              event.preventDefault();
              handleSaveSettings();
            }}
          >
            <div className="runbi-settings-scroll min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <div className="flex items-start justify-between border-b border-white/10 pb-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">设置</h2>
                  <p className="mt-0.5 text-[10px] text-slate-400">模型连接与桌面行为</p>
                </div>
                <span className="rounded-full border border-teal-400/20 bg-teal-400/10 px-2 py-1 text-[10px] font-medium text-teal-300">
                  BYOK · 本地保存
                </span>
              </div>

              <section aria-labelledby="model-settings-title" className="space-y-3">
                <h3 id="model-settings-title" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  模型服务
                </h3>

                <div className="space-y-1.5">
                  <label htmlFor="provider-preset" className="block font-medium text-slate-300">服务商</label>
                  <select
                    id="provider-preset"
                    value={getProviderPreset(endpoint, model)}
                    onChange={(e) => handleSelectPreset(e.target.value)}
                    className="runbi-form-control cursor-pointer"
                  >
                    <option value="deepseek">DeepSeek</option>
                    <option value="zhipu">智谱 glm-4</option>
                    <option value="openai">OpenAI</option>
                    <option value="custom">自定义</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="api-key" className="block font-medium text-slate-300">API Key</label>
                  <input
                    id="api-key"
                    type="password"
                    autoComplete="off"
                    placeholder="输入服务商 API Key"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setConnectionTest({ status: 'idle', message: '' });
                    }}
                    aria-describedby="api-key-help"
                    className="runbi-form-control font-mono"
                  />
                  <p id="api-key-help" className="text-[10px] leading-relaxed text-slate-500">
                    使用 Windows 加密后仅保存在本机；留空可体验演示模式。
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="api-endpoint" className="block font-medium text-slate-300">API Endpoint</label>
                  <input
                    id="api-endpoint"
                    type="url"
                    required
                    value={endpoint}
                    onChange={(e) => {
                      setEndpoint(e.target.value);
                      setConnectionTest({ status: 'idle', message: '' });
                    }}
                    className="runbi-form-control font-mono"
                  />
                  {endpoint && endpoint.trim().startsWith('http://') && !endpoint.includes('localhost') && !endpoint.includes('127.0.0.1') && (
                    <p role="alert" className="text-[10px] leading-relaxed text-amber-300">远程地址使用明文 HTTP，API Key 与文本可能被窃听，建议改用 HTTPS。</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="model-name" className="block font-medium text-slate-300">模型名称</label>
                  <input
                    id="model-name"
                    type="text"
                    required
                    value={model}
                    onChange={(e) => {
                      setModel(e.target.value);
                      setConnectionTest({ status: 'idle', message: '' });
                    }}
                    className="runbi-form-control font-mono"
                  />
                </div>

                <div className="runbi-settings-card flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0" aria-live="polite">
                    <p className="font-medium text-slate-200">连接检查</p>
                    <p className={`mt-0.5 break-words text-[10px] leading-relaxed ${
                      connectionTest.status === 'success'
                        ? 'text-emerald-300'
                        : connectionTest.status === 'error'
                          ? 'text-rose-300'
                          : 'text-slate-500'
                    }`}>
                      {connectionTest.message || '保存前验证密钥、地址与模型是否可用。'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={connectionTest.status === 'testing'}
                    className="runbi-secondary-button runbi-focus-ring shrink-0"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${connectionTest.status === 'testing' ? 'animate-spin' : ''}`} />
                    {connectionTest.status === 'testing' ? '测试中' : '测试连接'}
                  </button>
                </div>
              </section>

              <section aria-labelledby="desktop-settings-title" className="space-y-2.5 border-t border-white/10 pt-4">
                <h3 id="desktop-settings-title" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  桌面体验
                </h3>

                <div className="space-y-1.5">
                  <label className="block font-medium text-slate-300">全局唤醒快捷键</label>
                  <button
                    type="button"
                    onClick={() => setRecording(true)}
                    aria-pressed={recording}
                    className={`runbi-form-control runbi-focus-ring text-left font-mono ${
                      recording ? 'border-teal-400 bg-teal-500/15 text-teal-200' : ''
                    }`}
                  >
                    {recording ? '请按新的组合键…（Esc 取消）' : wakeShortcut}
                  </button>
                  <p className="text-[10px] text-slate-500">需包含 Ctrl、Alt 或 Shift，保存后即时生效。</p>
                </div>

                <SettingsToggle
                  label="复制后自动唤起"
                  description="监控剪贴板中的新文本，并直接开始润色。"
                  checked={autoCopyPopup}
                  onChange={setAutoCopyPopup}
                />
                <SettingsToggle
                  label="开机自动启动"
                  description="在系统托盘静默待命，不主动打扰。"
                  checked={autostart}
                  onChange={setAutostart}
                />
                <SettingsToggle
                  label="读取聊天上下文截图"
                  description="仅在智能回复模式下理解当前聊天窗口。"
                  checked={readChatScreenshot}
                  onChange={setReadChatScreenshot}
                />
              </section>
            </div>

            <div className="flex shrink-0 items-center justify-between border-t border-white/10 bg-black/20 px-4 py-3">
              <span className="text-[10px] text-slate-500">Esc 取消</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowSettings(false)}
                  className="runbi-focus-ring rounded-lg px-3 py-2 font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSavingSettings}
                  className="runbi-primary-button runbi-focus-ring"
                >
                  {isSavingSettings && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                  {isSavingSettings ? '保存中…' : '保存设置'}
                </button>
              </div>
            </div>
          </form>
        ) : (
          /* Main Polish Panel Component */
          <PolishPanel
            embedded
            className="min-h-0 flex-1"
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
            showOriginalPreview={!screenReplyAnalysis}
            screenReplyAnalysis={screenReplyAnalysis}
            onSelectClarifyChip={handleSelectClarifyChip}
            onClose={handleClose}
            onStyleChange={handleStyleChange}
            onToggleDiff={() => setIsDiffMode(!isDiffMode)}
            onStop={handleStop}
            onRegenerate={handleRegenerate}
            onCopy={handleCopy}
            onReplace={handleReplace}
            attachedFiles={attachedFiles}
            onAttachFile={(f) => setAttachedFiles((prev) => [...prev, f])}
            onRemoveFile={(idx) => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
            clipboardReference={clipboardRef}
            onAttachClipboard={handleAttachClipboard}
            onSendInstruction={(inst, files) => {
              const allFiles = files || attachedFiles;
              let customPrompt = inst;
              if (allFiles && allFiles.length > 0) {
                const fileSummaries = allFiles
                  .map((f) => `【参考文件: ${f.name}】\n${f.content.slice(0, 3000)}`)
                  .join('\n\n');
                customPrompt = `${inst}\n\n${fileSummaries}`;
              }
              if (screenReplyAnalysis) {
                const conversation = screenReplyAnalysis.conversation || [];
                const refinePrompt = buildScreenReplyRefinePrompt(conversation, customPrompt);
                handleStartPolish(refinePrompt, 'reply', inst, undefined);
              } else {
                handleStartPolish(originalText, activeStyle, customPrompt);
              }
            }}
            onToastDismiss={() => setToastVisible(false)}
            onManualGrab={handleManualGrab}
            replaceLabel="贴回"
          />
        )}

      </div>
    </div>
  );
};

export default App;
