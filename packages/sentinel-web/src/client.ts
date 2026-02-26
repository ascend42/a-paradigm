/**
 * SentinelWebClient — Zero-dependency browser client for Sentinel
 *
 * Key design:
 * - emit() is synchronous and never blocks
 * - Buffers in a ring buffer, drops on overflow
 * - Periodic flush via setInterval + fetch()
 * - navigator.sendBeacon() on beforeunload
 * - Uses crypto.randomUUID() (no uuid dependency)
 * - Single retry on 5xx, no exponential backoff
 */

import { RingBuffer } from './batch.js';
import type {
  SentinelWebClientOptions,
  EventSchemaDeclaration,
  BufferedEvent,
  EmitOptions,
  BatchEmitEvent,
} from './types.js';

export class SentinelWebClient {
  private readonly url: string;
  private readonly schemaId: string;
  private readonly service: string;
  private readonly token?: string;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly onError?: (error: Error) => void;
  private readonly buffer: RingBuffer;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private flushing = false;

  constructor(opts: SentinelWebClientOptions) {
    this.url = opts.url.replace(/\/+$/, '');
    this.schemaId = opts.schemaId;
    this.service = opts.service;
    this.token = opts.token;
    this.batchSize = opts.batchSize ?? 100;
    this.flushIntervalMs = opts.flushIntervalMs ?? 2000;
    this.onError = opts.onError;

    this.buffer = new RingBuffer(
      opts.maxBufferSize ?? 5000,
      opts.backpressure ?? 'drop-oldest',
      opts.onDrop
    );

    // Start periodic flush
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
    }, this.flushIntervalMs);

    // Register beforeunload for sync flush
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handleBeforeUnload);
    }
  }

  /**
   * Emit a single event. Synchronous, never blocks.
   * Buffers internally and flushes periodically.
   */
  emit(
    type: string,
    data?: Record<string, unknown>,
    opts?: EmitOptions
  ): void {
    if (this.closed) return;

    const event: BufferedEvent = {
      id: this.generateId(),
      type,
      timestamp: new Date().toISOString(),
      data,
      scopeValue: opts?.scopeValue != null ? String(opts.scopeValue) : undefined,
      sessionId: opts?.sessionId,
      severity: opts?.severity,
      parentEventId: opts?.parentEventId,
      depth: opts?.depth,
    };

    this.buffer.push(event);
  }

  /**
   * Emit a batch of events. Synchronous, never blocks.
   */
  emitBatch(events: BatchEmitEvent[]): void {
    if (this.closed) return;

    for (const e of events) {
      const event: BufferedEvent = {
        id: this.generateId(),
        type: e.type,
        timestamp: e.timestamp
          ? new Date(e.timestamp).toISOString()
          : new Date().toISOString(),
        data: e.data,
        scopeValue: e.scopeValue != null ? String(e.scopeValue) : undefined,
        severity: e.severity,
        parentEventId: e.parentEventId,
        depth: e.depth,
      };
      this.buffer.push(event);
    }
  }

  /**
   * Register an event schema with the Sentinel server.
   */
  async registerSchema(schema: EventSchemaDeclaration): Promise<void> {
    const res = await this.post('/api/schemas', schema);
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new Error(`Schema registration failed (${res.status}): ${text}`);
    }
  }

  /**
   * Flush all buffered events to the server.
   */
  async flush(): Promise<void> {
    if (this.flushing || this.buffer.size === 0) return;
    this.flushing = true;

    try {
      while (this.buffer.size > 0) {
        const batch = this.buffer.drain(this.batchSize);
        if (batch.length === 0) break;

        const payload = {
          schemaId: this.schemaId,
          service: this.service,
          events: batch.map((e) => ({
            id: e.id,
            type: e.type,
            timestamp: e.timestamp,
            scopeValue: e.scopeValue,
            sessionId: e.sessionId,
            data: e.data,
            severity: e.severity,
            parentEventId: e.parentEventId,
            depth: e.depth,
          })),
        };

        const res = await this.post('/api/events', payload);

        // Single retry on 5xx
        if (res.status >= 500) {
          const retryRes = await this.post('/api/events', payload);
          if (!retryRes.ok) {
            this.onError?.(new Error(`Event flush failed after retry: ${retryRes.status}`));
          }
        }
      }
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Close the client — flushes remaining events and cleans up.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
    }

    try {
      await this.flush();
    } catch {
      // Swallow errors on close
    }
  }

  // ─── Private ────────────────────────────────────────────────────

  private handleBeforeUnload = (): void => {
    this.flushSync();
  };

  /**
   * Synchronous best-effort flush using sendBeacon.
   * Used in beforeunload where async is unreliable.
   */
  private flushSync(): void {
    const events = this.buffer.drainAll();
    if (events.length === 0) return;

    const sendBeacon =
      typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
        ? navigator.sendBeacon.bind(navigator)
        : undefined;

    if (sendBeacon) {
      const payload = JSON.stringify({
        schemaId: this.schemaId,
        service: this.service,
        events: events.map((e) => ({
          id: e.id,
          type: e.type,
          timestamp: e.timestamp,
          scopeValue: e.scopeValue,
          sessionId: e.sessionId,
          data: e.data,
          severity: e.severity,
          parentEventId: e.parentEventId,
          depth: e.depth,
        })),
      });

      sendBeacon(
        `${this.url}/api/events`,
        new Blob([payload], { type: 'application/json' })
      );
    }
  }

  private async post(path: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return fetch(`${this.url}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  private generateId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Fallback for older environments
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
