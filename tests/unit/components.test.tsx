/**
 * Unit Tests for Runbi Live UI: TriggerCapsule, Shadow DOM & Content App
 * (Shared components are covered by shared-components.test.tsx)
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TriggerCapsule } from '../../src/components/TriggerCapsule';
import {
  initShadowRoot,
  destroyShadowRoot,
  getShadowHost,
  getShadowRoot,
  getAppContainer,
} from '../../src/content/shadowRoot';
import { mountRunbi, unmountRunbi } from '../../src/content/index';
import { App } from '../../src/content/App';

describe('Milestone 3: UI Components & Shadow DOM Integration', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    destroyShadowRoot();
  });

  // Helper to render React element
  async function renderElement(element: React.ReactElement): Promise<void> {
    await act(async () => {
      if (!root) {
        root = ReactDOM.createRoot(container);
      }
      root.render(element);
    });
  }

  // =========================================================================
  // 1. TriggerCapsule Tests
  // =========================================================================
  describe('TriggerCapsule Component', () => {
    it('should render 28px capsule at specified coordinates with jade styling', async () => {
      const handleClick = vi.fn();
      await renderElement(
        <TriggerCapsule top={120} left={250} onClick={handleClick} />
      );

      const capsule = container.querySelector('#runbi-trigger-capsule') as HTMLButtonElement;
      expect(capsule).not.toBeNull();
      expect(capsule.style.top).toBe('120px');
      expect(capsule.style.left).toBe('250px');
      expect(capsule.className).toContain('w-7');
      expect(capsule.className).toContain('h-7');
      expect(capsule.className).toContain('bg-[#00BFA5]');
      expect(capsule.querySelector('svg')).not.toBeNull();
    });

    it('should trigger onClick when capsule button is clicked', async () => {
      const handleClick = vi.fn();
      await renderElement(
        <TriggerCapsule top={50} left={100} onClick={handleClick} />
      );

      const capsule = container.querySelector('#runbi-trigger-capsule') as HTMLButtonElement;
      await act(async () => {
        capsule.click();
      });
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 2. Shadow DOM Host & Encapsulation Tests
  // =========================================================================
  describe('Shadow DOM Host & Encapsulation (shadowRoot.ts)', () => {
    it('should create #runbi-extension-root with open #shadow-root and style tag', () => {
      const { host, shadowRoot, container: appContainer } = initShadowRoot();

      expect(host.id).toBe('runbi-extension-root');
      expect(host.style.position).toBe('absolute');
      expect(host.style.zIndex).toBe('2147483647');
      expect(host.style.pointerEvents).toBe('none');

      expect(shadowRoot).not.toBeNull();
      expect(shadowRoot.mode).toBe('open');

      const styleEl = shadowRoot.querySelector('style');
      expect(styleEl).not.toBeNull();

      expect(appContainer.id).toBe('runbi-app-container');
      expect(appContainer.style.pointerEvents).toBe('none');

      // Check getters
      expect(getShadowHost()).toBe(host);
      expect(getShadowRoot()).toBe(shadowRoot);
      expect(getAppContainer()).toBe(appContainer);

      // Clean up
      destroyShadowRoot();
      expect(getShadowHost()).toBeNull();
    });

    it('should mount and unmount React application via mountRunbi / unmountRunbi', async () => {
      await act(async () => {
        mountRunbi();
      });
      expect(getShadowHost()).not.toBeNull();
      expect(getAppContainer()).not.toBeNull();

      await act(async () => {
        unmountRunbi();
      });
      expect(getShadowHost()).toBeNull();
    });
  });

  // =========================================================================
  // 3. React App State Machine & LifeCycle Tests
  // =========================================================================
  describe('React App State Machine (App.tsx)', () => {
    it('should start in capsule mode when initialSelection is passed, expand to panel on capsule click', async () => {
      const mockSelection = {
        text: '选中的测试句子',
        rawText: '选中的测试句子',
        rect: new DOMRect(100, 200, 80, 20),
        isEditable: true,
        targetElement: document.createElement('textarea'),
        savedRange: null,
      };

      await renderElement(<App initialSelection={mockSelection} />);

      const capsule = container.querySelector('#runbi-trigger-capsule') as HTMLButtonElement;
      expect(capsule).not.toBeNull();

      // Click capsule to expand panel
      await act(async () => {
        capsule.click();
        await new Promise((r) => setTimeout(r, 150));
      });

      const panel = container.querySelector('#runbi-panel');
      expect(panel).not.toBeNull();

      // Ensure all streaming settled before test cleanup
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    });

    it('should dismiss upon Escape keypress', async () => {
      const mockSelection = {
        text: '选中的测试句子',
        rawText: '选中的测试句子',
        rect: new DOMRect(100, 200, 80, 20),
        isEditable: true,
        targetElement: document.createElement('textarea'),
        savedRange: null,
      };

      await renderElement(<App initialSelection={mockSelection} />);
      expect(container.querySelector('#runbi-trigger-capsule')).not.toBeNull();

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(container.querySelector('#runbi-trigger-capsule')).toBeNull();
      expect(container.querySelector('#runbi-panel')).toBeNull();
    });
  });
});
