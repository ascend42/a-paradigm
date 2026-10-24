/**
 * #loop-strictness (docs/specs/gnomon-loops.md §3.3; build plan step 9, M2.11-lite), over the real wired registry,
 * ledger and runner (kernel/loops/wire.ts) with an in-memory kernel log and an injected check executor.
 * Platform-independent: the runner's platform is data ('darwin'); fixtures are built with path.join under os.tmpdir().
 *
 *   effectiveAutonomy  min(the loop's autonomy, the repo cap) with a capReason for the GUI ("act → propose (L2)")
 *   G-LOOP-10          at L2 act lands nothing alone and act runs as propose; at L3 or manual zero runs; a level
 *                      rising mid-run pauses the running loop before its next node; the repo brake pauses at once
 *   L1                 concurrency 1 per repo; gate-class and high-risk lands propose with the second reviewer recorded
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RefusedError, type RunMode, type StrictnessLevel } from '@a-company/gnomon-contracts';
import { compileLoop, loopFileJson } from '../src/loops/index.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { readShebang } from '../src/kernel/loops/hash.js';
import { effectiveAutonomy, landDecision } from '../src/kernel/loops/strictness-cap.js';
import { wireLoops } from '../src/kernel/loops/wire.js';
import type { CheckExecInput, CheckResult } from '../src/kernel/loops/check-exec.js';
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

const loopDef = (id: string, autonomy = 'act'): Def => ({
  schema: 'loop:v2', id, flows: [], autonomy, notify: { on: [], as: 'toast' }, goal: { node: 'b', verdict: 'pass', inputs: ['src/**'] }, start: 'a',
  nodes: [
    { id: 'a', type: 'check', run: ['bin/check', 'a'], on: { pass: 'b', fail: '@stop' } },
    { id: 'b', type: 'check', run: ['bin/check', 'b'], on: { pass: '@goal', fail: '@stop' } },
  ],
});

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

function rig(root: string, o: { check?: (i: CheckExecInput) => Promise<CheckResult>; caps?: Record<string, unknown> } = {}) {
  const rows: Array<{ kind: string; principal: string; keyId: string; at: string; payload: Record<string, unknown> }> = [];
  const listeners: Array<(e: (typeof rows)[number]) => void> = [];
  const cap: { level: StrictnessLevel; mode: RunMode } = { level: 'L0', mode: 'auto-edits' };
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
    broker: { raise: async (input: any) => ({ cardId: input.cardId ?? 'card:x' }) as any },
    check: async (i) => {
      calls.push(i);
      return o.check ? o.check(i) : ok('pass');
    },
    strictness: () => ({ ...cap }),
    ...(o.caps ? { caps: o.caps as any } : {}),
  });
  w.registry.addRepo(root);
  w.registry.scan();
  const rk = repoKeyOf([root]);
  const key = (id: string): string => `repo/${rk}/${id}`;
  const trust = (id: string): void => {
    const e = w.registry.verify(key(id))!;
    w.registry.observe({ kind: 'loop.trusted', principal: KERNEL, keyId: 'kk', payload: { loopId: e.loopId, scope: e.scope, repoKey: e.repoKey, contentHash: e.hash!.contentHash, coreHash: e.hash!.coreHash, ...(e.compiled!.compiled.sourceHash ? { sourceHash: e.compiled!.compiled.sourceHash } : {}), by: HUMAN } });
  };
  const of = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.payload);
  return { w, rows, cap, calls, rk, key, trust, of };
}

const refusalOf = (f: () => unknown): RefusedError['refusal'] | null => {
  try {
    f();
    return null;
  } catch (e) {
    return (e as RefusedError).refusal;
  }
};

describe('#loop-strictness: effectiveAutonomy and landDecision (pure)', () => {
  it('min(the loop autonomy, the repo cap), with a capReason for the GUI', () => {
    expect(effectiveAutonomy({ autonomy: 'act' }, { level: 'L0', mode: 'auto-edits' })).toMatchObject({ autonomy: 'act', paused: false, concurrency: null, secondReviewer: false, capReason: null });
    expect(effectiveAutonomy({ autonomy: 'act' }, { level: 'L1', mode: 'ask' })).toMatchObject({ autonomy: 'act', concurrency: 2, secondReviewer: true });
    expect(effectiveAutonomy({ autonomy: 'act' }, { level: 'L2', mode: 'ask' })).toMatchObject({ autonomy: 'propose', concurrency: 1, capReason: 'act → propose (L2)' });
    expect(effectiveAutonomy({ autonomy: 'observe' }, { level: 'L2', mode: 'ask' })).toMatchObject({ autonomy: 'observe', capReason: null });
    expect(effectiveAutonomy({ autonomy: 'propose' }, { level: 'L3', mode: 'manual' })).toMatchObject({ paused: true, capReason: 'propose → paused (L3)' });
    expect(effectiveAutonomy({ autonomy: 'act' }, { level: 'L0', mode: 'manual' })).toMatchObject({ paused: true, capReason: 'act → paused (manual)' });
    // an unknown autonomy is the least: observe
    expect(effectiveAutonomy({ autonomy: 'admin' }, { level: 'L0', mode: 'ask' }).autonomy).toBe('observe');
  });

  it('G-LOOP-10: at L2 an act loop lands nothing alone; at L1 gate-class and high-risk lands propose with the second reviewer recorded', () => {
    const at = (level: StrictnessLevel, mode: RunMode = 'ask') => effectiveAutonomy({ autonomy: 'act' }, { level, mode });
    expect(landDecision(at('L0'), {})).toEqual({ land: true });
    expect(landDecision(at('L0'), { gateClass: true })).toMatchObject({ land: false, as: 'propose' });
    expect(landDecision(at('L1'), {})).toEqual({ land: true });
    expect(landDecision(at('L1'), { highRisk: true })).toMatchObject({ land: false, as: 'propose', secondReviewer: true });
    expect(landDecision(at('L1'), { gateClass: true })).toMatchObject({ land: false, as: 'propose', secondReviewer: true });
    expect(landDecision(at('L2'), {})).toMatchObject({ land: false, as: 'propose', reason: 'act → propose (L2)' });
    expect(landDecision(at('L3'), {})).toMatchObject({ land: false, as: 'none', reason: 'strictness-paused' });
    expect(landDecision(at('L0', 'manual'), {})).toMatchObject({ land: false, as: 'none' });
  });
});

describe('#loop-strictness: the runner (G-LOOP-10)', () => {
  it('at L3 or in manual mode no loop runs: FORBIDDEN{strictness-paused}, zero runs and zero checks', () => {
    const r = rig(repo([loopDef('lint')]));
    r.trust('lint');
    for (const c of [{ level: 'L3', mode: 'manual' }, { level: 'L0', mode: 'manual' }] as const) {
      Object.assign(r.cap, c);
      expect(refusalOf(() => r.w.runner.start(r.key('lint'), { type: 'manual', by: HUMAN }))).toMatchObject({ code: 'FORBIDDEN', data: { reason: 'strictness-paused' } });
    }
    expect(r.of('loop.run.started')).toHaveLength(0);
    expect(r.calls).toHaveLength(0);
    // the GUI's line
    expect((r.w.port.status().effective as Record<string, any>)[r.key('lint')]).toMatchObject({ paused: true, capReason: 'act → paused (manual)' });
  });

  it('at L2 an act loop runs as propose: every loop.node row records the capped autonomy and its reason', async () => {
    const r = rig(repo([loopDef('lint')]));
    r.trust('lint');
    r.cap.level = 'L2';
    r.cap.mode = 'ask';
    const s = r.w.runner.start(r.key('lint'), { type: 'manual', by: HUMAN });
    expect('done' in s).toBe(true);
    expect(await (s as { done: Promise<{ reason: string }> }).done).toMatchObject({ reason: 'goal' });
    const nodes = r.of('loop.node');
    expect(nodes).toHaveLength(2);
    for (const n of nodes) expect(n).toMatchObject({ effectiveAutonomy: 'propose', capReason: 'act → propose (L2)' });
    expect((r.w.port.status().effective as Record<string, any>)[r.key('lint')]).toMatchObject({ declared: 'act', autonomy: 'propose', level: 'L2', capReason: 'act → propose (L2)' });
  });

  it('a level rising to L3 mid-run pauses the loop before its next node (a kernel pause: resuming takes presence)', async () => {
    let r!: ReturnType<typeof rig>;
    r = rig(repo([loopDef('lint')]), {
      check: async () => {
        r.cap.level = 'L3'; // the human raised the level while node a ran
        return ok('pass');
      },
    });
    r.trust('lint');
    const s = r.w.runner.start(r.key('lint'), { type: 'manual', by: HUMAN }) as { done: Promise<{ reason: string }> };
    expect(await s.done).toMatchObject({ reason: 'strictness' });
    expect(r.calls).toHaveLength(1); // node b never ran
    expect(r.of('loop.paused')).toEqual([expect.objectContaining({ loopId: 'lint', reason: 'strictness', by: 'kernel' })]);
    expect(r.of('loop.run.ended')).toEqual([expect.objectContaining({ reason: 'strictness', terminal: '@pause' })]);
    r.cap.level = 'L0';
    expect(await r.w.runner.resume(r.key('lint'), { connId: 'conn:g', principal: HUMAN, principalClass: 'human', credential: 'gui' })).toMatchObject({ pending: true, pausedFor: 'strictness' });
  });

  it('the repo brake pauses a running loop at once: its check is killed and loop.paused{strictness} is written', async () => {
    const r = rig(repo([loopDef('lint')]), {
      check: (i) => new Promise((res) => i.abort?.addEventListener('abort', () => res(ok('error', { reason: 'killed' })), { once: true })),
    });
    r.trust('lint');
    const s = r.w.runner.start(r.key('lint'), { type: 'manual', by: HUMAN }) as { runId: string; done: Promise<{ reason: string }> };
    while (r.calls.length === 0) await new Promise((res) => setTimeout(res, 1));
    expect(await r.w.brake(r.rk)).toBe(1);
    expect(await r.w.brake(repoKeyOf([path.join(os.tmpdir(), 'other')]))).toBe(0);
    await s.done;
    expect(r.calls[0]!.abort?.aborted).toBe(true);
    expect(r.of('loop.paused')).toEqual([expect.objectContaining({ loopId: 'lint', reason: 'strictness', runId: s.runId })]);
    expect(r.w.runner.running()).toHaveLength(0);
  });

  it('L2 caps the repo to one run at a time and L1 to two (spec strictness.concurrency), under a looser global repo cap', async () => {
    for (const [level, n] of [['L2', 1], ['L1', 2]] as const) {
      let open!: () => void;
      const gate = new Promise<void>((res) => (open = res));
      const r = rig(repo([loopDef('one'), loopDef('two'), loopDef('three')]), { check: async () => (await gate, ok('pass')), caps: { repo: 4 } });
      for (const id of ['one', 'two', 'three']) r.trust(id);
      r.cap.level = level;
      r.cap.mode = 'ask';
      const started = ['one', 'two', 'three'].map((id) => r.w.runner.start(r.key(id), { type: 'manual', by: HUMAN }));
      expect(started.filter((x) => 'queued' in x), level).toHaveLength(3 - n);
      expect(r.w.runner.running(), level).toHaveLength(n);
      open();
      await r.w.runner.idle();
      expect(r.of('loop.run.started'), level).toHaveLength(3); // the queued runs start as slots free
    }
  });
});
