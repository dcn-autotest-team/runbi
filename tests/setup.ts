import { vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ==========================================
// 1. Chrome Extension Manifest V3 API Mock
// ==========================================

export interface MockStorageData {
  [key: string]: any;
}

class MockChromeStorageArea {
  private store: MockStorageData = {};

  async get(keys?: string | string[] | Record<string, any> | null): Promise<Record<string, any>> {
    if (!keys) {
      return { ...this.store };
    }
    if (typeof keys === 'string') {
      return { [keys]: this.store[keys] };
    }
    if (Array.isArray(keys)) {
      const res: Record<string, any> = {};
      for (const k of keys) {
        if (k in this.store) {
          res[k] = this.store[k];
        }
      }
      return res;
    }
    const res: Record<string, any> = {};
    for (const [k, defaultVal] of Object.entries(keys)) {
      res[k] = k in this.store ? this.store[k] : defaultVal;
    }
    return res;
  }

  async set(items: Record<string, any>): Promise<void> {
    Object.assign(this.store, items);
  }

  async remove(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) {
      delete this.store[k];
    }
  }

  async clear(): Promise<void> {
    this.store = {};
  }

  _dump(): MockStorageData {
    return { ...this.store };
  }
}

export class MockPort implements chrome.runtime.Port {
  name: string;
  sender?: chrome.runtime.MessageSender;
  onDisconnect: chrome.runtime.Port['onDisconnect'];
  onMessage: chrome.runtime.Port['onMessage'];
  private messageListeners: Array<(msg: any, port: chrome.runtime.Port) => void> = [];
  private disconnectListeners: Array<(port: chrome.runtime.Port) => void> = [];
  private peerPort: MockPort | null = null;
  public disconnected = false;

  constructor(name: string) {
    this.name = name;
    this.onDisconnect = {
      addListener: (cb: (port: chrome.runtime.Port) => void) => {
        this.disconnectListeners.push(cb);
      },
      removeListener: (cb: (port: chrome.runtime.Port) => void) => {
        this.disconnectListeners = this.disconnectListeners.filter((l) => l !== cb);
      },
      hasListener: (cb: any) => this.disconnectListeners.includes(cb),
      hasListeners: () => this.disconnectListeners.length > 0,
      addRules: vi.fn(),
      getRules: vi.fn(),
      removeRules: vi.fn(),
    };

    this.onMessage = {
      addListener: (cb: (msg: any, port: chrome.runtime.Port) => void) => {
        this.messageListeners.push(cb);
      },
      removeListener: (cb: (msg: any, port: chrome.runtime.Port) => void) => {
        this.messageListeners = this.messageListeners.filter((l) => l !== cb);
      },
      hasListener: (cb: any) => this.messageListeners.includes(cb),
      hasListeners: () => this.messageListeners.length > 0,
      addRules: vi.fn(),
      getRules: vi.fn(),
      removeRules: vi.fn(),
    };
  }

  _connectPeer(peer: MockPort) {
    this.peerPort = peer;
    peer.peerPort = this;
  }

  postMessage(msg: any): void {
    if (this.disconnected) {
      throw new Error('Attempt to post message on disconnected port');
    }
    if (this.peerPort && !this.peerPort.disconnected) {
      for (const listener of this.peerPort.messageListeners) {
        listener(msg, this.peerPort);
      }
    }
  }

  disconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    for (const listener of this.disconnectListeners) {
      listener(this);
    }
    if (this.peerPort && !this.peerPort.disconnected) {
      this.peerPort.disconnect();
    }
  }
}

export function createMockChrome() {
  const localStorageArea = new MockChromeStorageArea();
  const connectListeners: Array<(port: MockPort) => void> = [];
  const messageListeners: Array<(msg: any, sender: any, sendResponse: any) => void> = [];

  const mockRuntime = {
    id: 'runbi-test-extension-id',
    getManifest: () => ({
      manifest_version: 3,
      name: '润笔 (Runbi)',
      version: '1.0.0',
      description: 'AI-powered browser text polishing Chrome Extension',
      action: {
        default_popup: 'src/popup/index.html',
        default_icon: {
          '16': 'icons/icon-16.png',
          '32': 'icons/icon-32.png',
        },
      },
      icons: {
        '16': 'icons/icon-16.png',
        '32': 'icons/icon-32.png',
        '48': 'icons/icon-48.png',
        '128': 'icons/icon-128.png',
      },
      background: {
        service_worker: 'src/background/index.ts',
        type: 'module',
      },
      permissions: ['storage', 'activeTab'],
      host_permissions: ['https://*/*'],
      options_ui: {
        page: 'src/options/index.html',
        open_in_tab: true,
      },
    }),
    getURL: (path: string) => `chrome-extension://runbi-test-extension-id/${path}`,
    connect: vi.fn((connectInfo?: { name?: string }) => {
      const clientPort = new MockPort(connectInfo?.name || 'default');
      const swPort = new MockPort(connectInfo?.name || 'default');
      clientPort._connectPeer(swPort);

      for (const l of connectListeners) {
        l(swPort);
      }
      return clientPort;
    }),
    onConnect: {
      addListener: (cb: (port: MockPort) => void) => connectListeners.push(cb),
      removeListener: (cb: (port: MockPort) => void) => {
        const idx = connectListeners.indexOf(cb);
        if (idx !== -1) connectListeners.splice(idx, 1);
      },
      hasListener: (cb: any) => connectListeners.includes(cb),
      hasListeners: () => connectListeners.length > 0,
      addRules: vi.fn(),
      getRules: vi.fn(),
      removeRules: vi.fn(),
    },
    sendMessage: vi.fn(async (msg: any) => {
      return new Promise((resolve) => {
        for (const l of messageListeners) {
          l(msg, { id: 'runbi-test-extension-id' }, resolve);
        }
      });
    }),
    openOptionsPage: vi.fn().mockResolvedValue(undefined),
    onMessage: {
      addListener: (cb: (msg: any, sender: any, sendResponse: any) => void) => messageListeners.push(cb),
      removeListener: (cb: any) => {
        const idx = messageListeners.indexOf(cb);
        if (idx !== -1) messageListeners.splice(idx, 1);
      },
      hasListener: (cb: any) => messageListeners.includes(cb),
      hasListeners: () => messageListeners.length > 0,
      addRules: vi.fn(),
      getRules: vi.fn(),
      removeRules: vi.fn(),
    },
  };

  return {
    storage: {
      local: localStorageArea,
    },
    runtime: mockRuntime,
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]),
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
      create: vi.fn().mockResolvedValue({ id: 2 }),
    },
  };
}

// Attach to globalThis
const mockChrome = createMockChrome();
(globalThis as any).chrome = mockChrome;

// ==========================================
// 2. DOM & Clipboard & Selection Polyfills
// ==========================================

// Polyfill DOMRect
if (typeof globalThis.DOMRect === 'undefined') {
  (globalThis as any).DOMRect = class DOMRect {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;

    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
      this.top = y;
      this.left = x;
      this.right = x + width;
      this.bottom = y + height;
    }

    toJSON() {
      return JSON.stringify(this);
    }
  };
}

// Polyfill navigator.clipboard
if (!navigator.clipboard) {
  let clipboardContent = '';
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: vi.fn(async (text: string) => {
        clipboardContent = text;
      }),
      readText: vi.fn(async () => clipboardContent),
    },
    configurable: true,
  });
}

// Shim innerText for JSDOM
if (typeof Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText')?.get === 'undefined') {
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    get() {
      return this.textContent || '';
    },
    set(v) {
      this.textContent = v;
    },
    configurable: true,
  });
}

// Polyfill innerText for JSDOM
if (typeof HTMLElement !== 'undefined' && !Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText')) {
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    get() {
      return this.textContent || '';
    },
    set(v) {
      this.textContent = v;
    },
    configurable: true,
  });
}

// Polyfill isContentEditable for JSDOM
if (typeof HTMLElement !== 'undefined') {
  Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
    get() {
      const val = this.getAttribute('contenteditable') || (this as any).contentEditable;
      return val === 'true' || val === true || val === '';
    },
    configurable: true,
  });
}

// Polyfill setRangeText for textarea / input
if (typeof HTMLTextAreaElement !== 'undefined' && !HTMLTextAreaElement.prototype.setRangeText) {
  HTMLTextAreaElement.prototype.setRangeText = function (
    replacement: string,
    start?: number,
    end?: number,
    selectionMode?: string
  ) {
    const s = typeof start === 'number' ? start : this.selectionStart || 0;
    const e = typeof end === 'number' ? end : this.selectionEnd || this.value.length;
    this.value = this.value.substring(0, s) + replacement + this.value.substring(e);
    if (selectionMode === 'end') {
      this.selectionStart = this.selectionEnd = s + replacement.length;
    } else if (selectionMode === 'select') {
      this.selectionStart = s;
      this.selectionEnd = s + replacement.length;
    } else if (selectionMode === 'start') {
      this.selectionStart = this.selectionEnd = s;
    }
  };
}
if (typeof HTMLInputElement !== 'undefined' && !HTMLInputElement.prototype.setRangeText) {
  HTMLInputElement.prototype.setRangeText = HTMLTextAreaElement.prototype.setRangeText;
}

// Mock document.execCommand
document.execCommand = vi.fn((commandId: string, _showUI?: boolean, value?: string) => {
  if (commandId === 'insertText' && typeof value === 'string') {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(value);
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    }
    const active = document.activeElement as HTMLElement;
    if (active && (active.isContentEditable || active.getAttribute('contenteditable') === 'true')) {
      active.textContent = value;
      return true;
    }
  }
  return false;
});

// Global lifecycle reset
beforeEach(() => {
  mockChrome.storage.local.clear();
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
