/**
 * @file src/adapters/ChromeStorageProvider.ts
 * Chrome Extension Persistent Storage Adapter
 * Implements IStorageProvider (@runbi/shared/adapters)
 */

import type { IStorageProvider } from '@runbi/shared/adapters';

/**
 * Storage adapter implementation targeting Chrome Extension Manifest V3 (chrome.storage.local).
 * Provides multi-tier fallback to localStorage and in-memory cache when chrome.storage is unavailable.
 */
export class ChromeStorageProvider implements IStorageProvider {
  private memoryStore: Map<string, unknown> = new Map();
  private localListeners: Map<string, Set<(newValue: any, oldValue: any) => void>> = new Map();

  /**
   * Checks if Chrome Extension storage API is available in current execution environment.
   */
  private isChromeStorageAvailable(): boolean {
    try {
      return typeof chrome !== 'undefined' && Boolean(chrome?.storage?.local);
    } catch {
      return false;
    }
  }

  /**
   * Checks if browser localStorage is available.
   */
  private isLocalStorageAvailable(): boolean {
    try {
      return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
    } catch {
      return false;
    }
  }

  /**
   * Reads a typed value from localStorage or memory store.
   */
  private getFromFallback<T>(key: string, defaultValue?: T): T {
    if (this.isLocalStorageAvailable()) {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) {
          return defaultValue !== undefined ? defaultValue : (undefined as unknown as T);
        }
        try {
          return JSON.parse(raw) as T;
        } catch {
          return raw as unknown as T;
        }
      } catch (err) {
        console.warn(`[ChromeStorageProvider] localStorage read failed for key "${key}":`, err);
      }
    }

    if (this.memoryStore.has(key)) {
      return this.memoryStore.get(key) as T;
    }
    return defaultValue !== undefined ? defaultValue : (undefined as unknown as T);
  }

  /**
   * Writes a typed value to localStorage and memory store, notifying local subscribers.
   */
  private setFallback<T>(key: string, value: T): void {
    const oldValue = this.getFromFallback(key);

    if (this.isLocalStorageAvailable()) {
      try {
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        window.localStorage.setItem(key, serialized);
      } catch (err) {
        console.warn(`[ChromeStorageProvider] localStorage write failed for key "${key}":`, err);
      }
    }

    this.memoryStore.set(key, value);
    this.notifyFallbackSubscribers(key, value, oldValue);
  }

  /**
   * Removes a key from localStorage and memory store, notifying local subscribers.
   */
  private removeFallback(key: string): void {
    const oldValue = this.getFromFallback(key);

    if (this.isLocalStorageAvailable()) {
      try {
        window.localStorage.removeItem(key);
      } catch (err) {
        console.warn(`[ChromeStorageProvider] localStorage remove failed for key "${key}":`, err);
      }
    }

    this.memoryStore.delete(key);
    this.notifyFallbackSubscribers(key, undefined, oldValue);
  }

  /**
   * Cleans all keys from fallback storage.
   */
  private clearFallback(): void {
    if (this.isLocalStorageAvailable()) {
      try {
        window.localStorage.clear();
      } catch (_) {}
    }
    this.memoryStore.clear();
  }

  /**
   * Notifies registered in-memory subscribers for key changes.
   */
  private notifyFallbackSubscribers<T>(key: string, newValue: T, oldValue: T): void {
    const listeners = this.localListeners.get(key);
    if (listeners) {
      listeners.forEach((fn) => {
        try {
          fn(newValue, oldValue);
        } catch (err) {
          console.error(`[ChromeStorageProvider] Subscriber error for key "${key}":`, err);
        }
      });
    }
  }

  /**
   * Retrieves a typed value by key from chrome.storage.local or fallback.
   *
   * @param key - Storage key identifier.
   * @param defaultValue - Optional default value returned if key is missing or undefined.
   */
  async get<T>(key: string, defaultValue?: T): Promise<T> {
    if (this.isChromeStorageAvailable()) {
      try {
        const result = await chrome.storage.local.get([key]);
        if (result && key in result && result[key] !== undefined) {
          return result[key] as T;
        }
        return defaultValue !== undefined ? defaultValue : (result?.[key] as T);
      } catch (err) {
        console.warn(`[ChromeStorageProvider] Exception during chrome.storage.local.get("${key}"):`, err);
        return this.getFromFallback(key, defaultValue);
      }
    }

    return Promise.resolve(this.getFromFallback(key, defaultValue));
  }

  /**
   * Stores a typed value by key in chrome.storage.local or fallback.
   *
   * @param key - Storage key identifier.
   * @param value - Value to persist.
   */
  async set<T>(key: string, value: T): Promise<void> {
    if (this.isChromeStorageAvailable()) {
      try {
        await chrome.storage.local.set({ [key]: value });
        this.memoryStore.set(key, value);
        return;
      } catch (err) {
        console.warn(`[ChromeStorageProvider] Exception during chrome.storage.local.set("${key}"):`, err);
        this.setFallback(key, value);
        return;
      }
    }

    this.setFallback(key, value);
    return Promise.resolve();
  }

  /**
   * Removes a key from chrome.storage.local or fallback.
   *
   * @param key - Storage key identifier to remove.
   */
  async remove(key: string): Promise<void> {
    if (this.isChromeStorageAvailable()) {
      try {
        await chrome.storage.local.remove(key);
        this.memoryStore.delete(key);
        return;
      } catch (err) {
        console.warn(`[ChromeStorageProvider] Exception during chrome.storage.local.remove("${key}"):`, err);
        this.removeFallback(key);
        return;
      }
    }

    this.removeFallback(key);
    return Promise.resolve();
  }

  /**
   * Subscribes to storage changes for a specific key.
   * Uses chrome.storage.onChanged when available; registers DOM storage events and internal listeners as fallback.
   *
   * @param key - Storage key to monitor.
   * @param callback - Event handler receiving newValue and oldValue.
   * @returns Unsubscribe function.
   */
  subscribe<T>(key: string, callback: (newValue: T, oldValue: T) => void): () => void {
    if (!this.localListeners.has(key)) {
      this.localListeners.set(key, new Set());
    }
    const listenerSet = this.localListeners.get(key)!;
    listenerSet.add(callback);

    let chromeListener: ((changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => void) | null = null;

    if (this.isChromeStorageAvailable() && chrome?.storage?.onChanged?.addListener) {
      chromeListener = (changes, areaName) => {
        if (areaName === 'local' && key in changes) {
          const change = changes[key];
          try {
            callback(change.newValue as T, change.oldValue as T);
          } catch (err) {
            console.error(`[ChromeStorageProvider] Error in chrome.storage.onChanged subscriber:`, err);
          }
        }
      };
      chrome.storage.onChanged.addListener(chromeListener);
    }

    let storageEventListener: ((e: StorageEvent) => void) | null = null;
    if (this.isLocalStorageAvailable() && typeof window.addEventListener === 'function') {
      storageEventListener = (e: StorageEvent) => {
        if (e.key === key && e.storageArea === window.localStorage) {
          let parsedNew: any = e.newValue;
          let parsedOld: any = e.oldValue;
          try {
            parsedNew = e.newValue !== null ? JSON.parse(e.newValue) : undefined;
          } catch (_) {}
          try {
            parsedOld = e.oldValue !== null ? JSON.parse(e.oldValue) : undefined;
          } catch (_) {}
          try {
            callback(parsedNew as T, parsedOld as T);
          } catch (err) {
            console.error(`[ChromeStorageProvider] Error in window.storage subscriber:`, err);
          }
        }
      };
      window.addEventListener('storage', storageEventListener);
    }

    return () => {
      listenerSet.delete(callback);
      if (listenerSet.size === 0) {
        this.localListeners.delete(key);
      }
      if (chromeListener && chrome?.storage?.onChanged?.removeListener) {
        try {
          chrome.storage.onChanged.removeListener(chromeListener);
        } catch (_) {}
      }
      if (storageEventListener && typeof window.removeEventListener === 'function') {
        try {
          window.removeEventListener('storage', storageEventListener);
        } catch (_) {}
      }
    };
  }

  /**
   * Clears all stored key-value pairs.
   */
  async clear(): Promise<void> {
    if (this.isChromeStorageAvailable()) {
      try {
        await chrome.storage.local.clear();
        this.clearFallback();
        return;
      } catch (err) {
        this.clearFallback();
        return;
      }
    }

    this.clearFallback();
    return Promise.resolve();
  }

  /**
   * Retrieves all stored key-value pairs as a record.
   */
  async getAll(): Promise<Record<string, unknown>> {
    if (this.isChromeStorageAvailable()) {
      try {
        const result = await chrome.storage.local.get(null);
        return result || {};
      } catch (_) {
        return Object.fromEntries(this.memoryStore.entries());
      }
    }

    if (this.isLocalStorageAvailable()) {
      try {
        const result: Record<string, unknown> = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k) {
            result[k] = this.getFromFallback(k);
          }
        }
        return Promise.resolve(result);
      } catch (_) {}
    }

    return Promise.resolve(Object.fromEntries(this.memoryStore.entries()));
  }
}

export const chromeStorage = new ChromeStorageProvider();
export default ChromeStorageProvider;
