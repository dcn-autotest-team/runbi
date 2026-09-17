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
    invokeMock.mockResolvedValue({});
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

    expect(host.textContent).toContain('run_cli');
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
  });
});
