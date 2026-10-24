/**
 * client id test — the SDK mints ids with the Web Crypto global
 * (globalThis.crypto.randomUUID) after dropping the `uuid` dependency.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSentinelClient } from './client.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('SentinelClient ids', () => {
  it('assigns a v4 session id and v4 trace/span ids', async () => {
    const a = createSentinelClient({ service: 'test', url: 'http://127.0.0.1:9' });
    const b = createSentinelClient({ service: 'test', url: 'http://127.0.0.1:9' });
    try {
      expect(a.getSessionId()).toMatch(UUID_V4);
      expect(a.getSessionId()).not.toBe(b.getSessionId());

      const span = a.startSpan('#checkout', 'op');
      expect(span.traceId).toMatch(UUID_V4);
      expect(span.spanId).toMatch(UUID_V4);
      expect(span.spanId).not.toBe(span.traceId);

      const child = a.startSpan('#checkout', 'child', span.spanId);
      expect(child.traceId).toBe(span.spanId.split('-')[0]);
      expect(child.spanId).toMatch(UUID_V4);
    } finally {
      await a.close();
      await b.close();
    }
  });

  afterEach(() => vi.unstubAllGlobals());

  it('falls back to getRandomValues where randomUUID is missing (plain-http pages)', async () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    const c = createSentinelClient({ service: 'test', url: 'http://127.0.0.1:9' });
    try {
      expect(c.getSessionId()).toMatch(UUID_V4);
      expect(c.startSpan('#checkout', 'op').spanId).toMatch(UUID_V4);
    } finally {
      await c.close();
    }
  });
});
