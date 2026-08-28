/**
 * Runbi Background Service Worker Entry Point
 * Part of Runbi Chrome Extension (Manifest V3)
 */

import { setupStreamPortHandler, testApiConnection } from './streamHandler';
import { initTelemetry, captureTelemetryError } from './telemetry';

console.log('[Runbi] Background Service Worker initialized');

// Initialize privacy-first telemetry (opt-in, default off)
initTelemetry();

// Global error/unhandledrejection capture → routes to Sentry if enabled
self.addEventListener('error', (event) => {
  captureTelemetryError(event?.error || event.message, { type: 'uncaught' });
});
self.addEventListener('unhandledrejection', (event) => {
  captureTelemetryError(event?.reason, { type: 'unhandledrejection' });
});

// (Re)init telemetry whenever settings change
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === 'local' && (changes['telemetry.enabled'] || changes['telemetry.dsn'])) {
    initTelemetry();
  }
});

// Setup Port-based SSE streaming listener
setupStreamPortHandler();

// Listen for lifecycle events
chrome.runtime.onInstalled?.addListener((details) => {
  console.log('[Runbi] Extension installed/updated:', details?.reason);
  // Initialize default storage values if not present
  chrome.storage?.local?.get(['enabled', 'triggerMode', 'provider', 'baseUrl', 'model'], (result) => {
    const defaults: Record<string, any> = {};
    if (result?.enabled === undefined) defaults.enabled = true;
    if (result?.triggerMode === undefined) defaults.triggerMode = 'capsule';
    if (result?.provider === undefined) defaults.provider = 'deepseek';
    if (result?.baseUrl === undefined) defaults.baseUrl = 'https://api.deepseek.com/v1';
    if (result?.model === undefined) defaults.model = 'deepseek-chat';
    if (Object.keys(defaults).length > 0) {
      chrome.storage.local.set(defaults);
    }
  });
});

// Runtime message listener for one-off requests (options page test connection, config sync)
chrome.runtime.onMessage?.addListener((message, _sender, sendResponse) => {
  if (message?.action === 'TEST_CONNECTION') {
    testApiConnection(message.payload || {})
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err?.message || '测试失败' }));
    return true;
  }

  if (message?.action === 'GET_CONFIG') {
    chrome.storage.local
      .get(message.keys || null)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err?.message }));
    return true;
  }

  if (message?.action === 'SAVE_CONFIG') {
    chrome.storage.local
      .set(message.payload || {})
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err?.message }));
    return true;
  }
});
