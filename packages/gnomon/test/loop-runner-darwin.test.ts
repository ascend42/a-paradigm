// @gnomon-platform: darwin
/**
 * #loop-runner end to end on macOS (build plan step 5, "the first end-to-end loop"): Example A minus its `why`
 * model node, wired through kernel/loops/wire.ts over a fake kernel log, its checks run by the REAL check executor
 * under the darwin `loop-check` sandbox against a fixture git repo (builtins through a pinned fake paradigm CLI, the
 * `tests` node a repo script). Trusted, run through the human's `request.loop.run`, nodes visited, the toast
 * emitted, rows written, `gnomon loop runs`/`logs` render it. Then the kill switch (G-LOOP-26) against a real check
 * process: its group is killed, the run ends kill-switch, the loop is paused. Requires the session floor (macOS 15+
 * AND SIP); below it the backend refuses and this file skips.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compileLoop, loopFileJson } from '../src/loops/index.js';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { pinParadigmCli } from '../src/kernel/loops/check-exec.js';
import { readShebang } from '../src/kernel/loops/hash.js';
import { replayLoopRuns } from '../src/kernel/loops/ledger.js';
import { wireLoops } from '../src/kernel/loops/wire.js';
import { repoKeyOf } from '../src/kernel/supervisor/repo-hooks.js';
import { logLines, runRows, type LoopRunView } from '../src/cli/loop-cli.js';

const floor = darwinFloor();
const KERNEL = 'p:abcdefgh/kernel';
const HUMAN = 'p:abcdefgh/matt';
const gui = { connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', principal: HUMAN, principalClass: 'human', credential: 'gui' };
const dirs: string[] = [];
const tmp = (p: string): string => {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), p)));
  dirs.push(d);
  return d;
};
afterAll(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});
const write = (p: string, body: string, mode = 0o644): void => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, { mode });
};

/** A fake paradigm CLI: every builtin passes, except paradigm.drift when the copy holds DRIFT. */
function fakeCli(): string {
  const pkg = tmp('gnomon-pcli-');
  write(path.join(pkg, 'package.json'), JSON.stringify({ name: '@a-company/paradigm', type: 'module' }));
  const entry = path.join(pkg, 'dist', 'index.js');
  write(entry, "import * as fs from 'node:fs'; const a = process.argv.slice(2); const bad = a[2] === 'paradigm.drift' && fs.existsSync('DRIFT'); console.log(JSON.stringify({ builtin: a[2], ok: !bad, passed: bad ? 0 : 1, failed: bad ? 1 : 0 })); process.exit(bad ? 1 : 0);\n");
  return entry;
}

const exampleA = {
  schema: 'loop:v2', id: 'flow-health-checkout', title: 'checkout flow health', autonomy: 'observe', notify: { on: ['fail'], as: 'toast' },
  budgets: { run: { wallMin: 15, computeSec: 300 }, day: { runs: 12 } }, goal: { node: 'drift', verdict: 'pass' }, start: 'defn',
  nodes: [
    { id: 'defn', type: 'check', builtin: 'paradigm.flow-check', args: { flowId: '$checkout-flow', checkImplementation: true }, on: { pass: 'gates', fail: 'tell' } },
    { id: 'gates', type: 'check', builtin: 'paradigm.purpose-validate', on: { pass: 'tests', fail: 'tell' } },
    { id: 'tests', type: 'check', run: ['bin/tests.mjs'], timeoutSec: 60, on: { pass: 'drift', fail: 'tell' } },
    { id: 'drift', type: 'check', builtin: 'paradigm.drift', args: { symbols: ['$checkout-flow'] }, on: { pass: '@goal', fail: 'tell' } },
    { id: 'tell', type: 'notify', as: 'toast', text: '{{loop.id}} failed at {{failed.node}}', on: { any: '@stop' } },
  ],
};
const sleeper = { schema: 'loop:v2', id: 'sleeper', start: 's', nodes: [{ id: 's', type: 'check', run: ['bin/sleep.mjs'], timeoutSec: 120, on: { pass: '@stop' } }] };

function fixtureRepo(): string {
  const root = tmp('gnomon-loopdemo-');
  const env = { PATH: process.env.PATH ?? '', HOME: os.tmpdir(), GIT_CONFIG_NOSYSTEM: '1' };
  expect(spawnSync('git', ['init', '-q'], { cwd: root, env }).status).toBe(0);
  write(path.join(root, 'src', 'checkout.ts'), 'export const checkout = 1;\n');
  write(path.join(root, 'bin', 'tests.mjs'), "#!/usr/bin/env node\nimport * as fs from 'node:fs';\nconsole.log('1 passing');\nprocess.exit(fs.existsSync('src/checkout.ts') ? 0 : 1);\n", 0o755);
  write(path.join(root, 'bin', 'sleep.mjs'), '#!/usr/bin/env node\nsetTimeout(() => process.exit(0), 90_000);\n', 0o755);
  write(path.join(root, 'package.json'), '{"name":"demo"}\n');
  for (const def of [exampleA, sleeper]) {
    const r = compileLoop(def, { scope: 'repo', readShebang: (a0) => (a0.includes('/') ? readShebang(path.join(root, a0)) : null) });
    if (!r.compiled) throw new Error(JSON.stringify(r.errors));
    write(path.join(root, '.paradigm', 'loops', `${def.id}.loop.json`), loopFileJson(r.compiled));
  }
  return root;
}

function kernel(root: string) {
  const home = tmp('gnomon-home-');
  const rows: Array<{ kind: string; principal: string; keyId: string; at: string; payload: Record<string, unknown> }> = [];
  const listeners: Array<(e: any) => void> = [];
  const toasts: unknown[] = [];
  const cli = pinParadigmCli(fakeCli());
  const w = wireLoops({
    home, kernelPrincipal: KERNEL, start: false,
    broker: { raise: async (i: any) => ({ cardId: i.cardId }) as any },
    log: {
      append: async (x) => {
        const row = { kind: x.kind, principal: x.principal, keyId: 'kernel-key', at: new Date().toISOString(), payload: x.payload as Record<string, unknown> };
        rows.push(row);
        for (const l of listeners) l(row);
      },
      read: () => [],
      onCommit: (l) => void listeners.push(l),
      isKernelKey: () => true,
    },
    paradigmCli: () => cli,
    toast: (t) => toasts.push(t),
  });
  w.registry.addRepo(root);
  w.registry.scan();
  const trust = (id: string): void => {
    const e = w.registry.verify(`repo/${repoKeyOf([root])}/${id}`)!;
    for (const l of listeners) l({ kind: 'loop.trusted', principal: KERNEL, keyId: 'kernel-key', payload: { loopId: id, scope: 'repo', repoKey: e.repoKey, contentHash: e.hash!.contentHash, coreHash: e.hash!.coreHash, by: HUMAN } });
  };
  return { home, rows, toasts, w, trust };
}

describe.skipIf(!floor.ok)('#loop-runner end to end: Example A minus why, by hand, under the loop-check sandbox', () => {
  it('trusted, run, nodes visited, toast emitted, rows written, `loop runs` shows it; then a drift fails it and it toasts', async () => {
    const root = fixtureRepo();
    const k = kernel(root);
    const target = { loopId: 'flow-health-checkout', scope: 'repo', repo: root };
    await expect(k.w.port.request(gui, 'request.loop.run', target)).rejects.toThrow(/untrusted/);
    k.trust('flow-health-checkout');
    const started = (await k.w.port.request(gui, 'request.loop.run', target)) as { runId: string };
    await k.w.runner.idle();
    const nodes = k.rows.filter((r) => r.kind === 'loop.node' && r.payload.runId === started.runId).map((r) => r.payload);
    expect(nodes.map((n) => [n.nodeId, n.verdict, n.next]), JSON.stringify(nodes.map((n) => [n.detail, (n.evidence as any)?.stderrTail]))).toEqual([['defn', 'pass', 'gates'], ['gates', 'pass', 'tests'], ['tests', 'pass', 'drift'], ['drift', 'pass', '@goal']]);
    expect((nodes[2]!.evidence as any).stdoutTail).toContain('1 passing');
    const ended = k.rows.find((r) => r.kind === 'loop.run.ended' && r.payload.runId === started.runId)!.payload;
    expect(ended).toMatchObject({ reason: 'goal', terminal: '@goal' });
    expect(k.toasts).toEqual([]);
    // a drift (a new file in the repo, so the copy has it) fails the drift check: the tell node toasts
    write(path.join(root, 'DRIFT'), 'x\n');
    const second = (await k.w.port.request(gui, 'request.loop.run', target)) as { runId: string };
    await k.w.runner.idle();
    const n2 = k.rows.filter((r) => r.kind === 'loop.node' && r.payload.runId === second.runId).map((r) => [r.payload.nodeId, r.payload.verdict]);
    expect(n2).toEqual([['defn', 'pass'], ['gates', 'pass'], ['tests', 'pass'], ['drift', 'fail'], ['tell', 'pass']]);
    expect(k.toasts).toEqual([{ loopId: 'flow-health-checkout', runId: second.runId, nodeId: 'tell', repo: root, text: 'flow-health-checkout failed at drift' }]);
    expect(k.rows.filter((r) => r.kind === 'loop.notified').map((r) => r.payload.text)).toEqual(['flow-health-checkout failed at drift']);
    // `gnomon loop runs` / `logs` over status.loops
    const st = k.w.port.status() as { runs: LoopRunView[]; loops: unknown[] };
    const runs = st.runs.filter((r) => r.loopId === 'flow-health-checkout');
    expect(runs.map((r) => r.reason)).toEqual(['stop', 'goal']);
    expect(runRows(runs[0]!)).toContainEqual(['nodes', 'defn:pass → gates:pass → tests:pass → drift:fail → tell:pass']);
    expect(logLines(runs[0]!).at(-1)).toMatch(/^#1 tell \(notify, round 1\) pass --pass--> @stop/);
    // G-LOOP-17: the rows alone reproduce both walks
    expect(replayLoopRuns(k.rows).divergences).toEqual([]);
  }, 120_000);

  it('G-LOOP-26 kill switch against a real check: its process group is killed, the run ends kill-switch, every trusted loop is paused', async () => {
    const root = fixtureRepo();
    const k = kernel(root);
    k.trust('sleeper');
    k.trust('flow-health-checkout');
    const t0 = Date.now();
    const started = (await k.w.port.request(gui, 'request.loop.run', { loopId: 'sleeper', scope: 'repo', repo: root })) as { runId: string };
    await new Promise((r) => setTimeout(r, 1500));
    expect(await k.w.port.request(gui, 'request.loop.pause', { all: true })).toEqual({ paused: 2, stopped: 1 });
    await k.w.runner.idle();
    expect(Date.now() - t0).toBeLessThan(30_000);
    const node = k.rows.find((r) => r.kind === 'loop.node' && r.payload.runId === started.runId)!.payload;
    expect(node).toMatchObject({ verdict: 'error', next: null, evidence: { reason: 'killed' } });
    expect(k.rows.find((r) => r.kind === 'loop.run.ended' && r.payload.runId === started.runId)!.payload).toMatchObject({ reason: 'kill-switch' });
    expect(k.rows.filter((r) => r.kind === 'loop.paused').map((r) => [r.payload.loopId, r.payload.reason])).toEqual([[undefined, 'kill-switch'], ['sleeper', 'kill-switch'], ['flow-health-checkout', 'kill-switch']]);
    await expect(k.w.port.request(gui, 'request.loop.run', { loopId: 'sleeper', scope: 'repo', repo: root })).rejects.toThrow(/paused \(kill-switch\)/);
  }, 120_000);
});
