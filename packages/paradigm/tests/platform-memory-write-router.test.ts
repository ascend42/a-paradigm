/**
 * platform-memory-write-router.test — Memory Steward apply/sync verbs over HTTP
 * (Phase C2/C3, TD-2026-09-20-669).
 *
 * Pins the WRITE contract of /api/memory:
 *   PROXY       each verb calls the SAME return-shaped applier the CLI wrapper
 *               uses (applyPrune/Route/Merge/Pin) — a successful POST mutates the
 *               native store exactly as the CLI would (archive-not-delete).
 *   VALIDATION  bad id → 404; bad route target → 400; merge < 2 ids → 400.
 *   GATED SYNC  /sync/write is a no-op { wrote:false } when there is no MEMORY.md.
 *
 * We override HOME so resolveMemoryDir points into a sandbox (mirrors the CLI
 * test); a bare temp project root holds the native memory files. No daemon, no
 * real ~/.claude.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as http from 'node:http';
import express from 'express';
import { resolveMemoryDir } from '@a-company/premise-core';
import { createMemoryWriteRouter } from '../src/platform-server/routes/memory-write.js';
import { corsMiddleware, localOnlyGuard } from '../src/platform-server/local-guard.js';
import { stableId } from '../src/commands/memory/index.js';

describe('platform /api/memory — write verbs', () => {
  let root: string;
  let home: string;
  let origHome: string | undefined;
  let origUserProfile: string | undefined;
  let server: http.Server;
  let base: string;

  const post = async (p: string, body?: unknown): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${base}${p}`, {
      method: 'POST',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json() };
  };

  const writeMemoryFile = (filename: string, content: string): string => {
    const dir = resolveMemoryDir(root);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, filename);
    fs.writeFileSync(file, content, 'utf-8');
    return file;
  };

  const fm = (name: string, type: string, body: string): string =>
    `---\nname: ${name}\ndescription: \ntype: ${type}\n---\n\n${body}\n`;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'plat-memw-root-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'plat-memw-home-'));
    origHome = process.env.HOME;
    origUserProfile = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;

    // Live-graph fixture so scanNativeMemory can prove symbols dead.
    const pkg = path.join(root, 'pkg');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, '.purpose'), 'purpose: fixture\nversion: 2.0.0\n', 'utf-8');

    const app = express();
    app.use(express.json());
    app.use('/api/memory', createMemoryWriteRouter(root));
    server = app.listen(0);
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('no port');
    base = `http://127.0.0.1:${addr.port}/api/memory`;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = origUserProfile;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('POST /:id/prune archives the entry (proxying applyPrune)', async () => {
    const file = writeMemoryFile('stale.md', fm('Stale', 'project', 'only #ghost-symbol'));
    const { status, json } = await post(`/${stableId(file)}/prune`);
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.archived).toBe('stale.md');
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(resolveMemoryDir(root), '.archived', 'stale.md'))).toBe(true);
  });

  it('POST /:id/prune → 404 on a bad id', async () => {
    const { status, json } = await post('/mem-deadbeef/prune');
    expect(status).toBe(404);
    expect(json.error).toMatch(/No memory entry matches/);
  });

  it('POST /:id/route → 400 on a bad target', async () => {
    const file = writeMemoryFile('x.md', fm('X', 'feedback', 'body'));
    const { status } = await post(`/${stableId(file)}/route`, { to: 'nowhere' });
    expect(status).toBe(400);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('POST /:id/route routes to lore and archives the source', async () => {
    const file = writeMemoryFile('ref.md', fm('Durable', 'reference', 'stable knowledge here'));
    const { status, json } = await post(`/${stableId(file)}/route`, { to: 'lore' });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.archivedSource).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('POST /merge → 400 when fewer than two ids', async () => {
    const { status } = await post('/merge', { ids: ['mem-only'] });
    expect(status).toBe(400);
  });

  it('POST /merge merges same-cluster near-duplicates', async () => {
    const a = writeMemoryFile('a.md', fm('A', 'feedback', 'always update the changelog and commit after each round'));
    const b = writeMemoryFile('b.md', fm('B', 'feedback', 'always update the changelog and commit after every round'));
    const { status, json } = await post('/merge', { ids: [stableId(a), stableId(b)] });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.primary).toBe(stableId(a));
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(false);
  });

  it('POST /:id/pin records the pin', async () => {
    const file = writeMemoryFile('pref.md', fm('Pref', 'user', 'I like terse output'));
    const { status, json } = await post(`/${stableId(file)}/pin`);
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.pinned).toBe('pref.md');
  });

  it('POST /sync/write is a no-op { wrote:false } with no MEMORY.md', async () => {
    const { status, json } = await post('/sync/write', { projection: false });
    expect(status).toBe(200);
    expect(json.wrote).toBe(false);
  });

  it('LOW-1: prune response returns a BASENAME file, never an absolute ~/.claude path', async () => {
    const file = writeMemoryFile('leaky.md', fm('Leaky', 'project', 'only #ghost-symbol'));
    const { status, json } = await post(`/${stableId(file)}/prune`);
    expect(status).toBe(200);
    expect(json.file).toBe('leaky.md');
    expect(json.file).not.toContain('/');
  });

  it('LOW-2: a server error returns a generic message with no `detail`', async () => {
    // route with a valid target but a bogus id → applier returns ok:false (404),
    // not a 500; assert the shape carries no leaked detail regardless.
    const { json } = await post('/mem-nope/route', { to: 'lore' });
    expect(json).not.toHaveProperty('detail');
  });
});

// The write router behind the request-time ^local-only guard (the real mount
// order in createPlatformApp: corsMiddleware → localOnlyGuard on /api → json →
// router). Proves a cross-origin POST is rejected 403 while same-origin / no-
// Origin POSTs reach the router.
describe('platform /api/memory write — behind ^local-only guard', () => {
  let root: string;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'plat-memw-guard-'));
    const app = express();
    app.use(corsMiddleware);
    app.use('/api', localOnlyGuard);
    app.use(express.json());
    app.use('/api/memory', createMemoryWriteRouter(root));
    server = app.listen(0);
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('no port');
    port = addr.port;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  const rawPost = (headers: Record<string, string>): Promise<{ status: number }> =>
    new Promise((resolve, reject) => {
      const body = JSON.stringify({ projection: false });
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/memory/sync/write',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
        },
      );
      req.on('error', reject);
      req.end(body);
    });

  it('BLOCKS a cross-origin POST (Origin: https://evil.com) with 403', async () => {
    const { status } = await rawPost({ Host: `127.0.0.1:${port}`, Origin: 'https://evil.com' });
    expect(status).toBe(403);
  });

  it('PASSES a same-origin loopback POST (reaches the router → 200 no-op)', async () => {
    const { status } = await rawPost({ Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}` });
    expect(status).toBe(200);
  });

  it('PASSES a no-Origin POST (curl/tests reach the router → 200 no-op)', async () => {
    const { status } = await rawPost({ Host: `127.0.0.1:${port}` });
    expect(status).toBe(200);
  });
});
