/**
 * tree-semantics.test — THE TREE SEMANTICS DECISION + BYTE CUSTODY
 * (T-2026-07-18-005; fixes T-2026-07-18-004 recover false-refusal and
 * T-2026-07-18-002 byte-only custody gap).
 *
 * Pins:
 *   1. projectTreeWorktreeSemantics — the deterministic worktree-semantics
 *      projection of a store tree: filters tracked-but-gitignored paths by the
 *      tree's OWN root ignore rules; a worktree-semantics tree is a fixed point;
 *      the projection equals the ignore-honoring disk walk of the same bytes.
 *   2. snapshotRef ≡ snapshotDir on a clean tree (ONE semantics — full AND
 *      incremental paths), incl. tracked-but-gitignored fixtures; a root
 *      ignore-rule change between anchor and ref falls OPEN to the full walk.
 *   3. S5 DRILL CLASS (drill #1's exact failure): a stake cut from a
 *      LEGACY-git-semantics binding (tracked-but-gitignored files IN) is
 *      recoverable after `git reset --hard <stake>` — recover judges the strand
 *      under ITS OWN semantics via projection; the cut records worktreeTreeId.
 *   4. BYTE CUSTODY: a doc-only commit (meaning-NOOP, tree advanced) seals a
 *      byteOnly strand — stateId unchanged, binding advanced, gate never
 *      refuses it, auto-stake counts it, verify/grade/dag/restore all hold; a
 *      truly unchanged tree stays a NOOP.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import {
  snapshotDir,
  snapshotRef,
  writeMergedTree,
  restoreTree,
  projectTreeWorktreeSemantics,
  type PathChange,
} from '../src/warp/snapshot.js';
import { ObjectStore } from '../src/warp/object-store.js';
import { WarpStore } from '../src/warp/store.js';
import { absorb } from '../src/absorb.js';
import { recordPick } from '../src/fabric/pick.js';
import { sealState } from '../src/fabric/seal.js';
import { stake, stakeRecover, stakeAuditPathOf, type StakeAuditRow } from '../src/fabric/stake.js';
import { STAKE_MARKER } from '../src/fabric/stake-guard.js';
import { verifyFabric } from '../src/fabric/verify.js';
import { gradeFabric } from '../src/fabric/grade.js';
import { buildDag } from '../src/fabric/dag.js';
import { readFabric, readSelvage, warplineDirOf } from '../src/fabric/fabric.js';
import { revParseTree } from '../src/git/git-exec.js';

const execFileAsync = promisify(execFile);

class Repo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<Repo> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new Repo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'ts@warpline.test');
    await r.git('config', 'user.name', 'Warpline TS');
    await r.git('config', 'commit.gpgsign', 'false');
    return r;
  }
  git = async (...a: string[]): Promise<string> =>
    (await execFileAsync('git', a, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();
  async write(rel: string, body: string): Promise<void> {
    const full = path.join(this.dir, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, body, 'utf8');
  }
  setConfig(cfg: unknown): void {
    fs.mkdirSync(path.join(this.dir, '.warpline'), { recursive: true });
    fs.writeFileSync(path.join(this.dir, '.warpline', 'config.json'), JSON.stringify(cfg), 'utf8');
  }
  auditRows(): StakeAuditRow[] {
    const p = stakeAuditPathOf(this.dir);
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as StakeAuditRow);
  }
  destroy = (): Promise<void> => fsp.rm(this.dir, { recursive: true, force: true });
}

const allNames = (store: ObjectStore, treeId: string, prefix = ''): string[] => {
  const out: string[] = [];
  for (const e of store.getTree(treeId)) {
    const p = prefix ? `${prefix}/${e.name}` : e.name;
    out.push(p);
    if (e.mode === '40000') out.push(...allNames(store, e.id, p));
  }
  return out;
};

/* ── 1+2: projection + one-semantics ref walks ──────────────────────────────── */

describe('worktree semantics — projection + ref/dir walk unification', () => {
  let repo: Repo;
  beforeAll(async () => {
    repo = await Repo.create('warpline-treesem-');
    await repo.write('.gitignore', 'tracked-secret.txt\ndist/\n');
    await repo.write('README.md', 'hello\n');
    await repo.write('src/a.txt', 'A1\n');
    await repo.write('tracked-secret.txt', 'ignored-but-tracked\n'); // the drill-#1 class
    await repo.write('dist/out.js', 'built\n'); // tracked-but-ignored DIRECTORY
    await repo.git('add', '-A', '-f');
    await repo.git('commit', '-q', '-m', 'seed');
  });
  afterAll(() => repo.destroy());

  it('projectTreeWorktreeSemantics filters a LEGACY (git-commit-tree) binding to the disk-walk view; fixed point on the result', async () => {
    const store = new ObjectStore(repo.dir);
    // A LEGACY tree, constructed the pre-decision way: EVERY tracked file in.
    const files = (await repo.git('ls-files')).split('\n');
    const changes = new Map<string, PathChange>();
    for (const f of files) changes.set(f, { content: fs.readFileSync(path.join(repo.dir, f)), mode: '100644' });
    const legacyTree = writeMergedTree(store, null, changes);
    expect(allNames(store, legacyTree)).toContain('tracked-secret.txt');

    const projected = projectTreeWorktreeSemantics(store, legacyTree);
    expect(projected).not.toBe(legacyTree);
    // the projection IS the disk walk's view of the same bytes (the disk walk
    // also WRITES the filtered trees — projection itself is pure compute)
    expect(projected).toBe(snapshotDir(store, repo.dir).treeId);
    const names = allNames(store, projected);
    expect(names).not.toContain('tracked-secret.txt');
    expect(names).not.toContain('dist'); // ignored dir pruned entirely
    expect(names).toContain('README.md');
    expect(names).toContain('src/a.txt');
    // a worktree-semantics tree is a FIXED POINT of the projection
    expect(projectTreeWorktreeSemantics(store, projected)).toBe(projected);
  });

  it('snapshotRef (full AND incremental) applies the ref\'s own ignore rules — equal to the disk walk, tracked-ignored fixtures included', async () => {
    const store = new ObjectStore(repo.dir);
    const shaA = await repo.git('rev-parse', 'HEAD');
    const fullA = await snapshotRef(store, shaA, { cwd: repo.dir });
    expect(fullA).toBe(snapshotDir(store, repo.dir).treeId); // ONE semantics
    expect(allNames(store, fullA)).not.toContain('tracked-secret.txt');

    // commit B: edit a normal file AND the tracked-ignored file
    await repo.write('src/a.txt', 'A2\n');
    await repo.write('tracked-secret.txt', 'still-ignored\n');
    await repo.git('add', '-A', '-f');
    await repo.git('commit', '-q', '-m', 'edit');
    const shaB = await repo.git('rev-parse', 'HEAD');

    const incremental = await snapshotRef(store, shaB, { cwd: repo.dir }, { ref: shaA, treeId: fullA });
    const coldStore = new ObjectStore(await fsp.mkdtemp(path.join(os.tmpdir(), 'warpline-treesem-cold-')));
    const fullB = await snapshotRef(coldStore, shaB, { cwd: repo.dir });
    expect(incremental).toBe(fullB); // byte-identical, ignored edit filtered on both paths
    expect(allNames(store, incremental)).not.toContain('tracked-secret.txt');
    expect(incremental).toBe(snapshotDir(store, repo.dir).treeId);
  });

  it('a root ignore-rule change between anchor and ref falls OPEN to the (freshly filtered) full walk', async () => {
    const store = new ObjectStore(repo.dir);
    const shaB = await repo.git('rev-parse', 'HEAD');
    const treeB = await snapshotRef(store, shaB, { cwd: repo.dir });
    // commit C: STOP ignoring tracked-secret.txt — an unchanged-path re-inclusion
    // the diff overlay could never see; the incremental path must fall open.
    await repo.write('.gitignore', 'dist/\n');
    await repo.git('add', '-A');
    await repo.git('commit', '-q', '-m', 'unignore');
    const shaC = await repo.git('rev-parse', 'HEAD');
    const viaAnchor = await snapshotRef(store, shaC, { cwd: repo.dir }, { ref: shaB, treeId: treeB });
    const coldStore = new ObjectStore(await fsp.mkdtemp(path.join(os.tmpdir(), 'warpline-treesem-cold2-')));
    expect(viaAnchor).toBe(await snapshotRef(coldStore, shaC, { cwd: repo.dir }));
    expect(allNames(store, viaAnchor)).toContain('tracked-secret.txt'); // now legitimately IN
  });
});

/* ── 3: the S5 drill class — recover a LEGACY-semantics stake ───────────────── */

describe('stake recover — legacy-git-semantics binding (F3 drill #1 class) recovers via projection', () => {
  let repo: Repo;
  beforeAll(async () => {
    repo = await Repo.create('warpline-legacy-recover-');
    await repo.write('.gitignore', 'tracked-secret.txt\n.warpline/\n');
    await repo.write(
      '.purpose',
      'version: "2.0"\ndescription: Legacy fixture\ncomponents:\n  alpha:\n    description: A\n    type: module\n',
    );
    await repo.write('README.md', 'legacy hello\n');
    await repo.write('tracked-secret.txt', 'tracked AND gitignored\n');
    await repo.git('add', '-A', '-f');
    await repo.git('commit', '-q', '-m', 'legacy seed');
  }, 120_000);
  afterAll(() => repo.destroy());

  it('cut (records worktreeTreeId) → git reset --hard → recover GREEN; the fabric never moves', async () => {
    const store = new ObjectStore(repo.dir);
    const warpStore = new WarpStore(repo.dir, { diskCache: true });
    const sha = await repo.git('rev-parse', 'HEAD');
    const treeSha = await revParseTree(sha, { cwd: repo.dir });

    // Seal a LEGACY strand exactly as the pre-decision hook did: the binding is
    // the UNFILTERED git commit tree (tracked-but-gitignored file IN), no
    // treeSemantics tag. This is drill #1's staked-strand shape, reconstructed.
    const files = (await repo.git('ls-files')).split('\n');
    const changes = new Map<string, PathChange>();
    for (const f of files) changes.set(f, { content: fs.readFileSync(path.join(repo.dir, f)), mode: '100644' });
    const legacyTree = writeMergedTree(store, null, changes);
    expect(allNames(store, legacyTree)).toContain('tracked-secret.txt');
    const state = await absorb('HEAD', { cwd: repo.dir });
    const strand = sealState(repo.dir, warpStore, state, {
      parentStateId: null,
      actor: 'legacy-hook',
      intent: 'legacy seed',
      gitCommit: sha,
      now: '2026-07-18T00:00:00.000Z',
      binding: { treeId: legacyTree, gitOid: treeSha }, // NO treeSemantics — the legacy epoch
    });
    expect(strand.binding?.treeSemantics).toBeUndefined();

    // Cut the stake — the audit row must carry the PROJECTED worktree expectation.
    repo.setConfig({ stake: { enabled: true, refs: ['selvage'] } });
    const cut = await stake(repo.dir);
    expect(cut.action).toBe('staked');
    const projected = projectTreeWorktreeSemantics(store, legacyTree);
    expect(projected).not.toBe(legacyTree); // the semantics really diverge on this fixture
    expect(cut.worktreeTreeId).toBe(projected);
    const cutRow = repo.auditRows().at(-1)!;
    expect(cutRow.action).toBe('stake');
    expect(cutRow.worktreeTreeId).toBe(projected);

    // The drill: reset to the stake, then recover. Pre-fix this FALSE-REFUSED
    // (worktree walk skips tracked-secret.txt; the raw binding contains it).
    await repo.git('reset', '--hard', cut.gitCommit);
    expect(fs.existsSync(path.join(repo.dir, STAKE_MARKER))).toBe(true);
    expect(fs.existsSync(path.join(repo.dir, 'tracked-secret.txt'))).toBe(true); // on disk, ignored by the walk
    const fabricBefore = readFabric(warplineDirOf(repo.dir)).length;

    const r = await stakeRecover(repo.dir, cut.gitCommit);
    expect(r.pickId).toBe(strand.pickId);
    expect(fs.existsSync(path.join(repo.dir, STAKE_MARKER))).toBe(false); // marker consumed by re-entry
    expect(readSelvage(warplineDirOf(repo.dir))).toBe(strand.stateId);
    expect(readFabric(warplineDirOf(repo.dir)).length).toBe(fabricBefore); // a ref move, never an import
    const recRow = repo.auditRows().at(-1)!;
    expect(recRow.action).toBe('recover');
    expect(recRow.worktreeTreeId).toBe(projected); // recovered under the strand's OWN semantics

    // an edited-after-reset tree still refuses (the rail did not go soft)
    await repo.git('reset', '--hard', cut.gitCommit);
    await repo.write('README.md', 'tampered\n');
    await expect(stakeRecover(repo.dir, cut.gitCommit)).rejects.toThrow(/hashes to|edited after the reset/);
    expect(fs.existsSync(path.join(repo.dir, STAKE_MARKER))).toBe(true); // refusal restores the marker
  }, 120_000);
});

/* ── 4: byte custody — the meaning-NOOP + tree-advanced strand ──────────────── */

describe('byte custody — doc-only commits seal byteOnly strands (T-2026-07-18-002)', () => {
  let repo: Repo;
  beforeAll(async () => {
    repo = await Repo.create('warpline-bytecustody-');
    await repo.write('.gitignore', '.warpline/\n');
    await repo.write(
      '.purpose',
      'version: "2.0"\ndescription: Byte custody fixture\ncomponents:\n  alpha:\n    description: A\n    type: module\n',
    );
    await repo.write('docs/notes.md', 'v1 of the notes\n');
    await repo.git('add', '-A');
    await repo.git('commit', '-q', '-m', 'seed');
    // auto-stake ON from the start: the byte strand must count for the valve.
    repo.setConfig({ stake: { enabled: true, refs: ['selvage'], auto: 'every-seal' } });
  }, 120_000);
  afterAll(() => repo.destroy());

  it('e2e: seal → doc-only commit seals byteOnly (stateId unchanged, binding advanced, auto-stake fires) → unchanged tree is a true NOOP → verify/grade/dag/restore hold', async () => {
    const genesis = await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'genesis' });
    expect(genesis.noop).toBe(false);
    expect(genesis.byteOnly).toBeUndefined();
    const s1 = genesis.strand!;
    expect(s1.binding?.treeSemantics).toBe('worktree:v1'); // new bindings carry the canonical tag

    // DOC-ONLY commit: meaning unchanged, bytes changed.
    await repo.write('docs/notes.md', 'v2 of the notes — doc-only change\n');
    await repo.git('add', '-A');
    await repo.git('commit', '-q', '-m', 'docs: notes v2');
    const r2 = await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'docs: notes v2' });
    expect(r2.noop).toBe(false); // pre-fix: this was a NOOP — the custody gap
    expect(r2.byteOnly).toBe(true);
    const s2 = r2.strand!;
    expect(s2.byteOnly).toBe(true);
    expect(s2.stateId).toBe(s1.stateId); // meaning identical — stateId naturally equals the parent's
    expect(s2.parentStateId).toBe(s1.stateId);
    expect(s2.delta).toEqual({ born: [], retired: [], contractChanged: [], renamedNoop: 0 });
    expect(s2.binding!.treeId).not.toBe(s1.binding!.treeId); // the BYTES advanced
    expect(s2.binding?.treeSemantics).toBe('worktree:v1');

    // auto-stake counted the byte strand (stake.auto every-seal fired on it)
    const stakes = repo.auditRows().filter((r) => r.action === 'stake');
    expect(stakes.map((r) => r.pickId)).toContain(s2.pickId);

    // an unchanged tree is STILL a true NOOP (no strand spam)
    const r3 = await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'again' });
    expect(r3.noop).toBe(true);
    expect(readFabric(warplineDirOf(repo.dir)).length).toBe(2);

    // verify: the whole fabric (incl. the byteOnly strand) authenticates
    const report = verifyFabric(repo.dir);
    expect(report.failures).toEqual([]);
    expect(report.v2Chain.ok).toBe(true);

    // grade: the grader runs over a fabric containing byte strands
    expect(() => gradeFabric(repo.dir)).not.toThrow();

    // dag: the byte strand is the single head, no cycles
    const dag = buildDag(readFabric(warplineDirOf(repo.dir)));
    expect(dag.cycle.length).toBe(0);
    expect(dag.heads.map((h) => h.pickId)).toEqual([s2.pickId]);

    // restore, git-absent: the byte strand's binding reproduces the doc change
    const store = new ObjectStore(repo.dir);
    const dest = await fsp.mkdtemp(path.join(os.tmpdir(), 'warpline-bytecustody-restore-'));
    restoreTree(store, s2.binding!.treeId, dest);
    expect(fs.readFileSync(path.join(dest, 'docs', 'notes.md'), 'utf8')).toBe('v2 of the notes — doc-only change\n');
    expect(fs.existsSync(path.join(dest, '.git'))).toBe(false);
    await fsp.rm(dest, { recursive: true, force: true });
  }, 240_000);

  it('R2 real gate: an AGENT-attributed byte-only pick is FAST/no-gate — never refused', async () => {
    repo.setConfig({
      stake: { enabled: true, refs: ['selvage'], auto: false },
      gate: { agentWrites: 'real' },
      shadowGate: true,
    });
    await repo.write('docs/notes.md', 'v3 — agent doc-only change\n');
    await repo.git('add', '-A');
    await repo.git('commit', '-q', '-m', 'docs: notes v3');
    const r = await recordPick(repo.dir, {
      cwd: repo.dir,
      ref: 'HEAD',
      intent: 'docs: notes v3',
      agentId: 'doc-agent',
    });
    expect(r.noop).toBe(false);
    expect(r.byteOnly).toBe(true);
    expect(r.strand!.authoredBy?.agentId).toBe('doc-agent');
  }, 240_000);
});
