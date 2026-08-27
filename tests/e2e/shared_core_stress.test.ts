/**
 * @file tests/e2e/shared_core_stress.test.ts
 * Comprehensive Empirical Adversarial Stress Harness for Shared Core Engines:
 * 1. Multilingual CJK-Aware Myers Diff Engine (@runbi/shared/core/diff)
 * 2. Simulated Typewriter Streaming Engine (@runbi/shared/core/mockStream)
 * 3. 2D Coordinate Geometry & Viewport/Monitor Math (@runbi/shared/core/position)
 */

import { describe, it, expect } from 'vitest';
import {
  tokenizeText,
  computeDiff,
  mergeDiffChunks,
  computeDiffStats,
  reconstructOriginal,
  reconstructPolished,
  formatInlineDiff,
} from '@runbi/shared/core/diff';
import {
  generateMockStream,
  generateMockStreamMessages,
  transformPreset,
  calculateStreamMetrics,
  MOCK_POLISH_RULES,
} from '@runbi/shared/core/mockStream';
import {
  calculatePlacement,
  calculateCapsulePosition,
  calculatePanelPosition,
  clampCoordinates,
  clampToMonitorWorkArea,
  CAPSULE_DEFAULT_SIZE,
  PANEL_DEFAULT_WIDTH,
  PANEL_DEFAULT_HEIGHT,
  TOP_COLLISION_THRESHOLD,
  VIEWPORT_MARGIN,
} from '@runbi/shared/core/position';
import type { DiffChunk, PolishStyle, SelectionRect, MonitorWorkArea } from '@runbi/shared/types';

describe('EMPIRICAL CHALLENGER: Shared Core Algorithmic Stress Harness', () => {

  // =========================================================================
  // 1. STRESS SUITE: diff.ts (CJK Myers Diff Engine & Tokenizer)
  // =========================================================================
  describe('Suite 1: Myers Diff Engine Extreme Boundary & Scale Stress', () => {

    function assertDiffInvariants(original: string, polished: string, chunks: DiffChunk[]) {
      // Oracle 1: Reconstruction of original
      const reconstructedOrig = reconstructOriginal(chunks);
      expect(reconstructedOrig).toBe(original);

      // Oracle 2: Reconstruction of polished
      const reconstructedPol = reconstructPolished(chunks);
      expect(reconstructedPol).toBe(polished);

      // Oracle 3: No adjacent chunks with the same type
      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i].type).not.toBe(chunks[i + 1].type);
      }

      // Oracle 4: No empty chunk values (except when both original and polished are empty)
      if (original.length > 0 || polished.length > 0) {
        for (const chunk of chunks) {
          expect(chunk.value.length).toBeGreaterThan(0);
        }
      }

      // Oracle 5: Stats invariants
      const stats = computeDiffStats(original, polished, chunks);
      expect(stats.originalCharCount).toBe(original.length);
      expect(stats.polishedCharCount).toBe(polished.length);
      expect(stats.insertions + stats.unchanged).toBe(polished.length);
      expect(stats.deletions + stats.unchanged).toBe(original.length);
      expect(stats.changeRatio).toBeGreaterThanOrEqual(0);
      expect(stats.changeRatio).toBeLessThanOrEqual(1);
    }

    it('DIFF-STRESS-1: 10,000+ character diff with multi-site paragraph mutations', () => {
      const baseSegment = '润笔智能润色引擎基于现代化多端架构设计。The quick brown fox jumps over lazy dog! ';
      const repeatCount = 250; // ~15,250 characters
      const original = baseSegment.repeat(repeatCount);

      // Mutate 10 distinct paragraph positions across the 11k+ text
      let polished = original;
      for (let i = 0; i < 10; i++) {
        const target = baseSegment.slice(0, 20);
        const replacement = '【AI智能增强段落第' + i + '处】';
        const idx = (i * 1000) % (polished.length - 50);
        polished = polished.slice(0, idx) + replacement + polished.slice(idx + 20);
      }

      expect(original.length).toBeGreaterThan(10000);
      expect(polished.length).toBeGreaterThan(10000);

      const t0 = performance.now();
      const chunks = computeDiff(original, polished);
      const elapsed = performance.now() - t0;

      expect(elapsed).toBeLessThan(3000);
      expect(chunks.length).toBeGreaterThan(1);
      assertDiffInvariants(original, polished, chunks);
    });

    it('DIFF-STRESS-2: 50,000+ character identical strings (Fast-path linear complexity check)', () => {
      const hugeText = '润笔 2026 Runbi Pro Desktop & Extension Multiplatform Architecture. '.repeat(850);
      expect(hugeText.length).toBeGreaterThan(50000);

      const t0 = performance.now();
      const chunks = computeDiff(hugeText, hugeText);
      const elapsed = performance.now() - t0;

      expect(elapsed).toBeLessThan(50); // fast path should be sub-50ms
      expect(chunks).toEqual([{ type: 'equal', value: hugeText }]);
      assertDiffInvariants(hugeText, hugeText, chunks);
    });

    it('DIFF-STRESS-3: 10,000+ character pure insertion and pure deletion', () => {
      const massiveInsert = '新增超长段落：' + '字'.repeat(12000);
      const chunksInsert = computeDiff('', massiveInsert);
      expect(chunksInsert).toEqual([{ type: 'insert', value: massiveInsert }]);
      assertDiffInvariants('', massiveInsert, chunksInsert);

      const massiveDelete = '删除超长段落：' + '删'.repeat(12000);
      const chunksDelete = computeDiff(massiveDelete, '');
      expect(chunksDelete).toEqual([{ type: 'delete', value: massiveDelete }]);
      assertDiffInvariants(massiveDelete, '', chunksDelete);
    });

    it('DIFF-STRESS-4: Complex Unicode graphemes, ZWJ sequences, skin tones, rare CJK, and surrogate pairs', () => {
      const orig = [
        '👨‍👩‍👧‍👦 家庭组合',
        '👩‍💻 程序员女性',
        '👍🏽 👍🏿 肤色修饰符',
        '🇨🇳 🇯🇵 🇺🇸 国旗序列',
        '𠮷野家 𪚥 罕见超大字库CJK扩展B/G字',
        '#️⃣ 1️⃣ 键帽符号序列',
        'A\u0301\u0302\u0303 复合重音组合字符',
        'اللغة العربية RTL 混排',
        'עִבְרִית 希伯来语',
      ].join('\n');

      const pol = [
        '👨‍👩‍👦‍👦 新家庭组合 (已变更)',
        '👩‍💻 顶级全栈程序员女性 ✨',
        '👍🏻 👍🏿 肤色修饰符更新',
        '🇨🇳 🇺🇸 国际化协作',
        '𠮷野家 𪚥 罕见超大字库CJK扩展B/G字【权威校验】',
        '#️⃣ 2️⃣ 键帽序列升级',
        'A\u0301\u0302\u0304 复合重音微调',
        'اللغة العربية RTL 混排优化',
        'עִבְרִית 希伯来语精准润色',
      ].join('\r\n');

      const tokensOrig = tokenizeText(orig);
      const tokensPol = tokenizeText(pol);
      expect(tokensOrig.join('')).toBe(orig);
      expect(tokensPol.join('')).toBe(pol);

      const chunks = computeDiff(orig, pol);
      assertDiffInvariants(orig, pol, chunks);

      const inline = formatInlineDiff(chunks);
      expect(inline).toContain('[-');
      expect(inline).toContain('{+');
    });

    it('DIFF-STRESS-5: CRLF vs LF multiline line-ending transitions and mixed line endings', () => {
      const crlfText = 'Line 1\r\nLine 2\r\nLine 3\r\nLine 4\r\n';
      const lfText = 'Line 1\nLine 2 (edited)\nLine 3\nLine 4\nLine 5\n';
      const mixedText = 'Line 1\r\nLine 2\rLine 3\nLine 4';

      const chunks1 = computeDiff(crlfText, lfText);
      assertDiffInvariants(crlfText, lfText, chunks1);

      const chunks2 = computeDiff(crlfText, mixedText);
      assertDiffInvariants(crlfText, mixedText, chunks2);

      const chunks3 = computeDiff('\r\n\r\n\r\n', '\n\n\n');
      assertDiffInvariants('\r\n\r\n\r\n', '\n\n\n', chunks3);
    });

    it('DIFF-STRESS-6: Completely disjoint strings of moderate-to-large size', () => {
      const orig = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const pol = '一二三四五六七八九十百千万亿兆京垓秭穰沟涧正载' + 'abcdefghijklmnopqrstuvwxyz';

      const chunks = computeDiff(orig, pol);
      assertDiffInvariants(orig, pol, chunks);
      expect(chunks.some(c => c.type === 'delete')).toBe(true);
      expect(chunks.some(c => c.type === 'insert')).toBe(true);
    });

    it('DIFF-STRESS-7: Property-based Random Fuzzing Oracle (50 randomized mutations)', () => {
      const alphabet = '润笔智能划词AI系统v2.0! 🚀 \n\r\t abcdefg1234567890 𠮷 👨‍👩‍👧‍👦 中文测试';

      for (let run = 0; run < 50; run++) {
        // Generate random original string
        const origLen = Math.floor(Math.random() * 80) + 1;
        let orig = '';
        for (let i = 0; i < origLen; i++) {
          orig += alphabet[Math.floor(Math.random() * alphabet.length)];
        }

        // Generate polished by applying random mutations (insert, delete, replace, swap)
        let pol = orig;
        const mutationCount = Math.floor(Math.random() * 5) + 1;
        for (let m = 0; m < mutationCount; m++) {
          const op = Math.floor(Math.random() * 4);
          const pos = Math.floor(Math.random() * Math.max(1, pol.length));
          if (op === 0 && pol.length > 0) {
            // delete
            pol = pol.slice(0, pos) + pol.slice(pos + 1);
          } else if (op === 1) {
            // insert
            const ins = alphabet[Math.floor(Math.random() * alphabet.length)];
            pol = pol.slice(0, pos) + ins + pol.slice(pos);
          } else if (op === 2 && pol.length > 0) {
            // replace
            const rep = alphabet[Math.floor(Math.random() * alphabet.length)];
            pol = pol.slice(0, pos) + rep + pol.slice(pos + 1);
          } else {
            // prefix or suffix
            pol = '【前缀】' + pol + '【后缀】';
          }
        }

        const chunks = computeDiff(orig, pol);
        assertDiffInvariants(orig, pol, chunks);
      }
    });

    it('DIFF-STRESS-8: mergeDiffChunks and computeDiffStats resilience on extreme inputs', () => {
      // Empty input array
      expect(mergeDiffChunks([])).toEqual([]);

      // Array with empty value chunks
      const dirtyChunks: DiffChunk[] = [
        { type: 'equal', value: '' },
        { type: 'delete', value: 'a' },
        { type: 'delete', value: 'b' },
        { type: 'insert', value: '' },
        { type: 'insert', value: 'c' },
        { type: 'insert', value: 'd' },
        { type: 'equal', value: '' },
      ];
      expect(mergeDiffChunks(dirtyChunks)).toEqual([
        { type: 'delete', value: 'ab' },
        { type: 'insert', value: 'cd' },
      ]);

      // All types with identical content stats
      const stats = computeDiffStats('', '');
      expect(stats.changeRatio).toBe(0);
      expect(stats.insertions).toBe(0);
      expect(stats.deletions).toBe(0);
      expect(stats.unchanged).toBe(0);
    });

    it('DIFF-STRESS-9: Control characters, BiDi overrides, zero-width joiners, non-BMP astral characters', () => {
      const complexOriginal = [
        '\u0000\u0001\u0002 Null & Control',
        '\u202E Reverse BiDi Override \u202C',
        '\u200D\u200D Isolated ZWJ',
        '\uFEFF Byte Order Mark',
        '\u{20BB7}\u{2A700}\u{2B740} Astral CJK Blocks',
      ].join('\n');

      const complexPolished = [
        '\u0000\u0001\u0002 Null & Control [Cleaned]',
        '\u202D Left-To-Right Override \u202C',
        '\u200D\u200C Joined & Separated',
        '\uFEFF Normalized BOM',
        '\u{20BB7}\u{2A700}\u{2B740} Astral CJK Blocks [Verified]',
      ].join('\n');

      const chunks = computeDiff(complexOriginal, complexPolished);
      assertDiffInvariants(complexOriginal, complexPolished, chunks);
    });

    it('DIFF-STRESS-10: Punctuation barrage and symbolic sequence transformations', () => {
      const punctOrig = '!@#$%^&*()_+{}|:"<>?~`-=[]\\;\',./'.repeat(20);
      const punctPol = '!@#$%^&*(NEW)_+{}|:"<>?~`-=[]\\;\',./[UPDATED]'.repeat(20);

      const chunks = computeDiff(punctOrig, punctPol);
      assertDiffInvariants(punctOrig, punctPol, chunks);
    });

    it('DIFF-STRESS-11: 1-char to 500-char expansion and 500-char to 1-char collapse', () => {
      const singleChar = '原';
      const fiveHundredChars = '长段落扩展'.repeat(100); // 500 chars

      // Expansion
      const t0 = performance.now();
      const chunksExpand = computeDiff(singleChar, fiveHundredChars);
      const elapsedExpand = performance.now() - t0;
      expect(elapsedExpand).toBeLessThan(1000);
      assertDiffInvariants(singleChar, fiveHundredChars, chunksExpand);

      // Collapse
      const t1 = performance.now();
      const chunksCollapse = computeDiff(fiveHundredChars, singleChar);
      const elapsedCollapse = performance.now() - t1;
      expect(elapsedCollapse).toBeLessThan(1000);
      assertDiffInvariants(fiveHundredChars, singleChar, chunksCollapse);
    });
  });

  // =========================================================================
  // 2. STRESS SUITE: mockStream.ts (Typewriter Streaming & Concurrency)
  // =========================================================================
  describe('Suite 2: Simulated Stream Generator Concurrency & Abort Stress', () => {

    it('STM-STRESS-1: Pre-aborted signal terminates immediately without emitting chunks', async () => {
      const abortCtrl = new AbortController();
      abortCtrl.abort(); // Pre-aborted

      const generator = generateMockStreamMessages('测试预先中止', 'academic', abortCtrl.signal, {
        minDelay: 10,
        maxDelay: 20,
      });

      const messages = [];
      for await (const msg of generator) {
        messages.push(msg);
      }

      expect(messages).toEqual([{ type: 'ABORTED' }]);
    });

    it('STM-STRESS-2: Rapid mid-stream abort cleanly cancels in-flight timer without hanging', async () => {
      const abortCtrl = new AbortController();
      const generator = generateMockStreamMessages(
        '超长文本用于测试生成过程中突发中止的情况，确保定时器被清除且无悬挂Promise。'.repeat(5),
        'business',
        abortCtrl.signal,
        { minDelay: 40, maxDelay: 80 }
      );

      const received: any[] = [];
      const iteratePromise = (async () => {
        for await (const msg of generator) {
          received.push(msg);
          if (received.length === 2) {
            abortCtrl.abort(); // Abort after 2 chunks
          }
        }
      })();

      const t0 = performance.now();
      await iteratePromise;
      const elapsed = performance.now() - t0;

      expect(elapsed).toBeLessThan(500); // Must resolve rapidly, not wait for all text
      expect(received.length).toBeGreaterThanOrEqual(2);
      const lastMsg = received[received.length - 1];
      expect(lastMsg.type).toBe('ABORTED');
    });

    it('STM-STRESS-3: High-concurrency stress: 50 simultaneous streams with random aborts', async () => {
      const streamCount = 50;
      const tasks = Array.from({ length: streamCount }, async (_, i) => {
        const abortCtrl = new AbortController();
        const shouldAbort = i % 2 === 0;
        const abortDelay = Math.floor(Math.random() * 20) + 5;

        if (shouldAbort) {
          setTimeout(() => abortCtrl.abort(), abortDelay);
        }

        const msgs: any[] = [];
        const gen = generateMockStreamMessages(
          `并发流 #${i} 压力测试内容，验证高并发异步迭代稳定性。`,
          i % 2 === 0 ? 'concise' : 'native_en',
          abortCtrl.signal,
          { minDelay: 1, maxDelay: 3 }
        );

        for await (const msg of gen) {
          msgs.push(msg);
        }

        return { index: i, shouldAbort, msgs };
      });

      const results = await Promise.all(tasks);
      expect(results.length).toBe(streamCount);

      for (const res of results) {
        expect(res.msgs.length).toBeGreaterThan(0);
        const lastMsg = res.msgs[res.msgs.length - 1];
        if (res.shouldAbort) {
          expect(['ABORTED', 'DONE']).toContain(lastMsg.type);
        } else {
          expect(lastMsg.type).toBe('DONE');
          expect(lastMsg.payload.totalTokens).toBeGreaterThan(0);
        }
      }
    });

    it('STM-STRESS-4: Zero-delay ultra-high-speed mode (minDelay: 0, maxDelay: 0)', async () => {
      const text = '零延迟极速测试：' + '文本'.repeat(100);
      const gen = generateMockStream(text, 'polished', undefined, {
        minDelay: 0,
        maxDelay: 0,
        minChunk: 10,
        maxChunk: 20,
      });

      let full = '';
      let resultStats: any = null;
      while (true) {
        const item = await gen.next();
        if (item.done) {
          resultStats = item.value;
          break;
        }
        full += item.value;
      }

      expect(full).toBe(transformPreset(text, 'polished'));
      expect(resultStats.tokenCount).toBeGreaterThan(0);
      expect(resultStats.durationMs).toBeGreaterThanOrEqual(1);
    });

    it('STM-STRESS-5: Edge-case inputs: empty string, whitespace only, custom userInstruction with escape chars', async () => {
      // 1. Empty string with concise style
      const conciseEmpty = transformPreset('', 'concise');
      expect(conciseEmpty).toBe('');

      // 2. Custom instruction with quotes, HTML tags, and backslashes
      const customInstr = '把文本"转为"<b>HTML</b>格式 & 特殊字符 \\n \\t';
      const customOut = transformPreset('原始文本', 'polished', customInstr);
      expect(customOut).toContain(customInstr.trim());
      expect(customOut).toContain('原始文本');

      // 3. calculateStreamMetrics with extreme values (zero time, huge time, negative time)
      const metricsZero = calculateStreamMetrics(100, 10, 0);
      expect(metricsZero.durationMs).toBe(0);
      expect(metricsZero.charsPerSecond).toBeGreaterThan(0);
      expect(Number.isFinite(metricsZero.charsPerSecond)).toBe(true);

      const metricsHuge = calculateStreamMetrics(50000, 5000, 1000000);
      expect(metricsHuge.charsPerSecond).toBeCloseTo(50, 0);
    });
    it('STM-STRESS-6: Generator cleanup and early consumer exit (for-await break)', async () => {
      const gen = generateMockStreamMessages('测试提早跳出循环与清理机制', 'polished', undefined, {
        minDelay: 10,
        maxDelay: 20,
      });

      let count = 0;
      for await (const msg of gen) {
        count++;
        if (count === 2) break; // Break out early
      }
      expect(count).toBe(2);
    });

    it('STM-STRESS-7: Calling .next() after completion or abortion returns done: true', async () => {
      const abortCtrl = new AbortController();
      abortCtrl.abort();
      const gen = generateMockStreamMessages('短测试', 'concise', abortCtrl.signal);

      const first = await gen.next();
      expect(first.value).toEqual({ type: 'ABORTED' });
      expect(first.done).toBe(false);

      const second = await gen.next();
      expect(second.done).toBe(true);

      const third = await gen.next();
      expect(third.done).toBe(true);
    });

    it('STM-STRESS-8: Style transform presets with arbitrary non-standard styles fallback gracefully', () => {
      const fallback = transformPreset('未知风格测试', 'non_existent_style_xyz');
      expect(fallback).toContain('未知风格测试');
      expect(fallback).toContain('经过润色与调整后');
    });
  });

  // =========================================================================
  // 3. STRESS SUITE: position.ts (2D Geometry & Multi-Monitor Math)
  // =========================================================================
  describe('Suite 3: 2D Geometry Placement & Multi-Monitor Work Area Stress', () => {

    it('POS-STRESS-1: Multi-Monitor secondary display to the LEFT (negative coordinates: x = -1920..0)', () => {
      const leftMonitor: MonitorWorkArea = {
        x: -1920,
        y: 0,
        width: 1920,
        height: 1080,
      };

      // Case A: Cursor in middle of left monitor (-960, 540)
      const posA = clampToMonitorWorkArea(-960, 540, 400, 360, leftMonitor, 10);
      expect(posA.x).toBe(-960);
      expect(posA.y).toBe(540);

      // Case B: Cursor at left boundary (-1920) -> clamped to -1920 + 10 = -1910
      const posB = clampToMonitorWorkArea(-2000, 500, 400, 360, leftMonitor, 10);
      expect(posB.x).toBe(-1910);

      // Case C: Cursor near right edge of left monitor (-100) -> clamped to -1920 + 1920 - 400 - 10 = -410
      const posC = clampToMonitorWorkArea(0, 500, 400, 360, leftMonitor, 10);
      expect(posC.x).toBe(-410);
    });

    it('POS-STRESS-2: Multi-Monitor secondary display on TOP (negative coordinates: y = -1080..0)', () => {
      const topMonitor: MonitorWorkArea = {
        x: 0,
        y: -1080,
        width: 1920,
        height: 1080,
      };

      // Case A: Cursor near top boundary (-1080) -> clamped to -1080 + 10 = -1070
      const posTop = clampToMonitorWorkArea(500, -1100, 400, 360, topMonitor, 10);
      expect(posTop.y).toBe(-1070);

      // Case B: Cursor near bottom edge of top monitor (-50) -> clamped to -1080 + 1080 - 360 - 10 = -370
      const posBottom = clampToMonitorWorkArea(500, 0, 400, 360, topMonitor, 10);
      expect(posBottom.y).toBe(-370);
    });

    it('POS-STRESS-3: Diagonal 4K Multi-Monitor setup with negative coordinates (x = -3840, y = -2160)', () => {
      const diag4KMonitor: MonitorWorkArea = {
        x: -3840,
        y: -2160,
        width: 3840,
        height: 2160,
        scaleFactor: 1.5,
      };

      const clamped = clampToMonitorWorkArea(-4000, -2500, 500, 400, diag4KMonitor, 20);
      expect(clamped.x).toBe(-3840 + 20); // -3820
      expect(clamped.y).toBe(-2160 + 20); // -2140

      const clampedMax = clampToMonitorWorkArea(1000, 1000, 500, 400, diag4KMonitor, 20);
      expect(clampedMax.x).toBe(-3840 + 3840 - 500 - 20); // -520
      expect(clampedMax.y).toBe(-2160 + 2160 - 400 - 20); // -420
    });

    it('POS-STRESS-4: Window dimensions larger than Monitor Work Area (Degraded fallback)', () => {
      const tinyMonitor: MonitorWorkArea = {
        x: 100,
        y: 100,
        width: 200,
        height: 200,
      };
      // Window is 400x360, larger than 200x200 monitor
      const pos = clampToMonitorWorkArea(150, 150, 400, 360, tinyMonitor, 10);
      expect(pos.x).toBe(110); // minX = 100 + 10 = 110
      expect(pos.y).toBe(110); // minY = 100 + 10 = 110
    });

    it('POS-STRESS-5: calculatePanelPosition and calculateCapsulePosition with massive scroll & off-screen rects', () => {
      const offscreenRect: SelectionRect = {
        top: -1000,
        bottom: -980,
        left: -500,
        right: -300,
      };

      // Massive scroll offsets
      const posPanel = calculatePanelPosition(offscreenRect, {
        windowWidth: 1920,
        windowHeight: 1080,
        scrollX: 5000,
        scrollY: 10000,
        panelWidth: 400,
        panelHeight: 360,
      });

      expect(Number.isFinite(posPanel.top)).toBe(true);
      expect(Number.isFinite(posPanel.left)).toBe(true);
      expect(posPanel.left).toBeGreaterThanOrEqual(5000); // clamped to scrollX + margin

      const posCapsule = calculateCapsulePosition(offscreenRect, {
        windowWidth: 1920,
        windowHeight: 1080,
        scrollX: 5000,
        scrollY: 10000,
      });

      expect(Number.isFinite(posCapsule.top)).toBe(true);
      expect(Number.isFinite(posCapsule.left)).toBe(true);
    });

    it('POS-STRESS-6: clampCoordinates boundary safety under inverted / partial bounds', () => {
      const raw = { top: 500, left: 500, placement: 'top-right' as const };

      // Normal bounds
      const c1 = clampCoordinates(raw, { minTop: 100, maxTop: 400, minLeft: 100, maxLeft: 400 });
      expect(c1.top).toBe(400);
      expect(c1.left).toBe(400);

      // Undefined bounds
      const c2 = clampCoordinates(raw, undefined);
      expect(c2.top).toBe(500);
      expect(c2.left).toBe(500);

      // Negative min bounds
      const rawNeg = { top: -200, left: -300, placement: 'bottom-left' as const };
      const c3 = clampCoordinates(rawNeg, { minTop: -500, minLeft: -500, maxTop: 0, maxLeft: 0 });
      expect(c3.top).toBe(-200);
      expect(c3.left).toBe(-300);
    });

    it('POS-STRESS-7: Triple-monitor setup and zero-size selection rects', () => {
      const primary: MonitorWorkArea = { x: 0, y: 0, width: 1920, height: 1080 };
      const left: MonitorWorkArea = { x: -1920, y: 0, width: 1920, height: 1080 };
      const right: MonitorWorkArea = { x: 1920, y: 0, width: 2560, height: 1440 };

      // Zero-size selection rect (e.g. single point cursor click)
      const pointRect: SelectionRect = { top: 500, bottom: 500, left: 600, right: 600 };
      const capsule = calculateCapsulePosition(pointRect, { viewport: { width: 1920, height: 1080 } });
      expect(capsule.top).toBe(500 - CAPSULE_DEFAULT_SIZE - VIEWPORT_MARGIN);
      expect(capsule.left).toBe(600 + 4);

      // Clamping across all 3 monitors
      const clampLeft = clampToMonitorWorkArea(-1500, 300, 400, 360, left);
      expect(clampLeft.x).toBe(-1500);

      const clampPrimary = clampToMonitorWorkArea(500, 300, 400, 360, primary);
      expect(clampPrimary.x).toBe(500);

      const clampRight = clampToMonitorWorkArea(2200, 300, 400, 360, right);
      expect(clampRight.x).toBe(2200);
    });

    it('POS-STRESS-8: Quadruple 2x2 multi-monitor coordinate matrix', () => {
      const gridMonitors: Record<string, MonitorWorkArea> = {
        topLeft: { x: -1920, y: -1080, width: 1920, height: 1080 },
        topRight: { x: 0, y: -1080, width: 1920, height: 1080 },
        bottomLeft: { x: -1920, y: 0, width: 1920, height: 1080 },
        bottomRight: { x: 0, y: 0, width: 1920, height: 1080 },
      };

      for (const [name, area] of Object.entries(gridMonitors)) {
        const midX = area.x + area.width / 2;
        const midY = area.y + area.height / 2;
        const res = clampToMonitorWorkArea(midX, midY, 400, 360, area, 10);
        expect(res.x).toBe(midX);
        expect(res.y).toBe(midY);
      }
    });

    it('POS-STRESS-9: Extreme floating-point subpixel coordinates and precision preservation', () => {
      const subpixelRect: SelectionRect = {
        top: 100.123456789,
        bottom: 120.987654321,
        left: 200.555555555,
        right: 350.777777777,
      };

      const result = calculateCapsulePosition(subpixelRect, {
        viewport: { width: 1920.333, height: 1080.666, scrollX: 10.125, scrollY: 20.875 },
      });

      expect(Number.isFinite(result.top)).toBe(true);
      expect(Number.isFinite(result.left)).toBe(true);
      expect(result.top).toBeCloseTo(100.123456789 + 20.875 - 28 - 8, 4);
      expect(result.left).toBeCloseTo(350.777777777 + 10.125 + 4, 4);
    });

    it('POS-STRESS-10: Inverted SelectionRect (bottom < top, right < left) stability', () => {
      const invertedRect: SelectionRect = {
        top: 300,
        bottom: 200,
        left: 400,
        right: 200,
      };

      const pos = calculateCapsulePosition(invertedRect, {
        viewport: { width: 1920, height: 1080, scrollX: 0, scrollY: 0 },
      });

      expect(Number.isFinite(pos.top)).toBe(true);
      expect(Number.isFinite(pos.left)).toBe(true);
      expect(isNaN(pos.top)).toBe(false);
      expect(isNaN(pos.left)).toBe(false);
    });
  });
});
