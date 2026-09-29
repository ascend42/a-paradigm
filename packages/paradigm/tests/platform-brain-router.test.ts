/**
 * platform-brain-router.test — the Platform Brain section's HTTP surface (7.14.0).
 *
 * Pins:
 *   CHOKE POINT   every read goes through openBrainView(…,'owner'): private files
 *                 visible, sensitive zones only as {folder, gate, count}.
 *   FIND          never returns gated files; q > 200 chars → 400.
 *   OWNER WRITE   POST /verdict without the owner token → 403 (^brain-owner-write).
 *   LOOPBACK      reads require a loopback Host / Origin (brainLocalGuard).
 *   LEAK PROBES   Builder A's createLeakProbeCorpus + leakProbeQueries across
 *                 /find and /health — no gated sentinel or gated relpath appears.
 *
 * Real express app on an ephemeral port (same harness as the memory/academy
 * router tests); brain storage lives in an injected temp homedir.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as http from 'node:http';
import express from 'express';
import { createBrainRouter } from '../src/platform-server/routes/brain.js';
import { createBrainWriteRouter } from '../src/platform-server/routes/brain-write.js';
import { corsMiddleware, localOnlyGuard } from '../src/platform-server/local-guard.js';
import { initBrain, addShare, brainFile } from '../../paradigm-mcp/src/utils/brain/config.js';
import { scanBrain } from '../../paradigm-mcp/src/utils/brain/view.js';
import {
  createLeakProbeCorpus,
  leakProbeQueries,
  findLeaks,
  GATED_SENTINEL,
  type LeakProbeCorpus,
} from '../../paradigm-mcp/src/utils/brain/leak-probe.js';

function startApp(homedir: string): Promise<{ server: http.Server; base: string }> {
  const app = express();
  app.use(corsMiddleware);
  app.use('/api', localOnlyGuard);
  app.use(express.json());
  app.use('/api/brain', createBrainRouter({ homedir }));
  app.use('/api/brain', createBrainWriteRouter({ homedir }));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') throw new Error('no port');
      resolve({ server, base: `http://127.0.0.1:${addr.port}/api/brain` });
    });
  });
}

const stop = (s: http.Server) => new Promise<void>((r) => s.close(() => r()));

describe('platform /api/brain — no brain yet', () => {
  let tmp: string;
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plat-brain-empty-'));
    ({ server, base } = await startApp(path.join(tmp, 'home')));
  });
  afterAll(async () => {
    await stop(server);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('overview returns an empty brains list (UI empty state)', async () => {
    const res = await fetch(`${base}/overview`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ brains: [], selected: null });
  });

  it('find with no brain → 404, not a crash', async () => {
    const res = await fetch(`${base}/find?q=lease`);
    expect(res.status).toBe(404);
  });
});

describe('platform /api/brain — leak-probe corpus', () => {
  let tmp: string;
  let home: string;
  let corpus: LeakProbeCorpus;
  let rootHash: string;
  let allIds: string[];
  let server: http.Server;
  let base: string;

  const getJson = async (p: string): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${base}${p}`);
    return { status: res.status, json: await res.json() };
  };

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plat-brain-'));
    home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const root = path.join(tmp, 'Notes-root');
    fs.mkdirSync(root);
    corpus = createLeakProbeCorpus(root);
    const opts = { homedir: home };
    rootHash = initBrain(root, opts).rootHash;
    addShare(rootHash, corpus.shareGlob, opts);
    scanBrain(rootHash, opts);
    const idx = JSON.parse(fs.readFileSync(brainFile(rootHash, 'index', opts), 'utf8'));
    allIds = idx.records.map((r: { id: string }) => r.id);
    ({ server, base } = await startApp(home));
  });
  afterAll(async () => {
    await stop(server);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const ownerCookie = async (): Promise<string> => {
    const res = await fetch(`${base}/overview`);
    const sc = res.headers.getSetCookie().find((c) => c.startsWith('brain_owner='))!;
    return sc.split(';')[0];
  };
  const origin = () => new URL(base).origin;

  it('overview: brains list, badge, map; token only as an HttpOnly SameSite=Strict cookie', async () => {
    const res = await fetch(`${base}/overview`);
    const sc = res.headers.getSetCookie().find((c) => c.startsWith('brain_owner='));
    expect(sc).toBeDefined();
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Strict/);
    const status = res.status;
    const json = await res.json();
    expect(status).toBe(200);
    expect(json.brains).toHaveLength(1);
    expect(json.selected).toBe(rootHash);
    expect(json.badge.nothingLeft).toBe(true);
    expect(json.map.byType.markdown).toBeGreaterThan(0);
    const total = Object.values<number>(json.map.byType).reduce((a, b) => a + b, 0);
    expect(total).toBe(json.visible);
    expect(json.writeToken).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain(sc!.split(';')[0].split('=')[1]);
    expect(json.banner).toBeNull();
    expect(typeof json.paused).toBe('boolean');
  });

  it('a cross-port localhost origin gets no ACAO and cannot read /overview', async () => {
    const port = Number(new URL(base).port);
    for (const o of [`http://localhost:${port + 1}`, `http://127.0.0.1:${port + 1}`, 'http://localhost:5173']) {
      const res = await fetch(`${base}/overview`, { headers: { Origin: o } });
      expect(res.status).toBe(403);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.getSetCookie()).toEqual([]);
      const pre = await fetch(`${base}/overview`, { method: 'OPTIONS', headers: { Origin: o } });
      expect(pre.headers.get('access-control-allow-origin')).toBeNull();
    }
    const same = await fetch(`${base}/overview`, { headers: { Origin: origin() } });
    expect(same.status).toBe(200);
    const site = await fetch(`${base}/overview`, { headers: { 'Sec-Fetch-Site': 'same-site' } });
    expect(site.status).toBe(403);
  });

  it('overview carries the tamper banner when brain.yaml was edited outside Paradigm', async () => {
    const file = brainFile(rootHash, 'config', { homedir: home });
    const orig = fs.readFileSync(file, 'utf8');
    const hashFile = brainFile(rootHash, 'configHash', { homedir: home });
    const origHash = fs.readFileSync(hashFile, 'utf8');
    fs.writeFileSync(file, orig + '\n# edited\n');
    const { json } = await getJson('/overview');
    expect(json.banner).toBe('Settings changed outside Paradigm — agent access paused. Run `paradigm brain status` to review.');
    fs.writeFileSync(file, orig);
    fs.writeFileSync(hashFile, origHash);
    fs.rmSync(brainFile(rootHash, 'configTampered', { homedir: home }), { force: true });
  });

  it('a locked zone returns counts only — {folder, gate, count}, no filenames', async () => {
    const { json } = await getJson('/overview');
    expect(json.locked.length).toBeGreaterThan(0);
    for (const z of json.locked) {
      expect(Object.keys(z).sort()).toEqual(['count', 'folder', 'gate']);
      expect(typeof z.count).toBe('number');
    }
    expect(json.lockedTotal).toBe(corpus.gatedRelpaths.length);
    const gates = new Set(json.locked.map((z: { gate: string }) => z.gate));
    expect(gates.has('medical')).toBe(true);
    expect(gates.has('financial')).toBe(true);
    expect(findLeaks(json, corpus.forbiddenFor('owner'))).toEqual([]);
  });

  it('find returns owner-visible files (open + private)', async () => {
    const { status, json } = await getJson('/find?q=lease');
    expect(status).toBe(200);
    expect(json.hits.map((h: { path: string }) => h.path)).toContain('Public/Lease.md');
    const priv = await getJson(`/find?q=${encodeURIComponent('BRAIN-PRIVATE-SENTINEL-2')}`);
    expect(priv.json.hits.length).toBeGreaterThan(0);
  });

  it('find does not return gated files', async () => {
    for (const s of corpus.gatedSentinels) {
      const { status, json } = await getJson(`/find?q=${encodeURIComponent(s)}`);
      expect(status).toBe(200);
      expect(json.hits).toEqual([]);
    }
    for (const q of ['checkup', 'labs', 'receipt', 'keys', 'export', GATED_SENTINEL]) {
      const { json } = await getJson(`/find?q=${encodeURIComponent(q)}`);
      expect(findLeaks(json.hits, corpus.forbiddenFor('owner'))).toEqual([]);
    }
  });

  it('q longer than 200 chars → 400', async () => {
    const { status, json } = await getJson(`/find?q=${'a'.repeat(201)}`);
    expect(status).toBe(400);
    expect(json.error).toMatch(/200/);
    expect((await getJson(`/find?q=${'a'.repeat(200)}`)).status).toBe(200);
  });

  it('repeated q params → 400; empty q → no hits', async () => {
    expect((await getJson('/find?q=a&q=b')).status).toBe(400);
    const { status, json } = await getJson('/find?q=');
    expect(status).toBe(200);
    expect(json.hits).toEqual([]);
  });

  it('invalid / unknown brain id → 400 / 404', async () => {
    expect((await getJson('/overview?brain=../../etc')).status).toBe(400);
    expect((await getJson('/find?q=x&brain=0123456789abcdef')).status).toBe(404);
  });

  it('health returns the three plain buckets', async () => {
    const { status, json } = await getJson('/health');
    expect(status).toBe(200);
    expect(Array.isArray(json.brokenLinks)).toBe(true);
    expect(Array.isArray(json.looseNotes)).toBe(true);
    expect(Array.isArray(json.sameName)).toBe(true);
  });

  it('verdict without the cookie, with a wrong cookie, or without same-origin Origin → 403', async () => {
    const body = JSON.stringify({ suggestionId: 's_x', verdict: 'accept' });
    const post = (headers: Record<string, string>) => fetch(`${base}/verdict`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
    expect((await post({ Origin: origin() })).status).toBe(403);
    expect((await post({ Origin: origin(), Cookie: `brain_owner=${'f'.repeat(64)}` })).status).toBe(403);
    const cookie = await ownerCookie();
    expect((await post({ Cookie: cookie })).status).toBe(403); // no Origin
    const port = Number(new URL(base).port);
    expect((await post({ Cookie: cookie, Origin: `http://localhost:${port + 1}` })).status).toBe(403);
    expect((await post({ 'x-brain-token': cookie.split('=')[1], Origin: origin() })).status).toBe(403); // header alone no longer works
  });

  it('verdict with the token but a bad body → 400', async () => {
    const cookie = await ownerCookie();
    const res = await fetch(`${base}/verdict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin() },
      body: JSON.stringify({ suggestionId: 's_x', verdict: 'maybe' }),
    });
    expect(res.status).toBe(400);
  });

  it('suggestions: ≤10, rationale beside each; token-bearing verdict is recorded', async () => {
    const { status, json } = await getJson('/suggestions');
    expect(status).toBe(200);
    expect(json.enabled).toBe(true);
    expect(json.suggestions.length).toBeGreaterThan(0);
    expect(json.suggestions.length).toBeLessThanOrEqual(10);
    for (const s of json.suggestions) {
      expect(typeof s.rationale).toBe('string');
      expect(s.rationale.length).toBeGreaterThan(0);
    }
    expect(typeof json.paused).toBe('boolean');
    const cookie = await ownerCookie();
    const post = (suggestionId: string, verdict: string) =>
      fetch(`${base}/verdict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin() },
        body: JSON.stringify({ suggestionId, verdict }),
      });
    const ok = await post(json.suggestions[0].id, 'skip');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, verdict: 'skip' });
    expect((await post('s_0000000000', 'reject')).status).toBe(404);
    const log = fs.readFileSync(brainFile(rootHash, 'suggestions', { homedir: home }), 'utf8');
    expect(log).toContain(`"suggestionId":"${json.suggestions[0].id}"`);
  });

  it('cross-origin write is blocked by ^local-only before the token check', async () => {
    const res = await fetch(`${base}/verdict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ suggestionId: 's_x', verdict: 'accept' }),
    });
    expect(res.status).toBe(403);
  });

  it('reads with a non-loopback Host are refused (DNS-rebinding guard)', async () => {
    const url = new URL(`${base}/overview`);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { host: url.hostname, port: url.port, path: url.pathname, method: 'GET', headers: { Host: 'evil.example' } },
        (r) => {
          r.resume();
          resolve(r.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it('leak probe: /find and /health never expose a gated sentinel or gated path', async () => {
    const queries = leakProbeQueries(corpus, allIds);
    expect(queries.length).toBeGreaterThanOrEqual(100);
    const forbidden = corpus.forbiddenFor('owner');
    const outputs: unknown[] = [];
    for (const q of queries) {
      const res = await fetch(`${base}/find?q=${encodeURIComponent(q)}`);
      outputs.push(await res.json());
    }
    outputs.push((await getJson('/health')).json);
    outputs.push((await getJson('/overview')).json);
    outputs.push((await getJson('/suggestions')).json);
    expect(findLeaks(outputs, forbidden)).toEqual([]);
  });
});
