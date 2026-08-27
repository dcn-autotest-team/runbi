/**
 * @file shared/adapters/storage.ts
 * Storage Provider Abstract Interface Contract
 * Multi-Platform Inversion-of-Control (IoC) Definition
 */

/**
 * Platform adapter contract for asynchronous persistent key-value storage.
 * - Chrome Extension implementation: wraps `chrome.storage.local`.
 * - Desktop Tauri implementation: wraps `tauri-plugin-store` or `localStorage`.
 */
export interface IStorageProvider {
  /**
   * Retrieves a typed value by key.
   * If the key does not exist or has an undefined value, returns defaultValue if provided.
   *
   * @param key - Unique storage key string.
   * @param defaultValue - Optional fallback value if key is not found.
   */
  get<T>(key: string, defaultValue?: T): Promise<T>;

  /**
   * Stores a typed value by key.
   *
   * @param key - Unique storage key string.
   * @param value - Value to serialize and store.
   */
  set<T>(key: string, value: T): Promise<void>;

  /**
   * Removes a key and its associated value from storage.
   *
   * @param key - Storage key to remove.
   */
  remove(key: string): Promise<void>;

  /**
   * Subscribes to storage changes for a specific key or globally.
   *
   * @param key - Key to observe.
   * @param callback - Function invoked when the stored value changes.
   * @returns Unsubscribe function.
   */
  subscribe<T>(key: string, callback: (newValue: T, oldValue: T) => void): () => void;

  /**
   * Optional: Clears all stored key-value pairs.
   */
  clear?(): Promise<void>;

  /**
   * Optional: Retrieves all stored key-value pairs as an object.
   */
  getAll?(): Promise<Record<string, unknown>>;
}
