/**
 * @file desktop/src/adapters/index.ts
 * Barrel export for Desktop Platform Adapters
 */

export * from './TauriSelectionProvider';
export * from './TauriTextReplacer';
export * from './TauriStorageProvider';
export * from './TauriIPCLLMTransport';

import { TauriSelectionProvider } from './TauriSelectionProvider';
import { TauriTextReplacer } from './TauriTextReplacer';
import { TauriStorageProvider } from './TauriStorageProvider';
import { TauriIPCLLMTransport } from './TauriIPCLLMTransport';

export interface DesktopAdapters {
  selectionProvider: TauriSelectionProvider;
  textReplacer: TauriTextReplacer;
  storageProvider: TauriStorageProvider;
  llmTransport: TauriIPCLLMTransport;
}

/**
 * Creates and initializes the unified suite of desktop adapters.
 */
export function createDesktopAdapters(): DesktopAdapters {
  return {
    selectionProvider: new TauriSelectionProvider(),
    textReplacer: new TauriTextReplacer(),
    storageProvider: new TauriStorageProvider(),
    llmTransport: new TauriIPCLLMTransport(),
  };
}
