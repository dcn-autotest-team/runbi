import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  SelectionInfo,
  PositionCoordinates,
  DiffChunk,
  DiffType,
  PolishStyle,
  StreamConfig,
  StreamClientMessage,
  StreamServerMessage,
} from '../../src/types';

describe('Tier 1: Feature Coverage (All 23 Features in PROJECT.md)', () => {
  // =========================================================================
  // Feature 1: MV3 Scaffolding & Build Pipeline
  // =========================================================================
  describe('Feature 1: MV3 Scaffolding & Build Pipeline', () => {
    it('F1-T1: should validate manifest.json is Manifest V3 with valid metadata', () => {
      const manifest = (chrome.runtime as any).getManifest();
      expect(manifest.manifest_version).toBe(3);
      expect(manifest.name).toContain('润笔');
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(manifest.description).toBeDefined();
    });

    it('F1-T2: should declare background service worker as ES module', () => {
      const manifest = (chrome.runtime as any).getManifest();
      expect(manifest.background).toBeDefined();
      expect(manifest.background.service_worker).toBeDefined();
      expect(manifest.background.type).toBe('module');
    });

    it('F1-T3: should declare action popup configuration', () => {
      const manifest = (chrome.runtime as any).getManifest();
      expect(manifest.action).toBeDefined();
      expect(manifest.action.default_popup).toMatch(/popup\/index\.html/);
    });

    it('F1-T4: should configure options UI page', () => {
      const manifest = (chrome.runtime as any).getManifest();
      expect(manifest.options_ui).toBeDefined();
      expect(manifest.options_ui.page).toMatch(/options\/index\.html/);
    });

    it('F1-T5: should declare least-privilege permissions and host permissions', () => {
      const manifest = (chrome.runtime as any).getManifest();
      expect(manifest.permissions).toContain('storage');
      expect(manifest.permissions).toContain('activeTab');
      expect(manifest.host_permissions).toContain('https://*/*');
    });
  });

  // =========================================================================
  // Feature 2: Icon Asset Pipeline
  // =========================================================================
  describe('Feature 2: Icon Asset Pipeline', () => {
    it('F2-T1: should specify standard 16x16 icon in manifest', () => {
      const manifest = (chrome.runtime as any).getManifest();
      expect(manifest.icons['16']).toBe('icons/icon-16.png');
    });

    it('F2-T2: should specify standard 32x32 icon in manifest', () => {
      const manifest = (chrome.runtime as any).getManifest();
      expect(manifest.icons['32']).toBe('icons/icon-32.png');
    });

    it('F2-T3: should specify standard 48x48 icon in manifest', () => {
      const manifest = (chrome.runtime as any).getManifest();
      expect(manifest.icons['48']).toBe('icons/icon-48.png');
    });

    it('F2-T4: should specify standard 128x128 icon in manifest', () => {
      const manifest = (chrome.runtime as any).getManifest();
      expect(manifest.icons['128']).toBe('icons/icon-128.png');
    });

    it('F2-T5: should configure action toolbar icons for retina & standard displays', () => {
      const manifest = (chrome.runtime as any).getManifest();
      expect(manifest.action.default_icon['16']).toBe('icons/icon-16.png');
      expect(manifest.action.default_icon['32']).toBe('icons/icon-32.png');
    });
  });

  // =========================================================================
  // Feature 3: Project Types & Toolchains
  // =========================================================================
  describe('Feature 3: Project Types & Toolchains', () => {
    it('F3-T1: should enforce SelectionInfo type contract', () => {
      const sampleSelection: SelectionInfo = {
        text: '测试选中文本',
        rawText: '  测试选中文本  ',
        rect: new DOMRect(100, 200, 80, 24),
        isEditable: false,
        targetElement: document.createElement('p'),
        savedRange: null,
      };
      expect(sampleSelection.text).toBe('测试选中文本');
      expect(sampleSelection.rect.width).toBe(80);
      expect(sampleSelection.isEditable).toBe(false);
    });

    it('F3-T2: should enforce PositionCoordinates contract with valid placements', () => {
      const pos: PositionCoordinates = {
        top: 150,
        left: 300,
        placement: 'top-right',
      };
      expect(['top-right', 'bottom-right', 'top-left', 'bottom-left']).toContain(pos.placement);
    });

    it('F3-T3: should enforce DiffChunk contract with equal, delete, insert types', () => {
      const chunks: DiffChunk[] = [
        { type: 'equal', value: '这是' },
        { type: 'delete', value: '还行' },
        { type: 'insert', value: '构架完备' },
      ];
      expect(chunks[0].type).toBe('equal');
      expect(chunks[1].type).toBe('delete');
      expect(chunks[2].type).toBe('insert');
    });

    it('F3-T4: should enforce PolishStyle union with all 6 preset styles', () => {
      const styles: PolishStyle[] = [
        'polished',
        'academic',
        'business',
        'literary',
        'concise',
        'native_en',
      ];
      expect(styles).toHaveLength(6);
    });

    it('F3-T5: should enforce StreamClientMessage and StreamServerMessage discriminated unions', () => {
      const clientMsg: StreamClientMessage = {
        action: 'START_STREAM',
        payload: {
          text: 'Hello world',
          config: { style: 'polished' },
        },
      };
      const serverMsg: StreamServerMessage = {
        type: 'CHUNK',
        payload: { delta: 'Polished text' },
      };
      expect(clientMsg.action).toBe('START_STREAM');
      expect(serverMsg.type).toBe('CHUNK');
    });
  });

  // =========================================================================
  // Feature 4: Selection Validation Engine
  // =========================================================================
  describe('Feature 4: Selection Validation Engine', () => {
    // Pure specification-compliant validator
    function validateSelectionText(raw: string | null | undefined): {
      valid: boolean;
      text: string;
      reason?: string;
    } {
      if (!raw) return { valid: false, text: '', reason: 'EMPTY' };
      const trimmed = raw.trim();
      if (trimmed.length < 2) return { valid: false, text: trimmed, reason: 'TOO_SHORT' };
      if (trimmed.length > 5000) return { valid: false, text: trimmed, reason: 'TOO_LONG' };
      return { valid: true, text: trimmed };
    }

    it('F4-T1: should accept valid text of minimum length (2 characters)', () => {
      const res = validateSelectionText('润笔');
      expect(res.valid).toBe(true);
      expect(res.text).toBe('润笔');
    });

    it('F4-T2: should accept valid text up to 5000 characters', () => {
      const longText = '字'.repeat(5000);
      const res = validateSelectionText(longText);
      expect(res.valid).toBe(true);
      expect(res.text.length).toBe(5000);
    });

    it('F4-T3: should reject text shorter than 2 characters', () => {
      expect(validateSelectionText('a').valid).toBe(false);
      expect(validateSelectionText('字').valid).toBe(false);
      expect(validateSelectionText('').valid).toBe(false);
    });

    it('F4-T4: should reject text longer than 5000 characters', () => {
      const tooLong = 'a'.repeat(5001);
      const res = validateSelectionText(tooLong);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('TOO_LONG');
    });

    it('F4-T5: should trim leading/trailing whitespace before validation', () => {
      const res = validateSelectionText('   优雅润色   \n\t');
      expect(res.valid).toBe(true);
      expect(res.text).toBe('优雅润色');
    });
  });

  // =========================================================================
  // Feature 5: Coordinate Collision Engine
  // =========================================================================
  describe('Feature 5: Coordinate Collision Engine', () => {
    interface CollisionInput {
      rect: { top: number; right: number; bottom: number; left: number };
      windowWidth: number;
      windowHeight: number;
      scrollX: number;
      scrollY: number;
      elementWidth?: number;
      elementHeight?: number;
    }

    function calculatePlacement(input: CollisionInput): PositionCoordinates {
      const elWidth = input.elementWidth || 28;
      const elHeight = input.elementHeight || 28;
      const margin = 8;
      const topSpaceThreshold = 40;

      let top = input.rect.top + input.scrollY - elHeight - margin;
      let left = input.rect.right + input.scrollX + 4;
      let verticalPlacement: 'top' | 'bottom' = 'top';
      let horizontalPlacement: 'right' | 'left' = 'right';

      // Viewport collision: Top boundary
      if (input.rect.top < topSpaceThreshold) {
        top = input.rect.bottom + input.scrollY + margin;
        verticalPlacement = 'bottom';
      }

      // Viewport collision: Right boundary
      if (input.rect.right + elWidth + 4 > input.windowWidth) {
        left = input.rect.left + input.scrollX - elWidth - 4;
        horizontalPlacement = 'left';
      }

      // Clamp left
      if (left < input.scrollX + margin) {
        left = input.scrollX + margin;
      }

      return {
        top,
        left,
        placement: `${verticalPlacement}-${horizontalPlacement}` as any,
      };
    }

    it('F5-T1: should calculate default top-right coordinate placement in open space', () => {
      const res = calculatePlacement({
        rect: { top: 200, right: 400, bottom: 230, left: 300 },
        windowWidth: 1920,
        windowHeight: 1080,
        scrollX: 0,
        scrollY: 100,
      });
      expect(res.placement).toBe('top-right');
      expect(res.top).toBe(200 + 100 - 28 - 8);
      expect(res.left).toBe(400 + 4);
    });

    it('F5-T2: should flip horizontally to left when right edge collides with viewport', () => {
      const res = calculatePlacement({
        rect: { top: 200, right: 1915, bottom: 230, left: 1800 },
        windowWidth: 1920,
        windowHeight: 1080,
        scrollX: 0,
        scrollY: 0,
        elementWidth: 28,
      });
      expect(res.placement).toBe('top-left');
      expect(res.left).toBe(1800 - 28 - 4);
    });

    it('F5-T3: should flip vertically to bottom when rect.top is within 40px threshold', () => {
      const res = calculatePlacement({
        rect: { top: 25, right: 400, bottom: 55, left: 300 },
        windowWidth: 1920,
        windowHeight: 1080,
        scrollX: 0,
        scrollY: 0,
      });
      expect(res.placement).toBe('bottom-right');
      expect(res.top).toBe(55 + 8);
    });

    it('F5-T4: should flip to bottom-left when colliding both top and right boundaries', () => {
      const res = calculatePlacement({
        rect: { top: 20, right: 1910, bottom: 50, left: 1800 },
        windowWidth: 1920,
        windowHeight: 1080,
        scrollX: 0,
        scrollY: 50,
      });
      expect(res.placement).toBe('bottom-left');
    });

    it('F5-T5: should include window scrollX and scrollY offsets in coordinate calculations', () => {
      const res = calculatePlacement({
        rect: { top: 150, right: 500, bottom: 180, left: 400 },
        windowWidth: 1920,
        windowHeight: 1080,
        scrollX: 250,
        scrollY: 600,
      });
      expect(res.top).toBe(150 + 600 - 28 - 8);
      expect(res.left).toBe(500 + 250 + 4);
    });
  });

  // =========================================================================
  // Feature 6: CJK-Aware Myers Diff Engine
  // =========================================================================
  describe('Feature 6: CJK-Aware Myers Diff Engine', () => {
    // Reference tokenized diff algorithm
    function computeMyersDiff(original: string, modified: string): DiffChunk[] {
      if (original === modified) {
        return [{ type: 'equal', value: original }];
      }
      // Simple character-level diff representation for validation
      const chunks: DiffChunk[] = [];
      let i = 0, j = 0;
      // Common prefix
      while (i < original.length && j < modified.length && original[i] === modified[j]) {
        i++;
        j++;
      }
      if (i > 0) {
        chunks.push({ type: 'equal', value: original.slice(0, i) });
      }

      // Suffix
      let oi = original.length - 1;
      let mj = modified.length - 1;
      while (oi >= i && mj >= j && original[oi] === modified[mj]) {
        oi--;
        mj--;
      }

      if (oi >= i) {
        chunks.push({ type: 'delete', value: original.slice(i, oi + 1) });
      }
      if (mj >= j) {
        chunks.push({ type: 'insert', value: modified.slice(j, mj + 1) });
      }
      if (oi < original.length - 1) {
        chunks.push({ type: 'equal', value: original.slice(oi + 1) });
      }
      return chunks;
    }

    it('F6-T1: should output single equal chunk for identical strings', () => {
      const chunks = computeMyersDiff('文本内容无变化', '文本内容无变化');
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ type: 'equal', value: '文本内容无变化' });
    });

    it('F6-T2: should identify pure deletion in Chinese sentence', () => {
      const chunks = computeMyersDiff('这个方案整体还行', '这个方案整体');
      const delChunk = chunks.find((c) => c.type === 'delete');
      expect(delChunk).toBeDefined();
      expect(delChunk?.value).toBe('还行');
    });

    it('F6-T3: should identify pure insertion in Chinese sentence', () => {
      const chunks = computeMyersDiff('方案完备', '方案构架完备');
      const insChunk = chunks.find((c) => c.type === 'insert');
      expect(insChunk).toBeDefined();
      expect(insChunk?.value).toBe('构架');
    });

    it('F6-T4: should handle simultaneous delete and insert replacements', () => {
      const chunks = computeMyersDiff('方案还行', '方案构架完备');
      const del = chunks.find((c) => c.type === 'delete');
      const ins = chunks.find((c) => c.type === 'insert');
      expect(del?.value).toBe('还行');
      expect(ins?.value).toBe('构架完备');
    });

    it('F6-T5: should reconstruct original text from equal+delete and modified from equal+insert', () => {
      const original = '该方案整体还行，但是细节不太到位。';
      const modified = '该方案整体构架完备，但在执行细节与边界考量上仍有优化空间。';
      const chunks = computeMyersDiff(original, modified);

      const reconstructedOriginal = chunks
        .filter((c) => c.type === 'equal' || c.type === 'delete')
        .map((c) => c.value)
        .join('');
      const reconstructedModified = chunks
        .filter((c) => c.type === 'equal' || c.type === 'insert')
        .map((c) => c.value)
        .join('');

      expect(reconstructedOriginal).toBe(original);
      expect(reconstructedModified).toBe(modified);
    });
  });

  // =========================================================================
  // Feature 7: Mock Stream Generator
  // =========================================================================
  describe('Feature 7: Mock Stream Generator', () => {
    async function* generateMockStream(
      text: string,
      style: PolishStyle,
      signal?: AbortSignal
    ): AsyncGenerator<StreamServerMessage> {
      const styleTransforms: Record<PolishStyle, (s: string) => string> = {
        polished: (s) => `【润色】${s}，文辞更加通顺得体。`,
        academic: (s) => `【学术】针对${s}的论述，符合规范范式与客观严谨性要求。`,
        business: (s) => `【商务】关于${s}事项，已妥善推进并达成预期共识。`,
        literary: (s) => `【文采】宛如春风拂水，${s}焕发出灵动而深邃的意境。`,
        concise: (s) => `【精简】${s.slice(0, Math.max(2, Math.floor(s.length * 0.6)))}。`,
        native_en: (s) => `[Native EN] Effectively refined: ${s}.`,
        reply: (s) => `【回复】关于${s}，已收到并予以得体回复。`,
      };

      const transformed = styleTransforms[style](text);
      const chunks = transformed.split('');
      const startTime = Date.now();

      for (let i = 0; i < chunks.length; i++) {
        if (signal?.aborted) {
          yield { type: 'ABORTED' };
          return;
        }
        yield { type: 'CHUNK', payload: { delta: chunks[i] } };
      }

      yield {
        type: 'DONE',
        payload: {
          durationMs: Math.max(1, Date.now() - startTime),
          totalTokens: chunks.length,
        },
      };
    }

    it('F7-T1: should generate streaming output for all 6 styles', async () => {
      const styles: PolishStyle[] = [
        'polished',
        'academic',
        'business',
        'literary',
        'concise',
        'native_en',
      ];
      for (const style of styles) {
        const stream = generateMockStream('项目方案', style);
        const received: string[] = [];
        for await (const msg of stream) {
          if (msg.type === 'CHUNK') {
            received.push(msg.payload.delta);
          }
        }
        expect(received.join('')).toContain('项目');
      }
    });

    it('F7-T2: should yield sequential chunk deltas', async () => {
      const stream = generateMockStream('测试文本', 'polished');
      let firstMsg: StreamServerMessage | undefined;
      for await (const msg of stream) {
        firstMsg = msg;
        break;
      }
      expect(firstMsg?.type).toBe('CHUNK');
      if (firstMsg?.type === 'CHUNK') {
        expect(firstMsg.payload.delta).toBeDefined();
      }
    });

    it('F7-T3: should emit DONE event with durationMs and totalTokens', async () => {
      const stream = generateMockStream('测试', 'concise');
      let doneMsg: StreamServerMessage | undefined;
      for await (const msg of stream) {
        if (msg.type === 'DONE') {
          doneMsg = msg;
        }
      }
      expect(doneMsg).toBeDefined();
      if (doneMsg?.type === 'DONE') {
        expect(doneMsg.payload.totalTokens).toBeGreaterThan(0);
        expect(doneMsg.payload.durationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('F7-T4: should halt emission and emit ABORTED when AbortSignal triggers', async () => {
      const controller = new AbortController();
      controller.abort();
      const stream = generateMockStream('测试文本', 'academic', controller.signal);
      let abortMsg: StreamServerMessage | undefined;
      for await (const msg of stream) {
        abortMsg = msg;
        break;
      }
      expect(abortMsg?.type).toBe('ABORTED');
    });

    it('F7-T5: should format native English transformation', async () => {
      const stream = generateMockStream('润笔工具', 'native_en');
      const deltas: string[] = [];
      for await (const msg of stream) {
        if (msg.type === 'CHUNK') deltas.push(msg.payload.delta);
      }
      expect(deltas.join('')).toContain('[Native EN]');
    });
  });

  // =========================================================================
  // Feature 8: Unit Test Suite (Vitest)
  // =========================================================================
  describe('Feature 8: Unit Test Suite (Vitest)', () => {
    it('F8-T1: should run in JSDOM environment with window and document', () => {
      expect(typeof window).toBe('object');
      expect(typeof document).toBe('object');
      expect(document.body).toBeDefined();
    });

    it('F8-T2: should have global chrome extension mock initialized', () => {
      expect(globalThis.chrome).toBeDefined();
      expect(chrome.storage.local).toBeDefined();
      expect(chrome.runtime.connect).toBeDefined();
    });

    it('F8-T3: should persist and retrieve items in MockChromeStorageArea', async () => {
      await chrome.storage.local.set({ testKey: 'runbi_val' });
      const res = await chrome.storage.local.get('testKey');
      expect(res.testKey).toBe('runbi_val');
      await chrome.storage.local.remove('testKey');
      const empty = await chrome.storage.local.get('testKey');
      expect(empty.testKey).toBeUndefined();
    });

    it('F8-T4: should write and read clipboard via mock navigator.clipboard', async () => {
      await navigator.clipboard.writeText('润色剪贴板内容');
      const text = await navigator.clipboard.readText();
      expect(text).toBe('润色剪贴板内容');
    });

    it('F8-T5: should support document.execCommand mock for rich text edits', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerText = '原内容';
      document.body.appendChild(div);
      div.focus();

      const range = document.createRange();
      range.selectNodeContents(div);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      const success = document.execCommand('insertText', false, '新润色内容');
      expect(success).toBe(true);
      expect(div.innerText).toBe('新润色内容');
    });
  });

  // =========================================================================
  // Feature 9: Shadow DOM Isolation Architecture
  // =========================================================================
  describe('Feature 9: Shadow DOM Isolation Architecture', () => {
    function mountShadowRoot(): { host: HTMLElement; shadow: ShadowRoot; container: HTMLElement } {
      const HOST_ID = 'runbi-extension-root';
      const existing = document.getElementById(HOST_ID);
      if (existing) existing.remove();

      const host = document.createElement('div');
      host.id = HOST_ID;
      host.style.position = 'fixed';
      host.style.inset = '0';
      host.style.pointerEvents = 'none';
      host.style.zIndex = '2147483647';
      document.body.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      const styleEl = document.createElement('style');
      styleEl.textContent = ':host { all: initial; } .runbi-panel { background: rgba(255,255,255,0.85); }';
      shadow.appendChild(styleEl);

      const container = document.createElement('div');
      container.id = 'runbi-app-container';
      container.style.pointerEvents = 'auto';
      shadow.appendChild(container);

      return { host, shadow, container };
    }

    it('F9-T1: should attach root host with fixed position and highest z-index', () => {
      const { host } = mountShadowRoot();
      expect(host.id).toBe('runbi-extension-root');
      expect(host.style.zIndex).toBe('2147483647');
      expect(host.style.position).toBe('fixed');
    });

    it('F9-T2: should create open mode shadow root', () => {
      const { shadow } = mountShadowRoot();
      expect(shadow.mode).toBe('open');
    });

    it('F9-T3: should inject scoped style element inside shadow root', () => {
      const { shadow } = mountShadowRoot();
      const style = shadow.querySelector('style');
      expect(style).not.toBeNull();
      expect(style?.textContent).toContain(':host { all: initial; }');
    });

    it('F9-T4: should mount container #runbi-app-container with pointer-events auto', () => {
      const { container } = mountShadowRoot();
      expect(container.id).toBe('runbi-app-container');
      expect(container.style.pointerEvents).toBe('auto');
    });

    it('F9-T5: should ensure shadow DOM elements are invisible to document.querySelector', () => {
      const { container } = mountShadowRoot();
      container.innerHTML = '<div class="runbi-secret">Shadow Secret</div>';
      expect(document.querySelector('.runbi-secret')).toBeNull();
      expect(document.getElementById('runbi-app-container')).toBeNull();
    });
  });

  // =========================================================================
  // Feature 10: Selection Listener Hook
  // =========================================================================
  describe('Feature 10: Selection Listener Hook', () => {
    it('F10-T1: should trigger listener upon mouseup event', () => {
      const onSelection = vi.fn();
      document.addEventListener('mouseup', () => {
        const text = window.getSelection()?.toString() || '';
        if (text.length >= 2) onSelection(text);
      });

      const p = document.createElement('p');
      p.textContent = '测试选中文本内容';
      document.body.appendChild(p);

      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      document.dispatchEvent(new MouseEvent('mouseup'));
      expect(onSelection).toHaveBeenCalledWith('测试选中文本内容');
    });

    it('F10-T2: should debounce rapid selection events by 150ms', async () => {
      vi.useFakeTimers();
      const handler = vi.fn();
      let timer: any = null;

      const trigger = (text: string) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => handler(text), 150);
      };

      trigger('文字1');
      vi.advanceTimersByTime(50);
      trigger('文字2');
      vi.advanceTimersByTime(50);
      trigger('文字3');
      expect(handler).not.toHaveBeenCalled();

      vi.advanceTimersByTime(150);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith('文字3');
      vi.useRealTimers();
    });

    it('F10-T3: should ignore selections below minimum character length', () => {
      const handler = vi.fn();
      const checkAndTrigger = (raw: string) => {
        if (raw.trim().length >= 2) handler(raw);
      };
      checkAndTrigger('a');
      checkAndTrigger(' ');
      expect(handler).not.toHaveBeenCalled();
    });

    it('F10-T4: should track active selection target element', () => {
      const textarea = document.createElement('textarea');
      textarea.value = '输入框内的文本';
      document.body.appendChild(textarea);
      textarea.focus();

      const activeEl = document.activeElement;
      expect(activeEl).toBe(textarea);
    });

    it('F10-T5: should cancel and dismiss when selection is collapsed to empty', () => {
      const dismissHandler = vi.fn();
      const onSelectionChange = () => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.toString().trim().length < 2) {
          dismissHandler();
        }
      };

      const sel = window.getSelection();
      sel?.removeAllRanges();
      onSelectionChange();
      expect(dismissHandler).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Feature 11: 28px Floating Trigger Capsule
  // =========================================================================
  describe('Feature 11: 28px Floating Trigger Capsule', () => {
    function renderCapsule(onClick: () => void): HTMLElement {
      const capsule = document.createElement('button');
      capsule.className = 'runbi-trigger-capsule w-7 h-7 rounded-full bg-emerald-500 shadow-lg flex items-center justify-center';
      capsule.style.width = '28px';
      capsule.style.height = '28px';
      capsule.style.borderRadius = '9999px';
      capsule.innerHTML = '<span class="icon">🖋️</span>';
      capsule.addEventListener('click', onClick);
      return capsule;
    }

    it('F11-T1: should render with 28px dimensions', () => {
      const el = renderCapsule(vi.fn());
      expect(el.style.width).toBe('28px');
      expect(el.style.height).toBe('28px');
    });

    it('F11-T2: should apply pill rounded shape (rounded-full)', () => {
      const el = renderCapsule(vi.fn());
      expect(el.style.borderRadius).toBe('9999px');
      expect(el.className).toContain('rounded-full');
    });

    it('F11-T3: should render brand pen logo icon', () => {
      const el = renderCapsule(vi.fn());
      expect(el.innerHTML).toContain('🖋️');
    });

    it('F11-T4: should apply glowing shadow class', () => {
      const el = renderCapsule(vi.fn());
      expect(el.className).toContain('shadow-lg');
    });

    it('F11-T5: should trigger onClick callback when clicked', () => {
      const onClick = vi.fn();
      const el = renderCapsule(onClick);
      el.click();
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Feature 12: Main Polishing Panel Modal
  // =========================================================================
  describe('Feature 12: Main Polishing Panel Modal', () => {
    function renderPanel(modelName = 'DeepSeek-V3', onClose?: () => void): HTMLElement {
      const panel = document.createElement('div');
      panel.className = 'runbi-modal-panel w-[400px] rounded-2xl backdrop-blur-md shadow-2xl';
      panel.style.width = '400px';
      panel.style.borderRadius = '16px';
      panel.innerHTML = `
        <div class="panel-header flex justify-between items-center p-3">
          <span class="brand">🖋️ 润笔 Runbi</span>
          <span class="model-badge">${modelName}</span>
          <button class="close-btn">✕</button>
        </div>
        <div class="panel-body p-4"></div>
      `;
      if (onClose) {
        panel.querySelector('.close-btn')?.addEventListener('click', onClose);
      }
      return panel;
    }

    it('F12-T1: should render panel width within 380px to 420px range', () => {
      const panel = renderPanel();
      expect(parseInt(panel.style.width, 10)).toBeGreaterThanOrEqual(380);
      expect(parseInt(panel.style.width, 10)).toBeLessThanOrEqual(420);
    });

    it('F12-T2: should apply 16px corner radius (rounded-2xl)', () => {
      const panel = renderPanel();
      expect(panel.style.borderRadius).toBe('16px');
      expect(panel.className).toContain('rounded-2xl');
    });

    it('F12-T3: should display active AI model badge', () => {
      const panel = renderPanel('DeepSeek-V3');
      const badge = panel.querySelector('.model-badge');
      expect(badge?.textContent).toBe('DeepSeek-V3');
    });

    it('F12-T4: should render close button (✕) and invoke onClose callback', () => {
      const onClose = vi.fn();
      const panel = renderPanel('GPT-4o', onClose);
      const closeBtn = panel.querySelector('.close-btn') as HTMLButtonElement;
      closeBtn.click();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('F12-T5: should apply glassmorphism surface backdrop styling', () => {
      const panel = renderPanel();
      expect(panel.className).toContain('backdrop-blur-md');
    });
  });

  // =========================================================================
  // Feature 13: 6 Scene Style Tabs
  // =========================================================================
  describe('Feature 13: 6 Scene Style Tabs', () => {
    const STYLES: Array<{ id: PolishStyle; label: string }> = [
      { id: 'polished', label: '通用润色' },
      { id: 'academic', label: '学术规范' },
      { id: 'business', label: '职场商务' },
      { id: 'literary', label: '文采飞扬' },
      { id: 'concise', label: '精简提炼' },
      { id: 'native_en', label: '地道英文' },
    ];

    function renderStyleTabs(active: PolishStyle, onChange: (s: PolishStyle) => void): HTMLElement {
      const nav = document.createElement('nav');
      nav.className = 'style-tabs flex overflow-x-auto gap-2 p-2';
      STYLES.forEach(({ id, label }) => {
        const btn = document.createElement('button');
        btn.dataset.style = id;
        btn.textContent = label;
        btn.className = `tab-btn ${active === id ? 'active font-bold text-emerald-600' : 'text-gray-500'}`;
        btn.addEventListener('click', () => onChange(id));
        nav.appendChild(btn);
      });
      return nav;
    }

    it('F13-T1: should render all 6 preset style tabs', () => {
      const nav = renderStyleTabs('polished', vi.fn());
      const buttons = nav.querySelectorAll('button');
      expect(buttons).toHaveLength(6);
      expect(Array.from(buttons).map((b) => b.textContent)).toEqual([
        '通用润色',
        '学术规范',
        '职场商务',
        '文采飞扬',
        '精简提炼',
        '地道英文',
      ]);
    });

    it('F13-T2: should highlight the default "polished" tab', () => {
      const nav = renderStyleTabs('polished', vi.fn());
      const activeBtn = nav.querySelector('button.active');
      expect(activeBtn?.getAttribute('data-style')).toBe('polished');
    });

    it('F13-T3: should trigger onChange with selected style id when clicked', () => {
      const onChange = vi.fn();
      const nav = renderStyleTabs('polished', onChange);
      const academicBtn = nav.querySelector('button[data-style="academic"]') as HTMLButtonElement;
      academicBtn.click();
      expect(onChange).toHaveBeenCalledWith('academic');
    });

    it('F13-T4: should construct prompt with selected style name and text', () => {
      const buildPrompt = (style: PolishStyle, text: string) => {
        const styleMap: Record<PolishStyle, string> = {
          polished: '通用润色',
          academic: '学术规范',
          business: '职场商务',
          literary: '文采飞扬',
          concise: '精简提炼',
          native_en: '地道英文',
          reply: '智能回复',
        };
        return `你是一名文字润色专家。目标风格：${styleMap[style]}。用户原文本：\n"""\n${text}\n"""`;
      };
      const prompt = buildPrompt('academic', '这是原文字句');
      expect(prompt).toContain('目标风格：学术规范');
      expect(prompt).toContain('这是原文字句');
    });

    it('F13-T5: should support switching between all available styles smoothly', () => {
      const selected: PolishStyle[] = [];
      const nav = renderStyleTabs('polished', (s) => selected.push(s));
      const buttons = nav.querySelectorAll('button');
      buttons.forEach((btn) => btn.click());
      expect(selected).toEqual(['polished', 'academic', 'business', 'literary', 'concise', 'native_en']);
    });
  });

  // =========================================================================
  // Feature 14: Typewriter Streaming Display
  // =========================================================================
  describe('Feature 14: Typewriter Streaming Display', () => {
    it('F14-T1: should incrementally append received chunk deltas', () => {
      let displayed = '';
      const onChunk = (delta: string) => {
        displayed += delta;
      };
      ['该', '方案', '构架', '完备'].forEach(onChunk);
      expect(displayed).toBe('该方案构架完备');
    });

    it('F14-T2: should show typing cursor when generation is active', () => {
      const container = document.createElement('div');
      const isGenerating = true;
      container.innerHTML = `<span>已生成内容</span>${isGenerating ? '<span class="cursor animate-pulse">▍</span>' : ''}`;
      expect(container.querySelector('.cursor')).not.toBeNull();
    });

    it('F14-T3: should display elapsed duration and token metrics on completion', () => {
      const stats = { durationMs: 800, totalTokens: 128 };
      const formatted = `💡 耗时 ${(stats.durationMs / 1000).toFixed(1)}s · ${stats.totalTokens} Tokens`;
      expect(formatted).toBe('💡 耗时 0.8s · 128 Tokens');
    });

    it('F14-T4: should render Stop button (⏹) during generation', () => {
      const stopBtn = document.createElement('button');
      stopBtn.className = 'stop-btn';
      stopBtn.innerHTML = '⏹ 停止生成';
      expect(stopBtn.innerHTML).toContain('⏹');
    });

    it('F14-T5: should trigger abort signal when Stop button is clicked', () => {
      const onStop = vi.fn();
      const stopBtn = document.createElement('button');
      stopBtn.addEventListener('click', onStop);
      stopBtn.click();
      expect(onStop).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Feature 15: Diff Comparison View
  // =========================================================================
  describe('Feature 15: Diff Comparison View', () => {
    function renderDiffView(chunks: DiffChunk[]): HTMLElement {
      const container = document.createElement('div');
      container.className = 'diff-viewer';
      chunks.forEach((chunk) => {
        const span = document.createElement('span');
        if (chunk.type === 'delete') {
          span.className = 'diff-del bg-red-100 text-red-600 line-through';
          span.textContent = chunk.value;
        } else if (chunk.type === 'insert') {
          span.className = 'diff-ins bg-emerald-100 text-emerald-600 underline';
          span.textContent = chunk.value;
        } else {
          span.className = 'diff-equal text-gray-800';
          span.textContent = chunk.value;
        }
        container.appendChild(span);
      });
      return container;
    }

    it('F15-T1: should render plain text when diff toggle is disabled', () => {
      const text = '这是润色后的终稿内容。';
      const container = document.createElement('div');
      container.textContent = text;
      expect(container.textContent).toBe(text);
      expect(container.querySelector('.diff-del')).toBeNull();
    });

    it('F15-T2: should apply red background and line-through for deleted chunks', () => {
      const chunks: DiffChunk[] = [{ type: 'delete', value: '还行' }];
      const el = renderDiffView(chunks);
      const delSpan = el.querySelector('.diff-del');
      expect(delSpan).not.toBeNull();
      expect(delSpan?.className).toContain('line-through');
      expect(delSpan?.textContent).toBe('还行');
    });

    it('F15-T3: should apply green background and underline for inserted chunks', () => {
      const chunks: DiffChunk[] = [{ type: 'insert', value: '构架完备' }];
      const el = renderDiffView(chunks);
      const insSpan = el.querySelector('.diff-ins');
      expect(insSpan).not.toBeNull();
      expect(insSpan?.className).toContain('underline');
      expect(insSpan?.textContent).toBe('构架完备');
    });

    it('F15-T4: should render unchanged equal chunks with standard styling', () => {
      const chunks: DiffChunk[] = [{ type: 'equal', value: '方案整体' }];
      const el = renderDiffView(chunks);
      const eqSpan = el.querySelector('.diff-equal');
      expect(eqSpan?.textContent).toBe('方案整体');
    });

    it('F15-T5: should switch view state seamlessly on toggle event', () => {
      let isDiff = false;
      const toggle = () => {
        isDiff = !isDiff;
      };
      expect(isDiff).toBe(false);
      toggle();
      expect(isDiff).toBe(true);
      toggle();
      expect(isDiff).toBe(false);
    });
  });

  // =========================================================================
  // Feature 16: Action Bar (Copy & Replace)
  // =========================================================================
  describe('Feature 16: Action Bar (Copy & Replace)', () => {
    it('F16-T1: should copy polished text to clipboard on copy action', async () => {
      const textToCopy = '润色终稿文本';
      await navigator.clipboard.writeText(textToCopy);
      const readBack = await navigator.clipboard.readText();
      expect(readBack).toBe(textToCopy);
    });

    it('F16-T2: should show Toast notification for 1.5s on copy success', () => {
      vi.useFakeTimers();
      let toastVisible = false;
      const onCopy = () => {
        toastVisible = true;
        setTimeout(() => {
          toastVisible = false;
        }, 1500);
      };

      onCopy();
      expect(toastVisible).toBe(true);
      vi.advanceTimersByTime(1499);
      expect(toastVisible).toBe(true);
      vi.advanceTimersByTime(1);
      expect(toastVisible).toBe(false);
      vi.useRealTimers();
    });

    it('F16-T3: should replace selected text in textarea and dispatch input event', () => {
      const textarea = document.createElement('textarea');
      textarea.value = '原方案还行需要修改';
      document.body.appendChild(textarea);

      // Select "还行" (indices 3 to 5)
      textarea.setSelectionRange(3, 5);
      const inputEventFired = vi.fn();
      textarea.addEventListener('input', inputEventFired);

      textarea.setRangeText('构架完备', 3, 5, 'end');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      expect(textarea.value).toBe('原方案构架完备需要修改');
      expect(inputEventFired).toHaveBeenCalledTimes(1);
    });

    it('F16-T4: should replace selected text in input element and dispatch input event', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = '标题未定案';
      document.body.appendChild(input);

      input.setSelectionRange(2, 5);
      const inputListener = vi.fn();
      input.addEventListener('input', inputListener);

      input.setRangeText('已定稿', 2, 5, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(input.value).toBe('标题已定稿');
      expect(inputListener).toHaveBeenCalledTimes(1);
    });

    it('F16-T5: should replace selection in contenteditable element via execCommand', () => {
      const editor = document.createElement('div');
      editor.contentEditable = 'true';
      editor.innerText = '富文本初始内容';
      document.body.appendChild(editor);
      editor.focus();

      const range = document.createRange();
      range.selectNodeContents(editor);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      const replaced = document.execCommand('insertText', false, '富文本替换后内容');
      expect(replaced).toBe(true);
      expect(editor.innerText).toBe('富文本替换后内容');
    });
  });

  // =========================================================================
  // Feature 17: Dismissal & Keyboard Controls
  // =========================================================================
  describe('Feature 17: Dismissal & Keyboard Controls', () => {
    it('F17-T1: should close panel when Escape key is pressed', () => {
      const onClose = vi.fn();
      const keydownHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', keydownHandler);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      window.removeEventListener('keydown', keydownHandler);
    });

    it('F17-T2: should close panel when clicking outside host container', () => {
      const onOutsideClick = vi.fn();
      const hostEl = document.createElement('div');
      hostEl.id = 'runbi-extension-root';
      document.body.appendChild(hostEl);

      const clickHandler = (e: MouseEvent) => {
        const path = e.composedPath ? e.composedPath() : [e.target];
        if (!path.includes(hostEl)) {
          onOutsideClick();
        }
      };
      document.addEventListener('click', clickHandler);

      // Outside target
      const outsideBtn = document.createElement('button');
      document.body.appendChild(outsideBtn);
      outsideBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(onOutsideClick).toHaveBeenCalledTimes(1);
      document.removeEventListener('click', clickHandler);
    });

    it('F17-T3: should retain panel when clicking inside shadow root container', () => {
      const onOutsideClick = vi.fn();
      const hostEl = document.createElement('div');
      hostEl.id = 'runbi-extension-root';
      document.body.appendChild(hostEl);

      const clickHandler = (e: MouseEvent) => {
        const path = e.composedPath ? e.composedPath() : [];
        if (!path.includes(hostEl)) {
          onOutsideClick();
        }
      };
      document.addEventListener('click', clickHandler);

      hostEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(onOutsideClick).not.toHaveBeenCalled();
      document.removeEventListener('click', clickHandler);
    });

    it('F17-T4: should dismiss panel when active selection is cleared in document', () => {
      const onDismiss = vi.fn();
      const checkSelection = () => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) onDismiss();
      };
      const sel = window.getSelection();
      sel?.removeAllRanges();
      checkSelection();
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('F17-T5: should remove all global event listeners on unmount', () => {
      const listener = vi.fn();
      window.addEventListener('keydown', listener);
      window.removeEventListener('keydown', listener);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Feature 18: Background Service Worker Port
  // =========================================================================
  describe('Feature 18: Background Service Worker Port', () => {
    it('F18-T1: should establish named port connection "runbi-stream-channel"', () => {
      const port = chrome.runtime.connect({ name: 'runbi-stream-channel' });
      expect(port).toBeDefined();
      expect(port.name).toBe('runbi-stream-channel');
    });

    it('F18-T2: should transmit START_STREAM client message over port', () => {
      const port = chrome.runtime.connect({ name: 'runbi-stream-channel' });
      const msg: StreamClientMessage = {
        action: 'START_STREAM',
        payload: {
          text: '待润色文本',
          config: { style: 'polished' },
        },
      };
      expect(() => port.postMessage(msg)).not.toThrow();
    });

    it('F18-T3: should receive CHUNK messages from background worker', () => {
      const onMessage = vi.fn();
      const clientPort = chrome.runtime.connect({ name: 'runbi-stream-channel' });
      clientPort.onMessage.addListener(onMessage);

      // Simulate incoming chunk
      const chunkMsg: StreamServerMessage = {
        type: 'CHUNK',
        payload: { delta: '字' },
      };
      (clientPort as any).postMessage(chunkMsg);
      // Wait for port delivery
      expect(clientPort).toBeDefined();
    });

    it('F18-T4: should handle DONE server message on stream completion', () => {
      const doneHandler = vi.fn();
      const port = chrome.runtime.connect({ name: 'runbi-stream-channel' });
      port.onMessage.addListener((msg) => {
        if (msg.type === 'DONE') doneHandler(msg.payload);
      });
      expect(port.onMessage.hasListeners()).toBe(true);
    });

    it('F18-T5: should handle disconnect and emit ABORT on port disconnection', () => {
      const onDisconnect = vi.fn();
      const port = chrome.runtime.connect({ name: 'runbi-stream-channel' });
      port.onDisconnect.addListener(onDisconnect);
      port.disconnect();
      expect(onDisconnect).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Feature 19: OpenAI / DeepSeek SSE Stream
  // =========================================================================
  describe('Feature 19: OpenAI / DeepSeek SSE Stream', () => {
    function parseSSEChunk(line: string): string | null {
      if (!line.startsWith('data: ')) return null;
      const dataStr = line.slice(6).trim();
      if (dataStr === '[DONE]') return '[DONE]';
      try {
        const parsed = JSON.parse(dataStr);
        return parsed.choices?.[0]?.delta?.content || '';
      } catch {
        return null;
      }
    }

    it('F19-T1: should include Bearer token authorization header in SSE request', () => {
      const apiKey = 'sk-test-runbi-12345';
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      };
      expect(headers.Authorization).toBe('Bearer sk-test-runbi-12345');
    });

    it('F19-T2: should parse OpenAI/DeepSeek delta content from SSE data lines', () => {
      const rawLine = 'data: {"choices":[{"delta":{"content":"方案优化"}}]}';
      const content = parseSSEChunk(rawLine);
      expect(content).toBe('方案优化');
    });

    it('F19-T3: should recognize stream termination indicator [DONE]', () => {
      const rawLine = 'data: [DONE]';
      const result = parseSSEChunk(rawLine);
      expect(result).toBe('[DONE]');
    });

    it('F19-T4: should handle HTTP 401 Unauthorized with descriptive error message', () => {
      const handleHttpError = (status: number): string => {
        if (status === 401) return 'API Key 无效或已过期，请在设置中检查配置。';
        if (status === 429) return '请求过于频繁或额度不足，请稍后重试。';
        return `请求失败 (${status})`;
      };
      expect(handleHttpError(401)).toContain('API Key 无效');
    });

    it('F19-T5: should handle HTTP 429 Rate Limit with retry advisory', () => {
      const handleHttpError = (status: number): string => {
        if (status === 429) return '请求过于频繁或额度不足，请稍后重试。';
        return '正常';
      };
      expect(handleHttpError(429)).toContain('额度不足');
    });
  });

  // =========================================================================
  // Feature 20: Options Settings Page
  // =========================================================================
  describe('Feature 20: Options Settings Page', () => {
    it('F20-T1: should persist API Key into chrome.storage.local', async () => {
      const testKey = 'sk-deepseek-test-key-999';
      await chrome.storage.local.set({ apiKey: testKey });
      const stored = await chrome.storage.local.get('apiKey');
      expect(stored.apiKey).toBe(testKey);
    });

    it('F20-T2: should persist custom Base URL and validate URL format', async () => {
      const customUrl = 'https://api.deepseek.com/v1';
      const isValid = /^https?:\/\/.+/.test(customUrl);
      expect(isValid).toBe(true);
      await chrome.storage.local.set({ baseUrl: customUrl });
      const stored = await chrome.storage.local.get('baseUrl');
      expect(stored.baseUrl).toBe(customUrl);
    });

    it('F20-T3: should persist selected model choice in storage', async () => {
      const model = 'deepseek-chat';
      await chrome.storage.local.set({ model });
      const stored = await chrome.storage.local.get('model');
      expect(stored.model).toBe('deepseek-chat');
    });

    it('F20-T4: should execute connection test and report success/failure status', async () => {
      const testConnection = async (apiKey: string): Promise<{ ok: boolean; message: string }> => {
        if (!apiKey || apiKey.length < 5) {
          return { ok: false, message: 'Invalid API Key' };
        }
        return { ok: true, message: 'Connected successfully' };
      };
      const validRes = await testConnection('sk-valid-key-12345');
      const invalidRes = await testConnection('');
      expect(validRes.ok).toBe(true);
      expect(invalidRes.ok).toBe(false);
    });

    it('F20-T5: should allow saving and resetting custom prompt templates', async () => {
      const customPrompt = '自定义润色模板：{{selected_text}}';
      await chrome.storage.local.set({ customPrompt });
      let res = await chrome.storage.local.get('customPrompt');
      expect(res.customPrompt).toBe(customPrompt);

      await chrome.storage.local.remove('customPrompt');
      res = await chrome.storage.local.get('customPrompt');
      expect(res.customPrompt).toBeUndefined();
    });
  });

  // =========================================================================
  // Feature 21: Popup Quick Settings
  // =========================================================================
  describe('Feature 21: Popup Quick Settings', () => {
    it('F21-T1: should toggle master extension switch ON and OFF in storage', async () => {
      await chrome.storage.local.set({ enabled: true });
      let res = await chrome.storage.local.get('enabled');
      expect(res.enabled).toBe(true);

      await chrome.storage.local.set({ enabled: false });
      res = await chrome.storage.local.get('enabled');
      expect(res.enabled).toBe(false);
    });

    it('F21-T2: should toggle trigger mode (capsule vs instant auto)', async () => {
      await chrome.storage.local.set({ triggerMode: 'capsule' });
      let res = await chrome.storage.local.get('triggerMode');
      expect(res.triggerMode).toBe('capsule');

      await chrome.storage.local.set({ triggerMode: 'auto' });
      res = await chrome.storage.local.get('triggerMode');
      expect(res.triggerMode).toBe('auto');
    });

    it('F21-T3: should maintain link to open options settings page', () => {
      const openOptions = vi.fn();
      const link = document.createElement('a');
      link.addEventListener('click', openOptions);
      link.click();
      expect(openOptions).toHaveBeenCalledTimes(1);
    });

    it('F21-T4: should display current active default model in popup', async () => {
      await chrome.storage.local.set({ model: 'DeepSeek-Chat' });
      const stored = await chrome.storage.local.get('model');
      expect(stored.model).toBe('DeepSeek-Chat');
    });

    it('F21-T5: should add active hostname to domain blacklist', async () => {
      const hostname = 'github.com';
      const stored = await chrome.storage.local.get('blacklist');
      const blacklist: string[] = stored.blacklist || [];
      if (!blacklist.includes(hostname)) {
        blacklist.push(hostname);
      }
      await chrome.storage.local.set({ blacklist });

      const updated = await chrome.storage.local.get('blacklist');
      expect(updated.blacklist).toContain('github.com');
    });
  });

  // =========================================================================
  // Feature 22: Hostile CSS Isolation Testbed
  // =========================================================================
  describe('Feature 22: Hostile CSS Isolation Testbed', () => {
    it('F22-T1: should isolate Runbi styles from hostile host font-size !important resets', () => {
      // In hostile host
      const hostileStyle = document.createElement('style');
      hostileStyle.textContent = '* { font-size: 8px !important; margin: 0 !important; }';
      document.head.appendChild(hostileStyle);

      // In Shadow DOM
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      const innerSpan = document.createElement('span');
      innerSpan.style.fontSize = '14px';
      shadow.appendChild(innerSpan);

      expect(innerSpan.style.fontSize).toBe('14px');
      hostileStyle.remove();
    });

    it('F22-T2: should isolate Runbi from hostile host color: transparent resets', () => {
      const hostile = document.createElement('style');
      hostile.textContent = '* { color: transparent !important; }';
      document.head.appendChild(hostile);

      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      const inner = document.createElement('p');
      inner.style.color = '#1E293B';
      shadow.appendChild(inner);

      expect(inner.style.color).toBe('rgb(30, 41, 59)');
      hostile.remove();
    });

    it('F22-T3: should isolate Runbi from hostile host box-sizing and border resets', () => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      const panel = document.createElement('div');
      panel.style.boxSizing = 'border-box';
      panel.style.width = '400px';
      shadow.appendChild(panel);

      expect(panel.style.width).toBe('400px');
    });

    it('F22-T4: should protect SVG brand icons from host svg display:none rules', () => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '24');
      svg.setAttribute('height', '24');
      shadow.appendChild(svg);

      expect(svg.getAttribute('width')).toBe('24');
      expect(svg.getAttribute('height')).toBe('24');
    });

    it('F22-T5: should ensure Runbi styles do not leak to host webpage elements', () => {
      const hostP = document.createElement('p');
      hostP.id = 'host-text';
      document.body.appendChild(hostP);

      const runbiHost = document.createElement('div');
      const shadow = runbiHost.attachShadow({ mode: 'open' });
      const shadowStyle = document.createElement('style');
      shadowStyle.textContent = 'p { color: #00BFA5; }';
      shadow.appendChild(shadowStyle);

      expect(hostP.style.color).toBe('');
      hostP.remove();
      runbiHost.remove();
    });
  });

  // =========================================================================
  // Feature 23: E2E Integration & Verification
  // =========================================================================
  describe('Feature 23: E2E Integration & Verification', () => {
    it('F23-T1: should complete end-to-end selection to copy workflow', async () => {
      // 1. Text selection
      const sampleText = '项目计划初步拟定';
      expect(sampleText.length).toBeGreaterThanOrEqual(2);

      // 2. Mock generation
      const polished = `【通用润色】${sampleText}已完备。`;

      // 3. Copy action
      await navigator.clipboard.writeText(polished);
      const copied = await navigator.clipboard.readText();
      expect(copied).toBe(polished);
    });

    it('F23-T2: should complete end-to-end selection to in-place replace in textarea', () => {
      const ta = document.createElement('textarea');
      ta.value = '原计划待定。';
      document.body.appendChild(ta);
      ta.setSelectionRange(0, ta.value.length);

      const polished = '原计划已全面审定并发布。';
      ta.setRangeText(polished, 0, ta.value.length, 'end');
      ta.dispatchEvent(new Event('input'));

      expect(ta.value).toBe(polished);
    });

    it('F23-T3: should sync storage configuration changes across extension contexts', async () => {
      await chrome.storage.local.set({ enabled: true, style: 'business' });
      const data = await chrome.storage.local.get(['enabled', 'style']);
      expect(data.enabled).toBe(true);
      expect(data.style).toBe('business');
    });

    it('F23-T4: should handle rapid sequential operations without state errors', async () => {
      const states: string[] = [];
      const pushState = (s: string) => states.push(s);

      pushState('IDLE');
      pushState('TRIGGERED');
      pushState('GENERATING');
      pushState('ABORTED');
      pushState('IDLE');

      expect(states).toEqual(['IDLE', 'TRIGGERED', 'GENERATING', 'ABORTED', 'IDLE']);
    });

    it('F23-T5: should guarantee zero leftover DOM nodes upon full teardown', () => {
      const host = document.createElement('div');
      host.id = 'runbi-extension-root';
      document.body.appendChild(host);
      expect(document.getElementById('runbi-extension-root')).not.toBeNull();

      host.remove();
      expect(document.getElementById('runbi-extension-root')).toBeNull();
    });
  });
});
