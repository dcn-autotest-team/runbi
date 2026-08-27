/**
 * Selection & Coordinate Interface Contracts
 */

export interface SelectionInfo {
  text: string;
  rawText: string;
  rect: DOMRect;
  isEditable: boolean;
  targetElement: HTMLElement | null;
  savedRange: Range | null;
}

export interface PositionCoordinates {
  top: number;
  left: number;
  placement: 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left';
}
