/**
 * Multilingual CJK-Aware Myers Diff Engine
 * Part of Runbi Chrome Extension (Manifest V3)
 */

import type { DiffChunk, DiffType } from '../types/diff';

export { DiffChunk, DiffType };

/**
 * Tokenizes text into CJK individual characters, English words/numbers,
 * whitespace sequences, and individual punctuation/emojis.
 */
export function tokenizeText(text: string): string[] {
  if (!text) return [];

  // Unicode-aware regex matching:
  // 1. CJK Ideographs / Hiragana / Katakana / Hangul: individual characters
  // 2. Emojis and surrogate pairs
  // 3. Alphanumeric words (English/Latin/Numbers): word units
  // 4. Whitespaces: contiguous whitespace sequences
  // 5. Any other character/symbol: individual characters
  const regex =
    /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]|[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|[\w]+|\s+|[^\w\s\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/gu;

  const matches = text.match(regex);
  return matches && matches.length > 0 ? matches : [text];
}

/**
 * Computes structured red/green Myers Diff chunks between originalText and polishedText.
 */
export function computeDiff(originalText: string, polishedText: string): DiffChunk[] {
  // Fast path 1: Identical strings
  if (originalText === polishedText) {
    return [{ type: 'equal', value: originalText }];
  }

  // Fast path 2: Pure insertions or deletions
  if (!originalText) {
    return [{ type: 'insert', value: polishedText }];
  }
  if (!polishedText) {
    return [{ type: 'delete', value: originalText }];
  }

  const tokensA = tokenizeText(originalText);
  const tokensB = tokenizeText(polishedText);

  // Common Prefix & Suffix optimization
  let prefixLen = 0;
  while (
    prefixLen < tokensA.length &&
    prefixLen < tokensB.length &&
    tokensA[prefixLen] === tokensB[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLenA = tokensA.length - 1;
  let suffixLenB = tokensB.length - 1;
  while (
    suffixLenA >= prefixLen &&
    suffixLenB >= prefixLen &&
    tokensA[suffixLenA] === tokensB[suffixLenB]
  ) {
    suffixLenA--;
    suffixLenB--;
  }

  const midA = tokensA.slice(prefixLen, suffixLenA + 1);
  const midB = tokensB.slice(prefixLen, suffixLenB + 1);

  const rawChunks: DiffChunk[] = [];

  // Add prefix if present
  if (prefixLen > 0) {
    rawChunks.push({
      type: 'equal',
      value: tokensA.slice(0, prefixLen).join(''),
    });
  }

  // Diff middle tokens using Myers algorithm
  if (midA.length > 0 && midB.length === 0) {
    rawChunks.push({ type: 'delete', value: midA.join('') });
  } else if (midA.length === 0 && midB.length > 0) {
    rawChunks.push({ type: 'insert', value: midB.join('') });
  } else if (midA.length > 0 && midB.length > 0) {
    const midChunks = executeMyersDiff(midA, midB);
    rawChunks.push(...midChunks);
  }

  // Add suffix if present
  if (suffixLenA < tokensA.length - 1) {
    rawChunks.push({
      type: 'equal',
      value: tokensA.slice(suffixLenA + 1).join(''),
    });
  }

  // Contiguous type merging and zero-length filtering
  return mergeDiffChunks(rawChunks);
}

/**
 * Standard Myers Diff implementation over token arrays.
 */
function executeMyersDiff(tokensA: string[], tokensB: string[]): DiffChunk[] {
  const n = tokensA.length;
  const m = tokensB.length;
  const max = n + m;
  const v: { [k: number]: number } = { 1: 0 };
  const trace: Array<{ [k: number]: number }> = [];

  for (let d = 0; d <= max; d++) {
    trace.push({ ...v });
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[k - 1] ?? -1) < (v[k + 1] ?? -1))) {
        x = v[k + 1] ?? 0;
      } else {
        x = (v[k - 1] ?? 0) + 1;
      }
      let y = x - k;

      while (x < n && y < m && tokensA[x] === tokensB[y]) {
        x++;
        y++;
      }
      v[k] = x;

      if (x >= n && y >= m) {
        return backtrackTrace(trace, tokensA, tokensB, d, k);
      }
    }
  }

  // Fallback if max depth exceeded
  return [
    { type: 'delete', value: tokensA.join('') },
    { type: 'insert', value: tokensB.join('') },
  ];
}

/**
 * Backtracks Myers trace table to reconstruct edit operations.
 */
function backtrackTrace(
  trace: Array<{ [k: number]: number }>,
  tokensA: string[],
  tokensB: string[],
  d: number,
  k: number
): DiffChunk[] {
  const chunks: DiffChunk[] = [];
  let x = tokensA.length;
  let y = tokensB.length;

  for (let step = d; step > 0; step--) {
    const v = trace[step];
    const prevK =
      k === -step || (k !== step && (v[k - 1] ?? -1) < (v[k + 1] ?? -1))
        ? k + 1
        : k - 1;
    const prevX = v[prevK] ?? 0;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      chunks.unshift({ type: 'equal', value: tokensA[x - 1] });
      x--;
      y--;
    }

    if (step > 0) {
      if (x === prevX) {
        chunks.unshift({ type: 'insert', value: tokensB[y - 1] });
        y--;
      } else if (y === prevY) {
        chunks.unshift({ type: 'delete', value: tokensA[x - 1] });
        x--;
      }
    }
    k = prevK;
  }

  while (x > 0 && y > 0) {
    chunks.unshift({ type: 'equal', value: tokensA[x - 1] });
    x--;
    y--;
  }

  return chunks;
}

/**
 * Merges adjacent chunks with the same DiffType and filters out empty values.
 */
export function mergeDiffChunks(chunks: DiffChunk[]): DiffChunk[] {
  const merged: DiffChunk[] = [];

  for (const chunk of chunks) {
    if (!chunk.value) continue;

    if (merged.length > 0 && merged[merged.length - 1].type === chunk.type) {
      merged[merged.length - 1].value += chunk.value;
    } else {
      merged.push({ ...chunk });
    }
  }

  return merged;
}
