/**
 * @file shared/core/chatMemory.ts
 * 聊天上下文记忆（Chat Memory）
 *
 * 回复模式每次只能看到「当前屏截图」里的对话气泡：用户滚动聊天窗口或换个窗口重截，
 * 上一屏的上下文就丢了，模型只能对着半截对话猜。
 *
 * 这里把每次解析出的 conversation 按「聊天对象」累积成一段记忆，
 * 生成回复时把累计历史一起喂给模型，跨屏/跨次截图的上下文就能接上。
 *
 * 分层：本模块只做纯内存计算 + 可序列化快照，不做任何 IO。
 * 落盘由平台适配器（IStorageProvider）在调用方完成，各端可自由选择存储介质。
 */

export type ChatMemoryRole = 'me' | 'other';

export interface ChatMemoryMessage {
  role: ChatMemoryRole;
  /** 消息原文（已 trim，可能被 CHAT_MEMORY_MAX_MESSAGE_CHARS 截断） */
  text: string;
  /** 记录时间（毫秒时间戳） */
  timestamp: number;
}

export interface ChatMemorySnapshot {
  version: number;
  sessions: Record<string, ChatMemoryMessage[]>;
}

/** 快照格式版本，未来结构变更时用于丢弃不兼容的旧数据。 */
export const CHAT_MEMORY_SNAPSHOT_VERSION = 1;
/** 单个聊天对象保留的最大消息条数，超出从最早的消息开始丢。 */
export const CHAT_MEMORY_MAX_MESSAGES = 50;
/** 最多保留的聊天对象数量（写新会话时按插入顺序淘汰最早的）。 */
export const CHAT_MEMORY_MAX_SESSIONS = 20;
/** 单条消息最大字符数：模型偶尔会把整屏文字塞进一条，截断防止持久化体积失控。 */
export const CHAT_MEMORY_MAX_MESSAGE_CHARS = 2000;

/**
 * 把模型返回的对话数组净化成可存储的消息。
 * 输入来自 LLM 的 JSON 解析结果，属于不可信边界：任何形状都可能出现。
 * 同时兼容 `{sender, text}`（prompts.ts 的 ScreenReplyAnalysis）与 `{role, content}` 两种写法。
 */
function normalizeConversation(input: unknown): ChatMemoryMessage[] {
  if (!Array.isArray(input)) return [];
  const out: ChatMemoryMessage[] = [];
  const now = Date.now();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const rawText = item.text ?? item.content;
    if (typeof rawText !== 'string') continue;
    // 只裁剪首尾空白与超长，不动消息内部的换行
    const text = rawText.trim().slice(0, CHAT_MEMORY_MAX_MESSAGE_CHARS);
    if (!text) continue;
    const sender = item.sender ?? item.role;
    // 只有明确标为 me 的才算自己发的；其余（含非法值）一律按对方处理
    out.push({ role: sender === 'me' ? 'me' : 'other', text, timestamp: now });
  }
  return out;
}

/** incoming 的前缀与 existing 的后缀的最大重叠长度（用于识别「重截了同一屏」）。 */
function overlapSuffixLength(existing: ChatMemoryMessage[], incoming: ChatMemoryMessage[]): number {
  const max = Math.min(existing.length, incoming.length);
  for (let len = max; len > 0; len--) {
    let matched = true;
    for (let i = 0; i < len; i++) {
      const a = existing[existing.length - len + i];
      const b = incoming[i];
      if (a.text !== b.text || a.role !== b.role) {
        matched = false;
        break;
      }
    }
    if (matched) return len;
  }
  return 0;
}

/** incoming 是否已被 existing 完整包含（用户往回滚动、重看已记录过的对话）。 */
function isAlreadyRecorded(existing: ChatMemoryMessage[], incoming: ChatMemoryMessage[]): boolean {
  return incoming.every((msg) => existing.some((m) => m.text === msg.text && m.role === msg.role));
}

export class ChatMemoryStore {
  private sessions = new Map<string, ChatMemoryMessage[]>();

  private list(key: string): ChatMemoryMessage[] {
    const existing = this.sessions.get(key);
    if (existing) return existing;
    const created: ChatMemoryMessage[] = [];
    this.sessions.set(key, created);
    // ponytail: 按插入顺序淘汰而不是 LRU——窗口标题易变（如「微信 - 3 条未读」）会造出
    // 大量一次性 key，先进先出足以挡住无界增长。真需要按活跃度淘汰时改成 delete+set 重排即可。
    while (this.sessions.size > CHAT_MEMORY_MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      this.sessions.delete(oldest);
    }
    return created;
  }

  /**
   * 把一次解析出的对话并入记忆，返回该聊天对象合并后的完整历史（时间从早到晚）。
   *
   * 增量合并而不是无脑追加：用户滚动聊天窗口后重截，新一屏的开头会和上一屏的结尾
   * 重叠，按重叠长度裁掉才不会出现同一句话记两遍；若整段都已记过则原样返回。
   *
   * ponytail: 只识别「尾部重叠」，即向下滚动/连续重截这种主流方向。用户往回滚动
   * （更早的消息）且内容不完全重复时，这屏会被追加到末尾，历史顺序出现偏差。
   * 升级路径：把重叠锚点从「尾部」放宽为「任意位置的最大公共子串」再做插入。
   */
  mergeConversation(key: string, conversation: unknown): ChatMemoryMessage[] {
    const list = this.list(key);
    const incoming = normalizeConversation(conversation);
    if (incoming.length === 0) return [...list];

    const overlap = overlapSuffixLength(list, incoming);
    const fresh = overlap > 0 ? incoming.slice(overlap) : isAlreadyRecorded(list, incoming) ? [] : incoming;

    for (const msg of fresh) {
      list.push({ ...msg, timestamp: Date.now() });
    }
    if (list.length > CHAT_MEMORY_MAX_MESSAGES) {
      list.splice(0, list.length - CHAT_MEMORY_MAX_MESSAGES);
    }
    return [...list];
  }

  /**
   * 记录一条「我」已发出的回复。用户在面板上贴回/发送后调用，
   * 让记忆与聊天窗口保持同步（下次截图解析出这条时会被重叠检测吸收，不会重复）。
   */
  recordSentMessage(key: string, text: string): ChatMemoryMessage[] {
    const trimmed = String(text ?? '').trim().slice(0, CHAT_MEMORY_MAX_MESSAGE_CHARS);
    if (!trimmed) return this.getHistory(key);
    const list = this.list(key);
    const last = list[list.length - 1];
    if (last && last.role === 'me' && last.text === trimmed) return [...list];
    list.push({ role: 'me', text: trimmed, timestamp: Date.now() });
    if (list.length > CHAT_MEMORY_MAX_MESSAGES) {
      list.splice(0, list.length - CHAT_MEMORY_MAX_MESSAGES);
    }
    return [...list];
  }

  getHistory(key: string): ChatMemoryMessage[] {
    return [...this.list(key)];
  }

  /** 清空某个聊天对象的记忆（用户主动纠正/换人时用）。 */
  clearSession(key: string): void {
    this.sessions.delete(key);
  }

  clearAll(): void {
    this.sessions.clear();
  }

  /** 导出可持久化快照。 */
  serialize(): ChatMemorySnapshot {
    const sessions: Record<string, ChatMemoryMessage[]> = {};
    for (const [key, messages] of this.sessions) {
      if (messages.length > 0) sessions[key] = messages.map((m) => ({ ...m }));
    }
    return { version: CHAT_MEMORY_SNAPSHOT_VERSION, sessions };
  }

  /** 从快照恢复（启动时调用）。版本不符或结构损坏时静默丢弃，不影响应用启动。 */
  hydrate(snapshot: unknown): void {
    this.sessions.clear();
    if (!snapshot || typeof snapshot !== 'object') return;
    const raw = snapshot as Partial<ChatMemorySnapshot>;
    if (raw.version !== CHAT_MEMORY_SNAPSHOT_VERSION) return;
    if (!raw.sessions || typeof raw.sessions !== 'object') return;
    for (const [key, messages] of Object.entries(raw.sessions)) {
      if (!key || !Array.isArray(messages)) continue;
      const cleaned = normalizeConversation(messages);
      if (cleaned.length > 0) {
        this.sessions.set(key, cleaned.slice(-CHAT_MEMORY_MAX_MESSAGES));
      }
      if (this.sessions.size >= CHAT_MEMORY_MAX_SESSIONS) break;
    }
  }
}

export const globalChatMemory = new ChatMemoryStore();

/** 由前台应用与窗口标题推导聊天对象 key；两者都拿不到时返回空串（调用方据此跳过记忆）。 */
export function buildChatMemoryKey(sourceApp?: string | null, windowTitle?: string | null): string {
  const app = (sourceApp || '').trim().toLowerCase();
  const title = (windowTitle || '').trim();
  if (!app && !title) return '';
  return `${app}::${title}`;
}
