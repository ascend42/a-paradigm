/**
 * #local-runner fix 2026-10-31 (boot load): every Gnomon launch made Ollama load a 9.7B model and run generations
 * (the daemon-start probe sent a live tool-call completion, then T2-T4), freezing a 16 GB Mac. Now:
 *   - daemon start (probeAll with no options) asks only metadata (/health, /slots, /props, /v1/models, /api/show,
 *     /api/ps, /api/tags): no completion, no /api/generate or /api/chat, no keep_alive;
 *   - the tool check (T1) and the tier (T2-T4) are cached by the model's fingerprint and reused;
 *   - the first local session with an unknown fingerprint checks it exactly once (lazily, at open).
 * Against a FAKE Ollama-shaped fetch that records every URL and body; never a real model. Platform-independent:
 * every open stops at the intend seam before anything spawns.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalLane } from '../src/kernel/supervisor/local-session.js';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { ensureGnomonHome } from '../src/kernel/lifecycle/home.js';
import { readTiers, writeMeasured } from '../src/kernel/local/tool-tier.js';

const HUMAN = 'p:abcdefgh/founder';
const FAKE_PIN = { node: process.execPath, nodeSha256: '0'.repeat(64), dir: '/x/gnomon-local/dist', treeSha256: '0'.repeat(64), entry: 'cli.js' };
const BASE = 'http://127.0.0.1:11434';
const MODEL = 'qwen3.5:9b';
const DIGEST = 'a'.repeat(64);
const T1_PROMPT = 'What time is it in UTC? Use the tool.';

let tmp: string | null = null;
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});
const scratchHome = (): string => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-bootprobe-')));
  return ensureGnomonHome(path.join(tmp, 'gnomon-home'));
};

/** An Ollama-shaped server: no /slots or /props, num_ctx in /api/show, the digest in /api/tags; every call recorded. */
function ollama(o: { digest?: string } = {}) {
  const calls: Array<{ url: string; method: string; body: string }> = [];
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? init.body : '' });
    const p = new URL(url).pathname;
    if (p === '/v1/models') return json({ data: [{ id: MODEL }] });
    if (p === '/api/show') return json({ parameters: 'num_ctx                        32768\ntemperature 1' });
    if (p === '/api/ps') return json({ models: [] });
    if (p === '/api/tags') return json({ models: [{ name: MODEL, digest: o.digest ?? DIGEST }] });
    // every completion answers get_time: T1 passes, T2 (lookup_city first) fails, so the measured skill is 1
    if (p === '/v1/chat/completions') return json({ choices: [{ message: { tool_calls: [{ function: { name: 'get_time', arguments: '{"tz":"UTC"}' } }] } }] });
    return new Response('404 page not found', { status: 404 });
  };
  const completions = () => calls.filter((c) => new URL(c.url).pathname === '/v1/chat/completions');
  const t1s = () => completions().filter((c) => c.body.includes(T1_PROMPT));
  /** anything that makes Ollama load weights or pins them: a completion, /api/generate, /api/chat, keep_alive */
  const loads = () => calls.filter((c) => ['/v1/chat/completions', '/v1/completions', '/api/generate', '/api/chat', '/api/embed', '/api/embeddings'].includes(new URL(c.url).pathname) || c.body.includes('keep_alive'));
  return { fetch, calls, completions, t1s, loads };
}

function lane(home: string, fetch: (u: string, i: RequestInit) => Promise<Response>, o: { probeTtlMs?: number } = {}) {
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
  const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
  const broker = { raise: async () => ({ cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' }) };
  // the run stops at intend: nothing spawns
  const children = { intend: async () => { throw new Error('intend reached (test stop)'); }, track: async () => undefined, stop: async () => false };
  const l = new LocalLane({ sessionPath: null, pathDenies: [],
    log, children: children as never, fuse, broker: broker as never, home, userHome: path.join(home, '..', 'userhome'), kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(home, 'k.sock'),
    launchPlan: (i) => ({ command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test', profileHash: 'sha256:test' }),
    probeFetch: fetch,
    ...(o.probeTtlMs !== undefined ? { probeTtlMs: o.probeTtlMs } : {}),
    config: { endpoints: [{ id: 'ollama', base: BASE, model: MODEL, compat: 'ollama' }], runner: FAKE_PIN },
  });
  const open = () => l.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: path.join(home, '..'), model: 'local' }, async () => null).catch((e: unknown) => e);
  return { l, rows, open };
}

describe('fix 2026-10-31: the daemon-start probe never loads the model', () => {
  it('start-up asks only metadata: no completion, no /api/generate or /api/chat, no keep_alive; tools stay unchecked', async () => {
    const home = scratchHome();
    const srv = ollama();
    const { l, rows } = lane(home, srv.fetch);
    expect(await l.probeAll()).toEqual([{ endpoint: 'ollama', ok: true }]);
    await l.tierSettled();
    expect(srv.loads()).toEqual([]);
    expect(srv.calls.length).toBeGreaterThan(0);
    for (const c of srv.calls) expect(['/health', '/slots', '/props', '/v1/models', '/api/show', '/api/ps', '/api/tags']).toContain(new URL(c.url).pathname);
    // the rows and Settings say "not checked yet", never "no tools"
    expect(rows.find((r) => r.kind === 'model.capabilities')?.payload).toMatchObject({ endpoint: 'ollama', ctx: 32768, ctxSource: 'ollama-show', toolsSource: 'unchecked' });
    expect(l.lastProbe()).toMatchObject({ endpoint: 'ollama', ok: false, why: 'tools-unchecked', contextSize: 32768 });
    expect(l.lastProbe()?.tier).toMatchObject({ skill: null, measuring: false });
    // nothing was measured or written
    expect(Object.keys(readTiers(home).records)).toEqual([]);
  });

  it('a cached fingerprint skips the probe: start-up and the first open ask no generation', async () => {
    const home = scratchHome();
    writeMeasured(home, { base: BASE, model: MODEL, fingerprint: `ollama:${DIGEST}` }, { skill: 2, passed: 3 });
    const srv = ollama();
    const { l, rows, open } = lane(home, srv.fetch, { probeTtlMs: 0 });
    await l.probeAll();
    expect(srv.loads()).toEqual([]);
    expect(rows.find((r) => r.kind === 'model.capabilities')?.payload).toMatchObject({ tools: true, toolsSource: 'cached' });
    expect(l.lastProbe()).toMatchObject({ ok: true, why: 'capable', tools: true });
    expect(l.lastProbe()?.tier).toMatchObject({ skill: 2, passed: 3, measuring: false });
    await open();
    await l.tierSettled();
    expect(srv.completions()).toEqual([]);
    // a different model behind the same tag (a new digest) is NOT the cached one
    const other = ollama({ digest: 'b'.repeat(64) });
    const l2 = lane(home, other.fetch);
    await l2.l.probeAll();
    expect(l2.l.lastProbe()).toMatchObject({ why: 'tools-unchecked' });
    expect(other.loads()).toEqual([]);
  });

  it('the first local session with a new fingerprint probes exactly once; the next start reuses the result', async () => {
    const home = scratchHome();
    const srv = ollama();
    // probeTtlMs 0: every open re-asks the metadata, so only the fingerprint cache can spare the generation
    const { l, rows, open } = lane(home, srv.fetch, { probeTtlMs: 0 });
    await l.probeAll();
    expect(srv.loads()).toEqual([]);
    await open();
    expect(srv.t1s()).toHaveLength(1);
    // the model.probe row is written BEFORE the generation (the GUI re-reads status, which says checking…)
    const probeAt = rows.findIndex((r) => r.kind === 'model.probe' && rows.indexOf(r) > 1);
    const liveAt = rows.findIndex((r) => r.kind === 'model.capabilities' && r.payload.toolsSource === 'live');
    expect(probeAt).toBeGreaterThan(-1);
    expect(liveAt).toBeGreaterThan(probeAt);
    await l.tierSettled();
    // the background measurement ran once after it (T2's first request fails here: skill 1) and was stored
    expect(Object.values(readTiers(home).records)).toEqual([expect.objectContaining({ fingerprint: `ollama:${DIGEST}`, skill: 1, passed: 1 })]);
    const after = srv.completions().length;
    await open();
    await open();
    await l.tierSettled();
    expect(srv.t1s()).toHaveLength(1);
    expect(srv.completions()).toHaveLength(after);
    // a restart (a new lane on the same home): start-up and the first open use the stored result
    const srv2 = ollama();
    const next = lane(home, srv2.fetch);
    await next.l.probeAll();
    await next.open();
    await next.l.tierSettled();
    expect(srv2.loads()).toEqual([]);
    expect(next.l.lastProbe()).toMatchObject({ tools: true });
  });

  it('a tool check with no answer (Ollama could not load the model) is not remembered: the next open asks again', async () => {
    const home = scratchHome();
    const srv = ollama();
    let fail = true;
    const fetch = async (u: string, i: RequestInit): Promise<Response> => (fail && u.endsWith('/v1/chat/completions') ? (srv.calls.push({ url: u, method: 'POST', body: String(i.body) }), new Response('{"error":"model requires more system memory"}', { status: 500 })) : srv.fetch(u, i));
    const { l, open } = lane(home, fetch, { probeTtlMs: 0 });
    await open();
    await l.tierSettled();
    expect(srv.t1s()).toHaveLength(1);
    expect(Object.keys(readTiers(home).records)).toEqual([]);
    fail = false;
    await open();
    await l.tierSettled();
    expect(srv.t1s()).toHaveLength(2);
  });
});
