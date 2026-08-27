/**
 * Unit Tests for Options Settings Page & Popup Quick Settings Page
 * Milestone 4 (M4)
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OptionsApp } from '../../src/options/OptionsApp';
import { PopupApp } from '../../src/popup/PopupApp';

describe('Milestone 4: Options & Popup Settings UI (settings.test.tsx)', () => {
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
  });

  async function renderElement(element: React.ReactElement): Promise<void> {
    await act(async () => {
      if (!root) {
        root = ReactDOM.createRoot(container);
      }
      root.render(element);
    });
  }

  // =========================================================================
  // 1. OptionsApp Component Tests
  // =========================================================================
  describe('OptionsApp Component', () => {
    it('should render all sections, inputs, provider presets, and prompt templates', async () => {
      await renderElement(<OptionsApp />);

      expect(container.textContent).toContain('润笔 (Runbi) 设置');
      expect(container.textContent).toContain('模型与 API 服务配置 (BYOK)');
      expect(container.textContent).toContain('润色风格 Prompt 自定义模板');
      expect(container.textContent).toContain('交互模式与免打扰设置');

      // Verify Provider buttons
      expect(container.querySelector('[data-provider="deepseek"]')).not.toBeNull();
      expect(container.querySelector('[data-provider="openai"]')).not.toBeNull();
      expect(container.querySelector('[data-provider="siliconflow"]')).not.toBeNull();
      expect(container.querySelector('[data-provider="ollama"]')).not.toBeNull();
      expect(container.querySelector('[data-provider="custom"]')).not.toBeNull();

      // Verify Inputs
      const baseUrlInput = container.querySelector('#base-url-input') as HTMLInputElement;
      const apiKeyInput = container.querySelector('#api-key-input') as HTMLInputElement;
      const modelInput = container.querySelector('#model-input') as HTMLInputElement;
      expect(baseUrlInput).not.toBeNull();
      expect(apiKeyInput).not.toBeNull();
      expect(modelInput).not.toBeNull();
      expect(baseUrlInput.value).toBe('https://api.deepseek.com/v1');
    });

    it('should switch provider presets and update Base URL and default Model', async () => {
      await renderElement(<OptionsApp />);

      const openaiBtn = container.querySelector('[data-provider="openai"]') as HTMLButtonElement;
      expect(openaiBtn).not.toBeNull();

      await act(async () => {
        openaiBtn.click();
      });

      const baseUrlInput = container.querySelector('#base-url-input') as HTMLInputElement;
      const modelInput = container.querySelector('#model-input') as HTMLInputElement;

      expect(baseUrlInput.value).toBe('https://api.openai.com/v1');
      expect(modelInput.value).toBe('gpt-4o-mini');
    });

    it('should toggle API Key visibility when clicking the eye icon', async () => {
      await renderElement(<OptionsApp />);

      const apiKeyInput = container.querySelector('#api-key-input') as HTMLInputElement;
      const toggleBtn = container.querySelector('#toggle-key-visibility') as HTMLButtonElement;

      expect(apiKeyInput.type).toBe('password');

      await act(async () => {
        toggleBtn.click();
      });
      expect(apiKeyInput.type).toBe('text');

      await act(async () => {
        toggleBtn.click();
      });
      expect(apiKeyInput.type).toBe('password');
    });

    it('should switch prompt style tabs and edit custom prompts', async () => {
      await renderElement(<OptionsApp />);

      const academicTab = container.querySelector('#prompt-style-tab-academic') as HTMLButtonElement;
      expect(academicTab).not.toBeNull();

      await act(async () => {
        academicTab.click();
      });

      const promptTextarea = container.querySelector('#custom-prompt-textarea') as HTMLTextAreaElement;
      expect(promptTextarea.value).toContain('学术规范');

      // Edit prompt
      await act(async () => {
        const event = { target: { value: '自定义学术提示词模板' } };
        // Trigger React onChange
        promptTextarea.value = '自定义学术提示词模板';
        promptTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });

    it('should test connection and display result badge', async () => {
      // Setup mock runtime sendMessage to return success
      chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
        success: true,
        latencyMs: 95,
        model: 'deepseek-chat',
      });

      await renderElement(<OptionsApp />);

      const apiKeyInput = container.querySelector('#api-key-input') as HTMLInputElement;
      await act(async () => {
        apiKeyInput.value = 'sk-test-key';
        apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }));
      });

      const testBtn = container.querySelector('#test-connection-btn') as HTMLButtonElement;
      expect(testBtn).not.toBeNull();

      await act(async () => {
        testBtn.click();
        await new Promise((r) => setTimeout(r, 50));
      });

      const statusBadge = container.querySelector('#connection-status');
      expect(statusBadge).not.toBeNull();
      expect(statusBadge?.textContent).toContain('连接成功');
      expect(statusBadge?.textContent).toContain('95ms');
    });

    it('should display error message when connection test fails', async () => {
      chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
        success: false,
        error: '401 Unauthorized: API Key 无效',
      });

      await renderElement(<OptionsApp />);

      const testBtn = container.querySelector('#test-connection-btn') as HTMLButtonElement;
      await act(async () => {
        testBtn.click();
        await new Promise((r) => setTimeout(r, 50));
      });

      const statusBadge = container.querySelector('#connection-status');
      expect(statusBadge).not.toBeNull();
      expect(statusBadge?.textContent).toContain('连接失败');
      expect(statusBadge?.textContent).toContain('401 Unauthorized');
    });

    it('should save configuration to chrome.storage.local and show toast feedback', async () => {
      const setSpy = vi.spyOn(chrome.storage.local, 'set');

      await renderElement(<OptionsApp />);

      const saveBtn = container.querySelector('#save-settings-btn') as HTMLButtonElement;
      expect(saveBtn).not.toBeNull();

      await act(async () => {
        saveBtn.click();
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(setSpy).toHaveBeenCalled();
      const savedObj = setSpy.mock.calls[0][0];
      expect(savedObj).toHaveProperty('provider');
      expect(savedObj).toHaveProperty('baseUrl');
      expect(savedObj).toHaveProperty('apiKey');
      expect(savedObj).toHaveProperty('model');

      const toast = container.querySelector('#settings-toast');
      expect(toast).not.toBeNull();
      expect(toast?.textContent).toContain('配置已成功保存');
    });
  });

  // =========================================================================
  // 2. PopupApp Component Tests
  // =========================================================================
  describe('PopupApp Component', () => {
    it('should render header, master switch, trigger modes, and active model', async () => {
      await renderElement(<PopupApp />);

      expect(container.textContent).toContain('润笔 Runbi');
      expect(container.textContent).toContain('划词功能开关');
      expect(container.textContent).toContain('触发模式');
      expect(container.textContent).toContain('当前推理引擎');
      expect(container.textContent).toContain('Alt + W');

      const masterToggle = container.querySelector('#master-toggle-btn') as HTMLButtonElement;
      expect(masterToggle).not.toBeNull();
      expect(masterToggle.getAttribute('aria-checked')).toBe('true');
    });

    it('should toggle master enabled state when switch is clicked', async () => {
      const setSpy = vi.spyOn(chrome.storage.local, 'set');

      await renderElement(<PopupApp />);

      const masterToggle = container.querySelector('#master-toggle-btn') as HTMLButtonElement;
      await act(async () => {
        masterToggle.click();
      });

      expect(setSpy).toHaveBeenCalledWith({ enabled: false });
      expect(container.textContent).toContain('已暂停划词功能');
    });

    it('should switch trigger mode between capsule and direct', async () => {
      const setSpy = vi.spyOn(chrome.storage.local, 'set');

      await renderElement(<PopupApp />);

      const directBtn = container.querySelector('#mode-direct-btn') as HTMLButtonElement;
      expect(directBtn).not.toBeNull();

      await act(async () => {
        directBtn.click();
      });

      expect(setSpy).toHaveBeenCalledWith({ triggerMode: 'direct' });
      expect(container.textContent).toContain('已设为极速直出模式');
    });

    it('should display Mock mode badge when apiKey is absent', async () => {
      await renderElement(<PopupApp />);

      const modelNameEl = container.querySelector('#active-model-name');
      const providerBadge = container.querySelector('#active-provider-badge');

      expect(modelNameEl?.textContent).toContain('内置 Mock 模拟模式');
      expect(providerBadge?.textContent).toContain('ZERO-CONFIG');
    });

    it('should open options page when clicking detailed settings button', async () => {
      await renderElement(<PopupApp />);

      const openOptionsBtn = container.querySelector('#open-options-btn') as HTMLButtonElement;
      expect(openOptionsBtn).not.toBeNull();

      await act(async () => {
        openOptionsBtn.click();
      });

      expect(chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
    });

    it('should toggle domain blacklist for active tab', async () => {
      // Mock active tab URL to example.com
      chrome.tabs.query = vi.fn().mockImplementation((_query, cb) => {
        if (cb) cb([{ id: 1, url: 'https://github.com/project' }]);
        return Promise.resolve([{ id: 1, url: 'https://github.com/project' }]);
      });

      const setSpy = vi.spyOn(chrome.storage.local, 'set');

      await renderElement(<PopupApp />);

      const toggleDomainBtn = container.querySelector('#toggle-domain-btn') as HTMLButtonElement;
      expect(toggleDomainBtn).not.toBeNull();
      expect(toggleDomainBtn.textContent).toContain('在 github.com 禁用');

      await act(async () => {
        toggleDomainBtn.click();
      });

      expect(setSpy).toHaveBeenCalledWith({ blacklist: ['github.com'] });
      expect(container.textContent).toContain('已在 github.com 禁用');
    });
  });
});
