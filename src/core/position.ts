/**
 * Viewport Coordinate Calculation & Collision Avoidance Engine
 * Part of Runbi Chrome Extension (Manifest V3)
 */

import type { PositionCoordinates } from '../types/selection';

export interface CollisionInput {
  rect: { top: number; right: number; bottom: number; left: number };
  windowWidth?: number;
  windowHeight?: number;
  scrollX?: number;
  scrollY?: number;
  elementWidth?: number;
  elementHeight?: number;
  margin?: number;
  topThreshold?: number;
}

export interface PanelPositionOptions {
  panelWidth?: number;
  panelHeight?: number;
  windowWidth?: number;
  windowHeight?: number;
  scrollX?: number;
  scrollY?: number;
  margin?: number;
}

export const CAPSULE_DEFAULT_SIZE = 28;
export const PANEL_DEFAULT_WIDTH = 400;
export const PANEL_DEFAULT_HEIGHT = 360;
export const TOP_COLLISION_THRESHOLD = 40;
export const VIEWPORT_MARGIN = 8;

/**
 * Calculates placement for floating elements (trigger capsule or generic overlay)
 * with top/right boundary collision detection and viewport clamping.
 */
export function calculatePlacement(input: CollisionInput): PositionCoordinates {
  const elWidth = input.elementWidth ?? CAPSULE_DEFAULT_SIZE;
  const elHeight = input.elementHeight ?? CAPSULE_DEFAULT_SIZE;
  const margin = input.margin ?? VIEWPORT_MARGIN;
  const topThreshold = input.topThreshold ?? TOP_COLLISION_THRESHOLD;

  const winWidth = input.windowWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const winHeight = input.windowHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const sX = input.scrollX ?? (typeof window !== 'undefined' ? window.scrollX || 0 : 0);
  const sY = input.scrollY ?? (typeof window !== 'undefined' ? window.scrollY || 0 : 0);

  let top = input.rect.top + sY - elHeight - margin;
  let left = input.rect.right + sX + 4;
  let verticalPlacement: 'top' | 'bottom' = 'top';
  let horizontalPlacement: 'right' | 'left' = 'right';

  // 1. Top collision: if space above selection is insufficient (< 40px), flip to below
  if (input.rect.top < topThreshold) {
    top = input.rect.bottom + sY + margin;
    verticalPlacement = 'bottom';
  }

  // 2. Right collision: if element overflows right viewport boundary, flip to left
  if (input.rect.right + elWidth + 4 > winWidth) {
    left = input.rect.left + sX - elWidth - 4;
    horizontalPlacement = 'left';
  }

  // 3. Left clamping: ensure not off-screen to the left
  if (left < sX + margin) {
    left = sX + margin;
  }

  // 4. Right clamping: ensure not off-screen to the right
  if (left + elWidth > sX + winWidth - margin) {
    left = Math.max(sX + margin, sX + winWidth - elWidth - margin);
  }

  // 5. Bottom clamping: ensure not off-screen to the bottom
  if (top + elHeight > sY + winHeight - margin) {
    top = Math.max(sY + margin, sY + winHeight - elHeight - margin);
  }

  return {
    top,
    left,
    placement: `${verticalPlacement}-${horizontalPlacement}` as PositionCoordinates['placement'],
  };
}

/**
 * Calculates 28px Trigger Capsule position relative to a selection DOMRect.
 */
export function calculateCapsulePosition(
  rect: DOMRect | { top: number; right: number; bottom: number; left: number },
  options?: Partial<CollisionInput>
): PositionCoordinates {
  return calculatePlacement({
    rect,
    elementWidth: CAPSULE_DEFAULT_SIZE,
    elementHeight: CAPSULE_DEFAULT_SIZE,
    margin: VIEWPORT_MARGIN,
    topThreshold: TOP_COLLISION_THRESHOLD,
    ...options,
  });
}

/**
 * Calculates Polishing Panel (380-420px) viewport coordinates from selection DOMRect.
 * Default placement floats below selection; flips above if bottom space is restricted.
 */
export function calculatePanelPosition(
  rect: DOMRect | { top: number; right: number; bottom: number; left: number },
  options?: PanelPositionOptions
): PositionCoordinates {
  const panelWidth = options?.panelWidth ?? PANEL_DEFAULT_WIDTH;
  const panelHeight = options?.panelHeight ?? PANEL_DEFAULT_HEIGHT;
  const margin = options?.margin ?? 10;

  const winWidth = options?.windowWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const winHeight = options?.windowHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const sX = options?.scrollX ?? (typeof window !== 'undefined' ? window.scrollX || 0 : 0);
  const sY = options?.scrollY ?? (typeof window !== 'undefined' ? window.scrollY || 0 : 0);

  let top = inputTopPreference(rect.bottom + sY + margin, panelHeight, winHeight, sY, rect.top + sY, margin);
  let left = rect.left + sX;
  let verticalPlacement: 'bottom' | 'top' = 'bottom';
  let horizontalPlacement: 'right' | 'left' = 'right';

  // Check if panel flipped above
  if (top < rect.top + sY) {
    verticalPlacement = 'top';
  }

  // Horizontal overflow check
  if (left + panelWidth > sX + winWidth - margin) {
    left = sX + winWidth - panelWidth - margin;
    horizontalPlacement = 'left';
  }

  // Left boundary clamping
  if (left < sX + margin) {
    left = sX + margin;
  }

  return {
    top,
    left,
    placement: `${verticalPlacement}-${horizontalPlacement}` as PositionCoordinates['placement'],
  };
}

function inputTopPreference(
  preferredBottomTop: number,
  panelHeight: number,
  winHeight: number,
  scrollY: number,
  selectionTopWithScroll: number,
  margin: number
): number {
  // If panel fits below selection within viewport
  if (preferredBottomTop + panelHeight <= scrollY + winHeight - margin) {
    return preferredBottomTop;
  }

  // Space above check
  const aboveTop = selectionTopWithScroll - panelHeight - margin;
  if (aboveTop >= scrollY + margin) {
    return aboveTop;
  }

  // Fallback: clamp to available viewport height
  return Math.max(scrollY + margin, scrollY + winHeight - panelHeight - margin);
}

/**
 * Clamps coordinates strictly within min/max bounds.
 */
export function clampCoordinates(
  coords: PositionCoordinates,
  bounds?: { minTop?: number; maxTop?: number; minLeft?: number; maxLeft?: number }
): PositionCoordinates {
  const minTop = bounds?.minTop ?? 0;
  const minLeft = bounds?.minLeft ?? 0;

  let top = Math.max(minTop, coords.top);
  let left = Math.max(minLeft, coords.left);

  if (bounds?.maxTop !== undefined) {
    top = Math.min(bounds.maxTop, top);
  }
  if (bounds?.maxLeft !== undefined) {
    left = Math.min(bounds.maxLeft, left);
  }

  return {
    top,
    left,
    placement: coords.placement,
  };
}
