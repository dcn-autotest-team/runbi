/**
 * @file desktop/src/types/tauri.d.ts
 * Ambient Type Declarations for Tauri 2.x APIs and Plugins
 */

declare module '@tauri-apps/api/core' {
  export function invoke<T = any>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

declare module '@tauri-apps/api/event' {
  export interface Event<T> {
    event: string;
    id: number;
    payload: T;
  }
  export type EventCallback<T> = (event: Event<T>) => void;
  export type UnlistenFn = () => void;

  export function listen<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn>;
  export function emit(event: string, payload?: unknown): Promise<void>;
}

declare module '@tauri-apps/api/window' {
  export interface PhysicalPosition {
    x: number;
    y: number;
  }
  export interface WebviewWindow {
    label: string;
    show(): Promise<void>;
    hide(): Promise<void>;
    setFocus(): Promise<void>;
    setAlwaysOnTop(alwaysOnTop: boolean): Promise<void>;
    setPosition(position: PhysicalPosition): Promise<void>;
    isVisible(): Promise<boolean>;
  }
  export function getCurrentWindow(): WebviewWindow;
}

declare module '@tauri-apps/plugin-clipboard-manager' {
  export function writeText(text: string): Promise<void>;
  export function readText(): Promise<string>;
}

declare module '@tauri-apps/plugin-global-shortcut' {
  export function register(shortcut: string, handler: () => void): Promise<void>;
  export function unregister(shortcut: string): Promise<void>;
  export function isRegistered(shortcut: string): Promise<boolean>;
}

declare module '@tauri-apps/plugin-store' {
  export class Store {
    constructor(path: string);
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    save(): Promise<void>;
    delete(key: string): Promise<boolean>;
    clear(): Promise<void>;
  }
}
