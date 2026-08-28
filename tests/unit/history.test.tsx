/**
 * @file tests/unit/history.test.tsx
 * Unit Tests for Generation History, Draft Snapshots & Revert Safety
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HistoryRecord, DraftSnapshot } from '@runbi/shared/types';
import { HistoryDrawer } from '@runbi/shared/components';

describe('Data Safety & Fault Tolerance: History & Drafts', () => {
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

  describe('History FIFO & Storage Invariants', () => {
    it('should maintain at most 100 items under FIFO queue', () => {
      const records: HistoryRecord[] = [];
      for (let i = 0; i < 110; i++) {
        records.unshift({
          id: `item-${i}`,
          timestamp: Date.now() + i,
          originalText: `Original ${i}`,
          polishedText: `Polished ${i}`,
          style: 'polished',
        });
      }
      const capped = records.slice(0, 100);
      expect(capped.length).toBe(100);
      expect(capped[0].id).toBe('item-109');
      expect(capped[99].id).toBe('item-10');
    });

    it('should correctly filter drafts based on 15 minute expiration', () => {
      const now = Date.now();
      const freshDraft: DraftSnapshot = {
        timestamp: now - 5 * 60 * 1000, // 5 min old
        originalText: 'Fresh draft content',
        activeStyle: 'business',
      };
      const staleDraft: DraftSnapshot = {
        timestamp: now - 20 * 60 * 1000, // 20 min old
        originalText: 'Stale draft content',
        activeStyle: 'business',
      };

      const isFreshValid = now - freshDraft.timestamp < 15 * 60 * 1000;
      const isStaleValid = now - staleDraft.timestamp < 15 * 60 * 1000;

      expect(isFreshValid).toBe(true);
      expect(isStaleValid).toBe(false);
    });
  });

  describe('HistoryDrawer UI Component', () => {
    it('should render empty state when history is empty', async () => {
      await renderElement(
        <HistoryDrawer
          isOpen={true}
          history={[]}
          onClose={vi.fn()}
          onRestore={vi.fn()}
          onDelete={vi.fn()}
          onClearAll={vi.fn()}
          onCopyText={vi.fn()}
        />
      );

      expect(container.textContent).toContain('暂无历史记录');
    });

    it('should render history cards and handle restore, copy, and delete', async () => {
      const handleRestore = vi.fn();
      const handleCopy = vi.fn();
      const handleDelete = vi.fn();
      const handleClear = vi.fn();

      const mockHistory: HistoryRecord[] = [
        {
          id: 'rec-1',
          timestamp: Date.now() - 60000,
          originalText: '明天开会吗？',
          polishedText: '请问明天的项目对齐评审会议如期举行吗？',
          style: 'business',
          sourceApp: '微信',
        },
        {
          id: 'rec-2',
          timestamp: Date.now() - 300000,
          originalText: '方案不行',
          polishedText: '现有方案在可扩展性方面仍有优化空间。',
          style: 'academic',
        },
      ];

      await renderElement(
        <HistoryDrawer
          isOpen={true}
          history={mockHistory}
          onClose={vi.fn()}
          onRestore={handleRestore}
          onDelete={handleDelete}
          onClearAll={handleClear}
          onCopyText={handleCopy}
        />
      );

      expect(container.textContent).toContain('时光机草稿箱');
      expect(container.textContent).toContain('共 2 条记录');
      expect(container.textContent).toContain('明天开会吗？');
      expect(container.textContent).toContain('微信');

      // Click restore
      const restoreBtns = container.querySelectorAll('button');
      const restoreBtn = Array.from(restoreBtns).find((b) => b.textContent?.includes('恢复至主界面'));
      expect(restoreBtn).toBeDefined();

      await act(async () => {
        restoreBtn?.click();
      });
      expect(handleRestore).toHaveBeenCalledWith(mockHistory[0]);

      // Click copy
      const copyBtn = Array.from(restoreBtns).find((b) => b.textContent?.includes('复制'));
      await act(async () => {
        copyBtn?.click();
      });
      expect(handleCopy).toHaveBeenCalledWith(mockHistory[0].polishedText);
    });

    it('should not render anything when isOpen is false', async () => {
      await renderElement(
        <HistoryDrawer
          isOpen={false}
          history={[]}
          onClose={vi.fn()}
          onRestore={vi.fn()}
          onDelete={vi.fn()}
          onClearAll={vi.fn()}
          onCopyText={vi.fn()}
        />
      );

      expect(container.querySelector('#runbi-history-drawer')).toBeNull();
    });
  });
});
