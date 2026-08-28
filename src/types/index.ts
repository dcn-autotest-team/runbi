/**
 * Type Contracts for Runbi Chrome Extension
 * Single source of truth lives in @runbi/shared/types; stream types stay local
 * because the extension background worker owns them.
 */

export * from './stream';
export type { SelectionInfo, PositionCoordinates } from '@runbi/shared/types/selection';
export type { DiffChunk, DiffType } from '@runbi/shared/types/diff';
