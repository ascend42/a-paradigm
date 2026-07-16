/**
 * cfg-merge.test — P3 Lane A END-TO-END: the structured-data lens makes the
 * meaning judges HONEST where agents actually collide (package.json).
 *
 *   DEP-ADD    : two branches each add a DIFFERENT dependency → warpline's
 *                MEANING verdict is autoClean/CLEAN (git may or may not conflict
 *                on the adjacent bytes) — and a full admit MATERIALIZES + SEALS.
 *   DEP-KNOT   : the SAME dep at DIFFERENT versions → a KNOT on exactly that
 *                key unit (#cfg:package.json::/dependencies/…).
 *   LOCKFILE   : package-lock.json divergence NEVER knots — derived take-either
 *                (ours) + a STALE marker in the merge plan.
 *   HONESTY    : admit + oracle verdicts carry per-path labels — meaning-decided
 *                (package.json, TS) / byte-decided (README) / derived (lockfile).
 *   PIN        : a pure-TS fixture's stateId equals the PRE-cfg-lens baseline
 *                (captured on the 387-green tree) — cfg units move stateIds ONLY
 *                where json/yaml exists.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { absorb } from '../src/absorb.js';
import { diff } from '../src/sem-delta.js';
import { predict } from '../src/predict.js';
import { recordPick } from '../src/fabric/pick.js';
import { forkScratch } from '../src/fabric/scratch.js';
import { admit } from '../src/fabric/admit.js';
import { oracle } from '../src/oracle.js';

const execFileAsync = promisify(execFile);

class FixtureRepo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<FixtureRepo> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new FixtureRepo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'cfg@warpline.test');
    await r.git('config', 'user.name', 'Warpline Cfg');
    await r.git('config', 'commit.gpgsign', 'false');
    return r;
  }
  git = async (...args: string[]): Promise<string> =>
    (await execFileAsync('git', args, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();
  async file(rel: string, body: string): Promise<void> {
    const full = path.join(this.dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body, 'utf8');
  }
  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }
  async branchFrom(name: string, edit: () => Promise<void>): Promise<void> {
    await this.git('checkout', '-q', 'base');
    await this.git('checkout', '-q', '-b', name);
    await edit();
    await this.commitAll(name);
  }
  destroy = (): Promise<void> => fs.rm(this.dir, { recursive: true, force: true });
}

const BASE_PKG = `{
  "name": "fix",
  "version": "1.0.0",
  "dependencies": {
    "mmm": "1.0.0"
  }
}
`;
// A adds "alpha" ABOVE mmm; B adds "zeta" BELOW mmm — disjoint byte regions so
// the token merge composes; the MEANING verdict is what's under test either way.
const PKG_A = BASE_PKG.replace(
  '"dependencies": {\n',
  '"dependencies": {\n    "alpha": "1.0.0",\n',
);
const PKG_B = BASE_PKG.replace(
  '"mmm": "1.0.0"\n',
  '"mmm": "1.0.0",\n    "zeta": "9.9.9"\n',
);
const UTIL = 'export function foo() { return 1; }\n';

describe('CFG-MERGE — meaning verdicts where agents actually collide', () => {
  let repo: FixtureRepo;

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-cfg-merge-');
    await repo.file('package.json', BASE_PKG);
    await repo.file('package-lock.json', '{"lockfileVersion": 3, "state": "base"}\n');
    await repo.file('README.md', 'hello\n');
    await repo.file('src/util.ts', UTIL);
    await repo.commitAll('base');

    // branchA: add dep alpha + regenerate lockfile + edit the TS file.
    await repo.branchFrom('branchA', async () => {
      await repo.file('package.json', PKG_A);
      await repo.file('package-lock.json', '{"lockfileVersion": 3, "state": "A"}\n');
      await repo.file('src/util.ts', UTIL.replace('return 1', 'return 10'));
    });
    // branchB: add dep zeta + regenerate lockfile DIFFERENTLY + edit README.
    await repo.branchFrom('branchB', async () => {
      await repo.file('package.json', PKG_B);
      await repo.file('package-lock.json', '{"lockfileVersion": 3, "state": "B"}\n');
      await repo.file('README.md', 'hello world\n');
    });
    // version-KNOT branches: the SAME dep bumped to DIFFERENT versions.
    await repo.branchFrom('bumpA', async () => {
      await repo.file('package.json', BASE_PKG.replace('"mmm": "1.0.0"', '"mmm": "2.0.0"'));
    });
    await repo.branchFrom('bumpB', async () => {
      await repo.file('package.json', BASE_PKG.replace('"mmm": "1.0.0"', '"mmm": "3.0.0"'));
    });
    await repo.git('checkout', '-q', 'base');
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('DETERMINISM — absorbing a json-bearing ref twice yields byte-identical stateIds, cfg units present', async () => {
    const s1 = await absorb('base', { cwd: repo.dir });
    const s2 = await absorb('base', { cwd: repo.dir });
    expect(s1.stateId).toBe(s2.stateId);
    const cfgSyms = Array.from(s1.objects.keys()).filter((s) => s.startsWith('#cfg:'));
    expect(cfgSyms).toContain('#cfg:package.json::/dependencies/mmm');
    // the lockfile is DERIVED — never lifted
    expect(cfgSyms.some((s) => s.includes('package-lock.json'))).toBe(false);
  });

  it('DEP-ADD — two different deps COMMUTE: a meaning autoClean verdict, zero knots', async () => {
    const base = await absorb('base', { cwd: repo.dir });
    const a = await absorb('branchA', { cwd: repo.dir });
    const b = await absorb('branchB', { cwd: repo.dir });
    const pred = predict(diff(base, a), diff(base, b));
    expect(pred.knots).toEqual([]);
    expect(pred.dangling).toEqual([]);
    // both born dep units are in the clean set (autoClean is keyed by the
    // opaque stableKey — resolve to readable names via the states).
    const keyToName = new Map<string, string>();
    for (const st of [a, b]) for (const o of st.objects.values()) keyToName.set(o.stableKey, o.symbol);
    const cleanNames = pred.autoClean.map((k) => keyToName.get(k));
    expect(cleanNames).toContain('#cfg:package.json::/dependencies/alpha');
    expect(cleanNames).toContain('#cfg:package.json::/dependencies/zeta');
  });

  it('DEP-KNOT — the same dep at different versions KNOTS on exactly that key unit', async () => {
    const base = await absorb('base', { cwd: repo.dir });
    const a = await absorb('bumpA', { cwd: repo.dir });
    const b = await absorb('bumpB', { cwd: repo.dir });
    const pred = predict(diff(base, a), diff(base, b));
    expect(pred.knots).toHaveLength(1);
    expect(pred.knots[0].symbol).toBe('#cfg:package.json::/dependencies/mmm');
    expect(pred.knots[0].conflictingSlots).toContain('body');
  });

  it('E2E ADMIT — CLEAN dep-add merge SEALS; lockfile take-either + STALE; honesty labels counted', async () => {
    const root = repo.dir;
    const g = await recordPick(root, { cwd: root, ref: 'base', intent: 'genesis' });
    expect(g.isGenesis).toBe(true);
    forkScratch(root, 'B');

    const ra = await admit(root, { cwd: root, agentId: 'A', ref: 'branchA' });
    expect(ra.decision.status).toBe('FAST_ADMIT');
    expect(ra.sealed).toBe(true);

    const rb = await admit(root, { cwd: root, agentId: 'B', ref: 'branchB' });
    // The MEANING verdict: concurrent dep-adds commute.
    expect(rb.decision.status).toBe('CLEAN');
    expect(rb.sealed).toBe(true);
    expect(rb.merged?.conflicts).toEqual([]);
    // LOCKFILE — both sides regenerated it divergently: never a knot; taken from
    // OURS (agent B's bytes) and marked STALE for regeneration.
    expect(rb.merged?.derivedStale).toEqual(['package-lock.json']);
    const lock = rb.merged?.files.get('package-lock.json');
    expect(lock?.content.toString('utf8')).toContain('"state": "B"');
    // HONESTY LABELS — per-path + aggregate counts (the coverage metric).
    expect(rb.coverage).toBeDefined();
    const byPath = new Map(rb.coverage!.perPath.map((p) => [p.path, p.decidedBy]));
    expect(byPath.get('package.json')).toBe('meaning-decided');
    expect(byPath.get('src/util.ts')).toBe('meaning-decided');
    expect(byPath.get('README.md')).toBe('byte-decided');
    expect(byPath.get('package-lock.json')).toBe('derived');
    expect(rb.coverage!.counts).toEqual({ meaningDecided: 2, byteDecided: 1, derived: 1 });
    // the merged bytes carry BOTH new deps — the merge actually happened
    const mergedPkg = rb.merged?.files.get('package.json')?.content.toString('utf8') ?? '';
    expect(mergedPkg).toContain('"alpha"');
    expect(mergedPkg).toContain('"zeta"');
    expect(rb.strand?.merged).toBe(true);
  });

  it('E2E ORACLE — the record carries the same honesty labels (additive field)', async () => {
    const rec = await oracle('branchA', 'branchB', { cwd: repo.dir, noWrite: true });
    expect(rec.prediction.knots).toEqual([]);
    expect(rec.coverage).toBeDefined();
    const byPath = new Map(rec.coverage!.perPath.map((p) => [p.path, p.decidedBy]));
    expect(byPath.get('package.json')).toBe('meaning-decided');
    expect(byPath.get('src/util.ts')).toBe('meaning-decided');
    expect(byPath.get('README.md')).toBe('byte-decided');
    expect(byPath.get('package-lock.json')).toBe('derived');
    expect(rec.coverage!.counts).toEqual({ meaningDecided: 2, byteDecided: 1, derived: 1 });
  });
});

describe('CFG-MERGE — the pure-TS determinism PIN (stateIds must not move)', () => {
  // Captured on the PRE-cfg-lens baseline (warpline-surfaces @ 387-green) with
  // this EXACT fixture. The cfg lens must not move a tree with no json/yaml.
  const PINNED_STATE_ID =
    'state:v0:4a4b463bf369eb455747cb21e44ce0afcae46a2a7e186c2d07825a702c7cde3a';

  const FILES: Record<string, string> = {
    'src/alpha.ts': `export function alpha(): number { return beta() + 1; }
export function beta(): number { return 2; }
`,
    'src/gamma.ts': `import { alpha } from './alpha.js';
export const gamma = () => alpha() * 3;
`,
    'src/dir/.purpose': `# purpose
component: pin-fixture
description: determinism pin fixture
`,
  };

  let repo: FixtureRepo;

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-cfg-pin-');
    for (const [rel, body] of Object.entries(FILES)) await repo.file(rel, body);
    await repo.commitAll('pin');
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('a pure-TS fixture absorbs to the BASELINE stateId, byte-identical', async () => {
    const state = await absorb('base', { cwd: repo.dir });
    expect(state.stateId).toBe(PINNED_STATE_ID);
    // and no cfg units were injected (nothing to lift)
    for (const sym of state.objects.keys()) expect(sym.startsWith('#cfg:')).toBe(false);
  });

  it('adding a json file MOVES the stateId (cfg units are new meaning) — deterministically', async () => {
    await repo.git('checkout', '-q', 'base');
    await repo.git('checkout', '-q', '-b', 'withjson');
    await repo.file('config.json', '{"mode": "fast"}\n');
    await repo.commitAll('withjson');
    const s1 = await absorb('withjson', { cwd: repo.dir });
    const s2 = await absorb('withjson', { cwd: repo.dir });
    expect(s1.stateId).not.toBe(PINNED_STATE_ID);
    expect(s1.stateId).toBe(s2.stateId);
    expect(Array.from(s1.objects.keys())).toContain('#cfg:config.json::/mode');
  });
});
