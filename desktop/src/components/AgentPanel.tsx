/**
 * @file desktop/src/components/AgentPanel.tsx
 * Runbi Desktop - Autonomous Agent Panel (EVA-inspired)
 * Provides interactive task execution, live reasoning, CLI tool call approval, and output display.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { Terminal, Shield, Play, Square, ChevronDown, ChevronRight, Check, X, Copy, RefreshCw, Folder, Cpu } from 'lucide-react';
import { MarkdownRenderer } from '@runbi/shared/components';

export interface AgentPanelProps {
  endpoint: string;
  apiKey: string;
  model: string;
  onModelChange?: (model: string) => void;
  modelList?: string[];
  onToast?: (msg: string) => void;
}

const PRESET_MODELS = [
  'deepseek-chat',
  'deepseek-reasoner',
  'gpt-4o',
  'gpt-4o-mini',
  'claude-3-5-sonnet-20241022',
  'qwen-plus',
  'glm-4-flash',
];

interface ToolCallState {
  callId: string;
  name: string;
  command: string;
  requiresApproval: boolean;
  pendingApproval: boolean;
  output?: string;
  exitCode?: number | null;
}

export const AgentPanel: React.FC<AgentPanelProps> = ({
  endpoint,
  apiKey,
  model,
  onModelChange,
  modelList,
  onToast,
}) => {
  const [taskPrompt, setTaskPrompt] = useState('');
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [projectDir, setProjectDir] = useState('.');
  const [allowAllCli, setAllowAllCli] = useState(false);
  const [selectedModel, setSelectedModel] = useState(model || 'deepseek-chat');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (model) setSelectedModel(model);
  }, [model]);

  useEffect(() => {
    if (!showModelDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showModelDropdown]);

  const availableModels = useMemo(() => {
    const list = [...(modelList || []), ...PRESET_MODELS];
    if (selectedModel && !list.includes(selectedModel)) {
      list.unshift(selectedModel);
    }
    return Array.from(new Set(list));
  }, [modelList, selectedModel]);

  const handleSelectModel = useCallback(
    (m: string) => {
      setSelectedModel(m);
      onModelChange?.(m);
      setShowModelDropdown(false);
    },
    [onModelChange]
  );
  const [isRunning, setIsRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [thinkingText, setThinkingText] = useState('');
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(true);
  const [finalContent, setFinalContent] = useState('');
  const [toolCalls, setToolCalls] = useState<ToolCallState[]>([]);
  const [compactionNote, setCompactionNote] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const followOutput = useRef(true);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (runningRef.current) void invoke('abort_agent_task').catch(() => {});
    };
  }, []);

  // Auto-scroll on content updates
  useEffect(() => {
    if (scrollRef.current && followOutput.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thinkingText, finalContent, toolCalls, statusMessage]);

  const handleStartTask = useCallback(async () => {
    if (runningRef.current) return;
    const trimmed = taskPrompt.trim();
    if (!trimmed) {
      onToast?.('请输入任务目标');
      return;
    }
    if (!endpoint.trim() || !model.trim()) {
      onToast?.('请先在设置中配置模型和服务地址');
      return;
    }

    runningRef.current = true;
    followOutput.current = true;
    setTaskPrompt('');
    setSubmittedPrompt(trimmed);
    setIsRunning(true);
    setStatusMessage('初始化任务环境中…');
    setThinkingText('');
    setFinalContent('');
    setToolCalls([]);
    setCompactionNote('');

    try {
      const channel = new Channel();
      channel.onmessage = (event: any) => {
        if (!mountedRef.current || !event || !event.type) return;

        switch (event.type) {
          case 'ThinkingChunk':
            setThinkingText((prev) => prev + event.payload.delta);
            break;

          case 'ContentChunk':
            setFinalContent((prev) => prev + event.payload.delta);
            break;

          case 'ToolProposed': {
            const { call_id, name, command, requires_approval } = event.payload;
            setToolCalls((prev) => [
              ...prev,
              {
                callId: call_id,
                name,
                command,
                requiresApproval: requires_approval,
                pendingApproval: requires_approval,
              },
            ]);
            break;
          }

          case 'ToolExecuted': {
            const { call_id, output, exit_code } = event.payload;
            setToolCalls((prev) =>
              prev.map((t) =>
                t.callId === call_id
                  ? { ...t, output, exitCode: exit_code, pendingApproval: false }
                  : t
              )
            );
            break;
          }

          case 'MemoryCompacted':
            setCompactionNote(`已将关键线索固化保存至 .runbi/hints.md`);
            break;

          case 'Status':
            setStatusMessage(event.payload.message);
            break;

          case 'Done':
            setStatusMessage(event.payload.success ? '任务已完成' : '任务已停止');
            onToast?.(event.payload.success ? '任务完成' : '任务停止');
            break;

          case 'Error':
            setStatusMessage(`异常: ${event.payload.message}`);
            onToast?.(`执行异常: ${event.payload.message}`);
            break;

          default:
            break;
        }
      };

      await invoke('start_agent_task', {
        params: {
          endpoint,
          api_key: apiKey,
          model: selectedModel || model || 'deepseek-chat',
          prompt: trimmed,
          project_dir: projectDir.trim() || '.',
          allow_all: allowAllCli,
          max_turns: 15,
        },
        channel,
      });
    } catch (err: any) {
      if (!mountedRef.current) return;
      setTaskPrompt((draft) => draft || trimmed);
      setStatusMessage(`任务失败: ${err?.message || err}`);
      onToast?.(`任务失败: ${err?.message || err}`);
    } finally {
      runningRef.current = false;
      if (mountedRef.current) {
        setIsRunning(false);
        setToolCalls((prev) => prev.map((tool) => ({ ...tool, pendingApproval: false })));
      }
    }
  }, [taskPrompt, projectDir, allowAllCli, endpoint, apiKey, selectedModel, model, onToast]);

  const handleSelectDirectory = useCallback(async () => {
    if (isRunning) return;
    try {
      const chosen = await invoke<string | null>('select_project_directory', {
        defaultPath: projectDir !== '.' ? projectDir : undefined,
      });
      if (chosen) {
        setProjectDir(chosen);
      }
    } catch (err: any) {
      onToast?.(`选择目录失败: ${err?.message || err}`);
    }
  }, [isRunning, projectDir, onToast]);

  const handleAbort = useCallback(async () => {
    setStatusMessage('正在中止任务…');
    try {
      await invoke('abort_agent_task');
    } catch (err: any) {
      onToast?.(`中止失败: ${err?.message || err}`);
    }
  }, [onToast]);

  const handleApproveTool = useCallback(
    async (callId: string, approved: boolean) => {
      try {
        await invoke('approve_agent_tool', { callId, approved });
        setToolCalls((prev) =>
          prev.map((t) => (t.callId === callId ? { ...t, pendingApproval: false } : t))
        );
      } catch (err: any) {
        onToast?.(`操作失败: ${err?.message || err}`);
      }
    },
    [onToast]
  );

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast?.('已复制到剪贴板');
    } catch {
      onToast?.('复制失败，请选中文字手动复制');
    }
  };

  return (
    <div className="runbi-agent flex min-h-0 w-full flex-1 flex-col font-sans text-slate-200">

      {/* Main Execution Log View */}
      <div ref={scrollRef} onScroll={() => {
        const el = scrollRef.current;
        if (el) followOutput.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }} className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4 runbi-settings-scroll">
        {/* Empty state */}
        {!submittedPrompt && (
          <div className="flex flex-col items-center justify-center min-h-48 py-6 text-center">
            <div className="runbi-agent-icon mb-4 rounded-2xl p-3"><Terminal className="h-6 w-6" /></div>
            <h2 className="text-base font-semibold mb-2">把任务交给润笔</h2>
            <p className="text-xs text-slate-400 leading-6">描述目标，查看执行过程，在需要时批准操作。</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {['概览当前目录的文件', '检查 Git 分支和未提交的更改'].map((prompt) => (
                <button key={prompt} type="button" className="runbi-agent-suggestion rounded-lg border px-3 py-2 text-xs" onClick={() => setTaskPrompt(prompt)}>{prompt}</button>
              ))}
            </div>
          </div>
        )}
        {submittedPrompt && <div className="runbi-agent-goal rounded-xl border p-3 text-sm whitespace-pre-wrap break-words"><div className="text-[11px] text-slate-400 mb-1">本次任务</div>{submittedPrompt}</div>}

        {/* Status indicator */}
        {statusMessage && (
          <div role="status" className="flex items-center gap-2 text-xs text-teal-300/90 bg-teal-950/30 border border-teal-500/20 rounded-lg px-3 py-2">
            {isRunning && <RefreshCw className="h-3 w-3 animate-spin shrink-0" />}
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Thinking stream (Collapsible) */}
        {thinkingText && (
          <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden">
            <button
              type="button"
              onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
              aria-expanded={isThinkingExpanded}
              className="flex w-full items-center justify-between px-3 py-1.5 bg-white/[0.03] text-[11px] font-medium text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <span>💭</span>
                <span>深度思考过程 ({thinkingText.length} 字)</span>
              </span>
              {isThinkingExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            {isThinkingExpanded && (
              <div className="p-3 text-[11px] leading-relaxed text-slate-400 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto border-t border-white/5">
                {thinkingText}
              </div>
            )}
          </div>
        )}

        {/* Tool Call Cards */}
        {toolCalls.map((tool, idx) => (
          <div key={tool.callId || idx} className="rounded-xl border border-white/10 bg-black/40 overflow-hidden text-xs">
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 text-teal-400" />
                <span className="font-mono font-medium text-teal-300">{tool.name}</span>
              </div>
              {tool.exitCode !== undefined && tool.exitCode !== null && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    tool.exitCode === 0
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  }`}
                >
                  Exit {tool.exitCode}
                </span>
              )}
            </div>

            {/* Command preview */}
            <div className="p-3 bg-black/60 font-mono text-[11px] text-slate-200 overflow-x-auto whitespace-pre-wrap">
              {tool.command}
            </div>

            {/* Approval Prompt if needed */}
            {tool.pendingApproval && (
              <div className="p-3 bg-amber-950/40 border-t border-amber-500/30 flex flex-wrap items-center justify-between gap-3">
                <span className="text-[11px] text-amber-200">
                  ⚠️ 该命令可能修改文件或系统环境，是否批准执行？
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleApproveTool(tool.callId, true)}
                    className="flex items-center gap-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 text-[11px] font-medium cursor-pointer"
                  >
                    <Check className="h-3 w-3" />
                    <span>批准执行</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApproveTool(tool.callId, false)}
                    className="flex items-center gap-1 rounded bg-rose-600 hover:bg-rose-500 text-white px-2.5 py-1 text-[11px] font-medium cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                    <span>拒绝</span>
                  </button>
                </div>
              </div>
            )}

            {/* Tool Output */}
            {tool.output && (
              <div className="p-3 border-t border-white/5 bg-black/80 font-mono text-[10px] text-slate-400 max-h-40 overflow-y-auto whitespace-pre-wrap">
                {tool.output}
              </div>
            )}
          </div>
        ))}

        {/* Memory compaction badge */}
        {compactionNote && (
          <div className="text-[11px] text-teal-400/80 bg-teal-950/20 border border-teal-500/20 rounded-lg p-2 font-mono">
            🧠 {compactionNote}
          </div>
        )}

        {/* Final Content Result */}
        {finalContent && (
          <div className="rounded-xl border border-teal-500/30 bg-teal-950/20 p-4 text-xs text-slate-100 leading-relaxed shadow-lg relative group">
            <button
              type="button"
              onClick={() => handleCopy(finalContent)}
              className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 cursor-pointer"
              title="复制回复"
              aria-label="复制回复"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <div className="font-semibold text-teal-300 mb-2">智能体回复：</div>
            <MarkdownRenderer content={finalContent} isGenerating={isRunning} />
          </div>
        )}
      </div>

      {/* Bottom Task Input Box (Codex-style integrated console) */}
      <div className="p-3 border-t border-white/10 shrink-0 bg-black/30">
        <div className="rounded-xl border border-white/15 bg-black/40 p-2.5 shadow-lg transition-all focus-within:border-teal-500/50 focus-within:ring-1 focus-within:ring-teal-500/30">
          {/* Prompt textarea */}
          <textarea
            rows={2}
            value={taskPrompt}
            onChange={(e) => setTaskPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
                e.preventDefault();
                if (!isRunning) handleStartTask();
              }
            }}
            aria-label="任务目标"
            placeholder={
              isRunning
                ? '可以在这里准备下一个任务…'
                : '描述你希望完成的任务（支持执行终端命令、项目分析、修改代码等）…'
            }
            className="w-full resize-none bg-transparent px-1.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none leading-relaxed min-h-[44px]"
          />

          {/* Integrated Action Toolbar inside Input Box */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2 text-xs">
            {/* Left controls: Directory, Model, Permission */}
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              {/* Directory Chip */}
              <div
                className="flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-300 hover:border-white/20 transition-all"
                title={`工作目录: ${projectDir || '.'}`}
              >
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={handleSelectDirectory}
                  className="flex items-center gap-1 text-teal-400 hover:text-teal-300 cursor-pointer disabled:opacity-50"
                  title="点击浏览并选择工作目录"
                >
                  <Folder className="h-3 w-3 shrink-0" />
                  <span className="text-[10px] text-slate-400">工作目录:</span>
                </button>
                <input
                  type="text"
                  value={projectDir}
                  disabled={isRunning}
                  onChange={(e) => setProjectDir(e.target.value)}
                  placeholder="."
                  className="w-14 sm:w-24 bg-transparent border-0 p-0 text-[11px] font-mono text-slate-200 focus:outline-none focus:ring-0 truncate"
                  aria-label="工作目录"
                />
              </div>

              {/* Model Selector Chip */}
              <div ref={modelMenuRef} className="relative">
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => setShowModelDropdown((v) => !v)}
                  className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-300 hover:border-white/20 hover:text-white transition-all cursor-pointer disabled:opacity-50"
                  title="选择执行智能体的模型"
                >
                  <Cpu className="h-3 w-3 text-cyan-400 shrink-0" />
                  <span className="max-w-[90px] truncate font-mono">{selectedModel}</span>
                  <ChevronDown className="h-2.5 w-2.5 text-slate-400" />
                </button>
                {showModelDropdown && (
                  <div className="absolute bottom-full left-0 mb-1.5 w-52 rounded-xl border border-white/15 bg-slate-900/95 backdrop-blur-md p-1.5 shadow-2xl z-50 text-xs">
                    <div className="px-2 py-1 text-[10px] font-medium text-slate-400 border-b border-white/10 mb-1">
                      选择执行模型
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-0.5 runbi-settings-scroll">
                      {availableModels.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => handleSelectModel(m)}
                          className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[11px] text-left transition-colors cursor-pointer ${
                            m === selectedModel
                              ? 'bg-teal-500/20 text-teal-300 font-medium'
                              : 'text-slate-300 hover:bg-white/10'
                          }`}
                        >
                          <span className="truncate">{m}</span>
                          {m === selectedModel && <Check className="h-3 w-3 text-teal-400 shrink-0" />}
                        </button>
                      ))}
                    </div>
                    <div className="mt-1.5 pt-1.5 border-t border-white/10 px-1">
                      <input
                        type="text"
                        placeholder="输入自定义模型并回车..."
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = (e.target as HTMLInputElement).value.trim();
                            if (val) handleSelectModel(val);
                          }
                        }}
                        className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-[10px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-teal-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Permission Mode Chip */}
              <button
                type="button"
                disabled={isRunning}
                onClick={() => setAllowAllCli((v) => !v)}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-all cursor-pointer disabled:opacity-50 ${
                  allowAllCli
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 shadow-sm'
                    : 'border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/20 hover:text-white'
                }`}
                title={
                  allowAllCli
                    ? '当前模式：全自动执行（无需人工确认命令）'
                    : '当前模式：只读自动放行（修改命令需人工批准）'
                }
              >
                <Shield className={`h-3 w-3 shrink-0 ${allowAllCli ? 'text-amber-400' : 'text-teal-400'}`} />
                <span>{allowAllCli ? '全自动执行' : '只读自动放行'}</span>
              </button>
            </div>

            {/* Right controls: Keyboard shortcut hint + Run/Stop button */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden sm:inline text-[10px] text-slate-500">
                Enter 发送 · Shift+Enter 换行
              </span>
              {isRunning ? (
                <button
                  type="button"
                  onClick={handleAbort}
                  className="flex items-center gap-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors shadow"
                >
                  <Square className="h-3.5 w-3.5" />
                  <span>停止</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartTask}
                  disabled={!taskPrompt.trim()}
                  className="runbi-primary-button runbi-focus-ring flex items-center gap-1 px-3 py-1.5 text-xs font-medium disabled:opacity-40 cursor-pointer transition-colors shadow"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>执行</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
