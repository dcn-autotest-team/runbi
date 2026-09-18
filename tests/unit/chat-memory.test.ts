import { describe, it, expect, beforeEach } from 'vitest';
import {
  ChatMemoryStore,
  CHAT_MEMORY_MAX_MESSAGES,
  CHAT_MEMORY_MAX_SESSIONS,
  CHAT_MEMORY_MAX_MESSAGE_CHARS,
  CHAT_MEMORY_SNAPSHOT_VERSION,
  buildChatMemoryKey,
} from '@runbi/shared/core';

type Store = InstanceType<typeof ChatMemoryStore>;

/**
 * ChatMemoryStore 有模块级单例，测试里不用单例，直接 new 保证互不串台。
 * 这里顺带断言导出确实可用（module-level export 漏了会在编译期就红）。
 */
const newStore = (): Store => new ChatMemoryStore();

const texts = (store: Store, key: string) => store.getHistory(key).map((m) => `${m.role}:${m.text}`);

describe('Shared Core: Chat Memory (聊天上下文记忆)', () => {
  let store: Store;
  beforeEach(() => {
    store = newStore();
  });

  it('按聊天对象隔离，且首次写入即返回全量', () => {
    const first = store.mergeConversation('wechat::与张三的聊天', [
      { sender: 'other', text: '在吗' },
      { sender: 'other', text: '方案好了吗' },
    ]);
    expect(first.map((m) => m.text)).toEqual(['在吗', '方案好了吗']);

    store.mergeConversation('feishu::项目群', [{ sender: 'other', text: '飞书那边的消息' }]);

    expect(texts(store, 'wechat::与张三的聊天')).toEqual(['other:在吗', 'other:方案好了吗']);
    expect(texts(store, 'feishu::项目群')).toEqual(['other:飞书那边的消息']);
  });

  it('滚动聊天窗口后重截：新一屏与上一屏重叠的部分不会记两遍，新增的部分正常接上', () => {
    const key = 'weixin.exe::微信';
    store.mergeConversation(key, [
      { sender: 'other', text: '在吗' },
      { sender: 'other', text: '方案好了吗' },
    ]);
    // 用户贴回的回复先入记忆
    store.recordSentMessage(key, '好，周五前给你');

    // 滚动后重截：开头两屏重叠，多出一条新消息
    const merged = store.mergeConversation(key, [
      { sender: 'other', text: '方案好了吗' },
      { sender: 'me', text: '好，周五前给你' },
      { sender: 'other', text: '尽快' },
    ]);

    expect(merged.map((m) => `${m.role}:${m.text}`)).toEqual([
      'other:在吗',
      'other:方案好了吗',
      'me:好，周五前给你',
      'other:尽快',
    ]);
  });

  it('重截同一屏（整段重复）不追加任何内容', () => {
    const key = 'weixin.exe::微信';
    const screen = [
      { sender: 'other', text: '这个周五能上线吗' },
      { sender: 'me', text: '可以' },
    ];
    store.mergeConversation(key, screen);
    store.mergeConversation(key, screen);
    store.mergeConversation(key, screen);
    expect(store.getHistory(key)).toHaveLength(2);
  });

  it('往回滚动重看已记录过的对话时不追加', () => {
    const key = 'weixin.exe::微信';
    store.mergeConversation(key, [
      { sender: 'other', text: '一' },
      { sender: 'other', text: '二' },
      { sender: 'other', text: '三' },
    ]);
    store.mergeConversation(key, [{ sender: 'other', text: '一' }]);
    expect(texts(store, key)).toEqual(['other:一', 'other:二', 'other:三']);
  });

  it('连发多条相同内容不会被误判成重复（重叠检测是按位置而非全文去重）', () => {
    const key = 'weixin.exe::微信';
    store.mergeConversation(key, [{ sender: 'other', text: '好的' }]);
    store.mergeConversation(key, [
      { sender: 'other', text: '好的' },
      { sender: 'other', text: '好的' },
    ]);
    expect(texts(store, key)).toEqual(['other:好的', 'other:好的']);
  });

  it('recordSentMessage 连续记录同一条只留一份，且排在我的历史末尾', () => {
    const key = 'weixin.exe::微信';
    store.mergeConversation(key, [{ sender: 'other', text: '明天有空吗' }]);
    store.recordSentMessage(key, '  明天下午可以  ');
    store.recordSentMessage(key, '明天下午可以');
    expect(texts(store, key)).toEqual(['other:明天有空吗', 'me:明天下午可以']);

    store.recordSentMessage(key, '   ');
    expect(texts(store, key)).toHaveLength(2);
  });

  it('兼容 {role, content} 写法，并把非法发送方归为对方', () => {
    const key = 'k';
    store.mergeConversation(key, [
      { role: 'me', content: '我说的' },
      { role: '其他', content: '来源不明' },
      { sender: 'other', text: '对方说的' },
    ]);
    expect(texts(store, key)).toEqual(['me:我说的', 'other:来源不明', 'other:对方说的']);
  });

  it('非法/恶意输入一律安全丢弃，不写入也不抛错', () => {
    const key = 'k';
    expect(store.mergeConversation(key, undefined)).toEqual([]);
    expect(store.mergeConversation(key, null)).toEqual([]);
    expect(store.mergeConversation(key, 'not an array')).toEqual([]);
    expect(store.mergeConversation(key, [{ sender: 'other' }])).toEqual([]);
    expect(store.mergeConversation(key, [{ sender: 'other', text: '   ' }])).toEqual([]);
    expect(store.mergeConversation(key, [null, 42, 'str', []])).toEqual([]);
    expect(store.mergeConversation(key, [{ sender: 'other', text: 123 }])).toEqual([]);
    expect(store.getHistory(key)).toEqual([]);
  });

  it('单条超长消息按上限截断，不在持久化里堆进整屏文字', () => {
    const key = 'k';
    const merged = store.mergeConversation(key, [{ sender: 'other', text: '中'.repeat(CHAT_MEMORY_MAX_MESSAGE_CHARS + 500) }]);
    expect(merged[0].text).toHaveLength(CHAT_MEMORY_MAX_MESSAGE_CHARS);
  });

  it('单会话超出上限时从最早的消息开始丢', () => {
    const key = 'k';
    for (let i = 0; i < CHAT_MEMORY_MAX_MESSAGES + 10; i++) {
      store.mergeConversation(key, [{ sender: 'other', text: `msg-${i}` }]);
    }
    const history = store.getHistory(key);
    expect(history).toHaveLength(CHAT_MEMORY_MAX_MESSAGES);
    expect(history[0].text).toBe('msg-10');
    expect(history[history.length - 1].text).toBe(`msg-${CHAT_MEMORY_MAX_MESSAGES + 9}`);
  });

  it('会话数量受上限约束，不会因窗口标题频繁变化而无界增长', () => {
    for (let i = 0; i < CHAT_MEMORY_MAX_SESSIONS + 15; i++) {
      store.mergeConversation(`app::title-${i}`, [{ sender: 'other', text: 'hi' }]);
    }
    const snapshot = store.serialize();
    expect(Object.keys(snapshot.sessions).length).toBeLessThanOrEqual(CHAT_MEMORY_MAX_SESSIONS);
    // 最新的那个必须还在
    expect(snapshot.sessions[`app::title-${CHAT_MEMORY_MAX_SESSIONS + 14}`]).toBeDefined();
  });

  it('clearSession 只清指定聊天对象，clearAll 清全部', () => {
    store.mergeConversation('a', [{ sender: 'other', text: '1' }]);
    store.mergeConversation('b', [{ sender: 'other', text: '2' }]);
    store.clearSession('a');
    expect(store.getHistory('a')).toEqual([]);
    expect(store.getHistory('b')).toHaveLength(1);
    store.clearAll();
    expect(store.getHistory('b')).toEqual([]);
  });

  it('serialize / hydrate 往返保持内容与顺序', () => {
    const key = 'weixin.exe::微信';
    store.mergeConversation(key, [
      { sender: 'other', text: '甲' },
      { sender: 'me', text: '乙' },
    ]);
    const snapshot = store.serialize();
    expect(snapshot.version).toBe(CHAT_MEMORY_SNAPSHOT_VERSION);

    const restored = newStore();
    restored.hydrate(JSON.parse(JSON.stringify(snapshot)));
    expect(texts(restored, key)).toEqual(['other:甲', 'me:乙']);
    // 恢复后继续累积，接得上
    expect(restored.mergeConversation(key, [
      { sender: 'me', text: '乙' },
      { sender: 'other', text: '丙' },
    ]).map((m) => m.text)).toEqual(['甲', '乙', '丙']);
  });

  it('hydrate 丢弃版本不符或结构损坏的快照，不影响启动', () => {
    const target = newStore();
    target.mergeConversation('keep', [{ sender: 'other', text: '原有' }]);

    target.hydrate({ version: 999, sessions: { x: [{ role: 'other', text: '脏数据' }] } });
    expect(target.getHistory('x')).toEqual([]);

    target.hydrate('garbage');
    target.hydrate({ version: CHAT_MEMORY_SNAPSHOT_VERSION, sessions: 'not an object' });
    target.hydrate({ version: CHAT_MEMORY_SNAPSHOT_VERSION, sessions: { bad: 'not an array' } });
    expect(target.getHistory('bad')).toEqual([]);

    // hydrate 会整体替换，损坏快照不应留下半截状态
    expect(target.serialize().sessions).toEqual({});
  });

  it('空会话不写进快照（避免持久化膨胀）', () => {
    const target = newStore();
    target.mergeConversation('empty', []);
    expect(target.serialize().sessions).toEqual({});
  });

  it('buildChatMemoryKey 区分应用与窗口标题，缺信息时返回空串让调用方跳过记忆', () => {
    expect(buildChatMemoryKey('WeChat.exe', '与张三的聊天')).toBe('wechat.exe::与张三的聊天');
    expect(buildChatMemoryKey('WeChat.exe', '与李四的聊天')).not.toBe(buildChatMemoryKey('WeChat.exe', '与张三的聊天'));
    expect(buildChatMemoryKey('Feishu.exe', '与张三的聊天')).not.toBe(buildChatMemoryKey('WeChat.exe', '与张三的聊天'));
    expect(buildChatMemoryKey(undefined, undefined)).toBe('');
    expect(buildChatMemoryKey('  ', '')).toBe('');
  });
});
