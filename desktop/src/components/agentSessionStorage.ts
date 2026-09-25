/**
 * @file desktop/src/components/agentSessionStorage.ts
 * Persistence & session management for Runbi Autonomous Agent.
 * Stores multi-turn conversations so users can review history and continue dialogs.
 */

import type { AgentTurn } from './AgentPanel';

export interface AgentSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  projectDir: string;
  turns: AgentTurn[];
}

export const STORAGE_KEY_SESSIONS = 'runbi:agent_sessions_v1';
export const STORAGE_KEY_ACTIVE_ID = 'runbi:agent_active_session_id';
const MAX_SAVED_SESSIONS = 50;

/**
 * Safely load saved agent sessions from storage.
 * Automatically sanitizes any unfinished 'running' turns to 'aborted' state.
 */
export function loadSavedSessions(): AgentSession[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_SESSIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((session: any): AgentSession => ({
      id: String(session.id || crypto.randomUUID()),
      title: String(session.title || '新任务'),
      createdAt: Number(session.createdAt) || Date.now(),
      updatedAt: Number(session.updatedAt) || Date.now(),
      projectDir: String(session.projectDir || '.'),
      turns: Array.isArray(session.turns)
        ? session.turns.map((t: AgentTurn) => ({
            ...t,
            status: t.status === 'running' ? 'aborted' : t.status,
            statusMessage: t.status === 'running' ? '任务已中断' : t.statusMessage,
            toolCalls: Array.isArray(t.toolCalls)
              ? t.toolCalls.map((tc) => ({ ...tc, pendingApproval: false }))
              : [],
          }))
        : [],
    })).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (e) {
    console.warn('[agentSessionStorage] loadSavedSessions failed:', e);
    return [];
  }
}

/**
 * Save sessions to local storage, keeping up to MAX_SAVED_SESSIONS.
 */
export function saveSessions(sessions: AgentSession[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const trimmed = sessions.slice(0, MAX_SAVED_SESSIONS);
    window.localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('[agentSessionStorage] saveSessions failed:', e);
  }
}

export function loadActiveSessionId(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY_ACTIVE_ID);
  } catch {
    return null;
  }
}

export function saveActiveSessionId(id: string | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (id) {
      window.localStorage.setItem(STORAGE_KEY_ACTIVE_ID, id);
    } else {
      window.localStorage.removeItem(STORAGE_KEY_ACTIVE_ID);
    }
  } catch {}
}

/**
 * Format timestamp into human-readable relative/calendar time.
 */
export function formatSessionTime(timestamp: number): string {
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSec < 60) return '刚刚';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}小时前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}天前`;

  const d = new Date(timestamp);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${month}月${day}日 ${hours}:${minutes}`;
}
