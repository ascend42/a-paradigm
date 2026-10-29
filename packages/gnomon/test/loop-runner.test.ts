/**
 * #loop-runner falsifiers (docs/specs/gnomon-loops.md §2, §3.3, §3.5, §4, §8; build plan step 5, LP3), over the real
 * registry, ledger and runner with an injected check executor (the sandboxed executor end to end is
 * loop-runner-darwin.test.ts). Platform-independent: the runner's platform is data ('darwin'), fixtures are built
 * with path.join under os.tmpdir().
 *
 *   graph      check → notify toast → @stop, @goal, a missing edge → @stop, a model loop with no local model is refused at start, act
 *              and write nodes refused ("lands in step 10"), call nodes (pin, goal → pass, budget → unsure), the
 *              loop-choice card (continue, stop, timeout → @pause)
 *   G-LOOP-11  rounds, wall, compute, day-runs and global caps stop the NEXT step; absent budgets are the defaults
 *   G-LOOP-14  a kill mid-run, then a restart: the run ends daemon-restart, nothing re-executes, budgets fold the same
 *   G-LOOP-17  replay reproduces every edge from the rows alone; a reordered row is a divergence
 *   G-LOOP-26  the kill switch: every run stopped (the check aborted), every trusted loop paused, no presence;
 *              resuming takes a loop-choice card decided with presence (Aegis M3); a human pause resumes at once
 *   concurrency one run per loop (coalesced rerun), the repo cap queues
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compileLoop, loopContentHash, loopFileJson, LOOP_BUDGET_DEFAULTS } from '../src/loops/index.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { readShebang } from '../src/kernel/loops/hash.js';
import { LoopLedger, replayLoopRuns } from '../src/kernel/loops/ledger.js';
import { LoopRegistry } from '../src/kernel/loops/registry.js';
import { ACT_NODES_LATER, effectiveBudgets, LoopRunner, renderNotifyText, unsupportedNodes } from '../src/kernel/loops/runner.js';
import { foldReplay } from '../src/kernel/log/replay.js';
import type { CheckExecInput, CheckResult } from '../src/kernel/loops/check-exec.js';
import { repoKeyOf } from '../src/kernel/supervisor/repo-hooks.js';
import { logLines, runRows, type LoopRunView } from '../src/cli/loop-cli.js';
import { checkStatusNumbers } from '../src/kernel/socket/status-numbers.js';
import { paradigmCliResolver } from '../src/kernel/loops/wire.js';

type Def = Record<string, any>;
const KERNEL = 'p:abcdefgh/kernel';
const HUMAN = 'p:abcdefgh/matt';
const gui = { connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', principal: HUMAN, principalClass: 'human', credential: 'gui' };

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

function putLoop(root: string, def: Def, known?: Record<string, Def>): void {
  const r = compileLoop(def, { scope: 'repo', ...(known ? { knownLoops: known } : {}), readShebang: (a0) => (a0.includes('/') ? readShebang(path.join(root, a0)) : null) });
  if (!r.compiled) throw new Error(JSON.stringify(r.errors));
  write(path.join(root, '.paradigm', 'loops', `${def.id}.loop.json`), loopFileJson(r.compiled));
}

function repo(defs: Def[] = []): string {
  const root = tmp('gnomon-repo-');
  fs.mkdirSync(path.join(root, '.git'));
  write(path.join(root, 'bin', 'check'), '#!/usr/bin/env node\nprocess.exit(0)\n');
  write(path.join(root, 'package.json'), '{"name":"x"}\n');
  for (const d of defs) putLoop(root, d);
  return root;
}

const chk = (id: string, on: Record<string, string>, extra: Def = {}): Def => ({ id, type: 'check', run: ['bin/check', id], on, ...extra });

/** Example A minus its `why` model node: a flow-health check that toasts on failure. */
const exampleA = (id = 'flow-health-checkout'): Def => ({
  schema: 'loop:v2', id, flows: [], autonomy: 'observe', notify: { on: ['fail'], as: 'toast' },
  budgets: { run: { wallMin: 15, computeSec: 300 }, day: { runs: 12 } }, goal: { node: 'drift', verdict: 'pass', inputs: ['src/**'] }, start: 'defn',
  nodes: [
    chk('defn', { pass: 'gates', fail: 'tell' }),
    chk('gates', { pass: 'tests', fail: 'tell' }),
    chk('tests', { pass: 'drift', fail: 'tell' }),
    chk('drift', { pass: '@goal', fail: 'tell' }),
    { id: 'tell', type: 'notify', as: 'toast', text: '{{loop.id}} failed at {{failed.node}}', on: { any: '@stop' } },
  ],
});

function ok(verdict: CheckResult['verdict'], durationMs = 10, extra: Partial<CheckResult> = {}): CheckResult {
  return { verdict, exitCode: verdict === 'pass' ? 0 : 1, signal: null, durationMs, evidence: { stdoutTail: `out ${verdict}`, stderrTail: '', stdoutTruncated: false, stderrTruncated: false, redactions: [], label: 'private', sensitive: true }, profileHash: null, envKeys: [], copy: { dir: '', files: 0, bytes: 0, kept: false }, ...extra };
}

interface RigOpts {
  home?: string;
  rows?: Array<{ kind: string; principal: string; at: string; payload: Record<string, unknown> }>;
  check?: (i: CheckExecInput) => Promise<CheckResult>;
  caps?: Record<string, unknown>;
  clock?: () => number;
  platform?: string;
}

function rig(root: string, o: RigOpts = {}) {
  const home = o.home ?? tmp('gnomon-home-');
  const rows = o.rows ?? [];
  const clock = o.clock ?? Date.now;
  const calls: CheckExecInput[] = [];
  const cards: any[] = [];
  const toasts: any[] = [];
  const registry = new LoopRegistry({ home, kernelPrincipal: KERNEL, append: async (k, p) => append(k, p), watch: false, rescanMs: 0 });
  const ledger = new LoopLedger({ kernelPrincipal: KERNEL });
  const append = async (kind: string, payload: Record<string, unknown>): Promise<void> => {
    const row = { kind, principal: KERNEL, at: new Date(clock()).toISOString(), payload };
    rows.push(row);
    registry.observe(row);
    ledger.observe(row);
  };
  for (const r of rows) {
    registry.observe(r);
    ledger.observe(r);
  }
  registry.addRepo(root);
  registry.scan();
  const runner = new LoopRunner({
    home, kernelPrincipal: KERNEL, registry, ledger, append, platform: o.platform ?? 'darwin', clock,
    broker: { raise: async (input: any) => { cards.push(input); return { cardId: input.cardId } as any; } },
    check: async (i) => {
      calls.push(i);
      return o.check ? o.check(i) : ok('pass');
    },
    toast: (t) => toasts.push(t),
    ...(o.caps ? { caps: o.caps as any } : {}),
  });
  const key = (id: string): string => `repo/${repoKeyOf([root])}/${id}`;
  const trust = (id: string): void => {
    const e = registry.verify(key(id))!;
    registry.observe({ kind: 'loop.trusted', principal: KERNEL, payload: { loopId: e.loopId, scope: e.scope, repoKey: e.repoKey, contentHash: e.hash!.contentHash, coreHash: e.hash!.coreHash, ...(e.compiled!.compiled.sourceHash ? { sourceHash: e.compiled!.compiled.sourceHash } : {}), by: HUMAN } });
  };
  const run = async (id: string) => {
    const r = runner.start(key(id), { type: 'manual', by: HUMAN });
    if (!('done' in r)) throw new Error(`not started: ${JSON.stringify(r)}`);
    return { runId: r.runId, end: await r.done };
  };
  const of = (runId: string, kind: string) => rows.filter((r) => r.kind === kind && r.payload.runId === runId).map((r) => r.payload);
  return { home, rows, calls, cards, toasts, registry, ledger, runner, key, trust, run, of };
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe('#loop-runner: the walk (§2)', () => {
  it('an untrusted loop never runs: refused, zero rows, zero checks (LL1)', () => {
    const root = repo([exampleA()]);
    const r = rig(root);
    expect(() => r.runner.start(r.key('flow-health-checkout'), { type: 'manual' })).toThrow(/cannot run: untrusted/);
    expect(r.rows).toEqual([]);
    expect(r.calls).toEqual([]);
  });

  it('Example A minus why: defn → gates → tests fails → tell toasts → @stop; rows, toast, ledger and the CLI readout', async () => {
    const root = repo([exampleA()]);
    const r = rig(root, { check: async (i) => ok(i.node.id === 'tests' ? 'fail' : 'pass', 25) });
    r.trust('flow-health-checkout');
    const { runId, end } = await r.run('flow-health-checkout');
    expect(end).toMatchObject({ reason: 'stop', terminal: '@stop' });
    expect(r.calls.map((c) => c.node.id)).toEqual(['defn', 'gates', 'tests']);
    // the pins come from the trusted hash: argv0 is the repo script, its interpreter the node the hash resolved
    expect(r.calls[0]!.argv0?.real).toBe(fs.realpathSync.native(path.join(root, 'bin', 'check')));
    expect(r.calls[0]!.node.timeoutSec).toBeLessThanOrEqual(600);
    const started = r.of(runId, 'loop.run.started')[0]!;
    expect(started).toMatchObject({ loopId: 'flow-health-checkout', scope: 'repo', contentHash: r.registry.entry(r.key('flow-health-checkout'))!.hash!.contentHash, trigger: { type: 'manual', by: HUMAN } });
    expect(r.of(runId, 'loop.node').map((n) => [n.nodeId, n.visit, n.verdict, n.edge, n.next])).toEqual([
      ['defn', 1, 'pass', 'pass', 'gates'], ['gates', 1, 'pass', 'pass', 'tests'], ['tests', 1, 'fail', 'fail', 'tell'], ['tell', 1, 'pass', 'pass', '@stop'],
    ]);
    const tests = r.of(runId, 'loop.node')[2]!;
    expect(tests).toMatchObject({ evidenceRef: `loop-evidence:${runId}/tests/1`, evidence: { stdoutTail: 'out fail' }, durationMs: 25, effectiveAutonomy: 'observe' });
    expect(r.of(runId, 'loop.notified')).toEqual([{ runId, loopId: 'flow-health-checkout', nodeId: 'tell', as: 'toast', text: 'flow-health-checkout failed at tests' }]);
    expect(r.toasts).toEqual([{ loopId: 'flow-health-checkout', runId, nodeId: 'tell', repo: root, text: 'flow-health-checkout failed at tests' }]);
    expect(r.of(runId, 'loop.round')).toEqual([{ runId, loopId: 'flow-health-checkout', round: 1, nodeVisits: 4, escalations: 0 }]);
    expect(r.of(runId, 'loop.run.ended')[0]).toMatchObject({ reason: 'stop', terminal: '@stop', rounds: 1, computeMs: 75 });
    // `gnomon loop runs` / `logs` render the status the runner serves
    const st = r.runner.status() as { runs: LoopRunView[] };
    expect(st.runs[0]).toMatchObject({ runId, reason: 'stop', computeMs: 75, notified: 1 });
    expect(runRows(st.runs[0]!)).toContainEqual(['nodes', 'defn:pass → gates:pass → tests:fail → tell:pass']);
    expect(logLines(st.runs[0]!)[2]).toBe('#1 tests (check, round 1) fail --fail--> tell 25 ms');
    // G-HON-03: every number status.loops now carries is declared (status-numbers.ts)
    expect(checkStatusNumbers({ loops: { ...r.registry.status(), ...r.runner.status() } })).toEqual([]);
  });

  it('all green reaches @goal; the loop-level notify (on: fail) stays quiet', async () => {
    const root = repo([exampleA()]);
    const r = rig(root);
    r.trust('flow-health-checkout');
    const { runId, end } = await r.run('flow-health-checkout');
    expect(end).toMatchObject({ reason: 'goal', terminal: '@goal' });
    expect(r.of(runId, 'loop.node').map((n) => n.next)).toEqual(['gates', 'tests', 'drift', '@goal']);
    expect(r.toasts).toEqual([]);
  });

  it('a missing edge goes to @stop; a check error takes the error edge (default @stop) and the loop-level notify toasts the failure', async () => {
    const root = repo([{ schema: 'loop:v2', id: 'lone', goal: { node: 'a', verdict: 'pass', inputs: ['src/**'] }, notify: { on: ['fail'], as: 'toast' }, start: 'a', nodes: [chk('a', { pass: '@goal' })] }]);
    const r = rig(root, { check: async () => ok('error', 1, { reason: 'timeout' }) });
    r.trust('lone');
    const { runId, end } = await r.run('lone');
    expect(end).toMatchObject({ reason: 'stop', terminal: '@stop' });
    expect(r.of(runId, 'loop.node')[0]).toMatchObject({ verdict: 'error', edge: 'error', next: '@stop' });
    expect(r.of(runId, 'loop.notified')).toEqual([{ runId, loopId: 'lone', as: 'toast', text: 'lone: failed' }]);
  });

  it('a loop with a model node and no local model configured is refused at start (step 8: never a silent fallback)', async () => {
    const root = repo([{ schema: 'loop:v2', id: 'judged', start: 'a', nodes: [chk('a', { pass: 'why', fail: 'why' }), { id: 'why', type: 'model', role: 'summarize', model: { use: 'local' }, inputs: ['a.evidence'], on: { pass: '@stop', fail: '@stop', unsure: '@stop', unavailable: 'tell' } }, { id: 'tell', type: 'notify', as: 'toast', text: 'x', on: { any: '@stop' } }] }]);
    const r = rig(root);
    r.trust('judged');
    expect(() => r.runner.start(r.key('judged'), { type: 'manual', by: HUMAN })).toThrow(/no local model/);
    expect(r.calls).toHaveLength(0);
    expect(r.rows.filter((x) => x.kind === 'loop.run.started')).toHaveLength(0);
  });

  it('no loop-check sandbox on win32 (W5) or linux: the run is refused sandbox-unavailable, nothing runs', () => {
    for (const platform of ['win32', 'linux']) {
      const root = repo([exampleA()]);
      const r = rig(root, { platform });
      r.trust('flow-health-checkout');
      expect(() => r.runner.start(r.key('flow-health-checkout'), { type: 'manual' })).toThrow(/no loop-check sandbox on/);
      expect(r.rows).toEqual([]);
    }
  });

  it('write checks: the validator refuses them (lands in 8.1); the runner keeps its backstop', () => {
    const def = { schema: 'loop:v2', id: 'writer', start: 'a', land: { paths: ['src/**'], message: 'chore(#x): y' }, nodes: [chk('a', { pass: '@stop' }, { effect: 'write' })] };
    const r0 = compileLoop(def as any, { scope: 'repo' });
    expect(r0.ok).toBe(false);
    expect(r0.errors.map((e) => [e.path, e.code])).toEqual([['nodes[0].effect', 'LANDS_IN_8_1']]);
    // the backstop: a compiled loop that names a write check anyway (never from the registry: it re-validates)
    const ok = compileLoop({ ...def, nodes: [chk('a', { pass: '@stop' })] } as any, { scope: 'repo' }).compiled!;
    const forged = { ...ok, nodes: ok.nodes.map((n) => ({ ...n, effect: 'write' })) } as typeof ok;
    expect(unsupportedNodes(forged)).toEqual(['a']);
    expect(ACT_NODES_LATER).toBe('write checks (effect: write) are not in this release yet');
  });

  it('exit.maxVisits and exit.maxFailStreak end the run node-exit before the next step', async () => {
    const root = repo([
      { schema: 'loop:v2', id: 'visits', start: 'a', budgets: { run: { rounds: 50 } }, nodes: [chk('a', { pass: 'a', fail: 'a' }, { exit: { maxVisits: 3 } })] },
      { schema: 'loop:v2', id: 'streak', start: 'a', budgets: { run: { rounds: 50 } }, nodes: [chk('a', { pass: 'a', fail: 'a' }, { exit: { maxFailStreak: 2 } })] },
    ]);
    let streakMode = false;
    const r = rig(root, { check: async () => ok(streakMode ? 'fail' : 'pass') });
    r.trust('visits');
    r.trust('streak');
    const v = await r.run('visits');
    expect(v.end).toMatchObject({ reason: 'node-exit', detail: 'a: exit.maxVisits (3)' });
    expect(r.of(v.runId, 'loop.node')).toHaveLength(3);
    streakMode = true;
    const s = await r.run('streak');
    expect(s.end).toMatchObject({ reason: 'node-exit', detail: 'a: exit.maxFailStreak (2)' });
    expect(r.of(s.runId, 'loop.node').map((n) => [n.verdict, n.next])).toEqual([['fail', 'a'], ['fail', null]]);
  });

  it('call: a trusted, pinned callee runs as a child run; its goal is pass, its budget stop unsure; an untrusted callee is error', async () => {
    const callee: Def = { schema: 'loop:v2', id: 'green', start: 't', goal: { node: 't', verdict: 'pass', inputs: ['src/**'] }, nodes: [chk('t', { pass: '@goal', fail: 't' })], budgets: { run: { rounds: 2 } } };
    const pin = loopContentHash(callee).slice(0, 8);
    const caller: Def = { schema: 'loop:v2', id: 'watch', start: 'go', nodes: [{ id: 'go', type: 'call', loop: `green@${pin}`, on: { pass: '@stop', fail: '@stop', unsure: 'tell', error: '@stop' } }, { id: 'tell', type: 'notify', as: 'toast', text: '{{last.outcome}}', on: { any: '@stop' } }] };
    const root = repo([callee]);
    putLoop(root, caller, { green: callee });
    let calleeVerdict: CheckResult['verdict'] = 'pass';
    const r = rig(root, { check: async () => ok(calleeVerdict) });
    r.trust('watch');
    const untrusted = await r.run('watch');
    expect(r.of(untrusted.runId, 'loop.node')[0]).toMatchObject({ verdict: 'error', detail: 'green is untrusted, not trusted' });
    r.trust('green');
    r.trust('watch');
    const a = await r.run('watch');
    expect(a.end).toMatchObject({ reason: 'stop' });
    const go = r.of(a.runId, 'loop.node')[0]!;
    expect(go).toMatchObject({ nodeId: 'go', type: 'call', verdict: 'pass', next: '@stop', durationMs: 0 });
    expect(r.of(go.calleeRunId as string, 'loop.run.started')[0]).toMatchObject({ loopId: 'green', parentRunId: a.runId, trigger: { type: 'call', runId: a.runId, nodeId: 'go' } });
    calleeVerdict = 'fail';
    const b = await r.run('watch');
    expect(r.of(b.runId, 'loop.node')[0]).toMatchObject({ verdict: 'unsure', next: 'tell', detail: 'green ended budget' });
    // a callee run is not a top-level run, and its compute is charged to the ROOT caller (Aegis #2, §3.4)
    expect(r.ledger.day(dayOf(), r.key('green'))).toEqual({ runs: 0, computeMs: 0, tokens: 0 });
    expect(r.ledger.day(dayOf(), r.key('watch')).computeMs).toBeGreaterThan(0);
    expect(r.of(go.calleeRunId as string, 'loop.run.started')[0]).toMatchObject({ rootKey: r.key('watch') });
  });

  it('a decide card: continue and stop are the edge keys; no answer by the TTL takes timeout → @pause (a kernel pause)', async () => {
    const def: Def = { schema: 'loop:v2', id: 'ask', start: 'a', goal: { node: 'b', verdict: 'pass', inputs: ['src/**'] }, budgets: { run: { rounds: 5 } }, nodes: [chk('a', { pass: 'q', fail: 'q' }), { id: 'q', type: 'notify', as: 'card', text: 'go on?', choices: ['continue', 'stop'], on: { continue: 'b', stop: '@stop', timeout: '@pause' } }, chk('b', { pass: '@goal' })] };
    const root = repo([def]);
    const r = rig(root, { caps: { choiceTtlMs: 1000 } });
    r.trust('ask');
    const p1 = r.runner.start(r.key('ask'), { type: 'manual' }) as { runId: string; done: Promise<any> };
    await new Promise((res) => setTimeout(res, 50));
    const card = r.cards[0]!;
    expect(card).toMatchObject({ kind: 'loop-choice', decisions: ['continue', 'stop'], attended: false, detail: { loopId: 'ask', runId: p1.runId, nodeId: 'q', origin: 'loop' } });
    expect(card.lines.slice(0, 2)).toEqual([`Raised by loop ask (from the loop file)`, `Run ${p1.runId}`]);
    expect(card.detail).toMatchObject({ origin: 'loop', authoredBy: 'file' });
    await card.effect('continue', { connId: gui.connId });
    expect(await p1.done).toMatchObject({ reason: 'goal' });
    expect(r.of(p1.runId, 'loop.node')[1]).toMatchObject({ verdict: 'pass', edge: 'continue', choice: 'continue', next: 'b', cardId: card.cardId });
    const p2 = r.runner.start(r.key('ask'), { type: 'manual' }) as { runId: string; done: Promise<any> };
    expect(await p2.done).toMatchObject({ reason: 'paused', terminal: '@pause', detail: 'timeout' });
    expect(r.rows.filter((x) => x.kind === 'loop.paused').at(-1)!.payload).toMatchObject({ loopId: 'ask', reason: 'timeout', by: 'kernel', runId: p2.runId });
    expect(r.registry.stateOf(r.registry.entry(r.key('ask'))!)).toEqual({ state: 'paused', reason: 'timeout' });
    expect(() => r.runner.start(r.key('ask'), { type: 'manual' })).toThrow(/paused \(timeout\)/);
  });

  it('a loop-choice card that cannot be raised ends the run @stop (never the author\'s edge)', async () => {
    const def: Def = { schema: 'loop:v2', id: 'ask2', start: 'q', nodes: [{ id: 'q', type: 'notify', as: 'card', choices: ['continue', 'stop'], on: { continue: 'a', stop: '@pause', timeout: '@pause' } }, chk('a', { pass: '@stop' })] };
    const root = repo([def]);
    const r = rig(root);
    (r.runner as any) = new LoopRunner({ home: r.home, kernelPrincipal: KERNEL, registry: r.registry, ledger: r.ledger, platform: 'darwin', append: async (kind: string, payload: Record<string, unknown>) => { const row = { kind, principal: KERNEL, at: new Date().toISOString(), payload }; r.rows.push(row); r.registry.observe(row); r.ledger.observe(row); }, broker: { raise: async () => { throw new Error('no broker'); } }, check: async () => ok('pass') });
    r.trust('ask2');
    const run = r.runner.start(r.key('ask2'), { type: 'manual' }) as { runId: string; done: Promise<any> };
    expect(await run.done).toMatchObject({ reason: 'stop', terminal: '@stop' });
    expect(r.of(run.runId, 'loop.node')[0]).toMatchObject({ verdict: 'error', edge: 'error', next: '@stop' });
    expect(r.rows.some((x) => x.kind === 'loop.paused')).toBe(false);
  });

  it('untrusting a loop, or its caller, stops the run before its next step', async () => {
    const callee: Def = { schema: 'loop:v2', id: 'two', start: 'a', nodes: [chk('a', { pass: 'b', fail: 'b' }), chk('b', { pass: '@stop' })] };
    const pin = loopContentHash(callee).slice(0, 8);
    const caller: Def = { schema: 'loop:v2', id: 'top', start: 'go', nodes: [{ id: 'go', type: 'call', loop: `two@${pin}`, on: { pass: '@stop', fail: '@stop', unsure: '@stop', error: '@stop' } }] };
    const root = repo([callee]);
    putLoop(root, caller, { two: callee });
    let r!: ReturnType<typeof rig>;
    r = rig(root, {
      check: async (i) => {
        // the caller is revoked while its callee's first node runs
        if (i.node.id === 'a') r.registry.observe({ kind: 'loop.untrusted', principal: KERNEL, payload: { loopId: 'top', scope: 'repo', repoKey: repoKeyOf([root]), by: HUMAN } });
        return ok('pass');
      },
    });
    r.trust('two');
    r.trust('top');
    const { runId, end } = await r.run('top');
    expect(r.calls.map((c) => c.node.id)).toEqual(['a']);
    const child = r.rows.find((x) => x.kind === 'loop.run.ended' && x.payload.runId !== runId)!.payload;
    expect(child).toMatchObject({ loopId: 'two', reason: 'untrusted', detail: expect.stringMatching(/^caller top: /) });
    // the caller's call node fails and its edge is a terminal; nothing else of either loop runs
    expect(end.reason).toBe('stop');
  });

  it('a content change between nodes ends the run before the next node (content-changed); nothing more runs', async () => {
    const root = repo([exampleA()]);
    const r = rig(root, {
      check: async (i) => {
        if (i.node.id === 'defn') write(path.join(root, 'bin', 'check'), '#!/usr/bin/env node\nprocess.exit(3)\n');
        return ok('pass');
      },
    });
    r.trust('flow-health-checkout');
    const { runId, end } = await r.run('flow-health-checkout');
    expect(end).toMatchObject({ reason: 'content-changed' });
    expect(r.calls.map((c) => c.node.id)).toEqual(['defn']);
    expect(r.of(runId, 'loop.node')).toHaveLength(1);
  });
});

describe('G-LOOP-11: budgets stop the next step (§3.5)', () => {
  const cycle = (id: string, budgets: Def): Def => ({ schema: 'loop:v2', id, start: 'a', budgets, nodes: [chk('a', { pass: 'b', fail: 'b' }), chk('b', { pass: 'a', fail: 'a' })] });

  it('run.rounds: a cycle stops when round n+1 would start; no node of it runs', async () => {
    const root = repo([cycle('rounds', { run: { rounds: 2 } })]);
    const r = rig(root);
    r.trust('rounds');
    const { runId, end } = await r.run('rounds');
    expect(end).toMatchObject({ reason: 'budget', detail: 'run.rounds (2)' });
    expect(r.calls).toHaveLength(4);
    expect(r.of(runId, 'loop.round').map((x) => x.round)).toEqual([1, 2]);
    // Aegis #5: a run-budget stop is a kernel pause; the next run needs a human resume with presence
    expect(r.rows.find((x) => x.kind === 'loop.paused')!.payload).toMatchObject({ loopId: 'rounds', reason: 'budget', by: 'kernel', runId });
    expect(() => r.runner.start(r.key('rounds'), { type: 'manual' })).toThrow(/paused \(budget\)/);
    expect(await r.runner.request(gui, 'request.loop.resume', { loopId: 'rounds', scope: 'repo', repo: root })).toMatchObject({ pending: true, pausedFor: 'budget' });
  });

  it('a budget stop drops the rerun flag: a trigger coalesced during the run does not rerun it', async () => {
    const gate = deferred<void>();
    const root = repo([cycle('busy', { run: { rounds: 1 } })]);
    const r = rig(root, { check: async () => { await gate.promise; return ok('pass'); } });
    r.trust('busy');
    const a = r.runner.start(r.key('busy'), { type: 'manual' }) as { runId: string; done: Promise<any> };
    expect(r.runner.start(r.key('busy'), { type: 'manual' })).toMatchObject({ coalesced: true });
    gate.resolve();
    expect(await a.done).toMatchObject({ reason: 'budget' });
    await r.runner.idle();
    expect(r.rows.filter((x) => x.kind === 'loop.run.started')).toHaveLength(1);
  });

  it('day counters survive the eviction of run records (Aegis #1) and fold the same from the rows', async () => {
    const root = repo([{ schema: 'loop:v2', id: 'many', start: 'a', budgets: { day: { runs: 5 } }, nodes: [chk('a', { pass: '@stop' })] }]);
    const r = rig(root);
    r.trust('many');
    const small = new LoopLedger({ kernelPrincipal: KERNEL, max: 2 });
    for (let i = 0; i < 5; i++) await r.run('many');
    small.seed(r.rows);
    expect(small.recent().length).toBeLessThanOrEqual(2);
    expect(small.day(dayOf(), r.key('many'))).toEqual(r.ledger.day(dayOf(), r.key('many')));
    expect(small.day(dayOf(), r.key('many')).runs).toBe(5);
    expect(() => r.runner.start(r.key('many'), { type: 'manual' })).toThrow(/used its 5 runs today/);
  });

  it('run.wallMin and run.computeSec stop before the next step; a check timeout is cut to what is left', async () => {
    let now = Date.parse('2026-10-22T09:00:00.000Z');
    const root = repo([cycle('wall', { run: { wallMin: 1, rounds: 100 } }), cycle('cpu', { run: { computeSec: 30, rounds: 100 } })]);
    let cpu = false;
    const r = rig(root, { clock: () => now, check: async () => { now += 25_000; return ok('pass', cpu ? 12_000 : 10); } });
    r.trust('wall');
    r.trust('cpu');
    const w = await r.run('wall');
    expect(w.end).toMatchObject({ reason: 'budget', detail: 'run.wallMin (1 min)' });
    expect(r.of(w.runId, 'loop.node')).toHaveLength(3);
    expect(r.calls[2]!.node.timeoutSec).toBe(10);
    cpu = true;
    now += 3600_000;
    const c = await r.run('cpu');
    expect(c.end).toMatchObject({ reason: 'budget', detail: 'run.computeSec (30 s)' });
    expect(r.of(c.runId, 'loop.node')).toHaveLength(3);
  });

  it('day.runs and the global day cap refuse the next run; absent budgets are the global defaults', async () => {
    const once = (id: string, budgets: Def): Def => ({ schema: 'loop:v2', id, start: 'a', budgets, nodes: [chk('a', { pass: '@stop' })] });
    const root = repo([once('daily', { day: { runs: 1 } }), once('other', {})]);
    const r = rig(root, { caps: { dayRuns: 2 } });
    r.trust('daily');
    r.trust('other');
    await r.run('daily');
    expect(() => r.runner.start(r.key('daily'), { type: 'manual' })).toThrow(/used its 1 runs today/);
    await r.run('other');
    expect(() => r.runner.start(r.key('other'), { type: 'manual' })).toThrow(/global 2 runs today/);
    expect(effectiveBudgets(undefined)).toEqual(LOOP_BUDGET_DEFAULTS);
    expect(effectiveBudgets({ run: { rounds: 3 } } as any).run).toEqual({ ...LOOP_BUDGET_DEFAULTS.run, rounds: 3 });
  });
});

describe('concurrency (§4)', () => {
  it('one run per loop: a trigger during a run coalesces into ONE rerun; the repo cap queues the third loop', async () => {
    const gate = deferred<void>();
    const one = (id: string): Def => ({ schema: 'loop:v2', id, start: 'a', goal: { node: 'a', verdict: 'pass', inputs: ['src/**'] }, nodes: [chk('a', { pass: '@goal' })] });
    const root = repo([one('l1'), one('l2'), one('l3')]);
    const r = rig(root, { check: async () => { await gate.promise; return ok('pass'); } });
    for (const id of ['l1', 'l2', 'l3']) r.trust(id);
    const a = r.runner.start(r.key('l1'), { type: 'manual' }) as { runId: string };
    expect(r.runner.start(r.key('l1'), { type: 'manual' })).toEqual({ coalesced: true, runId: a.runId });
    expect(r.runner.start(r.key('l1'), { type: 'manual' })).toEqual({ coalesced: true, runId: a.runId });
    r.runner.start(r.key('l2'), { type: 'manual' });
    expect(r.runner.start(r.key('l3'), { type: 'manual' })).toEqual({ queued: true });
    expect((r.runner.status() as any).queued).toEqual([r.key('l3')]);
    gate.resolve();
    await r.runner.idle();
    const started = r.rows.filter((x) => x.kind === 'loop.run.started').map((x) => [x.payload.loopId, (x.payload.trigger as any).type]);
    expect(started).toEqual([['l1', 'manual'], ['l2', 'manual'], ['l1', 'rerun'], ['l3', 'manual']]);
  });
});

describe('G-LOOP-26: the kill switch and resume classes (§3.3)', () => {
  it('pause{all:true}: the in-flight check is aborted, every trusted loop paused (no presence); resume takes a loop-choice card', async () => {
    const one = (id: string): Def => ({ schema: 'loop:v2', id, start: 'a', goal: { node: 'a', verdict: 'pass', inputs: ['src/**'] }, nodes: [chk('a', { pass: '@goal' })] });
    const root = repo([one('k1'), one('k2'), one('k3')]);
    const r = rig(root, {
      check: (i) => new Promise((res) => i.abort!.addEventListener('abort', () => res(ok('error', 5, { reason: 'killed' })))),
    });
    r.trust('k1');
    r.trust('k2');
    const run = r.runner.start(r.key('k1'), { type: 'manual' }) as { runId: string; done: Promise<any> };
    await new Promise((res) => setTimeout(res, 20));
    const kill = r.runner.request(gui, 'request.loop.pause', { all: true });
    // Aegis #4: the kill flag is set synchronously, before any row: a start in the same tick is refused
    expect(() => r.runner.start(r.key('k2'), { type: 'manual' })).toThrow(/kill-switch/);
    expect(await kill).toEqual({ paused: 2, stopped: 1 });
    expect(await run.done).toMatchObject({ reason: 'kill-switch' });
    expect(r.of(run.runId, 'loop.node')[0]).toMatchObject({ verdict: 'error', next: null });
    expect(r.of(run.runId, 'loop.run.ended')[0]).toMatchObject({ reason: 'kill-switch' });
    const pauses = r.rows.filter((x) => x.kind === 'loop.paused').map((x) => [x.payload.loopId, x.payload.reason, x.payload.by]);
    // step 12 (Aegis): one kill-epoch row (all:true, no loopId) first, then each trusted loop's pause
    expect(pauses).toEqual([[undefined, 'kill-switch', HUMAN], ['k1', 'kill-switch', HUMAN], ['k2', 'kill-switch', HUMAN]]);
    expect(r.cards).toEqual([]); // the kill switch takes no card
    expect(() => r.runner.start(r.key('k2'), { type: 'manual' })).toThrow(/paused \(kill-switch\)/);
    // resume after a kernel pause: a hand-only loop-choice card; only `continue` (fresh presence) writes loop.resumed
    const res = (await r.runner.request(gui, 'request.loop.resume', { loopId: 'k2', scope: 'repo', repo: root })) as any;
    expect(res).toMatchObject({ pending: true, pausedFor: 'kill-switch' });
    expect(r.cards[0]).toMatchObject({ kind: 'loop-choice', handOnly: true, attended: true, decisions: ['continue', 'stop'], detail: { loopId: 'k2', resume: true, pausedFor: 'kill-switch' } });
    await r.cards[0].effect('stop', { connId: gui.connId });
    expect(r.registry.stateOf(r.registry.entry(r.key('k2'))!).state).toBe('paused');
    await r.cards[0].effect('continue', { connId: gui.connId });
    expect(r.rows.at(-1)).toMatchObject({ kind: 'loop.resumed', payload: { loopId: 'k2', by: HUMAN, cardId: r.cards[0].cardId } });
    expect(r.registry.canRun(r.key('k2'))).toEqual({ ok: true });
  });

  it('a human pause stops the run before its next step and resumes at once (no card); a non-human asker is refused', async () => {
    const root = repo([exampleA()]);
    const gate = deferred<void>();
    const r = rig(root, { check: async () => { await gate.promise; return ok('pass'); } });
    r.trust('flow-health-checkout');
    const run = r.runner.start(r.key('flow-health-checkout'), { type: 'manual' }) as { runId: string; done: Promise<any> };
    await new Promise((res) => setTimeout(res, 20));
    expect(await r.runner.request(gui, 'request.loop.pause', { loopId: 'flow-health-checkout', scope: 'repo', repo: root })).toEqual({ paused: true, stopped: true });
    gate.resolve();
    expect(await run.done).toMatchObject({ reason: 'paused' });
    expect(r.calls).toHaveLength(1);
    expect(await r.runner.request(gui, 'request.loop.resume', { loopId: 'flow-health-checkout', scope: 'repo', repo: root })).toEqual({ resumed: true });
    expect(r.cards).toEqual([]);
    await expect(r.runner.request({ ...gui, principalClass: 'session', credential: 'session' }, 'request.loop.run', { loopId: 'flow-health-checkout', scope: 'repo', repo: root })).rejects.toThrow(/the human's/);
    expect(await r.runner.request(gui, 'request.loop.run', { loopId: 'flow-health-checkout', scope: 'repo', repo: root })).toMatchObject({ started: true, runId: expect.stringMatching(/^lr-/) });
    await r.runner.idle();
  });
});

describe('G-LOOP-14: a kill mid-run, then a restart', () => {
  it('the open run ends daemon-restart at boot; nothing re-executes; the day budget folds the same', async () => {
    const root = repo([exampleA()]);
    const home = tmp('gnomon-home-');
    const rows: RigOpts['rows'] = [];
    const first = rig(root, { home, rows, check: (i) => (i.node.id === 'gates' ? new Promise<CheckResult>(() => undefined) : Promise.resolve(ok('pass', 40))) });
    first.trust('flow-health-checkout');
    const trustRow = { kind: 'loop.trusted', principal: KERNEL, at: new Date().toISOString(), payload: { loopId: 'flow-health-checkout', scope: 'repo', repoKey: repoKeyOf([root]), contentHash: first.registry.entry(first.key('flow-health-checkout'))!.hash!.contentHash } };
    const run = first.runner.start(first.key('flow-health-checkout'), { type: 'manual' }) as { runId: string };
    await new Promise((res) => setTimeout(res, 30));
    expect(first.calls.map((c) => c.node.id)).toEqual(['defn', 'gates']); // the daemon dies inside `gates`
    const before = first.ledger.day(dayOf(), first.key('flow-health-checkout'));
    expect(before).toEqual({ runs: 1, computeMs: 40, tokens: 0 });
    // a new daemon: the same log, a fresh registry, ledger and runner
    const second = rig(root, { home, rows: [trustRow, ...rows] });
    expect(second.ledger.open().map((x) => x.runId)).toEqual([run.runId]);
    expect(await second.runner.recover()).toBe(1);
    expect(await second.runner.recover()).toBe(0);
    expect(second.of(run.runId, 'loop.run.ended')).toEqual([{ runId: run.runId, loopId: 'flow-health-checkout', scope: 'repo', repoKey: repoKeyOf([root]), reason: 'daemon-restart', rounds: 0, computeMs: 40 }]);
    expect(second.calls).toEqual([]);
    expect(second.of(run.runId, 'loop.node').map((n) => n.nodeId)).toEqual(['defn']);
    expect(second.ledger.day(dayOf(), second.key('flow-health-checkout'))).toEqual(before);
    expect(second.ledger.open()).toEqual([]);
  });
});

const dayOf = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('G-LOOP-17: replay reproduces every edge', () => {
  it('replayLoopRuns rebuilds each walk from the rows alone; gnomon replay folds it; a reordered row is a divergence', async () => {
    const root = repo([exampleA()]);
    const r = rig(root, { check: async (i) => ok(i.node.id === 'tests' ? 'fail' : 'pass') });
    r.trust('flow-health-checkout');
    const { runId } = await r.run('flow-health-checkout');
    const rp = replayLoopRuns(r.rows);
    expect(rp.divergences).toEqual([]);
    expect(rp.runs[runId]).toEqual({ loopId: 'flow-health-checkout', ended: 'stop', edges: [['defn', 'pass', 'pass', 'gates'], ['gates', 'pass', 'pass', 'tests'], ['tests', 'fail', 'fail', 'tell'], ['tell', 'pass', 'pass', '@stop']] });
    const verified = r.rows.map((x, i) => ({ seq: i + 1, kind: x.kind, hash: `h${i}`, envelope: JSON.stringify({ kind: x.kind, payload: x.payload }) }));
    const f = foldReplay(verified);
    expect(f.divergences).toEqual([]);
    expect(f.projection.loops![runId]!.edges.map((e) => e[3])).toEqual(['gates', 'tests', 'tell', '@stop']);
    // swap two node rows: the walk no longer reproduces
    const nodes = verified.filter((v) => v.kind === 'loop.node');
    const swapped = verified.map((v) => (v === nodes[1] ? nodes[2]! : v === nodes[2] ? nodes[1]! : v));
    expect(foldReplay(swapped).divergences.map((d) => d.reason)).toContain('loop-edge-mismatch');
    // without loop rows the projection has no `loops` key (existing replay hashes are unchanged)
    expect(foldReplay([]).projection).not.toHaveProperty('loops');
  });
});

describe('notify text', () => {
  it('kernel fields only; unknown placeholders render ?; sanitized and bounded', () => {
    expect(renderNotifyText('{{loop.id}} at {{failed.node}} {{trigger.payload}}', { 'loop.id': 'x', 'failed.node': 'tests' }, '')).toBe('x at tests ?');
    expect(renderNotifyText(undefined, {}, 'fallback')).toBe('fallback');
    expect(renderNotifyText('a'.repeat(900), {}, '').length).toBe(500);
  });
});

describe('the daemon\'s pinned paradigm CLI (builtins)', () => {
  it('pins <paradigm>/dist/index.js and its dist digest once; no paradigm install fails closed (null)', () => {
    const pkg = tmp('gnomon-pcli-');
    write(path.join(pkg, 'package.json'), '{"name":"@a-company/paradigm"}');
    write(path.join(pkg, 'dist', 'index.js'), 'console.log(1)\n');
    const get = paradigmCliResolver(() => path.join(pkg, 'package.json'));
    const pin = get()!;
    expect(pin.real).toBe(fs.realpathSync.native(path.join(pkg, 'dist', 'index.js')));
    write(path.join(pkg, 'dist', 'more.js'), 'x\n');
    expect(get()).toBe(pin); // fixed for the daemon's life: a later dist change is check-exec's pin-mismatch
    expect(paradigmCliResolver(() => { throw new Error('MODULE_NOT_FOUND'); })()).toBeNull();
  });
});

// ── LP8 (#gui-loops): what the GUI reads off the REAL cards and rows ─────────────────────────────────────────────
describe('LP8: the GUI against broker-shaped loop cards and the budget op', () => {
  it('a loop-choice card as the broker sends it (no top-level detail): the GUI names its loop, run and node', async () => {
    const { ApprovalBroker } = await import('../src/kernel/broker/index.js');
    const { SoftwareEd25519Signer } = await import('../src/kernel/log/signer.js');
    const { cardLoopOf, loopCardTitle, loopsOf } = await import('../../gnomon-gui/src/core/loops.js');
    const { GuiStore } = await import('../../gnomon-gui/src/core/store.js');
    const def: Def = { schema: 'loop:v2', id: 'ask', start: 'a', goal: { node: 'b', verdict: 'pass', inputs: ['src/**'] }, budgets: { run: { rounds: 5 } }, nodes: [chk('a', { pass: 'q', fail: 'q' }), { id: 'q', type: 'notify', as: 'card', text: 'go on?', choices: ['continue', 'stop'], on: { continue: 'b', stop: '@stop', timeout: '@pause' } }, chk('b', { pass: '@goal' })] };
    const root = repo([def]);
    const r = rig(root, { caps: { choiceTtlMs: 1000 }, check: async () => ok('fail') });
    r.trust('ask');
    const p1 = r.runner.start(r.key('ask'), { type: 'manual' }) as { runId: string; done: Promise<any> };
    await new Promise((res) => setTimeout(res, 50));
    const broker = new ApprovalBroker({ kernel: SoftwareEd25519Signer.generate('kernel'), kernelPrincipal: KERNEL, log: async () => undefined });
    const card = (await broker.raise(r.cards[0]!)) as unknown as Record<string, unknown>;
    expect(card.detail).toBeUndefined();
    const store = new GuiStore();
    store.apply(r.rows.map((row, i) => ({ seq: i + 1, ...row })));
    const cl = cardLoopOf(card, store.loopCards);
    expect(cl).toMatchObject({ loopId: 'ask', runId: p1.runId, nodeId: 'q', authoredBy: 'file' });
    expect(cardLoopOf(card)).toMatchObject({ loopId: 'ask', runId: p1.runId });
    const m = loopsOf({ loops: { loops: [{ key: r.key('ask'), loopId: 'ask', scope: 'repo', repo: root, repoKey: 'x', state: 'trusted' }], runs: r.runner.status().runs } });
    expect(loopCardTitle('loop-choice', cl, m)).toBe('ask: a is failing');
    await r.cards[0]!.effect('stop', { connId: gui.connId });
    await p1.done;
  });

  it('request.loop.budget tightens only: a lower cap is a kernel row the runner folds; a higher one is refused', async () => {
    const root = repo([exampleA()]);
    const r = rig(root);
    r.trust('flow-health-checkout');
    const target = { loopId: 'flow-health-checkout', scope: 'repo', repo: root };
    expect(await r.runner.request(gui, 'request.loop.budget', { ...target, budgets: { day: { runs: 3 } } })).toMatchObject({ tightened: true, budgets: { day: { runs: 3 } } });
    expect(r.rows.filter((x) => x.kind === 'loop.budget.tightened').map((x) => x.payload)).toEqual([{ loopId: 'flow-health-checkout', scope: 'repo', repoKey: repoKeyOf([root]), contentHash: r.registry.entry(r.key('flow-health-checkout'))!.hash!.contentHash, budgets: { run: {}, day: { runs: 3 } }, by: HUMAN }]);
    expect(r.registry.list()[0]!.shape!.budgets.day.runs).toBe(3);
    await expect(r.runner.request(gui, 'request.loop.budget', { ...target, budgets: { day: { runs: 4 } } })).rejects.toThrow(/waits for a loop-trust card/);
    await expect(r.runner.request(gui, 'request.loop.budget', { ...target, budgets: { day: { runs: 0 } } })).rejects.toThrow(/whole numbers/);
    await expect(r.runner.request({ ...gui, principalClass: 'session', credential: 'session' }, 'request.loop.budget', { ...target, budgets: { day: { runs: 1 } } })).rejects.toThrow(/the human's/);
    for (let i = 0; i < 3; i++) await r.run('flow-health-checkout');
    expect(() => r.runner.start(r.key('flow-health-checkout'), { type: 'manual' })).toThrow(/3 runs today/);
  });
});
