/**
 * @file desktop/src/adapters/TauriStorageProvider.ts
 * Desktop Storage Provider Implementation
 *
 * Implements IStorageProvider for the Runbi Tauri Desktop Client.
 * Uses persistent local JSON file storage via Rust IPC commands (load_app_config / save_app_config)
 * with in-memory caching and subscriber pub/sub, mirroring to localStorage when available.
 */

import type { IStorageProvider } from '@runbi/shared/adapters';
import * as core from '@tauri-apps/api/core';

const { invoke } = core;

/// Secret fields are persisted ONLY in the DPAPI-encrypted config.json (Rust side).
/// Never mirror them into WebView2 localStorage (leveldb plaintext).
const SECRET_KEYS: Set<string> = new Set(['runbi:apiKey']);

export class TauriStorageProvider implements IStorageProvider {
  private cache: Map<string, unknown> = new Map();
  private subscribers: Map<string, Set<(newVal: any, oldVal: any) => void>> = new Map();
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  private isTauri(): boolean {
    return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
  }

  private initFromLocalStorage(): void {
    if (typeof window === 'undefined') return;
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
  }

  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        this.initFromLocalStorage();
        let rustConfigEmpty = true;
        if (this.isTauri()) {
          try {
            const rustConfig = await invoke<Record<string, unknown>>('load_app_config');
            if (rustConfig && typeof rustConfig === 'object') {
              const entries = Object.entries(rustConfig);
              rustConfigEmpty = entries.length === 0;
              for (const [k, v] of entries) {
                const fullKey = this.normalizeKey(k);
                this.cache.set(fullKey, v);
                if (typeof window !== 'undefined' && window.localStorage) {
                  try {
                    window.localStorage.setItem(fullKey, JSON.stringify(v));
                  } catch {
                    // ignore localStorage quota errors
                  }
                }
              }
            }
          } catch (e) {
            console.warn('[TauriStorageProvider] load_app_config failed:', e);
          }
        }
        this.isInitialized = true;
        // Cleanup: wipe legacy plaintext apiKey from localStorage (now in encrypted config.json)
        if (this.isTauri() && typeof window !== 'undefined' && window.localStorage) {
          try {
            window.localStorage.removeItem('runbi:apiKey');
          } catch {
            // ignore
          }
        }
        // One-time migration snapshot: durable file store was empty but localStorage
        // has data — persist it NOW so WebView2 data loss can't wipe settings.
        if (this.isTauri() && rustConfigEmpty && this.cache.size > 0) {
          try {
            const all = await this.getAll();
            await invoke('save_app_config', { config: all });
          } catch (e) {
            console.warn('[TauriStorageProvider] config migration failed:', e);
          }
        }
      })();
    }
    await this.initPromise;
  }

  private normalizeKey(key: string): string {
    return key.startsWith('runbi:') ? key : `runbi:${key}`;
  }

  public async get<T>(key: string, defaultValue?: T): Promise<T> {
    await this.ensureInitialized();
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
    await this.setMany({ [key]: value });
  }

  public async setMany(values: Record<string, unknown>): Promise<void> {
    await this.ensureInitialized();
    const changes: Array<[string, unknown, unknown]> = [];

    for (const [key, value] of Object.entries(values)) {
      const fullKey = this.normalizeKey(key);
      const oldValue = this.cache.get(fullKey);
      changes.push([fullKey, value, oldValue]);
    }

    // Persist the complete next snapshot before publishing it to memory/UI. A failed
    // disk write must never look like a successful settings save.
    if (this.isTauri()) {
      const next = await this.getAll();
      for (const [key, value] of Object.entries(values)) {
        next[this.normalizeKey(key).replace(/^runbi:/, '')] = value;
      }
      await invoke('save_app_config', { config: next });
    }

    for (const [fullKey, value] of changes) {
      this.cache.set(fullKey, value);
      if (typeof window !== 'undefined' && window.localStorage && !SECRET_KEYS.has(fullKey)) {
        try {
          window.localStorage.setItem(fullKey, JSON.stringify(value));
        } catch (err) {
          console.warn('[TauriStorageProvider] localStorage setItem failed:', err);
        }
      }
    }

    for (const change of changes) {
      this.notifySubscribers(...change);
    }
  }

  public async remove(key: string): Promise<void> {
    await this.ensureInitialized();
    const fullKey = this.normalizeKey(key);
    const oldValue = this.cache.get(fullKey);

    if (this.isTauri()) {
      const next = await this.getAll();
      delete next[fullKey.replace(/^runbi:/, '')];
      await invoke('save_app_config', { config: next });
    }

    this.cache.delete(fullKey);

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(fullKey);
      } catch (err) {
        console.warn('[TauriStorageProvider] localStorage removeItem failed:', err);
      }
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
    await this.ensureInitialized();

    if (this.isTauri()) {
      await invoke('save_app_config', { config: {} });
    }

    for (const key of Array.from(this.cache.keys())) {
      const oldVal = this.cache.get(key);
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.removeItem(key);
        } catch (err) {
          console.warn('[TauriStorageProvider] localStorage removeItem failed:', err);
        }
      }
      this.cache.delete(key);
      this.notifySubscribers(key, undefined, oldVal);
    }
  }

  public async getAll(): Promise<Record<string, unknown>> {
    await this.ensureInitialized();
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
