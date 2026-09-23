/**
 * platform-local-guard.test — request-time ^local-only enforcement (#local-guard).
 *
 * Two halves:
 *   UNIT   isLoopbackHost parses Host / Origin header forms correctly (localhost,
 *          127.0.0.1, ::1, [::1]:port, host:port, http(s):// origins) and rejects
 *          evil.com / LAN / example.com.
 *   ROUTE  a mini app wired exactly like the platform (corsMiddleware +
 *          localOnlyGuard on /api) rejects a cross-origin POST (Origin:
 *          https://evil.com) and a non-local Host with 403, while a same-origin
 *          loopback POST, a no-Origin POST (curl/tests), and every GET pass.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import express from 'express';
import { isLoopbackHost, corsMiddleware, localOnlyGuard } from '../src/platform-server/local-guard.js';

describe('isLoopbackHost', () => {
  it('accepts loopback hosts in every header form', () => {
    for (const v of [
      'localhost',
      'localhost:3000',
      '127.0.0.1',
      '127.0.0.1:8080',
      '::1',
      '[::1]',
      '[::1]:5173',
      'http://localhost:5173',
      'https://127.0.0.1:3000',
      'http://[::1]:3000',
      'HTTP://LOCALHOST:9999',
    ]) {
      expect(isLoopbackHost(v), v).toBe(true);
    }
  });

  it('rejects non-loopback hosts', () => {
    for (const v of [
      'evil.com',
      'https://evil.com',
      'http://evil.com:127001',
      '192.168.1.5',
      '192.168.1.5:8080',
      '10.0.0.1',
      'example.com',
      'localhost.evil.com',
      'notlocalhost',
      'null',
      '',
      undefined,
      null,
    ]) {
      expect(isLoopbackHost(v as string | undefined | null), String(v)).toBe(false);
    }
  });
});

describe('localOnlyGuard + corsMiddleware over HTTP', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const app = express();
    app.use(corsMiddleware);
    app.use('/api', localOnlyGuard);
    app.use(express.json());
    app.post('/api/echo', (_req, res) => res.json({ ok: true }));
    app.get('/api/echo', (_req, res) => res.json({ read: true }));
    server = app.listen(0);
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('no port');
    port = addr.port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  const raw = (opts: { method: string; headers?: Record<string, string> }): Promise<{ status: number; acao?: string }> =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/api/echo', method: opts.method, headers: opts.headers },
        (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode ?? 0, acao: res.headers['access-control-allow-origin'] as string | undefined }));
        },
      );
      req.on('error', reject);
      req.end();
    });

  it('BLOCKS a cross-origin POST (Origin: https://evil.com) with 403', async () => {
    const { status } = await raw({ method: 'POST', headers: { Host: `127.0.0.1:${port}`, Origin: 'https://evil.com' } });
    expect(status).toBe(403);
  });

  it('BLOCKS a POST with a non-local Host header with 403 (DNS-rebinding)', async () => {
    const { status } = await raw({ method: 'POST', headers: { Host: 'evil.com', Origin: 'http://evil.com' } });
    expect(status).toBe(403);
  });

  it('PASSES a same-origin loopback POST', async () => {
    const { status, acao } = await raw({ method: 'POST', headers: { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}` } });
    expect(status).toBe(200);
    // CORS reflects the loopback origin (never wildcard).
    expect(acao).toBe(`http://127.0.0.1:${port}`);
  });

  it('PASSES a no-Origin POST (curl / tests / server-to-server)', async () => {
    const { status, acao } = await raw({ method: 'POST', headers: { Host: `127.0.0.1:${port}` } });
    expect(status).toBe(200);
    // No Origin → no ACAO reflected.
    expect(acao).toBeUndefined();
  });

  it('PASSES GET reads regardless of Origin (guard is mutation-only)', async () => {
    const { status } = await raw({ method: 'GET', headers: { Host: `127.0.0.1:${port}`, Origin: 'https://evil.com' } });
    expect(status).toBe(200);
  });

  it('never reflects a cross-origin into ACAO', async () => {
    const { acao } = await raw({ method: 'GET', headers: { Host: `127.0.0.1:${port}`, Origin: 'https://evil.com' } });
    expect(acao).toBeUndefined();
  });
});
