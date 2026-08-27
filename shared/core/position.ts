/**
 * @file shared/core/position.ts
 * Pure 2D Geometric Placement, Viewport Collision & Multi-Monitor Screen Clamping
 * 100% Pure Logic — Platform Agnostic (Zero DOM / Window Globals)
 */

import type { SelectionRect, PositionCoordinates, MonitorWorkArea } from '../types/selection';
export type { MonitorWorkArea };

export interface ViewportBounds {
  width: number;
  height: number;
  scrollX?: number;
  scrollY?: number;
}

export interface CollisionInput {
  rect: SelectionRect;
  viewport?: ViewportBounds;
  elementWidth?: number;
  elementHeight?: number;
  margin?: number;
  topThreshold?: number;
}

export interface PanelPositionOptions {
  panelWidth?: number;
  panelHeight?: number;
  viewport?: ViewportBounds;
  margin?: number;
  // Backward-compatible individual fields
  windowWidth?: number;
  windowHeight?: number;
  scrollX?: number;
  scrollY?: number;
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

  const winWidth = input.viewport?.width ?? 1920;
  const winHeight = input.viewport?.height ?? 1080;
  const sX = input.viewport?.scrollX ?? 0;
  const sY = input.viewport?.scrollY ?? 0;

  let top = input.rect.top + sY - elHeight - margin;
  let left = input.rect.right + sX + 4;
  let verticalPlacement: 'top' | 'bottom' = 'top';
  let horizontalPlacement: 'right' | 'left' = 'right';

  // 1. Top collision: if space above selection is insufficient (< 40px), flip to bottom
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
    placement: `${verticalPlacement}-${horizontalPlacement}`,
  };
}

/**
 * Calculates 28px Trigger Capsule position relative to a selection bounding rect.
 */
export function calculateCapsulePosition(
  rect: SelectionRect,
  options?: Partial<CollisionInput> & {
    windowWidth?: number;
    windowHeight?: number;
    scrollX?: number;
    scrollY?: number;
  }
): PositionCoordinates {
  const viewport: ViewportBounds = options?.viewport ?? {
    width: options?.windowWidth ?? 1920,
    height: options?.windowHeight ?? 1080,
    scrollX: options?.scrollX ?? 0,
    scrollY: options?.scrollY ?? 0,
  };

  return calculatePlacement({
    rect,
    viewport,
    elementWidth: CAPSULE_DEFAULT_SIZE,
    elementHeight: CAPSULE_DEFAULT_SIZE,
    margin: VIEWPORT_MARGIN,
    topThreshold: TOP_COLLISION_THRESHOLD,
    ...options,
  });
}

/**
 * Calculates Polishing Panel (380-420px) viewport coordinates from selection rect.
 * Default placement floats below selection; flips above if bottom space is restricted.
 */
export function calculatePanelPosition(
  rect: SelectionRect,
  options?: PanelPositionOptions
): PositionCoordinates {
  const panelWidth = options?.panelWidth ?? PANEL_DEFAULT_WIDTH;
  const panelHeight = options?.panelHeight ?? PANEL_DEFAULT_HEIGHT;
  const margin = options?.margin ?? 10;

  const winWidth = options?.viewport?.width ?? options?.windowWidth ?? 1920;
  const winHeight = options?.viewport?.height ?? options?.windowHeight ?? 1080;
  const sX = options?.viewport?.scrollX ?? options?.scrollX ?? 0;
  const sY = options?.viewport?.scrollY ?? options?.scrollY ?? 0;

  let top = inputTopPreference(
    rect.bottom + sY + margin,
    panelHeight,
    winHeight,
    sY,
    rect.top + sY,
    margin
  );
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
    placement: `${verticalPlacement}-${horizontalPlacement}`,
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
  if (preferredBottomTop + panelHeight <= scrollY + winHeight - margin) {
    return preferredBottomTop;
  }

  const aboveTop = selectionTopWithScroll - panelHeight - margin;
  if (aboveTop >= scrollY + margin) {
    return aboveTop;
  }

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

/**
 * Clamps a window coordinate to remain fully inside a multi-monitor work area.
 * Used by Desktop client (Tauri / Win32) to prevent Raycast window clipping.
 */
export function clampToMonitorWorkArea(
  x: number,
  y: number,
  windowWidth: number,
  windowHeight: number,
  workArea: MonitorWorkArea,
  padding: number = 10
): { x: number; y: number } {
  const minX = workArea.x + padding;
  const maxX = workArea.x + workArea.width - windowWidth - padding;
  const minY = workArea.y + padding;
  const maxY = workArea.y + workArea.height - windowHeight - padding;

  const clampedX = Math.min(Math.max(x, minX), Math.max(minX, maxX));
  const clampedY = Math.min(Math.max(y, minY), Math.max(minY, maxY));

  return { x: clampedX, y: clampedY };
}
