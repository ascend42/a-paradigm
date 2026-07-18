/**
 * platform-warpline-router.test — the PHASE-1 console re-point (native-first):
 * the /api/warpline/fabric/* lane serves through `warplined` when the daemon
 * socket + the read-scoped console token are present, and in-process otherwise.
 *
 * Pinned here:
 *   BYTE IDENTITY  the same fixture fabric served in-process vs daemon-backed
 *                  returns byte-identical response bodies for refs /
 *                  shadow-tail / grade-report / the knot 404, and an identical
 *                  fabric projection (selvage) on status (mode/daemon are the
 *                  endpoint's declared transport metadata).
 *   ZERO BREAKAGE  no daemon → in-process; daemon UP but no console token →
 *                  still in-process (the human's mint is the opt-in).
 *   READ-ONLY LAW  the /fabric lane registers exclusively GET handlers
 *                  (adversarially enumerated off the router stack), mutating
 *                  methods 404, and the console token the lane discovers is
 *                  read-SCOPED — the daemon refuses it every write verb
 *                  (proved engine-side in warpline test/backup.test.ts).
 *
 * FIXTURES ONLY — the daemon is never started against this repo's fabric.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as http from 'node:http';
import express from 'express';
import {
  forkNative,
  proposeNative,
  admitNative,
  startDaemon,
  mintToken,
  type DaemonHandle,
} from '@a-company/warpline';
import { createWarplineRouter } from '../src/platform-server/routes/warpline.js';

const MOD = 'src/mod.ts';
const BASE = 'export function foo() { return 1; }\nexport function bar() { return 2; }\n';

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

interface Got {
  status: number;
  body: string;
}

describe('platform /api/warpline/fabric — daemon-backed console lane', () => {
  let root: string;
  let server: http.Server;
  let base: string;
  let handle: DaemonHandle | null = null;

  const get = async (p: string): Promise<Got> => {
    const res = await fetch(`${base}${p}`);
    return { status: res.status, body: await res.text() };
  };
  const send = async (method: string, p: string): Promise<number> => {
    const res = await fetch(`${base}${p}`, { method });
    return res.status;
  };

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'plat-wl-'));
    write(root, MOD, BASE);
    // seed a two-strand fixture fabric (genesis FF + edit FF), in-process
    forkNative(root, 'agent-x');
    await proposeNative(root, { worktree: root, agentId: 'agent-x', actor: 'agent-x', intent: 'genesis' });
    await admitNative(root, { worktree: root, agentId: 'agent-x', actor: 'agent-x', noRestore: true });
    write(root, MOD, BASE.replace('return 1', 'return 10'));
    await proposeNative(root, { worktree: root, agentId: 'agent-x', actor: 'agent-x', intent: 'edit' });
    await admitNative(root, { worktree: root, agentId: 'agent-x', actor: 'agent-x', noRestore: true });

    const app = express();
    app.use('/api/warpline', createWarplineRouter(root));
    server = app.listen(0);
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('no port');
    base = `http://127.0.0.1:${addr.port}/api/warpline`;
  });

  afterAll(async () => {
    await handle?.close();
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('serves the fabric lane byte-identically in-process vs daemon-backed', async () => {
    const paths = ['/fabric/refs', '/fabric/shadow-tail?n=5', '/fabric/grade-report', '/fabric/knot/nope'];

    // 1 — NO daemon: in-process
    const inProc: Record<string, Got> = {};
    for (const p of paths) inProc[p] = await get(p);
    expect(inProc['/fabric/refs'].status).toBe(200);
    expect(JSON.parse(inProc['/fabric/refs'].body).refs.selvage).toBeTruthy();
    expect(inProc['/fabric/knot/nope'].status).toBe(404);

    const st0 = await get('/fabric/status');
    const status0 = JSON.parse(st0.body);
    expect(status0.mode).toBe('in-process');
    expect(status0.daemon).toBeNull();
    expect(status0.selvage).toBeTruthy();

    // 2 — daemon UP but NO console token: STILL in-process (mint = the opt-in)
    handle = await startDaemon(root);
    const stNoToken = JSON.parse((await get('/fabric/status')).body);
    expect(stNoToken.mode).toBe('in-process');

    // 3 — console token minted: the SAME bytes now ride the daemon
    mintToken(root, 'console', 'human', { scope: 'read' });
    const st1 = JSON.parse((await get('/fabric/status')).body);
    expect(st1.mode).toBe('daemon');
    expect(st1.daemon?.pid).toBe(process.pid);
    expect(st1.daemon?.principal).toBe('console');
    expect(st1.daemon?.scope).toBe('read');
    expect(st1.selvage).toBe(status0.selvage); // ← the fabric projection: identical

    for (const p of paths) {
      const viaDaemon = await get(p);
      expect(viaDaemon.status, p).toBe(inProc[p].status);
      expect(viaDaemon.body, p).toBe(inProc[p].body); // ← BYTE identity
    }

    // 4 — daemon gone again: falls back with the same bytes (zero breakage)
    await handle.close();
    handle = null;
    for (const p of paths) {
      const back = await get(p);
      expect(back.body, p).toBe(inProc[p].body);
    }
    expect(JSON.parse((await get('/fabric/status')).body).mode).toBe('in-process');
  });

  it('READ-ONLY LAW: the /fabric lane registers exclusively GET routes', () => {
    const router = createWarplineRouter(root) as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    };
    const fabricRoutes = router.stack.filter((l) => l.route && l.route.path.startsWith('/fabric'));
    expect(fabricRoutes.length).toBe(5);
    for (const layer of fabricRoutes) {
      expect(Object.keys(layer.route!.methods), layer.route!.path).toEqual(['get']);
    }
  });

  it('ADVERSARIAL: mutating methods on the fabric lane do not exist (404)', async () => {
    for (const p of ['/fabric/refs', '/fabric/status', '/fabric/knot/x', '/fabric/shadow-tail', '/fabric/grade-report']) {
      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
        expect(await send(method, p), `${method} ${p}`).toBe(404);
      }
    }
    // and a malformed selector is refused before it reaches the engine
    expect((await get('/fabric/knot/..%2F..%2Fetc')).status).toBe(400);
  });
});
