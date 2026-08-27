/**
 * @file tests/unit/adversarial-chrome-storage-and-transport.test.ts
 * Comprehensive Adversarial Stress Test Suite for ChromeStorageProvider and ChromePortLLMTransport
 *
 * Covers:
 * 1. ChromeStorageProvider:
 *    - Storage quota limits & extreme payload stress
 *    - Multi-tier fallback (chrome.storage -> localStorage -> memoryStore)
 *    - Key deletion, clear, and getAll edge cases
 *    - Reactive change listeners, unsubscribe isolation, subscriber errors, cross-talk prevention
 *
 * 2. ChromePortLLMTransport:
 *    - Port disconnect during stream (early crash, mid-stream disconnect, lastError propagation)
 *    - AbortSignal triggering across lifecycle (pre-aborted, early, mid-stream, post-done)
 *    - Rapid sequential & concurrent requests on single transport instance
 *    - Mock stream fallback engine (missing runtime, connect throwing, connect returning null, testConnection)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChromeStorageProvider } from '../../src/adapters/ChromeStorageProvider';
import {
  ChromePortLLMTransport,
  STREAM_CHANNEL_NAME,
} from '../../src/adapters/ChromePortLLMTransport';
import type { IStorageProvider, ILLMTransport, LLMStreamRequest } from '@runbi/shared/adapters';
import type { StreamServerMessage } from '@runbi/shared/types/stream';
import { createMockChrome } from '../setup';

describe('Adversarial Challenge: ChromeStorageProvider & ChromePortLLMTransport', () => {
  let originalChrome: any;
  let originalLocalStorage: any;

  beforeEach(() => {
    originalChrome = (globalThis as any).chrome;
    originalLocalStorage = window.localStorage;
    const mock = createMockChrome();

    // Attach storage.onChanged event emitter to mock
    const storageChangeListeners: Array<(changes: Record<string, any>, area: string) => void> = [];
    (mock.storage as any).onChanged = {
      addListener: vi.fn((cb) => {
        storageChangeListeners.push(cb);
      }),
      removeListener: vi.fn((cb) => {
        const idx = storageChangeListeners.indexOf(cb);
        if (idx !== -1) storageChangeListeners.splice(idx, 1);
      }),
      hasListener: vi.fn((cb) => storageChangeListeners.includes(cb)),
      _emit: (changes: Record<string, any>, area = 'local') => {
        for (const l of [...storageChangeListeners]) {
          l(changes, area);
        }
      },
    };

    (globalThis as any).chrome = mock;
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    (globalThis as any).chrome = originalChrome;
    Object.defineProperty(window, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SUITE 1: ChromeStorageProvider Adversarial Stress Tests
  // =========================================================================
  describe('ChromeStorageProvider Adversarial Tests', () => {
    // -----------------------------------------------------------------------
    // 1.1 Storage Quota Limits & Fault Injection
    // -----------------------------------------------------------------------
    describe('Storage Quota Limits & Fault Injection', () => {
      it('ADV-STO-1: falls back to localStorage/memory when chrome.storage.local.set throws QuotaExceededError', async () => {
        const provider = new ChromeStorageProvider();

        // Inject QuotaExceededError into chrome.storage.local.set
        chrome.storage.local.set = vi.fn().mockRejectedValue(new Error('QUOTA_BYTES quota exceeded'));

        const testKey = 'quota_test_key';
        const testValue = { text: 'a'.repeat(10000), timestamp: Date.now() };

        // Must not throw uncaught rejection
        await expect(provider.set(testKey, testValue)).resolves.not.toThrow();

        // Must still be retrievable from fallback tier
        chrome.storage.local.get = vi.fn().mockRejectedValue(new Error('Storage unavailable'));
        const retrieved = await provider.get<typeof testValue>(testKey);
        expect(retrieved).toEqual(testValue);
      });

      it('ADV-STO-2: falls back to in-memory store when both chrome.storage and localStorage fail on quota', async () => {
        const provider = new ChromeStorageProvider();

        chrome.storage.local.set = vi.fn().mockRejectedValue(new Error('chrome.storage quota exceeded'));
        chrome.storage.local.get = vi.fn().mockRejectedValue(new Error('chrome.storage read error'));

        // Mock localStorage.setItem and getItem to throw DOMException QuotaExceededError
        vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
          throw new DOMException('QuotaExceededError', 'QuotaExceededError');
        });
        vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
          throw new DOMException('QuotaExceededError', 'QuotaExceededError');
        });

        const key = 'extreme_quota_key';
        const val = { deeply: { nested: { array: [1, 2, 3, 'data'] } } };

        await expect(provider.set(key, val)).resolves.not.toThrow();
        const result = await provider.get(key);
        expect(result).toEqual(val);
      });

      it('ADV-STO-3: high-throughput concurrent writes with large payloads', async () => {
        const provider = new ChromeStorageProvider();
        const writeCount = 200;

        // Perform 200 concurrent set operations
        const writePromises = Array.from({ length: writeCount }, (_, i) => {
          return provider.set(`stress_key_${i}`, {
            index: i,
            payload: 'X'.repeat(500),
            created: Date.now(),
          });
        });

        await expect(Promise.all(writePromises)).resolves.not.toThrow();

        // Verify random subset of written keys
        for (const idx of [0, 10, 50, 99, 150, 199]) {
          const val = await provider.get<any>(`stress_key_${idx}`);
          expect(val).toBeDefined();
          expect(val.index).toBe(idx);
          expect(val.payload).toBe('X'.repeat(500));
        }
      });

      it('ADV-STO-4: handles boundary keys (empty, unicode, special chars) and degenerate values', async () => {
        const provider = new ChromeStorageProvider();

        const boundaryTestCases: Array<[string, any]> = [
          ['', 'empty_key_val'],
          ['🔑_emoji_key_💡_🔥', { unicode: '中文测试 🚀 123' }],
          ['key.with.dots/and/slashes\\and"quotes"', [1, 'two', { three: true }]],
          ['constructor', 'safe_constructor_override'],
          ['toString', 42],
          ['null_val_key', null],
          ['false_val_key', false],
          ['zero_val_key', 0],
          ['empty_str_val_key', ''],
          ['empty_obj_val_key', {}],
          ['empty_arr_val_key', []],
        ];

        for (const [key, value] of boundaryTestCases) {
          await provider.set(key, value);
          const retrieved = await provider.get(key, 'FALLBACK_DEFAULT');
          expect(retrieved).toEqual(value);
        }
      });
    });

    // -----------------------------------------------------------------------
    // 1.2 Multi-Tier Fallback Under Missing APIs
    // -----------------------------------------------------------------------
    describe('Multi-Tier Fallback Under Missing APIs', () => {
      it('ADV-STO-5: operates smoothly when global chrome object is completely undefined', async () => {
        (globalThis as any).chrome = undefined;
        const provider = new ChromeStorageProvider();

        await provider.set('no_chrome_key', { mode: 'headless_browser' });
        const val = await provider.get<any>('no_chrome_key');
        expect(val).toEqual({ mode: 'headless_browser' });

        // Missing key returns default value
        const missing = await provider.get('non_existent', 'my_default');
        expect(missing).toBe('my_default');

        await provider.remove('no_chrome_key');
        const deleted = await provider.get('no_chrome_key', 'deleted_default');
        expect(deleted).toBe('deleted_default');
      });

      it('ADV-STO-6: operates smoothly when chrome exists but chrome.storage is undefined', async () => {
        (globalThis as any).chrome = { runtime: {} };
        const provider = new ChromeStorageProvider();

        await provider.set('partial_chrome_key', 'persisted_in_localstorage');
        const val = await provider.get<string>('partial_chrome_key');
        expect(val).toBe('persisted_in_localstorage');
      });

      it('ADV-STO-7: operates in pure memory mode when neither chrome.storage nor localStorage is available', async () => {
        (globalThis as any).chrome = undefined;
        // Strip localStorage from window
        Object.defineProperty(window, 'localStorage', {
          value: undefined,
          writable: true,
          configurable: true,
        });

        const provider = new ChromeStorageProvider();

        await provider.set('mem_only_1', 'value_1');
        await provider.set('mem_only_2', { nested: 123 });

        expect(await provider.get('mem_only_1')).toBe('value_1');
        expect(await provider.get('mem_only_2')).toEqual({ nested: 123 });
        expect(await provider.get('missing_key', 'def')).toBe('def');

        const all = await provider.getAll();
        expect(all).toEqual({
          mem_only_1: 'value_1',
          mem_only_2: { nested: 123 },
        });

        await provider.remove('mem_only_1');
        expect(await provider.get('mem_only_1')).toBeUndefined();

        await provider.clear();
        expect(await provider.getAll()).toEqual({});
      });

      it('ADV-STO-8: handles chrome.storage.local methods throwing synchronous exceptions', async () => {
        (globalThis as any).chrome = {
          storage: {
            local: {
              get: vi.fn().mockImplementation(() => {
                throw new Error('Sync storage get crash');
              }),
              set: vi.fn().mockImplementation(() => {
                throw new Error('Sync storage set crash');
              }),
              remove: vi.fn().mockImplementation(() => {
                throw new Error('Sync storage remove crash');
              }),
              clear: vi.fn().mockImplementation(() => {
                throw new Error('Sync storage clear crash');
              }),
            },
          },
        };

        const provider = new ChromeStorageProvider();

        // Set should catch sync error and write to fallback
        await expect(provider.set('sync_crash_key', 'survived')).resolves.not.toThrow();

        // Get should catch sync error and read from fallback
        const readVal = await provider.get('sync_crash_key');
        expect(readVal).toBe('survived');

        // Remove should catch sync error and remove from fallback
        await expect(provider.remove('sync_crash_key')).resolves.not.toThrow();
        expect(await provider.get('sync_crash_key', 'removed')).toBe('removed');

        // Clear should catch sync error and clear fallback
        await provider.set('k1', 'v1');
        await expect(provider.clear()).resolves.not.toThrow();
        expect(await provider.get('k1', 'cleared')).toBe('cleared');
      });
    });

    // -----------------------------------------------------------------------
    // 1.3 Key Deletion, Clear & getAll Edge Cases
    // -----------------------------------------------------------------------
    describe('Key Deletion & Storage Lifecycle', () => {
      it('ADV-STO-9: deleting non-existent key is a safe no-op across all storage modes', async () => {
        const provider = new ChromeStorageProvider();
        await expect(provider.remove('totally_non_existent_key_123')).resolves.not.toThrow();

        (globalThis as any).chrome = undefined;
        const fallbackProvider = new ChromeStorageProvider();
        await expect(fallbackProvider.remove('another_non_existent_key')).resolves.not.toThrow();
      });

      it('ADV-STO-10: rapid alternating set and remove cycles on same key', async () => {
        const provider = new ChromeStorageProvider();
        const key = 'rapid_cycle_key';

        for (let i = 0; i < 50; i++) {
          await provider.set(key, `iter_${i}`);
          const val = await provider.get(key);
          expect(val).toBe(`iter_${i}`);

          await provider.remove(key);
          const afterRemove = await provider.get(key, null);
          expect(afterRemove).toBeNull();
        }
      });

      it('ADV-STO-11: getAll retrieves all keys accurately across storage, localStorage, and memory modes', async () => {
        // Mode 1: chrome.storage
        const chromeProvider = new ChromeStorageProvider();
        await chromeProvider.set('k1', 'v1');
        await chromeProvider.set('k2', { sub: 2 });
        const allChrome = await chromeProvider.getAll();
        expect(allChrome).toMatchObject({ k1: 'v1', k2: { sub: 2 } });

        // Mode 2: localStorage fallback
        (globalThis as any).chrome = undefined;
        const localProvider = new ChromeStorageProvider();
        await localProvider.set('local_1', 'val_1');
        await localProvider.set('local_2', 12345);
        const allLocal = await localProvider.getAll();
        expect(allLocal).toMatchObject({ local_1: 'val_1', local_2: 12345 });

        // Mode 3: clear() wipes everything
        await localProvider.clear();
        const allEmpty = await localProvider.getAll();
        expect(Object.keys(allEmpty).length).toBe(0);
      });
    });

    // -----------------------------------------------------------------------
    // 1.4 Reactive Change Listeners & Stress
    // -----------------------------------------------------------------------
    describe('Reactive Change Listeners & Subscriber Isolation', () => {
      it('ADV-STO-12: multiple subscribers on the same key all receive updates', async () => {
        const provider = new ChromeStorageProvider();
        const key = 'multi_sub_key';

        const sub1 = vi.fn();
        const sub2 = vi.fn();
        const sub3 = vi.fn();

        const unsub1 = provider.subscribe(key, sub1);
        const unsub2 = provider.subscribe(key, sub2);
        const unsub3 = provider.subscribe(key, sub3);

        // Emit storage change via mocked onChanged
        (chrome.storage.onChanged as any)._emit(
          { [key]: { oldValue: 'initial', newValue: 'updated' } },
          'local'
        );

        expect(sub1).toHaveBeenCalledWith('updated', 'initial');
        expect(sub2).toHaveBeenCalledWith('updated', 'initial');
        expect(sub3).toHaveBeenCalledWith('updated', 'initial');

        // Unsubscribe sub2 only
        unsub2();

        (chrome.storage.onChanged as any)._emit(
          { [key]: { oldValue: 'updated', newValue: 'final' } },
          'local'
        );

        expect(sub1).toHaveBeenCalledWith('final', 'updated');
        expect(sub2).toHaveBeenCalledTimes(1); // Not called again
        expect(sub3).toHaveBeenCalledWith('final', 'updated');

        unsub1();
        unsub3();
      });

      it('ADV-STO-13: subscribers on different keys do not receive cross-talk', async () => {
        const provider = new ChromeStorageProvider();

        const subA = vi.fn();
        const subB = vi.fn();

        const unsubA = provider.subscribe('keyA', subA);
        const unsubB = provider.subscribe('keyB', subB);

        // Trigger change only on keyA
        (chrome.storage.onChanged as any)._emit({ keyA: { oldValue: null, newValue: 'valA' } }, 'local');

        expect(subA).toHaveBeenCalledWith('valA', null);
        expect(subB).not.toHaveBeenCalled();

        unsubA();
        unsubB();
      });

      it('ADV-STO-14: subscriber throwing an error does not crash provider or prevent other subscribers', async () => {
        const provider = new ChromeStorageProvider();
        const key = 'faulty_sub_key';

        const faultySub = vi.fn().mockImplementation(() => {
          throw new Error('Subscriber exploded!');
        });
        const healthySub = vi.fn();

        const unsubFaulty = provider.subscribe(key, faultySub);
        const unsubHealthy = provider.subscribe(key, healthySub);

        // Emitting change should not throw uncaught error even if faultySub throws
        expect(() => {
          (chrome.storage.onChanged as any)._emit({ [key]: { oldValue: 'old', newValue: 'new' } }, 'local');
        }).not.toThrow();

        expect(faultySub).toHaveBeenCalled();
        expect(healthySub).toHaveBeenCalledWith('new', 'old');

        unsubFaulty();
        unsubHealthy();
      });

      it('ADV-STO-15: fallback mode subscribers receive notification on set and remove', async () => {
        (globalThis as any).chrome = undefined;
        const provider = new ChromeStorageProvider();
        const key = 'fallback_notify_key';

        const sub = vi.fn();
        const unsub = provider.subscribe(key, sub);

        await provider.set(key, 'first_val');
        expect(sub).toHaveBeenCalledWith('first_val', undefined);

        await provider.set(key, 'second_val');
        expect(sub).toHaveBeenCalledWith('second_val', 'first_val');

        await provider.remove(key);
        expect(sub).toHaveBeenCalledWith(undefined, 'second_val');

        unsub();

        // After unsub, no more notifications
        await provider.set(key, 'third_val');
        expect(sub).toHaveBeenCalledTimes(3);
      });

      it('ADV-STO-16: unsubscribing is idempotent and does not throw if called multiple times', async () => {
        const provider = new ChromeStorageProvider();
        const unsub = provider.subscribe('idem_key', vi.fn());

        expect(() => {
          unsub();
          unsub();
          unsub();
        }).not.toThrow();
      });
    });
  });

  // =========================================================================
  // SUITE 2: ChromePortLLMTransport Adversarial Stress Tests
  // =========================================================================
  describe('ChromePortLLMTransport Adversarial Tests', () => {
    // -----------------------------------------------------------------------
    // 2.1 Port Disconnect During Active Stream
    // -----------------------------------------------------------------------
    describe('Port Disconnect During Active Stream', () => {
      it('ADV-TRN-1: handles immediate port disconnect before any chunks arrive', async () => {
        const transport = new ChromePortLLMTransport();

        let disconnectListener: ((port: any) => void) | null = null;
        const mockPort: any = {
          name: STREAM_CHANNEL_NAME,
          postMessage: vi.fn(() => {
            // Simulate background service worker immediately closing port
            queueMicrotask(() => {
              disconnectListener?.(mockPort);
            });
          }),
          onMessage: { addListener: vi.fn() },
          onDisconnect: {
            addListener: vi.fn((fn) => {
              disconnectListener = fn;
            }),
          },
          disconnect: vi.fn(),
        };

        chrome.runtime.connect = vi.fn().mockReturnValue(mockPort);

        const onChunk = vi.fn();
        const onDone = vi.fn();
        const onError = vi.fn();
        const onAbort = vi.fn();

        await transport.streamChat(
          { text: '测试文本', config: { style: 'polished' } },
          { onChunk, onDone, onError, onAbort }
        );

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0]).toContain('后台服务连接已中断');
        expect(onChunk).not.toHaveBeenCalled();
        expect(onDone).not.toHaveBeenCalled();
        expect(onAbort).not.toHaveBeenCalled();
      });

      it('ADV-TRN-2: handles mid-stream port disconnect after receiving several chunks', async () => {
        const transport = new ChromePortLLMTransport();

        let msgListener: ((msg: any) => void) | null = null;
        let disconnectListener: ((port: any) => void) | null = null;

        const mockPort: any = {
          name: STREAM_CHANNEL_NAME,
          postMessage: vi.fn(() => {
            queueMicrotask(() => {
              msgListener?.({ type: 'CHUNK', payload: { delta: 'Chunk 1; ' } });
              msgListener?.({ type: 'CHUNK', payload: { delta: 'Chunk 2; ' } });
              // Port crashes mid-stream
              disconnectListener?.(mockPort);
            });
          }),
          onMessage: {
            addListener: vi.fn((fn) => {
              msgListener = fn;
            }),
          },
          onDisconnect: {
            addListener: vi.fn((fn) => {
              disconnectListener = fn;
            }),
          },
          disconnect: vi.fn(),
        };

        chrome.runtime.connect = vi.fn().mockReturnValue(mockPort);

        const onChunk = vi.fn();
        const onDone = vi.fn();
        const onError = vi.fn();

        await transport.streamChat(
          { text: '中途断开测试', config: { style: 'academic' } },
          { onChunk, onDone, onError }
        );

        expect(onChunk).toHaveBeenCalledTimes(2);
        expect(onChunk).toHaveBeenNthCalledWith(1, 'Chunk 1; ');
        expect(onChunk).toHaveBeenNthCalledWith(2, 'Chunk 2; ');
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onDone).not.toHaveBeenCalled();
      });

      it('ADV-TRN-3: passes chrome.runtime.lastError message to onError on port disconnect', async () => {
        const transport = new ChromePortLLMTransport();

        let disconnectListener: ((port: any) => void) | null = null;
        const mockPort: any = {
          name: STREAM_CHANNEL_NAME,
          postMessage: vi.fn(() => {
            queueMicrotask(() => {
              (chrome.runtime as any).lastError = {
                message: 'Could not establish connection. Receiving end does not exist.',
              };
              disconnectListener?.(mockPort);
            });
          }),
          onMessage: { addListener: vi.fn() },
          onDisconnect: {
            addListener: vi.fn((fn) => {
              disconnectListener = fn;
            }),
          },
          disconnect: vi.fn(),
        };

        chrome.runtime.connect = vi.fn().mockReturnValue(mockPort);

        const onError = vi.fn();
        await transport.streamChat(
          { text: 'lastError测试', config: { style: 'polished' } },
          { onChunk: vi.fn(), onDone: vi.fn(), onError }
        );

        expect(onError).toHaveBeenCalledWith(
          'Could not establish connection. Receiving end does not exist.'
        );
        delete (chrome.runtime as any).lastError;
      });

      it('ADV-TRN-4: normal DONE completion ignores subsequent port disconnect', async () => {
        const transport = new ChromePortLLMTransport();

        let msgListener: ((msg: any) => void) | null = null;
        let disconnectListener: ((port: any) => void) | null = null;

        const mockPort: any = {
          name: STREAM_CHANNEL_NAME,
          postMessage: vi.fn(() => {
            queueMicrotask(() => {
              msgListener?.({ type: 'CHUNK', payload: { delta: '完整内容' } });
              msgListener?.({ type: 'DONE', payload: { durationMs: 100, totalTokens: 4 } });
              // Background cleans up port after DONE
              disconnectListener?.(mockPort);
            });
          }),
          onMessage: {
            addListener: vi.fn((fn) => {
              msgListener = fn;
            }),
          },
          onDisconnect: {
            addListener: vi.fn((fn) => {
              disconnectListener = fn;
            }),
          },
          disconnect: vi.fn(),
        };

        chrome.runtime.connect = vi.fn().mockReturnValue(mockPort);

        const onChunk = vi.fn();
        const onDone = vi.fn();
        const onError = vi.fn();

        await transport.streamChat(
          { text: '正常流程', config: { style: 'polished' } },
          { onChunk, onDone, onError }
        );

        expect(onChunk).toHaveBeenCalledWith('完整内容');
        expect(onDone).toHaveBeenCalledWith(100, 4);
        expect(onError).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------------
    // 2.2 AbortSignal Triggering Across Stream Lifecycle
    // -----------------------------------------------------------------------
    describe('AbortSignal Triggering Across Lifecycle', () => {
      it('ADV-TRN-5: pre-aborted signal resolves immediately and invokes onAbort without opening port', async () => {
        const transport = new ChromePortLLMTransport();
        const abortCtrl = new AbortController();
        abortCtrl.abort(); // Pre-aborted

        const connectSpy = vi.spyOn(chrome.runtime, 'connect');
        const onAbort = vi.fn();
        const onChunk = vi.fn();
        const onDone = vi.fn();
        const onError = vi.fn();

        await transport.streamChat(
          { text: '已取消', config: { style: 'polished' } },
          { onChunk, onDone, onError, onAbort },
          abortCtrl.signal
        );

        expect(onAbort).toHaveBeenCalledTimes(1);
        expect(connectSpy).not.toHaveBeenCalled();
        expect(onChunk).not.toHaveBeenCalled();
        expect(onDone).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
      });

      it('ADV-TRN-6: abort signal triggered immediately after start sends ABORT message and cleans up', async () => {
        const transport = new ChromePortLLMTransport();
        const abortCtrl = new AbortController();

        const mockPort: any = {
          name: STREAM_CHANNEL_NAME,
          postMessage: vi.fn(),
          onMessage: { addListener: vi.fn() },
          onDisconnect: { addListener: vi.fn() },
          disconnect: vi.fn(),
        };

        chrome.runtime.connect = vi.fn().mockReturnValue(mockPort);

        const onAbort = vi.fn();
        const streamPromise = transport.streamChat(
          { text: '即时取消', config: { style: 'polished' } },
          { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onAbort },
          abortCtrl.signal
        );

        // Abort synchronously before microtasks
        abortCtrl.abort();
        await streamPromise;

        expect(mockPort.postMessage).toHaveBeenCalledWith({ action: 'ABORT' });
        expect(mockPort.disconnect).toHaveBeenCalled();
        expect(onAbort).toHaveBeenCalledTimes(1);
      });

      it('ADV-TRN-7: abort signal triggered mid-stream ignores subsequent chunks arriving on port', async () => {
        const transport = new ChromePortLLMTransport();
        const abortCtrl = new AbortController();

        let msgListener: ((msg: any) => void) | null = null;
        const mockPort: any = {
          name: STREAM_CHANNEL_NAME,
          postMessage: vi.fn((msg) => {
            if (msg.action === 'START_STREAM') {
              queueMicrotask(() => {
                msgListener?.({ type: 'CHUNK', payload: { delta: 'Chunk A' } });
              });
            }
          }),
          onMessage: {
            addListener: vi.fn((fn) => {
              msgListener = fn;
            }),
          },
          onDisconnect: { addListener: vi.fn() },
          disconnect: vi.fn(),
        };

        chrome.runtime.connect = vi.fn().mockReturnValue(mockPort);

        const onChunk = vi.fn((delta) => {
          if (delta === 'Chunk A') {
            // Trigger abort upon receiving Chunk A
            abortCtrl.abort();
          }
        });
        const onAbort = vi.fn();
        const onDone = vi.fn();

        await transport.streamChat(
          { text: '中途取消测试', config: { style: 'polished' } },
          { onChunk, onDone, onError: vi.fn(), onAbort },
          abortCtrl.signal
        );

        // Try to inject late chunk and done after abort
        (msgListener as any)?.({ type: 'CHUNK', payload: { delta: 'Late Chunk' } });
        (msgListener as any)?.({ type: 'DONE', payload: { durationMs: 200, totalTokens: 10 } });

        expect(onChunk).toHaveBeenCalledWith('Chunk A');
        expect(onChunk).not.toHaveBeenCalledWith('Late Chunk');
        expect(onAbort).toHaveBeenCalledTimes(1);
        expect(onDone).not.toHaveBeenCalled();
      });

      it('ADV-TRN-8: abort signal triggered after stream DONE does not call onAbort again', async () => {
        const transport = new ChromePortLLMTransport();
        const abortCtrl = new AbortController();

        let msgListener: ((msg: any) => void) | null = null;
        const mockPort: any = {
          name: STREAM_CHANNEL_NAME,
          postMessage: vi.fn(() => {
            queueMicrotask(() => {
              msgListener?.({ type: 'CHUNK', payload: { delta: 'DoneChunk' } });
              msgListener?.({ type: 'DONE', payload: { durationMs: 50, totalTokens: 1 } });
            });
          }),
          onMessage: {
            addListener: vi.fn((fn) => {
              msgListener = fn;
            }),
          },
          onDisconnect: { addListener: vi.fn() },
          disconnect: vi.fn(),
        };

        chrome.runtime.connect = vi.fn().mockReturnValue(mockPort);

        const onAbort = vi.fn();
        const onDone = vi.fn();

        await transport.streamChat(
          { text: '完成测试', config: { style: 'polished' } },
          { onChunk: vi.fn(), onDone, onError: vi.fn(), onAbort },
          abortCtrl.signal
        );

        expect(onDone).toHaveBeenCalled();

        // Now abort after stream already settled
        abortCtrl.abort();

        expect(onAbort).not.toHaveBeenCalled();
      });
    });

    // -----------------------------------------------------------------------
    // 2.3 Rapid Sequential & Concurrent Requests
    // -----------------------------------------------------------------------
    describe('Rapid Sequential & Concurrent Requests', () => {
      it('ADV-TRN-9: handles 50 concurrent streamChat calls on single transport instance without cross-talk', async () => {
        const transport = new ChromePortLLMTransport();
        const concurrentCount = 50;

        chrome.runtime.connect = vi.fn().mockImplementation((info) => {
          let messageHandler: ((msg: any) => void) | null = null;
          return {
            name: info?.name || STREAM_CHANNEL_NAME,
            postMessage: vi.fn((clientMsg) => {
              if (clientMsg.action === 'START_STREAM') {
                const reqText = clientMsg.payload.text;
                queueMicrotask(() => {
                  messageHandler?.({ type: 'CHUNK', payload: { delta: `Delta for ${reqText}` } });
                  messageHandler?.({
                    type: 'DONE',
                    payload: { durationMs: 10, totalTokens: 3 },
                  });
                });
              }
            }),
            onMessage: {
              addListener: vi.fn((fn) => {
                messageHandler = fn;
              }),
            },
            onDisconnect: { addListener: vi.fn() },
            disconnect: vi.fn(),
          };
        });

        const streamPromises = Array.from({ length: concurrentCount }, async (_, i) => {
          const receivedChunks: string[] = [];
          let isCompleted = false;

          await transport.streamChat(
            { text: `Req_${i}`, config: { style: 'polished' } },
            {
              onChunk: (delta) => receivedChunks.push(delta),
              onDone: () => {
                isCompleted = true;
              },
              onError: (err) => {
                throw new Error(`Unexpected error in stream ${i}: ${err}`);
              },
            }
          );

          expect(isCompleted).toBe(true);
          expect(receivedChunks).toEqual([`Delta for Req_${i}`]);
        });

        await expect(Promise.all(streamPromises)).resolves.not.toThrow();
      });

      it('ADV-TRN-10: handles rapid sequential requests with alternating abort signals', async () => {
        const transport = new ChromePortLLMTransport();

        chrome.runtime.connect = vi.fn().mockImplementation(() => {
          let messageHandler: ((msg: any) => void) | null = null;
          return {
            name: STREAM_CHANNEL_NAME,
            postMessage: vi.fn((clientMsg) => {
              if (clientMsg.action === 'START_STREAM') {
                queueMicrotask(() => {
                  messageHandler?.({ type: 'CHUNK', payload: { delta: 'chunk' } });
                  messageHandler?.({ type: 'DONE', payload: { durationMs: 5, totalTokens: 1 } });
                });
              }
            }),
            onMessage: {
              addListener: vi.fn((fn) => {
                messageHandler = fn;
              }),
            },
            onDisconnect: { addListener: vi.fn() },
            disconnect: vi.fn(),
          };
        });

        for (let i = 0; i < 20; i++) {
          const shouldAbort = i % 2 === 1;
          const abortCtrl = new AbortController();

          const onDone = vi.fn();
          const onAbort = vi.fn();

          const promise = transport.streamChat(
            { text: `Seq_${i}`, config: { style: 'concise' } },
            { onChunk: vi.fn(), onDone, onError: vi.fn(), onAbort },
            abortCtrl.signal
          );

          if (shouldAbort) {
            abortCtrl.abort();
          }

          await promise;

          if (shouldAbort) {
            expect(onAbort).toHaveBeenCalled();
          } else {
            expect(onDone).toHaveBeenCalled();
          }
        }
      });
    });

    // -----------------------------------------------------------------------
    // 2.4 Mock Stream Fallback Engine & testConnection
    // -----------------------------------------------------------------------
    describe('Mock Stream Fallback Engine & testConnection', () => {
      it('ADV-TRN-11: falls back to mock stream generator when chrome.runtime is completely undefined', async () => {
        (globalThis as any).chrome = undefined;
        const transport = new ChromePortLLMTransport();

        const receivedChunks: string[] = [];
        let doneStats: { duration: number; tokens: number } | null = null;

        await transport.streamChat(
          { text: '测试本地回退流式输出', config: { style: 'polished' } },
          {
            onChunk: (delta) => receivedChunks.push(delta),
            onDone: (durationMs, totalTokens) => {
              doneStats = { duration: durationMs, tokens: totalTokens };
            },
            onError: (err) => {
              throw new Error(`Fallback error: ${err}`);
            },
          }
        );

        expect(receivedChunks.length).toBeGreaterThan(0);
        expect(receivedChunks.join('')).toContain('测试');
        expect(doneStats).not.toBeNull();
        expect(doneStats!.tokens).toBeGreaterThan(0);
      });

      it('ADV-TRN-12: falls back to mock stream generator when chrome.runtime.connect throws exception', async () => {
        chrome.runtime.connect = vi.fn().mockImplementation(() => {
          throw new Error('Extension context invalidated.');
        });

        const transport = new ChromePortLLMTransport();
        const receivedChunks: string[] = [];
        let isDone = false;

        await transport.streamChat(
          { text: '异常抛出回退测试', config: { style: 'business' } },
          {
            onChunk: (delta) => receivedChunks.push(delta),
            onDone: () => {
              isDone = true;
            },
            onError: (err) => {
              throw new Error(`Unexpected error: ${err}`);
            },
          }
        );

        expect(isDone).toBe(true);
        expect(receivedChunks.length).toBeGreaterThan(0);
      });

      it('ADV-TRN-13: aborting mock stream fallback halts generation cleanly', async () => {
        (globalThis as any).chrome = undefined;
        const transport = new ChromePortLLMTransport();
        const abortCtrl = new AbortController();

        const onAbort = vi.fn();
        const onDone = vi.fn();

        const streamPromise = transport.streamChat(
          { text: '长时间回退生成文本'.repeat(20), config: { style: 'literary' } },
          {
            onChunk: () => {
              abortCtrl.abort();
            },
            onDone,
            onError: vi.fn(),
            onAbort,
          },
          abortCtrl.signal
        );

        await streamPromise;

        expect(onAbort).toHaveBeenCalled();
        expect(onDone).not.toHaveBeenCalled();
      });

      it('ADV-TRN-14: testConnection handles runtime message path and HTTP fallback (missing key, 401, 429, fetch fail)', async () => {
        const transport = new ChromePortLLMTransport();

        // 1. Success via chrome.runtime.sendMessage
        chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
          success: true,
          latencyMs: 42,
          model: 'deepseek-chat',
        });
        const runtimeRes = await transport.testConnection({
          apiKey: 'sk-runtime-key',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          style: 'polished',
        });
        expect(runtimeRes.success).toBe(true);
        expect(runtimeRes.latencyMs).toBe(42);

        // 2. Missing API key on HTTP ping fallback
        chrome.runtime.sendMessage = vi.fn().mockRejectedValue(new Error('Background unreachable'));
        const noKeyRes = await transport.testConnection({
          apiKey: '   ',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          style: 'polished',
        });
        expect(noKeyRes.success).toBe(false);
        expect(noKeyRes.error).toContain('API Key');

        // 3. HTTP 401 Unauthorized via direct HTTP ping
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 })
        );
        const res401 = await transport.testConnection({
          apiKey: 'sk-invalid',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          style: 'polished',
        });
        expect(res401.success).toBe(false);
        expect(res401.error).toContain('401');

        // 4. HTTP 429 Rate Limit via direct HTTP ping
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { message: 'Rate limit' } }), { status: 429 })
        );
        const res429 = await transport.testConnection({
          apiKey: 'sk-limited',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          style: 'polished',
        });
        expect(res429.success).toBe(false);
        expect(res429.error).toContain('429');

        // 5. Network fetch rejection via direct HTTP ping
        vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Failed to fetch (DNS error)'));
        const netErrRes = await transport.testConnection({
          apiKey: 'sk-valid',
          baseUrl: 'https://invalid-domain.example.com',
          model: 'deepseek-chat',
          style: 'polished',
        });
        expect(netErrRes.success).toBe(false);
        expect(netErrRes.error).toContain('Failed to fetch');
      });
    });
  });
});
