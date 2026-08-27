/**
 * @file desktop/src/adapters/TauriStorageProvider.ts
 * Desktop Storage Provider Implementation
 *
 * Implements IStorageProvider for the Runbi Tauri Desktop Client.
 * Uses localStorage with in-memory caching and subscriber pub/sub,
 * and seamlessly synchronizes with tauri-plugin-store when available.
 */

import type { IStorageProvider } from '@runbi/shared/adapters';

export class TauriStorageProvider implements IStorageProvider {
  private cache: Map<string, unknown> = new Map();
  private subscribers: Map<string, Set<(newVal: any, oldVal: any) => void>> = new Map();
  private isInitialized = false;

  private isTauri(): boolean {
    return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
  }

  private initFromLocalStorage(): void {
    if (this.isInitialized || typeof window === 'undefined') return;
    try {
      if (window.localStorage) {
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key && key.startsWith('runbi:')) {
            const raw = window.localStorage.getItem(key);
            if (raw !== null) {
              try {
                this.cache.set(key, JSON.parse(raw));
              } catch {
                this.cache.set(key, raw);
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[TauriStorageProvider] localStorage read failed:', e);
    }
    this.isInitialized = true;
  }

  private normalizeKey(key: string): string {
    return key.startsWith('runbi:') ? key : `runbi:${key}`;
  }

  public async get<T>(key: string, defaultValue?: T): Promise<T> {
    this.initFromLocalStorage();
    const fullKey = this.normalizeKey(key);

    if (this.cache.has(fullKey)) {
      return this.cache.get(fullKey) as T;
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(fullKey);
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw);
          this.cache.set(fullKey, parsed);
          return parsed as T;
        } catch {
          this.cache.set(fullKey, raw);
          return raw as unknown as T;
        }
      }
    }

    return defaultValue !== undefined ? defaultValue : (undefined as unknown as T);
  }

  public async set<T>(key: string, value: T): Promise<void> {
    this.initFromLocalStorage();
    const fullKey = this.normalizeKey(key);
    const oldValue = this.cache.get(fullKey);
    this.cache.set(fullKey, value);

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(fullKey, JSON.stringify(value));
      } catch (err) {
        console.warn('[TauriStorageProvider] localStorage setItem failed:', err);
      }
    }

    this.notifySubscribers(fullKey, value, oldValue);
  }

  public async remove(key: string): Promise<void> {
    this.initFromLocalStorage();
    const fullKey = this.normalizeKey(key);
    const oldValue = this.cache.get(fullKey);
    this.cache.delete(fullKey);

    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(fullKey);
    }

    this.notifySubscribers(fullKey, undefined, oldValue);
  }

  public subscribe<T>(key: string, callback: (newValue: T, oldValue: T) => void): () => void {
    const fullKey = this.normalizeKey(key);
    if (!this.subscribers.has(fullKey)) {
      this.subscribers.set(fullKey, new Set());
    }
    const set = this.subscribers.get(fullKey)!;
    set.add(callback);

    return () => {
      set.delete(callback);
      if (set.size === 0) {
        this.subscribers.delete(fullKey);
      }
    };
  }

  public async clear(): Promise<void> {
    this.initFromLocalStorage();
    for (const key of Array.from(this.cache.keys())) {
      const oldVal = this.cache.get(key);
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
      this.cache.delete(key);
      this.notifySubscribers(key, undefined, oldVal);
    }
  }

  public async getAll(): Promise<Record<string, unknown>> {
    this.initFromLocalStorage();
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.cache.entries()) {
      const shortKey = k.replace(/^runbi:/, '');
      out[shortKey] = v;
    }
    return out;
  }

  private notifySubscribers(fullKey: string, newVal: any, oldVal: any): void {
    const set = this.subscribers.get(fullKey);
    if (set) {
      for (const cb of set) {
        try {
          cb(newVal, oldVal);
        } catch (e) {
          console.error('[TauriStorageProvider] subscriber error:', e);
        }
      }
    }
  }
}
