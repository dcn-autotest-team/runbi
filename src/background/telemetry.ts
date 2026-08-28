/**
 * @file src/background/telemetry.ts
 * Runbi Background Telemetry (Error Reporting) — Sentry SDK, GlitchTip-ready
 *
 * Privacy-first design:
 *  - ALL telemetry is opt-in, default OFF (mirrors the P0-3 screenshot gate).
 *  - DSN & enabled flag live in chrome.storage.local under keys:
 *      telemetry.enabled (boolean, default false)
 *      telemetry.dsn    (string,  default '')
 *  - Uses makeFetchTransport (fetch) because MV3 service workers have no XHR.
 *  - DSN is Sentry-compatible; point it at GlitchTip and nothing else changes.
 */

import * as Sentry from '@sentry/browser';

const ENABLED_KEY = 'telemetry.enabled';
const DSN_KEY = 'telemetry.dsn';

/** Current runtime state (cached after init). */
let telemetryEnabled = false;
let telemetryDsn = '';

/**
 * (Re)initializes Sentry from storage. Call after install and whenever
 * telemetry settings change. Safe to call repeatedly.
 */
export async function initTelemetry(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([ENABLED_KEY, DSN_KEY]);
    telemetryEnabled = Boolean(stored[ENABLED_KEY]);
    telemetryDsn = (stored[DSN_KEY] as string) || '';

    if (!telemetryEnabled || !telemetryDsn) {
      if (Sentry.getClient()) {
        await Sentry.close();
      }
      return;
    }

    if (Sentry.getClient()) {
      await Sentry.close();
    }

    Sentry.init({
      dsn: telemetryDsn,
      // fetch-based transport — MV3 service workers have no XMLHttpRequest
      transport: (options) => Sentry.makeFetchTransport(options),
      beforeSend(event) {
        // Strip request payload info — privacy for BYOK users.
        if (event.request) delete event.request;
        return event;
      },
    });

    Sentry.setTag('runtime', 'extension-mv3');
    console.log('[Runbi] telemetry enabled');
  } catch (err) {
    console.warn('[Runbi] telemetry init failed:', err);
  }
}

/** Whether telemetry is currently active (useful for status UI). */
export function isTelemetryEnabled(): boolean {
  return telemetryEnabled && telemetryDsn !== '';
}

/**
 * Sends a manual exception. No-op unless telemetry is enabled AND a DSN is set.
 */
export function captureTelemetryError(err: unknown, context?: Record<string, unknown>): void {
  if (!isTelemetryEnabled()) return;
  try {
    Sentry.captureException(err, context ? { extra: context } : undefined);
  } catch (_) {
    // swallow — telemetry must never be a failure point
  }
}

/**
 * Submits a user feedback message (opt-in, same policy as telemetry).
 * Mirrors the desktop `submit_feedback` semantics: prefix "[用户反馈] ",
 * Info level, and if telemetry is disabled we return a clear signal instead
 * of silently dropping the feedback so the UI can guide the user.
 *
 * Returns:
 *   'telemetry_disabled' -> no DSN enabled, feedback NOT sent
 *   'queued'             -> sent for async processing
 *   'event_id=<id>'      -> sent synchronously
 */
export function captureFeedback(message: string): Promise<string> {
  if (!isTelemetryEnabled()) {
    return Promise.resolve('telemetry_disabled');
  }
  try {
    const eventId = Sentry.captureMessage(`[用户反馈] ${message}`, 'info');
    return Promise.resolve(eventId ? `event_id=${eventId}` : 'queued');
  } catch (_) {
    return Promise.resolve('queued');
  }
}