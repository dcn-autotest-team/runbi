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

  it('does not render or probe removed model sections', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await renderComponent({ onPatch: vi.fn() });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('SenseAudio');
    expect(container.textContent).not.toContain('本地模型');
  });
});
