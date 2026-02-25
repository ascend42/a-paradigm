/**
 * Sentinel Client SDK
 *
 * Lightweight client for sending structured logs to the Sentinel server.
 * Features batching, ring buffer, auto-retry, and graceful degradation.
 *
 * Usage:
 *   import { createSentinelClient } from '@a-company/sentinel';
 *   const client = createSentinelClient({ service: 'my-app' });
 *   client.info('#checkout', 'Order placed', { orderId: '123' });
 *   await client.close();
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  LogEntryInput,
  LogLevel,
  MetricInput,
  ServiceRegistration,
  TraceSpanInput,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════
// PUBLIC INTERFACES
// ═══════════════════════════════════════════════════════════════════

export interface SentinelClientOptions {
  /** Sentinel server URL (default: http://localhost:3838) */
  url?: string;
  /** Service name (required) */
  service: string;
  /** Service version */
  version?: string;
  /** Environment (development, staging, production) */
  environment?: string;
  /** Auth token for protected servers */
  token?: string;
  /** Batch size before auto-flush (default: 50) */
  batchSize?: number;
  /** Flush interval in ms (default: 5000) */
  flushIntervalMs?: number;
  /** Max entries in ring buffer before dropping oldest (default: 1000) */
  maxBufferSize?: number;
  /** Max retry attempts on network failure (default: 3) */
  maxRetries?: number;
  /** Retry backoff base in ms (default: 1000) */
  retryBackoffMs?: number;
  /** Callback when entries are dropped from buffer overflow */
  onDrop?: (count: number) => void;
  /** Callback on flush error */
  onError?: (error: Error) => void;
}

export interface SpanContext {
  traceId: string;
  spanId: string;
  end: (status?: 'ok' | 'error') => Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════
// DEFAULT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const DEFAULTS = {
  url: 'http://localhost:3838',
  batchSize: 50,
  flushIntervalMs: 5000,
  maxBufferSize: 1000,
  maxRetries: 3,
  retryBackoffMs: 1000,
} as const;

// ═══════════════════════════════════════════════════════════════════
// SENTINEL CLIENT
// ═══════════════════════════════════════════════════════════════════

export class SentinelClient {
  private readonly url: string;
  private readonly service: string;
  private readonly version: string | undefined;
  private readonly environment: string | undefined;
  private readonly token: string | undefined;
  private readonly batchSize: number;
  private readonly maxBufferSize: number;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;
  private readonly onDrop: ((count: number) => void) | undefined;
  private readonly onError: ((error: Error) => void) | undefined;
  private readonly sessionId: string;

  private logBuffer: LogEntryInput[] = [];
  private metricsBuffer: MetricInput[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private beforeUnloadHandler: (() => void) | null = null;

  constructor(options: SentinelClientOptions) {
    this.url = (options.url ?? DEFAULTS.url).replace(/\/+$/, '');
    this.service = options.service;
    this.version = options.version;
    this.environment = options.environment;
    this.token = options.token;
    this.batchSize = options.batchSize ?? DEFAULTS.batchSize;
    this.maxBufferSize = options.maxBufferSize ?? DEFAULTS.maxBufferSize;
    this.maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
    this.retryBackoffMs = options.retryBackoffMs ?? DEFAULTS.retryBackoffMs;
    this.onDrop = options.onDrop;
    this.onError = options.onError;
    this.sessionId = uuidv4();

    // Start periodic flush
    const intervalMs = options.flushIntervalMs ?? DEFAULTS.flushIntervalMs;
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        this.handleError(err);
      });
    }, intervalMs);

    // Prevent the timer from blocking Node.js shutdown
    if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
      this.flushTimer.unref();
    }

    // Browser: flush on page unload to avoid losing buffered entries
    if (typeof globalThis !== 'undefined' && typeof globalThis.addEventListener === 'function') {
      this.beforeUnloadHandler = () => {
        this.flushSync();
      };
      globalThis.addEventListener('beforeunload', this.beforeUnloadHandler);
    }

    // Register service (fire-and-forget)
    this.registerService();
  }

  // ── Logging Methods ──────────────────────────────────────────────

  /** Log a debug-level message */
  debug(symbol: string, message: string, data?: Record<string, unknown>): void {
    this.log('debug', symbol, message, data);
  }

  /** Log an info-level message */
  info(symbol: string, message: string, data?: Record<string, unknown>): void {
    this.log('info', symbol, message, data);
  }

  /** Log a warn-level message */
  warn(symbol: string, message: string, data?: Record<string, unknown>): void {
    this.log('warn', symbol, message, data);
  }

  /** Log an error-level message */
  error(symbol: string, message: string, data?: Record<string, unknown>): void {
    this.log('error', symbol, message, data);
  }

  /** Log a message at the specified level */
  log(level: LogLevel, symbol: string, message: string, data?: Record<string, unknown>): void {
    if (this.closed) return;

    const entry: LogEntryInput = {
      level,
      symbol,
      message,
      service: this.service,
      sessionId: this.sessionId,
      environment: this.environment,
      data,
    };

    this.pushToLogBuffer(entry);
  }

  // ── Metrics Methods ──────────────────────────────────────────────

  /** Record a counter metric (increments) */
  counter(name: string, value?: number, tags?: Record<string, string>): void {
    this.metric({ name, type: 'counter', value: value ?? 1, tags });
  }

  /** Record a gauge metric (current value) */
  gauge(name: string, value: number, tags?: Record<string, string>): void {
    this.metric({ name, type: 'gauge', value, tags });
  }

  /** Record a histogram metric (distribution) */
  histogram(name: string, value: number, tags?: Record<string, string>): void {
    this.metric({ name, type: 'histogram', value, tags });
  }

  /** Record a metric of any type */
  metric(input: Omit<MetricInput, 'service'>): void {
    if (this.closed) return;

    const entry: MetricInput = {
      ...input,
      service: this.service,
      environment: this.environment,
    };

    this.pushToMetricsBuffer(entry);
  }

  // ── State Push ───────────────────────────────────────────────────

  /** Push an application state snapshot to the server */
  async pushState(
    state: Record<string, unknown>,
    activeFlows?: string[],
    activeGates?: string[],
  ): Promise<void> {
    if (this.closed) return;

    await this.post('/api/state', {
      service: this.service,
      sessionId: this.sessionId,
      state,
      activeFlows,
      activeGates,
    });
  }

  // ── Tracing ──────────────────────────────────────────────────────

  /** Start a trace span. Call end() on the returned SpanContext when the operation completes. */
  startSpan(symbol: string, operation: string, parentSpanId?: string): SpanContext {
    const traceId = parentSpanId ? parentSpanId.split('-')[0] || uuidv4() : uuidv4();
    const spanId = uuidv4();
    const startTime = new Date().toISOString();
    const startMs = Date.now();

    const self = this;

    return {
      traceId,
      spanId,
      async end(status: 'ok' | 'error' = 'ok'): Promise<void> {
        const endTime = new Date().toISOString();
        const durationMs = Date.now() - startMs;

        const span: TraceSpanInput = {
          traceId,
          spanId,
          parentSpanId,
          service: self.service,
          symbol,
          operation,
          startTime,
          endTime,
          durationMs,
          status,
        };

        await self.post('/api/traces', span);
      },
    };
  }

  // ── Buffer Management ────────────────────────────────────────────

  /** Flush all buffered logs and metrics to the server */
  async flush(): Promise<void> {
    const logEntries = this.drainLogBuffer();
    const metricEntries = this.drainMetricsBuffer();

    const promises: Promise<void>[] = [];

    if (logEntries.length > 0) {
      promises.push(this.sendLogs(logEntries));
    }

    if (metricEntries.length > 0) {
      promises.push(this.sendMetrics(metricEntries));
    }

    await Promise.allSettled(promises);
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  /** Flush remaining entries and shut down the client */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Remove browser beforeunload listener
    if (this.beforeUnloadHandler && typeof globalThis !== 'undefined' && typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }

    // Final flush — best-effort
    try {
      await this.flush();
    } catch {
      // Swallow errors on close; nothing more we can do
    }
  }

  /** Get the session ID assigned to this client instance */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Synchronous best-effort flush using sendBeacon (browser) or sync XHR fallback.
   * Used in beforeunload where async is unreliable.
   */
  private flushSync(): void {
    const logEntries = this.drainLogBuffer();
    const metricEntries = this.drainMetricsBuffer();

    const sendBeacon = typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
      ? navigator.sendBeacon.bind(navigator)
      : undefined;

    if (sendBeacon) {
      if (logEntries.length > 0) {
        sendBeacon(`${this.url}/api/logs`, JSON.stringify({ entries: logEntries }));
      }
      if (metricEntries.length > 0) {
        sendBeacon(`${this.url}/api/metrics`, JSON.stringify({ entries: metricEntries }));
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════

  /** Register this service with the Sentinel server (fire-and-forget) */
  private registerService(): void {
    const registration: ServiceRegistration = {
      name: this.service,
      version: this.version,
      pid: typeof process !== 'undefined' ? process.pid : undefined,
      environment: this.environment,
    };

    this.post('/api/services', registration).catch(() => {
      // Registration is best-effort; server may not be running yet
    });
  }

  /** Push a log entry into the ring buffer, enforcing maxBufferSize */
  private pushToLogBuffer(entry: LogEntryInput): void {
    if (this.logBuffer.length >= this.maxBufferSize) {
      const dropCount = Math.max(1, Math.floor(this.maxBufferSize * 0.1));
      this.logBuffer.splice(0, dropCount);
      if (this.onDrop) {
        this.onDrop(dropCount);
      }
    }

    this.logBuffer.push(entry);

    if (this.logBuffer.length >= this.batchSize) {
      this.flush().catch((err) => {
        this.handleError(err);
      });
    }
  }

  /** Push a metric entry into the ring buffer, enforcing maxBufferSize */
  private pushToMetricsBuffer(entry: MetricInput): void {
    if (this.metricsBuffer.length >= this.maxBufferSize) {
      const dropCount = Math.max(1, Math.floor(this.maxBufferSize * 0.1));
      this.metricsBuffer.splice(0, dropCount);
      if (this.onDrop) {
        this.onDrop(dropCount);
      }
    }

    this.metricsBuffer.push(entry);

    if (this.metricsBuffer.length >= this.batchSize) {
      this.flush().catch((err) => {
        this.handleError(err);
      });
    }
  }

  /** Drain and return all entries from the log buffer */
  private drainLogBuffer(): LogEntryInput[] {
    const entries = this.logBuffer;
    this.logBuffer = [];
    return entries;
  }

  /** Drain and return all entries from the metrics buffer */
  private drainMetricsBuffer(): MetricInput[] {
    const entries = this.metricsBuffer;
    this.metricsBuffer = [];
    return entries;
  }

  /** Send log entries to the server with retry */
  private async sendLogs(entries: LogEntryInput[]): Promise<void> {
    try {
      await this.post('/api/logs', { entries });
    } catch (err) {
      // On failure, put entries back in the buffer (up to maxBufferSize)
      const capacity = this.maxBufferSize - this.logBuffer.length;
      if (capacity > 0) {
        const toRestore = entries.slice(0, capacity);
        this.logBuffer.unshift(...toRestore);
        const dropped = entries.length - toRestore.length;
        if (dropped > 0 && this.onDrop) {
          this.onDrop(dropped);
        }
      } else if (this.onDrop) {
        this.onDrop(entries.length);
      }
      throw err;
    }
  }

  /** Send metric entries to the server with retry */
  private async sendMetrics(entries: MetricInput[]): Promise<void> {
    try {
      await this.post('/api/metrics', { entries });
    } catch (err) {
      // On failure, put entries back in the buffer (up to maxBufferSize)
      const capacity = this.maxBufferSize - this.metricsBuffer.length;
      if (capacity > 0) {
        const toRestore = entries.slice(0, capacity);
        this.metricsBuffer.unshift(...toRestore);
        const dropped = entries.length - toRestore.length;
        if (dropped > 0 && this.onDrop) {
          this.onDrop(dropped);
        }
      } else if (this.onDrop) {
        this.onDrop(entries.length);
      }
      throw err;
    }
  }

  /**
   * POST JSON to the Sentinel server with exponential backoff retry.
   * Retries on network errors and 5xx responses. Does NOT retry on 4xx.
   */
  private async post(path: string, body: unknown): Promise<unknown> {
    const fetchFn = this.getFetch();
    if (!fetchFn) {
      // fetch not available — degrade gracefully
      return undefined;
    }

    const url = `${this.url}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetchFn(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        // 4xx errors are not retried — they indicate a client issue
        if (response.status >= 400 && response.status < 500) {
          const text = await response.text().catch(() => '');
          const err = new Error(`Sentinel server returned ${response.status}: ${text}`);
          this.handleError(err);
          return undefined;
        }

        // 5xx errors are retried
        if (response.status >= 500) {
          const text = await response.text().catch(() => '');
          lastError = new Error(`Sentinel server returned ${response.status}: ${text}`);
          if (attempt < this.maxRetries) {
            await this.backoff(attempt);
            continue;
          }
          this.handleError(lastError);
          throw lastError;
        }

        // Success
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          return await response.json();
        }
        return undefined;

      } catch (err) {
        // Network errors (fetch threw) are retried
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.maxRetries) {
          await this.backoff(attempt);
          continue;
        }
        this.handleError(lastError);
        throw lastError;
      }
    }

    // Should not reach here, but just in case
    if (lastError) throw lastError;
    return undefined;
  }

  /** Get the fetch function, falling back to globalThis.fetch */
  private getFetch(): typeof globalThis.fetch | undefined {
    if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
      return globalThis.fetch;
    }
    return undefined;
  }

  /** Wait with exponential backoff */
  private backoff(attempt: number): Promise<void> {
    const delayMs = this.retryBackoffMs * Math.pow(2, attempt);
    // Add jitter: 0-25% of the delay
    const jitter = Math.floor(Math.random() * delayMs * 0.25);
    return new Promise((resolve) => setTimeout(resolve, delayMs + jitter));
  }

  /** Handle an error, calling the onError callback if provided */
  private handleError(err: unknown): void {
    if (this.onError) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.onError(error);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a new SentinelClient instance.
 *
 * Usage:
 *   const client = createSentinelClient({ service: 'my-app', environment: 'production' });
 *   client.info('#checkout', 'Order placed', { orderId: '123' });
 */
export function createSentinelClient(options: SentinelClientOptions): SentinelClient {
  return new SentinelClient(options);
}
