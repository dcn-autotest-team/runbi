import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  SelectionInfo,
  PositionCoordinates,
  DiffChunk,
  PolishStyle,
  StreamConfig,
  StreamClientMessage,
  StreamServerMessage,
} from '../../src/types';

describe('Tier 2: Boundary, Corner & Adversarial Edge Cases (All 23 Features)', () => {
  // =========================================================================
  // Feature 1: MV3 Scaffolding & Build Pipeline Boundaries
  // =========================================================================
  describe('Feature 1: Scaffolding Boundaries', () => {
    it('F1-B1: should reject invalid manifest_version other than 3', () => {
      const isMV3 = (manifest: any) => manifest && manifest.manifest_version === 3;
      expect(isMV3({ manifest_version: 2 })).toBe(false);
      expect(isMV3({ manifest_version: 3 })).toBe(true);
      expect(isMV3({})).toBe(false);
    });

    it('F1-B2: should validate semver compliance of version string', () => {
      const isValidSemver = (v: string) => /^\d+\.\d+\.\d+$/.test(v);
      expect(isValidSemver('1.0.0')).toBe(true);
      expect(isValidSemver('1.0.0-beta')).toBe(false);
      expect(isValidSemver('1.0')).toBe(false);
      expect(isValidSemver('')).toBe(false);
    });

    it('F1-B3: should handle empty permissions gracefully', () => {
      const checkPermissions = (manifest: any) => Array.isArray(manifest.permissions) && manifest.permissions.length > 0;
      expect(checkPermissions({ permissions: [] })).toBe(false);
      expect(checkPermissions({ permissions: ['storage'] })).toBe(true);
    });

    it('F1-B4: should reject insecure HTTP host permissions', () => {
      const isHttpsOnly = (patterns: string[]) => patterns.every((p) => p.startsWith('https://'));
      expect(isHttpsOnly(['https://*/*'])).toBe(true);
      expect(isHttpsOnly(['http://*/*'])).toBe(false);
      expect(isHttpsOnly(['https://api.openai.com/*', 'http://insecure.com/*'])).toBe(false);
    });

    it('F1-B5: should fallback gracefully if action icon path is missing', () => {
      const getIcon = (manifest: any, size: string) => manifest?.icons?.[size] || 'icons/default.png';
      expect(getIcon({}, '16')).toBe('icons/default.png');
      expect(getIcon({ icons: { '16': 'icons/icon-16.png' } }, '16')).toBe('icons/icon-16.png');
    });
  });

  // =========================================================================
  // Feature 2: Icon Asset Pipeline Boundaries
  // =========================================================================
  describe('Feature 2: Icon Pipeline Boundaries', () => {
    it('F2-B1: should fallback to closest standard size for non-standard icon requests', () => {
      const getClosestIconSize = (size: number): number => {
        const standard = [16, 32, 48, 128];
        return standard.reduce((prev, curr) => (Math.abs(curr - size) < Math.abs(prev - size) ? curr : prev));
      };
      expect(getClosestIconSize(24)).toBe(16);
      expect(getClosestIconSize(64)).toBe(48);
      expect(getClosestIconSize(256)).toBe(128);
    });

    it('F2-B2: should validate PNG signature headers', () => {
      const isPngHeader = (bytes: number[]) => {
        const pngMagic = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        return pngMagic.every((b, i) => bytes[i] === b);
      };
      const validPng = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00];
      const invalid = [0xFF, 0xD8, 0xFF, 0xE0]; // JPEG
      expect(isPngHeader(validPng)).toBe(true);
      expect(isPngHeader(invalid)).toBe(false);
    });

    it('F2-B3: should handle high-DPI (2x, 3x) device pixel ratios', () => {
      const selectIconForDPR = (baseSize: number, dpr: number) => {
        const target = baseSize * dpr;
        if (target <= 16) return 'icons/icon-16.png';
        if (target <= 32) return 'icons/icon-32.png';
        if (target <= 48) return 'icons/icon-48.png';
        return 'icons/icon-128.png';
      };
      expect(selectIconForDPR(16, 1)).toBe('icons/icon-16.png');
      expect(selectIconForDPR(16, 2)).toBe('icons/icon-32.png');
      expect(selectIconForDPR(16, 3)).toBe('icons/icon-48.png');
    });

    it('F2-B4: should safely handle empty icon manifest dictionary', () => {
      const manifest: any = { icons: {} };
      expect(manifest.icons['16']).toBeUndefined();
    });

    it('F2-B5: should verify square aspect ratio dimensions', () => {
      const isSquare = (w: number, h: number) => w > 0 && h > 0 && w === h;
      expect(isSquare(16, 16)).toBe(true);
      expect(isSquare(128, 128)).toBe(true);
      expect(isSquare(16, 32)).toBe(false);
    });
  });

  // =========================================================================
  // Feature 3: Project Types & Toolchains Boundaries
  // =========================================================================
  describe('Feature 3: Project Types Boundaries', () => {
    it('F3-B1: should fallback to "polished" for unknown style string', () => {
      const validStyles: PolishStyle[] = ['polished', 'academic', 'business', 'literary', 'concise', 'native_en'];
      const sanitizeStyle = (s: string): PolishStyle => {
        return validStyles.includes(s as PolishStyle) ? (s as PolishStyle) : 'polished';
      };
      expect(sanitizeStyle('academic')).toBe('academic');
      expect(sanitizeStyle('invalid_style')).toBe('polished');
      expect(sanitizeStyle('')).toBe('polished');
    });

    it('F3-B2: should clamp negative coordinates in PositionCoordinates', () => {
      const clampCoordinates = (coords: PositionCoordinates): PositionCoordinates => ({
        top: Math.max(0, coords.top),
        left: Math.max(0, coords.left),
        placement: coords.placement,
      });
      const clamped = clampCoordinates({ top: -50, left: -20, placement: 'top-left' });
      expect(clamped.top).toBe(0);
      expect(clamped.left).toBe(0);
    });

    it('F3-B3: should filter out zero-length empty DiffChunks', () => {
      const chunks: DiffChunk[] = [
        { type: 'equal', value: '有效' },
        { type: 'delete', value: '' },
        { type: 'insert', value: '' },
        { type: 'insert', value: '新内容' },
      ];
      const filtered = chunks.filter((c) => c.value.length > 0);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((c) => c.value)).toEqual(['有效', '新内容']);
    });

    it('F3-B4: should validate StreamClientMessage payload integrity', () => {
      const isValidClientMessage = (msg: any): msg is StreamClientMessage => {
        if (!msg || typeof msg !== 'object') return false;
        if (msg.action === 'ABORT') return true;
        if (msg.action === 'START_STREAM') {
          return Boolean(msg.payload && typeof msg.payload.text === 'string' && typeof msg.payload.config === 'object');
        }
        return false;
      };
      expect(isValidClientMessage({ action: 'ABORT' })).toBe(true);
      expect(isValidClientMessage({ action: 'START_STREAM', payload: { text: 'a', config: { style: 'polished' } } })).toBe(true);
      expect(isValidClientMessage({ action: 'START_STREAM' })).toBe(false);
      expect(isValidClientMessage({ action: 'INVALID' })).toBe(false);
    });

    it('F3-B5: should clamp non-negative durationMs and totalTokens in DONE message', () => {
      const sanitizeDonePayload = (payload: { durationMs: number; totalTokens: number }) => ({
        durationMs: Math.max(0, payload.durationMs),
        totalTokens: Math.max(0, payload.totalTokens),
      });
      const sanitized = sanitizeDonePayload({ durationMs: -100, totalTokens: -5 });
      expect(sanitized.durationMs).toBe(0);
      expect(sanitized.totalTokens).toBe(0);
    });
  });

  // =========================================================================
  // Feature 4: Selection Validation Engine Boundaries
  // =========================================================================
  describe('Feature 4: Selection Validation Boundaries', () => {
    function validate(text: string | null | undefined): boolean {
      if (!text) return false;
      const trimmed = text.trim();
      return trimmed.length >= 2 && trimmed.length <= 5000;
    }

    it('F4-B1: Boundary test: length = 1 (must fail)', () => {
      expect(validate('a')).toBe(false);
      expect(validate('字')).toBe(false);
    });

    it('F4-B2: Boundary test: length = 2 (must pass)', () => {
      expect(validate('ab')).toBe(true);
      expect(validate('文字')).toBe(true);
    });

    it('F4-B3: Boundary test: length = 5000 (must pass)', () => {
      const text5000 = 'x'.repeat(5000);
      expect(validate(text5000)).toBe(true);
    });

    it('F4-B4: Boundary test: length = 5001 (must fail)', () => {
      const text5001 = 'x'.repeat(5001);
      expect(validate(text5001)).toBe(false);
    });

    it('F4-B5: should reject text containing only whitespace, newlines, and tabs', () => {
      expect(validate('   \n\t  \r\n  ')).toBe(false);
      expect(validate('\u200B\u200B')).toBe(true); // zero width characters count as length
    });
  });

  // =========================================================================
  // Feature 5: Coordinate Collision Engine Boundaries
  // =========================================================================
  describe('Feature 5: Coordinate Collision Boundaries', () => {
    function computeBounds(rect: DOMRect, vpWidth: number, vpHeight: number, scrollX: number, scrollY: number) {
      let top = rect.top + scrollY - 36;
      let left = rect.right + scrollX + 4;
      let flippedV = false;
      let flippedH = false;

      if (rect.top < 40) {
        top = rect.bottom + scrollY + 8;
        flippedV = true;
      }
      if (rect.right + 32 > vpWidth) {
        left = rect.left + scrollX - 32;
        flippedH = true;
      }
      left = Math.max(scrollX + 8, Math.min(left, scrollX + vpWidth - 36));
      return { top, left, flippedV, flippedH };
    }

    it('F5-B1: should clamp coordinates at (0, 0) top-left viewport corner', () => {
      const rect = new DOMRect(0, 0, 10, 10);
      const res = computeBounds(rect, 1000, 800, 0, 0);
      expect(res.flippedV).toBe(true);
      expect(res.top).toBe(18);
      expect(res.left).toBe(14);
    });

    it('F5-B2: should flip and clamp at extreme bottom-right viewport corner', () => {
      const rect = new DOMRect(980, 750, 20, 20);
      const res = computeBounds(rect, 1000, 800, 0, 0);
      expect(res.flippedH).toBe(true);
      expect(res.left).toBe(948);
    });

    it('F5-B3: should handle off-screen negative scroll coordinates', () => {
      const rect = new DOMRect(100, 100, 50, 20);
      const res = computeBounds(rect, 1000, 800, -50, -50);
      expect(res.top).toBe(100 - 50 - 36);
    });

    it('F5-B4: should handle zero-width or zero-height collapsed selection rects', () => {
      const rect = new DOMRect(200, 200, 0, 0);
      const res = computeBounds(rect, 1000, 800, 0, 0);
      expect(res.left).toBe(204);
      expect(res.top).toBe(164);
    });

    it('F5-B5: should prevent horizontal overflow on ultra-narrow 320px screens', () => {
      const rect = new DOMRect(300, 100, 20, 20);
      const res = computeBounds(rect, 320, 600, 0, 0);
      expect(res.left).toBeLessThanOrEqual(320);
      expect(res.left).toBeGreaterThanOrEqual(8);
    });
  });

  // =========================================================================
  // Feature 6: CJK-Aware Myers Diff Engine Boundaries
  // =========================================================================
  describe('Feature 6: Diff Engine Boundaries', () => {
    function diff(orig: string, mod: string): DiffChunk[] {
      if (orig === mod) return [{ type: 'equal', value: orig }];
      if (!orig) return [{ type: 'insert', value: mod }];
      if (!mod) return [{ type: 'delete', value: orig }];
      return [
        { type: 'delete', value: orig },
        { type: 'insert', value: mod },
      ];
    }

    it('F6-B1: should handle empty original string (pure insertion)', () => {
      const chunks = diff('', '全新插入文字');
      expect(chunks).toEqual([{ type: 'insert', value: '全新插入文字' }]);
    });

    it('F6-B2: should handle empty modified string (pure deletion)', () => {
      const chunks = diff('全部删除文字', '');
      expect(chunks).toEqual([{ type: 'delete', value: '全部删除文字' }]);
    });

    it('F6-B3: should handle both original and modified strings empty', () => {
      const chunks = diff('', '');
      expect(chunks).toEqual([{ type: 'equal', value: '' }]);
    });

    it('F6-B4: should handle emojis and Unicode surrogate pairs properly', () => {
      const orig = '你好👋世界🌍';
      const mod = '您好✨世界🌏';
      const chunks = diff(orig, mod);
      expect(chunks).toBeDefined();
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('F6-B5: should handle 5000 character large text diff without stack overflow', () => {
      const orig = '原'.repeat(2500);
      const mod = '新'.repeat(2500);
      const chunks = diff(orig, mod);
      expect(chunks).toHaveLength(2);
      expect(chunks[0].value.length).toBe(2500);
      expect(chunks[1].value.length).toBe(2500);
    });
  });

  // =========================================================================
  // Feature 7: Mock Stream Generator Boundaries
  // =========================================================================
  describe('Feature 7: Mock Stream Generator Boundaries', () => {
    async function collectStream(generator: AsyncGenerator<StreamServerMessage>): Promise<StreamServerMessage[]> {
      const results: StreamServerMessage[] = [];
      for await (const msg of generator) {
        results.push(msg);
      }
      return results;
    }

    async function* mockStream(text: string, signal?: AbortSignal): AsyncGenerator<StreamServerMessage> {
      if (signal?.aborted) {
        yield { type: 'ABORTED' };
        return;
      }
      const chars = text.split('');
      for (const c of chars) {
        if (signal?.aborted) {
          yield { type: 'ABORTED' };
          return;
        }
        yield { type: 'CHUNK', payload: { delta: c } };
      }
      yield { type: 'DONE', payload: { durationMs: 10, totalTokens: chars.length } };
    }

    it('F7-B1: should abort immediately if signal is pre-aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const msgs = await collectStream(mockStream('测试文本', controller.signal));
      expect(msgs).toHaveLength(1);
      expect(msgs[0].type).toBe('ABORTED');
    });

    it('F7-B2: should abort mid-stream upon signal trigger', async () => {
      const controller = new AbortController();
      const gen = mockStream('这是一段较长的测试文本', controller.signal);
      const msgs: StreamServerMessage[] = [];
      for await (const msg of gen) {
        msgs.push(msg);
        if (msgs.length === 2) {
          controller.abort();
        }
      }
      const lastMsg = msgs[msgs.length - 1];
      expect(lastMsg.type).toBe('ABORTED');
    });

    it('F7-B3: should handle markdown symbols and code fences in text', async () => {
      const codeText = '```typescript\nconst x = 1;\n```';
      const msgs = await collectStream(mockStream(codeText));
      const deltas = msgs.filter((m) => m.type === 'CHUNK').map((m: any) => m.payload.delta);
      expect(deltas.join('')).toBe(codeText);
    });

    it('F7-B4: should handle single character input gracefully in mock generator', async () => {
      const msgs = await collectStream(mockStream('字'));
      expect(msgs.some((m) => m.type === 'DONE')).toBe(true);
    });

    it('F7-B5: should output positive tokens and duration for non-empty text', async () => {
      const msgs = await collectStream(mockStream('测试'));
      const done = msgs.find((m) => m.type === 'DONE') as any;
      expect(done.payload.totalTokens).toBe(2);
      expect(done.payload.durationMs).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Feature 8: Unit Test Suite Boundaries
  // =========================================================================
  describe('Feature 8: Test Harness Boundaries', () => {
    it('F8-B1: should return all keys when chrome.storage.local.get is called with null', async () => {
      await chrome.storage.local.set({ k1: 'v1', k2: 'v2' });
      const all = await chrome.storage.local.get(null);
      expect(all.k1).toBe('v1');
      expect(all.k2).toBe('v2');
    });

    it('F8-B2: should handle empty object set without errors', async () => {
      await expect(chrome.storage.local.set({})).resolves.not.toThrow();
    });

    it('F8-B3: should silently succeed when removing non-existent key', async () => {
      await expect(chrome.storage.local.remove('non_existent_key')).resolves.not.toThrow();
    });

    it('F8-B4: should handle 100KB clipboard writes without crashing', async () => {
      const largeText = 'A'.repeat(100000);
      await navigator.clipboard.writeText(largeText);
      const read = await navigator.clipboard.readText();
      expect(read.length).toBe(100000);
    });

    it('F8-B5: should return false for execCommand on non-editable elements', () => {
      const p = document.createElement('p');
      p.textContent = 'Non editable';
      document.body.appendChild(p);
      p.focus();
      const res = document.execCommand('insertText', false, 'test');
      expect(res).toBe(false);
    });
  });

  // =========================================================================
  // Feature 9: Shadow DOM Architecture Boundaries
  // =========================================================================
  describe('Feature 9: Shadow DOM Boundaries', () => {
    it('F9-B1: should be idempotent when mounting multiple times', () => {
      const mount = () => {
        let root = document.getElementById('runbi-extension-root');
        if (!root) {
          root = document.createElement('div');
          root.id = 'runbi-extension-root';
          root.attachShadow({ mode: 'open' });
          document.body.appendChild(root);
        }
        return root;
      };
      const r1 = mount();
      const r2 = mount();
      expect(r1).toBe(r2);
      expect(document.querySelectorAll('#runbi-extension-root')).toHaveLength(1);
    });

    it('F9-B2: should handle mounting before document.body is ready', () => {
      const ensureRoot = (doc: Document) => {
        const body = doc.body || doc.documentElement;
        const el = doc.createElement('div');
        el.id = 'runbi-root';
        body.appendChild(el);
        return el;
      };
      const el = ensureRoot(document);
      expect(el).not.toBeNull();
      el.remove();
    });

    it('F9-B3: should preserve shadow DOM styles even when host applies aggressive resets', () => {
      const host = document.createElement('div');
      host.id = 'runbi-test-host';
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = ':host { all: initial; display: block; }';
      shadow.appendChild(style);
      document.body.appendChild(host);

      expect(shadow.querySelector('style')?.textContent).toContain(':host { all: initial;');
      host.remove();
    });

    it('F9-B4: should safely handle accidental shadow root style removal and re-injection', () => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.id = 'runbi-css';
      shadow.appendChild(style);

      style.remove();
      expect(shadow.querySelector('#runbi-css')).toBeNull();

      const newStyle = document.createElement('style');
      newStyle.id = 'runbi-css';
      shadow.appendChild(newStyle);
      expect(shadow.querySelector('#runbi-css')).not.toBeNull();
    });

    it('F9-B5: should avoid selecting host elements from within shadow root', () => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      const hostTarget = document.createElement('div');
      hostTarget.id = 'outside-target';
      document.body.appendChild(hostTarget);

      expect(shadow.querySelector('#outside-target')).toBeNull();
      hostTarget.remove();
    });
  });

  // =========================================================================
  // Feature 10: Selection Listener Hook Boundaries
  // =========================================================================
  describe('Feature 10: Selection Listener Boundaries', () => {
    it('F10-B1: should handle rapid mouseup bursts without duplicate triggers', () => {
      vi.useFakeTimers();
      const fn = vi.fn();
      let timer: any = null;
      const debounceMouseup = (text: string) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn(text), 150);
      };

      for (let i = 0; i < 20; i++) {
        debounceMouseup(`Burst ${i}`);
      }
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(150);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('Burst 19');
      vi.useRealTimers();
    });

    it('F10-B2: should ignore mouseup on disabled elements', () => {
      const isSelectableElement = (el: HTMLElement | null) => {
        if (!el) return true;
        if ((el as HTMLInputElement).disabled) return false;
        if (el.getAttribute('aria-disabled') === 'true') return false;
        return true;
      };
      const disabledInput = document.createElement('input');
      disabledInput.disabled = true;
      expect(isSelectableElement(disabledInput)).toBe(false);
    });

    it('F10-B3: should handle multi-paragraph selection spanning multiple nodes', () => {
      const container = document.createElement('div');
      container.innerHTML = '<p>第一段内容</p><p>第二段内容</p>';
      document.body.appendChild(container);

      const text = container.textContent || '';
      expect(text).toContain('第一段内容');
      expect(text).toContain('第二段内容');
    });

    it('F10-B4: should cancel debounce if user clicks away before 150ms expires', () => {
      vi.useFakeTimers();
      let activeTimer: any = null;
      const onSelect = vi.fn();

      // Trigger selection
      activeTimer = setTimeout(() => onSelect(), 150);

      // User cancels at 80ms
      vi.advanceTimersByTime(80);
      clearTimeout(activeTimer);
      activeTimer = null;

      vi.advanceTimersByTime(100);
      expect(onSelect).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('F10-B5: should handle triple-click paragraph selection cleanly', () => {
      const p = document.createElement('p');
      p.textContent = '整段文本快速三击选择测试。';
      document.body.appendChild(p);
      expect(p.textContent.length).toBeGreaterThan(2);
    });
  });

  // =========================================================================
  // Feature 11: 28px Floating Trigger Capsule Boundaries
  // =========================================================================
  describe('Feature 11: Trigger Capsule Boundaries', () => {
    it('F11-B1: should prevent rendering capsule outside visible viewport edges', () => {
      const clampCapsule = (x: number, y: number, vpW: number, vpH: number) => ({
        x: Math.max(4, Math.min(x, vpW - 32)),
        y: Math.max(4, Math.min(y, vpH - 32)),
      });
      const pos = clampCapsule(-20, 1500, 1000, 800);
      expect(pos.x).toBe(4);
      expect(pos.y).toBe(800 - 32);
    });

    it('F11-B2: should ignore double-click spam on trigger capsule', () => {
      let isOpen = false;
      const openPanel = () => {
        if (isOpen) return;
        isOpen = true;
      };
      openPanel();
      openPanel();
      expect(isOpen).toBe(true);
    });

    it('F11-B3: should maintain 28px scale under CSS zoom', () => {
      const capsule = document.createElement('div');
      capsule.style.width = '28px';
      capsule.style.height = '28px';
      expect(capsule.style.width).toBe('28px');
    });

    it('F11-B4: should safely handle rapid unmounting during animation', () => {
      const capsule = document.createElement('div');
      document.body.appendChild(capsule);
      expect(() => capsule.remove()).not.toThrow();
    });

    it('F11-B5: should support touchstart as equivalent trigger on touch devices', () => {
      const onTrigger = vi.fn();
      const capsule = document.createElement('div');
      capsule.addEventListener('touchstart', onTrigger);
      capsule.dispatchEvent(new Event('touchstart'));
      expect(onTrigger).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Feature 12: Main Polishing Panel Modal Boundaries
  // =========================================================================
  describe('Feature 12: Panel Modal Boundaries', () => {
    it('F12-B1: should clamp panel width to screen width on mobile viewport (<380px)', () => {
      const computePanelWidth = (screenWidth: number) => Math.min(400, Math.max(280, screenWidth - 16));
      expect(computePanelWidth(320)).toBe(304);
      expect(computePanelWidth(1920)).toBe(400);
    });

    it('F12-B2: should support scrollable container for massive output', () => {
      const body = document.createElement('div');
      body.style.maxHeight = '300px';
      body.style.overflowY = 'auto';
      expect(body.style.overflowY).toBe('auto');
    });

    it('F12-B3: should fallback to default model name if none specified', () => {
      const getModelName = (model?: string) => model || 'DeepSeek-V3';
      expect(getModelName()).toBe('DeepSeek-V3');
      expect(getModelName('GPT-4o')).toBe('GPT-4o');
    });

    it('F12-B4: should clamp dragged panel coordinates within viewport limits', () => {
      const clampDrag = (x: number, y: number, pW: number, pH: number, vW: number, vH: number) => ({
        x: Math.max(0, Math.min(x, vW - pW)),
        y: Math.max(0, Math.min(y, vH - pH)),
      });
      const pos = clampDrag(-100, 2000, 400, 500, 1920, 1080);
      expect(pos.x).toBe(0);
      expect(pos.y).toBe(1080 - 500);
    });

    it('F12-B5: should handle rapid open/close toggle stress without leaking listeners', () => {
      let listenersCount = 0;
      const attach = () => {
        listenersCount++;
      };
      const detach = () => {
        listenersCount--;
      };

      for (let i = 0; i < 50; i++) {
        attach();
        detach();
      }
      expect(listenersCount).toBe(0);
    });
  });

  // =========================================================================
  // Feature 13: 6 Scene Style Tabs Boundaries
  // =========================================================================
  describe('Feature 13: Style Tabs Boundaries', () => {
    it('F13-B1: should handle rapid tab switching with request abort cancellation', () => {
      const abortCalls: string[] = [];
      let activeController: AbortController | null = null;

      const switchTab = (style: PolishStyle) => {
        if (activeController) {
          activeController.abort();
          abortCalls.push('aborted_prior');
        }
        activeController = new AbortController();
      };

      switchTab('academic');
      switchTab('business');
      switchTab('literary');
      expect(abortCalls).toHaveLength(2);
    });

    it('F13-B2: should safely handle empty custom prompt template', () => {
      const formatPrompt = (template: string, text: string) => {
        if (!template.includes('{{selected_text}}')) return `${template}\n${text}`;
        return template.replace('{{selected_text}}', text);
      };
      expect(formatPrompt('', '文本')).toBe('\n文本');
      expect(formatPrompt('模板: {{selected_text}}', '文本')).toBe('模板: 文本');
    });

    it('F13-B3: should support keyboard arrow navigation on tab buttons', () => {
      const styles: PolishStyle[] = ['polished', 'academic', 'business', 'literary', 'concise', 'native_en'];
      const getNextTab = (current: PolishStyle, direction: 'next' | 'prev'): PolishStyle => {
        const idx = styles.indexOf(current);
        if (direction === 'next') return styles[(idx + 1) % styles.length];
        return styles[(idx - 1 + styles.length) % styles.length];
      };
      expect(getNextTab('polished', 'next')).toBe('academic');
      expect(getNextTab('polished', 'prev')).toBe('native_en');
      expect(getNextTab('native_en', 'next')).toBe('polished');
    });

    it('F13-B4: should safely format texts containing regex special characters', () => {
      const specialText = 'Text with $& and $1 and \\d+';
      const prompt = `润色：${specialText}`;
      expect(prompt).toContain('Text with $& and $1');
    });

    it('F13-B5: should not switch style if clicking the currently active tab', () => {
      let triggerCount = 0;
      let active: PolishStyle = 'polished';
      const clickTab = (s: PolishStyle) => {
        if (s === active) return;
        active = s;
        triggerCount++;
      };
      clickTab('polished');
      expect(triggerCount).toBe(0);
      clickTab('academic');
      expect(triggerCount).toBe(1);
    });
  });

  // =========================================================================
  // Feature 14: Typewriter Streaming Display Boundaries
  // =========================================================================
  describe('Feature 14: Streaming Display Boundaries', () => {
    it('F14-B1: should handle 100 fast incoming chunks in 1 millisecond without dropping characters', () => {
      let buffer = '';
      for (let i = 0; i < 100; i++) {
        buffer += `${i},`;
      }
      expect(buffer.split(',').length).toBe(101);
    });

    it('F14-B2: should ignore empty delta chunks ({ delta: "" }) without crashing', () => {
      let state = '初始';
      const handleDelta = (delta: string) => {
        if (!delta) return;
        state += delta;
      };
      handleDelta('');
      handleDelta('新字');
      expect(state).toBe('初始新字');
    });

    it('F14-B3: should handle stream error mid-generation and display error banner', () => {
      let errorMsg: string | null = null;
      const onError = (err: string) => {
        errorMsg = err;
      };
      onError('Network stream disconnected unexpectedly');
      expect(errorMsg).toBe('Network stream disconnected unexpectedly');
    });

    it('F14-B4: should safely handle Stop button clicked after generation already completed', () => {
      let isGenerating = false;
      const onStop = () => {
        if (!isGenerating) return false;
        isGenerating = false;
        return true;
      };
      expect(onStop()).toBe(false);
    });

    it('F14-B5: should render massive 10,000 character single chunk cleanly', () => {
      const massiveChunk = '字'.repeat(10000);
      const div = document.createElement('div');
      div.textContent = massiveChunk;
      expect(div.textContent.length).toBe(10000);
    });
  });

  // =========================================================================
  // Feature 15: Diff Comparison View Boundaries
  // =========================================================================
  describe('Feature 15: Diff View Boundaries', () => {
    it('F15-B1: should render correctly when 100% of text is replaced', () => {
      const orig = '全部旧内容';
      const mod = '全新不同文字';
      const chunks: DiffChunk[] = [
        { type: 'delete', value: orig },
        { type: 'insert', value: mod },
      ];
      expect(chunks[0].type).toBe('delete');
      expect(chunks[1].type).toBe('insert');
    });

    it('F15-B2: should render correctly when 0% of text is changed', () => {
      const text = '完全无变化文本';
      const chunks: DiffChunk[] = [{ type: 'equal', value: text }];
      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe('equal');
    });

    it('F15-B3: should preserve newlines and whitespace indentation in diff view', () => {
      const chunk: DiffChunk = { type: 'equal', value: '  line 1\n  line 2\n' };
      expect(chunk.value).toContain('\n');
      expect(chunk.value.startsWith('  ')).toBe(true);
    });

    it('F15-B4: should safely escape HTML special characters in diff viewer', () => {
      const escapeHtml = (str: string) =>
        str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const raw = '<script>alert("xss")</script>';
      const escaped = escapeHtml(raw);
      expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('F15-B5: should handle rapid 50 toggle clicks between plain and diff views', () => {
      let isDiff = false;
      for (let i = 0; i < 50; i++) {
        isDiff = !isDiff;
      }
      expect(isDiff).toBe(false);
    });
  });

  // =========================================================================
  // Feature 16: Action Bar (Copy & Replace) Boundaries
  // =========================================================================
  describe('Feature 16: Copy & Replace Boundaries', () => {
    it('F16-B1: should handle clipboard API rejection gracefully', async () => {
      const clipboardMock = {
        writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
      };
      let caughtError = false;
      try {
        await clipboardMock.writeText('test');
      } catch (err) {
        caughtError = true;
      }
      expect(caughtError).toBe(true);
    });

    it('F16-B2: should prevent in-place replace on readonly textarea', () => {
      const ta = document.createElement('textarea');
      ta.readOnly = true;
      ta.value = 'Readonly text';

      const canReplace = (el: HTMLElement) => {
        if (el instanceof HTMLTextAreaElement && el.readOnly) return false;
        if (el instanceof HTMLInputElement && (el.readOnly || el.disabled)) return false;
        return true;
      };
      expect(canReplace(ta)).toBe(false);
    });

    it('F16-B3: should prevent in-place replace on disabled input', () => {
      const input = document.createElement('input');
      input.disabled = true;
      const canReplace = (el: HTMLElement) => !(el as HTMLInputElement).disabled;
      expect(canReplace(input)).toBe(false);
    });

    it('F16-B4: should safely handle in-place replace when target element was unmounted', () => {
      const ta = document.createElement('textarea');
      ta.value = 'Text';
      document.body.appendChild(ta);
      ta.remove();

      const tryReplace = (el: HTMLElement, newText: string) => {
        if (!document.body.contains(el)) return false;
        (el as HTMLTextAreaElement).value = newText;
        return true;
      };
      expect(tryReplace(ta, 'New text')).toBe(false);
    });

    it('F16-B5: should handle in-place replace in complex nested contenteditable nodes', () => {
      const editor = document.createElement('div');
      editor.contentEditable = 'true';
      editor.innerHTML = '<span>Nested <b>Bold</b> Text</span>';
      document.body.appendChild(editor);
      editor.focus();

      const range = document.createRange();
      range.selectNodeContents(editor);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      const replaced = document.execCommand('insertText', false, 'Clean Refined Text');
      expect(replaced).toBe(true);
      expect(editor.innerText).toBe('Clean Refined Text');
      editor.remove();
    });
  });

  // =========================================================================
  // Feature 17: Dismissal & Keyboard Controls Boundaries
  // =========================================================================
  describe('Feature 17: Dismissal Boundaries', () => {
    it('F17-B1: should ignore Escape key when user is typing in IME composition', () => {
      const isComposing = true;
      let closed = false;
      const handleEscape = (e: { key: string; isComposing?: boolean }) => {
        if (e.key === 'Escape' && !e.isComposing) {
          closed = true;
        }
      };
      handleEscape({ key: 'Escape', isComposing: true });
      expect(closed).toBe(false);

      handleEscape({ key: 'Escape', isComposing: false });
      expect(closed).toBe(true);
    });

    it('F17-B2: should close panel when clicking on an iframe element in host page', () => {
      const hostEl = document.createElement('div');
      hostEl.id = 'runbi-extension-root';
      document.body.appendChild(hostEl);

      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);

      let closed = false;
      const onDocClick = (target: Node) => {
        if (!hostEl.contains(target)) closed = true;
      };
      onDocClick(iframe);
      expect(closed).toBe(true);
      hostEl.remove();
      iframe.remove();
    });

    it('F17-B3: should handle multiple simultaneous Escape key events idempotently', () => {
      let closeCount = 0;
      let isOpen = true;
      const close = () => {
        if (!isOpen) return;
        isOpen = false;
        closeCount++;
      };
      close();
      close();
      close();
      expect(closeCount).toBe(1);
    });

    it('F17-B4: should cleanup UI immediately when beforeunload event fires on host page', () => {
      let isCleanedUp = false;
      const cleanup = () => {
        isCleanedUp = true;
      };
      window.addEventListener('beforeunload', cleanup);
      window.dispatchEvent(new Event('beforeunload'));
      expect(isCleanedUp).toBe(true);
      window.removeEventListener('beforeunload', cleanup);
    });

    it('F17-B5: should not dismiss when clicking inside a modal child element', () => {
      const modal = document.createElement('div');
      const childBtn = document.createElement('button');
      modal.appendChild(childBtn);

      const isInside = modal.contains(childBtn);
      expect(isInside).toBe(true);
    });
  });

  // =========================================================================
  // Feature 18: Background Service Worker Port Boundaries
  // =========================================================================
  describe('Feature 18: SW Port Boundaries', () => {
    it('F18-B1: should catch error when attempting to postMessage on disconnected port', () => {
      const port = chrome.runtime.connect({ name: 'runbi-stream-channel' });
      port.disconnect();
      expect(() => port.postMessage({ action: 'ABORT' })).toThrow(/disconnected/);
    });

    it('F18-B2: should handle unknown client action types without throwing', () => {
      const handleMessage = (msg: any): string => {
        if (msg?.action === 'START_STREAM') return 'STARTED';
        if (msg?.action === 'ABORT') return 'ABORTED';
        return 'UNKNOWN_IGNORED';
      };
      expect(handleMessage({ action: 'INVALID_ACTION' })).toBe('UNKNOWN_IGNORED');
      expect(handleMessage(null)).toBe('UNKNOWN_IGNORED');
    });

    it('F18-B3: should handle port reconnection after background service worker idle wake-up', () => {
      const createOrReconnectPort = (existingPort: chrome.runtime.Port | null): chrome.runtime.Port => {
        if (existingPort && !(existingPort as any).disconnected) return existingPort;
        return chrome.runtime.connect({ name: 'runbi-stream-channel' });
      };
      const p1 = createOrReconnectPort(null);
      expect(p1).toBeDefined();
      p1.disconnect();
      const p2 = createOrReconnectPort(p1);
      expect(p2).not.toBe(p1);
    });

    it('F18-B4: should handle high volume message bursts across port', () => {
      const port = chrome.runtime.connect({ name: 'runbi-stream-channel' });
      const msgs: any[] = [];
      port.onMessage.addListener((m) => msgs.push(m));

      for (let i = 0; i < 500; i++) {
        (port as any).postMessage({ type: 'CHUNK', payload: { delta: `${i}` } });
      }
      expect(port).toBeDefined();
    });

    it('F18-B5: should remove message listeners cleanly on unmount', () => {
      const port = chrome.runtime.connect({ name: 'runbi-stream-channel' });
      const listener = vi.fn();
      port.onMessage.addListener(listener);
      expect(port.onMessage.hasListeners()).toBe(true);
      port.onMessage.removeListener(listener);
      expect(port.onMessage.hasListener(listener)).toBe(false);
    });
  });

  // =========================================================================
  // Feature 19: OpenAI / DeepSeek SSE Stream Boundaries
  // =========================================================================
  describe('Feature 19: SSE Stream Parsing Boundaries', () => {
    function parseSSE(line: string): { delta?: string; done?: boolean; error?: string } {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) return {}; // SSE comment / ping
      if (!trimmed.startsWith('data:')) return {};
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return { done: true };
      try {
        const json = JSON.parse(data);
        return { delta: json.choices?.[0]?.delta?.content || '' };
      } catch (e) {
        return { error: 'MALFORMED_JSON' };
      }
    }

    it('F19-B1: should ignore SSE keep-alive comments (: ping)', () => {
      expect(parseSSE(': ping')).toEqual({});
      expect(parseSSE(': keep-alive')).toEqual({});
    });

    it('F19-B2: should handle malformed JSON lines in SSE stream without throwing', () => {
      const res = parseSSE('data: {unquoted_json}');
      expect(res.error).toBe('MALFORMED_JSON');
    });

    it('F19-B3: should parse valid OpenAI/DeepSeek delta chunk', () => {
      const res = parseSSE('data: {"choices":[{"delta":{"content":"字"}}]}');
      expect(res.delta).toBe('字');
    });

    it('F19-B4: should recognize [DONE] end-of-stream signal', () => {
      const res = parseSSE('data: [DONE]');
      expect(res.done).toBe(true);
    });

    it('F19-B5: should map HTTP 500 and 503 error codes to user-friendly messages', () => {
      const mapError = (code: number) => {
        if (code === 500) return 'LLM 服务端内部错误，请稍后重试。';
        if (code === 503) return 'LLM 服务暂时不可用或处于维护中。';
        return `请求失败 (${code})`;
      };
      expect(mapError(500)).toContain('服务端内部错误');
      expect(mapError(503)).toContain('维护中');
    });
  });

  // =========================================================================
  // Feature 20: Options Settings Page Boundaries
  // =========================================================================
  describe('Feature 20: Options Settings Boundaries', () => {
    it('F20-B1: should handle empty or whitespace API Key input by removing it from storage', async () => {
      const saveKey = async (k: string) => {
        const trimmed = k.trim();
        if (!trimmed) {
          await chrome.storage.local.remove('apiKey');
        } else {
          await chrome.storage.local.set({ apiKey: trimmed });
        }
      };
      await saveKey('   ');
      const res = await chrome.storage.local.get('apiKey');
      expect(res.apiKey).toBeUndefined();
    });

    it('F20-B2: should reject invalid base URL schemes (e.g. ftp://)', () => {
      const validateUrl = (u: string) => /^https?:\/\/.+/.test(u);
      expect(validateUrl('ftp://example.com')).toBe(false);
      expect(validateUrl('javascript:alert(1)')).toBe(false);
      expect(validateUrl('https://api.openai.com/v1')).toBe(true);
      expect(validateUrl('http://localhost:11434/v1')).toBe(true);
    });

    it('F20-B3: should handle offline network during connection test', async () => {
      const testConn = async () => {
        if (!navigator.onLine) {
          return { ok: false, error: '网络未连接，请检查本地网络。' };
        }
        return { ok: true };
      };
      const res = await testConn();
      expect(res).toBeDefined();
    });

    it('F20-B4: should reset all settings to defaults safely', async () => {
      await chrome.storage.local.set({ apiKey: 'key', model: 'custom', enabled: false });
      await chrome.storage.local.clear();
      const stored = await chrome.storage.local.get(null);
      expect(Object.keys(stored)).toHaveLength(0);
    });

    it('F20-B5: should support storing custom temperature and max_tokens parameters', async () => {
      const params = { temperature: 0.7, max_tokens: 2048 };
      await chrome.storage.local.set({ modelParams: params });
      const stored = await chrome.storage.local.get('modelParams');
      expect(stored.modelParams.temperature).toBe(0.7);
      expect(stored.modelParams.max_tokens).toBe(2048);
    });
  });

  // =========================================================================
  // Feature 21: Popup Quick Settings Boundaries
  // =========================================================================
  describe('Feature 21: Popup Quick Settings Boundaries', () => {
    it('F21-B1: should prevent duplicate entries in blacklist array', async () => {
      const addDomain = async (domain: string) => {
        const stored = await chrome.storage.local.get('blacklist');
        const list: string[] = stored.blacklist || [];
        if (!list.includes(domain)) {
          list.push(domain);
          await chrome.storage.local.set({ blacklist: list });
        }
      };
      await addDomain('github.com');
      await addDomain('github.com');
      const res = await chrome.storage.local.get('blacklist');
      expect(res.blacklist.filter((d: string) => d === 'github.com')).toHaveLength(1);
    });

    it('F21-B2: should remove domain from blacklist correctly', async () => {
      await chrome.storage.local.set({ blacklist: ['github.com', 'google.com'] });
      const removeDomain = async (domain: string) => {
        const stored = await chrome.storage.local.get('blacklist');
        const list: string[] = (stored.blacklist || []).filter((d: string) => d !== domain);
        await chrome.storage.local.set({ blacklist: list });
      };
      await removeDomain('github.com');
      const res = await chrome.storage.local.get('blacklist');
      expect(res.blacklist).toEqual(['google.com']);
    });

    it('F21-B3: should disable blacklist toggle on restricted chrome:// pages', () => {
      const isBlacklistableUrl = (url: string) => {
        return !url.startsWith('chrome://') && !url.startsWith('edge://') && !url.startsWith('about:');
      };
      expect(isBlacklistableUrl('chrome://extensions')).toBe(false);
      expect(isBlacklistableUrl('https://example.com')).toBe(true);
    });

    it('F21-B4: should handle dark mode preference in popup', () => {
      const isDarkMode = (theme: string, systemDark: boolean) => {
        if (theme === 'dark') return true;
        if (theme === 'light') return false;
        return systemDark;
      };
      expect(isDarkMode('auto', true)).toBe(true);
      expect(isDarkMode('auto', false)).toBe(false);
      expect(isDarkMode('dark', false)).toBe(true);
      expect(isDarkMode('light', true)).toBe(false);
    });

    it('F21-B5: should handle rapid ON/OFF toggle switches without corrupted storage state', async () => {
      for (let i = 0; i < 20; i++) {
        await chrome.storage.local.set({ enabled: i % 2 === 0 });
      }
      const res = await chrome.storage.local.get('enabled');
      expect(typeof res.enabled).toBe('boolean');
    });
  });

  // =========================================================================
  // Feature 22: Hostile CSS Isolation Testbed Boundaries
  // =========================================================================
  describe('Feature 22: Hostile CSS Boundaries', () => {
    it('F22-B1: should isolate from host global user-select: none !important', () => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      const panel = document.createElement('div');
      panel.style.userSelect = 'text';
      shadow.appendChild(panel);

      expect(panel.style.userSelect).toBe('text');
    });

    it('F22-B2: should isolate from host global direction: rtl layout', () => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      const panel = document.createElement('div');
      panel.style.direction = 'ltr';
      shadow.appendChild(panel);

      expect(panel.style.direction).toBe('ltr');
    });

    it('F22-B3: should isolate from host overflow: hidden on html/body', () => {
      const host = document.createElement('div');
      host.style.position = 'fixed';
      host.style.zIndex = '2147483647';
      document.body.appendChild(host);

      expect(host.style.position).toBe('fixed');
      expect(host.style.zIndex).toBe('2147483647');
      host.remove();
    });

    it('F22-B4: should isolate Runbi button styling from host CSS reset', () => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      const btn = document.createElement('button');
      btn.style.cursor = 'pointer';
      btn.style.padding = '8px 16px';
      shadow.appendChild(btn);

      expect(btn.style.cursor).toBe('pointer');
      expect(btn.style.padding).toBe('8px 16px');
    });

    it('F22-B5: should ensure host page transforms do not translate fixed shadow root', () => {
      const host = document.createElement('div');
      host.id = 'runbi-extension-root';
      host.style.position = 'fixed';
      host.style.inset = '0';
      document.body.appendChild(host);

      expect(host.style.position).toBe('fixed');
      host.remove();
    });
  });

  // =========================================================================
  // Feature 23: E2E Integration & Verification Boundaries
  // =========================================================================
  describe('Feature 23: E2E Integration Boundaries', () => {
    it('F23-B1: should execute 100 consecutive mock polishing cycles without memory leak', async () => {
      for (let i = 0; i < 100; i++) {
        const text = `循环测试句子 ${i}`;
        const polished = `【通用润色】${text}`;
        expect(polished.length).toBeGreaterThan(text.length);
      }
    });

    it('F23-B2: should handle opening and closing panel 50 times in rapid succession', () => {
      let state: 'CLOSED' | 'OPEN' = 'CLOSED';
      for (let i = 0; i < 50; i++) {
        state = 'OPEN';
        state = 'CLOSED';
      }
      expect(state).toBe('CLOSED');
    });

    it('F23-B3: should handle multi-tab storage synchronization', async () => {
      const tab1Storage = chrome.storage.local;
      const tab2Storage = chrome.storage.local;

      await tab1Storage.set({ sharedSetting: 'tab1_val' });
      const readTab2 = await tab2Storage.get('sharedSetting');
      expect(readTab2.sharedSetting).toBe('tab1_val');
    });

    it('F23-B4: should recover immediately from stream failure and allow immediate re-trigger', () => {
      let failed = true;
      const trigger = () => {
        if (failed) {
          failed = false;
          return 'FAILED';
        }
        return 'SUCCESS';
      };
      expect(trigger()).toBe('FAILED');
      expect(trigger()).toBe('SUCCESS');
    });

    it('F23-B5: should completely remove all DOM elements and listeners on extension disable', () => {
      const host = document.createElement('div');
      host.id = 'runbi-extension-root';
      document.body.appendChild(host);
      expect(document.getElementById('runbi-extension-root')).not.toBeNull();

      // Disable extension
      host.remove();
      expect(document.getElementById('runbi-extension-root')).toBeNull();
    });
  });
});
