/**
 * @file tests/unit/onboarding.test.tsx
 * Unit Tests for OnboardingView Component
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { OnboardingView } from '../../desktop/src/components/OnboardingView';

describe('Desktop Onboarding: OnboardingView Component', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.useRealTimers();
  });

  const renderComponent = async (props: {
    onDismiss: () => void;
    shortcut?: string;
    autoCloseSeconds?: number;
  }) => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<OnboardingView {...props} />);
    });
    return root;
  };

  it('renders the 3-step core flow and shortcut', async () => {
    const handleDismiss = vi.fn();
    await renderComponent({
      onDismiss: handleDismiss,
      shortcut: 'Ctrl+Shift+Space',
      autoCloseSeconds: 5,
    });

    expect(container.textContent).toContain('润笔 Runbi');
    expect(container.textContent).toContain('1. 鼠标划选');
    expect(container.textContent).toContain('2. 极速润色');
    expect(container.textContent).toContain('3. 回车贴回');
    expect(container.textContent).toContain('Ctrl+Shift+Space');
    expect(container.textContent).toContain('5s');
  });

  it('allows clicking the demo simulator to experience polish transformation', async () => {
    const handleDismiss = vi.fn();
    await renderComponent({
      onDismiss: handleDismiss,
    });

    expect(container.textContent).toContain('这个方案不行，完全没法用。');

    const demoCard = container.querySelector('[role="button"]') as HTMLDivElement;
    expect(demoCard).toBeDefined();

    // Click demo card to transform
    await act(async () => {
      demoCard.click();
    });

    expect(container.textContent).toContain('润笔·职场商务');
    expect(container.textContent).toContain('仍有一定优化空间');
  });

  it('pauses countdown on mouseEnter and resumes on mouseLeave', async () => {
    const handleDismiss = vi.fn();
    await renderComponent({
      onDismiss: handleDismiss,
      autoCloseSeconds: 5,
    });

    const rootElement = container.querySelector('#runbi-onboarding-view') as HTMLDivElement;
    expect(rootElement).toBeDefined();

    // Hover to pause
    await act(async () => {
      rootElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    expect(container.textContent).toContain('已暂停');

    // Advance 3 seconds while paused
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(handleDismiss).not.toHaveBeenCalled();

    // Leave to resume
    await act(async () => {
      rootElement.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });

    expect(container.textContent).not.toContain('已暂停');
  });

  it('calls onDismiss when button is clicked', async () => {
    const handleDismiss = vi.fn();
    await renderComponent({
      onDismiss: handleDismiss,
      autoCloseSeconds: 5,
    });

    const dismissBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('立即体验')
    );
    expect(dismissBtn).toBeDefined();

    await act(async () => {
      dismissBtn?.click();
    });

    expect(handleDismiss).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses when countdown expires', async () => {
    const handleDismiss = vi.fn();
    await renderComponent({
      onDismiss: handleDismiss,
      autoCloseSeconds: 3,
    });

    expect(handleDismiss).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(3100);
    });

    expect(handleDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses when pressing Enter or Escape key', async () => {
    const handleDismiss = vi.fn();
    await renderComponent({
      onDismiss: handleDismiss,
      autoCloseSeconds: 10,
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(handleDismiss).toHaveBeenCalledTimes(1);
  });
});
