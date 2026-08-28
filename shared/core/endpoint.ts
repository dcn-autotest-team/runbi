/**
 * @file shared/core/endpoint.ts
 * Endpoint Normalization Utility
 *
 * Normalizes user-supplied base URLs or full URLs to standard chat-completions endpoint.
 * Prevents 404 double concatenation bugs across Chrome Extension and Desktop.
 */

/**
 * Users may paste a base URL (e.g. `https://api.deepseek.com/v1`) or a full URL (`.../v1/chat/completions`).
 * Always resolves cleanly to the chat completions endpoint without double-appending.
 */
export function resolveEndpoint(baseUrl?: string): string {
  const url = (baseUrl?.trim() || 'https://api.deepseek.com/v1/chat/completions').replace(/\/+$/, '');
  return url.endsWith('/chat/completions') ? url : `${url}/chat/completions`;
}

/**
 * Validates if an endpoint is secure (uses HTTPS or local loopback).
 */
export function isSecureEndpoint(endpointUrl: string): boolean {
  if (!endpointUrl) return true;
  const trimmed = endpointUrl.trim().toLowerCase();
  return (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://localhost') ||
    trimmed.startsWith('http://127.0.0.1')
  );
}
