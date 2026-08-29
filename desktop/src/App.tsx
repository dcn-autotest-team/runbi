/**
 * @file desktop/src/App.tsx
 * Runbi Desktop Client - Raycast-like AI Text Polishing Assistant
 * Powered by Tauri 2.x + React 18 + Tailwind CSS + @runbi/shared
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { PolishStyle, StreamConfig, PersonaType, HistoryRecord, DraftSnapshot, LastReplacementSnapshot } from '@runbi/shared/types';
import { PERSONA_PRESETS } from '@runbi/shared/types';
import { PolishPanel, HistoryDrawer, Toast, type AttachedFileContext } from '@runbi/shared/components';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readText as readClipboard } from '@tauri-apps/plugin-clipboard-manager';
import { createDesktopAdapters } from './adapters';

// ---- Boot + crash diagnostics (writes to runbi.log via Rust) ----
// The desktop App.tsx is not covered by unit tests, so a runtime crash here
// would previously white-screen silently. These lines make it observable.
invoke('append_log', { msg: 'frontend module loaded' }).catch(() => {});
window.addEventListener('error', (e) => {
  invoke('append_log', { msg: `js error: ${e.message} @${e.filename}:${e.lineno}:${e.colno}` }).catch(() => {});
});
window.addEventListener('unhandledrejection', (e) => {
  invoke('append_log', { msg: `unhandled rejection: ${String((e as PromiseRejectionEvent).reason).slice(0, 300)}` }).catch(() => {});
});
import {
  classifyContext,
  isScreenReplyPayload,
  buildScreenReplySystemPrompt,
  buildScreenReplyUserPrompt,
  buildScreenReplyRefinePrompt,
  buildTextReplySystemPrompt,
  buildTextReplyUserPrompt,
  type ScreenReplyAnalysis,
} from '@runbi/shared/core';
import { RunbiLogo, Settings, X, Pin, PinOff, RefreshCw, History } from './components/Icons';
import { OnboardingView } from './components/OnboardingView';

const UpdateCheckRow = React.lazy(() =>
  import('./components/UpdateCheckRow').then((module) => ({ default: module.UpdateCheckRow }))
);

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
  // Feedback — user-facing problem report (opt-in telemetry gate)
  const [feedbackText, setFeedbackText] = useState<string>('');
  const [feedbackSending, setFeedbackSending] = useState<boolean>(false);
  const [connectionTest, setConnectionTest] = useState<{
    status: 'idle' | 'testing' | 'success' | 'error';
    message: string;
  }>({ status: 'idle', message: '' });
  const [currentScreenshot, setCurrentScreenshot] = useState<string | null>(null);
  const [screenReplyAnalysis, setScreenReplyAnalysis] = useState<ScreenReplyAnalysis | null>(null);
  const [showEpoch, setShowEpoch] = useState<number>(0);
  const [persona, setPersona] = useState<PersonaType>('standard');
  const [customPersonaPrompt, setCustomPersonaPrompt] = useState<string>('');
  const [glitchtipDsn, setGlitchtipDsn] = useState<string>('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFileContext[]>([]);
  const [clipboardRef, setClipboardRef] = useState<string | null>(null);

  // Data Safety & Fault Tolerance State
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<'model' | 'desktop' | 'persona'>('model');
  const [recoverableDraft, setRecoverableDraft] = useState<DraftSnapshot | null>(null);
  const [lastReplacement, setLastReplacement] = useState<LastReplacementSnapshot | null>(null);
  const persistedNativeSettingsRef = useRef<{
    autoCopyPopup: boolean;
    autostart: boolean;
    wakeShortcut: string;
  } | null>(null);

  const activePersonaPrompt = useMemo(() => {
    if (persona === 'custom') {
      return customPersonaPrompt.trim();
    }
    const preset = PERSONA_PRESETS.find((p) => p.id === persona);
    return preset && preset.id !== 'standard' ? preset.prompt : '';
  }, [persona, customPersonaPrompt]);

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
    hasScreenshot: false,
    isGenerating,
    showSettings,
    showHistory,
    isPinned,
    readChatScreenshot,
    autoCopyPopup,
    screenReplyAnalysis,
    handleStartPolish: (_t: string, _s: PolishStyle, _c?: string, _img?: string | null) => {},
    handleStartScreenReplyAnalysis: (_hint?: string) => {},
    handleStartTextReplyAnalysis: (_msg: string) => {},
  });
  stateRef.current.apiKey = apiKey;
  stateRef.current.endpoint = endpoint;
  stateRef.current.model = model;
  stateRef.current.activeStyle = activeStyle;
  stateRef.current.originalText = originalText;
  stateRef.current.currentScreenshot = currentScreenshot;
  stateRef.current.isGenerating = isGenerating;
  stateRef.current.showSettings = showSettings;
  stateRef.current.showHistory = showHistory;
  stateRef.current.isPinned = isPinned;
  stateRef.current.readChatScreenshot = readChatScreenshot;
  stateRef.current.autoCopyPopup = autoCopyPopup;
  stateRef.current.screenReplyAnalysis = screenReplyAnalysis;

  const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  // Show Toast
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, durationMs = 2000) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    setToastVisible(true);
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
      toastTimerRef.current = null;
    }, durationMs);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  // History & Draft Operations
  const addHistoryRecord = useCallback(
    (record: Omit<HistoryRecord, 'id' | 'timestamp'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newEntry: HistoryRecord = {
        ...record,
        id,
        timestamp: Date.now(),
      };
      setHistory((prev) => {
        if (prev.length > 0 && prev[0].polishedText.trim() === record.polishedText.trim()) {
          return prev;
        }
        const filtered = prev.filter((item) => item.polishedText.trim() !== record.polishedText.trim());
        const updated = [newEntry, ...filtered].slice(0, 100);
        adapters.storageProvider.set('generationHistory', updated).catch(() => {});
        return updated;
      });
    },
    [adapters.storageProvider]
  );

  const deleteHistoryRecord = useCallback(
    (id: string) => {
      setHistory((prev) => {
        const updated = prev.filter((item) => item.id !== id);
        adapters.storageProvider.set('generationHistory', updated).catch(() => {});
        return updated;
      });
    },
    [adapters.storageProvider]
  );

  const clearAllHistory = useCallback(() => {
    setHistory([]);
    adapters.storageProvider.set('generationHistory', []).catch(() => {});
  }, [adapters.storageProvider]);

  // Revert Last In-Place Replacement (Undo capability)
  const handleRevertReplace = useCallback(async () => {
    if (!lastReplacement) return;
    const res = await (adapters.textReplacer as any).replaceText(lastReplacement.originalText, null, false);
    if (res.success) {
      showToast('已撤回，已将原文恢复贴回目标应用');
      setLastReplacement(null);
    } else {
      await adapters.textReplacer.copyToClipboard(lastReplacement.originalText);
      showToast('撤回完成，原文已写入剪贴板 (Ctrl+V 可粘贴)', 3000);
    }
  }, [adapters.textReplacer, lastReplacement, showToast]);

  // Helper to read clipboard text in Tauri or Web environment
  const readClipboardText = useCallback(async (): Promise<string> => {
    try {
      if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
        const t = await readClipboard();
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

    const useScreenshot = Boolean(style === 'reply' && stateRef.current.readChatScreenshot && (screenshotUrl || stateRef.current.hasScreenshot));

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
      personaPrompt: activePersonaPrompt || undefined,
      apiKey: currentApiKey || undefined,
      baseUrl: currentEndpoint || undefined,
      model: currentModel || undefined,
      temperature: 0.7,
      imageDataUrl: useScreenshot ? (screenshotUrl as string) : undefined,
      useLastScreenshot: useScreenshot && !screenshotUrl,
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
            setPolishedText((finalText) => {
              if (finalText && finalText.trim()) {
                addHistoryRecord({
                  originalText: text,
                  polishedText: finalText.trim(),
                  style,
                  instruction: customInstruction,
                  model: config.model,
                  tokens,
                  durationMs: duration,
                });
              }
              return finalText;
            });
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
  const handleStartScreenReplyAnalysis = useCallback(async (existingHint?: string) => {
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
    } else if (currentEndpoint.includes('api.deepseek.com')) {
      // DeepSeek models accept no image input: the screenshot would be
      // silently dropped by the fallback path. Skip vision entirely and tell
      // the user once, instead of pretending screen understanding happened.
      showToast('当前 DeepSeek 模型不支持读屏，已切换为文本智能回复（在设置中更换模型可启用视觉）', 4000);
      stateRef.current.handleStartTextReplyAnalysis(existingHint?.trim() || '');
      return;
    }

    let rawOutput = '';

    const streamConfig: StreamConfig = {
      style: 'reply',
      customPrompt: buildScreenReplySystemPrompt(activePersonaPrompt),
      apiKey: currentApiKey || undefined,
      baseUrl: currentEndpoint || undefined,
      model: currentModel || undefined,
      temperature: 0.3,
      useLastScreenshot: true,
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

            // Parse JSON (strip qwen-style <think> reasoning blocks first)
            const noThink = rawOutput.replace(/<think>[\s\S]*?<\/think>\s*/gi, '');
            let parsed: ScreenReplyAnalysis | null = null;
            try {
              const cleaned = noThink
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
                draft_reply: noThink.trim(),
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
              if (draft) {
                addHistoryRecord({
                  originalText: targetMsg,
                  polishedText: draft,
                  style: 'reply',
                  model: streamConfig.model,
                  tokens,
                  durationMs: duration,
                });
              }
            }
          },
          onError: async (err) => {
            if (currentSignal.aborted) return;
            console.warn('[Screen Reply] Vision analysis error:', err);
            // Fallback: If endpoint rejects image input (e.g. text-only model),
            // seamlessly fallback to structured text reply analysis!
            if (streamConfig.useLastScreenshot || streamConfig.imageDataUrl) {
              const fallbackMsg = existingHint?.trim() || '对方发来的消息';
              showToast('💡 当前模型不支持直接读图，已切换为文本智能回复', 3000);
              stateRef.current.handleStartTextReplyAnalysis(fallbackMsg);
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

  // Structured Text-based Reply Analysis (Output JSON for selected chat messages)
  const handleStartTextReplyAnalysis = useCallback(async (messageText: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const currentSignal = abortController.signal;

    setIsGenerating(true);
    setError(null);
    setPolishedText('正在针对消息构思高情商回复建议...');
    setDurationMs(0);
    setTotalTokens(0);

    const currentApiKey = stateRef.current.apiKey || apiKey;
    const currentEndpoint = stateRef.current.endpoint || endpoint;
    const currentModel = stateRef.current.model || model;

    // Offline / Mock fallback
    if (!currentApiKey) {
      setTimeout(() => {
        if (currentSignal.aborted) return;
        setIsGenerating(false);
        const targetMsg = messageText.trim() || '这版方案周五前能交付吗？';
        const mockAnalysis: ScreenReplyAnalysis = {
          conversation: [{ sender: 'other', text: targetMsg }],
          last_message_from_other: targetMsg,
          draft_reply: `收到，关于“${targetMsg.slice(0, 15)}...”，我这边会全力推进落实，稍后同步最新进展！`,
          clarify_options: ['积极推进（全力落实）', '严谨对齐（确认排期）', '委婉缓冲（稍后答复）'],
        };
        setScreenReplyAnalysis(mockAnalysis);
        setPolishedText(mockAnalysis.draft_reply);
        setOriginalText(targetMsg);
        stateRef.current.originalText = targetMsg;
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }, 500);
      return;
    }

    let rawOutput = '';
    const streamConfig: StreamConfig = {
      style: 'reply',
      customPrompt: buildTextReplySystemPrompt(activePersonaPrompt),
      apiKey: currentApiKey || undefined,
      baseUrl: currentEndpoint || undefined,
      model: currentModel || undefined,
      temperature: 0.4,
    };

    try {
      await adapters.llmTransport.streamChat(
        { text: buildTextReplyUserPrompt(messageText), config: streamConfig },
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

            let parsed: ScreenReplyAnalysis | null = null;
            try {
              const cleaned = rawOutput
                .replace(/^```json\s*/i, '')
                .replace(/^```\s*/i, '')
                .replace(/\s*```$/i, '')
                .trim();
              parsed = JSON.parse(cleaned);
            } catch {
              parsed = {
                conversation: [{ sender: 'other', text: messageText }],
                last_message_from_other: messageText,
                draft_reply: rawOutput.trim(),
                clarify_options: ['积极推进/正面答复', '严谨对齐/确认细节', '委婉缓冲/礼貌借过'],
              };
            }

            if (parsed) {
              setScreenReplyAnalysis(parsed);
              const draft = parsed.draft_reply || rawOutput.trim();
              setPolishedText(draft);
              const targetMsg = parsed.last_message_from_other || messageText;
              setOriginalText(targetMsg);
              stateRef.current.originalText = targetMsg;
              if (draft) {
                addHistoryRecord({
                  originalText: targetMsg,
                  polishedText: draft,
                  style: 'reply',
                  model: streamConfig.model,
                  tokens,
                  durationMs: duration,
                });
              }
            }
          },
          onError: (err) => {
            if (currentSignal.aborted) return;
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
    } catch (e: any) {
      if (!currentSignal.aborted) {
        setIsGenerating(false);
        setError(String(e?.message || e));
      }
    }
  }, [adapters, apiKey, endpoint, model]);

  stateRef.current.handleStartTextReplyAnalysis = handleStartTextReplyAnalysis;

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
    const refinePrompt = buildScreenReplyRefinePrompt(conversation, instruction, activePersonaPrompt);
    handleStartPolish(refinePrompt, 'reply', chipText, undefined);
  }, [handleStartPolish, attachedFiles, activePersonaPrompt]);

  // Load Saved Settings on Mount
  useEffect(() => {
    const loadConfig = async () => {
      const config = await adapters.storageProvider.getAll();
      const savedKey = String(config.apiKey || '');
      const savedEndpoint = String(config.endpoint || 'https://api.deepseek.com/v1/chat/completions');
      const savedModel = String(config.model || 'deepseek-chat');
      const savedStyle = (config.defaultStyle || 'academic') as PolishStyle;
      const savedAutoPopup = Boolean(config.autoCopyPopup ?? false);
      const savedReadScreenshot = Boolean(config.readChatScreenshot ?? true);
      const savedWakeShortcut = String(config.wakeShortcut || DEFAULT_SHORTCUT);
      const savedAutostart = Boolean(config.autostart ?? false);
      const savedPersona = (config.persona || 'standard') as PersonaType;
      const savedCustomPersona = String(config.customPersonaPrompt || '');
      const rawDsn = String(config.glitchtipDsn || '');
      const savedDsn = rawDsn.includes('@localhost:3000/1') ? '' : rawDsn;

      if (savedKey) setApiKey(savedKey);
      if (savedEndpoint) setEndpoint(savedEndpoint);
      if (savedModel) setModel(savedModel);
      if (savedStyle) setActiveStyle(savedStyle);
      if (savedPersona) setPersona(savedPersona);
      if (savedCustomPersona) setCustomPersonaPrompt(savedCustomPersona);
      if (savedDsn) setGlitchtipDsn(savedDsn);

      const savedHistory = (config.generationHistory || []) as HistoryRecord[];
      if (Array.isArray(savedHistory)) setHistory(savedHistory);

      const savedDraft = (config.activeDraft || null) as DraftSnapshot | null;
      if (savedDraft && savedDraft.timestamp && Date.now() - savedDraft.timestamp < 15 * 60 * 1000) {
        if (savedDraft.polishedText || savedDraft.originalText) {
          setRecoverableDraft(savedDraft);
        }
      }

      setAutoCopyPopup(savedAutoPopup);
      stateRef.current.autoCopyPopup = savedAutoPopup;
      setReadChatScreenshot(savedReadScreenshot);
      stateRef.current.readChatScreenshot = savedReadScreenshot;
      if (savedWakeShortcut) setWakeShortcut(savedWakeShortcut);
      setAutostart(savedAutostart);
      persistedNativeSettingsRef.current = {
        autoCopyPopup: savedAutoPopup,
        autostart: savedAutostart,
        wakeShortcut: savedWakeShortcut,
      };

      if (rawDsn && !savedDsn) {
        adapters.storageProvider.set('glitchtipDsn', '').catch(() => {});
      }

      // Load the persisted global wake shortcut and clipboard monitor state from Rust.
      if (isTauri) {
        try {
          const [sc] = await Promise.all([
            invoke<string>('get_global_shortcut'),
            savedAutoPopup
              ? Promise.all([
                  invoke('set_auto_popup_enabled', { enabled: true }),
                  invoke('set_clipboard_monitor_enabled', { enabled: true }),
                ])
              : Promise.resolve(false),
          ]);
          if (sc) {
            setWakeShortcut(sc);
            persistedNativeSettingsRef.current.wakeShortcut = sc;
          }
        } catch (e) {
          console.warn('load shortcut/monitor/autostart state failed:', e);
        }

        // First-run onboarding: if not yet onboarded, show the micro-onboarding view
        const onboarded = Boolean(config.onboardingDone ?? false);
        if (!onboarded) {
          setShowOnboarding(true);
        }
      }
    };

    loadConfig().catch((e) => {
      console.warn('load app config failed:', e);
      showToast('配置加载载入失败，请打开设置重试', 4000);
    });
  }, [adapters.storageProvider, isTauri, showToast]);

  // Auto-save active draft to prevent accidental loss on close or crash
  useEffect(() => {
    if (isGenerating) return;
    if (!originalText.trim() && !polishedText.trim()) return;
    const timer = setTimeout(() => {
      adapters.storageProvider.set('activeDraft', {
        timestamp: Date.now(),
        originalText,
        polishedText,
        activeStyle,
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [originalText, polishedText, activeStyle, isGenerating, adapters.storageProvider]);

  useEffect(() => {
    // In Tauri, signal that frontend is ready to avoid white flash
    if (isTauri) {
      invoke('app_ready').catch((e) => console.warn('app_ready failed:', e));

      // Listen for selection events from Rust global shortcut or mouse hook
      const unlistens: Array<Promise<(() => void) | undefined>> = [];
      unlistens.push(listen('runbi://captured-selection', (event: any) => {
        const __p = event?.payload || {};
        invoke('append_log', { msg: `frontend: event received t=${__p.trigger} hs=${__p.hasScreenshot} keys=[${Object.keys(__p).join(',')}] text=${String(__p.text || '').slice(0, 24)}` }).catch(() => {});
        setShowOnboarding(false);
        setShowSettings(false);
        setShowHistory(false);
        adapters.storageProvider.set('onboardingDone', true).catch(() => {});
        setShowEpoch((n) => n + 1); // remount panel container → replay enter animation
        invoke('append_log', { msg: 'frontend: epoch bumped' }).catch(() => {});
        const isSensitiveBlocked = event?.payload?.trigger === 'sensitive-blocked';
        const isScreenReply = isScreenReplyPayload(event?.payload);
        stateRef.current.hasScreenshot = isScreenReply;
        invoke('append_log', { msg: `frontend: flags computed sr=${isScreenReply} sens=${isSensitiveBlocked} rcs=${stateRef.current.readChatScreenshot}` }).catch(() => {});

        if (isSensitiveBlocked) {
          setClipboardRef(null);
        } else {
          // No silent clipboard injection: the user can't judge whether stale
          // clipboard text is valid context. Explicit attach buttons remain.
          setClipboardRef(null);
        }

        if (isSensitiveBlocked) {
          setCurrentScreenshot(null);
          setScreenReplyAnalysis(null);
          setOriginalText('');
          stateRef.current.originalText = '';
          setPolishedText('');
          setError(null);
          showToast('已拦截疑似密码或密钥，内容未发送给模型', 4000);
        } else if (isScreenReply) {
                    setCurrentScreenshot(null);
          stateRef.current.currentScreenshot = null;
          setActiveStyle('reply');
          stateRef.current.activeStyle = 'reply';
          const hint = event.payload.text?.trim() || '';
          const previewText = hint ? `对话线索: ${hint}` : '正在分析屏幕对话...';
          setOriginalText(previewText);
          stateRef.current.originalText = previewText;
          setScreenReplyAnalysis(null);

          // Vision disabled → open the panel but do NOT send screenshots to the LLM.
          if (!stateRef.current.readChatScreenshot) {
            invoke('append_log', { msg: 'frontend: screen-reply gated OFF (readChatScreenshot=false)' }).catch(() => {});
            showToast('视觉读取已在设置中关闭，打开后可分析聊天窗口', 4000);
          } else {
            showToast('💡 已捕获聊天界面，正在识别对话并构思回复...');
            invoke('append_log', { msg: 'frontend: screen-reply → vision analysis start' }).catch(() => {});
            stateRef.current.handleStartScreenReplyAnalysis(hint);
          }
        } else if (event?.payload?.text) {
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

          if (cls.confidence >= 0.7 && targetStyle !== 'polished') {
            showToast(`💡 智能识别【${STYLE_NAMES[targetStyle]}】(${cls.reason})`);
          }

          if (targetStyle === 'reply') {
            stateRef.current.handleStartTextReplyAnalysis(captured);
          } else {
            setScreenReplyAnalysis(null);
            stateRef.current.handleStartPolish(captured, targetStyle, undefined, screenshot);
          }
        } else if (event?.payload?.trigger === 'shortcut') {
          showToast('未检测到选中文本');
        } else if (event?.payload?.trigger === 'screen-reply') {
          // Screen-reply trigger but no screenshot available — never stay silent.
          invoke('append_log', { msg: 'frontend: screen-reply without screenshot' }).catch(() => {});
          showToast('截图失败，请再按一次快捷键重试', 4000);
        }
      }).then((un) => un, (e: unknown) => {
        invoke('append_log', { msg: `frontend: listen FAILED: ${String(e).slice(0, 300)}` }).catch(() => {});
        console.warn('listen captured-selection failed:', e);
        return undefined;
      }));

      // Tray "设置" menu → show window & open the settings form
      unlistens.push(listen('runbi://open-settings', () => {
        setShowEpoch((n) => n + 1);
        setShowSettings(true);
      }).then((un) => un, (e) => { console.warn('listen open-settings failed:', e); return undefined; }));

      invoke('append_log', { msg: 'frontend: listeners registered (1x)' }).catch(() => {});
      return () => {
        for (const p of unlistens) p.then((un) => { if (un) un(); }).catch(() => {});
      };
    }
    return undefined;
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
    try {
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
    } catch (e) {
      setConnectionTest({ status: 'error', message: `连接失败：${String(e).slice(0, 180)}` });
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
        persona,
        customPersonaPrompt: customPersonaPrompt.trim(),
        glitchtipDsn: glitchtipDsn.trim(),
      });

      if (isTauri) {
        const previous = persistedNativeSettingsRef.current;
        const nativeUpdates: Promise<unknown>[] = [];
        if (!previous || previous.autoCopyPopup !== autoCopyPopup) {
          nativeUpdates.push(
            invoke('set_auto_popup_enabled', { enabled: autoCopyPopup }),
            invoke('set_clipboard_monitor_enabled', { enabled: autoCopyPopup }),
          );
        }
        if (!previous || previous.autostart !== autostart) {
          nativeUpdates.push(invoke('set_autostart', { enabled: autostart }));
        }
        if (!previous || previous.wakeShortcut !== sc) {
          nativeUpdates.push(invoke('set_global_shortcut', { shortcut: sc }));
        }
        await Promise.all([saveConfig, ...nativeUpdates]);
      } else {
        await saveConfig;
      }

      persistedNativeSettingsRef.current = {
        autoCopyPopup,
        autostart,
        wakeShortcut: sc,
      };
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

  // Submit user feedback (always records to local log, reports upstream if configured).
  const [feedbackSent, setFeedbackSent] = useState(false);
  const handleSubmitFeedback = async () => {
    const msg = feedbackText.trim();
    if (!msg) {
      showToast('请先输入反馈内容');
      return;
    }
    if (feedbackSending) return;
    setFeedbackSending(true);
    try {
      if (isTauri) {
        await invoke<string>('submit_feedback', { message: msg });
        showToast('✓ 反馈已收到，非常感谢您的支持！', 3000);
        setFeedbackText('');
        setFeedbackSent(true);
        setTimeout(() => setFeedbackSent(false), 5000);
      } else {
        showToast('网页预览模式不支持提交反馈，请在桌面端使用', 4000);
      }
    } catch (e) {
      showToast(`反馈提交失败：${String(e)}`, 4000);
    } finally {
      setFeedbackSending(false);
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
      showToast(
        res.restoredClipboard === false
          ? '未确认目标应用已接收；结果暂留剪贴板，可按 Ctrl+V 重试'
          : stateRef.current.isPinned
            ? '已贴回原文 (窗口保持置顶)'
            : '已贴回原文',
        res.restoredClipboard === false ? 5000 : 2000
      );
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
    setShowSettings(false);
    setShowHistory(false);
    setShowOnboarding(false);
    setAttachedFiles([]);
    setClipboardRef(null);
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

  // Dismiss Onboarding & Quietly Hide to Tray
  const handleDismissOnboarding = useCallback(async () => {
    setShowOnboarding(false);
    await adapters.storageProvider.set('onboardingDone', true).catch(() => {});
    showToast('润笔已常驻系统托盘，随时划选文字唤起！', 3000);
    handleClose();
  }, [adapters.storageProvider, showToast]);

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
        if (s.showHistory) {
          setShowHistory(false);
          return;
        }
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

      // History Drawer shortcut: Ctrl+H or Cmd+H
      if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        setShowHistory((prev) => !prev);
        return;
      }

      // Revert replacement shortcut: Ctrl+Z when not typing and lastReplacement exists
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !typing && lastReplacement) {
        e.preventDefault();
        handleRevertReplace();
        return;
      }

      // Don't hijack keys while the user is editing a field or in settings or in history.
      if (typing || s.showSettings || s.showHistory) return;

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
      // in settings / in history / showing screen-reply analysis.
      if (!s.isPinned && !s.isGenerating && !s.showSettings && !s.showHistory && !s.screenReplyAnalysis) {
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
            {lastReplacement && (
              <button
                type="button"
                onClick={handleRevertReplace}
                title="撤回上次贴回，恢复目标应用原文 (Ctrl+Z)"
                aria-label="撤回上次贴回"
                className="runbi-icon-button !w-auto px-2 text-[11px] font-medium text-amber-300 hover:bg-amber-400/10 transition-colors cursor-pointer"
              >
                撤回贴回
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setShowHistory(!showHistory);
                if (!showHistory) setShowSettings(false);
              }}
              aria-label={showHistory ? '关闭时光机' : '查看生成历史与草稿箱 (Ctrl+H)'}
              aria-pressed={showHistory}
              title="生成历史与草稿箱 (Ctrl+H)"
              className={`runbi-icon-button ${
                showHistory ? 'bg-teal-500/10 !text-teal-300' : ''
              }`}
            >
              <History className="h-4 w-4" />
            </button>
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
              onClick={() => {
                setShowSettings(!showSettings);
                if (!showSettings) setShowHistory(false);
              }}
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

        {/* Draft Auto-Recovery Banner */}
        {recoverableDraft && !showHistory && !showSettings && (
          <div className="flex shrink-0 items-center justify-between border-b border-teal-500/20 bg-teal-500/10 px-3.5 py-1.5 text-xs text-teal-300">
            <span className="truncate pr-2">
              发现上次未完成草稿（{(recoverableDraft.originalText || recoverableDraft.polishedText || '').slice(0, 16)}...）
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (recoverableDraft.originalText) setOriginalText(recoverableDraft.originalText);
                  if (recoverableDraft.polishedText) setPolishedText(recoverableDraft.polishedText);
                  if (recoverableDraft.activeStyle) setActiveStyle(recoverableDraft.activeStyle);
                  setRecoverableDraft(null);
                  adapters.storageProvider.remove('activeDraft').catch(() => {});
                  showToast('已恢复上次草稿');
                }}
                className="rounded bg-teal-500/20 px-2 py-0.5 font-medium hover:bg-teal-500/30 text-white cursor-pointer"
              >
                立即恢复
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecoverableDraft(null);
                  adapters.storageProvider.remove('activeDraft').catch(() => {});
                }}
                className="text-slate-400 hover:text-slate-200 cursor-pointer text-[11px]"
              >
                忽略
              </button>
            </div>
          </div>
        )}

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
            {/* Settings Header with 3 Tabs */}
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-2.5 bg-black/20">
              <div className="flex items-center gap-1 rounded-lg bg-black/40 p-0.5 border border-white/10">
                <button
                  type="button"
                  onClick={() => setSettingsTab('model')}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
                    settingsTab === 'model'
                      ? 'bg-teal-500/20 text-teal-300 shadow-sm border border-teal-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  模型服务
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsTab('desktop')}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
                    settingsTab === 'desktop'
                      ? 'bg-teal-500/20 text-teal-300 shadow-sm border border-teal-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  桌面体验
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsTab('persona')}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
                    settingsTab === 'persona'
                      ? 'bg-teal-500/20 text-teal-300 shadow-sm border border-teal-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  人设与高级
                </button>
              </div>

              <span className="rounded-full border border-teal-400/20 bg-teal-400/10 px-2 py-0.5 text-[10px] font-medium text-teal-300 font-mono">
                BYOK · 本地加密
              </span>
            </div>

            {/* Tab 1: Model Settings */}
            {settingsTab === 'model' && (
              <div className="runbi-settings-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-4 animate-in fade-in duration-150">
                <div className="space-y-1.5">
                  <label htmlFor="provider-preset" className="block font-medium text-slate-300">服务商预设</label>
                  <select
                    id="provider-preset"
                    value={getProviderPreset(endpoint, model)}
                    onChange={(e) => handleSelectPreset(e.target.value)}
                    className="runbi-form-control cursor-pointer"
                  >
                    <option value="deepseek">DeepSeek (官方 API)</option>
                    <option value="zhipu">智谱 GLM-4 (官方 API)</option>
                    <option value="openai">OpenAI (官方 API)</option>
                    <option value="custom">自定义兼容端点 (SiliconFlow/Ollama等)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="api-key" className="block font-medium text-slate-300">API Key</label>
                  <input
                    id="api-key"
                    type="password"
                    autoComplete="off"
                    placeholder="输入服务商 API Key（留空体验内置 Mock 演示）"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setConnectionTest({ status: 'idle', message: '' });
                    }}
                    aria-describedby="api-key-help"
                    className="runbi-form-control font-mono"
                  />
                  <p id="api-key-help" className="text-[10px] leading-relaxed text-slate-500">
                    使用 Windows DPAPI 本地加密存储，绝不上报云端。
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
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
                      className="runbi-form-control font-mono text-[11px]"
                    />
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
                      className="runbi-form-control font-mono text-[11px]"
                    />
                  </div>
                </div>

                {endpoint && endpoint.trim().startsWith('http://') && !endpoint.includes('localhost') && !endpoint.includes('127.0.0.1') && (
                  <p role="alert" className="text-[10px] leading-relaxed text-amber-300">远程地址使用明文 HTTP，建议改用 HTTPS。</p>
                )}

                <div className="runbi-settings-card flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0" aria-live="polite">
                    <p className="font-medium text-slate-200">连接检查</p>
                    <p className={`mt-0.5 truncate text-[10px] leading-relaxed ${
                      connectionTest.status === 'success'
                        ? 'text-emerald-300'
                        : connectionTest.status === 'error'
                          ? 'text-rose-300'
                          : 'text-slate-500'
                    }`}>
                      {connectionTest.message || '测试网络连通性与模型可用性。'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={connectionTest.status === 'testing'}
                    className="runbi-secondary-button runbi-focus-ring shrink-0 cursor-pointer"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${connectionTest.status === 'testing' ? 'animate-spin' : ''}`} />
                    {connectionTest.status === 'testing' ? '测试中' : '测试连接'}
                  </button>
                </div>
              </div>
            )}

            {/* Tab 2: Desktop Settings */}
            {settingsTab === 'desktop' && (
              <div className="runbi-settings-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4 animate-in fade-in duration-150">
                <div className="space-y-1">
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
                  <p className="text-[10px] text-slate-500">点击后直接在键盘按下新快捷键，保存后即时生效。</p>
                </div>

                <SettingsToggle
                  label="划词/复制后自动唤起"
                  description="开启后监控划词与新复制文本；关闭后仅响应全局快捷键。"
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
                  description="在微信/飞书等聊天窗口，智能识别上文对方说的话。"
                  checked={readChatScreenshot}
                  onChange={setReadChatScreenshot}
                />
              </div>
            )}

            {/* Tab 3: Persona & Advanced */}
            {settingsTab === 'persona' && (
              <div className="runbi-settings-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-4 animate-in fade-in duration-150">
                <div className="space-y-1.5">
                  <label htmlFor="persona-preset" className="block font-medium text-slate-300">我的人设偏好</label>
                  <select
                    id="persona-preset"
                    value={persona}
                    onChange={(e) => setPersona(e.target.value as PersonaType)}
                    className="runbi-form-control cursor-pointer"
                  >
                    {PERSONA_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-500">
                    {PERSONA_PRESETS.find((p) => p.id === persona)?.description}
                  </p>
                </div>

                {persona === 'custom' && (
                  <div className="space-y-1.5">
                    <label htmlFor="custom-persona-prompt" className="block font-medium text-slate-300">自定义人设描述</label>
                    <textarea
                      id="custom-persona-prompt"
                      rows={2}
                      placeholder="例：互联网大厂高级产品经理，语气自信沉稳且有条理..."
                      value={customPersonaPrompt}
                      onChange={(e) => setCustomPersonaPrompt(e.target.value)}
                      className="runbi-form-control resize-none font-sans text-xs"
                    />
                  </div>
                )}

                <React.Suspense fallback={<div className="h-[58px] animate-pulse rounded-lg border border-white/10 bg-white/5" />}>
                  <UpdateCheckRow />
                </React.Suspense>

                {/* Error Telemetry / DSN Configuration */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="glitchtip-dsn" className="block font-medium text-slate-300">
                      遥测监控 DSN (GlitchTip / Sentry)
                    </label>
                    <span className="text-[10px] text-teal-400 font-mono">
                      {glitchtipDsn ? '已启用 (实时同步)' : '未配置 (仅本地存储)'}
                    </span>
                  </div>
                  <input
                    id="glitchtip-dsn"
                    type="text"
                    placeholder="http://<key>@localhost:3000/1"
                    value={glitchtipDsn}
                    onChange={(e) => setGlitchtipDsn(e.target.value)}
                    className="runbi-form-control font-mono text-[11px]"
                  />
                  <p className="text-[10px] text-slate-500">
                    配置后，用户提交的反馈与异常崩溃将实时推送到 GlitchTip 监控看板。
                  </p>
                </div>

                {/* User feedback */}
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block font-medium text-slate-300 text-xs">问题反馈与建议</label>
                    <button
                      type="button"
                      onClick={() => {
                        if (isTauri) {
                          invoke('open_url', { url: 'https://github.com/dcn-autotest-team/runbi/issues' }).catch(() => {});
                        } else {
                          window.open('https://github.com/dcn-autotest-team/runbi/issues', '_blank');
                        }
                      }}
                      className="text-[10px] text-teal-400 hover:text-teal-300 hover:underline cursor-pointer"
                    >
                      在 GitHub 提 Issue →
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="遇到问题或有想法？写在这里，一键提交反馈..."
                    className="runbi-form-control runbi-focus-ring w-full resize-none text-xs"
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">
                      {feedbackSent ? '✓ 反馈已记录，感谢您的支持！' : '文字保存在本地日志，随时查看'}
                    </span>
                    <button
                      type="button"
                      disabled={feedbackSending || !feedbackText.trim()}
                      onClick={handleSubmitFeedback}
                      className="runbi-focus-ring rounded-lg bg-teal-500/20 px-3 py-1 text-xs font-medium text-teal-200 transition-colors hover:bg-teal-500/30 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {feedbackSending ? '提交中…' : feedbackSent ? '已提交 ✓' : '提交反馈'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex shrink-0 items-center justify-between border-t border-white/10 bg-black/20 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-slate-500">Esc 取消</span>
                <button
                  type="button"
                  onClick={() => {
                    setShowSettings(false);
                    setShowOnboarding(true);
                  }}
                  className="text-[11px] font-medium text-teal-400 hover:text-teal-300 hover:underline cursor-pointer"
                >
                  新手引导
                </button>
              </div>
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
        ) : showOnboarding ? (
          /* First-Run 5-Second Micro-Onboarding View */
          <OnboardingView
            onDismiss={handleDismissOnboarding}
            shortcut={wakeShortcut || DEFAULT_SHORTCUT}
            autoCloseSeconds={5}
          />
        ) : showHistory ? (
          /* Dedicated History View Component (No double-exposure) */
          <HistoryDrawer
            isOpen={showHistory}
            history={history}
            onClose={() => setShowHistory(false)}
            onRestore={(record) => {
              setOriginalText(record.originalText);
              setPolishedText(record.polishedText);
              setActiveStyle(record.style);
              setShowHistory(false);
              showToast('已恢复所选记录至主面板');
            }}
            onDelete={deleteHistoryRecord}
            onClearAll={clearAllHistory}
            onCopyText={async (text) => {
              await adapters.textReplacer.copyToClipboard(text);
              showToast('已复制到剪贴板');
            }}
          />
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
            replaceLabel="贴回"
          />
        )}

        {/* Global Toast Pill: Always visible across all views (Settings, History, Onboarding, Panel) */}
        <Toast
          visible={toastVisible}
          message={toastMessage}
          onDismiss={() => setToastVisible(false)}
        />

      </div>
    </div>
  );
};

export default App;
