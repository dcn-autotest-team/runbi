/**
 * runbi 错误上报客户端 — GlitchTip (Sentry 兼容协议)
 *
 * 用法: 在应用入口 (App.tsx / main.ts) 调用 initErrorReporting() 一次。
 * 之后任何未捕获异常/手动捕获错误都会自动上报到 GlitchTip。
 *
 * DSN 格式: http://<PUBLIC_KEY>@<host>:<port>/<project_id>
 * 例如: http://9870fb70c1544eebaeb8a1882f3c00bd@localhost:8000/1
 */
const DEFAULT_DSN = (import.meta as any).env?.VITE_GLITCHTIP_DSN
  ?? 'http://9870fb70c1544eebaeb8a1882f3c00bd@localhost:8000/1';

interface Envelope {
  event_id: string;
  sent_at: string;
  sdk: { name: string; version: string };
}

interface ErrorEvent {
  event_id: string;
  timestamp: string;
  platform: string;
  level: string;
  logger: string;
  message: { formatted: string };
  culprit?: string;
  server_name?: string;
  release?: string;
  environment?: string;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function parseDsn(dsn: string): { host: string; publicKey: string; projectId: string } {
  // http://<PUBLIC>@<host>:<port>/<projectId>
  const m = dsn.match(/^https?:\/\/([^@]+)@([^/]+)\/(\d+)(?:\/)?/);
  if (!m) throw new Error('Invalid DSN: ' + dsn);
  return { publicKey: m[1], host: m[2], projectId: m[3] };
}

export interface ErrorReportingConfig {
  dsn?: string;
  release?: string;
  environment?: string;
  /** 需要附加到事件的用户上下文, 例如 { id, email } */
  user?: Record<string, unknown>;
  /** 采样率 0~1, 生产可降到 0.1 以降噪 */
  sampleRate?: number;
  /** 附加标签, 例如 { platform: 'desktop' | 'extension' } */
  tags?: Record<string, string>;
}

export class ErrorReporter {
  private dsn: string;
  private release?: string;
  private environment?: string;
  private user?: Record<string, unknown>;
  private sampleRate: number;
  private tags: Record<string, string>;

  constructor(config: ErrorReportingConfig) {
    this.dsn = config.dsn ?? DEFAULT_DSN;
    this.release = config.release;
    this.environment = config.environment ?? (import.meta as any).env?.MODE ?? 'development';
    this.user = config.user;
    this.sampleRate = config.sampleRate ?? 1;
    this.tags = config.tags ?? {};
  }

  setUser(user: Record<string, unknown> | undefined): void {
    this.user = user;
  }

  private eventId(): string {
    return uuid().replace(/-/g, '');
  }

  /**
   * 手动上报一个错误/异常。
   * @param error 错误对象或消息字符串
   * @param extra 附加数据(如上下文、当时的选中文本等)
   */
  async captureException(error: unknown, extra?: Record<string, unknown>): Promise<string | null> {
    if (Math.random() > this.sampleRate) return null;
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error && error.stack ? error.stack : undefined;
    const eventId = this.eventId();

    const event: ErrorEvent = {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      platform: 'javascript',
      level: 'error',
      logger: 'javascript',
      message: { formatted: message },
      culprit: this.extractCulprit(stack),
      environment: this.environment,
      release: this.release,
      server_name: this.tags.platform,
      extra: { ...extra },
      contexts: {
        runtime: {
          name: typeof navigator !== 'undefined' && navigator.userAgent ? 'browser' : 'node',
          version: typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : process.version,
        },
      },
    };
    if (stack) (event as any).exception = { values: [{ type: error instanceof Error ? error.name : 'Error', value: message, stacktrace: { frames: [] } }] };
    if (this.user) event.user = this.user as any;
    if (Object.keys(this.tags).length) event.tags = this.tags as any;

    try {
      await this.sendEvent(event);
    } catch (e) {
      // 上报本身失败不阻塞业务
      console.warn('[runbi-error-report] report failed', e);
      return null;
    }
    return eventId;
  }

  private extractCulprit(stack?: string): string | undefined {
    if (!stack) return undefined;
    const lines = stack.split('\n').map((l) => l.trim());
    for (const line of lines.slice(1)) {
      const m = line.match(/at\s+(.+?)\s+\(?(.+?):(\d+):(\d+)\)?$/);
      if (m) return `${m[1]} (${m[2]}:${m[3]})`;
    }
    return undefined;
  }

  private async sendEvent(event: ErrorEvent): Promise<void> {
    const { host, publicKey, projectId } = parseDsn(this.dsn);
    const scheme = this.dsn.startsWith('https') ? 'https' : 'http';
    const url = `${scheme}://${host}/api/${projectId}/envelope/`;
    const auth = `Sentry sentry_version=7, sentry_client=runbi/0.1.0, sentry_key=${publicKey}`;

    const envelopeHeader: Envelope = {
      event_id: event.event_id,
      sent_at: new Date().toISOString(),
      sdk: { name: 'runbi-js', version: '0.1.0' },
    };

    const body = JSON.stringify(envelopeHeader) + '\n' + JSON.stringify(event);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': auth,
      },
      body,
    });
    if (!res.ok && res.status !== 200 && res.status !== 202) {
      throw new Error(`envelope ingest ${res.status}`);
    }
  }
}

let singleton: ErrorReporter | null = null;

/** 在应用入口调用一次即可 */
export function initErrorReporting(config: ErrorReportingConfig = {}): ErrorReporter {
  if (singleton) return singleton;
  singleton = new ErrorReporter(config);

  // 全局未捕获错误
  window.addEventListener?.('error', (e) => {
    singleton?.captureException(e.error ?? e.message, { type: 'window.onerror' });
  });
  window.addEventListener?.('unhandledrejection', (e) => {
    singleton?.captureException(e.reason, { type: 'unhandledrejection' });
  });
  return singleton;
}

/** 获取全局实例 */
export function getErrorReporter(): ErrorReporter | null {
  return singleton;
}
