/**
 * #loop-git and #loop-act end to end (build plan step 10, LP6a): a REAL git repo, the real scratch worktree, park
 * repo and diff, the real registry, ledger, runner, LocalLane, fuse and the REAL gnomon-local child against a FAKE
 * in-process OpenAI-compatible endpoint (gnomon-local/test/fake-openai.ts). The `loop-act` profile is replaced
 * through LocalLane's TEST-RIG-ONLY `launchPlan` seam (its input is asserted); the check is injected (the sandboxed
 * executor is loop-runner-darwin.test.ts) and judges the SCRATCH it is handed.
 *
 *   G-GIT-01    the scratch is the HEAD tree, detached, outside the repo (<home>/loop-work/act-<runId>/tree), with
 *               no .git; no repo filter or hook runs; the work parks at refs/gnomon/loops/<id>/<runId> in the
 *               kernel's park repo; the founder's checkout AND .git stay byte-identical
 *   Example B   green-typecheck: the act step "fixes" a type error in the scratch, the goal check passes there, and
 *               the run ends in ONE propose (verdict) card with the diff, the files and the goal result
 *   G-LOOP-22   an act write to a goal input is refused with no card and the node fails
 *   G-LOOP-23   a diff that adds a suppression marker proposes with that reason
 */
// @gnomon-platform: darwin, linux
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeOpenAI, type FakeReply, type FakeServer } from '../../gnomon-local/test/fake-openai.js';
import { compileLoop, loopFileJson } from '../src/loops/index.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { readShebang } from '../src/kernel/loops/hash.js';
import { LoopLedger } from '../src/kernel/loops/ledger.js';
import { LoopRegistry } from '../src/kernel/loops/registry.js';
import { LoopRunner } from '../src/kernel/loops/runner.js';
import type { CheckExecInput, CheckResult } from '../src/kernel/loops/check-exec.js';
import { LocalLane } from '../src/kernel/supervisor/local-session.js';
import { pinOf } from '../src/kernel/local/runner-pin.js';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { repoKeyOf } from '../src/kernel/supervisor/repo-hooks.js';
import { createScratch, hardenedGit, liveScratch, parkRepoDir, parkScratch, removeScratch, scratchChanges, sweepLoopScratch } from '../src/kernel/git/scratch.js';
import { PKG_ROOT } from './helpers.js';
import { waitFor } from './session-helpers.js';
import { tierProbeBodies } from '../src/kernel/local/probe.js';
/** the capability probe's requests (T1 and the T2-T4 tier tests, by their constant prompts): never the agent's */
const PROBE_PROMPTS = new Set([...Object.values(tierProbeBodies('m')).map((b) => (JSON.parse(b) as { messages: Array<{ content: string }> }).messages[0]!.content), 'What time is it in UTC? Use the tool.']);
const notProbe = (q: { messages?: unknown }): boolean => !PROBE_PROMPTS.has((q.messages as Array<{ content?: unknown }> | undefined)?.[0]?.content as string);

type Def = Record<string, any>;
const KERNEL = 'p:abcdefgh/kernel';
const HUMAN = 'p:abcdefgh/matt';
const TRUST_CARD = 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const CLI = path.join(PKG_ROOT, '..', 'gnomon-local', 'dist', 'cli.js');

let srv: FakeServer | null = null;
const tmps: string[] = [];
afterEach(async () => {
  await srv?.close();
  srv = null;
  while (tmps.length) removeTree(tmps.pop()!);
});
function tmp(prefix: string): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmps.push(d);
  return d;
}
/** maintenance.auto=false: the rig's own commits must not start git's detached auto-maintenance, whose transient .git/objects/maintenance.lock lands in one snapshot and not the other. */
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });

/** Every byte under a dir (files, links, modes), .git included: the founder's checkout must not move. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, rel: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      const st = fs.lstatSync(p);
      if (e.isSymbolicLink()) out[r] = `link:${fs.readlinkSync(p)}`;
      else if (e.isDirectory()) {
        out[`${r}/`] = `dir:${(st.mode & 0o777).toString(8)}`;
        walk(p, r);
      } else out[r] = `${(st.mode & 0o777).toString(8)}:${createHash('sha256').update(fs.readFileSync(p)).digest('hex')}:${st.mtimeMs}`;
    }
  };
  walk(root, '');
  return out;
}

/** A committed repo: src/a.ts with a type error, tsconfig, a check script, a link, an exec bit, node_modules (ignored). */
function gitRepo(def?: Def, o: { attributes?: boolean } = {}): string {
  const root = tmp('gnomon-actrepo-');
  git(root, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'bin'));
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), "export const x: number = 'oops';\n");
  fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'export const b = 1;\n');
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}\n');
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x"}\n');
  fs.writeFileSync(path.join(root, 'bin', 'check'), '#!/usr/bin/env node\nprocess.exit(0)\n', { mode: 0o755 });
  fs.symlinkSync('a.ts', path.join(root, 'src', 'link.ts'));
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  // a smudge filter and a post-checkout hook a `git worktree add` would run: the scratch must run neither
  if (o.attributes !== false) fs.writeFileSync(path.join(root, '.gitattributes'), '*.ts filter=evil\n');
  git(root, 'config', 'filter.evil.smudge', `sh -c 'touch ${path.join(root, 'SMUDGED')}; cat'`);
  fs.writeFileSync(path.join(root, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\ntouch ${path.join(root, 'HOOKED')}\n`, { mode: 0o755 });
  if (def) {
    const r = compileLoop(def, { scope: 'repo', readShebang: (a0) => (a0.includes('/') ? readShebang(path.join(root, a0)) : null) });
    if (!r.compiled) throw new Error(JSON.stringify(r.errors));
    fs.mkdirSync(path.join(root, '.paradigm', 'loops'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', 'loops', `${def.id}.loop.json`), loopFileJson(r.compiled));
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  fs.mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');
  // the founder's uncommitted work: never in the scratch, never touched
  fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'export const b = 2; // wip\n');
  return root;
}

describe('G-GIT-01: the scratch worktree and the park repo', () => {
  it('HEAD detached outside the repo, no .git, no filter or hook run; changes park at a kernel ref; the checkout is byte-identical', () => {
    const root = gitRepo();
    const home = tmp('gnomon-home-');
    const before = snapshot(root);
    const head = git(root, 'rev-parse', 'HEAD').trim();
    const s = createScratch({ home, repo: root, loopId: 'fixer', runId: 'lr-0001' });
    expect(s.tree).toBe(path.join(fs.realpathSync.native(home), 'loop-work', 'act-lr-0001', 'tree'));
    expect(s.tree.startsWith(root)).toBe(false);
    expect(s).toMatchObject({ headSha: head, headRef: 'refs/heads/main', objectFormat: 'sha1' });
    expect(liveScratch('lr-0001')).toBe(s);
    // HEAD content, raw: the committed a.ts and b.ts (not the wip edit), no smudge, the link kept, the exec bit kept
    expect(fs.readFileSync(path.join(s.tree, 'src', 'a.ts'), 'utf8')).toBe("export const x: number = 'oops';\n");
    expect(fs.readFileSync(path.join(s.tree, 'src', 'b.ts'), 'utf8')).toBe('export const b = 1;\n');
    expect(fs.readlinkSync(path.join(s.tree, 'src', 'link.ts'))).toBe('a.ts');
    expect(fs.statSync(path.join(s.tree, 'bin', 'check')).mode & 0o111).not.toBe(0);
    expect(fs.existsSync(path.join(s.tree, '.git'))).toBe(false);
    expect(fs.realpathSync.native(path.join(s.tree, 'node_modules'))).toBe(path.join(root, 'node_modules'));
    expect(scratchChanges(s)).toEqual([]);
    // the act step's edits: modify, add, delete
    fs.writeFileSync(path.join(s.tree, 'src', 'a.ts'), 'export const x: number = 1;\n');
    fs.writeFileSync(path.join(s.tree, 'src', 'c.ts'), 'export const c = 3;\n');
    fs.rmSync(path.join(s.tree, 'src', 'b.ts'));
    expect(scratchChanges(s).map((c) => `${c.status} ${c.path}`)).toEqual(['modified src/a.ts', 'deleted src/b.ts', 'added src/c.ts']);
    const p = parkScratch(s, { home, message: 'fix(#x): green\nGnomon-Run: forged', loopTrailer: 'fixer@0123abcd', now: () => Date.parse('2026-10-22T00:00:00Z') })!;
    expect(p.ref).toBe('refs/gnomon/loops/fixer/lr-0001');
    expect(p.parkRepo).toBe(parkRepoDir(fs.realpathSync.native(home), root));
    const show = hardenedGit(['cat-file', '-p', p.sha], { gitDir: p.parkRepo }).stdout.toString('utf8');
    expect(show).toContain(`parent ${head}`);
    expect(show).toContain('author Gnomon Loop <loop+fixer@gnomon.invalid>');
    expect(show).toMatch(/fix\(#x\): green\n\nGnomon-Loop: fixer@0123abcd\nGnomon-Run: lr-0001\n$/);
    expect(hardenedGit(['rev-parse', p.ref], { gitDir: p.parkRepo }).stdout.toString('utf8').trim()).toBe(p.sha);
    expect(p.diff).toContain("-export const x: number = 'oops';");
    expect(p.diff).toContain('+export const x: number = 1;');
    expect(p.diff).toContain('deleted file mode');
    // nothing ran from repo config, and the founder's checkout and .git did not move a byte
    expect(fs.existsSync(path.join(root, 'SMUDGED'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'HOOKED'))).toBe(false);
    expect(snapshot(root)).toEqual(before);
    expect(git(root, 'for-each-ref', 'refs/gnomon')).toBe('');
    removeScratch(s);
    expect(fs.existsSync(s.runDir)).toBe(false);
    expect(liveScratch('lr-0001')).toBeNull();
    // retention: the parked ref goes past the window, a live scratch never
    const live = createScratch({ home, repo: root, loopId: 'fixer', runId: 'lr-0002' });
    const gone = sweepLoopScratch(home, 0, Date.now() + 1000);
    expect(gone.some((g) => g.endsWith('#refs/gnomon/loops/fixer/lr-0001'))).toBe(true);
    expect(fs.existsSync(live.tree)).toBe(true);
    removeScratch(live);
    expect(snapshot(root)).toEqual(before);
  });

  it('refuses a repo with no commit and a node_modules link out of the repo; nothing is left behind', () => {
    const home = tmp('gnomon-home-');
    const empty = tmp('gnomon-empty-');
    git(empty, 'init', '-q');
    expect(() => createScratch({ home, repo: empty, loopId: 'x', runId: 'lr-e' })).toThrow(/no commit at HEAD/);
    const root = gitRepo();
    removeTree(path.join(root, 'node_modules'));
    const outside = tmp('gnomon-outside-');
    fs.symlinkSync(outside, path.join(root, 'node_modules'), 'dir');
    expect(() => createScratch({ home, repo: root, loopId: 'x', runId: 'lr-f' })).toThrow(/resolves outside the repo/);
    expect(fs.existsSync(path.join(home, 'loop-work', 'act-lr-f'))).toBe(false);
  });
});

// ── the act step end to end ──────────────────────────────────────────────────────────────────────────────────────

const greenTypecheck = (id: string, extra: Def = {}): Def => ({
  schema: 'loop:v2', id, autonomy: 'act',
  budgets: { run: { rounds: 4, wallMin: 10, tokens: '400k' } },
  goal: { node: 'tsc', verdict: 'pass', inputs: ['tsconfig*.json'] },
  land: { paths: ['src/**'], message: 'fix(#gnomon): typecheck green' },
  start: 'tsc',
  nodes: [
    { id: 'tsc', type: 'check', run: ['bin/check'], on: { pass: '@goal', fail: 'fix' } },
    { id: 'fix', type: 'model', role: 'act', model: { use: 'local' }, tools: ['read', 'edit'], inputs: ['tsc.evidence'], exit: { maxVisits: 3, maxFailStreak: 2 }, on: { pass: 'tsc', fail: '@stop', unsure: '@stop', unavailable: '@stop' } },
  ],
  ...extra,
});

function result(verdict: 'pass' | 'fail', stdout: string): CheckResult {
  return { verdict, exitCode: verdict === 'pass' ? 0 : 1, signal: null, durationMs: 5, evidence: { stdoutTail: stdout, stderrTail: '', stdoutTruncated: false, stderrTruncated: false, redactions: [], label: 'private', sensitive: true }, profileHash: null, envKeys: [], copy: { dir: '', files: 0, bytes: 0, kept: false } };
}

function rig(root: string, base: string, o: { wrapAct?: (req: any) => any; check?: (i: CheckExecInput) => CheckResult | null } = {}) {
  const home = tmp('gnomon-home-');
  const rows: Array<{ kind: string; principal: string; payload: Record<string, unknown> }> = [];
  const cards: any[] = [];
  const launches: any[] = [];
  const checked: CheckExecInput[] = [];
  const registry = new LoopRegistry({ home, kernelPrincipal: KERNEL, append: async (k, p) => append(k, p), watch: false, rescanMs: 0 });
  const ledger = new LoopLedger({ kernelPrincipal: KERNEL });
  const append = async (kind: string, payload: Record<string, unknown>): Promise<void> => {
    const row = { kind, principal: KERNEL, at: new Date().toISOString(), payload };
    rows.push(row);
    registry.observe(row);
    ledger.observe(row);
  };
  const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log: append, billing: { env: () => ({}), layers: () => [] } });
  const children = new DaemonChildren({ append, control: processControlFor(process.platform), boot: 'boot-test', graceMs: 500 });
  const config = { endpoints: [{ id: 'qwen', base, model: 'fake-qwen-7b-q4', compat: 'llama.cpp', loops: true }], runner: pinOf(path.dirname(CLI), 'cli.js') };
  const lane = new LocalLane({
    sessionPath: null, pathDenies: [], log: append, children, fuse, home, userHome: tmp('gnomon-user-'), kernelPrincipal: KERNEL, sock: path.join(home, 'k.sock'),
    env: () => ({ ...process.env }), config, probeTtlMs: 0,
    launchPlan: (i) => {
      launches.push(i);
      return { command: i.binaryReal, args: i.argv, sandbox: 'partial', profile: 'test-unsandboxed', profileHash: 'sha256:test' };
    },
  });
  registry.addRepo(root);
  registry.scan();
  // the goal check judges the tree it is handed: the SCRATCH (never the founder's checkout)
  const check = async (i: CheckExecInput): Promise<CheckResult> => {
    checked.push(i);
    const over = o.check?.(i);
    if (over) return over;
    const t = fs.readFileSync(path.join(i.scratch!.tree, 'src', 'a.ts'), 'utf8');
    return t.includes("'oops'") ? result('fail', "src/a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.") : result('pass', '');
  };
  const toasts: string[] = [];
  const runner = new LoopRunner({
    home, kernelPrincipal: KERNEL, registry, ledger, append, platform: 'darwin', toast: (t) => toasts.push(t.text),
    broker: { raise: async (i: any) => { cards.push(i); return { cardId: i.cardId } as any; } },
    check, model: { openLoop: (ref, req) => lane.openLoop(ref, o.wrapAct ? o.wrapAct(req) : req), configured: () => ({ endpoints: ['qwen'], runner: true }), settled: (runId) => lane.loopSessionsSettled(runId) },
    caps: { modelBackoffMs: [1, 1, 1] },
  });
  const key = (id: string): string => `repo/${repoKeyOf([root])}/${id}`;
  const trust = (id: string): void => {
    const e = registry.verify(key(id))!;
    registry.observe({ kind: 'loop.trusted', principal: KERNEL, payload: { loopId: e.loopId, scope: e.scope, repoKey: e.repoKey, contentHash: e.hash!.contentHash, coreHash: e.hash!.coreHash, cardId: TRUST_CARD, by: HUMAN } });
  };
  const run = async (id: string) => {
    const r = runner.start(key(id), { type: 'manual', by: HUMAN });
    if (!('done' in r)) throw new Error('not started');
    return { runId: r.runId, end: await r.done };
  };
  return { home, rows, cards, launches, checked, lane, key, trust, run, runner, toasts, of: (runId: string, kind: string) => rows.filter((r) => r.kind === kind && r.payload.runId === runId).map((r) => r.payload) };
}

const writeCall = (p: string, content: string): FakeReply => ({ toolCalls: [{ name: 'write_file', arguments: JSON.stringify({ path: p, content }) }] });
const done = (verdict: 'pass' | 'fail'): FakeReply => ({ content: JSON.stringify({ verdict, confidence: 0.9, summary: 'changed a.ts' }) });

describe('Example B (green-typecheck) against a fake local endpoint: the act step ends in a propose card', () => {
  it('fixes the type error in the scratch, the goal passes there, one verdict card carries the diff; the checkout is byte-identical', async () => {
    expect(fs.existsSync(CLI), 'run `npm run build --workspace=@a-company/gnomon-local`').toBe(true);
    srv = await fakeOpenAI({ tools: true, script: [writeCall('src/a.ts', 'export const x: number = 1;\n'), done('pass')] });
    const root = gitRepo(greenTypecheck('green-typecheck'));
    const before = snapshot(root);
    const r = rig(root, srv.base);
    r.trust('green-typecheck');
    const { runId, end } = await r.run('green-typecheck');
    expect(end).toMatchObject({ reason: 'goal', terminal: '@goal' });
    // round 1 fails on the scratch, the act step edits it, round 2 passes on the scratch
    expect(r.checked.map((c) => c.scratch?.tree)).toEqual([expect.stringContaining(`act-${runId}`), expect.stringContaining(`act-${runId}`)]);
    const fix = r.of(runId, 'loop.node').find((n) => n.nodeId === 'fix')!;
    expect(fix).toMatchObject({ verdict: 'pass', role: 'act', model: { asked: 'local', used: 'fake-qwen-7b-q4', escalated: false } });
    // the act session: unattended, origin loop, in the scratch, the clamp's tools only, loop-act launch input
    const hsid = fix.hsid as string;
    const open = r.rows.find((x) => x.kind === 'session.open' && x.payload.hsid === hsid)!.payload;
    expect(open).toMatchObject({ attended: false, origin: 'loop', principalClass: 'kernel', loopRun: { loopId: 'green-typecheck', runId, nodeId: 'fix' } });
    expect(open.cwd).toBe(path.join(fs.realpathSync.native(r.home), 'loop-work', `act-${runId}`, 'tree'));
    expect(r.rows.find((x) => x.kind === 'session.sandbox' && x.payload.hsid === hsid)!.payload.profile).toBe('loop-act');
    expect(r.rows.find((x) => x.kind === 'session.routed' && x.payload.hsid === hsid)!.payload.allowTools).toEqual(['list_dir', 'read_file', 'write_file']);
    const launch = r.launches.at(-1);
    expect(launch.act).toMatchObject({ scratch: open.cwd, repo: root, endpointPort: Number(new URL(srv.base).port) });
    const req = srv.requests.filter((q) => notProbe(q))[0]!;
    expect((req.tools ?? []).map((t: any) => t.function.name).sort()).toEqual(['list_dir', 'read_file', 'write_file']);
    expect(JSON.stringify(req.messages)).toMatch(/BEGIN DATA [0-9a-f]+ ref=tsc\.evidence/);
    // tool lines carry model-written content: hashed in turn.event like model text
    expect(r.rows.filter((x) => x.kind === 'turn.event' && x.payload.hsid === hsid && String(x.payload.type).startsWith('tool')).every((x) => x.payload.line === undefined)).toBe(true);
    // ONE propose card: verdict kind, the loop origin, the kernel line, goal, files, why, the diff
    expect(r.cards).toHaveLength(1);
    const card = r.cards[0];
    expect(card).toMatchObject({ kind: 'verdict', attended: false, detail: { op: 'loop.propose', origin: 'loop', loopId: 'green-typecheck', runId, authoredBy: 'file', ref: `refs/gnomon/loops/green-typecheck/${runId}`, files: [{ path: 'src/a.ts', status: 'modified' }], goal: { node: 'tsc', verdict: 'pass', met: true }, effectiveAutonomy: 'act', hazards: [] } });
    expect(card.lines[0]).toBe('Raised by loop green-typecheck (from the loop file)');
    expect(card.lines).toContain('Goal check tsc: pass (goal met)');
    expect(card.lines).toContain('M src/a.ts');
    expect(card.lines).toContain('Proposed because auto-land is not in this release yet');
    expect(card.lines).toContain('Accept lands it on main (Touch ID; it waits while you are editing those files); reject drops it');
    expect(card.handOnly).toBe(true);
    expect(card.lines).toContain("-export const x: number = 'oops';");
    expect(card.lines).toContain('+export const x: number = 1;');
    expect(r.of(runId, 'loop.parked')[0]).toMatchObject({ ref: card.detail.ref, reason: 'propose' });
    expect(r.of(runId, 'loop.proposed')[0]).toMatchObject({ cardId: card.cardId, paths: ['src/a.ts'], why: 'land-blocked', blockers: ['auto-land is not in this release yet'] });
    const park = parkRepoDir(fs.realpathSync.native(r.home), root);
    expect(hardenedGit(['rev-parse', card.detail.ref], { gitDir: park }).stdout.toString('utf8').trim()).toBe(card.detail.sha);
    // the scratch is gone; the founder's real checkout (and .git) is byte-identical; nothing ran from repo config
    expect(fs.existsSync(path.dirname(open.cwd as string))).toBe(false);
    expect(snapshot(root)).toEqual(before);
    expect(fs.readFileSync(path.join(root, 'src', 'a.ts'), 'utf8')).toBe("export const x: number = 'oops';\n");
    expect(fs.existsSync(path.join(root, 'SMUDGED'))).toBe(false);
    expect(await waitFor(() => r.lane.stateOf(hsid) === 'exited', 5_000)).toBe(true);
  }, 60_000);

  it('G-LOOP-22: a write to a goal input is refused with no card; the act step fails and nothing is proposed', async () => {
    srv = await fakeOpenAI({ tools: true, script: [writeCall('tsconfig.json', '{"compilerOptions":{"strict":false}}\n'), done('pass')] });
    const root = gitRepo(greenTypecheck('gamer'));
    const before = snapshot(root);
    const r = rig(root, srv.base);
    r.trust('gamer');
    const { runId, end } = await r.run('gamer');
    expect(end).toMatchObject({ reason: 'stop' });
    const fix = r.of(runId, 'loop.node').find((n) => n.nodeId === 'fix')!;
    expect(fix).toMatchObject({ verdict: 'fail', protectedHits: ['tsconfig.json'] });
    expect(String(fix.detail)).toMatch(/^protected-input: tsconfig\.json/);
    expect(r.cards).toEqual([]);
    expect(r.of(runId, 'loop.parked')).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  }, 60_000);

  it('G-LOOP-23: a fix that adds @ts-ignore still proposes, with the suppression marker as a reason', async () => {
    srv = await fakeOpenAI({ tools: true, script: [writeCall('src/a.ts', "// @ts-ignore\nexport const x: number = 'ok';\n"), done('pass')] });
    const root = gitRepo(greenTypecheck('silencer'));
    const r = rig(root, srv.base);
    r.trust('silencer');
    const { runId } = await r.run('silencer');
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].detail.hazards).toEqual([{ kind: 'suppression-marker', path: 'src/a.ts', marker: '@ts-ignore' }]);
    expect(r.cards[0].lines).toContain('Proposed because it adds a suppression marker @ts-ignore in src/a.ts');
    expect(r.of(runId, 'loop.proposed')[0]).toMatchObject({ why: 'land-hazard', hazards: ['suppression-marker'] });
  }, 60_000);
});

// ── step 11 (#loop-land): the same act step, landed ─────────────────────────────────────────────────────────────

describe('Example B lands only through its card in 8.0 (build plan step 11, G-LOOP-07, G-LOOP-09, G-LOOP-15)', () => {
  it('a change that would land alone at L0 raises the card; accepting it lands exactly the proposed bytes, the human\'s wip untouched', async () => {
    srv = await fakeOpenAI({ tools: true, script: [writeCall('src/a.ts', 'export const x: number = 1;\n'), done('pass')] });
    const root = gitRepo({ ...greenTypecheck('lander'), notify: { on: ['landed'], as: 'toast' } }, { attributes: false });
    const base = git(root, 'rev-parse', 'HEAD').trim();
    const before = snapshot(root);
    const r = rig(root, srv.base);
    r.trust('lander');
    const { runId, end } = await r.run('lander');
    expect(end).toMatchObject({ reason: 'goal' });
    // 8.0: nothing lands alone, whatever the level (founder decision)
    expect(r.of(runId, 'loop.landed')).toEqual([]);
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].lines).toContain('Proposed because auto-land is not in this release yet');
    expect(r.of(runId, 'loop.parked')[0]).toMatchObject({ reason: 'propose' });
    expect(git(root, 'rev-parse', 'HEAD').trim()).toBe(base);
    await r.cards[0].effect('accept', {});
    await waitFor(() => r.of(runId, 'loop.landed').length === 2, 10_000);
    const landed = r.of(runId, 'loop.landed');
    expect(landed[0]).toEqual(expect.objectContaining({ loopId: 'lander', paths: ['src/a.ts'], baseSha: base, ref: 'refs/heads/main', how: 'approved', cardId: r.cards[0].cardId, phase: 'intent' }));
    expect(landed[1]).toMatchObject({ phase: 'done' });
    const sha = landed[0]!.sha as string;
    expect(git(root, 'rev-parse', 'HEAD').trim()).toBe(sha);
    expect(git(root, 'rev-parse', 'HEAD^').trim()).toBe(base);
    expect(git(root, 'log', '-1', '--format=%an <%ae>%n%(trailers:only,unfold)')).toBe('Gnomon Loop <loop+lander@gnomon.invalid>\nOn-Behalf-Of: p:abcdefgh/matt\nTrusted-By: card:01HZZZZZZZZZZZZZZZZZZZZZZZ\nGnomon-Loop: lander@' + (r.of(runId, 'loop.run.started')[0]!.contentHash as string).replace(/^sha256:/, '').slice(0, 8) + '\nGnomon-Run: ' + runId + '\nLoop-Authored-By: file\n\n');
    // the checkout: src/a.ts is the proposed bytes, the human's wip b.ts and everything else is byte-identical
    const after = snapshot(root);
    const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k] && !k.startsWith('.git/') && k !== '.git/');
    expect(changed).toEqual(['src/a.ts']);
    expect(fs.readFileSync(path.join(root, 'src', 'b.ts'), 'utf8')).toBe('export const b = 2; // wip\n');
    expect(git(root, 'status', '--porcelain')).toBe(' M src/b.ts\n');
    expect(fs.existsSync(path.join(root, 'HOOKED'))).toBe(false);
    const park = parkRepoDir(fs.realpathSync.native(r.home), root);
    expect(hardenedGit(['for-each-ref', 'refs/gnomon'], { gitDir: park }).stdout.toString('utf8')).toBe('');
    expect(r.toasts.some((t) => t.startsWith(`lander: landed ${sha.slice(0, 12)} on main`))).toBe(true);
    // G-LOOP-09: a revert of the landed commit is a merge.reverted row
    git(root, 'checkout', '-q', '--', 'src/b.ts');
    git(root, 'revert', '--no-edit', sha);
    expect(await r.runner.lander.scanReverts()).toBe(1);
    expect(r.rows.filter((x) => x.kind === 'merge.reverted').map((x) => x.payload)).toEqual([expect.objectContaining({ landedRef: sha, detectedBy: 'content', loopId: 'lander', runId })]);
    expect(await r.runner.lander.scanReverts()).toBe(0);
  }, 60_000);

  it('a repo whose .gitattributes filters the touched path: accepting parks it with a toast; the checkout is byte-identical', async () => {
    srv = await fakeOpenAI({ tools: true, script: [writeCall('src/a.ts', 'export const x: number = 1;\n'), done('pass')] });
    const root = gitRepo(greenTypecheck('filtered'));
    const before = snapshot(root);
    const r = rig(root, srv.base);
    r.trust('filtered');
    const { runId } = await r.run('filtered');
    expect(r.cards).toHaveLength(1);
    await r.cards[0].effect('accept', {});
    await waitFor(() => r.of(runId, 'loop.parked').length === 2, 10_000);
    expect(r.of(runId, 'loop.landed')).toEqual([]);
    expect(r.of(runId, 'loop.parked').map((p) => p.reason)).toEqual(['propose', 'attributes']);
    expect(r.toasts.some((t) => t.startsWith('filtered: could not land') && t.includes('refs/gnomon/loops/filtered/'))).toBe(true);
    expect(snapshot(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, 'SMUDGED'))).toBe(false);
  }, 60_000);

  it('approve-to-land: a dirty overlap waits, then lands once the human\'s edit is gone', async () => {
    srv = await fakeOpenAI({ tools: true, script: [writeCall('src/a.ts', 'export const x: number = 1;\n'), done('pass')] });
    const root = gitRepo(greenTypecheck('asker', { decide: 'before-land' }), { attributes: false });
    const base = git(root, 'rev-parse', 'HEAD').trim();
    const r = rig(root, srv.base);
    r.trust('asker');
    const { runId } = await r.run('asker');
    expect(r.cards).toHaveLength(1);
    // the human is editing the same file: accept waits (loop.land.waiting{dirty}); nothing lands, their bytes stay
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'human edit\n');
    await r.cards[0].effect('accept', {});
    await waitFor(() => r.of(runId, 'loop.land.waiting').length > 0, 5_000);
    expect(r.of(runId, 'loop.land.waiting')[0]).toMatchObject({ reason: 'dirty' });
    expect(git(root, 'rev-parse', 'HEAD').trim()).toBe(base);
    expect(fs.readFileSync(path.join(root, 'src', 'a.ts'), 'utf8')).toBe('human edit\n');
    expect(r.runner.lander.waiting()).toEqual([expect.objectContaining({ runId, reason: 'dirty', how: 'approved' })]);
    // the human drops their edit; the next nudge lands it, named by the card
    git(root, 'checkout', '-q', '--', 'src/a.ts');
    await r.runner.lander.nudge();
    expect(r.of(runId, 'loop.landed')[0]).toEqual(expect.objectContaining({ how: 'approved', cardId: r.cards[0].cardId }));
    expect(git(root, 'rev-parse', 'HEAD^').trim()).toBe(base);
    expect(fs.readFileSync(path.join(root, 'src', 'a.ts'), 'utf8')).toBe('export const x: number = 1;\n');
    expect(r.runner.lander.waiting()).toEqual([]);
  }, 60_000);
});

describe('TD-2026-10-23-268: an act node and a check node get the variables the trusted loop names, from its env files', () => {
  const named = (id: string): Def => {
    const d = greenTypecheck(id, { redact: 'off', envFiles: ['.env.local'] });
    d.nodes[0].env = ['DATABASE_URL'];
    d.nodes[1].env = ['STRIPE_KEY'];
    return d;
  };
  it('the act session env carries the named value, never an unnamed one; checks get their env source and redact off', async () => {
    srv = await fakeOpenAI({ tools: true, script: [writeCall('src/a.ts', 'export const x: number = 1;\n'), done('pass')] });
    const root = gitRepo(named('secretive'));
    fs.writeFileSync(path.join(root, '.env.local'), 'STRIPE_KEY=sk_live_act_value\nDATABASE_URL=postgres://x\nGITHUB_TOKEN=ghp_unnamed\n');
    let seenEnv: Record<string, string> | undefined;
    const r = rig(root, srv.base, { wrapAct: (req) => ((seenEnv = req.act?.env), req) });
    r.trust('secretive');
    const { runId, end } = await r.run('secretive');
    expect(end).toMatchObject({ reason: 'goal' });
    expect(seenEnv).toEqual({ STRIPE_KEY: 'sk_live_act_value' });
    const fix = r.of(runId, 'loop.node').find((n) => n.nodeId === 'fix')!;
    const keys = r.rows.find((x) => x.kind === 'session.sandbox' && x.payload.hsid === fix.hsid)!.payload.envKeys as string[];
    expect(keys).toContain('STRIPE_KEY');
    for (const k of ['GITHUB_TOKEN', 'DATABASE_URL', 'GNOMON_SOCK', 'GNOMON_SESSION_KEY']) expect(keys, k).not.toContain(k);
    expect(JSON.stringify(r.rows)).not.toContain('sk_live_act_value');
    expect(r.checked.map((c) => [c.node.env, c.redact, c.envValues, c.skipFiles])).toEqual([[['DATABASE_URL'], false, { DATABASE_URL: 'postgres://x' }, ['.env.local']], [['DATABASE_URL'], false, { DATABASE_URL: 'postgres://x' }, ['.env.local']]]);
  }, 60_000);
  it('a named variable found in no file fails the act node with a clear reason, and nothing opens', async () => {
    srv = await fakeOpenAI({ tools: true, script: [writeCall('src/a.ts', 'export const x: number = 1;\n'), done('pass')] });
    const root = gitRepo(named('unset'));
    fs.writeFileSync(path.join(root, '.env.local'), 'DATABASE_URL=postgres://x\n');
    const r = rig(root, srv.base);
    r.trust('unset');
    const { runId } = await r.run('unset');
    const fix = r.of(runId, 'loop.node').find((n) => n.nodeId === 'fix')!;
    expect(fix).toMatchObject({ verdict: 'error', detail: expect.stringContaining('STRIPE_KEY was not found in ~/.gnomon/loop-env, .env.local') });
    expect(r.rows.some((x) => x.kind === 'session.open')).toBe(false);
  }, 60_000);
  it('Aegis F4: an act env name the trusted node does not declare is refused and nothing spawns', async () => {
    srv = await fakeOpenAI({ tools: true, script: [writeCall('src/a.ts', 'export const x: number = 1;\n'), done('pass')] });
    const root = gitRepo(named('widened'));
    fs.writeFileSync(path.join(root, '.env.local'), 'STRIPE_KEY=sk_live_act_value\nDATABASE_URL=postgres://x\n');
    const r = rig(root, srv.base, { wrapAct: (req) => ({ ...req, act: { ...req.act, env: { ...req.act.env, AWS_SECRET_ACCESS_KEY: 'smuggled' } } }) });
    r.trust('widened');
    const { runId } = await r.run('widened');
    const fix = r.of(runId, 'loop.node').find((n) => n.nodeId === 'fix')!;
    expect(fix).toMatchObject({ verdict: 'error', detail: expect.stringContaining('AWS_SECRET_ACCESS_KEY is not one the trusted act node declares') });
    expect(r.rows.some((x) => x.kind === 'session.open')).toBe(false);
  }, 60_000);
  it('Aegis L4: a value handed out and then edited in its file mid-run is still caught (the run keeps it in memory)', async () => {
    srv = await fakeOpenAI({ tools: true, script: [writeCall('src/a.ts', 'export const x: number = 1; // sk_live_first_value\n'), done('pass')] });
    const root = gitRepo(named('rotated'));
    const envPath = path.join(root, '.env.local');
    fs.writeFileSync(envPath, 'STRIPE_KEY=sk_live_first_value\nDATABASE_URL=postgres://x\n');
    // the human rotates the key right after the act step got it
    const r = rig(root, srv.base, { wrapAct: (req) => (fs.writeFileSync(envPath, 'STRIPE_KEY=sk_live_rotated\nDATABASE_URL=postgres://x\n'), req) });
    r.trust('rotated');
    await r.run('rotated');
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].detail.hazards).toEqual([{ kind: 'env-value', path: 'src/a.ts', name: 'STRIPE_KEY' }]);
    expect(JSON.stringify(r.cards[0])).not.toContain('sk_live_first_value');
  }, 60_000);
  it('Aegis F3 and F5: a parked change carrying a handed-out value is a hazard (the card never shows the value); a node detail is scanned even with redact off', async () => {
    srv = await fakeOpenAI({ tools: true, script: [writeCall('src/a.ts', 'export const x: number = 1; // sk_live_act_value\n'), { content: JSON.stringify({ verdict: 'pass', confidence: 0.9, summary: 'pasted sk_live_act_value in' }) }] });
    const root = gitRepo(named('leaky'));
    fs.writeFileSync(path.join(root, '.env.local'), 'STRIPE_KEY=sk_live_act_value\nDATABASE_URL=postgres://x\n');
    let first = true;
    const r = rig(root, srv.base, { check: () => (first ? ((first = false), { ...result('fail', "src/a.ts(1,14): error TS2322"), detail: 'the builtin could not judge: postgres://x is down' }) : null) });
    r.trust('leaky');
    const { runId } = await r.run('leaky');
    const tsc = r.of(runId, 'loop.node').find((n) => n.nodeId === 'tsc')!;
    expect(tsc.detail).toBe('the builtin could not judge: [REDACTED:env:DATABASE_URL] is down');
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].detail.hazards).toEqual([{ kind: 'env-value', path: 'src/a.ts', name: 'STRIPE_KEY' }]);
    expect(r.cards[0].lines).toContain('Proposed because the change contains the value of STRIPE_KEY in src/a.ts');
    expect(JSON.stringify(r.cards[0])).not.toContain('sk_live_act_value');
    // Aegis F2: the model's reply and summary are redacted by value
    const fix = r.of(runId, 'loop.node').find((n) => n.nodeId === 'fix')!;
    expect(JSON.stringify(fix)).toContain('[REDACTED:env:STRIPE_KEY]');
    expect(JSON.stringify(r.rows)).not.toContain('sk_live_act_value');
  }, 60_000);
});
