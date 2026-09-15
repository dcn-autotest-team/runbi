/**
 * @file tests/unit/advanced-settings.test.tsx
 * Unit Tests for Desktop AdvancedSettings Component
 * （个人词库 / 文风标杆样本 / 本地模型零配置探测）
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { AppSettings } from '@runbi/shared/types';
import { AdvancedSettings } from '../../desktop/src/components/AdvancedSettings';

/** React 18 受控输入需要走原生 value setter 再派发 input 事件。 */
const setInputValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

const setSelectValue = (el: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

const findButton = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text));

describe('Desktop AdvancedSettings Component', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null = null;

  const renderComponent = async (props: { settings?: AppSettings; onPatch: (patch: Partial<AppSettings>) => void }) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<AdvancedSettings settings={props.settings ?? {}} onPatch={props.onPatch} />);
    });
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    document.body.innerHTML = '';
  });

  it('adds a replace rule and emits the filled glossary via onPatch', async () => {
    const onPatch = vi.fn((_patch: Partial<AppSettings>) => undefined);
    await renderComponent({ onPatch });

    // 初始无规则 → 点击添加，出现一行术语映射（kind 默认 replace）
    const addBtn = findButton(container, '添加规则');
    expect(addBtn).toBeDefined();
    await act(async () => {
      addBtn!.click();
    });

    const fromInput = container.querySelector<HTMLInputElement>('input[placeholder*="原词"]');
    const toInput = container.querySelector<HTMLInputElement>('input[placeholder*="目标词"]');
    expect(fromInput).toBeTruthy();
    expect(toInput).toBeTruthy();

    await act(async () => {
      setInputValue(fromInput!, 'DCN');
    });
    await act(async () => {
      setInputValue(toInput!, '数据中心网络');
    });

    const glossaryPatches = onPatch.mock.calls.map((c) => c[0] as Partial<AppSettings>).filter((p) => 'glossary' in p);
    const lastGlossary = glossaryPatches[glossaryPatches.length - 1]!.glossary!;
    expect(lastGlossary).toHaveLength(1);
    expect(lastGlossary[0]).toMatchObject({ kind: 'replace', from: 'DCN', to: '数据中心网络' });
    expect(lastGlossary[0]!.id).toBeTruthy();

    // kind 切换为 keep 后，目标词输入框隐藏且 kind 更新
    const kindSelect = container.querySelector<HTMLSelectElement>('select[aria-label^="规则类型"]');
    await act(async () => {
      setSelectValue(kindSelect!, 'keep');
    });
    expect(container.querySelector('input[placeholder*="目标词"]')).toBeNull();
    const lastKeep = (onPatch.mock.calls.at(-1)![0] as Partial<AppSettings>).glossary!;
    expect(lastKeep[0]).toMatchObject({ kind: 'keep', from: 'DCN' });
  });

  it('emits styleSamples on edit and filters empty segments', async () => {
    const onPatch = vi.fn((_patch: Partial<AppSettings>) => undefined);
    await renderComponent({ onPatch });

    // 默认显示 1 个 textarea
    const textareas = container.querySelectorAll('textarea');
    expect(textareas).toHaveLength(1);

    const first = textareas[0]!;
    await act(async () => {
      setInputValue(first, '  这是我本人写的一段最满意的微信消息。 ');
    });
    const stylePatches = onPatch.mock.calls.map((c) => c[0] as Partial<AppSettings>).filter((p) => 'styleSamples' in p);
    expect(stylePatches.at(-1)!.styleSamples).toEqual(['这是我本人写的一段最满意的微信消息。']);

    // 添加第二个空样本段 → 空段被过滤，只保留已填写的段
    const addSample = findButton(container, '添加样本');
    expect(addSample).toBeDefined();
    await act(async () => {
      addSample!.click();
    });
    expect(container.querySelectorAll('textarea')).toHaveLength(2);

    const second = container.querySelectorAll('textarea')[1]!;
    await act(async () => {
      setInputValue(second, '随便敲几个字');
    });
    const last = (onPatch.mock.calls.at(-1)![0] as Partial<AppSettings>).styleSamples!;
    expect(last).toEqual(['这是我本人写的一段最满意的微信消息。', '随便敲几个字']);

    // 样本最多 3 段：加到 3 后"添加样本"按钮消失
    const addAgain = findButton(container, '添加样本');
    await act(async () => {
      addAgain!.click();
    });
    expect(container.querySelectorAll('textarea')).toHaveLength(3);
    expect(findButton(container, '添加样本')).toBeUndefined();
  });

  it('probes local models on mount and applies the picked model via onPatch', async () => {
    // Ollama /api/tags 形状；LM Studio 目标解析 data 字段为空，自动过滤
    const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => ({
      ok: true,
      json: async () => ({ models: [{ name: 'qwen2.5:7b' }, { name: 'llama3.1:8b' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const onPatch = vi.fn((_patch: Partial<AppSettings>) => undefined);
    await renderComponent({ onPatch });
    await act(async () => {}); // 等探测 promise 链落定

    // 探测端点被调用（Ollama 11434 与 LM Studio 1234）
    const calledUrls = fetchMock.mock.calls.map((c) => c[0]);
    expect(calledUrls).toContain('http://localhost:11434/api/tags');
    expect(calledUrls).toContain('http://localhost:1234/v1/models');

    expect(container.textContent).toContain('Ollama (本地) 已就绪 · 2 个模型');
    expect(container.textContent).not.toContain('未发现本地模型');

    // 模型下拉默认选中第一个模型，一键使用回调带 provider/baseUrl/model
    const modelSelect = container.querySelector<HTMLSelectElement>('select[aria-label*="模型选择"]');
    expect(modelSelect).toBeTruthy();
    expect(modelSelect!.value).toBe('qwen2.5:7b');
    await act(async () => {
      setSelectValue(modelSelect!, 'llama3.1:8b');
    });

    const useBtn = findButton(container, '一键使用');
    expect(useBtn).toBeDefined();
    await act(async () => {
      useBtn!.click();
    });
    expect(onPatch).toHaveBeenLastCalledWith({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1:8b',
    });
  });

  it('shows the offline hint when no local model responds', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetchMock);

    const onPatch = vi.fn((_patch: Partial<AppSettings>) => undefined);
    await renderComponent({ onPatch });
    await act(async () => {});

    expect(container.textContent).toContain('未发现本地模型');
    expect(container.textContent).toContain('数据 100% 离线');
    expect(findButton(container, '一键使用')).toBeUndefined();
  });
});

describe('AdvancedSettings SenseAudio model picker', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null = null;

  const renderComponent = async (props: { settings?: AppSettings; onPatch: (patch: Partial<AppSettings>) => void }) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<AdvancedSettings settings={props.settings ?? {}} onPatch={props.onPatch} />);
    });
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    document.body.innerHTML = '';
  });

  it('fetches models, auto-picks the first and applies selection via onPatch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => ({ object: 'list', data: [{ id: 'senseaudio-s2' }, { id: 'senseaudio-vl' }] }) }) as unknown as Response
    ));
    const onPatch = vi.fn((_patch: Partial<AppSettings>) => undefined);
    await renderComponent({ settings: { apiKey: 'sk-test' }, onPatch });

    const fetchBtn = findButton(container, '获取模型列表');
    expect(fetchBtn).toBeDefined();
    await act(async () => {
      fetchBtn!.click();
    });
    const select = container.querySelector('select[aria-label="SenseAudio 模型选择"]') as HTMLSelectElement;
    expect(select).toBeDefined();
    expect(select.options.length).toBe(2);
    // 自动选取默认模型：默认选中第一个
    expect(select.value).toBe('senseaudio-s2');

    await act(async () => {
      findButton(container, '一键使用')!.click();
    });
    expect(onPatch).toHaveBeenCalledWith({
      baseUrl: 'https://api.senseaudio.cn/v1/chat/completions',
      model: 'senseaudio-s2',
    });
  });

  it('shows the failure path with the HTTP error the user sees', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      ({ ok: false, status: 401, statusText: 'Unauthorized' } as unknown as Response)
    ));
    const onPatch = vi.fn((_patch: Partial<AppSettings>) => undefined);
    await renderComponent({ settings: { apiKey: 'bad' }, onPatch });

    await act(async () => {
      findButton(container, '获取模型列表')!.click();
    });
    const alert = container.querySelector('p[role="alert"]');
    expect(alert?.textContent).toContain('HTTP 401');
    expect(container.querySelector('select[aria-label="SenseAudio 模型选择"]')).toBeNull();
  });
});
