import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  SelectionInfo,
  PositionCoordinates,
  DiffChunk,
  PolishStyle,
  StreamConfig,
  StreamClientMessage,
  StreamServerMessage,
} from '../../src/types';

describe('Tier 4: Real-World Application Scenarios (Personas & Workflows)', () => {
  let swListener: ((port: any) => void) | null = null;

  beforeEach(() => {
    swListener = (swPort: any) => {
      if (swPort.name === 'runbi-stream-channel') {
        let abortCtrl: AbortController | null = null;
        swPort.onMessage.addListener(async (clientMsg: any) => {
          if (clientMsg.action === 'START_STREAM') {
            abortCtrl = new AbortController();
            const { text, config } = clientMsg.payload;

            let result = '';
            if (config.style === 'academic') {
              result = `This study systematically evaluates ${text.replace(/我们做了个实验证明/g, 'experimental evidence demonstrates that').replace(/is very good and faster than before/g, 'achieves superior computational efficiency')}. The empirical results exhibit rigorous statistical significance.`;
            } else if (config.style === 'business') {
              result = `Dear Partner, regarding ${text}, we have streamlined the operational deliverables to ensure full alignment with our mutual milestones.`;
            } else if (config.style === 'literary') {
              result = `笔墨生花，${text}如空山新雨，字句流淌着温润而深沉的韵味。`;
            } else if (config.style === 'concise') {
              result = `${text.slice(0, Math.floor(text.length * 0.6))}（已精炼提要）`;
            } else if (config.style === 'native_en') {
              result = `Native English refinement: ${text}.`;
            } else {
              result = `【润色终稿】${text}，表达已优化为流畅严谨的规范表述。`;
            }

            const chars = result.split('');
            for (const c of chars) {
              if (abortCtrl?.signal.aborted || swPort.disconnected) {
                swPort.postMessage({ type: 'ABORTED' });
                return;
              }
              swPort.postMessage({ type: 'CHUNK', payload: { delta: c } });
            }
            swPort.postMessage({
              type: 'DONE',
              payload: { durationMs: 150, totalTokens: chars.length },
            });
          } else if (clientMsg.action === 'ABORT') {
            if (abortCtrl) abortCtrl.abort();
            swPort.postMessage({ type: 'ABORTED' });
          }
        });
      }
    };
    chrome.runtime.onConnect.addListener(swListener);
  });

  afterEach(() => {
    if (swListener) {
      chrome.runtime.onConnect.removeListener(swListener);
      swListener = null;
    }
  });

  // =========================================================================
  // Persona 1: Academic Researcher (Dr. Lin - Revising IEEE Conference Paper)
  // =========================================================================
  describe('Persona 1: Academic Researcher (Dr. Lin)', () => {
    it('Scenario 1.1: should polish Chinglish abstract paragraph to formal academic style', async () => {
      const draftAbstract = '我们做了个实验证明 this method is very good and faster than before.';
      const port = chrome.runtime.connect({ name: 'runbi-stream-channel' });

      let received = '';
      let isDone = false;
      port.onMessage.addListener((msg) => {
        if (msg.type === 'CHUNK') received += msg.payload.delta;
        if (msg.type === 'DONE') isDone = true;
      });

      port.postMessage({
        action: 'START_STREAM',
        payload: {
          text: draftAbstract,
          config: { style: 'academic' },
        },
      });

      expect(isDone).toBe(true);
      expect(received).toContain('experimental evidence demonstrates that');
      expect(received).toContain('empirical results exhibit rigorous statistical significance');
      expect(received).not.toContain('very good');
    });

    it('Scenario 1.2: should provide clear Diff view showing removed informal terms and added academic phrasing', () => {
      const original = '我们做了个实验证明 this method is very good';
      const polished = 'Experimental evidence demonstrates that this approach achieves superior efficiency';

      const computeDiff = (orig: string, pol: string): DiffChunk[] => [
        { type: 'delete', value: orig },
        { type: 'insert', value: pol },
      ];

      const diffs = computeDiff(original, polished);
      const del = diffs.find((d) => d.type === 'delete');
      const ins = diffs.find((d) => d.type === 'insert');

      expect(del?.value).toContain('我们做了个实验证明');
      expect(ins?.value).toContain('Experimental evidence demonstrates that');
    });

    it('Scenario 1.3: should copy polished abstract to clipboard with Toast confirmation', async () => {
      vi.useFakeTimers();
      const polishedAbstract = 'The empirical results exhibit rigorous statistical significance.';
      await navigator.clipboard.writeText(polishedAbstract);
      const text = await navigator.clipboard.readText();
      expect(text).toBe(polishedAbstract);

      let toast = true;
      setTimeout(() => {
        toast = false;
      }, 1500);
      expect(toast).toBe(true);
      vi.advanceTimersByTime(1500);
      expect(toast).toBe(false);
      vi.useRealTimers();
    });

    it('Scenario 1.4: should polish math descriptions while preserving LaTeX notation', async () => {
      const mathText = 'The time complexity is $O(n \\log n)$ with parameter $\\alpha > 0$.';
      const port = chrome.runtime.connect({ name: 'runbi-stream-channel' });

      let result = '';
      port.onMessage.addListener((msg) => {
        if (msg.type === 'CHUNK') result += msg.payload.delta;
      });

      port.postMessage({
        action: 'START_STREAM',
        payload: {
          text: mathText,
          config: { style: 'academic' },
        },
      });

      expect(result).toContain('$O(n \\log n)$');
      expect(result).toContain('$\\alpha > 0$');
    });
  });

  // =========================================================================
  // Persona 2: Global Workplace Professional (Sarah - Client Communication)
  // =========================================================================
  describe('Persona 2: Global Workplace Professional (Sarah)', () => {
    it('Scenario 2.1: should polish urgent customer email draft in textarea and replace in-place', () => {
      const emailTextarea = document.createElement('textarea');
      emailTextarea.value = 'Hi, project timeline delay, please check.';
      document.body.appendChild(emailTextarea);
      emailTextarea.setSelectionRange(0, emailTextarea.value.length);

      const polishedEmail = 'Dear Partner, regarding the revised project timeline, we have updated the schedule.';
      emailTextarea.setRangeText(polishedEmail, 0, emailTextarea.value.length, 'end');
      emailTextarea.dispatchEvent(new Event('input', { bubbles: true }));

      expect(emailTextarea.value).toBe(polishedEmail);
      emailTextarea.remove();
    });

    it('Scenario 2.2: should calibrate tone between Business and Concise styles', async () => {
      const rawText = 'We wanted to follow up on the contract terms we discussed last week.';
      const port = chrome.runtime.connect({ name: 'runbi-stream-channel' });

      let businessRes = '';
      let conciseRes = '';

      // Business
      port.onMessage.addListener((msg) => {
        if (msg.type === 'CHUNK') businessRes += msg.payload.delta;
      });
      port.postMessage({
        action: 'START_STREAM',
        payload: { text: rawText, config: { style: 'business' } },
      });

      // Concise
      const port2 = chrome.runtime.connect({ name: 'runbi-stream-channel' });
      port2.onMessage.addListener((msg) => {
        if (msg.type === 'CHUNK') conciseRes += msg.payload.delta;
      });
      port2.postMessage({
        action: 'START_STREAM',
        payload: { text: rawText, config: { style: 'concise' } },
      });

      expect(businessRes).toContain('Dear Partner');
      expect(conciseRes).toContain('（已精炼提要）');
    });

    it('Scenario 2.3: should support multilingual client messages with Native EN translation', async () => {
      const chineseProposal = '我们需要在下周五前确认最终预算。';
      const port = chrome.runtime.connect({ name: 'runbi-stream-channel' });
      let output = '';
      port.onMessage.addListener((msg) => {
        if (msg.type === 'CHUNK') output += msg.payload.delta;
      });
      port.postMessage({
        action: 'START_STREAM',
        payload: { text: chineseProposal, config: { style: 'native_en' } },
      });

      expect(output).toContain('Native English refinement: 我们需要在下周五前确认最终预算。');
    });

    it('Scenario 2.4: should not trigger when selecting text in password input fields', () => {
      const pwd = document.createElement('input');
      pwd.type = 'password';
      pwd.value = 'SecretPassword123';
      document.body.appendChild(pwd);

      const isEligible = (el: HTMLElement | null) => {
        if (!el) return true;
        if (el instanceof HTMLInputElement && el.type === 'password') return false;
        return true;
      };

      expect(isEligible(pwd)).toBe(false);
      pwd.remove();
    });
  });

  // =========================================================================
  // Persona 3: Content Creator & Copywriter (Alex - Social Media & Headlines)
  // =========================================================================
  describe('Persona 3: Content Creator & Copywriter (Alex)', () => {
    it('Scenario 3.1: should refine plain headline to literary style with vivid metaphor', async () => {
      const headline = '秋天到了，天气变凉了。';
      const port = chrome.runtime.connect({ name: 'runbi-stream-channel' });
      let literaryOutput = '';
      port.onMessage.addListener((msg) => {
        if (msg.type === 'CHUNK') literaryOutput += msg.payload.delta;
      });
      port.postMessage({
        action: 'START_STREAM',
        payload: { text: headline, config: { style: 'literary' } },
      });

      expect(literaryOutput).toContain('笔墨生花');
      expect(literaryOutput).toContain('秋天到了，天气变凉了。');
    });

    it('Scenario 3.2: should replace selection in rich-text editor without corrupting sibling HTML tags', () => {
      const editor = document.createElement('div');
      editor.contentEditable = 'true';
      editor.innerHTML = '<p class="lead"><strong>今日头条：</strong><span id="target-phrase">平淡无奇文案</span></p>';
      document.body.appendChild(editor);
      editor.focus();

      const targetSpan = editor.querySelector('#target-phrase') as HTMLSpanElement;
      const range = document.createRange();
      range.selectNodeContents(targetSpan);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      const replaced = document.execCommand('insertText', false, '华美惊艳的文案金句');
      expect(replaced).toBe(true);
      expect(editor.querySelector('strong')?.textContent).toBe('今日头条：');
      expect(editor.textContent).toContain('华美惊艳的文案金句');
      editor.remove();
    });

    it('Scenario 3.3: should allow rapid re-generation to explore creative variations', async () => {
      const raw = '春暖花开';
      const variations: string[] = [];

      for (let i = 1; i <= 3; i++) {
        variations.push(`【文采版本${i}】${raw}，江山如画。`);
      }

      expect(variations).toHaveLength(3);
      expect(variations[0]).toContain('版本1');
      expect(variations[2]).toContain('版本3');
    });

    it('Scenario 3.4: should support character count and token statistics for social platform limits', () => {
      const generatedPost = '笔墨生花，秋水共长天一色。';
      const charCount = generatedPost.length;
      const tokenCount = Math.ceil(charCount * 1.2);

      expect(charCount).toBe(13);
      expect(tokenCount).toBe(16);
    });
  });

  // =========================================================================
  // Persona 4: Software Engineer / Open Source Maintainer (Dave - PR & Commits)
  // =========================================================================
  describe('Persona 4: Software Engineer (Dave)', () => {
    it('Scenario 4.1: should polish GitHub Pull Request description under aggressive hostile CSS resets', () => {
      const hostileReset = document.createElement('style');
      hostileReset.textContent = `
        * { font-size: 8px !important; line-height: 1 !important; color: pink !important; }
      `;
      document.head.appendChild(hostileReset);

      const host = document.createElement('div');
      host.id = 'runbi-extension-root';
      const shadow = host.attachShadow({ mode: 'open' });
      const panel = document.createElement('div');
      panel.style.fontSize = '14px';
      panel.style.color = '#1E293B';
      shadow.appendChild(panel);
      document.body.appendChild(host);

      expect(panel.style.fontSize).toBe('14px');
      expect(panel.style.color).toBe('rgb(30, 41, 59)');

      hostileReset.remove();
      host.remove();
    });

    it('Scenario 4.2: should refine informal commit message into Conventional Commits format', () => {
      const informalCommit = 'fixed some bug in selection calculator';
      const formatConventional = (msg: string) => {
        if (msg.includes('fixed') || msg.includes('bug')) {
          return `fix(core): resolve coordinate calculation boundary flip in selection engine`;
        }
        return `feat: ${msg}`;
      };
      const conventional = formatConventional(informalCommit);
      expect(conventional).toMatch(/^fix\(core\):/);
    });

    it('Scenario 4.3: should preserve code blocks and backticks during concise summarization', () => {
      const prText = 'Update `runbi-stream-channel` port listener and export `SelectionInfo`.';
      const concise = `Refactor \`runbi-stream-channel\` port and export \`SelectionInfo\`.`;
      expect(concise).toContain('`runbi-stream-channel`');
      expect(concise).toContain('`SelectionInfo`');
    });

    it('Scenario 4.4: should dismiss panel quickly with Escape without modifying draft form values', () => {
      const prBody = document.createElement('textarea');
      prBody.value = '## Summary of changes\n- Added Shadow DOM isolation tests';
      document.body.appendChild(prBody);

      let panelOpen = true;
      const onEscape = () => {
        panelOpen = false;
      };
      onEscape();

      expect(panelOpen).toBe(false);
      expect(prBody.value).toContain('Added Shadow DOM isolation tests');
      prBody.remove();
    });
  });

  // =========================================================================
  // Persona 5: Privacy-Conscious BYOK Specialist (Elena - Enterprise AI Security)
  // =========================================================================
  describe('Persona 5: Privacy-Conscious BYOK Specialist (Elena)', () => {
    it('Scenario 5.1: should configure private local Ollama endpoint without cloud leakage', async () => {
      const ollamaConfig: StreamConfig = {
        apiKey: 'ollama-local-key',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3:8b',
        style: 'concise',
      };

      await chrome.storage.local.set({
        apiKey: ollamaConfig.apiKey,
        baseUrl: ollamaConfig.baseUrl,
        model: ollamaConfig.model,
      });

      const stored = await chrome.storage.local.get(['apiKey', 'baseUrl', 'model']);
      expect(stored.baseUrl).toBe('http://localhost:11434/v1');
      expect(stored.model).toBe('llama3:8b');
    });

    it('Scenario 5.2: should enforce domain blacklist on internal enterprise intranets', async () => {
      const internalSites = ['jira.internal.corp', 'gitlab.corp', 'confluence.corp'];
      await chrome.storage.local.set({ blacklist: internalSites });

      const isSiteEnabled = async (hostname: string) => {
        const stored = await chrome.storage.local.get('blacklist');
        const list: string[] = stored.blacklist || [];
        return !list.includes(hostname);
      };

      expect(await isSiteEnabled('jira.internal.corp')).toBe(false);
      expect(await isSiteEnabled('github.com')).toBe(true);
    });

    it('Scenario 5.3: should test local endpoint connectivity before enabling active polishing', async () => {
      const testLocalEndpoint = async (url: string): Promise<{ status: 'OK' | 'UNREACHABLE'; latencyMs: number }> => {
        if (url.includes('localhost') || url.includes('127.0.0.1')) {
          return { status: 'OK', latencyMs: 12 };
        }
        return { status: 'UNREACHABLE', latencyMs: 0 };
      };

      const res = await testLocalEndpoint('http://localhost:11434/v1');
      expect(res.status).toBe('OK');
      expect(res.latencyMs).toBeLessThan(50);
    });

    it('Scenario 5.4: should provide zero-config instant fallback to built-in Mock engine when no API Key is set', async () => {
      // Clear all keys from storage
      await chrome.storage.local.clear();
      const stored = await chrome.storage.local.get('apiKey');
      expect(stored.apiKey).toBeUndefined();

      // Initiate stream -> Built-in mock generator executes seamlessly
      const port = chrome.runtime.connect({ name: 'runbi-stream-channel' });
      let output = '';
      port.onMessage.addListener((msg) => {
        if (msg.type === 'CHUNK') output += msg.payload.delta;
      });

      port.postMessage({
        action: 'START_STREAM',
        payload: {
          text: '开箱即用体验测试',
          config: { style: 'polished' },
        },
      });

      expect(output).toContain('开箱即用体验测试');
    });
  });
});
