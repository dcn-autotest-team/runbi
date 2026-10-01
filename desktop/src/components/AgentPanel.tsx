/**
 * @file desktop/src/components/AgentPanel.tsx
 * Runbi Desktop - Autonomous Agent Panel (EVA-inspired)
 * Provides interactive task execution, live reasoning, CLI tool call approval, and output display.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import {
  Terminal,
  Shield,
  Square,
  ChevronDown,
  ChevronRight,
  Check,
  Copy,
  RefreshCw,
  Folder,
  Cpu,
  Plus,
  Loader2,
  ArrowUp,
  ArrowUpRight,
  Sparkles,
  FileText,
  GitBranch,
  History,
  Trash2,
  X,
  Clock,
  MessageSquare,
} from 'lucide-react';
import { MarkdownRenderer } from '@runbi/shared/components';
import { estimateTokens } from '@runbi/shared/types';
import {
  AgentSession,
  loadSavedSessions,
  saveSessions,
  loadActiveSessionId,
  saveActiveSessionId,
  formatSessionTime,
} from './agentSessionStorage';


export interface AgentPanelProps {
  visible?: boolean;
  endpoint: string;
  apiKey: string;
  model: string;
  onModelChange?: (model: string) => void;
  modelList?: string[];
  onRefreshModels?: () => Promise<void>;
  modelsLoading?: boolean;
  modelListError?: string;
  onToast?: (msg: string) => void;
  initialPrompt?: string;
}

export interface ToolCallState {
  callId: string;
  name: string;
  command: string;
  requiresApproval: boolean;
  pendingApproval: boolean;
  output?: string;
  exitCode?: number | null;
}

export interface AgentTurn {
  id: string;
  prompt: string;
  projectDir: string;
  status: 'running' | 'done' | 'error' | 'aborted';
  thinking: string;
  isThinkingExpanded?: boolean;
  toolCalls: ToolCallState[];
  finalContent: string;
  compactionNote?: string;
  statusMessage?: string;
  outputStats?: { tokens: number; elapsedMs: number; streaming: boolean };
}

/**
 * Collapses degenerate consecutive repeated lines from model output or contaminated sessions.
 */
export function sanitizeTurnContent(text: string): string {
  if (!text) return '';
  const lines = text.split('\n');
  const cleaned: string[] = [];
  let prev = '';
  let repeatCount = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && trimmed === prev) {
      repeatCount++;
      if (repeatCount >= 2) continue;
    } else {
      prev = trimmed;
      repeatCount = 0;
    }
    cleaned.push(line);
  }
  return cleaned.join('\n').trim();
}

export const AgentPanel: React.FC<AgentPanelProps> = ({
  visible = true,
  endpoint,
  apiKey,
  model,
  onModelChange,
  modelList,
  onRefreshModels,
  modelsLoading,
  modelListError,
  onToast,
  initialPrompt,
}) => {
  const [taskPrompt, setTaskPrompt] = useState(initialPrompt || '');
  const lastInitialPromptRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (initialPrompt && initialPrompt !== lastInitialPromptRef.current) {
      lastInitialPromptRef.current = initialPrompt;
      setTaskPrompt(initialPrompt);
    }
  }, [initialPrompt]);

  const [projectDir, setProjectDir] = useState('.');
  const [allowAllCli, setAllowAllCli] = useState(false);
  const [isBrowsingFolder, setIsBrowsingFolder] = useState(false);

  // Session storage & multi-turn memory
  const [sessions, setSessions] = useState<AgentSession[]>(() => loadSavedSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => loadActiveSessionId());
  const [showHistory, setShowHistory] = useState(false);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // Session history (multi-turn memory)
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const turnsRef = useRef<AgentTurn[]>(turns);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  // Restore active session turns on mount if present
  useEffect(() => {
    const savedActiveId = loadActiveSessionId();
    if (savedActiveId) {
      const active = sessions.find((s) => s.id === savedActiveId);
      if (active) {
        setTurns(active.turns);
        turnsRef.current = active.turns;
        if (active.projectDir && active.projectDir !== '.') {
          setProjectDir(active.projectDir);
        }
      }
    }
  }, []);

  const [isRunning, setIsRunning] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const followOutput = useRef(true);
  const mountedRef = useRef(true);
  const currentTaskRef = useRef('');
  const browsingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const speedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (speedTimerRef.current !== null) clearInterval(speedTimerRef.current);
      if (runningRef.current) void invoke('abort_agent_task').catch(() => {});
    };
  }, []);

  // Auto-scroll on content updates
  useEffect(() => {
    if (visible && scrollRef.current && followOutput.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, visible]);

  // Click outside to close model dropdown
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

  // Candidate models strictly linked with settings/provider
  const availableModels = useMemo(() => {
    const list: string[] = [];
    if (modelList && modelList.length > 0) {
      modelList.forEach((m) => {
        if (!list.includes(m)) list.push(m);
      });
    }
    if (model && !list.includes(model)) {
      list.unshift(model);
    }
    return list;
  }, [modelList, model]);

  const handleSelectModel = useCallback(
    (m: string) => {
      onModelChange?.(m);
      setShowModelDropdown(false);
    },
    [onModelChange]
  );

  const handleSelectDirectory = useCallback(async () => {
    if (runningRef.current || browsingRef.current) return;
    browsingRef.current = true;
    setIsBrowsingFolder(true);
    try {
      const chosen = await invoke<string | null>('select_project_directory', {
        defaultPath: projectDir && projectDir !== '.' ? projectDir : undefined,
      });
      if (mountedRef.current && chosen && chosen.trim()) {
        setProjectDir(chosen.trim());
      }
    } catch (err: any) {
      onToast?.(`选择目录失败: ${err?.message || err}`);
    } finally {
      browsingRef.current = false;
      if (mountedRef.current) setIsBrowsingFolder(false);
    }
  }, [projectDir, onToast]);

  const persistSession = useCallback((sessionId: string, currentTurns: AgentTurn[], overrideTitle?: string, dir?: string) => {
    setSessions((prevList) => {
      const existingIdx = prevList.findIndex((s) => s.id === sessionId);
      const title = overrideTitle || (existingIdx >= 0 ? prevList[existingIdx].title : (currentTurns[0]?.prompt?.slice(0, 28) || '新任务'));
      const projectPath = dir ?? (existingIdx >= 0 ? prevList[existingIdx].projectDir : projectDir);
      const updatedSession: AgentSession = {
        id: sessionId,
        title,
        createdAt: existingIdx >= 0 ? prevList[existingIdx].createdAt : Date.now(),
        updatedAt: Date.now(),
        projectDir: projectPath,
        turns: currentTurns,
      };

      const nextList = [updatedSession, ...prevList.filter((s) => s.id !== sessionId)];
      saveSessions(nextList);
      return nextList;
    });
  }, [projectDir]);

  const handleNewSession = useCallback(() => {
    if (runningRef.current) {
      onToast?.('请先停止当前正在运行的任务');
      return;
    }
    setTurns([]);
    turnsRef.current = [];
    currentTaskRef.current = '';
    setTaskPrompt('');
    setActiveSessionId(null);
    activeSessionIdRef.current = null;
    saveActiveSessionId(null);
    inputRef.current?.focus();
    onToast?.('已开启新会话，上下文已重置');
  }, [onToast]);

  const handleSwitchSession = useCallback((sessionId: string) => {
    if (runningRef.current) {
      onToast?.('请先停止当前正在运行的任务再切换会话');
      return;
    }
    const target = sessions.find((s) => s.id === sessionId);
    if (!target) return;
    setActiveSessionId(target.id);
    activeSessionIdRef.current = target.id;
    saveActiveSessionId(target.id);
    setTurns(target.turns);
    turnsRef.current = target.turns;
    if (target.projectDir && target.projectDir !== '.') {
      setProjectDir(target.projectDir);
    }
    setShowHistory(false);
    onToast?.(`已切换至: ${target.title}`);
  }, [sessions, onToast]);

  const handleDeleteSession = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions((prevList) => {
      const nextList = prevList.filter((s) => s.id !== sessionId);
      saveSessions(nextList);
      return nextList;
    });
    if (activeSessionIdRef.current === sessionId) {
      setActiveSessionId(null);
      activeSessionIdRef.current = null;
      saveActiveSessionId(null);
      setTurns([]);
      turnsRef.current = [];
    }
    onToast?.('会话已删除');
  }, [onToast]);

  const handleStartTask = useCallback(async () => {
    if (runningRef.current || browsingRef.current) return;
    const trimmed = taskPrompt.trim();
    if (!trimmed) return;
    if (!endpoint.trim() || !model.trim()) {
      onToast?.('请先在设置中配置模型和服务地址');
      return;
    }
    const directory = projectDir.trim() || '.';
    // ponytail: retain 16 recent turns; backend also bounds history size. Longer memory needs explicit summarization.
    const history = turns.filter((t) => (t.projectDir === directory || !t.projectDir) && t.status !== 'running').slice(-16).flatMap((t) => {
      const cleanContent = sanitizeTurnContent(t.finalContent);
      const text = cleanContent || (t.toolCalls.length ? '已执行相关操作。' : '');
      const parts = [
        text,
        ...t.toolCalls.map((call) => `[命令] ${call.command}\n[结果] ${call.output ?? '未收到执行结果，不能确认是否完成'}`),
      ].filter(Boolean);
      return [
        { role: 'user', content: t.prompt },
        { role: 'assistant', content: parts.join('\n\n') },
      ];
    });

    let currentSessionId = activeSessionIdRef.current;
    const isNew = !currentSessionId || !sessions.some((s) => s.id === currentSessionId);
    if (isNew) {
      currentSessionId = crypto.randomUUID();
      activeSessionIdRef.current = currentSessionId;
      setActiveSessionId(currentSessionId);
      saveActiveSessionId(currentSessionId);
    }
    const sessionTitle = trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed;

    const id = crypto.randomUUID();
    currentTaskRef.current = id;
    let terminal = false;

    const activeTurn: AgentTurn = {
      id,
      projectDir: directory,
      prompt: trimmed,
      status: 'running',
      thinking: '',
      isThinkingExpanded: false,
      toolCalls: [],
      finalContent: '',
      statusMessage: '正在准备任务…',
    };
    const priorTurns = turnsRef.current;

    const syncPersist = () => {
      if (currentSessionId) {
        const allTurns = [...priorTurns.filter((t) => t.id !== id), { ...activeTurn }];
        persistSession(currentSessionId, allTurns, isNew ? sessionTitle : undefined, directory);
      }
    };

    const update = (change: (turn: AgentTurn) => AgentTurn) => {
      if (!mountedRef.current || currentTaskRef.current !== id) return;
      setTurns((list) => {
        const next = list.map((turn) => (turn.id === id ? change(turn) : turn));
        turnsRef.current = next;
        return next;
      });
    };

    let outputStartedAt: number | null = null;
    let outputElapsedMs = 0;
    const refreshSpeed = () => {
      activeTurn.outputStats = {
        tokens: estimateTokens(activeTurn.thinking + activeTurn.finalContent),
        elapsedMs: outputElapsedMs + (outputStartedAt === null ? 0 : performance.now() - outputStartedAt),
        streaming: outputStartedAt !== null,
      };
      update((turn) => ({ ...turn, outputStats: activeTurn.outputStats }));
    };
    const pauseSpeed = () => {
      if (outputStartedAt !== null) outputElapsedMs += performance.now() - outputStartedAt;
      outputStartedAt = null;
      if (speedTimerRef.current !== null) clearInterval(speedTimerRef.current);
      speedTimerRef.current = null;
      if (activeTurn.thinking || activeTurn.finalContent) refreshSpeed();
    };
    const resumeSpeed = () => {
      if (outputStartedAt === null) {
        outputStartedAt = performance.now();
        speedTimerRef.current = setInterval(refreshSpeed, 500);
      }
    };

    const finish = (status: AgentTurn['status'], message: string) => {
      if (terminal) return;
      pauseSpeed();
      terminal = true;
      activeTurn.status = status;
      activeTurn.statusMessage = message;
      activeTurn.toolCalls = activeTurn.toolCalls.map((tool) => ({ ...tool, pendingApproval: false }));
      update(() => ({ ...activeTurn }));
      syncPersist();
    };

    runningRef.current = true;
    followOutput.current = true;
    setShowModelDropdown(false);
    setTaskPrompt('');
    setIsRunning(true);
    setTurns((list) => {
      const next = [...list, { ...activeTurn }];
      turnsRef.current = next;
      return next;
    });

    try {
      const channel = new Channel();
      channel.onmessage = (event: any) => {
        if (!mountedRef.current || currentTaskRef.current !== id || terminal || !event?.payload) return;
        const payload = event.payload;
        if ((event.type === 'ThinkingChunk' || event.type === 'ContentChunk') && payload.delta) resumeSpeed();
        else if (event.type === 'ToolProposed' || event.type === 'Status') pauseSpeed();
        switch (event.type) {
          case 'ThinkingChunk':
            activeTurn.thinking += payload.delta;
            update((turn) => ({ ...turn, thinking: activeTurn.thinking }));
            break;
          case 'ContentChunk':
            activeTurn.finalContent += payload.delta;
            update((turn) => ({ ...turn, finalContent: activeTurn.finalContent }));
            break;
          case 'ContentReset':
            activeTurn.finalContent = '';
            update((turn) => ({ ...turn, finalContent: '' }));
            break;
          case 'ToolProposed':
            activeTurn.toolCalls = [
              ...activeTurn.toolCalls,
              {
                callId: payload.call_id,
                name: payload.name,
                command: payload.command,
                requiresApproval: payload.requires_approval,
                pendingApproval: payload.requires_approval,
              },
            ];
            update((turn) => ({ ...turn, toolCalls: activeTurn.toolCalls }));
            break;
          case 'ToolExecuted':
            activeTurn.toolCalls = activeTurn.toolCalls.map((tool) =>
              tool.callId === payload.call_id
                ? { ...tool, output: payload.output, exitCode: payload.exit_code, pendingApproval: false }
                : tool
            );
            update((turn) => ({ ...turn, toolCalls: activeTurn.toolCalls }));
            break;
          case 'MemoryCompacted':
            activeTurn.compactionNote = '已保存项目记忆';
            update((turn) => ({ ...turn, compactionNote: activeTurn.compactionNote }));
            break;
          case 'PersonaUpdated': {
            const note = payload.reflection ? '💡 已自主反思更新画像: ' + payload.reflection : '💡 已自主反思更新画像';
            activeTurn.compactionNote = note;
            update((turn) => ({ ...turn, compactionNote: note }));
            break;
          }
          case 'Status':
            activeTurn.statusMessage = payload.message;
            update((turn) => ({ ...turn, statusMessage: payload.message }));
            break;
          case 'Done':
            finish(payload.success ? 'done' : 'aborted', payload.success ? '任务已完成' : '任务已停止');
            break;
          case 'Error':
            finish('error', `任务失败: ${payload.message}`);
            setTaskPrompt((draft) => draft || trimmed);
            onToast?.(`任务失败: ${payload.message}`);
            break;
        }
      };
      await invoke('start_agent_task', {
        params: {
          endpoint,
          api_key: apiKey,
          model,
          prompt: trimmed,
          history: history.length ? history : undefined,
          project_dir: directory,
          allow_all: allowAllCli,
          max_turns: 15,
        },
        channel,
      });
      if (!terminal) finish('error', '任务连接已结束，但未收到完成确认，请检查执行结果');
    } catch (err: any) {
      if (!mountedRef.current) return;
      setTaskPrompt((draft) => draft || trimmed);
      finish('error', `任务失败: ${err?.message || err}`);
      onToast?.(`任务失败: ${err?.message || err}`);
    } finally {
      pauseSpeed();
      runningRef.current = false;
      if (mountedRef.current) setIsRunning(false);
      syncPersist();
    }
  }, [taskPrompt, projectDir, allowAllCli, endpoint, apiKey, model, turns, sessions, persistSession, onToast]);

  const handleAbort = useCallback(async () => {
    const id = currentTaskRef.current;
    setTurns((list) => list.map((turn) => turn.id === id && turn.status === 'running'
      ? { ...turn, statusMessage: '正在停止…' } : turn));
    try {
      await invoke('abort_agent_task');
    } catch (err: any) {
      onToast?.(`中止失败: ${err?.message || err}`);
    }
  }, [onToast]);

  const handleApproveTool = useCallback(async (callId: string, approved: boolean) => {
    const id = currentTaskRef.current;
    try {
      await invoke('approve_agent_tool', { callId, approved });
      if (!mountedRef.current) return;
      setTurns((list) => list.map((turn) => turn.id === id ? { ...turn,
        toolCalls: turn.toolCalls.map((tool) => tool.callId === callId ? { ...tool, pendingApproval: false } : tool),
      } : turn));
    } catch (err: any) {
      onToast?.(`操作失败: ${err?.message || err}`);
    }
  }, [onToast]);

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast?.('已复制到剪贴板');
    } catch {
      onToast?.('复制失败，请选中文字手动复制');
    }
  };

  const renderTurn = (turn: AgentTurn, isLive: boolean, turnIdx: number) => (
    <article key={turn.id} className="agent-turn">
      <div className="agent-user-message">
        <div className="agent-message-label"><span>你</span><span>任务 {String(turnIdx + 1).padStart(2, '0')}</span></div>
        <p>{turn.prompt}</p>
      </div>
      <div className="agent-response">
        <div className="agent-response-heading"><span className="agent-avatar"><Sparkles size={14} /></span><strong>润笔</strong>
          <span className={`agent-status ${turn.status === 'error' ? 'agent-error' : ''}`} role="status">
            {isLive ? <Loader2 size={12} className="animate-spin" /> : turn.status === 'done' ? <Check size={12} /> : null}
            {turn.statusMessage}
          </span>
        </div>
        {turn.thinking && <details className="agent-thinking">
          <summary><ChevronRight size={13} />思考过程<span>{turn.thinking.length.toLocaleString()} 字</span></summary>
          <div>{turn.thinking}</div>
        </details>}
        {turn.toolCalls.map((tool, idx) => <div className="agent-tool" key={`${tool.callId}-${idx}`}>
          <details open={tool.pendingApproval || undefined}>
            <summary>
              {tool.name === 'run_cli' ? <Terminal size={14} /> : tool.name === 'read_file' ? <FileText size={14} /> : <Terminal size={14} />}
              <span>{tool.name === 'run_cli' ? '终端命令' : tool.name === 'read_file' ? '读取文件' : '项目记忆'}</span>
              <code>{tool.command}</code><span className="agent-tool-state">{tool.pendingApproval ? '等待批准' : tool.output !== undefined ? (tool.exitCode === 0 ? '已完成' : '请检查结果') : isLive ? '执行中' : '未确认'}</span><ChevronDown size={13} />
            </summary>
            <pre>{tool.command}</pre>
            {tool.output !== undefined && <pre className="agent-tool-output">{tool.output}</pre>}
          </details>
          {isLive && tool.pendingApproval && <div className="agent-approval">
            <span><Shield size={14} />此操作需要你的批准</span>
            <div><button type="button" className="agent-button" onClick={() => handleApproveTool(tool.callId, false)}>拒绝</button>
            <button type="button" className="agent-button agent-button-primary" onClick={() => handleApproveTool(tool.callId, true)}><Check size={13} />批准执行</button></div>
          </div>}
        </div>)}
        {turn.compactionNote && <p className="agent-memory"><Check size={12} />{turn.compactionNote}</p>}
        {turn.finalContent && <div className="agent-answer"><MarkdownRenderer content={sanitizeTurnContent(turn.finalContent)} isGenerating={isLive} /></div>}
        {!isLive && <div className="agent-response-actions">
          {turn.finalContent && <button type="button" onClick={() => handleCopy(sanitizeTurnContent(turn.finalContent))} title="复制回复" aria-label="复制回复"><Copy size={13} />复制回复</button>}
          {(turn.status === 'error' || turn.status === 'aborted') && <button type="button" onClick={() => { setTaskPrompt(turn.prompt); inputRef.current?.focus(); }}><RefreshCw size={13} />重新编辑</button>}
        </div>}
      </div>
    </article>
  );

  const currentSession = useMemo(() => {
    return sessions.find((s) => s.id === activeSessionId);
  }, [sessions, activeSessionId]);

  const hasContent = turns.length > 0;
  const latestTurn = turns[turns.length - 1];

  return (
    <div
      className="runbi-agent relative overflow-hidden flex min-h-0 w-full flex-1 flex-col font-sans"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && showHistory) {
          e.preventDefault();
          setShowHistory(false);
        }
      }}
    >
      <header className="agent-header">
        <div>
          <span className="agent-presence" />
          <span>{isRunning ? '正在执行' : (currentSession?.title || '工作空间')}</span>
          <span className="agent-header-count">{turns.length ? `${turns.length} 轮对话` : '准备就绪'}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="agent-button"
            disabled={isRunning}
            onClick={handleNewSession}
            title="开启全新会话"
          >
            <Plus size={14} />新会话
          </button>
          <button
            type="button"
            className={`agent-button ${showHistory ? 'agent-button-active' : ''}`}
            onClick={() => setShowHistory((v) => !v)}
            title="查看历史会话"
            aria-label="历史会话"
          >
            <History size={14} />
            <span>历史会话</span>
            {sessions.length > 0 && <span className="agent-header-badge">{sessions.length}</span>}
          </button>
        </div>
      </header>
      {/* Main Execution Log View */}
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) followOutput.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="agent-scroll min-h-0 flex-1 overflow-y-auto runbi-settings-scroll"
      >
        {/* Empty state */}
        {!hasContent && (
          <div className="agent-welcome">
            <div className="agent-welcome-symbol"><Sparkles size={26} strokeWidth={1.3} /></div>
            <span className="agent-eyebrow">你的桌面协作助手</span>
            <h2>把任务交给润笔<span>留点时间给更重要的事。</span></h2>
            <p>从整理文件到理解代码，说说你想完成什么。</p>
            <div className="agent-suggestions">
              {[
                { title: '整理工作空间', detail: '看看目录里有什么', prompt: '概览当前目录的文件', Icon: Folder },
                { title: '梳理代码变更', detail: '快速了解最近的进展', prompt: '检查 Git 分支和未提交的更改', Icon: GitBranch },
                { title: '阅读项目文档', detail: '提炼重点与下一步', prompt: '阅读当前项目的说明文档，总结用途和使用方法', Icon: FileText },
              ].map(({ title, detail, prompt, Icon }) => <button key={title} type="button" onClick={() => { setTaskPrompt(prompt); inputRef.current?.focus(); }}>
                <Icon size={17} strokeWidth={1.5} /><strong>{title}</strong><span>{detail}</span><ArrowUpRight size={13} className="agent-suggestion-arrow" />
              </button>)}
            </div>
          </div>
        )}

        {/* Prior completed turns */}
        {turns.map((t, idx) => renderTurn(t, t.status === 'running', idx))}


      </div>

      {/* Bottom Task Input Box (Codex-style integrated console) */}
      <div className="agent-composer-wrap shrink-0">
        {latestTurn && (latestTurn.status === 'running' || latestTurn.outputStats) && <div className="agent-output-speed" title="根据思考和回复文本估算 token；平均速度不包含首字等待、工具执行和批准等待时间。不同模型的实际 token 数可能不同。">
          <Cpu size={12} />
          <span>{latestTurn.outputStats && latestTurn.outputStats.elapsedMs >= 500
            ? `≈ ${(latestTurn.outputStats.tokens / (latestTurn.outputStats.elapsedMs / 1000)).toFixed(1)} tokens/s`
            : '— tokens/s'}</span>
          <span>{latestTurn.status === 'running'
            ? latestTurn.outputStats?.streaming ? '实时均速 · 估算' : '等待输出 · 估算'
            : '平均速度 · 估算'}</span>
          {!!latestTurn.outputStats?.tokens && <span>约 {latestTurn.outputStats.tokens.toLocaleString()} tokens</span>}
        </div>}
        <div className="agent-composer">
          {/* Prompt textarea */}
          <textarea
            ref={inputRef}
            rows={3}
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
                : hasContent
                ? '在此输入下一轮指令（智能体保留上下文记忆）…'
                : '描述你希望完成的任务（支持执行终端命令、分析代码等）…'
            }
            className="agent-input"
          />

          {/* Integrated Action Toolbar inside Input Box */}
          <div className="agent-toolbar">
            {/* Left controls: New Session, Directory, Model, Permission */}
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              {/* Directory Chip */}
              <div
                className="agent-directory"
                title={`工作目录: ${projectDir || '.'}`}
              >
                <button
                  type="button"
                  disabled={isRunning || isBrowsingFolder}
                  onClick={handleSelectDirectory}
                  className="agent-directory-button"
                  title="点击弹出本地文件夹选择器"
                >
                  {isBrowsingFolder ? (
                    <Loader2 className="h-3 w-3 animate-spin text-teal-400" />
                  ) : (
                    <Folder className="h-3 w-3 shrink-0" />
                  )}
                  <span className="sr-only">工作目录:</span>
                </button>
                <input
                  type="text"
                  value={projectDir}
                  disabled={isRunning || isBrowsingFolder}
                  onChange={(e) => setProjectDir(e.target.value)}
                  placeholder="."
                  className="agent-directory-input"
                  aria-label="工作目录"
                />
              </div>

              {/* Model Selector Chip (Strictly linked with Settings) */}
              <div ref={modelMenuRef} className="relative" onKeyDown={(e) => {
                if (e.key === 'Escape' && showModelDropdown) { e.preventDefault(); e.stopPropagation(); setShowModelDropdown(false); }
              }}>
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => setShowModelDropdown((v) => !v)}
                  className="agent-button agent-model-trigger"
                  title="当前设置绑定的模型"
                  aria-label="选择模型"
                  aria-expanded={showModelDropdown}
                >
                  <Cpu className="h-3 w-3 shrink-0" />
                  <span className="max-w-[90px] truncate font-mono">{model || '未选模型'}</span>
                  <ChevronDown className="h-2.5 w-2.5 text-slate-400" />
                </button>
                {showModelDropdown && (
                  <div className="agent-model-menu">
                    <div className="flex items-center justify-between px-2 py-1 text-[10px] font-medium text-slate-400 border-b border-white/10 mb-1">
                      <span>与设置联动模型</span>
                      {onRefreshModels && (
                        <button
                          type="button"
                          disabled={modelsLoading}
                          onClick={async (e) => {
                            e.stopPropagation();
                            try { await onRefreshModels(); } catch (error) { onToast?.(`刷新模型失败: ${error}`); }
                          }}
                          className="agent-directory-button"
                          title="从当前服务地址刷新模型列表"
                        >
                          <RefreshCw className={`h-2.5 w-2.5 ${modelsLoading ? 'animate-spin' : ''}`} />
                          <span>刷新</span>
                        </button>
                      )}
                    </div>
                    {modelListError && <p role="alert" className="agent-error px-2 py-1">{modelListError}</p>}
                    <div className="max-h-40 overflow-y-auto space-y-0.5 runbi-settings-scroll">
                      {availableModels.length > 0 ? (
                        availableModels.map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => handleSelectModel(m)}
                            className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[11px] text-left transition-colors cursor-pointer ${
                              m === model
                                ? 'bg-teal-500/20 text-teal-300 font-medium'
                                : 'text-slate-300 hover:bg-white/10'
                            }`}
                          >
                            <span className="truncate">{m}</span>
                            {m === model && <Check className="h-3 w-3 text-teal-400 shrink-0" />}
                          </button>
                        ))
                      ) : (
                        <div className="px-2 py-2 text-[11px] text-slate-500 text-center">
                          暂无列表，可在下方输入同步
                        </div>
                      )}
                    </div>
                    <div className="mt-1.5 pt-1.5 border-t border-white/10 px-1">
                      <input
                        type="text"
                        placeholder="输入模型名称并按回车联动保存..."
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                          if (e.key === 'Enter') {
                            e.preventDefault();
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
                className={`agent-button agent-permission ${allowAllCli ? 'agent-permission-auto' : ''}`}
                aria-pressed={allowAllCli}
                title={
                  allowAllCli
                    ? '当前模式：全自动执行（无需人工确认命令）'
                    : '当前模式：只读自动放行（修改命令需人工批准）'
                }
              >
                <Shield className="h-3 w-3 shrink-0" />
                <span>{allowAllCli ? '全自动执行' : '只读自动放行'}</span>
              </button>
            </div>

            {/* Right controls: Keyboard shortcut hint + Run/Stop button */}
            <div className="flex items-center gap-2 shrink-0">

              {isRunning ? (
                <button
                  type="button"
                  onClick={handleAbort}
                  className="agent-send agent-stop"
                  aria-label="停止任务"
                >
                  <Square className="h-3.5 w-3.5" />
                  <span className="sr-only">停止</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartTask}
                  disabled={!taskPrompt.trim() || isBrowsingFolder}
                  className="agent-send"
                  aria-label="执行任务"
                >
                  <ArrowUp size={18} />
                  <span className="sr-only">执行</span>
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="agent-composer-hint"><span>{isRunning ? '可以先准备下一条指令' : 'Enter 发送 · Shift + Enter 换行'}</span><span>操作过程，由你掌控</span></div>
      </div>

      {/* History Drawer Slide-over */}
      {showHistory && (
        <>
          <div
            className="agent-history-backdrop"
            onClick={() => setShowHistory(false)}
            aria-hidden="true"
          />
          <aside className="agent-history-drawer" aria-label="历史会话列表">
            <div className="agent-history-header">
              <div className="flex items-center gap-2">
                <History size={15} className="text-teal-400" />
                <span>历史会话</span>
                <span className="agent-header-badge">{sessions.length}</span>
              </div>
              <button
                type="button"
                className="agent-button p-1 hover:text-white"
                onClick={() => setShowHistory(false)}
                aria-label="关闭历史记录"
                title="关闭"
              >
                <X size={15} />
              </button>
            </div>

            <div className="agent-history-list runbi-settings-scroll">
              {sessions.length === 0 ? (
                <div className="agent-history-empty">
                  <MessageSquare size={28} strokeWidth={1.5} className="opacity-40" />
                  <p>暂无历史会话</p>
                  <span className="text-[11px] opacity-60">发起对话后会自动保存在这里</span>
                </div>
              ) : (
                sessions.map((sess) => {
                  const isActive = sess.id === activeSessionId;
                  return (
                    <div
                      key={sess.id}
                      role="button"
                      tabIndex={0}
                      className={`agent-history-item ${isActive ? 'is-active' : ''}`}
                      onClick={() => handleSwitchSession(sess.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSwitchSession(sess.id);
                        }
                      }}
                      title={`${sess.title}\n目录: ${sess.projectDir}\n时间: ${formatSessionTime(sess.updatedAt)}`}
                    >
                      <div className="agent-history-item-title">
                        {sess.title}
                      </div>
                      <div className="agent-history-item-meta">
                        <span className="flex items-center gap-1">
                          <Clock size={11} className="shrink-0" />
                          {formatSessionTime(sess.updatedAt)}
                        </span>
                        <span>·</span>
                        <span>{sess.turns.length} 轮问答</span>
                      </div>
                      <button
                        type="button"
                        className="agent-history-item-del"
                        onClick={(e) => handleDeleteSession(sess.id, e)}
                        title="删除此会话"
                        aria-label={`删除会话 ${sess.title}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
};
