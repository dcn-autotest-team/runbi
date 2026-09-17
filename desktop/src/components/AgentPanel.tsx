/**
 * @file desktop/src/components/AgentPanel.tsx
 * Runbi Desktop - Autonomous Agent Panel (EVA-inspired)
 * Provides interactive task execution, live reasoning, CLI tool call approval, and output display.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { Terminal, Shield, Play, Square, ChevronDown, ChevronRight, Check, X, Copy, RefreshCw, Folder } from 'lucide-react';

export interface AgentPanelProps {
  endpoint: string;
  apiKey: string;
  model: string;
  onToast?: (msg: string) => void;
}

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
  onToast,
}) => {
  const [taskPrompt, setTaskPrompt] = useState('');
  const [projectDir, setProjectDir] = useState('.');
  const [allowAllCli, setAllowAllCli] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [thinkingText, setThinkingText] = useState('');
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(true);
  const [finalContent, setFinalContent] = useState('');
  const [toolCalls, setToolCalls] = useState<ToolCallState[]>([]);
  const [compactionNote, setCompactionNote] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on content updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thinkingText, finalContent, toolCalls, statusMessage]);

  const handleStartTask = useCallback(async () => {
    const trimmed = taskPrompt.trim();
    if (!trimmed) {
      onToast?.('请输入任务目标');
      return;
    }
    if (!apiKey) {
      onToast?.('请先在设置中配置 API Key');
      return;
    }

    setIsRunning(true);
    setStatusMessage('初始化任务环境中…');
    setThinkingText('');
    setFinalContent('');
    setToolCalls([]);
    setCompactionNote('');

    try {
      const channel = new Channel();
      channel.onmessage = (event: any) => {
        if (!event || !event.type) return;

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
            setIsRunning(false);
            setStatusMessage(event.payload.success ? '任务已完成' : '任务已停止');
            onToast?.(event.payload.success ? '任务完成' : '任务停止');
            break;

          case 'Error':
            setIsRunning(false);
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
          model: model || 'deepseek-chat',
          prompt: trimmed,
          project_dir: projectDir || '.',
          allow_all: allowAllCli,
          max_turns: 15,
        },
        channel,
      });
    } catch (err: any) {
      setIsRunning(false);
      setStatusMessage(`启动失败: ${err?.message || err}`);
      onToast?.(`启动失败: ${err?.message || err}`);
    }
  }, [taskPrompt, projectDir, allowAllCli, endpoint, apiKey, model, onToast]);

  const handleAbort = useCallback(async () => {
    try {
      await invoke('abort_agent_task');
      setStatusMessage('正在中止任务…');
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

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    onToast?.('已复制到剪贴板');
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col font-sans select-none text-slate-200">
      {/* Top Workspace & Config Bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-black/30 px-3 py-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <Folder className="h-3.5 w-3.5 text-teal-400 shrink-0" />
          <span className="text-[11px] text-slate-400 shrink-0">工作目录:</span>
          <input
            type="text"
            value={projectDir}
            disabled={isRunning}
            onChange={(e) => setProjectDir(e.target.value)}
            placeholder="."
            className="runbi-form-control max-w-[200px] py-0.5 px-2 text-[11px] font-mono"
            title="执行 CLI 命令时的根工作目录"
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-300">
            <input
              type="checkbox"
              checked={allowAllCli}
              disabled={isRunning}
              onChange={(e) => setAllowAllCli(e.target.checked)}
              className="rounded border-white/20 bg-white/10 text-teal-500 focus:ring-0"
            />
            <Shield className={`h-3 w-3 ${allowAllCli ? 'text-amber-400' : 'text-teal-400'}`} />
            <span>{allowAllCli ? '全自动执行 (无需人工确认)' : '只读自动放行 (修改需批准)'}</span>
          </label>
        </div>
      </div>

      {/* Main Execution Log View */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3.5 space-y-3 runbi-settings-scroll">
        {/* Empty state */}
        {!isRunning && !thinkingText && !finalContent && toolCalls.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-center text-slate-500">
            <Terminal className="h-8 w-8 mb-2 text-slate-600" />
            <p className="text-xs">输入你的目标任务，Runbi 智能体将自主规划并执行命令。</p>
            <p className="text-[11px] text-slate-600 mt-1">例如：“检查当前分支是否有未提交代码并给出概览” 或 “查找占用端口的应用”</p>
          </div>
        )}

        {/* Status indicator */}
        {statusMessage && (
          <div className="flex items-center gap-2 text-[11px] text-teal-300/90 bg-teal-950/30 border border-teal-500/20 rounded-lg px-2.5 py-1.5">
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
              <div className="p-3 bg-amber-950/40 border-t border-amber-500/30 flex items-center justify-between gap-3">
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
          <div className="rounded-xl border border-teal-500/30 bg-teal-950/20 p-4 text-xs text-slate-100 whitespace-pre-wrap leading-relaxed shadow-lg relative group">
            <button
              type="button"
              onClick={() => handleCopy(finalContent)}
              className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              title="复制回复"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <div className="font-semibold text-teal-300 mb-1.5">智能体回复：</div>
            {finalContent}
          </div>
        )}
      </div>

      {/* Bottom Task Input Box */}
      <div className="p-3 border-t border-white/10 bg-black/30 shrink-0">
        <div className="relative flex items-center">
          <textarea
            rows={2}
            value={taskPrompt}
            onChange={(e) => setTaskPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
                e.preventDefault();
                if (!isRunning) handleStartTask();
              }
            }}
            placeholder="输入目标任务（如：统计当前代码行数、查找最新变更… 回车发送）"
            className="w-full resize-none rounded-xl border border-white/15 bg-black/40 px-3 py-2 pr-20 text-xs text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
          <div className="absolute right-2.5 flex items-center gap-1.5">
            {isRunning ? (
              <button
                type="button"
                onClick={handleAbort}
                className="flex items-center gap-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 text-xs font-medium cursor-pointer"
              >
                <Square className="h-3.5 w-3.5" />
                <span>停止</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartTask}
                disabled={!taskPrompt.trim()}
                className="runbi-primary-button runbi-focus-ring flex items-center gap-1 px-3 py-1.5 text-xs font-medium disabled:opacity-40 cursor-pointer"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>执行</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
