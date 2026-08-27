/**
 * @file tests/unit/shared-position.test.ts
 * Unit tests for Coordinate Geometry & Viewport/Monitor Math (@runbi/shared/core/position)
 */

import { describe, it, expect } from 'vitest';
import {
  calculatePlacement,
  calculateCapsulePosition,
  calculatePanelPosition,
  clampCoordinates,
  clampToMonitorWorkArea,
} from '@runbi/shared/core/position';
import type { SelectionRect } from '@runbi/shared/types/selection';

describe('Shared Core: 2D Geometry & Viewport/Monitor Placement Math', () => {
  const normalRect: SelectionRect = {
    top: 200,
    bottom: 220,
    left: 300,
    right: 450,
  };

  const viewport = {
    width: 1920,
    height: 1080,
    scrollX: 0,
    scrollY: 0,
  };

  describe('calculateCapsulePosition', () => {
    it('should place capsule above and to the right under standard conditions', () => {
      const pos = calculateCapsulePosition(normalRect, { viewport });
      expect(pos.top).toBeLessThan(normalRect.top);
      expect(pos.left).toBeGreaterThanOrEqual(normalRect.right);
      expect(pos.placement).toBe('top-right');
    });

    it('should flip vertically to bottom when top space is below threshold (<40px)', () => {
      const nearTopRect: SelectionRect = {
        top: 20,
        bottom: 35,
        left: 200,
        right: 300,
      };

      const pos = calculateCapsulePosition(nearTopRect, { viewport });
      expect(pos.top).toBeGreaterThan(nearTopRect.bottom);
      expect(pos.placement).toContain('bottom');
    });

    it('should flip horizontally to left when right viewport edge is restricted', () => {
      const nearRightRect: SelectionRect = {
        top: 200,
        bottom: 220,
        left: 1880,
        right: 1910,
      };

      const pos = calculateCapsulePosition(nearRightRect, { viewport });
      expect(pos.left).toBeLessThan(nearRightRect.left);
      expect(pos.placement).toContain('left');
    });
  });

  describe('calculatePanelPosition', () => {
    it('should place panel below selection by default', () => {
      const pos = calculatePanelPosition(normalRect, {
        viewport,
        panelWidth: 400,
        panelHeight: 300,
      });

      expect(pos.top).toBeGreaterThanOrEqual(normalRect.bottom);
      expect(pos.placement).toContain('bottom');
    });

    it('should flip above selection when bottom viewport space is insufficient', () => {
      const nearBottomRect: SelectionRect = {
        top: 900,
        bottom: 920,
        left: 400,
        right: 500,
      };

      const pos = calculatePanelPosition(nearBottomRect, {
        viewport,
        panelWidth: 400,
        panelHeight: 300,
      });

      expect(pos.top).toBeLessThan(nearBottomRect.top);
      expect(pos.placement).toContain('top');
    });

    it('should clamp panel horizontal coordinate inside viewport with margin', () => {
      const rightAlignedRect: SelectionRect = {
        top: 200,
        bottom: 220,
        left: 1800,
        right: 1900,
      };

      const pos = calculatePanelPosition(rightAlignedRect, {
        viewport,
        panelWidth: 400,
        panelHeight: 300,
      });

      expect(pos.left + 400).toBeLessThanOrEqual(viewport.width);
    });
  });

  describe('clampCoordinates', () => {
    it('should restrict coordinates within min and max boundaries', () => {
      const input = { top: -10, left: 2000, placement: 'top-right' };
      const clamped = clampCoordinates(input, {
        minTop: 0,
        maxTop: 1080,
        minLeft: 0,
        maxLeft: 1920,
      });

      expect(clamped.top).toBe(0);
      expect(clamped.left).toBe(1920);
      expect(clamped.placement).toBe('top-right');
    });
  });

  describe('clampToMonitorWorkArea (Desktop Multi-Monitor Math)', () => {
    it('should clamp coordinates inside primary monitor work area', () => {
      const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
      const pos = clampToMonitorWorkArea(-50, 1200, 400, 300, workArea, 10);

      expect(pos.x).toBe(10); // minX
      expect(pos.y).toBe(1080 - 300 - 10); // maxY = 770
    });

    it('should clamp coordinates correctly inside a secondary monitor (offset x=1920)', () => {
      const secondMonitorWorkArea = { x: 1920, y: 0, width: 2560, height: 1440 };
      const pos = clampToMonitorWorkArea(1800, 500, 400, 300, secondMonitorWorkArea, 10);

      expect(pos.x).toBe(1920 + 10); // clamped to left of second monitor
      expect(pos.y).toBe(500);
    });
  });
});
