import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updaterMocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  getVersion: vi.fn(),
}));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: updaterMocks.getVersion }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: updaterMocks.check }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: updaterMocks.relaunch }));

import { formatUpdateDate, formatUpdateError, UpdateCheckRow } from '../../desktop/src/components/UpdateCheckRow';

describe('desktop updater diagnostics', () => {
  beforeEach(() => {
    updaterMocks.check.mockReset();
    updaterMocks.getVersion.mockReset();
    updaterMocks.getVersion.mockResolvedValue('1.0.21');
  });
  afterEach(() => document.body.replaceChildren());

  it('explains unreachable feeds and signature failures', () => {
    expect(formatUpdateError(new Error('HTTP status 404 Not Found'))).toContain('升级源不可访问');
    expect(formatUpdateError(new Error('Signature verification failed'))).toContain('签名校验失败');
    expect(formatUpdateDate('2026-09-13T13:57:03Z')).toContain('2026');
  });

  it('keeps the installed version and update action visible', async () => {
    updaterMocks.check.mockResolvedValue(null);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(UpdateCheckRow));
      await Promise.resolve();
    });

    expect(host.textContent).toContain('当前版本 v1.0.21');
    expect(host.textContent).toContain('稳定版');
    expect(host.textContent).toContain('检查更新');

    await act(async () => root.unmount());
  });

  it('checks automatically and shows a prominent update reminder', async () => {
    const downloadAndInstall = vi.fn();
    updaterMocks.check.mockResolvedValue({
      currentVersion: '1.0.21',
      version: '1.1.0',
      date: '2026-09-14T08:00:00Z',
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
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Runbi 1.1.0 可以更新');
    expect(host.textContent).toContain('v1.0.21 → v1.1.0');
    expect(host.textContent).toContain('本次更新');
    expect(host.textContent).toContain('更新并重启');

    // Overlay has top-level z-index to stay above main window contents
    const overlay = dialog?.parentElement;
    expect(overlay?.className).toContain('z-[2147483647]');

    // Clicking "稍后提醒" dismisses the modal
    const buttons = host.querySelectorAll('button');
    const dismissBtn = Array.from(buttons).find((b) => b.textContent?.includes('稍后提醒'));
    expect(dismissBtn).toBeDefined();

    await act(async () => {
      dismissBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it('triggers downloadAndInstall when clicking restart and update', async () => {
    vi.useFakeTimers();
    const downloadAndInstall = vi.fn().mockImplementation(async (cb) => {
      if (cb) {
        cb({ event: 'Started', data: { contentLength: 100 } });
        cb({ event: 'Progress', data: { chunkLength: 50 } });
        cb({ event: 'Finished' });
      }
    });
    updaterMocks.check.mockResolvedValue({
      currentVersion: '1.0.21',
      version: '1.1.0',
      date: '2026-09-14T08:00:00Z',
      body: '修复若干问题',
      downloadAndInstall,
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(UpdateCheckRow, { autoCheck: true, prominent: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const installBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('更新并重启'));
    expect(installBtn).toBeDefined();

    await act(async () => {
      installBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(updaterMocks.relaunch).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    await act(async () => root.unmount());
  });
});
