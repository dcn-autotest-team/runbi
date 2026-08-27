/**
 * Built-in Zero-Config Mock Streaming Generator
 * Part of Runbi Chrome Extension (Manifest V3)
 */

import type { PolishStyle, StreamServerMessage } from '../types/stream';

export const MOCK_POLISH_RULES: Record<PolishStyle, (text: string) => string> = {
  polished: (t: string) => `经过润色与调整后，${t}在逻辑连贯性与表达精度上得到了显著提升。`,
  academic: (t: string) => `综上所述，本研究针对“${t}”之核心论题进行了系统性阐发，论证严谨，符合学术规范。`,
  business: (t: string) => `您好！关于“${t}”，我们已完成评估并制定了推进计划，请审阅。`,
  literary: (t: string) => `字里行间，笔墨生香；“${t}”如春水拂堤，韵味悠长。`,
  concise: (t: string) => (t.length > 10 ? t.slice(0, Math.floor(t.length * 0.6)) + '（精炼提炼）' : t),
  native_en: (t: string) => `Regarding "${t}", this refined proposal effectively enhances conceptual clarity and stylistic elegance.`,
  reply: (t: string) => `关于您提及的“${t}”，我们已收到并仔细评估。非常感谢您的反馈与沟通，后续我们将按照既定方向跟进落实。`,
};

export interface MockStreamOptions {
  minDelay?: number;
  maxDelay?: number;
  minChunk?: number;
  maxChunk?: number;
  userInstruction?: string;
}

/**
 * Transforms text using the specified preset style transformation rule or custom user instruction.
 */
export function transformPreset(text: string, style: PolishStyle | string, userInstruction?: string): string {
  if (userInstruction && userInstruction.trim()) {
    return `针对您的要求“${userInstruction.trim()}”，就“${text}”回复如下：非常感谢您的意见与沟通，我们已按该要求全面完善落实。`;
  }
  const rule = (MOCK_POLISH_RULES as Record<string, (t: string) => string>)[style] || MOCK_POLISH_RULES.polished;
  return rule(text);
}

/**
 * Raw chunk async generator with realistic human typing cadence (20-45ms jitter, 1-3 chars/chunk).
 * Yields chunk delta strings and returns final duration and token count statistics.
 */
export async function* generateMockStream(
  text: string,
  style: PolishStyle | string,
  signal?: AbortSignal,
  options?: MockStreamOptions
): AsyncGenerator<string, { durationMs: number; tokenCount: number }, void> {
  const fullResult = transformPreset(text, style, options?.userInstruction);
  const startTime = Date.now();

  const minDelay = options?.minDelay ?? 20;
  const maxDelay = options?.maxDelay ?? 45;
  const minChunk = options?.minChunk ?? 1;
  const maxChunk = options?.maxChunk ?? 3;

  let tokenCount = 0;
  let idx = 0;

  while (idx < fullResult.length) {
    if (signal?.aborted) {
      return {
        durationMs: Math.max(1, Date.now() - startTime),
        tokenCount,
      };
    }

    const chunkSize = Math.floor(Math.random() * (maxChunk - minChunk + 1)) + minChunk;
    const chunk = fullResult.slice(idx, idx + chunkSize);
    idx += chunkSize;
    tokenCount += 1;

    yield chunk;

    if (idx < fullResult.length) {
      const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
      if (delay > 0) {
        await new Promise<void>((resolve) => {
          const timeoutId = setTimeout(resolve, delay);
          if (signal) {
            const onAbort = () => {
              clearTimeout(timeoutId);
              signal.removeEventListener('abort', onAbort);
              resolve();
            };
            signal.addEventListener('abort', onAbort, { once: true });
          }
        });
      }
    }
  }

  return {
    durationMs: Math.max(1, Date.now() - startTime),
    tokenCount,
  };
}

/**
 * StreamServerMessage async generator wrapping generateMockStream.
 * Yields CHUNK, DONE, and ABORTED messages conforming to StreamServerMessage interface.
 */
export async function* generateMockStreamMessages(
  text: string,
  style: PolishStyle | string,
  signal?: AbortSignal,
  options?: MockStreamOptions
): AsyncGenerator<StreamServerMessage, void, void> {
  if (signal?.aborted) {
    yield { type: 'ABORTED' };
    return;
  }

  const rawStream = generateMockStream(text, style, signal, options);
  let doneResult: { durationMs: number; tokenCount: number } | undefined;

  while (true) {
    if (signal?.aborted) {
      yield { type: 'ABORTED' };
      return;
    }

    const next = await rawStream.next();
    if (next.done) {
      doneResult = next.value;
      break;
    }

    yield {
      type: 'CHUNK',
      payload: { delta: next.value },
    };
  }

  if (signal?.aborted) {
    yield { type: 'ABORTED' };
    return;
  }

  yield {
    type: 'DONE',
    payload: {
      durationMs: doneResult?.durationMs ?? 1,
      totalTokens: doneResult?.tokenCount ?? 1,
    },
  };
}
