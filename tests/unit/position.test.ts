import { describe, it, expect } from 'vitest';
import {
  calculatePlacement,
  calculateCapsulePosition,
  calculatePanelPosition,
  clampCoordinates,
  CAPSULE_DEFAULT_SIZE,
  PANEL_DEFAULT_WIDTH,
  PANEL_DEFAULT_HEIGHT,
  TOP_COLLISION_THRESHOLD,
  VIEWPORT_MARGIN,
} from '../../src/core/position';

describe('src/core/position.ts Unit Tests', () => {
  // =========================================================================
  // 1. calculatePlacement Tests
  // =========================================================================
  describe('calculatePlacement', () => {
    it('should compute default top-right placement in open space', () => {
      const rect = { top: 200, right: 400, bottom: 230, left: 300 };
      const res = calculatePlacement({
        rect,
        windowWidth: 1920,
        windowHeight: 1080,
        scrollX: 0,
        scrollY: 100,
        elementWidth: 28,
        elementHeight: 28,
        margin: 8,
      });

      expect(res.placement).toBe('top-right');
      expect(res.top).toBe(200 + 100 - 28 - 8); // 264
      expect(res.left).toBe(400 + 4); // 404
    });

    it('should flip vertically to bottom when rect.top < 40px threshold', () => {
      const rect = { top: 25, right: 500, bottom: 55, left: 400 };
      const res = calculatePlacement({
        rect,
        windowWidth: 1920,
        windowHeight: 1080,
        scrollX: 0,
        scrollY: 0,
        elementWidth: 28,
        elementHeight: 28,
        margin: 8,
        topThreshold: 40,
      });

      expect(res.placement).toBe('bottom-right');
      expect(res.top).toBe(55 + 8); // 63
      expect(res.left).toBe(504);
    });

    it('should flip horizontally to left when right edge collides with viewport', () => {
      const rect = { top: 200, right: 1915, bottom: 230, left: 1800 };
      const res = calculatePlacement({
        rect,
        windowWidth: 1920,
        windowHeight: 1080,
        scrollX: 0,
        scrollY: 0,
        elementWidth: 28,
        elementHeight: 28,
      });

      expect(res.placement).toBe('top-left');
      expect(res.left).toBe(1800 - 28 - 4); // 1768
    });

    it('should flip to bottom-left when colliding both top and right boundaries', () => {
      const rect = { top: 15, right: 1910, bottom: 45, left: 1800 };
      const res = calculatePlacement({
        rect,
        windowWidth: 1920,
        windowHeight: 1080,
        scrollX: 0,
        scrollY: 0,
        elementWidth: 28,
        elementHeight: 28,
      });

      expect(res.placement).toBe('bottom-left');
      expect(res.top).toBe(45 + 8);
      expect(res.left).toBe(1800 - 28 - 4);
    });

    it('should handle scroll offsets correctly', () => {
      const rect = { top: 150, right: 500, bottom: 180, left: 400 };
      const res = calculatePlacement({
        rect,
        windowWidth: 1920,
        windowHeight: 1080,
        scrollX: 250,
        scrollY: 600,
      });

      expect(res.top).toBe(150 + 600 - 28 - 8);
      expect(res.left).toBe(500 + 250 + 4);
    });

    it('should clamp coordinates within left margin boundary', () => {
      const rect = { top: 100, right: 10, bottom: 120, left: 0 };
      const res = calculatePlacement({
        rect,
        windowWidth: 1920,
        windowHeight: 1080,
        scrollX: 0,
        scrollY: 0,
        elementWidth: 28,
      });

      expect(res.left).toBeGreaterThanOrEqual(8);
    });

    it('should clamp coordinates within bottom viewport margin boundary', () => {
      const rect = { top: 1070, right: 400, bottom: 1078, left: 300 };
      const res = calculatePlacement({
        rect,
        windowWidth: 1920,
        windowHeight: 1080,
        scrollX: 0,
        scrollY: 0,
        elementWidth: 28,
        elementHeight: 28,
      });

      expect(res.top + 28).toBeLessThanOrEqual(1080 - 8);
    });
  });

  // =========================================================================
  // 2. calculateCapsulePosition Tests
  // =========================================================================
  describe('calculateCapsulePosition', () => {
    it('should use 28px default capsule dimensions', () => {
      const rect = new DOMRect(200, 300, 100, 30);
      const res = calculateCapsulePosition(rect, {
        windowWidth: 1000,
        windowHeight: 800,
        scrollX: 0,
        scrollY: 0,
      });

      expect(res.placement).toBe('top-right');
      expect(res.top).toBe(300 - 28 - 8);
      expect(res.left).toBe(300 + 4);
    });
  });

  // =========================================================================
  // 3. calculatePanelPosition Tests
  // =========================================================================
  describe('calculatePanelPosition', () => {
    it('should place panel below selection by default', () => {
      const rect = new DOMRect(100, 200, 150, 40);
      const res = calculatePanelPosition(rect, {
        panelWidth: 400,
        panelHeight: 360,
        windowWidth: 1920,
        windowHeight: 1080,
        scrollX: 0,
        scrollY: 0,
      });

      expect(res.placement).toBe('bottom-right');
      expect(res.top).toBe(240 + 10);
      expect(res.left).toBe(100);
    });

    it('should flip panel above selection when bottom space overflows', () => {
      const rect = new DOMRect(200, 800, 150, 40); // bottom = 840, space below = 1080 - 840 = 240 < 360
      const res = calculatePanelPosition(rect, {
        panelWidth: 400,
        panelHeight: 360,
        windowWidth: 1920,
        windowHeight: 1080,
        scrollX: 0,
        scrollY: 0,
      });

      expect(res.placement).toBe('top-right');
      expect(res.top).toBe(800 - 360 - 10);
      expect(res.left).toBe(200);
    });

    it('should clamp horizontal position when panel overflows right edge', () => {
      const rect = new DOMRect(1700, 200, 100, 30);
      const res = calculatePanelPosition(rect, {
        panelWidth: 400,
        panelHeight: 360,
        windowWidth: 1920,
        windowHeight: 1080,
      });

      expect(res.placement).toBe('bottom-left');
      expect(res.left).toBe(1920 - 400 - 10);
    });
  });

  // =========================================================================
  // 4. clampCoordinates Tests
  // =========================================================================
  describe('clampCoordinates', () => {
    it('should clamp negative top and left coordinates to 0', () => {
      const clamped = clampCoordinates({ top: -100, left: -50, placement: 'top-left' });
      expect(clamped.top).toBe(0);
      expect(clamped.left).toBe(0);
      expect(clamped.placement).toBe('top-left');
    });

    it('should respect custom min and max bounds', () => {
      const coords = { top: 2000, left: 1500, placement: 'bottom-right' as const };
      const clamped = clampCoordinates(coords, {
        minTop: 10,
        maxTop: 800,
        minLeft: 10,
        maxLeft: 1200,
      });

      expect(clamped.top).toBe(800);
      expect(clamped.left).toBe(1200);
    });
  });
});
