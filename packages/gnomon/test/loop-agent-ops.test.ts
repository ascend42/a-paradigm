/**
 * #loop-agent-ops (docs/specs/gnomon-loops.md §5 "What an agent may do", §3.1 "Attribution"; build plan step 12, LP7),
 * over the real wired registry, trust, ledger and runner (kernel/loops/wire.ts) with an in-memory kernel log, a
 * recording broker and an injected check executor. Platform-independent: the runner's platform is data ('darwin');
 * fixtures are built with path.join under os.tmpdir() and removed with removeTree.
 *
 *   matrix     run: trusted only; pause: any; resume: own agent pause only, never after a kernel pause or the kill
 *              switch; delete: only an untrusted loop it authored, else pause plus a founder toast; reads redacted
 *   G-LOOP-03  (no-envelope half) an agent-created loop and an agent change to a trusted loop each raise exactly one
 *              loop-trust card, and nothing runs before the human trusts it
 *   G-LOOP-05  a loop session (origin 'loop', by hsid) and every session-class asker are refused every loop.request
 *   attribution  authoredBy {principal, hsid} comes from the connection: a payload principal, hsid or by is ignored
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compileLoop, loopFileJson } from '../src/loops/index.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { readShebang } from '../src/kernel/loops/hash.js';
import { wireLoops } from '../src/kernel/loops/wire.js';
import type { CheckExecInput, CheckResult } from '../src/kernel/loops/check-exec.js';
import type { LoopAgentAsker } from '../src/kernel/loops/agent-ops.js';
import { repoKeyOf } from '../src/kernel/supervisor/repo-hooks.js';

type Def = Record<string, any>;
const KERNEL = 'p:abcdefgh/kernel';
const HUMAN = 'p:abcdefgh/matt';

const tmps: string[] = [];
function tmp(prefix: string): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) removeTree(tmps.pop()!);
});
const write = (p: string, text: string): void => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

const loopDef = (id: string, autonomy = 'observe'): Def => ({
  schema: 'loop:v2', id, flows: [], autonomy, notify: { on: [], as: 'toast' }, goal: { node: 'b', verdict: 'pass', inputs: ['src/**'] }, start: 'a',
  nodes: [
    { id: 'a', type: 'check', run: ['bin/check', 'a'], on: { pass: 'b', fail: '@stop' } },
    { id: 'b', type: 'check', run: ['bin/check', 'b'], on: { pass: '@goal', fail: '@stop' } },
  ],
});

function compileInto(root: string, def: Def): string {
  const r = compileLoop(def, { scope: 'repo', readShebang: (a0) => (a0.includes('/') ? readShebang(path.join(root, a0)) : null) });
  if (!r.compiled) throw new Error(JSON.stringify(r.errors));
  write(path.join(root, '.paradigm', 'loops', `${def.id}.loop.json`), loopFileJson(r.compiled));
  return r.compiled.compiled.sourceHash!;
}

function repo(defs: Def[]): string {
  const root = tmp('gnomon-repo-');
  fs.mkdirSync(path.join(root, '.git'));
  write(path.join(root, 'bin', 'check'), '#!/usr/bin/env node\nprocess.exit(0)\n');
  write(path.join(root, 'package.json'), '{"name":"x"}\n');
  for (const def of defs) {
    const r = compileLoop(def, { scope: 'repo', readShebang: (a0) => (a0.includes('/') ? readShebang(path.join(root, a0)) : null) });
    if (!r.compiled) throw new Error(JSON.stringify(r.errors));
    write(path.join(root, '.paradigm', 'loops', `${def.id}.loop.json`), loopFileJson(r.compiled));
  }
  return root;
}

function ok(verdict: CheckResult['verdict'], extra: Partial<CheckResult> = {}): CheckResult {
  return { verdict, exitCode: verdict === 'pass' ? 0 : 1, signal: null, durationMs: 5, evidence: { stdoutTail: '', stderrTail: '', stdoutTruncated: false, stderrTruncated: false, redactions: [], label: 'private', sensitive: true }, profileHash: null, envKeys: [], copy: { dir: '', files: 0, bytes: 0, kept: false }, ...extra };
}

const AGENT = 'p:abcdefgh/arky';
const OTHER = 'p:abcdefgh/jinx';
const agent = (principal = AGENT, hsid: string | null = null): LoopAgentAsker => ({ connId: 'conn:agent', principal, principalClass: 'agent', credential: 'device', hsid });

function rig(root: string, o: { loopSessions?: string[]; clock?: () => number } = {}) {
  const rows: Array<{ kind: string; principal: string; keyId: string; at: string; payload: Record<string, unknown> }> = [];
  const listeners: Array<(e: (typeof rows)[number]) => void> = [];
  const cards: any[] = [];
  const toasts: any[] = [];
  const calls: CheckExecInput[] = [];
  const w = wireLoops({
    home: tmp('gnomon-home-'), kernelPrincipal: KERNEL, start: false, platform: 'darwin',
    log: {
      append: async (i) => {
        const e = { kind: i.kind, principal: i.principal, keyId: 'kk', at: new Date().toISOString(), payload: i.payload as Record<string, unknown> };
        rows.push(e);
        for (const l of listeners) l(e);
        return e;
      },
      read: function* () {},
      onCommit: (l) => listeners.push(l),
      isKernelKey: (k) => k === 'kk',
    },
    broker: {
      raise: async (input: any) => {
        cards.push(input);
        return { cardId: input.cardId, state: 'pending' } as any;
      },
      card: (id: string) => (cards.some((c) => c.cardId === id) ? ({ cardId: id, state: 'pending' } as any) : undefined),
    },
    check: async (i) => {
      calls.push(i);
      return ok('pass');
    },
    toast: (t) => toasts.push(t),
    isLoopSession: (h) => (o.loopSessions ?? []).includes(h),
    tz: 'UTC',
    ...(o.clock ? { clock: o.clock } : {}),
  });
  w.registry.addRepo(root);
  w.registry.scan();
  const rk = repoKeyOf([root]);
  const key = (id: string): string => `repo/${rk}/${id}`;
  const trust = (id: string): void => {
    const e = w.registry.verify(key(id))!;
    w.registry.observe({ kind: 'loop.trusted', principal: KERNEL, keyId: 'kk', payload: { loopId: e.loopId, scope: e.scope, repoKey: e.repoKey, contentHash: e.hash!.contentHash, coreHash: e.hash!.coreHash, sourceHash: e.compiled!.compiled.sourceHash, by: HUMAN } });
  };
  const of = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.payload);
  const ask = (a: LoopAgentAsker, p: Record<string, unknown>) => w.port.agent(a, { scope: 'repo', repo: root, ...p });
  return { w, rows, cards, toasts, calls, rk, key, trust, of, ask };
}

async function refusal(p: Promise<unknown>): Promise<{ code: string; reason: string }> {
  try {
    await p;
  } catch (e) {
    const r = (e as { refusal?: { code: string; data?: { reason?: string } }; code?: string }).refusal;
    return { code: r?.code ?? 'none', reason: String(r?.data?.reason ?? '') };
  }
  throw new Error('expected a refusal');
}

const src = (w: ReturnType<typeof rig>['w'], key: string): string => w.registry.entry(key)!.compiled!.compiled.sourceHash!;

describe('#loop-agent-ops: attribution from the connection (§3.1)', () => {
  it('create stamps authoredBy {principal, hsid} from the asker; a payload principal, hsid or by is ignored', async () => {
    const root = repo([loopDef('one')]);
    const r = rig(root);
    const res = (await r.ask(agent(AGENT, 'hs-real'), { op: 'create', loopId: 'one', sourceHash: src(r.w, r.key('one')), principal: OTHER, hsid: 'hs-forged', by: OTHER })) as Record<string, unknown>;
    expect(res).toMatchObject({ authored: true, authoredBy: 'arky', pending: true });
    const [row] = r.of('loop.request');
    expect(row).toMatchObject({ op: 'create', loopId: 'one', by: AGENT, hsid: 'hs-real', repo: root });
    expect(r.rows.find((x) => x.kind === 'loop.request')!.principal).toBe(KERNEL);
    expect(r.w.registry.authoredBy(r.w.registry.entry(r.key('one'))!)).toMatchObject({ principal: AGENT, hsid: 'hs-real', basis: 'agent-key-claim' });
    expect(row).toMatchObject({ basis: 'agent-key-claim' });
    expect(r.w.registry.view(r.w.registry.entry(r.key('one'))!).shape?.authoredBy).toBe('arky');
  });

  it('a definition that changes with no matching request row is authoredBy file; a stale sourceHash attributes nothing', async () => {
    const root = repo([loopDef('one')]);
    const r = rig(root);
    await r.ask(agent(), { op: 'create', loopId: 'one', sourceHash: src(r.w, r.key('one')) });
    compileInto(root, { ...loopDef('one'), notify: { on: ['fail'], as: 'toast' } });
    r.w.registry.scan();
    expect(r.w.registry.authoredBy(r.w.registry.verify(r.key('one'))!)).toBe('file');
    expect((await refusal(r.ask(agent(), { op: 'update', loopId: 'one', sourceHash: 'a'.repeat(64) }))).code).toBe('BAD_REQUEST');
    expect(r.w.registry.authoredBy(r.w.registry.entry(r.key('one'))!)).toBe('file');
  });

  it('only kernel-principal request rows attribute (a forged row from another principal folds nothing)', () => {
    const root = repo([loopDef('one')]);
    const r = rig(root);
    const e = r.w.registry.entry(r.key('one'))!;
    r.w.registry.observe({ kind: 'loop.request', principal: AGENT, keyId: 'kk', payload: { op: 'create', loopId: 'one', scope: 'repo', repoKey: r.rk, sourceHash: src(r.w, r.key('one')), by: AGENT } });
    expect(r.w.registry.authoredBy(e)).toBe('file');
  });
});

describe('#loop-agent-ops: G-LOOP-03 (no envelope): an agent loop takes exactly one card and never runs before', () => {
  it('create raises ONE loop-trust card (a repeat finds it), never trusts, and run is refused until the human trusts', async () => {
    const root = repo([loopDef('one')]);
    const r = rig(root);
    const sh = src(r.w, r.key('one'));
    const a = (await r.ask(agent(), { op: 'create', loopId: 'one', sourceHash: sh })) as { cardId: string };
    const b = (await r.ask(agent(), { op: 'update', loopId: 'one', sourceHash: sh })) as { cardId: string };
    expect(r.cards.filter((c) => c.kind === 'loop-trust')).toHaveLength(1);
    expect(b.cardId).toBe(a.cardId);
    const card = r.cards[0];
    expect(card).toMatchObject({ kind: 'loop-trust', requestedBy: AGENT, handOnly: true });
    expect(card.detail.rootRows[0]).toMatchObject({ by: 'root', requestedBy: AGENT });
    expect(r.of('loop.trusted')).toHaveLength(0);
    expect(await refusal(r.ask(agent(), { op: 'run', loopId: 'one' }))).toMatchObject({ code: 'FORBIDDEN', reason: 'not-trusted' });
    expect(r.calls).toHaveLength(0);
    expect(r.of('loop.run.started')).toHaveLength(0);
  });

  it('an agent change to a trusted loop pauses it and raises exactly one card for the new version', async () => {
    const root = repo([loopDef('one')]);
    const r = rig(root);
    r.trust('one');
    compileInto(root, { ...loopDef('one'), notify: { on: ['fail'], as: 'toast' } });
    r.w.registry.verify(r.key('one'));
    await r.ask(agent(), { op: 'update', loopId: 'one', sourceHash: src(r.w, r.key('one')) });
    await r.ask(agent(), { op: 'update', loopId: 'one', sourceHash: src(r.w, r.key('one')) });
    expect(r.cards.filter((c) => c.kind === 'loop-trust')).toHaveLength(1);
    expect(r.w.registry.stateOf(r.w.registry.entry(r.key('one'))!).state).toBe('waiting-trust');
    expect((await refusal(r.ask(agent(), { op: 'run', loopId: 'one' }))).reason).toBe('not-trusted');
  });
});

describe('#loop-agent-ops: G-LOOP-05 and the class matrix', () => {
  it('a loop session (by hsid) and any session-class asker are refused every op; peers, voice, humans too', async () => {
    const root = repo([loopDef('one')]);
    const r = rig(root, { loopSessions: ['hs-loop'] });
    r.trust('one');
    const sh = src(r.w, r.key('one'));
    for (const op of ['create', 'update', 'run', 'pause', 'resume', 'delete', 'runs', 'logs', 'trust-status']) {
      expect(await refusal(r.ask(agent(AGENT, 'hs-loop'), { op, loopId: 'one', sourceHash: sh }))).toMatchObject({ code: 'FORBIDDEN', reason: 'loop-session' });
      expect(await refusal(r.ask({ ...agent(), principalClass: 'session' }, { op, loopId: 'one' }))).toMatchObject({ code: 'FORBIDDEN', reason: 'loop-session' });
    }
    for (const cls of ['peer', 'voice', 'mod', 'human']) expect(await refusal(r.ask({ ...agent(), principalClass: cls }, { op: 'pause', loopId: 'one' }))).toMatchObject({ code: 'FORBIDDEN', reason: 'matrix' });
    expect(await refusal(r.ask({ ...agent(), credential: 'read-token' }, { op: 'runs', loopId: 'one' }))).toMatchObject({ reason: 'matrix' });
    expect(r.of('loop.request')).toHaveLength(0);
  });
});

describe('#loop-agent-ops: the permission matrix', () => {
  it('run: a trusted loop runs (manual, by the agent); an untrusted one is refused', async () => {
    const root = repo([loopDef('one'), loopDef('two')]);
    const r = rig(root);
    r.trust('one');
    expect(await r.ask(agent(), { op: 'run', loopId: 'one' })).toMatchObject({ started: true });
    await r.w.runner.idle();
    expect(r.of('loop.run.started')[0]).toMatchObject({ loopId: 'one', trigger: { type: 'manual', by: AGENT, agent: true } });
    expect((await refusal(r.ask(agent(), { op: 'run', loopId: 'two' }))).reason).toBe('not-trusted');
  });

  it('pause any loop; resume only its own pause, never another agent, a human or a kernel pause', async () => {
    const root = repo([loopDef('one'), loopDef('two'), loopDef('three')]);
    const r = rig(root);
    for (const id of ['one', 'two', 'three']) r.trust(id);
    expect(await r.ask(agent(), { op: 'pause', loopId: 'one' })).toMatchObject({ paused: true });
    expect(r.w.registry.pauseOf(r.key('one'))).toMatchObject({ reason: 'agent', by: AGENT, epoch: 0 });
    expect((await refusal(r.ask(agent(OTHER), { op: 'resume', loopId: 'one' }))).reason).toBe('not-own-pause');
    expect(await r.ask(agent(), { op: 'resume', loopId: 'one' })).toMatchObject({ resumed: true });
    expect(r.w.registry.stateOf(r.w.registry.entry(r.key('one'))!).state).toBe('trusted');
    await r.w.runner.pause(r.key('two'), HUMAN, 'human');
    expect((await refusal(r.ask(agent(), { op: 'resume', loopId: 'two' }))).reason).toBe('not-own-pause');
    await r.w.runner.pause(r.key('three'), 'kernel', 'budget');
    expect((await refusal(r.ask(agent(), { op: 'resume', loopId: 'three' }))).reason).toBe('not-own-pause');
    expect(r.cards.filter((c) => c.kind === 'loop-choice')).toHaveLength(0);
  });

  it('resume is refused after the kill switch, even for a loop the agent had paused itself', async () => {
    const root = repo([loopDef('one'), loopDef('two')]);
    const r = rig(root);
    r.trust('one');
    r.trust('two');
    await r.ask(agent(), { op: 'pause', loopId: 'one' });
    await r.w.runner.pauseAll(HUMAN);
    expect(r.of('loop.paused').filter((x) => x.all === true)).toHaveLength(1);
    expect(r.w.registry.killEpoch()).toBe(1);
    expect(await refusal(r.ask(agent(), { op: 'resume', loopId: 'one' }))).toMatchObject({ code: 'FORBIDDEN', reason: 'kernel-pause' });
  });

  it('delete (8.0): always a pause plus a founder toast, even an untrusted loop the agent authored', async () => {
    const root = repo([loopDef('mine'), loopDef('trusted')]);
    const r = rig(root);
    await r.ask(agent(), { op: 'create', loopId: 'mine', sourceHash: src(r.w, r.key('mine')) });
    expect(await r.ask(agent(), { op: 'delete', loopId: 'mine' })).toMatchObject({ deleted: false, founderToast: true });
    r.trust('trusted');
    expect(await r.ask(agent(), { op: 'delete', loopId: 'trusted' })).toMatchObject({ deleted: false, paused: true });
    expect(r.of('loop.deleted')).toHaveLength(0);
    expect(r.toasts.filter((t) => /asked to delete/.test(t.text))).toHaveLength(2);
    expect(r.of('loop.request').filter((x) => x.op === 'delete').every((x) => x.repo === root)).toBe(true);
  });

  it('pausing a loop the agent did not author toasts the founder; its own loop does not', async () => {
    const root = repo([loopDef('mine'), loopDef('flow-health')]);
    const r = rig(root);
    await r.ask(agent(), { op: 'create', loopId: 'mine', sourceHash: src(r.w, r.key('mine')) });
    await r.ask(agent(), { op: 'pause', loopId: 'mine' });
    await r.ask(agent(), { op: 'pause', loopId: 'flow-health' });
    expect(r.toasts.map((t) => t.text)).toEqual(['arky paused flow-health']);
  });

  it('resume fires ONE catch-up run when a schedule came due during the pause', async () => {
    const def = { ...loopDef('often'), triggers: [{ schedule: { every: '1m' }, catchUp: 'skip' }], budgets: { day: { runs: 12 } } };
    const root = repo([def]);
    let skew = 0;
    const r = rig(root, { clock: () => Date.now() + skew });
    r.trust('often');
    await r.ask(agent(), { op: 'pause', loopId: 'often' });
    skew = 30_000;
    expect(await r.ask(agent(), { op: 'resume', loopId: 'often' })).not.toHaveProperty('catchUp');
    await r.ask(agent(), { op: 'pause', loopId: 'often' });
    skew = 5 * 60_000;
    const res = (await r.ask(agent(), { op: 'resume', loopId: 'often' })) as Record<string, unknown>;
    expect(res).toMatchObject({ resumed: true });
    expect(typeof res.catchUp).toBe('string');
    await r.w.runner.idle();
    expect(r.of('loop.run.started').filter((x) => (x.trigger as { type?: string }).type === 'catch-up')).toHaveLength(1);
  });

  it('targets: junk repo paths never reach the registry (no eviction), and unknown repo = unknown loop', async () => {
    const root = repo([loopDef('one')]);
    const r = rig(root);
    const before = r.w.registry.repos();
    const junk = tmp('gnomon-junk-');
    const msgs = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const d = path.join(junk, `j${i}`);
      fs.mkdirSync(d);
      try {
        await r.w.port.agent(agent(), { op: 'pause', loopId: 'one', scope: 'repo', repo: d });
      } catch (e) {
        msgs.add(`${(e as any).refusal.code}:${(e as Error).message}`);
      }
    }
    expect(r.w.registry.repos()).toEqual(before);
    try {
      await r.ask(agent(), { op: 'pause', loopId: 'nope' });
    } catch (e) {
      msgs.add(`${(e as any).refusal.code}:${(e as Error).message}`);
    }
    expect([...msgs]).toHaveLength(1);
    expect([...msgs][0]).toMatch(/^NOT_FOUND:/);
    expect(await r.ask(agent(), { op: 'pause', loopId: 'one' })).toMatchObject({ paused: true });
  });

  it('reads: runs and logs carry verdicts and counts, never evidence or detail; trust-status lists who trusted what', async () => {
    const root = repo([loopDef('one')]);
    const r = rig(root);
    r.trust('one');
    await r.ask(agent(), { op: 'run', loopId: 'one' });
    await r.w.runner.idle();
    const rows = r.rows.length;
    const runs = (await r.ask(agent(), { op: 'runs', loopId: 'one' })) as { runs: Array<Record<string, unknown>> };
    expect(runs.runs[0]).toMatchObject({ loopId: 'one', verdicts: { pass: 2 }, nodeVisits: 2 });
    const logs = (await r.ask(agent(), { op: 'logs', runId: runs.runs[0]!.runId })) as { run: { nodes: Array<Record<string, unknown>> } };
    expect(logs.run.nodes.map((n) => n.verdict)).toEqual(['pass', 'pass']);
    const text = JSON.stringify([runs, logs]);
    expect(text).not.toMatch(/stdoutTail|detail|evidenceRef/);
    expect((await refusal(r.w.port.agent(agent(), { op: 'trust-status' }))).code).toBe('BAD_REQUEST');
    const elsewhere = tmp('gnomon-other-');
    expect((await refusal(r.w.port.agent(agent(), { op: 'logs', runId: runs.runs[0]!.runId, scope: 'repo', repo: elsewhere }))).code).toBe('NOT_FOUND');
    const ts = (await r.ask(agent(), { op: 'trust-status' })) as { loops: Array<Record<string, unknown>>; envelopes: unknown[] };
    expect(ts.loops[0]).toMatchObject({ loopId: 'one', state: 'trusted', trustedBy: HUMAN, authoredBy: 'file' });
    expect(ts.envelopes).toEqual([]);
    expect(r.rows.length).toBe(rows); // reads write no row
  });

  it('bad shapes: an unknown op, a missing sourceHash, an unknown key', async () => {
    const root = repo([loopDef('one')]);
    const r = rig(root);
    expect((await refusal(r.ask(agent(), { op: 'trust', loopId: 'one' }))).code).toBe('BAD_REQUEST');
    expect((await refusal(r.ask(agent(), { op: 'create', loopId: 'one' }))).code).toBe('BAD_REQUEST');
    expect((await refusal(r.ask(agent(), { op: 'pause', loopId: 'one', extra: 1 }))).code).toBe('BAD_REQUEST');
  });
});
