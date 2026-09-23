/**
 * platform-memory-router.test — Memory Steward ledger over HTTP (Phase C1,
 * TD-2026-09-20-669).
 *
 * Pins the READ-ONLY contract of /api/memory:
 *   SHAPE       /review returns the native buildDigest shape verbatim
 *               ({ root, scanned, pinned, items }); /sync returns the preview
 *               summary + a `diff` string and NEVER the full before/after bodies.
 *   FAIL-OPEN   against a project with no native memory store the engines
 *               degrade (scanned 0, items []) — the routes 200 with empty data,
 *               never 500.
 *   READ-ONLY   the router registers exclusively GET handlers.
 *
 * No daemon, no real ~/.claude — a bare temp project dir exercises the fail-open
 * path deterministically.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as http from 'node:http';
import express from 'express';
import { createMemoryRouter } from '../src/platform-server/routes/memory.js';

describe('platform /api/memory — read-only Memory Steward ledger', () => {
  let root: string;
  let server: http.Server;
  let base: string;

  const get = async (p: string): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${base}${p}`);
    return { status: res.status, json: await res.json() };
  };

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'plat-mem-'));
    const app = express();
    app.use('/api/memory', createMemoryRouter(root));
    server = app.listen(0);
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('no port');
    base = `http://127.0.0.1:${addr.port}/api/memory`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('GET /review returns the digest shape (fail-open: empty on no memory store)', async () => {
    const { status, json } = await get('/review');
    expect(status).toBe(200);
    expect(json).toHaveProperty('root');
    expect(json).toHaveProperty('scanned');
    expect(json).toHaveProperty('pinned');
    expect(Array.isArray(json.items)).toBe(true);
    expect(json.scanned).toBe(0);
    expect(json.items).toHaveLength(0);
  });

  it('GET /sync returns the preview summary + a diff string, never before/after bodies', async () => {
    const { status, json } = await get('/sync?projection=false');
    expect(status).toBe(200);
    expect(json).toHaveProperty('existed');
    expect(json).toHaveProperty('changed');
    expect(json).toHaveProperty('bytesBefore');
    expect(json).toHaveProperty('bytesAfter');
    expect(json).toHaveProperty('demoted');
    expect(json).toHaveProperty('deduped');
    expect(json).toHaveProperty('projectionEnabled');
    expect(json).toHaveProperty('projectionItems');
    expect(json).toHaveProperty('diff');
    // The full raw memory bodies must NOT leak through the read layer.
    expect(json).not.toHaveProperty('before');
    expect(json).not.toHaveProperty('after');
    expect(json.projectionEnabled).toBe(false);
  });

  it('GET /sync?projection=true echoes projectionEnabled', async () => {
    const { status, json } = await get('/sync?projection=true');
    expect(status).toBe(200);
    expect(json.projectionEnabled).toBe(true);
  });

  it('READ-ONLY LAW: the router registers exclusively GET routes', () => {
    const router = createMemoryRouter(root);
    // Enumerate the express route stack — every layer must be GET-only.
    const stack = (router as any).stack as Array<{ route?: { methods: Record<string, boolean> } }>;
    const routeLayers = stack.filter((l) => l.route);
    expect(routeLayers.length).toBeGreaterThan(0);
    for (const layer of routeLayers) {
      const methods = Object.keys(layer.route!.methods).filter((m) => m !== '_all');
      expect(methods).toEqual(['get']);
    }
  });
});
