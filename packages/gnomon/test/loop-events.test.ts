// @gnomon-platform: darwin, linux, win32
/**
 * #loop-events (docs/specs/gnomon-loops.md §2 triggers, §4 #loop-events; build plan step 7, LP4b), over the real
 * registry, ledger and runner with an injected check executor and an in-memory log.
 *
 *   kinds       file.changed (flow globs), commit.landed (a temp repo, git run by the TEST, never the kernel),
 *               session.ended (session.exited of a session in the repo), card.decided ({loop, node} of a loop card)
 *   rows        every fire writes loop.trigger.fired{loopId, trigger{kind, fireId, kernel fields}} then starts a run
 *   debounce    a burst is one fire (count = the burst), trailing, capped at 3× the debounce
 *   ignored     .git, node_modules, the Gnomon home (check copies); a symlink out of the repo is refused
 *   trust       no watch or subscription for an untrusted, paused or killed loop; trust adds, pause removes
 *   G-LOOP-15   a loop's own commit (Gnomon-Loop trailer, loop.landed sha), session and card never trigger it
 *   G-LOOP-17   replay joins each event-started run to its trigger row; a run citing an unknown fire diverges
 *
 * Platform notes: paths are built with path.join under os.tmpdir(); the real fs.watch tests are skipped on Linux
 * (recursive fs.watch there is Node's userland walker, slow to arm), the symlink test on win32 (privilege).
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compileLoop, loopFileJson } from '../src/loops/index.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { readShebang } from '../src/kernel/loops/hash.js';
import { LoopLedger, replayLoopRuns } from '../src/kernel/loops/ledger.js';
import { LoopRegistry } from '../src/kernel/loops/registry.js';
import { LoopRunner } from '../src/kernel/loops/runner.js';
import { gitDirsOf, globToRegExp, LOOP_LANDED_QUIET_MS, LoopEvents, type LoopEventRow } from '../src/kernel/loops/events.js';
import type { CheckResult } from '../src/kernel/loops/check-exec.js';
import { repoKeyOf } from '../src/kernel/supervisor/repo-hooks.js';

type Def = Record<string, any>;
const KERNEL = 'p:abcdefgh/kernel';
const HUMAN = 'p:abcdefgh/matt';
const FLOW = '$checkout-flow';
const linux = process.platform === 'linux';

const tmps: string[] = [];
function tmp(prefix: string): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (closers.length) closers.pop()!();
  while (tmps.length) removeTree(tmps.pop()!);
});
const closers: Array<() => void> = [];
const write = (p: string, text: string): void => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
function putLoop(root: string, def: Def): void {
  const r = compileLoop(def, { scope: 'repo', flowIndex: { [FLOW]: ['src/**/*.ts'] }, readShebang: (a0) => (a0.includes('/') ? readShebang(path.join(root, a0)) : null) });
  if (!r.compiled) throw new Error(JSON.stringify(r.errors));
  write(path.join(root, '.paradigm', 'loops', `${def.id}.loop.json`), loopFileJson(r.compiled));
}
const git = (root: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function repo(defs: Def[], o: { git?: boolean } = {}): string {
  const root = tmp('gnomon-ev-repo-');
  if (o.git) {
    git(root, 'init', '-q', '-b', 'main');
  } else fs.mkdirSync(path.join(root, '.git'));
  write(path.join(root, 'bin', 'check'), '#!/usr/bin/env node\nprocess.exit(0)\n');
  write(path.join(root, 'package.json'), '{"name":"x"}\n');
  for (const d of defs) putLoop(root, d);
  if (o.git) {
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'init');
  }
  return root;
}
const chk = (id: string): Def => ({ id, type: 'check', run: ['bin/check', id], on: { pass: '@stop', fail: '@stop' } });
const evLoop = (id: string, event: Def, extra: Def = {}): Def => ({
  schema: 'loop:v2', id, autonomy: 'observe', triggers: [{ event, debounce: '0s' }], budgets: { day: { runs: 50 } }, start: 'a', nodes: [chk('a')], ...extra,
});

function ok(): CheckResult {
  return { verdict: 'pass', exitCode: 0, signal: null, durationMs: 1, evidence: { stdoutTail: '', stderrTail: '', stdoutTruncated: false, stderrTruncated: false, redactions: [], label: 'private', sensitive: true }, profileHash: null, envKeys: [], copy: { dir: '', files: 0, bytes: 0, kept: false } };
}

/** A manual debounce timer: flush() runs every armed callback whose delay has passed on the fake clock. */
class Timers {
  now = Date.parse('2026-10-22T12:00:00Z');
  armed: Array<{ at: number; fn: () => void; live: boolean }> = [];
  set = (fn: () => void, ms: number): (() => void) => {
    const t = { at: this.now + ms, fn, live: true };
    this.armed.push(t);
    return () => void (t.live = false);
  };
  async advance(ms: number): Promise<void> {
    this.now += ms;
    for (const t of this.armed.splice(0)) {
      if (!t.live) continue;
      if (t.at <= this.now) t.fn();
      else this.armed.push(t);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

interface RigOpts {
  check?: () => Promise<CheckResult>;
  watch?: boolean;
  home?: string;
  manual?: boolean;
}

async function rig(roots: string[], o: RigOpts = {}) {
  const home = o.home ?? tmp('gnomon-ev-home-');
  const rows: Array<LoopEventRow & { payload: Record<string, unknown> }> = [];
  const diags: Array<{ event: string; data: Record<string, unknown> }> = [];
  const t = new Timers();
  let n = 0;
  let events: LoopEvents | null = null;
  const registry = new LoopRegistry({ home, kernelPrincipal: KERNEL, append: async (k, p) => append(k, p), watch: false, rescanMs: 0 });
  const ledger = new LoopLedger({ kernelPrincipal: KERNEL });
  const append = async (kind: string, payload: Record<string, unknown>, causes?: string[]): Promise<void> => {
    const row = { id: `ev-${++n}`, kind, principal: KERNEL, at: new Date().toISOString(), payload, ...(causes ? { causes } : {}) };
    rows.push(row);
    registry.observe(row);
    ledger.observe(row);
    events?.observe(row);
  };
  const runner = new LoopRunner({ home, kernelPrincipal: KERNEL, registry, ledger, append, platform: 'darwin', broker: { raise: async (i: any) => ({ cardId: i.cardId }) as any }, check: o.check ?? (async () => ok()) });
  for (const r of roots) registry.addRepo(r);
  registry.scan();
  events = new LoopEvents({
    home, registry, runner, kernelPrincipal: KERNEL, append: (k, p) => append(k, p), watch: o.watch ?? false, settleMs: o.manual === false ? 50 : 100,
    ...(o.manual === false ? {} : { timer: t.set, clock: () => t.now }),
    diag: (event, data) => diags.push({ event, data }),
  });
  closers.push(() => events!.close());
  const key = (root: string, id: string): string => `repo/${repoKeyOf([root])}/${id}`;
  const trust = (root: string, id: string): void => {
    const e = registry.verify(key(root, id))!;
    void append('loop.trusted', { loopId: e.loopId, scope: e.scope, repoKey: e.repoKey, contentHash: e.hash!.contentHash, coreHash: e.hash!.coreHash, by: HUMAN });
  };
  const of = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.payload);
  return { home, rows, diags, t, registry, runner, events, key, trust, append, of };
}

async function until(fn: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('globToRegExp', () => {
  it('matches the flow globs a compiled loop carries', () => {
    expect(globToRegExp('src/**/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/**/*.ts').test('src/x/y/a.ts')).toBe(true);
    expect(globToRegExp('src/**/*.ts').test('srcx/a.ts')).toBe(false);
    expect(globToRegExp('src/*.{ts,tsx}').test('src/a.tsx')).toBe(true);
    expect(globToRegExp('docs').test('docs/a/b.md')).toBe(true);
    expect(globToRegExp('a?.md').test('ab.md')).toBe(true);
  });
});

describe('#loop-events: registration follows trust', () => {
  it('an untrusted loop has no watch and no subscription; trust adds them, a pause and the kill switch remove them', async () => {
    const root = repo([evLoop('fc', { kind: 'file.changed', flow: FLOW })]);
    const r = await rig([root]);
    expect(r.events.keys()).toEqual([]);
    expect(r.events.watching()).toEqual([]);
    expect(r.events.handleFsEvent(root, 'src/a.ts')).toEqual([]);
    r.trust(root, 'fc');
    expect(r.events.keys()).toEqual([r.key(root, 'fc')]);
    expect(r.events.watching()).toEqual([{ root, files: true, git: false }]);
    await r.runner.pause(r.key(root, 'fc'), HUMAN, 'human');
    expect(r.events.keys()).toEqual([]);
    expect(r.events.watching()).toEqual([]);
  });

  it('the kill switch drops every subscription', async () => {
    const root = repo([evLoop('fc', { kind: 'file.changed', flow: FLOW })]);
    const r = await rig([root]);
    r.trust(root, 'fc');
    expect(r.events.keys().length).toBe(1);
    const gui = { connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', principal: HUMAN, principalClass: 'human', credential: 'gui' };
    await r.runner.request(gui as any, 'request.loop.pause', { all: true });
    expect(r.events.keys()).toEqual([]);
    expect(r.events.handleFsEvent(root, 'src/a.ts')).toEqual([]);
  });
});

describe('#loop-events: file.changed', () => {
  it('a matching path fires once: loop.trigger.fired with kernel fields, then a run whose trigger carries the fireId', async () => {
    const root = repo([evLoop('fc', { kind: 'file.changed', flow: FLOW })]);
    const r = await rig([root]);
    r.trust(root, 'fc');
    expect(r.events.handleFsEvent(root, 'README.md')).toEqual([]);
    expect(r.events.handleFsEvent(root, 'src/x/a.ts')).toEqual([r.key(root, 'fc')]);
    await r.t.advance(100);
    await r.runner.idle();
    const fired = r.of('loop.trigger.fired');
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ loopId: 'fc', scope: 'repo', trigger: { type: 'event', kind: 'file.changed', path: 'src/x/a.ts', count: 1 } });
    const started = r.of('loop.run.started');
    expect(started).toHaveLength(1);
    expect((started[0]!.trigger as any).fireId).toBe((fired[0]!.trigger as any).fireId);
    // the hand-off carries kernel ids only: the repo-chosen path never reaches the run's trigger (model inputs)
    expect(started[0]!.trigger).not.toHaveProperty('path');
  });

  it('churn: fires during a run write no rows (one rerun flag, the rest counted); a spent day cap writes none either', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const root = repo([evLoop('fc', { kind: 'file.changed', flow: FLOW }, { budgets: { day: { runs: 2 } } })]);
    const r = await rig([root], { check: async () => (await gate, ok()) });
    r.trust(root, 'fc');
    r.events.handleFsEvent(root, 'src/a.ts');
    await r.t.advance(100);
    expect(r.of('loop.trigger.fired')).toHaveLength(1);
    for (let i = 0; i < 20; i++) {
      r.events.handleFsEvent(root, `src/churn${i}.ts`);
      await r.t.advance(100);
    }
    expect(r.of('loop.trigger.fired')).toHaveLength(1);
    expect(r.events.dropped()[r.key(root, 'fc')]).toEqual({ coalesced: 20, refused: 0 });
    release();
    await r.runner.idle();
    expect(r.of('loop.run.started').map((p) => (p.trigger as any).type)).toEqual(['event', 'rerun']);
    // day.runs 2 spent: the next fire is refused by the runner, and writes no row
    r.events.handleFsEvent(root, 'src/late.ts');
    await r.t.advance(100);
    expect(r.of('loop.trigger.fired')).toHaveLength(1);
    expect(r.events.dropped()[r.key(root, 'fc')]!.refused).toBe(1);
    expect(replayLoopRuns(r.rows).divergences).toEqual([]);
  });

  it('debounce: a burst is one fire counting the burst; the wait restarts, capped at 3× the debounce', async () => {
    const root = repo([{ ...evLoop('fc', { kind: 'file.changed', flow: FLOW }), triggers: [{ event: { kind: 'file.changed', flow: FLOW }, debounce: '10s' }] }]);
    const r = await rig([root]);
    r.trust(root, 'fc');
    for (let i = 0; i < 3; i++) {
      r.events.handleFsEvent(root, `src/f${i}.ts`);
      await r.t.advance(9_000);
    }
    expect(r.of('loop.trigger.fired')).toHaveLength(0);
    await r.t.advance(1_000);
    expect(r.of('loop.trigger.fired')).toHaveLength(1);
    expect(r.of('loop.trigger.fired')[0]!.trigger).toMatchObject({ count: 3, path: 'src/f2.ts' });
    // a never-quiet repo still fires by 3 × 10 s
    await r.runner.idle();
    for (let i = 0; i < 5; i++) {
      r.events.handleFsEvent(root, 'src/busy.ts');
      await r.t.advance(7_000);
    }
    expect(r.of('loop.trigger.fired')).toHaveLength(2);
  });

  it('.git, node_modules and the Gnomon home (check copies) never fire', async () => {
    const root = repo([evLoop('fc', { kind: 'file.changed', flow: FLOW })]);
    const home = path.join(root, 'src', 'gnomon-home');
    fs.mkdirSync(path.join(home, 'loop-work', 'check-lr-1'), { recursive: true });
    const r = await rig([root], { home });
    r.trust(root, 'fc');
    expect(r.events.handleFsEvent(root, path.join('.git', 'src', 'a.ts'))).toEqual([]);
    expect(r.events.handleFsEvent(root, path.join('src', 'node_modules', 'a.ts'))).toEqual([]);
    expect(r.events.handleFsEvent(root, path.join('src', 'gnomon-home', 'loop-work', 'check-lr-1', 'a.ts'))).toEqual([]);
    expect(r.events.handleFsEvent(root, path.join('src', 'b.ts'))).toEqual([r.key(root, 'fc')]);
  });

  it.skipIf(process.platform === 'win32')('a path through a symlink out of the repo is refused', async () => {
    const root = repo([evLoop('fc', { kind: 'file.changed', flow: FLOW })]);
    const outside = tmp('gnomon-ev-out-');
    write(path.join(outside, 'a.ts'), 'x');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.symlinkSync(outside, path.join(root, 'src', 'link'));
    const r = await rig([root]);
    r.trust(root, 'fc');
    expect(r.events.handleFsEvent(root, 'src/link/a.ts')).toEqual([]);
    expect(r.diags.some((d) => d.event === 'loops.event-refused' && d.data.why === 'symlink-escape')).toBe(true);
    expect(r.events.handleFsEvent(root, '../outside.ts')).toEqual([]);
  });

  it('G-LOOP-15: a change to a path the loop just landed does not trigger it (another loop still fires)', async () => {
    const root = repo([evLoop('fc', { kind: 'file.changed', flow: FLOW }), evLoop('other', { kind: 'file.changed', flow: FLOW })]);
    const r = await rig([root]);
    r.trust(root, 'fc');
    r.trust(root, 'other');
    const repoKey = repoKeyOf([root]);
    await r.append('loop.run.started', { runId: 'lr-own', loopId: 'fc', scope: 'repo', repoKey });
    await r.append('loop.landed', { loopId: 'fc', runId: 'lr-own', sha: 'a'.repeat(40), paths: ['src/fixed.ts'] });
    await r.append('loop.run.ended', { runId: 'lr-own', loopId: 'fc', reason: 'goal' });
    expect(r.events.handleFsEvent(root, 'src/fixed.ts')).toEqual([r.key(root, 'other')]);
    // step 11: a landed row names its loop directly (an approved land long after its run's start row was evicted)
    await r.append('loop.landed', { loopId: 'fc', scope: 'repo', repoKey, runId: 'lr-unknown', sha: 'c'.repeat(40), paths: ['src/late.ts'] });
    expect(r.events.handleFsEvent(root, 'src/late.ts')).toEqual([r.key(root, 'other')]);
    // step 11: landed paths match exactly (a landed path holding glob characters never covers its neighbours)
    await r.append('loop.landed', { loopId: 'fc', runId: 'lr-own', sha: 'b'.repeat(40), paths: ['src/*.ts'] });
    expect(r.events.handleFsEvent(root, 'src/other.ts')).toEqual([r.key(root, 'fc'), r.key(root, 'other')]);
    // the quiet window ends LOOP_LANDED_QUIET_MS after the row: then the loop's own path fires it again
    await r.t.advance(LOOP_LANDED_QUIET_MS + 1000);
    expect(r.events.handleFsEvent(root, 'src/fixed.ts')).toEqual([r.key(root, 'fc'), r.key(root, 'other')]);
  });

  it('Aegis M1: an approved land (after its run ended) does not re-fire its own file.changed trigger: its paths, their dirs, its temps', async () => {
    const root = repo([evLoop('fc', { kind: 'file.changed', flow: FLOW }), evLoop('other', { kind: 'file.changed', flow: FLOW })]);
    const r = await rig([root]);
    r.trust(root, 'fc');
    r.trust(root, 'other');
    const repoKey = repoKeyOf([root]);
    await r.append('loop.run.started', { runId: 'lr-ap', loopId: 'fc', scope: 'repo', repoKey });
    await r.append('loop.run.ended', { runId: 'lr-ap', loopId: 'fc', reason: 'goal' });
    // the human accepts the card later: the land writes its intent row, then the files
    await r.append('loop.landed', { loopId: 'fc', scope: 'repo', repoKey, runId: 'lr-ap', sha: 'd'.repeat(40), paths: ['src/deep/a.ts'], how: 'approved', phase: 'intent' });
    expect(r.events.handleFsEvent(root, 'src/deep/a.ts')).toEqual([r.key(root, 'other')]);
    expect(r.events.handleFsEvent(root, 'src/deep')).not.toContain(r.key(root, 'fc'));
    // the land's own transient files fire nothing at all
    for (const f of ['src/deep/.gnomon-land-0123456789abcdef.tmp', 'src/deep/.gnomon-land-0123456789abcdef.bak', 'src/.gnomon-land-0123456789abcdef.undo']) expect(r.events.handleFsEvent(root, f)).toEqual([]);
    // a sibling the land did not touch still fires the loop
    expect(r.events.handleFsEvent(root, 'src/deep/b.ts')).toContain(r.key(root, 'fc'));
  });

  it.skipIf(linux)('a real fs.watch: writing a flow file fires', async () => {
    const root = repo([evLoop('fc', { kind: 'file.changed', flow: FLOW })]);
    const r = await rig([root], { watch: true, manual: false });
    r.trust(root, 'fc');
    await new Promise((res) => setTimeout(res, 300)); // FSEvents arms asynchronously
    write(path.join(root, 'src', 'live.ts'), 'export {}\n');
    await until(() => r.of('loop.trigger.fired').length > 0);
    expect(r.of('loop.trigger.fired')[0]!.trigger).toMatchObject({ kind: 'file.changed', path: 'src/live.ts' });
  });
});

describe('#loop-events: commit.landed (refs read without git)', () => {
  it('a new commit on the branch fires with its sha; a loop-authored commit does not trigger its loop (G-LOOP-15)', async () => {
    const root = repo([evLoop('cl', { kind: 'commit.landed' })], { git: true });
    const r = await rig([root]);
    r.trust(root, 'cl');
    expect(r.events.watching()).toEqual([{ root, files: false, git: true }]);
    write(path.join(root, 'a.txt'), '1');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'human');
    const sha = git(root, 'rev-parse', 'HEAD');
    expect(r.events.checkRefs(root)).toEqual([r.key(root, 'cl')]);
    await r.t.advance(100);
    expect(r.of('loop.trigger.fired')[0]!.trigger).toMatchObject({ kind: 'commit.landed', sha, ref: 'refs/heads/main' });
    // a trailer or a loop identity is NOT proof (anyone can write one): only a kernel loop.landed row is
    write(path.join(root, 'b.txt'), '2');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'fix(#x): forged\n\nGnomon-Loop: cl');
    expect(r.events.checkRefs(root)).toEqual([r.key(root, 'cl')]);
    // a kernel loop.landed{sha} row (land writes it before moving the ref)
    write(path.join(root, 'd.txt'), '4');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'landed');
    const landed = git(root, 'rev-parse', 'HEAD');
    await r.append('loop.run.started', { runId: 'lr-1', loopId: 'cl', scope: 'repo', repoKey: repoKeyOf([root]) });
    await r.append('loop.landed', { loopId: 'cl', runId: 'lr-1', sha: landed, paths: ['d.txt'] });
    expect(r.events.checkRefs(root)).toEqual([]);
    // a branch switch is a new baseline, not a commit
    git(root, 'checkout', '-q', '-b', 'other');
    expect(r.events.checkRefs(root)).toEqual([]);
  });

  it('gitDirsOf: a linked worktree validates; a forged gitdir link or a .git file pointing anywhere is refused', async () => {
    const root = repo([], { git: true });
    const wt = path.join(tmp('gnomon-ev-wt-'), 'wt');
    git(root, 'worktree', 'add', '-q', wt);
    const real = fs.realpathSync.native(wt);
    const d = gitDirsOf(real)!;
    expect(d.commonDir).toBe(path.join(root, '.git'));
    expect(path.basename(path.dirname(d.gitDir))).toBe('worktrees');
    // the worktree's back-link names another checkout: refused
    write(path.join(d.gitDir, 'gitdir'), path.join(tmp('gnomon-ev-x-'), '.git') + '\n');
    expect(gitDirsOf(real)).toBeNull();
    // a .git file pointing at an arbitrary directory: refused
    const other = tmp('gnomon-ev-repo-');
    const elsewhere = tmp('gnomon-ev-any-');
    write(path.join(other, '.git'), `gitdir: ${elsewhere}\n`);
    expect(gitDirsOf(other)).toBeNull();
  });

  it('packed refs are read too', async () => {
    const root = repo([evLoop('cl', { kind: 'commit.landed' })], { git: true });
    const r = await rig([root]);
    r.trust(root, 'cl');
    write(path.join(root, 'a.txt'), '1');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'one');
    git(root, 'pack-refs', '--all');
    expect(fs.existsSync(path.join(root, '.git', 'refs', 'heads', 'main'))).toBe(false);
    expect(r.events.checkRefs(root)).toEqual([r.key(root, 'cl')]);
  });

  it.skipIf(linux)('a real refs watch fires on git commit', async () => {
    const root = repo([evLoop('cl', { kind: 'commit.landed' })], { git: true });
    const r = await rig([root], { watch: true, manual: false });
    r.trust(root, 'cl');
    await new Promise((res) => setTimeout(res, 300));
    write(path.join(root, 'a.txt'), '1');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'live');
    const sha = git(root, 'rev-parse', 'HEAD');
    await until(() => r.of('loop.trigger.fired').length > 0);
    expect(r.of('loop.trigger.fired')[0]!.trigger).toMatchObject({ kind: 'commit.landed', sha });
  });
});

describe('#loop-events: kernel rows', () => {
  it('session.ended: a session in the repo exiting fires; one elsewhere, a non-kernel row or the loop\'s own session does not', async () => {
    const root = repo([evLoop('se', { kind: 'session.ended' })]);
    const r = await rig([root]);
    r.trust(root, 'se');
    const repoKey = repoKeyOf([root]);
    await r.append('session.open', { hsid: 'hs-1', cwd: path.join(root, 'src') });
    await r.append('session.open', { hsid: 'hs-2', cwd: os.tmpdir() });
    await r.append('loop.run.started', { runId: 'lr-own', loopId: 'se', scope: 'repo', repoKey });
    await r.append('session.open', { hsid: 'hs-3', cwd: root, origin: 'loop', loopRun: { runId: 'lr-own', loopId: 'se' } });
    expect(r.events.observe({ kind: 'session.exited', principal: 'p:abcdefgh/agent', payload: { hsid: 'hs-1' } })).toEqual([]);
    await r.append('session.exited', { hsid: 'hs-2' });
    await r.append('session.exited', { hsid: 'hs-3' }); // G-LOOP-15: the loop's own model session
    expect(r.events.pending()).toEqual([]);
    await r.append('session.exited', { hsid: 'hs-1' });
    expect(r.events.pending().length).toBe(1);
    await r.t.advance(0);
    expect(r.of('loop.trigger.fired').map((p) => p.trigger)).toMatchObject([{ kind: 'session.ended', hsid: 'hs-1' }]);
    expect(r.of('loop.trigger.fired')[0]!.eventId).toBeDefined();
  });

  it('card.decided: deciding a card loop A\'s node raised fires loop B; A\'s own trigger never fires (G-LOOP-15)', async () => {
    const root = repo([
      evLoop('a', { kind: 'card.decided', loop: 'a', node: 'ask' }),
      evLoop('b', { kind: 'card.decided', loop: 'a', node: 'ask' }),
      evLoop('c', { kind: 'card.decided', loop: 'a', node: 'other' }),
    ]);
    const r = await rig([root]);
    for (const id of ['a', 'b', 'c']) r.trust(root, id);
    const repoKey = repoKeyOf([root]);
    await r.append('loop.run.started', { runId: 'lr-a', loopId: 'a', scope: 'repo', repoKey });
    await r.append('loop.notified', { runId: 'lr-a', loopId: 'a', nodeId: 'ask', as: 'card', cardId: 'card-1' });
    await r.append('approval.decide', { cardId: 'card-unknown', decision: 'continue' });
    expect(r.events.pending()).toEqual([]);
    await r.append('approval.decide', { cardId: 'card-1', decision: 'continue' });
    expect(r.events.pending().map((k) => k.split('#')[0])).toEqual([r.key(root, 'b')]);
  });

  it('G-LOOP-15 through causes: a row caused by a run of L (ev: ref chain) never triggers L', async () => {
    const root = repo([evLoop('se', { kind: 'session.ended' }), evLoop('se2', { kind: 'session.ended' })]);
    const r = await rig([root]);
    r.trust(root, 'se');
    r.trust(root, 'se2');
    await r.append('loop.run.started', { runId: 'lr-x', loopId: 'se', scope: 'repo', repoKey: repoKeyOf([root]) });
    const started = r.rows[r.rows.length - 1]!.id!;
    await r.append('session.open', { hsid: 'hs-9', cwd: root }, [`ev:${started}`]);
    const open = r.rows[r.rows.length - 1]!.id!;
    await r.append('session.exited', { hsid: 'hs-8' }, [`ev:${open}`]); // unknown session: no cwd, no fire
    await r.append('session.exited', { hsid: 'hs-9' }, [`ev:${open}`]);
    expect(r.events.pending().map((k) => k.split('#')[0])).toEqual([r.key(root, 'se2')]);
  });
});

describe('G-LOOP-17: replay says why each run started', () => {
  it('a fired row joins its run; a run citing a fire no row names is a divergence', async () => {
    const root = repo([evLoop('fc', { kind: 'file.changed', flow: FLOW })]);
    const r = await rig([root]);
    r.trust(root, 'fc');
    r.events.handleFsEvent(root, 'src/a.ts');
    await r.t.advance(100);
    await r.runner.idle();
    const rep = replayLoopRuns(r.rows);
    const runs = Object.values(rep.runs);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.why).toMatchObject({ type: 'event', kind: 'file.changed', path: 'src/a.ts' });
    expect(rep.divergences).toEqual([]);
    const forged = r.rows.filter((x) => x.kind !== 'loop.trigger.fired');
    expect(replayLoopRuns(forged).divergences.some((d) => /no loop.trigger.fired row/.test(d.detail))).toBe(true);
  });
});
