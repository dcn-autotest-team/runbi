/**
 * Diff Chunk Format Interface Contracts
 */

export type DiffType = 'equal' | 'delete' | 'insert';

export interface DiffChunk {
  type: DiffType;
  value: string;
}
