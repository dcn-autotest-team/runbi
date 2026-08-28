import { describe, it, expect } from 'vitest';
import { isScreenReplyPayload } from '@runbi/shared/core';

/**
 * Regression contract for `runbi://captured-selection` payloads.
 * Shapes mirror the three Rust emit sites exactly (see capturedSelection.ts).
 *
 * Root-cause regression (2026-08-29): the JPEG encoder rejected RGBA8, so
 * Rust's capture failed silently and `hasScreenshot` was always false. The
 * screen-reply branch (trigger==='screen-reply' && hasScreenshot) never ran —
 * the panel stayed silent. These tests pin the payload shapes and the gate.
 */
describe('captured-selection payload contract', () => {
  it('screen-reply event with screenshot captured → panel opens vision flow', () => {
    // main.rs emit, WeChat foreground, no selection, JPEG encode OK
    expect(
      isScreenReplyPayload({
        text: '',
        sourceApp: 'Weixin.exe',
        windowTitle: '微信',
        hasScreenshot: true,
        trigger: 'screen-reply',
      }),
    ).toBe(true);
  });

  it('screen-reply event with capture FAILED → must NOT enter screen-reply (but must not crash)', () => {
    // has_screenshot=false when capture_foreground_screenshot() returned Err
    expect(
      isScreenReplyPayload({
        text: '',
        sourceApp: 'Weixin.exe',
        windowTitle: '微信',
        hasScreenshot: false,
        trigger: 'screen-reply',
      }),
    ).toBe(false);
  });

  it('screen-reply event missing hasScreenshot key entirely → false (IPC drop regression)', () => {
    // If a future IPC change silently drops the flag, the gate must stay closed
    // (never open a vision flow without an image) — and the explicit
    // "screen-reply without screenshot" toast branch handles the UX.
    expect(
      isScreenReplyPayload({ text: '', sourceApp: null, windowTitle: null, trigger: 'screen-reply' }),
    ).toBe(false);
  });

  it('mouse_hook selection event (trigger=selection, hasScreenshot true) is NOT screen-reply', () => {
    // mouse_hook.rs: user dragged-selected text in a chat app
    expect(
      isScreenReplyPayload({
        text: '这个方案周五能交付吗',
        sourceApp: 'Weixin.exe',
        windowTitle: '微信',
        hasScreenshot: true,
        trigger: 'selection',
      }),
    ).toBe(false);
  });

  it('clipboard_monitor event uses `screenshot` key, not hasScreenshot → never screen-reply', () => {
    // clipboard_monitor.rs payload shape: screenshot (data URL | null) + trigger=clipboard
    expect(
      isScreenReplyPayload({
        text: '你好',
        sourceApp: 'Weixin.exe',
        windowTitle: '微信',
        screenshot: 'data:image/jpeg;base64,...' as unknown as undefined,
        trigger: 'clipboard',
      } as never),
    ).toBe(false);
  });

  it('shortcut event with no selection (non-chat foreground) → false', () => {
    expect(
      isScreenReplyPayload({
        text: '',
        sourceApp: 'LobsterAI.exe',
        windowTitle: 'LobsterAI',
        hasScreenshot: false,
        trigger: 'shortcut',
      }),
    ).toBe(false);
  });

  it('sensitive-blocked event → false', () => {
    expect(
      isScreenReplyPayload({ text: '', sourceApp: 'KeePass.exe', windowTitle: 'KeePass', hasScreenshot: false, trigger: 'sensitive-blocked' }),
    ).toBe(false);
  });

  it('null/undefined payload → false (listener must survive malformed events)', () => {
    expect(isScreenReplyPayload(null)).toBe(false);
    expect(isScreenReplyPayload(undefined)).toBe(false);
    expect(isScreenReplyPayload({} as never)).toBe(false);
  });
});
