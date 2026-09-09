import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updaterMocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({ check: updaterMocks.check }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: updaterMocks.relaunch }));

import { formatUpdateError, UpdateCheckRow } from '../../desktop/src/components/UpdateCheckRow';

describe('desktop updater diagnostics', () => {
  beforeEach(() => updaterMocks.check.mockReset());
  afterEach(() => document.body.replaceChildren());

  it('explains unreachable feeds and signature failures', () => {
    expect(formatUpdateError(new Error('HTTP status 404 Not Found'))).toContain('升级源不可访问');
    expect(formatUpdateError(new Error('Signature verification failed'))).toContain('签名校验失败');
  });

  it('checks automatically and shows a prominent update reminder', async () => {
    const downloadAndInstall = vi.fn();
    updaterMocks.check.mockResolvedValue({
      version: '1.1.0',
      body: '修复若干问题',
      downloadAndInstall,
    });
    const onUpdateFound = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(UpdateCheckRow, { autoCheck: true, prominent: true, onUpdateFound }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updaterMocks.check).toHaveBeenCalledTimes(1);
    expect(onUpdateFound).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Runbi 1.1.0 可以更新');
    expect(host.textContent).toContain('立即更新');

    await act(async () => root.unmount());
  });
});
