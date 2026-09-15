/**
 * @file desktop/src/App.tsx
 * Runbi Desktop Client - Raycast-like AI Text Polishing Assistant
 * Powered by Tauri 2.x + React 18 + Tailwind CSS + @runbi/shared
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { PolishStyle, StreamConfig, PersonaType, HistoryRecord, DraftSnapshot, LastReplacementSnapshot, CustomAction, ScriptTemplate, ExpertAgent, GlossaryRule } from '@runbi/shared/types';
import { PERSONA_PRESETS, INDUSTRY_PACKS, detectIndustryPack, estimateTokens, trialRemainingTokens, TRIAL_PROXY_BASE_URL } from '@runbi/shared/types';
import { PolishPanel, HistoryDrawer, Toast, ScriptLibraryModal, ExpertPickerModal, type AttachedFileContext } from '@runbi/shared/components';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
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
  buildFeishuCopilotSystemPrompt,
  buildFeishuCopilotUserPrompt,
  buildExpertSystemPrompt,
  buildTranslateSystemPrompt,
  resolveTranslateTarget,
  findBannedWords,
  buildGlossaryPrompt,
  buildStyleSamplesPrompt,
  buildAppStylePrompt,
  getChatAppName,
  hasLatexMarkers,
  findLatexViolations,
  TRANSLATE_TARGETS,
  parseModelJson,
  type ScreenReplyAnalysis,
  type TranslateTargetId,
} from '@runbi/shared/core';
import { RunbiLogo, Settings, X, Pin, PinOff, RefreshCw, History, Droplet } from './components/Icons';
import { OnboardingView } from './components/OnboardingView';
import { ParallelResultsView, type ParallelSession } from './components/ParallelResultsView';
import { buildBrowserSearchUrl, SelectionCapsule, shouldShowCapsule } from './components/SelectionCapsule';
import { AdvancedSettings } from './components/AdvancedSettings';
import { UpdateCheckRow } from './components/UpdateCheckRow';

const STYLE_NAMES: Record<PolishStyle, string> = {
  polished: '通用润色',
  academic: '学术规范',
  business: '职场商务',
  literary: '文采飞扬',
  concise: '精简提炼',
  native_en: '地道英文',
  reply: '智能回复',
  translate: '翻译',
};

const DEFAULT_SHORTCUT = 'Ctrl+Shift+Space';

// —— 缺陷2：划词微胶囊（Mini Capsule）常量 ——
// 窗口尺寸(196×44)与定位由 Rust 侧 position_window_at_cursor(is_capsule) 负责
const CAPSULE_IDLE_MS = 6000; // 6s 内鼠标未移到胶囊上 → 静默淡出(悬停即取消)
const CAPSULE_FADE_MS = 220; // 淡出等待，与 SelectionCapsule 的 CSS opacity 过渡保持一致

// 胶囊暂存的划词上下文：展开面板时按它重放现有润色/回复流程
interface CapsuleInfo {
  ts: number; // 每次划词刷新，作 key 让进场动画重放
  text: string;
  sourceApp?: string;
  windowTitle?: string;
  screenshot: string | null;
  generation?: number;
}

type CapsuleAction = 'search' | 'polish' | 'reply' | 'translate' | 'copy';

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
  const [autoCopyPopup, setAutoCopyPopup] = useState<boolean>(true);
  const [clipboardTriggerEnabled, setClipboardTriggerEnabled] = useState<boolean>(false);
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
  const [industryPack, setIndustryPack] = useState<string>('auto');
  const [customActions, setCustomActions] = useState<CustomAction[]>([]);
  // 缺陷5 个人词库与文风标杆;缺陷1 试用额度记账(仅官方代理通道上线后生效)
  const [glossary, setGlossary] = useState<GlossaryRule[]>([]);
  const [styleSamples, setStyleSamples] = useState<string[]>([]);
  const [trialTokensUsed, setTrialTokensUsed] = useState(0);
  const trialTokensUsedRef = useRef(0);
  // 缺陷3:贴回失败常驻浮条(带重试),替代一闪而过的 Toast
  const [pasteFallbackBar, setPasteFallbackBar] = useState(false);
  // 智能模式：AI 自动判断风格（划词时 classifyContext），下拉里点具体风格才退出
  const [autoMode, setAutoMode] = useState<boolean>(true);
  // 划词翻译目标语言：记忆上次选择，切换时立即重译
  const [translateTarget, setTranslateTarget] = useState<TranslateTargetId>('en');
  const [windowOpacity, setWindowOpacity] = useState<number>(1);
  const windowOpacityRef = useRef<number>(1);
  windowOpacityRef.current = windowOpacity;
  const [skin, setSkin] = useState<'dark' | 'light'>('dark');
  // 飞书智能副驾追踪与应答
  const [feishuCopilotEnabled, setFeishuCopilotEnabled] = useState<boolean>(false);
  const [feishuCopilotMode, setFeishuCopilotMode] = useState<'collaborative' | 'autopilot'>('collaborative');
  const [feishuCopilotStatus, setFeishuCopilotStatus] = useState<string>('');
  const feishuLastRepliedSummaryRef = useRef<string>('');
  const feishuLastScreenshotRef = useRef<string>('');
  const feishuAutoPilotCooldownUntilRef = useRef<number>(0);
  const feishuPollingActiveRef = useRef<boolean>(false);

  // 内置库（话术模板/专家提示词）与多专家并行
  const [showScriptLibrary, setShowScriptLibrary] = useState<boolean>(false);
  const [showExpertPicker, setShowExpertPicker] = useState<boolean>(false);
  const [contextHint, setContextHint] = useState<string>('');
  const [activeExpert, setActiveExpert] = useState<ExpertAgent | null>(null);
  const [showParallel, setShowParallel] = useState<boolean>(false);
  const [parallelSessions, setParallelSessions] = useState<ParallelSession[]>([]);
  const parallelControllersRef = useRef<Map<string, AbortController>>(new Map());
  // 润色侧最近一次使用的风格：回复→润色一键切回时恢复
  const lastPolishStyleRef = useRef<PolishStyle>('polished');
  const parallelRunning = parallelSessions.some((s) => s.status === 'streaming');
  const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  // 主题切换：html[data-theme='light'] 驱动 glass.css 浅色覆盖层，即时生效。
  // 浅色需移除 index.html 预置的 dark class，让共享组件回落到浅色变体。
  // 切肤同时复位窗口透明度：浅色一律不透明(浅色窗面下 alpha 叠加几乎无视觉变化,
  // 还会让浅色整体发灰)；切回深色恢复用户上次设的透明度。
  useEffect(() => {
    if (skin === 'light') {
      document.documentElement.dataset.theme = 'light';
      document.documentElement.classList.remove('dark');
    } else {
      delete document.documentElement.dataset.theme;
      document.documentElement.classList.add('dark');
    }
    if (isTauri) {
      const opacity = skin === 'light'
        ? 1
        : Number.isFinite(windowOpacityRef.current) ? Math.min(1, Math.max(0.2, windowOpacityRef.current)) : 1;
      setWindowOpacity(opacity);
      invoke('set_window_opacity', { opacity }).catch(() => {});
    }
  }, [skin, isTauri]);
  const [glitchtipDsn, setGlitchtipDsn] = useState<string>('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFileContext[]>([]);
  const [clipboardRef, setClipboardRef] = useState<string | null>(null);

  // 缺陷2 微胶囊：uiMode='capsule' 时窗口缩为胶囊条并渲染 SelectionCapsule，
  // 'panel' 为现有完整面板；窗口隐藏复用 hide_window，不引入第三个状态。
  const [uiMode, setUiMode] = useState<'panel' | 'capsule'>('panel');
  const [capsule, setCapsule] = useState<CapsuleInfo | null>(null);
  const [capsuleVisible, setCapsuleVisible] = useState<boolean>(true);
  const [capsuleCopied, setCapsuleCopied] = useState<boolean>(false);
  const capsuleArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capsuleFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capsuleActionRef = useRef<'expanding' | 'copying' | null>(null);
  const capsuleTransitionRef = useRef<{ text: string; generation?: number; until: number } | null>(null);
  const capsuleRevisionRef = useRef(0);
  const selectionGenerationRef = useRef(0);
  const updatePromptShownRef = useRef(false);

  // Data Safety & Fault Tolerance State
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<'model' | 'desktop' | 'persona' | 'about'>('model');
  const [recoverableDraft, setRecoverableDraft] = useState<DraftSnapshot | null>(null);
  const [lastReplacement, setLastReplacement] = useState<LastReplacementSnapshot | null>(null);
  const persistedNativeSettingsRef = useRef<{
    autoCopyPopup: boolean;
    clipboardTriggerEnabled: boolean;
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

  // 行业包：auto = AI 按窗口标题/选中文本自动识别（每次生成实时判定），显式选择则固定
  const activePack = useMemo(
    () => {
      const general = INDUSTRY_PACKS.find((p) => p.id === 'general')!;
      if (industryPack === 'auto') {
        return detectIndustryPack(`${contextHint}\n${originalText}`) || general;
      }
      return INDUSTRY_PACKS.find((p) => p.id === industryPack) || general;
    },
    [industryPack, contextHint, originalText]
  );
  const activePackPrompt = activePack.sceneHint;
  // 缺陷5:个人词库硬约束段(润色与回复 refine 共用);空词库时为 ''
  const glossaryPromptText = useMemo(() => buildGlossaryPrompt(glossary), [glossary]);
  const packReplyQuickTags = useMemo(
    () => activePack.intents.map((i) => ({ label: i.label, text: i.instruction })),
    [activePack]
  );
  // Pack-aware fallback chips for mock / unparseable analysis responses.
  const packChips = (fallback: string[]): string[] =>
    activePack.intents.length ? activePack.intents.map((i) => i.label) : fallback;

  // User-defined actions merge after pack intents as one-tap chips.
  const customActionTags = useMemo(
    () =>
      customActions
        .filter((a) => a.name.trim() && a.prompt.trim())
        .map((a) => ({ label: a.name, text: a.prompt.trim() })),
    [customActions]
  );
  const replyQuickTags = useMemo(
    () => (packReplyQuickTags.length > 0 || customActionTags.length > 0
      ? [...packReplyQuickTags, ...customActionTags]
      : []),
    [packReplyQuickTags, customActionTags]
  );
  const bannedHits = useMemo(() => findBannedWords(polishedText), [polishedText]);

  const upsertCustomAction = (idx: number, patch: Partial<CustomAction>) =>
    setCustomActions((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));

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
  // A user-selected mode must win over the async persisted-config load. This
  // matters when the first capsule is clicked immediately after launch.
  const styleOverrideRef = useRef(false);
  // Translation is a panel entry, not just another polish style. Keep this
  // guard synchronous so late selection/config work cannot repaint its UI.
  const translationPanelRef = useRef(false);

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
    activePersonaPrompt: '',
    activePack: INDUSTRY_PACKS[0],
    activePackPrompt: '',
    activeExpert: null as ExpertAgent | null,
    showParallel: false,
    parallelRunning: false,
    showScriptLibrary: false,
    showExpertPicker: false,
    autoMode: true,
    translateTarget: 'en' as TranslateTargetId,
    lastChatApp: '',
    recaptureForceVision: false,
    uiMode: 'panel' as 'panel' | 'capsule',
    armCapsule: (_info: CapsuleInfo) => {},
    hideCapsule: (_immediate?: boolean, _nativeAlreadyHidden?: boolean) => {},
    handleCapsuleAction: (_action: CapsuleAction) => {},
    handleStartPolish: (_t: string, _s: PolishStyle, _c?: string, _img?: string | null) => {},
    activateTranslate: (_t: string, _img?: string | null, _target?: TranslateTargetId, _preserveAutoMode?: boolean) => {},
    handleStartScreenReplyAnalysis: (_hint?: string) => {},
    handleStartTextReplyAnalysis: (_msg: string) => {},
    handleRecapture: () => {},
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
  stateRef.current.activePersonaPrompt = activePersonaPrompt;
  stateRef.current.activePack = activePack;
  stateRef.current.activePackPrompt = activePackPrompt;
  stateRef.current.activeExpert = activeExpert;
  stateRef.current.showParallel = showParallel;
  stateRef.current.parallelRunning = parallelRunning;
  stateRef.current.showScriptLibrary = showScriptLibrary;
  stateRef.current.showExpertPicker = showExpertPicker;
  stateRef.current.autoMode = autoMode;
  stateRef.current.translateTarget = translateTarget;
  stateRef.current.uiMode = uiMode;

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

  // —— 缺陷2:微胶囊状态机。窗口隐藏复用 hide_window;capsule→panel 由 expandCapsule 完成 ——
  const capsuleInfoRef = useRef<CapsuleInfo | null>(null);

  const clearCapsuleTimers = () => {
    if (capsuleArmTimerRef.current) {
      clearTimeout(capsuleArmTimerRef.current);
      capsuleArmTimerRef.current = null;
    }
    if (capsuleFadeTimerRef.current) {
      clearTimeout(capsuleFadeTimerRef.current);
      capsuleFadeTimerRef.current = null;
    }
  };

  // Selection invalidation bypasses both the idle timer and fade animation.
  const hideCapsule = useCallback((immediate = false, nativeAlreadyHidden = false) => {
    clearCapsuleTimers();
    const generation = selectionGenerationRef.current;
    const revision = ++capsuleRevisionRef.current;
    capsuleActionRef.current = null;
    stateRef.current.uiMode = 'panel';
    setCapsuleVisible(false);
    const finish = async () => {
      capsuleFadeTimerRef.current = null;
      let nativeHideFailed = false;
      if (isTauri && !nativeAlreadyHidden) {
        try {
          await invoke('hide_capsule_window', { generation });
        } catch (e) {
          nativeHideFailed = true;
          console.warn('reset capsule window failed:', e);
        }
      }
      // A newer selection/expansion may arrive while native hide is resolving.
      if (revision !== capsuleRevisionRef.current) return;
      if (nativeHideFailed && isTauri) {
        // The generation guard above proves this is still the same capsule;
        // hide the window as a last resort so a failed IPC call cannot leave a
        // transparent always-on-top window behind.
        invoke('hide_window').catch(() => {});
      }
      capsuleInfoRef.current = null;
      setUiMode('panel');
      setCapsule(null);
      setCapsuleVisible(true);
    };
    if (immediate) void finish();
    else capsuleFadeTimerRef.current = setTimeout(() => void finish(), CAPSULE_FADE_MS);
  }, [isTauri]);

  // All translation entry points share one state transition. Keeping this
  // here lets capsule clicks use the same minimal panel state as the header
  // and shortcut paths without routing through another Tauri event.
  const activateTranslate = useCallback((
    text: string,
    screenshot: string | null = null,
    targetOverride?: TranslateTargetId,
    preserveAutoMode = false
  ) => {
    if (!text.trim()) return;
    invoke('append_log', {
      msg: `frontend: activate translate len=${text.length} head=${text.slice(0, 20)} before_ui=${stateRef.current.uiMode} before_style=${stateRef.current.activeStyle} override=${targetOverride ?? "none"}`,
    }).catch(() => {});
    styleOverrideRef.current = true;
    translationPanelRef.current = true;
    clearCapsuleTimers();
    capsuleActionRef.current = null;
    capsuleInfoRef.current = null;
    stateRef.current.uiMode = 'panel';
    setUiMode('panel');
    setCapsule(null);
    setCapsuleVisible(true);
    setShowEpoch((n) => n + 1);
    setShowSettings(false);
    setShowHistory(false);
    setShowScriptLibrary(false);
    setShowExpertPicker(false);
    setShowParallel(false);
    setIsDiffMode(false);
    setPasteFallbackBar(false);
    setToastVisible(false);
    // A new translation supersedes any recoverable draft from the previous
    // session; otherwise the draft banner makes this path non-minimal.
    setRecoverableDraft(null);
    adapters.storageProvider.remove('activeDraft').catch(() => {});
    setOriginalText(text);
    stateRef.current.originalText = text;
    setPolishedText('');
    setError(null);
    stateRef.current.activeExpert = null;
    setActiveExpert(null);
    setScreenReplyAnalysis(null);
    stateRef.current.screenReplyAnalysis = null;
    if (!preserveAutoMode) {
      setAutoMode(false);
      stateRef.current.autoMode = false;
    }
    stateRef.current.activeStyle = 'translate';
    setActiveStyle('translate');
    stateRef.current.currentScreenshot = screenshot;
    setCurrentScreenshot(screenshot);
    const autoTarget = resolveTranslateTarget(text);
    let target = targetOverride || autoTarget;
    if (targetOverride === 'zh-Hans' && autoTarget === 'en') {
      target = 'en';
    } else if (targetOverride === 'en' && autoTarget === 'zh-Hans') {
      target = 'zh-Hans';
    }
    invoke('append_log', { msg: `frontend: activate target resolved=${target} auto=${autoTarget} override=${targetOverride ?? "none"}` }).catch(() => {});
    stateRef.current.translateTarget = target;
    setTranslateTarget(target);
    adapters.storageProvider.set('translateTarget', target).catch(() => {});
    stateRef.current.handleStartPolish(text, 'translate', undefined, screenshot);
  }, [adapters.storageProvider]);

  // Keep one runtime signature for the two user-visible translation entries.
  // This is intentionally sampled after React commits so a native capsule
  // click cannot be mistaken for a successful state update before paint.
  useEffect(() => {
    if (!isTauri || uiMode !== 'panel' || activeStyle !== 'translate' || !originalText.trim()) return;
    const timer = window.setTimeout(() => {
      const instruction = Array.from(document.querySelectorAll('input, textarea'))
        .some((node) => node.getAttribute('placeholder')?.includes('补充要求'));
      invoke('append_log', {
        msg: `frontend: translate panel committed bar=${Boolean(document.querySelector('[data-testid="translate-bar"]'))} style_dropdown=${Boolean(document.querySelector('#style-dropdown-trigger'))} original_preview=${Boolean(document.querySelector('#original-preview'))} instruction=${instruction}`,
      }).catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeStyle, isTauri, originalText, uiMode]);

  // 划词到达:挂胶囊并启动 1.2s 无人问津淡出计时
  const armCapsule = useCallback((info: CapsuleInfo) => {
    clearCapsuleTimers();
    if (panelBlurTimerRef.current) {
      clearTimeout(panelBlurTimerRef.current);
      panelBlurTimerRef.current = null;
    }
    ++capsuleRevisionRef.current;
    capsuleActionRef.current = null;
    translationPanelRef.current = false;
    capsuleInfoRef.current = info;
    setCapsule(info);
    setCapsuleVisible(true);
    setCapsuleCopied(false);
    // Keep the imperative state mirror in sync before React schedules the
    // render; the deferred blur guard reads this ref while the native capsule
    // is intentionally shown above the source app.
    stateRef.current.uiMode = 'capsule';
    setUiMode('capsule');
    capsuleArmTimerRef.current = setTimeout(() => {
      capsuleArmTimerRef.current = null;
      hideCapsule();
    }, CAPSULE_IDLE_MS);
  }, [hideCapsule]);

  // 点击胶囊 → 窗口复原为完整面板并重放现有润色/回复流程(不自动生成以外的额外请求)
  const expandCapsule = useCallback(
    async (mode: 'polish' | 'reply' | 'translate') => {
      const info = capsuleInfoRef.current;
      invoke('append_log', {
        msg: `frontend: capsule action mode=${mode} info=${Boolean(info)} ts=${info ? info.ts : "-"} head=${info ? info.text.slice(0, 20) : "-"} action=${capsuleActionRef.current ?? 'none'} ui=${stateRef.current.uiMode}`,
      }).catch(() => {});
      if (!info || capsuleActionRef.current) return;
      if (mode === 'translate') {
        // Lock the selected mode before the async native resize. The capsule
        // stays rendered until resize completes, so this cannot flash the
        // panel, but a late config/selection render cannot fall back to polish.
        styleOverrideRef.current = true;
        translationPanelRef.current = true;
        stateRef.current.activeStyle = 'translate';
        setActiveStyle('translate');
      } else {
        translationPanelRef.current = false;
      }
      clearCapsuleTimers();
      capsuleActionRef.current = 'expanding';
      capsuleTransitionRef.current = {
        text: info.text,
        generation: info.generation,
        until: Date.now() + 750,
      };
      const revision = ++capsuleRevisionRef.current;
      capsuleInfoRef.current = null;
      setCapsuleVisible(false);
      invoke('append_log', {
        msg: `frontend: capsule expand start mode=${mode} revision=${revision} text_len=${info.text.length}`,
      }).catch(() => {});
      if (isTauri) {
        try {
          await invoke('position_window_at_cursor', { isCapsule: false });
          invoke('append_log', {
            msg: `frontend: capsule expand positioned mode=${mode} revision=${revision}`,
          }).catch(() => {});
        } catch (e) {
          console.warn('expand capsule reposition failed:', e);
          if (revision === capsuleRevisionRef.current) {
            capsuleActionRef.current = null;
            setUiMode('panel');
            setCapsule(null);
            invoke('hide_window').catch(() => {});
          }
          return;
        }
      }
      // A newer selection supersedes an expansion that was still repositioning
      // the native window. Never let the old request overwrite the new capsule.
      if (revision !== capsuleRevisionRef.current) return;
      capsuleActionRef.current = null;
      if (mode === 'reply') {
        // The expanded capsule is the same main window as the shortcut panel.
        setUiMode('panel');
        setCapsule(null);
        setShowEpoch((n) => n + 1);
        setCurrentScreenshot(info.screenshot);
        stateRef.current.currentScreenshot = info.screenshot;
        setScreenReplyAnalysis(null);
        stateRef.current.screenReplyAnalysis = null;
        setOriginalText(info.text);
        stateRef.current.originalText = info.text;
        setActiveStyle('reply');
        stateRef.current.activeStyle = 'reply';
        stateRef.current.handleStartTextReplyAnalysis(info.text);
      } else if (mode === 'translate' || stateRef.current.activeStyle === 'translate') {
        // Translation is intentionally routed through the same canonical entry
        // used by the header and shortcut paths.
        activateTranslate(info.text, info.screenshot);
      } else if (stateRef.current.autoMode) {
        setUiMode('panel');
        setCapsule(null);
        setShowEpoch((n) => n + 1);
        setCurrentScreenshot(info.screenshot);
        stateRef.current.currentScreenshot = info.screenshot;
        setScreenReplyAnalysis(null);
        stateRef.current.screenReplyAnalysis = null;
        setOriginalText(info.text);
        stateRef.current.originalText = info.text;
        const cls = classifyContext({
          text: info.text,
          sourceApp: info.sourceApp,
          windowTitle: info.windowTitle,
        });
        stateRef.current.activeStyle = cls.style;
        setActiveStyle(cls.style);
        if (cls.confidence >= 0.7 && cls.style !== 'polished') {
          showToast(`已智能识别【${STYLE_NAMES[cls.style]}】(${cls.reason})`);
        }
        if (cls.style === 'reply') {
          stateRef.current.handleStartTextReplyAnalysis(info.text);
        } else if (cls.style === 'translate') {
          stateRef.current.activateTranslate(info.text, info.screenshot, undefined, true);
        } else {
          stateRef.current.handleStartPolish(info.text, cls.style, undefined, info.screenshot);
        }
      } else {
        setUiMode('panel');
        setCapsule(null);
        setShowEpoch((n) => n + 1);
        setCurrentScreenshot(info.screenshot);
        stateRef.current.currentScreenshot = info.screenshot;
        setScreenReplyAnalysis(null);
        stateRef.current.screenReplyAnalysis = null;
        setOriginalText(info.text);
        stateRef.current.originalText = info.text;
        stateRef.current.handleStartPolish(info.text, stateRef.current.activeStyle, undefined, info.screenshot);
      }
    },
    [activateTranslate, isTauri, showToast]
  );

  const handleCapsuleCopy = useCallback(() => {
    const info = capsuleInfoRef.current;
    if (!info || capsuleActionRef.current) return;
    invoke('append_log', { msg: `frontend: capsule copy start len=${info.text.length}` }).catch(() => {});
    clearCapsuleTimers();
    capsuleActionRef.current = 'copying';
    void adapters.textReplacer.copyToClipboard(info.text).then((ok) => {
      if (capsuleInfoRef.current !== info) return;
      capsuleActionRef.current = null;
      invoke('append_log', { msg: `frontend: capsule copy result ok=${ok}` }).catch(() => {});
      if (!ok) {
        hideCapsule(true);
        return;
      }
      showToast('已复制到剪贴板');
      setCapsuleCopied(true);
      // Copy is not the end of the flow: keep the other actions available and
      // show the success state until the normal idle timeout.
      capsuleArmTimerRef.current = setTimeout(() => {
        capsuleArmTimerRef.current = null;
        hideCapsule();
      }, CAPSULE_IDLE_MS);
    }).catch((error) => {
      if (capsuleInfoRef.current !== info) return;
      capsuleActionRef.current = null;
      console.warn('capsule copy failed:', error);
      invoke('append_log', { msg: `frontend: capsule copy error=${String(error).slice(0, 180)}` }).catch(() => {});
      hideCapsule();
    });
  }, [adapters.textReplacer, hideCapsule, showToast]);

  const handleCapsuleSearch = useCallback(() => {
    const info = capsuleInfoRef.current;
    const text = info?.text;
    if (!text?.trim()) return;
    clearCapsuleTimers();
    const url = buildBrowserSearchUrl(text);
    const open = isTauri
      ? invoke('open_url', { url })
      : Promise.resolve(window.open(url, '_blank', 'noopener,noreferrer'));
    void open
      .then(() => {
        if (capsuleInfoRef.current === info) hideCapsule();
      })
      .catch((error) => {
        console.warn('open browser search failed:', error);
        showToast('无法打开浏览器，请稍后重试', 3000);
      });
  }, [hideCapsule, isTauri, showToast]);

  stateRef.current.handleCapsuleAction = (action: CapsuleAction) => {
    if (action === 'search') {
      handleCapsuleSearch();
    } else if (action === 'copy') {
      handleCapsuleCopy();
    } else {
      void expandCapsule(action);
    }
  };

  const handleCapsuleHover = useCallback(
    (hovered: boolean) => {
      if (hovered) {
        // 悬停即取消一切自动淡出
        clearCapsuleTimers();
        // The pointer can re-enter during the CSS fade. Restore the capsule
        // while its context is still current instead of leaving a dead window.
        if (capsuleInfoRef.current && stateRef.current.uiMode === 'capsule') {
          setCapsuleVisible(true);
        }
        return;
      }
      // 移开后给用户回到胶囊的时间，避免操作入口突然消失
      clearCapsuleTimers();
      capsuleFadeTimerRef.current = setTimeout(() => {
        capsuleFadeTimerRef.current = null;
        if (capsuleActionRef.current === 'expanding') return;
        hideCapsule();
      }, 500);
    },
    [hideCapsule]
  );

  useEffect(() => () => {
    clearCapsuleTimers();
    if (panelBlurTimerRef.current) clearTimeout(panelBlurTimerRef.current);
  }, []);

  stateRef.current.armCapsule = armCapsule;
  stateRef.current.hideCapsule = hideCapsule;

  // 窗口透明度：滑杆连续调节，拖动实时生效，松手/关闭时持久化
  const [opacityMenuOpen, setOpacityMenuOpen] = useState(false);
  const [opacityPos, setOpacityPos] = useState<{ top: number; right: number } | null>(null);
  const opacityBtnRef = useRef<HTMLButtonElement | null>(null);
  const opacityMenuRef = useRef<HTMLDivElement | null>(null);
  // 拖动节流: 目标值直接交给 Rust 侧缓动动画(WebView2 失焦/隐藏时 rAF 会被节流,
  // JS 驱动的插值在拖动中静默卡死,动画挪到 Rust 后不再受 webview 可见性影响)。
  const animateOpacityTo = useCallback((target: number) => {
    if (!isTauri) {
      setWindowOpacity(target);
      return;
    }
    invoke('animate_window_opacity', { target }).catch((e) => console.warn('animate opacity failed:', e));
  }, [isTauri]);
  const handleOpacityChange = useCallback((v: number) => {
    setWindowOpacity(v);
    // UI 文本即时反馈;窗口 alpha 走缓动插值
    animateOpacityTo(v);
  }, [animateOpacityTo]);
  const persistOpacity = useCallback(() => {
    adapters.storageProvider.set('windowOpacity', windowOpacity).catch(() => {});
  }, [windowOpacity, adapters.storageProvider]);

  const toggleOpacityMenu = useCallback(() => {
    setOpacityMenuOpen((open) => {
      if (!open && opacityBtnRef.current) {
        const rect = opacityBtnRef.current.getBoundingClientRect();
        setOpacityPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
      }
      return !open;
    });
  }, []);

  useEffect(() => {
    if (!opacityMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        opacityMenuRef.current && !opacityMenuRef.current.contains(e.target as Node) &&
        opacityBtnRef.current && !opacityBtnRef.current.contains(e.target as Node)
      ) {
        setOpacityMenuOpen(false);
        persistOpacity();
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [opacityMenuOpen, persistOpacity]);

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
        showToast('已将剪贴板内容作为参考资料附带');
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
    screenshotUrl?: string | null,
    historyOriginalText?: string
  ) => {
    if (!text || text.trim().length === 0) return;

    if (style !== 'reply' && style !== 'translate') lastPolishStyleRef.current = style;

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

    // 翻译外的润色也可带屏幕上下文(F9 重新截屏后由 recaptureForceVision 驱动);
    // reply 沿用原条件, 非 reply 仅在 recapture 刚截完屏时带图
    const useScreenshot = Boolean(
      ((style === 'reply' && stateRef.current.readChatScreenshot) || stateRef.current.recaptureForceVision)
      && (screenshotUrl || stateRef.current.hasScreenshot)
    );
    stateRef.current.recaptureForceVision = false;

    if (useScreenshot) {
      adapters.storageProvider.get<boolean>('hasShownVisionNotice', false).then((shown) => {
        if (!shown) {
          showToast('已开启视觉上下文：回复会参考聊天历史');
          adapters.storageProvider.set('hasShownVisionNotice', true).catch((e) => {
            console.warn('save vision notice state failed:', e);
          });
        }
      }).catch((e) => console.warn('load vision notice state failed:', e));
    }

    // 缺陷1:未配置 Key 且官方试用代理已开通时,先走试用额度;额度用尽/通道失败再落 Mock
    const trialLeft = trialRemainingTokens(trialTokensUsedRef.current);
    const usedTrial = !currentApiKey && trialLeft > 0 && Boolean(TRIAL_PROXY_BASE_URL);

    if (style === 'translate') {
      const autoTarget = resolveTranslateTarget(text);
      const currentTarget = stateRef.current.translateTarget;
      let syncTarget = currentTarget;
      if (!currentTarget) {
        syncTarget = autoTarget;
      } else if (currentTarget === 'en' && autoTarget === 'zh-Hans') {
        syncTarget = 'zh-Hans';
      } else if (currentTarget === 'zh-Hans' && autoTarget === 'en') {
        syncTarget = 'en';
      }
      if (syncTarget !== currentTarget) {
        stateRef.current.translateTarget = syncTarget;
        setTranslateTarget(syncTarget);
        adapters.storageProvider.set('translateTarget', syncTarget).catch(() => {});
      }
    }

    const streamConfig: StreamConfig = {
      style,
      userInstruction: customInstruction,
      personaPrompt: stateRef.current.activePersonaPrompt || undefined,
      packPrompt: stateRef.current.activePackPrompt || undefined,
      // 缺陷5/6/8:个人词库硬约束 + 文风标杆 few-shot + 宿主应用细粒度适配 + LaTeX 保护
      glossaryPrompt: glossaryPromptText,
      styleSamplesPrompt: buildStyleSamplesPrompt(styleSamples),
      appStylePrompt: buildAppStylePrompt(stateRef.current.lastChatApp),
      latexGuard: hasLatexMarkers(text),
      // 翻译模式：目标语言逐次注入系统提示词（专家提示词与翻译互斥，翻译优先）
      customPrompt: style === 'translate'
        ? buildTranslateSystemPrompt(stateRef.current.translateTarget, text)
        : stateRef.current.activeExpert
          ? buildExpertSystemPrompt(stateRef.current.activeExpert)
          : undefined,
      apiKey: usedTrial ? 'trial' : currentApiKey || undefined,
      baseUrl: usedTrial ? `${TRIAL_PROXY_BASE_URL.replace(/\/+$/, '')}/chat/completions` : currentEndpoint || undefined,
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
                  // refine 路径传入的 text 是整段 prompt,历史"原文"要显示真实对话原文
                  originalText: historyOriginalText?.trim() || text,
                  polishedText: finalText.trim(),
                  style,
                  instruction: customInstruction,
                  model: config.model,
                  tokens,
                  durationMs: duration,
                });
                // 缺陷8 LaTeX 保护后校验:公式/命令被改动时明确提醒,不静默吞掉
                const latexLost = findLatexViolations(text, finalText);
                if (latexLost.length) {
                  showToast(`⚠ ${latexLost.length} 处 LaTeX 标记疑似被改动：${latexLost.slice(0, 2).join(' ')}`, 4000);
                }
              }
              return finalText;
            });
            // 缺陷1:试用通道按次记账(优先服务端 tokens,缺失则本地保守估算)
            if (usedTrial) {
              const used = tokens > 0 ? tokens : estimateTokens(`${text}`);
              trialTokensUsedRef.current += used;
              const total = trialTokensUsedRef.current;
              setTrialTokensUsed(total);
              adapters.storageProvider.set('trialTokensUsed', total).catch(() => {});
              if (trialRemainingTokens(total) <= 0) {
                showToast('本期试用额度已用完：配置个人 API Key 可继续无限制使用', 4000);
              }
            }
          },
          onError: async (err) => {
            if (currentSignal.aborted) return;
            // 缺陷1:官方试用通道不可用时,静默回落 Mock 演示,不把错误甩给新用户
            if (usedTrial) {
              console.warn('[Trial] proxy failed, falling back to demo mode:', err);
              showToast('官方试用通道暂不可用，已切换演示模式；配置个人 API Key 可解锁完整能力', 4000);
              setPolishedText('');
              await runStream({ ...config, apiKey: undefined, baseUrl: undefined });
              return;
            }
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
  }, [adapters, apiKey, endpoint, model, glossaryPromptText, styleSamples]);

  // Global shortcut and mouse-selection listeners are registered once. Keep the
  // callback they invoke fresh instead of leaving the initial no-op placeholder.
  stateRef.current.handleStartPolish = handleStartPolish;
  stateRef.current.activateTranslate = activateTranslate;

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
          draft_reply: '周五前给你，主体已经跑通了',
          clarify_options: packChips(['积极承诺（周五准时交付）', '委婉缓冲（周五给初稿）', '追问细节（对齐确认清单）']),
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
      customPrompt: buildScreenReplySystemPrompt(stateRef.current.activePersonaPrompt, stateRef.current.activePack),
      apiKey: currentApiKey || undefined,
      baseUrl: currentEndpoint || undefined,
      model: currentModel || undefined,
      temperature: 0,
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
              parsed = parseModelJson<ScreenReplyAnalysis>(noThink);
            } catch {
              const fallbackMsg = existingHint?.trim() || '对方发来的消息';
              parsed = {
                conversation: [],
                last_message_from_other: fallbackMsg,
                draft_reply: noThink.trim(),
                clarify_options: packChips(['更正式一点', '热情答应', '婉言谢绝']),
              };
            }

            if (parsed) {
              const hasValidConv = (parsed.conversation && parsed.conversation.length > 0) || Boolean(parsed.last_message_from_other);
              if (!hasValidConv) {
                // Non-chat window or no chat bubbles found
                setScreenReplyAnalysis(null);
                const infoMsg = parsed.ambiguity || '未在截图中识别到聊天气泡，请在微信/钉钉等聊天窗口中使用';
                showToast(infoMsg, 4000);
                return;
              }

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
              showToast('当前模型不支持读图，已切换为文本智能回复', 3000);
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
    setPolishedText('正在构思回复...');
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
          draft_reply: '好，这个我来推进，有进展同步你',
          clarify_options: packChips(['积极推进（全力落实）', '严谨对齐（确认排期）', '委婉缓冲（稍后答复）']),
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
      customPrompt: buildTextReplySystemPrompt(stateRef.current.activePersonaPrompt, stateRef.current.activePack),
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
              parsed = parseModelJson<ScreenReplyAnalysis>(rawOutput);
            } catch {
              parsed = {
                conversation: [{ sender: 'other', text: messageText }],
                last_message_from_other: messageText,
                draft_reply: rawOutput.trim(),
                clarify_options: packChips(['积极推进/正面答复', '严谨对齐/确认细节', '委婉缓冲/礼貌借过']),
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
    const refinePrompt = buildScreenReplyRefinePrompt(conversation, instruction, activePersonaPrompt, activePackPrompt, glossaryPromptText);
    const historyOriginal = analysis?.last_message_from_other
      || conversation.filter((c) => c.sender === 'other').slice(-1)[0]?.text
      || undefined;
    handleStartPolish(refinePrompt, 'reply', chipText, undefined, historyOriginal);
  }, [handleStartPolish, attachedFiles, activePersonaPrompt, activePackPrompt, glossaryPromptText]);

  // 飞书智能应答追踪循环（多模态视口滚动 + 双模式应答）
  useEffect(() => {
    if (!feishuCopilotEnabled || !isTauri) {
      setFeishuCopilotStatus('');
      return;
    }

    let mounted = true;
    feishuLastScreenshotRef.current = '';
    const pollFeishu = async () => {
      if (!mounted || feishuPollingActiveRef.current) return;
      if (feishuCopilotMode === 'autopilot' && Date.now() < feishuAutoPilotCooldownUntilRef.current) {
        setFeishuCopilotStatus('自动应答冷却中，防止重复发送');
        return;
      }
      feishuPollingActiveRef.current = true;
      setFeishuCopilotStatus('正在检查当前聊天窗口的新消息…');

      try {
        // 监控只读当前视口，避免每轮滚动聊天窗口、重复编码历史截图。
        const captures = await invoke<string[]>('capture_feishu_multi_turn_context', {
          scrollUpSteps: 1,
          processName: stateRef.current.lastChatApp || null,
        });

        if (!captures || captures.length === 0 || !mounted) {
          setFeishuCopilotStatus('未找到可读取的聊天窗口');
          return;
        }

        const latestShot = captures[captures.length - 1];
        const currentEndpoint = endpoint.trim();
        const currentKey = apiKey.trim();
        const currentModel = model.trim();

        if (!currentKey || !currentEndpoint) {
          setFeishuCopilotStatus('请先配置并保存 API Key');
          return;
        }
        if (latestShot === feishuLastScreenshotRef.current) {
          setFeishuCopilotStatus('监控中 · 画面无变化');
          return;
        }
        feishuLastScreenshotRef.current = latestShot;

        // 2. 调用多模态模型判断是否有新问题
        const sysPrompt = buildFeishuCopilotSystemPrompt(activePersonaPrompt);
        const userPrompt = buildFeishuCopilotUserPrompt();

        let rawOutput = '';
        await adapters.llmTransport.streamChat(
          {
            text: userPrompt,
            config: {
              baseUrl: currentEndpoint,
              apiKey: currentKey,
              model: currentModel,
              style: 'reply',
              customPrompt: sysPrompt,
              imageDataUrl: latestShot,
              temperature: 0,
            },
          },
          {
            onChunk: (delta) => {
              rawOutput += delta;
            },
            onDone: async () => {
              if (!mounted) return;
              try {
                const parsed = parseModelJson<Record<string, any>>(rawOutput);

                if (parsed && parsed.has_new_question && parsed.suggested_reply?.trim()) {
                  const replyText = parsed.suggested_reply.trim();
                  const questionSummary = parsed.question_summary || replyText;
                  const isAutoPilot = feishuCopilotMode === 'autopilot';

                  if (isAutoPilot && parsed.latest_message_from !== 'other') {
                    setFeishuCopilotStatus('自动应答已跳过：无法确认最新消息来自对方');
                    return;
                  }

                  // 避免同条消息死循环重复发送
                  if (feishuLastRepliedSummaryRef.current === questionSummary) {
                    setFeishuCopilotStatus('监控中 · 最新问题已处理');
                    return;
                  }
                  // 3. 执行应答：人机协同模式（预填输入框）vs 全自动模式（自动发送）
                  try {
                    await invoke('send_to_feishu_input', {
                      text: replyText,
                      autoSubmit: isAutoPilot,
                      processName: stateRef.current.lastChatApp || null,
                    });
                  } catch (deliveryError) {
                    feishuLastScreenshotRef.current = '';
                    const message = `${isAutoPilot ? '自动发送' : '预填'}失败：${String(deliveryError).slice(0, 80)}`;
                    setFeishuCopilotStatus(message);
                    showToast(message, 5000);
                    return;
                  }
                  feishuLastRepliedSummaryRef.current = questionSummary;

                  if (isAutoPilot) {
                    // ponytail: global 15s cooldown covers Feishu UI settling;
                    // replace with per-chat message IDs if a native Feishu API is introduced.
                    feishuAutoPilotCooldownUntilRef.current = Date.now() + 15_000;
                    setFeishuCopilotStatus('已自动回复最新问题');
                    showToast(`[自动应答] 已自动回复 ${parsed.sender_name || '对方'}: ${replyText.slice(0, 20)}...`, 4000);
                  } else {
                    setFeishuCopilotStatus('已预填到当前聊天输入框，等待你确认发送');
                    showToast(`[聊天协同助手] 已将回复预填至当前聊天输入框，按回车即可发送`, 4500);
                  }

                  // 记入历史记录
                  addHistoryRecord({
                    originalText: `[聊天·${parsed.sender_name || '对方'}] ${questionSummary}`,
                    polishedText: replyText,
                    style: 'reply',
                    model: currentModel,
                    tokens: 0,
                    durationMs: 0,
                  });
                } else {
                  setFeishuCopilotStatus('监控中 · 暂无需要回复的新问题');
                }
              } catch (e) {
                feishuLastScreenshotRef.current = '';
                console.warn('[Feishu Copilot] parse output error:', e, 'rawOutput:', rawOutput);
                setFeishuCopilotStatus('监控中 · 画面暂未识别到新提问');
              }
            },
            onError: (err) => {
              feishuLastScreenshotRef.current = '';
              console.warn('[Feishu Copilot] stream error:', err);
              setFeishuCopilotStatus(`识别请求失败：${String(err).slice(0, 60)}`);
            },
          }
        );
      } catch (e) {
        feishuLastScreenshotRef.current = '';
        console.warn('[Feishu Copilot] polling error:', e);
        setFeishuCopilotStatus(`运行失败：${String(e).slice(0, 60)}`);
      } finally {
        feishuPollingActiveRef.current = false;
      }
    };

    void pollFeishu();
    // 10 秒轮询；相同画面不调用模型。
    const timer = setInterval(() => {
      void pollFeishu();
    }, 10_000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [feishuCopilotEnabled, feishuCopilotMode, isTauri, apiKey, endpoint, model, activePersonaPrompt, adapters, showToast]);


  // Load Saved Settings on Mount
  useEffect(() => {
    const loadConfig = async () => {
      const styleOverrideAtStart = styleOverrideRef.current;
      const config = await adapters.storageProvider.getAll();
      const savedKey = String(config.apiKey || '');
      const savedEndpoint = String(config.endpoint || 'https://api.deepseek.com/v1/chat/completions');
      const savedModel = String(config.model || 'deepseek-chat');
      const savedStyle = (config.defaultStyle || 'academic') as PolishStyle;
      const savedAutoPopup = Boolean(config.autoCopyPopup ?? true);
      const savedClipboardTrigger = Boolean(config.clipboardTriggerEnabled ?? false);
      const savedReadScreenshot = Boolean(config.readChatScreenshot ?? true);
      const savedWakeShortcut = String(config.wakeShortcut || DEFAULT_SHORTCUT);
      const savedAutostart = Boolean(config.autostart ?? false);
      const savedPersona = (config.persona || 'standard') as PersonaType;
      const savedCustomPersona = String(config.customPersonaPrompt || '');
      // 旧默认 'general' 迁移到智能识别；显式选过行业包的用户保持原选择
      const rawPack = String(config.industryPack || 'auto');
      const savedPack = rawPack === 'general' ? 'auto' : rawPack;
      const savedCustomActions = Array.isArray(config.customActions) ? (config.customActions as CustomAction[]) : [];
      const savedGlossary = Array.isArray(config.glossary) ? (config.glossary as GlossaryRule[]) : [];
      const savedStyleSamples = Array.isArray(config.styleSamples) ? (config.styleSamples as string[]) : [];
      const savedOpacity = Number(config.windowOpacity ?? 1);
      // 兼容旧皮肤值：jade→dark, redwhite→light
      const savedSkin = config.skin === 'redwhite' || config.skin === 'light' ? 'light' : 'dark';
      const rawDsn = String(config.glitchtipDsn || '');
      const savedDsn = rawDsn.includes('@localhost:3000/1') ? '' : rawDsn;

      if (savedKey) setApiKey(savedKey);
      if (savedEndpoint) setEndpoint(savedEndpoint);
      if (savedModel) setModel(savedModel);
      if (!styleOverrideAtStart && !styleOverrideRef.current && savedStyle) setActiveStyle(savedStyle);
      if (savedPersona) setPersona(savedPersona);
      if (savedCustomPersona) setCustomPersonaPrompt(savedCustomPersona);
      if (savedPack) setIndustryPack(savedPack);
      if (savedCustomActions.length > 0) setCustomActions(savedCustomActions);
      if (savedGlossary.length > 0) setGlossary(savedGlossary);
      if (savedStyleSamples.length > 0) setStyleSamples(savedStyleSamples);
      const savedTrialUsed = Number(config.trialTokensUsed ?? 0);
      trialTokensUsedRef.current = Number.isFinite(savedTrialUsed) && savedTrialUsed > 0 ? savedTrialUsed : 0;
      setTrialTokensUsed(trialTokensUsedRef.current);
      setSkin(savedSkin);
      // 智能模式默认开启；用户手动选过风格后关闭并记住
      const savedAutoMode = config.autoMode === undefined ? true : Boolean(config.autoMode);
      if (!styleOverrideAtStart && !styleOverrideRef.current) {
        setAutoMode(savedAutoMode);
        stateRef.current.autoMode = savedAutoMode;
      }
      const savedTranslateTarget = String(config.translateTarget || 'en');
      if (TRANSLATE_TARGETS.some((t) => t.id === savedTranslateTarget)) {
        setTranslateTarget(savedTranslateTarget as TranslateTargetId);
        stateRef.current.translateTarget = savedTranslateTarget as TranslateTargetId;
      }
      if (savedDsn) setGlitchtipDsn(savedDsn);
      if (config.feishuCopilotEnabled !== undefined) {
        setFeishuCopilotEnabled(Boolean(config.feishuCopilotEnabled));
      }
      if (config.feishuCopilotMode === 'autopilot' || config.feishuCopilotMode === 'collaborative') {
        setFeishuCopilotMode(config.feishuCopilotMode);
      }

      const savedHistory = (config.generationHistory || []) as HistoryRecord[];
      if (Array.isArray(savedHistory)) setHistory(savedHistory);

      const savedDraft = (config.activeDraft || null) as DraftSnapshot | null;
      if (savedDraft && savedDraft.timestamp && Date.now() - savedDraft.timestamp < 15 * 60 * 1000) {
        if (savedDraft.polishedText || savedDraft.originalText) {
          setRecoverableDraft(savedDraft);
        }
      }

      setAutoCopyPopup(savedAutoPopup);
      setClipboardTriggerEnabled(savedClipboardTrigger);
      stateRef.current.autoCopyPopup = savedAutoPopup;
      // 应用持久化的窗口透明度（仅深色主题支持；浅色一律 100% 不透明）。
      // 注意用 savedSkin 而非 skin：setSkin 是异步 state,这里读闭包会拿到过期值,
      // 浅色用户启动时 savedOpacity 曾被照样应用(浅色半透明灰屏)。
      const opacity = savedSkin === 'light'
        ? 1
        : Number.isFinite(savedOpacity) ? Math.min(1, Math.max(0.2, savedOpacity)) : 1;
      setWindowOpacity(opacity);
      if (isTauri) {
        invoke('set_window_opacity', { opacity }).catch((e) => console.warn('apply opacity failed:', e));
      }
      setReadChatScreenshot(savedReadScreenshot);
      stateRef.current.readChatScreenshot = savedReadScreenshot;
      if (savedWakeShortcut) setWakeShortcut(savedWakeShortcut);
      setAutostart(savedAutostart);
      persistedNativeSettingsRef.current = {
        autoCopyPopup: savedAutoPopup,
        clipboardTriggerEnabled: savedClipboardTrigger,
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
            Promise.all([
              invoke('set_auto_popup_enabled', { enabled: savedAutoPopup }),
              invoke('set_clipboard_monitor_enabled', { enabled: savedClipboardTrigger }),
            ]),
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
      unlistens.push(listen<number>('runbi://selection-invalidated', ({ payload: generation }) => {
        if (generation <= selectionGenerationRef.current) return;
        selectionGenerationRef.current = generation;
        // The ref is cleared synchronously on expansion, before its IPC await.
        if (capsuleInfoRef.current || capsuleFadeTimerRef.current) {
          stateRef.current.hideCapsule(true, true);
        } else if (stateRef.current.uiMode === "panel" && stateRef.current.activeStyle === "translate") {
          invoke('append_log', { msg: "frontend: stale translate panel reset on invalidation" }).catch(() => {});
          setPolishedText("");
          setOriginalText("");
          stateRef.current.originalText = "";
        }
      }).catch((e) => {
        console.warn('listen selection invalidation failed:', e);
        return undefined;
      }));
      unlistens.push(listen<{ action?: CapsuleAction; generation?: number }>('runbi://capsule-action', ({ payload }) => {
        const info = capsuleInfoRef.current;
        if (stateRef.current.uiMode !== 'capsule' || !info || !payload?.action) return;
        if (
          typeof payload.generation === 'number'
          && typeof info.generation === 'number'
          && payload.generation !== info.generation
        ) {
          return;
        }
        invoke('append_log', { msg: `frontend: native capsule action=${payload.action}` }).catch(() => {});
        stateRef.current.handleCapsuleAction(payload.action);
      }).catch((e) => {
        console.warn('listen capsule-action failed:', e);
        return undefined;
      }));
      unlistens.push(listen('runbi://captured-selection', (event: any) => {
        const __p = event?.payload || {};
        const transition = capsuleTransitionRef.current;
        if (transition) {
          if (Date.now() >= transition.until) {
            capsuleTransitionRef.current = null;
          } else {
            const sameGeneration = typeof transition.generation === 'number'
              && typeof __p.generation === 'number'
              && transition.generation === __p.generation;
            const sameText = typeof __p.text === 'string' && __p.text === transition.text;
            if (sameGeneration || sameText) {
              invoke('append_log', {
                msg: `frontend: ignored stale selection after capsule action t=${__p.trigger}`,
              }).catch(() => {});
              return;
            }
            if (
              typeof transition.generation === 'number'
              && typeof __p.generation === 'number'
              && __p.generation > transition.generation
            ) {
              capsuleTransitionRef.current = null;
            }
          }
        }
        // A capsule action owns the text already captured in capsuleInfoRef.
        // Native window restoration can produce one late selection event from
        // the click itself; letting it through would route the same action via
        // the saved polish/auto mode and overwrite the translate panel.
        if (capsuleActionRef.current === 'expanding') {
          invoke('append_log', { msg: `frontend: ignored selection during capsule expansion t=${__p.trigger}` }).catch(() => {});
          return;
        }
        if (shouldShowCapsule(__p) && typeof __p.generation === 'number') {
          if (__p.generation < selectionGenerationRef.current) return;
          selectionGenerationRef.current = __p.generation;
        }
        // A shortcut or another direct trigger supersedes a visible capsule.
        // Clear the compact DOM synchronously because the native shortcut path
        // has already resized/focused the full window before emitting here.
        if (!shouldShowCapsule(__p) && stateRef.current.uiMode === 'capsule') {
          clearCapsuleTimers();
          ++capsuleRevisionRef.current;
          capsuleActionRef.current = null;
          capsuleInfoRef.current = null;
          stateRef.current.uiMode = 'panel';
          setCapsule(null);
          setCapsuleVisible(true);
          setUiMode('panel');
        }
        invoke('append_log', { msg: `frontend: event received t=${__p.trigger} hs=${__p.hasScreenshot} keys=[${Object.keys(__p).join(',')}] text=${String(__p.text || '').slice(0, 24)}` }).catch(() => {});
        setShowOnboarding(false);
        setShowSettings(false);
        setShowHistory(false);
        adapters.storageProvider.set('onboardingDone', true).catch(() => {});
        setShowEpoch((n) => n + 1); // remount panel container → replay enter animation
        invoke('append_log', { msg: 'frontend: epoch bumped' }).catch(() => {});
        // 新抓取覆盖内置库浮层与并行对比视图
        setShowScriptLibrary(false);
        setShowExpertPicker(false);
        if (stateRef.current.showParallel || parallelControllersRef.current.size > 0) {
          stopAllParallel();
          setShowParallel(false);
          setParallelSessions([]);
          applyParallelWindowSize(false);
        }
        // 记录窗口标题/来源应用/选中文本，供话术库做行业匹配
        setContextHint(
          [event?.payload?.windowTitle, event?.payload?.sourceApp, event?.payload?.text]
            .filter(Boolean)
            .join('\n')
        );
        const isSensitiveBlocked = event?.payload?.trigger === 'sensitive-blocked';
        const isScreenReply = isScreenReplyPayload(event?.payload);
        stateRef.current.hasScreenshot = isScreenReply;
        // 记住最近的聊天应用，供面板内“重新抓取”后台截图使用
        if (event?.payload?.sourceApp && event.payload.sourceApp !== 'runbi-desktop.exe') {
          stateRef.current.lastChatApp = String(event.payload.sourceApp);
        }
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
            showToast('已捕获聊天界面，正在识别对话并构思回复...');
            invoke('append_log', { msg: 'frontend: screen-reply → vision analysis start' }).catch(() => {});
            stateRef.current.handleStartScreenReplyAnalysis(hint);
          }
        } else if (event?.payload?.text) {
          const captured = event.payload.text;
          const screenshot = event.payload.screenshot || null;
          // A new text selection is never the previous screen-reply session.
          // Clear that context before handling capsule actions so translation
          // and text-reply entries cannot inherit the old context UI.
          setScreenReplyAnalysis(null);
          stateRef.current.screenReplyAnalysis = null;
          setCurrentScreenshot(screenshot);
          setOriginalText(captured);
          stateRef.current.originalText = captured;
          stateRef.current.currentScreenshot = screenshot;

          // Automatic text capture (mouse selection or clipboard) may only
          // arm the capsule. Shortcut-originated events continue below and may
          // open the full panel directly.
          if (shouldShowCapsule(event?.payload)) {
            const autoTarget = resolveTranslateTarget(captured);
            setTranslateTarget(autoTarget);
            stateRef.current.translateTarget = autoTarget;
            stateRef.current.armCapsule({
              ts: Date.now(),
              text: captured,
              sourceApp: event.payload.sourceApp,
              windowTitle: event.payload.windowTitle,
              screenshot,
              generation: event.payload.generation,
            });
            return;
          }

          const capsuleAction = event?.payload?.capsuleAction;
          if (capsuleAction === 'reply') {
            setActiveStyle('reply');
            stateRef.current.activeStyle = 'reply';
            stateRef.current.handleStartTextReplyAnalysis(captured);
          } else if (capsuleAction === 'translate') {
            // Keep the capsule path identical to the header/shortcut path.
            stateRef.current.activateTranslate(captured, screenshot);
          // 智能模式：AI 依据文字/窗口自动判断风格与行业；手动模式：沿用用户固定的风格
          } else if (stateRef.current.autoMode) {
            if (stateRef.current.activeStyle === 'translate') {
              stateRef.current.activateTranslate(captured, screenshot, undefined, true);
            } else {
              const cls = classifyContext({
                text: captured,
                sourceApp: event.payload.sourceApp,
                windowTitle: event.payload.windowTitle,
              });
              const targetStyle = cls.style;
              stateRef.current.activeStyle = targetStyle;
              setActiveStyle(targetStyle);

              if (cls.confidence >= 0.7 && targetStyle !== 'polished') {
                showToast(`已智能识别【${STYLE_NAMES[targetStyle]}】(${cls.reason})`);
              }

              if (targetStyle === 'reply') {
                stateRef.current.handleStartTextReplyAnalysis(captured);
              } else if (targetStyle === 'translate') {
                stateRef.current.activateTranslate(captured, screenshot, undefined, true);
              } else {
                setScreenReplyAnalysis(null);
                stateRef.current.handleStartPolish(captured, targetStyle, undefined, screenshot);
              }
            }
          } else {
            if (stateRef.current.activeStyle === 'reply') {
              stateRef.current.handleStartTextReplyAnalysis(captured);
            } else if (stateRef.current.activeStyle === 'translate') {
              stateRef.current.activateTranslate(captured, screenshot);
            } else {
              setScreenReplyAnalysis(null);
              stateRef.current.handleStartPolish(captured, stateRef.current.activeStyle, undefined, screenshot);
            }
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

      // 选区没了(鼠标 hook 检测到胶囊挂载期间的普通单击)→ 收胶囊。
      // 面板态忽略:面板不受选区生命周期约束。
      unlistens.push(listen('runbi://selection-cleared', () => {
        if (stateRef.current.uiMode === 'capsule' && capsuleActionRef.current !== 'expanding') {
          stateRef.current.hideCapsule();
        }
      }).then((un) => un, (e) => { console.warn('listen selection-cleared failed:', e); return undefined; }));

      // 全局快捷键 F9：重新截取屏幕上下文并重跑当前流程
      unlistens.push(listen('runbi://recapture', () => {
        void stateRef.current.handleRecapture();
      }).then((un) => un, (e) => { console.warn('listen recapture failed:', e); return undefined; }));

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
        clipboardTriggerEnabled,
        readChatScreenshot,
        autostart,
        wakeShortcut: sc,
        persona,
        customPersonaPrompt: customPersonaPrompt.trim(),
        industryPack,
        autoMode,
        // 只保存名称和指令都填好的项：半填的残项会占按钮位却不显示，曾让用户以为按钮丢了
        customActions: customActions.filter((a) => a.name.trim() && a.prompt.trim()),
        // 词库只保存 from 非空的规则(replace 还要求 to 非空);文风样本 trim 后滤空段
        glossary: glossary.filter((g) => g.from.trim() && (g.kind !== 'replace' || (g.to ?? '').trim())),
        styleSamples: styleSamples.map((s) => s.trim()).filter(Boolean),
        skin,
        glitchtipDsn: glitchtipDsn.trim(),
        feishuCopilotEnabled,
        feishuCopilotMode,
      });

      if (isTauri) {
        const previous = persistedNativeSettingsRef.current;
        const nativeUpdates: Promise<unknown>[] = [];
        if (!previous || previous.autoCopyPopup !== autoCopyPopup) {
          nativeUpdates.push(invoke('set_auto_popup_enabled', { enabled: autoCopyPopup }));
        }
        if (!previous || previous.clipboardTriggerEnabled !== clipboardTriggerEnabled) {
          nativeUpdates.push(invoke('set_clipboard_monitor_enabled', { enabled: clipboardTriggerEnabled }));
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
        clipboardTriggerEnabled,
        autostart,
        wakeShortcut: sc,
      };
      stateRef.current.autoCopyPopup = autoCopyPopup;
      stateRef.current.readChatScreenshot = readChatScreenshot;
      setShowSettings(false);
      showToast(feishuCopilotEnabled
        ? `设置已保存，聊天${feishuCopilotMode === 'collaborative' ? '人机协同' : '自动应答'}正在监控`
        : '设置已安全保存并即时生效');
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
        showToast('反馈已收到，非常感谢您的支持！', 3000);
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
    if (activeStyle === 'translate') {
      activateTranslate(originalText, currentScreenshot, translateTarget);
    } else {
      handleStartPolish(originalText, activeStyle, undefined, currentScreenshot);
    }
  };

  // Style Change（点任意风格即退出专家模式与智能模式：风格与专家是同一"方式"槽位，互斥）
  const handleStyleChange = (newStyle: PolishStyle) => {
    if (newStyle === 'translate') {
      activateTranslate(originalText, currentScreenshot);
      return;
    }
    translationPanelRef.current = false;
    if (stateRef.current.activeExpert) {
      stateRef.current.activeExpert = null;
      setActiveExpert(null);
    }
    setAutoMode(false);
    stateRef.current.autoMode = false;
    if (newStyle !== 'reply') lastPolishStyleRef.current = newStyle;
    setActiveStyle(newStyle);
    handleStartPolish(originalText, newStyle, undefined, currentScreenshot);
  };

  // ---- 工作模式：显式可切换的第一层（润色 = 改写我的文字；回复 = 帮我想回复）----
  const handleSwitchToPolish = useCallback(() => {
    if (stateRef.current.activeStyle !== 'reply' && stateRef.current.activeStyle !== 'translate' && !stateRef.current.screenReplyAnalysis) return;
    translationPanelRef.current = false;
    stateRef.current.activeExpert = null;
    setActiveExpert(null);
    setScreenReplyAnalysis(null);
    const target = lastPolishStyleRef.current;
    stateRef.current.activeStyle = target;
    setActiveStyle(target);
    const text = stateRef.current.originalText;
    if (text.trim()) handleStartPolish(text, target, undefined);
  }, [handleStartPolish]);

  // 翻译模式语言条：切换目标语言 → 持久化并对当前原文立即重译
  const handleTranslateTargetChange = useCallback((id: TranslateTargetId) => {
    setTranslateTarget(id);
    stateRef.current.translateTarget = id;
    adapters.storageProvider.set('translateTarget', id).catch(() => {});
    if (stateRef.current.activeStyle === 'translate' && stateRef.current.originalText.trim()) {
      stateRef.current.handleStartPolish(stateRef.current.originalText, 'translate', undefined, currentScreenshot);
    }
  }, [adapters.storageProvider, currentScreenshot]);

  const handleSwitchToReply = useCallback(() => {
    if (stateRef.current.activeStyle === 'reply') return;
    translationPanelRef.current = false;
    setScreenReplyAnalysis(null);
    stateRef.current.activeStyle = 'reply';
    setActiveStyle('reply');
    const text = stateRef.current.originalText;
    if (text.trim()) stateRef.current.handleStartTextReplyAnalysis(text);
  }, []);

  const handleSwitchToTranslate = useCallback(() => {
    const text = stateRef.current.originalText;
    if (text.trim()) {
      activateTranslate(text, null);
    } else {
      setActiveStyle('translate');
      stateRef.current.activeStyle = 'translate';
    }
  }, [activateTranslate]);

  // ---- 多专家并行：同一输入并发发给 2-4 位专家，各自独立流式 ----
  const applyParallelWindowSize = useCallback((wide: boolean) => {
    if (!isTauri) return;
    getCurrentWindow()
      .setSize(new LogicalSize(wide ? 1000 : 560, wide ? 660 : 520))
      .catch((e) => console.warn('set window size failed:', e));
  }, [isTauri]);

  const stopAllParallel = useCallback(() => {
    for (const c of parallelControllersRef.current.values()) c.abort();
    parallelControllersRef.current.clear();
  }, []);

  const stopParallelOne = useCallback((id: string) => {
    const c = parallelControllersRef.current.get(id);
    if (!c) return;
    c.abort();
    parallelControllersRef.current.delete(id);
    setParallelSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: 'done' as const } : s))
    );
  }, []);

  const closeParallel = useCallback(() => {
    stopAllParallel();
    setShowParallel(false);
    setParallelSessions([]);
    applyParallelWindowSize(false);
  }, [stopAllParallel, applyParallelWindowSize]);

  const handleStartParallel = useCallback(
    (experts: ExpertAgent[]) => {
      const picked = experts.slice(0, 4);
      if (picked.length === 0) return;
      const text = stateRef.current.originalText;
      if (!text.trim()) {
        showToast('没有可生成的文本，请先划词或输入内容');
        return;
      }
      // 结束可能存在的单流生成，清掉上一轮并行会话
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      stopAllParallel();
      setIsGenerating(false);
      setShowExpertPicker(false);
      setShowScriptLibrary(false);

      const stamp = Date.now();
      const sessions: ParallelSession[] = picked.map((e, i) => ({
        id: `${stamp}-${i}`,
        expertId: e.id,
        expertName: `${e.emoji} ${e.name}`.trim(),
        text: '',
        status: 'streaming',
      }));
      setParallelSessions(sessions);
      setShowParallel(true);
      setScreenReplyAnalysis(null);
      applyParallelWindowSize(true);

      const style = stateRef.current.activeStyle;
      const baseConfig = {
        style,
        apiKey: stateRef.current.apiKey || apiKey || undefined,
        baseUrl: stateRef.current.endpoint || endpoint || undefined,
        model: stateRef.current.model || model || undefined,
        temperature: 0.7,
        personaPrompt: stateRef.current.activePersonaPrompt || undefined,
        packPrompt: stateRef.current.activePackPrompt || undefined,
      };

      picked.forEach((expert, i) => {
        const session = sessions[i];
        const controller = new AbortController();
        parallelControllersRef.current.set(session.id, controller);
        const signal = controller.signal;
        let acc = '';
        const patch = (p: Partial<ParallelSession>) =>
          setParallelSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, ...p } : s)));

        adapters.llmTransport
          .streamChat(
            { text, config: { ...baseConfig, customPrompt: buildExpertSystemPrompt(expert) } },
            {
              onChunk: (delta) => {
                if (signal.aborted) return;
                acc += delta;
                patch({ text: acc });
              },
              onDone: (duration, tokens) => {
                if (signal.aborted) return;
                parallelControllersRef.current.delete(session.id);
                patch({ status: 'done', durationMs: duration, totalTokens: tokens });
                if (acc.trim()) {
                  addHistoryRecord({
                    originalText: text,
                    polishedText: acc.trim(),
                    style,
                    instruction: `专家:${expert.name}`,
                    model: baseConfig.model,
                    tokens,
                    durationMs: duration,
                  });
                }
              },
              onError: (err) => {
                if (signal.aborted) return;
                parallelControllersRef.current.delete(session.id);
                patch({ status: 'error', error: err });
              },
              onAbort: () => {
                parallelControllersRef.current.delete(session.id);
                patch({ status: 'done' });
              },
            },
            signal
          )
          .catch((e: unknown) => {
            if (signal.aborted) return;
            parallelControllersRef.current.delete(session.id);
            patch({ status: 'error', error: String((e as Error)?.message || e) });
          });
      });
    },
    [adapters, apiKey, endpoint, model, showToast, stopAllParallel, applyParallelWindowSize, addHistoryRecord]
  );

  const handleUseTemplate = useCallback(
    async (t: ScriptTemplate, mode: 'copy' | 'reference') => {
      if (mode === 'copy') {
        const ok = await adapters.textReplacer.copyToClipboard(t.template);
        showToast(ok ? `已复制「${t.sectionTitle}」模板，粘贴即可使用` : '复制失败');
        return;
      }
      setShowScriptLibrary(false);
      const instruction = `参考下面的行业话术模板（把[变量]替换成贴合原文的合理内容）：\n【${t.sectionTitle}】适用场景：${t.scenario}\n${t.template}`;
      const analysis = stateRef.current.screenReplyAnalysis;
      showToast(`已按「${t.sectionTitle}」模板参考生成`);
      if (analysis) {
        const refinePrompt = buildScreenReplyRefinePrompt(
          analysis.conversation || [],
          instruction,
          activePersonaPrompt,
          activePackPrompt,
          glossaryPromptText
        );
        const historyOriginal = analysis?.last_message_from_other
          || (analysis?.conversation || []).filter((c) => c.sender === 'other').slice(-1)[0]?.text
          || undefined;
        handleStartPolish(refinePrompt, 'reply', t.sectionTitle, undefined, historyOriginal);
      } else {
        handleStartPolish(stateRef.current.originalText, stateRef.current.activeStyle, instruction);
      }
    },
    [adapters, showToast, handleStartPolish, activePersonaPrompt, activePackPrompt, glossaryPromptText]
  );

  const handleApplyExpert = useCallback(
    (expert: ExpertAgent) => {
      stateRef.current.activeExpert = expert;
      setActiveExpert(expert);
      setShowExpertPicker(false);
      setShowScriptLibrary(false);
      showToast(`已切换为专家「${expert.name}」`);
      // 已有文本时立即用新专家重新生成，所见即所得
      if (stateRef.current.originalText.trim() && !stateRef.current.screenReplyAnalysis) {
        handleStartPolish(stateRef.current.originalText, stateRef.current.activeStyle, undefined);
      }
    },
    [showToast, handleStartPolish]
  );

  const handleClearExpert = useCallback(() => {
    stateRef.current.activeExpert = null;
    setActiveExpert(null);
    showToast('已恢复默认润色风格');
  }, [showToast]);

  // 回到智能模式：AI 自动判断风格并立即按当前文本重新生成，所见即所得
  const handleAutoMode = useCallback(() => {
    stateRef.current.activeExpert = null;
    setActiveExpert(null);
    setAutoMode(true);
    stateRef.current.autoMode = true;
    showToast('智能模式：AI 自动判断风格与行业场景');
    const text = stateRef.current.originalText;
    if (text.trim() && !stateRef.current.screenReplyAnalysis) {
      const cls = classifyContext({ text, sourceApp: stateRef.current.lastChatApp });
      stateRef.current.activeStyle = cls.style;
      setActiveStyle(cls.style);
      handleStartPolish(text, cls.style, undefined);
    }
  }, [showToast, handleStartPolish]);

  // 重新截屏：后台无焦点重抓最近聊天窗口的截图，重跑当前屏幕分析/润色流程。
  // 供面板按钮、面板快捷键 R、全局快捷键 F9(经 runbi://recapture 事件)共用。
  const [isRecapturing, setIsRecapturing] = useState(false);
  const handleRecapture = useCallback(async () => {
    if (isRecapturing || !isTauri) return;
    setIsRecapturing(true);
    try {
      const fg = await invoke<{ sourceApp: string | null } | null>('get_foreground_info').catch(() => null);
      const fgApp = (fg as any)?.sourceApp as string | undefined;
      // 语义:重新截屏 = 截"用户眼前所见"。优先当前前台窗口;仅当前台就是 Runbi 自己
      // (面板聚焦)时才按 lastChatApp 后台抓源聊天窗口,否则前台是什么截什么。
      // 旧逻辑优先 lastChatApp,用户切窗口后再按 F9 会截到早已切走的旧窗口,
      // 分析结果与眼前所见对不上,读起来像模型在编造。
      const app = stateRef.current.lastChatApp;
      const useBackgroundApp = (!fgApp || fgApp.toLowerCase().includes('runbi'))
        && app && !app.toLowerCase().includes('runbi');
      if (useBackgroundApp) {
        await invoke('capture_app_screenshot', { processName: app });
      } else {
        await invoke('capture_foreground_screenshot');
      }
      stateRef.current.hasScreenshot = true;
      if (stateRef.current.screenReplyAnalysis || stateRef.current.activeStyle === 'reply') {
        showToast('已重新截取聊天窗口，重新分析中…');
        stateRef.current.handleStartScreenReplyAnalysis(undefined);
      } else {
        showToast('已重新截取屏幕，正在重新生成…');
        setScreenReplyAnalysis(null);
        stateRef.current.recaptureForceVision = true;
        stateRef.current.handleStartPolish(stateRef.current.originalText, stateRef.current.activeStyle, undefined, null);
      }
    } catch (e) {
      console.warn('recapture failed:', e);
      showToast('重新截屏失败，请确认目标窗口未最小化', 3000);
    } finally {
      setIsRecapturing(false);
    }
  }, [isRecapturing, isTauri, showToast]);
  stateRef.current.handleRecapture = handleRecapture;

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
    const autoSend = stateRef.current.activeStyle === 'reply' || Boolean(stateRef.current.screenReplyAnalysis);
    const res = await (adapters.textReplacer as any).replaceText(textToInsert, null, shouldHide, autoSend);
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
      // 缺陷3:贴回失败但文本已在剪贴板——弹常驻浮条(手动关闭);3.5s Toast 容易错过
      setPasteFallbackBar(true);
      showToast('贴回失败，已复制到剪贴板', 2000);
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
    if (stateRef.current.showParallel || parallelControllersRef.current.size > 0) {
      stopAllParallel();
      setShowParallel(false);
      setParallelSessions([]);
      applyParallelWindowSize(false);
    }
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
        // 胶囊态 Esc = 直接收走胶囊
        if (s.uiMode === 'capsule') {
          s.hideCapsule(true);
          return;
        }
        // 内置库浮层在最上层，优先关闭（浮层自己的 Esc 监听与这里同在 window，
        // stopPropagation 拦不住同 target 的其他监听，必须在这里先截住）
        if (s.showScriptLibrary || s.showExpertPicker) {
          setShowScriptLibrary(false);
          setShowExpertPicker(false);
          return;
        }
        if (s.showHistory) {
          setShowHistory(false);
          return;
        }
        if (s.showSettings) {
          setShowSettings(false);
          return;
        }
        if (s.showParallel) {
          closeParallel();
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
      if (typing || s.showSettings || s.showHistory || s.showParallel) return;

      // 面板聚焦时 R = 重新截屏（截图上下文才有意义）
      if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey && s.hasScreenshot) {
        e.preventDefault();
        void handleRecapture();
        return;
      }

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
      // 胶囊模式不随失焦隐藏:划词后焦点通常仍留在源应用,胶囊的退场
      // 由悬停离开/空闲淡出/Esc 负责(Raycast 式失焦即隐藏只适用面板)。
      if (panelBlurTimerRef.current) clearTimeout(panelBlurTimerRef.current);
      // The native capsule can activate the WebView when clicked. Its
      // captured-selection event can still arrive just after blur; defer the
      // panel-only hide so blur cannot hide a newly shown capsule.
      panelBlurTimerRef.current = setTimeout(() => {
        panelBlurTimerRef.current = null;
        const current = stateRef.current;
        if (current.uiMode === 'capsule') return;
        if (!current.isPinned && !current.isGenerating && !current.showSettings && !current.showHistory && !current.screenReplyAnalysis && !current.showParallel && !current.parallelRunning) {
          if (isTauri) invoke('hide_window').catch(() => {});
        }
      }, 120);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [handleReplace, handleStyleChange, closeParallel, isTauri, handleRecapture, handleClose]);

  const handleUpdateFound = useCallback(() => {
    if (updatePromptShownRef.current) return;
    updatePromptShownRef.current = true;
    if (capsuleArmTimerRef.current) clearTimeout(capsuleArmTimerRef.current);
    if (capsuleFadeTimerRef.current) clearTimeout(capsuleFadeTimerRef.current);
    capsuleArmTimerRef.current = null;
    capsuleFadeTimerRef.current = null;
    capsuleInfoRef.current = null;
    capsuleActionRef.current = null;
    stateRef.current.uiMode = 'panel';
    setUiMode('panel');
    setCapsule(null);
    setCapsuleVisible(false);
    void invoke('position_window_at_cursor', { isCapsule: false })
      .then(() => getCurrentWindow().show())
      .then(() => getCurrentWindow().setFocus())
      .catch((error) => console.warn('show update prompt failed:', error));
  }, []);

  // Use the entry guard as the render source for the main panel. This keeps
  // the visual contract stable even if an older async callback commits one
  // stale activeStyle value after the translation click.
  const renderedPanelStyle: PolishStyle = translationPanelRef.current ? 'translate' : activeStyle;

  // 缺陷2 微胶囊:独占整棵渲染树。窗口只有 196×44,若把胶囊塞进面板容器树,
  // 标题栏(shrink-0)先占满高度,胶囊被 overflow-hidden 裁出可视区——
  // 实测表现为"窗口存在且置顶,但胶囊永远看不见"。
  if (uiMode === 'capsule' && capsule) {
    return (
      <div className="flex h-screen w-screen items-center justify-center overflow-hidden bg-transparent font-sans select-none">
        <SelectionCapsule
          key={capsule.ts}
          visible={capsuleVisible}
          copied={capsuleCopied}
          onSearch={handleCapsuleSearch}
          onPolish={() => { void expandCapsule('polish'); }}
          onReply={() => { void expandCapsule('reply'); }}
          onTranslate={() => { void expandCapsule('translate'); }}
          onCopy={handleCapsuleCopy}
          onHoverChange={handleCapsuleHover}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-start overflow-hidden bg-transparent p-3 font-sans select-none">
      {/* Raycast Container (keyed by showEpoch so enter animation replays on each summon) */}
      <div key={showEpoch} className={`runbi-window runbi-enter relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl backdrop-blur-xl ${showParallel ? 'max-w-[1000px]' : 'max-w-[540px]'}`}>
        
        {/* Title & Drag Region */}
        <div
          data-tauri-drag-region
          className="flex shrink-0 items-center justify-between border-b border-white/10 bg-black/20 px-3 py-2 cursor-grab active:cursor-grabbing"
        >
          <div className="flex items-center gap-2.5">
            <div className="runbi-logo-tile flex h-7 w-7 items-center justify-center rounded-lg border">
              <RunbiLogo className="h-4 w-4" />
            </div>
            {/* 工作模式开关：当前所处模式显式可见、可一键切换（划词时 AI 也会自动选） */}
            <div
              className="flex items-center rounded-full border border-white/10 bg-black/20 p-0.5"
              role="tablist"
              aria-label="工作模式切换"
            >
              <button
                type="button"
                role="tab"
                aria-selected={renderedPanelStyle !== 'reply' && renderedPanelStyle !== 'translate' && !screenReplyAnalysis}
                title="润色：改写我自己的文字"                onClick={handleSwitchToPolish}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer ${
                  renderedPanelStyle !== 'reply' && renderedPanelStyle !== 'translate' && !screenReplyAnalysis
                    ? 'bg-white/10 text-slate-200'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                润色
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={Boolean(renderedPanelStyle === 'reply' || screenReplyAnalysis)}
                title="回复：把上方文字当作对方消息，帮我想一条回复"
                onClick={handleSwitchToReply}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer ${
                  renderedPanelStyle === 'reply' || screenReplyAnalysis
                    ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                回复
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={renderedPanelStyle === 'translate'}
                title="翻译：精准双向翻译"
                onClick={handleSwitchToTranslate}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer ${
                  renderedPanelStyle === 'translate'
                    ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                翻译
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {lastReplacement && renderedPanelStyle !== 'translate' && (
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
            {skin !== 'light' && (
            <button
              ref={opacityBtnRef}
              type="button"
              onClick={toggleOpacityMenu}
              aria-label="调整窗口透明度"
              aria-expanded={opacityMenuOpen}
              title={`窗口透明度（当前 ${Math.round(windowOpacity * 100)}%）`}
              className={`runbi-icon-button ${
                windowOpacity !== 1 || opacityMenuOpen ? 'bg-teal-500/10 !text-teal-300' : ''
              }`}
            >
              <Droplet className="h-4 w-4" />
            </button>
            )}
            {opacityMenuOpen &&
              opacityPos &&
              createPortal(
                <div
                  ref={opacityMenuRef}
                  style={{ position: 'fixed', top: opacityPos.top, right: opacityPos.right }}
                  className="z-[2147483647] flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-[#0b1512]/95 px-2.5 py-3 shadow-xl backdrop-blur-md"
                >
                  <span className="text-[10px] font-medium text-slate-300">
                    {Math.round(windowOpacity * 100)}%
                  </span>
                  <input
                    type="range"
                    min={0.2}
                    max={1}
                    step={0.01}
                    value={windowOpacity}
                    onChange={(e) => handleOpacityChange(Number(e.target.value))}
                    onPointerUp={persistOpacity}
                    onKeyUp={persistOpacity}
                    aria-label="窗口透明度滑杆"
                    className="runbi-opacity-slider"
                  />
                </div>,
                document.body
              )}
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
        {recoverableDraft && renderedPanelStyle !== 'translate' && !showHistory && !showSettings && (
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
                <button
                  type="button"
                  onClick={() => setSettingsTab('about')}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
                    settingsTab === 'about'
                      ? 'bg-teal-500/20 text-teal-300 shadow-sm border border-teal-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  版本更新
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

                {/* 缺陷5/7:个人词库 + 文风标杆 + 本地模型零配置探测 */}
                <AdvancedSettings
                  settings={{ apiKey, baseUrl: endpoint, model, glossary, styleSamples }}
                  onPatch={(patch) => {
                    if (patch.glossary) setGlossary(patch.glossary);
                    if (patch.styleSamples) setStyleSamples(patch.styleSamples);
                    if (patch.baseUrl && patch.model) {
                      // 本地模型一键直连:探测给出 /v1 根地址,App 端点存完整 /chat/completions
                      const base = patch.baseUrl.replace(/\/+$/, '');
                      setEndpoint(/\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`);
                      setModel(patch.model);
                      setConnectionTest({ status: 'idle', message: '' });
                    }
                  }}
                />
              </div>
            )}

            {/* Tab 2: Desktop Settings */}
            {settingsTab === 'desktop' && (
              <div className="runbi-settings-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4 animate-in fade-in duration-150">
                <div className="space-y-1.5">
                  <label htmlFor="skin-select" className="block font-medium text-slate-300">皮肤</label>
                  <select
                    id="skin-select"
                    value={skin}
                    onChange={(e) => setSkin(e.target.value as 'dark' | 'light')}
                    className="runbi-form-control cursor-pointer"
                  >
                    <option value="dark">深色 (默认)</option>
                    <option value="light">浅色</option>
                  </select>
                  <p className="text-[10px] text-slate-500">切换即时生效，保存后记住选择。</p>
                </div>

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
                  label="划词后显示胶囊"
                  description="选中文字后显示轻量操作胶囊；关闭后仅响应全局快捷键。"
                  checked={autoCopyPopup}
                  onChange={setAutoCopyPopup}
                />
                <SettingsToggle
                  label="复制后自动显示胶囊"
                  description="普通复制也显示胶囊，默认关闭，避免复制操作反复打扰。"
                  checked={clipboardTriggerEnabled}
                  onChange={setClipboardTriggerEnabled}
                />
                <SettingsToggle
                  label="开机自动启动"
                  description="在系统托盘静默待命，不主动打扰。"
                  checked={autostart}
                  onChange={setAutostart}
                />
                  <SettingsToggle
                    label="读取聊天上下文截图"
                    description="在聊天窗口中，智能识别上文对方说的话。"
                  checked={readChatScreenshot}
                  onChange={setReadChatScreenshot}
                />

                <div className="runbi-settings-card space-y-2 p-3">
                  <SettingsToggle
                    label="聊天智能应答追踪 (Beta)"
                    description="自动追踪当前聊天窗口中的提问，结合会话上下文拟定回复。"
                    checked={feishuCopilotEnabled}
                    onChange={setFeishuCopilotEnabled}
                  />
                  {feishuCopilotEnabled && (
                    <div className="space-y-1.5 pt-1 pl-1">
                      <label className="block text-[11px] font-medium text-slate-300">应答模式</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setFeishuCopilotMode('collaborative')}
                          className={`rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                            feishuCopilotMode === 'collaborative'
                              ? 'border-teal-500/80 bg-teal-500/15 text-teal-200'
                              : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20'
                          }`}
                        >
                          <div className="font-medium text-slate-200">人机协同 (推荐)</div>
                          <div className="text-[10px] text-slate-400">自动预填到当前聊天输入框，按回车确认发送</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setFeishuCopilotMode('autopilot')}
                          className={`rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                            feishuCopilotMode === 'autopilot'
                              ? 'border-teal-500/80 bg-teal-500/15 text-teal-200'
                              : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20'
                          }`}
                        >
                          <div className="font-medium text-slate-200">全自动无人值守</div>
                          <div className="text-[10px] text-slate-400">生成后自动模拟回车直接发出</div>
                        </button>
                      </div>
                      {feishuCopilotStatus && (
                        <p className="text-[10px] text-teal-300" role="status">{feishuCopilotStatus}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tab 3: Persona & Advanced */}
            {settingsTab === 'persona' && (
              <div className="runbi-settings-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-4 animate-in fade-in duration-150">
                <div className="space-y-1.5">
                  <label htmlFor="industry-pack" className="block font-medium text-slate-300">行业模板包</label>
                  <select
                    id="industry-pack"
                    value={industryPack}
                    onChange={(e) => setIndustryPack(e.target.value)}
                    className="runbi-form-control cursor-pointer"
                  >
                    {INDUSTRY_PACKS.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-500">
                    {INDUSTRY_PACKS.find((p) => p.id === industryPack)?.description}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    无需在面板里再选——划词和智能回复时自动生效；命中行业的回复面板会出现专属快捷按钮。
                  </p>
                </div>

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
                  <p className="text-[10px] text-slate-500">生成时自动带上这个人设语气，无需每次选择。</p>
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

                <details className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                  <summary className="cursor-pointer select-none text-xs font-medium text-slate-300">
                    自定义回复指令（高级）
                    <span className="ml-1.5 text-[10px] font-normal text-slate-500">
                      {customActions.filter((a) => a.name.trim()).length > 0
                        ? `已定义 ${customActions.filter((a) => a.name.trim()).length} 个`
                        : '未设置，AI 默认已覆盖常见场景'}
                    </span>
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    {customActions.map((a, i) => {
                      const incomplete = !a.name.trim() || !a.prompt.trim();
                      return (
                        <div key={a.id} className="flex items-center gap-1.5">
                          <input
                            value={a.name}
                            onChange={(e) => upsertCustomAction(i, { name: e.target.value })}
                            placeholder="按钮名"
                            title={incomplete ? '名称和指令都填写后保存才会生效' : undefined}
                            className={`runbi-form-control w-20 shrink-0 font-sans text-xs ${
                              !a.name.trim() ? 'border-amber-500/60' : ''
                            }`}
                          />
                          <input
                            value={a.prompt}
                            onChange={(e) => upsertCustomAction(i, { prompt: e.target.value })}
                            placeholder={a.name.trim() && !a.prompt.trim() ? '填写指令内容后按钮才会出现' : '指令内容，如：礼貌询问对方还有没有其他需求'}
                            title={incomplete ? '名称和指令都填写后保存才会生效' : undefined}
                            className={`runbi-form-control min-w-0 flex-1 font-sans text-xs ${
                              a.name.trim() && !a.prompt.trim() ? 'border-amber-500/60' : ''
                            }`}
                          />
                          <button
                            type="button"
                            aria-label={`删除指令 ${a.name || i + 1}`}
                            onClick={() => setCustomActions((prev) => prev.filter((_, j) => j !== i))}
                            className="h-6 w-6 shrink-0 rounded text-slate-500 hover:bg-rose-500/20 hover:text-rose-400 transition-colors cursor-pointer"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() =>
                        setCustomActions((prev) => [...prev, { id: Date.now().toString(36), name: '', prompt: '' }])
                      }
                      className="rounded-lg border border-dashed border-white/20 px-2.5 py-1 text-[11px] text-slate-400 hover:border-teal-500/60 hover:text-teal-400 transition-colors cursor-pointer"
                    >
                      + 添加指令
                    </button>
                    <p className="text-[10px] text-slate-500">
                      保存后作为快捷按钮出现在回复面板，一键把指令套在当前对话上；名称和指令都填写才会生效（黄色边框 = 未完成）
                    </p>
                  </div>
                </details>

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
                      {feedbackSent ? '反馈已记录，感谢您的支持！' : '文字保存在本地日志，随时查看'}
                    </span>
                    <button
                      type="button"
                      disabled={feedbackSending || !feedbackText.trim()}
                      onClick={handleSubmitFeedback}
                      className="runbi-focus-ring rounded-lg bg-teal-500/20 px-3 py-1 text-xs font-medium text-teal-200 transition-colors hover:bg-teal-500/30 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {feedbackSending ? '提交中…' : feedbackSent ? '已提交' : '提交反馈'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {settingsTab === 'about' && (
              <div className="runbi-settings-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-4 animate-in fade-in duration-150">
                <UpdateCheckRow
                  onOpenReleaseHistory={() => {
                    invoke('open_url', {
                      url: 'https://github.com/dcn-autotest-team/runbi-updates/releases',
                    }).catch(() => showToast('未能打开发布记录'));
                  }}
                />
                <p className="px-1 text-[10px] leading-4 text-slate-500">
                  Runbi 会在启动时静默检查更新；发现新版本后展示版本号、发布日期和更新内容，由你决定何时安装。
                </p>
              </div>
            )}

            <div className="flex shrink-0 items-center justify-between border-t border-white/10 bg-black/20 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-slate-500">
                  {settingsTab === 'about' ? '稳定通道 · 签名校验' : 'Esc 取消'}
                </span>
                {settingsTab !== 'about' && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowSettings(false);
                      setShowOnboarding(true);
                    }}
                    className="text-[11px] font-medium text-teal-400 hover:text-teal-300 hover:underline cursor-pointer"
                  >
                    重看新手引导
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {settingsTab !== 'about' && (
                  <button
                    type="button"
                    onClick={() => setShowSettings(false)}
                    className="runbi-focus-ring rounded-lg px-3 py-2 font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    取消
                  </button>
                )}
                <button
                  type={settingsTab === 'about' ? 'button' : 'submit'}
                  onClick={settingsTab === 'about' ? () => setShowSettings(false) : undefined}
                  disabled={settingsTab !== 'about' && isSavingSettings}
                  className="runbi-primary-button runbi-focus-ring"
                >
                  {settingsTab !== 'about' && isSavingSettings && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                  {settingsTab === 'about' ? '完成' : isSavingSettings ? '保存中…' : '保存设置'}
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
            hasApiKey={Boolean(apiKey)}
            onOpenSettings={() => {
              setShowOnboarding(false);
              setShowSettings(true);
            }}
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
        ) : showParallel ? (
          /* 多专家并行结果视图 */
          <ParallelResultsView
            inputText={originalText}
            sessions={parallelSessions}
            onClose={closeParallel}
            onStopAll={stopAllParallel}
            onStopOne={stopParallelOne}
            onCopyText={async (text) => {
              const ok = await adapters.textReplacer.copyToClipboard(text);
              if (ok) showToast('已复制到剪贴板');
            }}
            onReplaceText={async (text) => {
              const res = await adapters.textReplacer.replaceText(text, null, !stateRef.current.isPinned);
              showToast(
                res.success ? '已贴回该专家的版本' : (res.error || '贴回失败'),
                res.success ? 2000 : 3500
              );
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
            activeStyle={renderedPanelStyle}
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
            onRecapture={handleRecapture}
            isRecapturing={isRecapturing}
            onOpenScriptLibrary={() => setShowScriptLibrary(true)}
            autoMode={autoMode}
            onAutoMode={handleAutoMode}
            translateTarget={translateTarget}
            onTranslateTargetChange={handleTranslateTargetChange}
            expert={activeExpert ? { name: activeExpert.name, emoji: activeExpert.emoji } : null}
            onClearExpert={handleClearExpert}
            onOpenExperts={() => setShowExpertPicker(true)}
            packName={activePack.id !== 'general' ? activePack.name : undefined}
            replyQuickTags={replyQuickTags.length > 0 ? replyQuickTags : undefined}
            extraIntentChips={customActionTags.length > 0 ? customActionTags : undefined}
            bannedWords={bannedHits.length > 0 ? bannedHits : undefined}
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
                const refinePrompt = buildScreenReplyRefinePrompt(conversation, customPrompt, activePersonaPrompt, activePackPrompt, glossaryPromptText);
                const historyOriginal = screenReplyAnalysis.last_message_from_other
                  || conversation.filter((c) => c.sender === 'other').slice(-1)[0]?.text
                  || undefined;
                handleStartPolish(refinePrompt, 'reply', inst, undefined, historyOriginal);
              } else {
                handleStartPolish(originalText, activeStyle, customPrompt);
              }
            }}
            onToastDismiss={() => setToastVisible(false)}
            replaceLabel={
              renderedPanelStyle === 'reply' || Boolean(screenReplyAnalysis)
                ? `发送至${getChatAppName(stateRef.current.lastChatApp)}`
                : '贴回'
            }
          />
        )}

        {/* 内置库浮层：话术模板库 / 专家提示词库 */}
        {showScriptLibrary && (
          <ScriptLibraryModal
            open
            onClose={() => setShowScriptLibrary(false)}
            contextHint={contextHint}
            onUseTemplate={handleUseTemplate}
          />
        )}
        {showExpertPicker && (
          <ExpertPickerModal
            open
            onClose={() => setShowExpertPicker(false)}
            activeExpertId={activeExpert?.id ?? null}
            onApplyExpert={handleApplyExpert}
            onStartParallel={(experts) => {
              setShowExpertPicker(false);
              handleStartParallel(experts);
            }}
          />
        )}

        {isTauri && (
          <UpdateCheckRow autoCheck prominent onUpdateFound={handleUpdateFound} />
        )}

        {/* 缺陷3:贴回失败常驻浮条——给明确的重试/关闭动作,不靠用户眼疾手快 */}
        {pasteFallbackBar && (
          <div
            role="alert"
            className="pointer-events-auto mx-3 mb-3 flex shrink-0 items-center justify-between gap-2 rounded-xl border border-amber-300/40 bg-amber-950/80 px-3 py-2 shadow-lg backdrop-blur-md"
          >
            <span className="text-[11px] leading-snug text-amber-200">
              未能自动写入当前应用，文字已复制到剪贴板——到目标应用按 Ctrl+V 粘贴即可
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setPasteFallbackBar(false);
                  handleReplace();
                }}
                className="runbi-focus-ring rounded-lg bg-amber-400/20 px-2.5 py-1 text-[11px] font-medium text-amber-100 transition-colors hover:bg-amber-400/30 cursor-pointer"
              >
                重试贴回
              </button>
              <button
                type="button"
                onClick={() => setPasteFallbackBar(false)}
                aria-label="关闭提示"
                className="runbi-focus-ring rounded-lg px-2 py-1 text-[11px] text-amber-200/70 transition-colors hover:bg-white/10 hover:text-amber-100 cursor-pointer"
              >
                知道了
              </button>
            </span>
          </div>
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
