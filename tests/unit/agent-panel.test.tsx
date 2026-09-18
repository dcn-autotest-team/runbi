/**
 * @file tests/unit/agent-panel.test.tsx
 * Autonomous Agent Panel (EVA in Rust) unit tests.
 * Verifies task execution flow, tool approval gate, and streaming output.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
let lastCreatedChannel: any = null;

vi.mock('@tauri-apps/api/core', () => {
  class MockChannel {
    onmessage: ((msg: any) => void) | null = null;
    constructor() {
      lastCreatedChannel = this;
    }
  }
  return {
    invoke: (...args: any[]) => invokeMock(...args),
    Channel: MockChannel,
  };
});

import { AgentPanel } from '../../desktop/src/components/AgentPanel';

describe('Autonomous AgentPanel', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    invokeMock.mockReset();
    lastCreatedChannel = null;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('renders initial agent panel with goal input and start button', () => {
    act(() => {
      root.render(
        <AgentPanel
          endpoint="http://localhost:8000/v1"
          apiKey="test-key"
          model="deepseek-chat"
        />
      );
    });

    expect(host.textContent).toContain('工作目录');
    expect(host.textContent).toContain('只读自动放行');
    const textarea = host.querySelector('textarea');
    expect(textarea).not.toBeNull();
    const buttons = Array.from(host.querySelectorAll('button'));
    const startBtn = buttons.find((b) => b.textContent?.includes('执行'));
    expect(startBtn).toBeDefined();
  });

  it('invokes start_agent_task when clicking start and handles tool approvals', async () => {
    let finishTask!: () => void;
    invokeMock.mockImplementation((command) => command === 'start_agent_task'
      ? new Promise<void>((resolve) => { finishTask = resolve; })
      : Promise.resolve());
    const onToast = vi.fn();

    act(() => {
      root.render(
        <AgentPanel
          endpoint="http://localhost:8000/v1"
          apiKey="test-key"
          model="deepseek-chat"
          onToast={onToast}
        />
      );
    });

    const textarea = host.querySelector('textarea')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '检查当前目录文件并统计行数');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const buttons = Array.from(host.querySelectorAll('button'));
    const startBtn = buttons.find((b) => b.textContent?.includes('执行'))!;

    await act(async () => {
      startBtn.click();
    });

    expect(invokeMock).toHaveBeenCalledWith('start_agent_task', expect.objectContaining({
      params: expect.objectContaining({
        prompt: '检查当前目录文件并统计行数',
        api_key: 'test-key',
        model: 'deepseek-chat',
      }),
    }));

    expect(lastCreatedChannel).not.toBeNull();
    expect(textarea.value).toBe('');
    expect(host.textContent).toContain('检查当前目录文件并统计行数');

    // Simulate Agent proposing a tool that requires user approval
    act(() => {
      lastCreatedChannel.onmessage({
        type: 'ToolProposed',
        payload: {
          call_id: 'call-1',
          name: 'run_cli',
          command: 'npm run build',
          requires_approval: true,
        },
      });
    });

    expect(host.textContent).toContain('终端命令');
    expect(host.textContent).toContain('npm run build');
    expect(host.textContent).toContain('批准');
    expect(host.textContent).toContain('拒绝');

    // Click '批准'
    const approveBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('批准'))!;
    await act(async () => {
      approveBtn.click();
    });

    expect(invokeMock).toHaveBeenCalledWith('approve_agent_tool', {
      callId: 'call-1',
      approved: true,
    });

    // Simulate ToolExecuted and Done
    act(() => {
      lastCreatedChannel.onmessage({
        type: 'ToolExecuted',
        payload: {
          call_id: 'call-1',
          output: 'Build finished in 2.1s',
          exit_code: 0,
        },
      });
      lastCreatedChannel.onmessage({
        type: 'Done',
        payload: {
          success: true,
          total_tokens: 450,
        },
      });
    });

    expect(host.textContent).toContain('Build finished in 2.1s');
    expect(host.textContent).toContain('任务已完成');
    await act(async () => finishTask());
  });

  it('does not submit IME confirmation, prevents duplicate starts, and aborts on unmount', async () => {
    invokeMock.mockImplementation((command) => command === 'start_agent_task' ? new Promise(() => {}) : Promise.resolve());
    act(() => root.render(<AgentPanel endpoint="http://localhost:8888/v1/chat/completions" apiKey="" model="local" />));
    const textarea = host.querySelector('textarea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '测试任务');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
    expect(invokeMock).not.toHaveBeenCalled();
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'start_agent_task')).toHaveLength(1);
    expect(textarea.value).toBe('');
    act(() => root.render(<div />));
    expect(invokeMock).toHaveBeenCalledWith('abort_agent_task');
  });

  it('restores failed task input without overwriting a new draft and clears stale approvals', async () => {
    let rejectTask!: (reason: Error) => void;
    invokeMock.mockImplementation(() => new Promise((_, reject) => { rejectTask = reject; }));
    act(() => root.render(<AgentPanel endpoint="http://localhost:8888/v1/chat/completions" apiKey="key" model="local" />));
    const textarea = host.querySelector('textarea')!;
    const input = (text: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const submit = async () => act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    input('原始任务');
    await submit();
    await act(async () => rejectTask(new Error('连接失败')));
    expect(textarea.value).toBe('原始任务');
    await submit();
    act(() => lastCreatedChannel.onmessage({ type: 'ToolProposed', payload: { call_id: 'pending', name: 'run_cli', command: 'test', requires_approval: true } }));
    input('下一项任务');
    await act(async () => rejectTask(new Error('连接中断')));
    expect(textarea.value).toBe('下一项任务');
    expect(host.textContent).not.toContain('批准执行');
    expect(host.textContent).toContain('连接中断');
  });

  it('keeps exactly one turn in StrictMode and ignores late events from a previous task', async () => {
    let finish!: () => void;
    invokeMock.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    act(() => root.render(<React.StrictMode><AgentPanel endpoint="http://localhost/v1" apiKey="" model="local" /></React.StrictMode>));
    const input = host.querySelector('textarea')!;
    const submit = async (value: string) => {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    };
    await submit('第一轮');
    const oldChannel = lastCreatedChannel;
    await act(async () => {
      oldChannel.onmessage({ type: 'ContentChunk', payload: { delta: '第一轮结果' } });
      oldChannel.onmessage({ type: 'Done', payload: { success: true } });
      oldChannel.onmessage({ type: 'Done', payload: { success: true } });
      finish();
    });
    expect(host.querySelectorAll('.agent-turn')).toHaveLength(1);
    await submit('继续');
    const params = invokeMock.mock.calls.at(-1)![1].params;
    expect(params.history).toHaveLength(2);
    expect(params.history[1].content).toContain('第一轮结果');
    act(() => oldChannel.onmessage({ type: 'ContentChunk', payload: { delta: '不应出现的迟到内容' } }));
    expect(host.textContent).not.toContain('不应出现的迟到内容');
    await act(async () => finish());
    expect(host.textContent).not.toContain('执行中…');
    expect(host.textContent).toContain('未收到完成确认');
  });

  it('carries failed tool evidence forward without claiming unfinished tools succeeded', async () => {
    let reject!: (reason: string) => void;
    invokeMock.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    act(() => root.render(<AgentPanel endpoint="http://localhost/v1" apiKey="" model="local" />));
    const input = host.querySelector('textarea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '检查文件');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    act(() => {
      lastCreatedChannel.onmessage({ type: 'ToolProposed', payload: { call_id: '1', name: 'run_cli', command: 'pwd', requires_approval: false } });
      lastCreatedChannel.onmessage({ type: 'ToolExecuted', payload: { call_id: '1', output: 'D:/project', exit_code: 0 } });
      lastCreatedChannel.onmessage({ type: 'ToolProposed', payload: { call_id: '2', name: 'run_cli', command: 'build', requires_approval: true } });
    });
    await act(async () => reject('断线'));
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    const history = invokeMock.mock.calls.at(-1)![1].params.history;
    expect(history[1].content).toContain('D:/project');
    expect(history[1].content).toContain('不能确认是否完成');
    await act(async () => reject('断线'));
    const directory = host.querySelector<HTMLInputElement>('input[aria-label="工作目录"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(directory, 'D:/other');
      directory.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(invokeMock.mock.calls.at(-1)![1].params.history).toBeUndefined();
  });

  it('blocks submission while choosing a directory and clears the draft on new session', async () => {
    let choose!: (path: string) => void;
    invokeMock.mockImplementation(() => new Promise<string>((resolve) => { choose = resolve; }));
    act(() => root.render(<AgentPanel endpoint="http://localhost/v1" apiKey="" model="local" />));
    act(() => host.querySelector<HTMLButtonElement>('.agent-suggestions button')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('.agent-directory-button')!.click());
    const input = host.querySelector('textarea')!;
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(invokeMock).toHaveBeenCalledTimes(1);
    await act(async () => choose('D:/中文项目'));
    expect(host.querySelector<HTMLInputElement>('input[aria-label="工作目录"]')!.value).toBe('D:/中文项目');
    act(() => host.querySelector<HTMLButtonElement>('.agent-header button')!.click());
    expect(input.value).toBe('');
  });

  it('closes the model menu on Escape without closing the agent and does not save IME Enter', () => {
    const change = vi.fn();
    act(() => root.render(<AgentPanel endpoint="http://localhost/v1" apiKey="" model="local" onModelChange={change} modelListError="模型列表获取失败" />));
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="选择模型"]')!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('获取失败');
    const field = host.querySelector<HTMLInputElement>('.agent-model-menu input')!;
    field.value = '新模型';
    act(() => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
    expect(change).not.toHaveBeenCalled();
    act(() => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(change).toHaveBeenCalledWith('新模型');
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="选择模型"]')!.click());
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => host.querySelector('.agent-model-menu input')!.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(host.querySelector('.agent-model-menu')).toBeNull();
  });
});
