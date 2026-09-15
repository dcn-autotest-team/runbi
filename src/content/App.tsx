/**
 * @file src/content/App.tsx
 * Content Script Root React Application inside Shadow DOM
 * Consumes @runbi/shared and Platform Adapters via Inversion-of-Control (IoC)
 * Part of Runbi Chrome Extension (Manifest V3)
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { SelectionInfo, PositionCoordinates } from '@runbi/shared/types/selection';
import type { PolishStyle, StreamConfig } from '@runbi/shared/types/stream';
import type {
  ISelectionProvider,
  ITextReplacer,
  IStorageProvider,
  ILLMTransport,
  LLMStreamRequest,
} from '@runbi/shared/adapters';
import { calculateCapsulePosition, calculatePanelPosition } from '@runbi/shared/core/position';
import { PolishPanel } from '@runbi/shared/components/PolishPanel';
import { buildTranslateSystemPrompt, resolveTranslateTarget, type TranslateTargetId } from '@runbi/shared/core/prompts';
import { TriggerCapsule } from '../components/TriggerCapsule';
import { HOST_ELEMENT_ID } from './shadowRoot';
import {
  ChromeDOMSelectionProvider,
  DOMTextReplacer,
  ChromeStorageProvider,
  ChromePortLLMTransport,
} from '../adapters';

export type AppViewMode = 'idle' | 'capsule' | 'panel';

export interface AppProps {
  initialSelection?: SelectionInfo | null;
  onDismiss?: () => void;
  // Platform Adapter Injections (IoC)
  selectionProvider?: ISelectionProvider;
  textReplacer?: ITextReplacer;
  storageProvider?: IStorageProvider;
  llmTransport?: ILLMTransport;
}

export const App: React.FC<AppProps> = ({
  initialSelection = null,
  onDismiss,
  selectionProvider: injectedSelectionProvider,
  textReplacer: injectedTextReplacer,
  storageProvider: injectedStorageProvider,
  llmTransport: injectedLLMTransport,
}) => {
  // Instantiate default platform adapters if not injected
  const selectionProvider = useMemo<ISelectionProvider>(
    () => injectedSelectionProvider || new ChromeDOMSelectionProvider(),
    [injectedSelectionProvider]
  );
  const textReplacer = useMemo<ITextReplacer>(
    () => injectedTextReplacer || new DOMTextReplacer(),
    [injectedTextReplacer]
  );
  const storageProvider = useMemo<IStorageProvider>(
    () => injectedStorageProvider || new ChromeStorageProvider(),
    [injectedStorageProvider]
  );
  const llmTransport = useMemo<ILLMTransport>(
    () => injectedLLMTransport || new ChromePortLLMTransport(),
    [injectedLLMTransport]
  );

  // UI View States
  const [viewMode, setViewMode] = useState<AppViewMode>(initialSelection ? 'capsule' : 'idle');
  const [selection, setSelection] = useState<SelectionInfo | null>(initialSelection);
  const [capsulePos, setCapsulePos] = useState<PositionCoordinates>({ top: 0, left: 0, placement: 'top-right' });
  const [panelPos, setPanelPos] = useState<PositionCoordinates>({ top: 0, left: 0, placement: 'bottom-right' });

  // Stream & Polishing States
  const [activeStyle, setActiveStyle] = useState<PolishStyle>('polished');
  const [translateTarget, setTranslateTarget] = useState<TranslateTargetId>('en');
  const translateTargetRef = useRef<TranslateTargetId>('en');
  const [currentInstruction, setCurrentInstruction] = useState<string>('');
  const [polishedText, setPolishedText] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [durationMs, setDurationMs] = useState<number>(0);
  const [totalTokens, setTotalTokens] = useState<number>(0);
  const [isDiffMode, setIsDiffMode] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string>('DeepSeek-V3');

  // Feedback Toast State
  const [toastVisible, setToastVisible] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>('已复制到剪贴板');

  // Asynchronous References
  const abortControllerRef = useRef<AbortController | null>(null);
  const isGeneratingRef = useRef<boolean>(false);
  const viewModeRef = useRef<AppViewMode>(viewMode);
  const selectionRef = useRef<SelectionInfo | null>(selection);
  const selectionRevisionRef = useRef(0);
  const isInteractingRef = useRef<boolean>(false);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    isGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  // Clean up streaming port / signal
  const cleanupStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    isGeneratingRef.current = false;
  }, []);

  // Dismiss entire floating interface
  const handleDismiss = useCallback(() => {
    ++selectionRevisionRef.current;
    cleanupStream();
    setViewMode('idle');
    setPolishedText('');
    setError(null);
    setCurrentInstruction('');
    if (onDismiss) {
      onDismiss();
    }
  }, [cleanupStream, onDismiss]);

  // Start or restart stream generation for current selection and style
  const startStream = useCallback(
    async (text: string, style: PolishStyle, userInstruction?: string, targetOverride?: TranslateTargetId) => {
      cleanupStream();

      setPolishedText('');
      setError(null);
      setIsGenerating(true);
      isGeneratingRef.current = true;
      const startTime = Date.now();

      const abortCtrl = new AbortController();
      abortControllerRef.current = abortCtrl;

      try {
        // Fetch persisted settings from storage adapter
        const storedApiKey = await storageProvider.get<string>('apiKey', '');
        const storedBaseUrl = await storageProvider.get<string>('baseUrl', '');
        const storedModel = await storageProvider.get<string>('model', '');
        const storedCustomPrompt = await storageProvider.get<string>('customPrompt', '');
        const storedCustomPrompts = await storageProvider.get<Partial<Record<PolishStyle, string>>>('customPrompts', {});

        if (storedModel) {
          setModelName(storedModel);
        }

        const autoTarget = resolveTranslateTarget(text);
        let effectiveTranslateTarget = targetOverride || autoTarget;
        if (targetOverride === 'zh-Hans' && autoTarget === 'en') {
          effectiveTranslateTarget = 'en';
        } else if (targetOverride === 'en' && autoTarget === 'zh-Hans') {
          effectiveTranslateTarget = 'zh-Hans';
        }
        if (style === 'translate') {
          if (effectiveTranslateTarget !== translateTargetRef.current) {
            setTranslateTarget(effectiveTranslateTarget);
            translateTargetRef.current = effectiveTranslateTarget;
          }
        }

        const promptOverride = style === 'translate'
          ? buildTranslateSystemPrompt(effectiveTranslateTarget, text)
          : (storedCustomPrompts?.[style] || storedCustomPrompt);

        const config: StreamConfig = {
          apiKey: storedApiKey || undefined,
          baseUrl: storedBaseUrl || undefined,
          model: storedModel || undefined,
          style,
          customPrompt: promptOverride || undefined,
          userInstruction,
        };

        const request: LLMStreamRequest = {
          text,
          config,
        };

        await llmTransport.streamChat(
          request,
          {
            onChunk: (delta: string) => {
              if (abortCtrl.signal.aborted) return;
              setPolishedText((prev) => prev + delta);
              setDurationMs(Date.now() - startTime);
            },
            onDone: (duration: number, tokens: number) => {
              if (abortCtrl.signal.aborted) return;
              setIsGenerating(false);
              isGeneratingRef.current = false;
              setDurationMs(duration);
              setTotalTokens(tokens);
            },
            onError: (err: string) => {
              if (abortCtrl.signal.aborted) return;
              setIsGenerating(false);
              isGeneratingRef.current = false;
              setError(err);
            },
            onAbort: () => {
              setIsGenerating(false);
              isGeneratingRef.current = false;
            },
          },
          abortCtrl.signal
        );
      } catch (err: any) {
        if (!abortCtrl.signal.aborted) {
          setError(err?.message || '生成失败，请重试');
          setIsGenerating(false);
          isGeneratingRef.current = false;
        }
      }
    },
    [cleanupStream, storageProvider, llmTransport]
  );

  // Open panel from capsule click or keyboard shortcut
  const handleOpenPanel = useCallback(() => {
    if (!selection) return;

    let currentRect = selection.rect;
    try {
      if (selection.savedRange instanceof Range) {
        const fresh = selection.savedRange.getBoundingClientRect();
        if (fresh.width > 0 || fresh.height > 0) {
          currentRect = fresh;
        }
      }
    } catch (_) {}

    const calculatedPanel = calculatePanelPosition(currentRect);
    setPanelPos(calculatedPanel);
    setViewMode('panel');

    // Trigger stream generation
    startStream(selection.text, activeStyle);
  }, [selection, activeStyle, startStream]);

  // Style tab change
  const handleStyleChange = useCallback(
    (style: PolishStyle) => {
      setActiveStyle(style);
      setCurrentInstruction('');
      if (selection) {
        const target = style === 'translate' ? resolveTranslateTarget(selection.text) : undefined;
        startStream(selection.text, style, undefined, target);
      }
    },
    [selection, startStream]
  );

  // Translate target language change
  const handleTranslateTargetChange = useCallback(
    (id: TranslateTargetId) => {
      setTranslateTarget(id);
      translateTargetRef.current = id;
      if (activeStyle === 'translate' && selection) {
        startStream(selection.text, 'translate', currentInstruction, id);
      }
    },
    [activeStyle, selection, currentInstruction, startStream]
  );

  // Natural language instruction submission
  const handleSendInstruction = useCallback(
    (instruction: string) => {
      setCurrentInstruction(instruction);
      if (selection) {
        startStream(selection.text, activeStyle, instruction);
      }
    },
    [selection, activeStyle, startStream]
  );

  // Regenerate handler
  const handleRegenerate = useCallback(() => {
    if (selection) {
      startStream(selection.text, activeStyle, currentInstruction);
    }
  }, [selection, activeStyle, currentInstruction, startStream]);

  // Copy handler via ITextReplacer
  const handleCopy = useCallback(async () => {
    if (!polishedText) return;
    let ok = false;
    if (textReplacer.copyToClipboard) {
      ok = await textReplacer.copyToClipboard(polishedText);
    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(polishedText);
      ok = true;
    }
    if (ok) {
      setToastMessage('已复制到剪贴板');
      setToastVisible(true);
    }
  }, [polishedText, textReplacer]);

  const dismissTimerRef = useRef<any>(null);

  // In-place replace handler via ITextReplacer
  const handleReplace = useCallback(async () => {
    if (!selection || !polishedText) return;

    const result = await textReplacer.replaceText(polishedText, selection);
    if (result.success) {
      setToastMessage('✓ 已替换原文');
      setToastVisible(true);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(() => {
        handleDismiss();
      }, 300);
    } else if (result.error) {
      setToastMessage(`替换失败: ${result.error}`);
      setToastVisible(true);
    }
  }, [selection, polishedText, textReplacer, handleDismiss]);

  // Diff toggle
  const handleToggleDiff = useCallback(() => {
    setIsDiffMode((prev) => !prev);
  }, []);

  // Selection change observation via ISelectionProvider
  useEffect(() => {
    if (!selectionProvider.subscribeToSelectionChange) return;

    const unsubscribe = selectionProvider.subscribeToSelectionChange(async (info) => {
      const revision = ++selectionRevisionRef.current;
      if (!info) {
        if (isInteractingRef.current) return;
        if (viewModeRef.current === 'capsule') {
          setViewMode('idle');
          setSelection(null);
        }
        return;
      }

      // Check enabled status, blacklist, and triggerMode from storage adapter
      try {
        const isEnabled = await storageProvider.get<boolean>('enabled', true);
        if (isEnabled === false) return;

        const blacklist = await storageProvider.get<string[]>('blacklist', []);
        const hostname = typeof window !== 'undefined' ? window.location?.hostname : '';
        if (hostname && Array.isArray(blacklist) && blacklist.includes(hostname)) {
          return;
        }

        const triggerMode = await storageProvider.get<string>('triggerMode', 'capsule');

        if (revision !== selectionRevisionRef.current) return;

        // Prevent interrupting active panel streaming
        if (viewModeRef.current === 'panel' && isGeneratingRef.current) {
          return;
        }

        setSelection(info);
        if (triggerMode === 'direct') {
          const calculatedPanel = calculatePanelPosition(info.rect);
          setPanelPos(calculatedPanel);
          setViewMode('panel');
          startStream(info.text, activeStyle);
        } else {
          const calculatedCapsule = calculateCapsulePosition(info.rect);
          setCapsulePos(calculatedCapsule);
          setViewMode('capsule');
        }
      } catch (_) {}
    });

    return () => {
      ++selectionRevisionRef.current;
      unsubscribe();
    };
  }, [selectionProvider, storageProvider, activeStyle, startStream]);

  // Outside click & ESC dismissal listeners
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (viewModeRef.current === 'idle') return;

      const path = e.composedPath ? e.composedPath() : [];
      const host = document.getElementById(HOST_ELEMENT_ID);
      const isInside = Boolean(host && path.includes(host));

      if (!isInside) {
        handleDismiss();
      }
    };

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleDismiss();
      } else if (
        (e.altKey && (e.key === 'w' || e.key === 'W')) ||
        (e.ctrlKey && e.shiftKey && (e.key === 'p' || e.key === 'P'))
      ) {
        if (selectionRef.current && viewModeRef.current === 'capsule') {
          e.preventDefault();
          handleOpenPanel();
        }
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeydown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [handleDismiss, handleOpenPanel]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
      cleanupStream();
    };
  }, [cleanupStream]);

  if (viewMode === 'idle' || !selection) {
    return null;
  }

  if (viewMode === 'capsule') {
    return (
      <TriggerCapsule
        top={capsulePos.top}
        left={capsulePos.left}
        onClick={(e) => {
          e.stopPropagation();
          isInteractingRef.current = true;
          handleOpenPanel();
          setTimeout(() => {
            isInteractingRef.current = false;
          }, 400);
        }}
      />
    );
  }

  return (
    <PolishPanel
      top={panelPos.top}
      left={panelPos.left}
      originalText={selection.text}
      polishedText={polishedText}
      isGenerating={isGenerating}
      activeStyle={activeStyle}
      isDiffMode={isDiffMode}
      isEditable={selection.isEditable}
      durationMs={durationMs}
      totalTokens={totalTokens}
      error={error}
      modelName={modelName}
      toastMessage={toastMessage}
      toastVisible={toastVisible}
      translateTarget={translateTarget}
      onTranslateTargetChange={handleTranslateTargetChange}
      onClose={handleDismiss}
      onStyleChange={handleStyleChange}
      onToggleDiff={handleToggleDiff}
      onStop={cleanupStream}
      onRegenerate={handleRegenerate}
      onCopy={handleCopy}
      onReplace={handleReplace}
      onSendInstruction={handleSendInstruction}
      onToastDismiss={() => setToastVisible(false)}
    />
  );
};

export default App;

