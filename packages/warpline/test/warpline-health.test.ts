/**
 * warpline-health.test — the read-only diagnostic (#warpline-health).
 *
 * What is pinned, and why each pin can actually fail:
 *
 *  1. IT WRITES NOTHING. `.warpline/` is hashed file-by-file before and after.
 *     Audit C-13 was found on a full disk, where a diagnostic that writes is a
 *     diagnostic you cannot run — so this is the load-bearing property, not a
 *     nicety, and it is checked by digest rather than by inspection.
 *  2. THE HOOK REPLICATION IS BOUND TO THE HOOK. health cannot import the hook's
 *     shell block (it is a private function), so it replicates three literals.
 *     The test asserts those literals appear VERBATIM in the text `installHook`
 *     ACTUALLY WRITES — authority = hook.ts's generated block, derived =
 *     health's constants. Editing either side breaks it.
 *  3. THE ARMS ARE EXERCISED AGAINST REALITY, not asserted. A repo with no
 *     `warpline` on PATH and no dist resolves to 'none' AND is reported UNSOUND;
 *     put a real executable on PATH and the same repo resolves to 'path'.
 *  4. SEAL LIVENESS IS GROUND-TRUTHED. The fixture makes exactly three commits
 *     after the last seal and the report must say three.
 *  5. THE COUNTERFACTUAL CENSUS HAS THREE BUCKETS. measured / explicitly-
 *     unavailable / predates-the-field. Collapsing the third into a zero is the
 *     C-9 mistake this project already made once, one field over.
 *  6. MB-PER-STRAND IS PER STRAND. A fixture with several strands must report a
 *     number strictly below the total — the discriminator against "shipped the
 *     total and called it per-strand".
 *  7. A TORN LEDGER IS REPORTED, NOT THROWN, and exits 2.
 *  8. GREEN IS REACHABLE. Exit 0 is produced by a real repo that is migrated,
 *     hooked, current, and has measured a contested verdict against git — so
 *     "warnings" is a finding about the project, not a permanent property of the
 *     verb.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { recordPick } from '../src/fabric/pick.js';
import { forkScratch } from '../src/fabric/scratch.js';
import { shadowAdmit, appendShadowVerdict, type ShadowVerdictRow } from '../src/fabric/shadow.js';
import { installHook } from '../src/fabric/hook.js';
import { migrateSelvageToRefs } from '../src/fabric/refs.js';
import { warplineDirOf } from '../src/fabric/fabric.js';
import {
  health,
  healthExitCode,
  HOOK_BIN_ENV,
  HOOK_DEFAULT_BIN,
  HOOK_DIST_FALLBACK,
} from '../src/health.js';

const execFileAsync = promisify(execFile);
const scratch: string[] = [];

/**
 * A PATH containing `dirs` and NOTHING ELSE except the directory git lives in.
 *
 * Emptying PATH outright is what the first draft did, and it silently broke
 * `git rev-parse --git-path` too — which is how health's "hook state unknown,
 * and then say nothing about it" hole was found. Keep git; remove `warpline`.
 */
const GIT_DIR = path.dirname(
  (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((d) => path.join(d, 'git'))
    .find((p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    }) ?? '/usr/bin/git',
);
const pathWithout = (...dirs: string[]): string => [...dirs, GIT_DIR].join(path.delimiter);

afterEach(async () => {
  // the machine is tight on disk — nothing survives a test
  await Promise.all(scratch.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })));
});

async function tmpdir(prefix: string): Promise<string> {
  const d = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  scratch.push(d);
  return d;
}

class Repo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<Repo> {
    const dir = await tmpdir(prefix);
    const r = new Repo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'health@warpline.test');
    await r.git('config', 'user.name', 'Warpline Health');
    await r.git('config', 'commit.gpgsign', 'false');
    await r.write('.gitignore', '.warpline/\n');
    return r;
  }
  git = async (...a: string[]): Promise<string> =>
    (await execFileAsync('git', a, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();
  async write(rel: string, body: string): Promise<void> {
    const full = path.join(this.dir, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, body, 'utf8');
  }
  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }
}

/** sha256 of every file under a dir, path→hash. */
function digest(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, rel: string): void => {
    let names: string[];
    try {
      names = fs.readdirSync(d);
    } catch {
      return;
    }
    for (const name of names.sort()) {
      const r = rel ? `${rel}/${name}` : name;
      const full = path.join(d, name);
      const st = fs.lstatSync(full);
      if (st.isDirectory()) walk(full, r);
      else if (st.isFile()) out[r] = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  };
  walk(dir, '');
  return out;
}

const TIGHT = (v: string): string => `export function tight(): number {\n  return ${v};\n}\n`;
const WIDE = (first: string, tail: string): string =>
  `export function wide(a: number, b: number): number {\n` +
  `  const one = ${first};\n  const two = b + 1;\n  const three = one + two;\n` +
  `  const four = three * 2;\n  const five = four - 1;\n  const six = five + 0;\n` +
  `  const seven = six + 0;\n  return ${tail};\n}\n`;

/* ─────────────────────────── 1. it writes nothing ──────────────────────────── */

describe('#warpline-health — writes nothing', () => {
  it('.warpline is byte-identical across a full health run (incl. no f4 trace row)', async () => {
    const repo = await Repo.create('warpline-health-ro-');
    await repo.write('src/tight.ts', TIGHT('1'));
    await repo.commitAll('base');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'base', intent: 'genesis' });
    await shadowAdmit(repo.dir, { cwd: repo.dir, agentId: 'a', ref: 'base' });

    const before = digest(warplineDirOf(repo.dir));
    expect(Object.keys(before).length).toBeGreaterThan(0);

    const report = await health(repo.dir);
    expect(report.schemaVersion).toBe('health:v1');

    const after = digest(warplineDirOf(repo.dir));
    expect(after).toEqual(before);
    // the f4 trace stream is the specific thing a `traceCli` wrapper would add
    expect(fs.existsSync(path.join(warplineDirOf(repo.dir), 'f4'))).toBe(false);
  }, 180_000);
});

/* ───────────────────── 2 & 3. hook reachability, for real ──────────────────── */

describe('#warpline-health — hook reachability (the silent-failure check)', () => {
  it('the replicated literals are the HOOK\'s own — asserted against the text installHook writes', async () => {
    const dir = await tmpdir('warpline-health-hooktext-');
    const hookPath = path.join(dir, 'post-commit');
    installHook(hookPath);
    const text = fs.readFileSync(hookPath, 'utf8');

    // AUTHORITY: hook.ts's generated block. DERIVED: health's three constants.
    expect(text).toContain(HOOK_BIN_ENV);
    expect(text).toContain(HOOK_DEFAULT_BIN);
    expect(text).toContain(HOOK_DIST_FALLBACK);
    // …and the shape health replicates: PATH probe first, dist fallback second.
    expect(text.indexOf('command -v')).toBeLessThan(text.indexOf(HOOK_DIST_FALLBACK));
  });

  it("arm 'none' — the block is installed and resolves to NOTHING (UNSOUND, exit 2)", async () => {
    const repo = await Repo.create('warpline-health-arm-none-');
    await repo.write('src/tight.ts', TIGHT('1'));
    await repo.commitAll('base');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'base', intent: 'genesis' });
    installHook(path.join(repo.dir, '.git', 'hooks', 'post-commit'));

    const savedPath = process.env.PATH;
    process.env.PATH = pathWithout(await tmpdir('warpline-health-nowl-')); // git yes, `warpline` no
    try {
      const r = await health(repo.dir);
      expect(r.hook.state).toBe('installed');
      expect(r.hook.arm).toBe('none');
      expect(r.hook.resolved).toBeNull();
      expect(r.unsound.join('\n')).toContain('resolves to nothing');
      expect(healthExitCode(r)).toBe(2);
    } finally {
      process.env.PATH = savedPath;
    }
  }, 180_000);

  it("arm 'path' — putting a real executable named `warpline` on PATH flips the same repo", async () => {
    const repo = await Repo.create('warpline-health-arm-path-');
    await repo.write('src/tight.ts', TIGHT('1'));
    await repo.commitAll('base');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'base', intent: 'genesis' });
    installHook(path.join(repo.dir, '.git', 'hooks', 'post-commit'));

    const bin = await tmpdir('warpline-health-bin-');
    const shim = path.join(bin, HOOK_DEFAULT_BIN);
    fs.writeFileSync(shim, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(shim, 0o755);

    const savedPath = process.env.PATH;
    process.env.PATH = pathWithout(bin);
    try {
      const r = await health(repo.dir);
      expect(r.hook.state).toBe('installed');
      expect(r.hook.arm).toBe('path');
      expect(r.hook.resolved).toBe(shim);
      expect(r.unsound).toEqual([]);
    } finally {
      process.env.PATH = savedPath;
    }
  }, 180_000);

  /**
   * The fourth arm of the state switch. It was the branch carrying a DEAD
   * conjunct (`state !== 'unknown'`, already consumed one branch up) and it had
   * no test — the two facts are the same fact. A hook that was never installed
   * drifts behind HEAD exactly as silently as one that cannot resolve.
   */
  it("state 'absent' — no block installed at all is still a warning, not silence", async () => {
    const repo = await Repo.create('warpline-health-nohook-');
    await repo.write('src/tight.ts', TIGHT('1'));
    await repo.commitAll('base');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'base', intent: 'genesis' });
    // deliberately NOT installing the hook

    const r = await health(repo.dir);
    expect(r.hook.state).toBe('absent');
    expect(r.unsound).toEqual([]);
    expect(r.warnings.join('\n')).toContain('auto-seal hook is not installed');
  }, 180_000);

  it("arm 'dist' — the monorepo fallback wins when nothing is on PATH, and is WARNED about", async () => {
    const repo = await Repo.create('warpline-health-arm-dist-');
    await repo.write('src/tight.ts', TIGHT('1'));
    await repo.commitAll('base');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'base', intent: 'genesis' });
    installHook(path.join(repo.dir, '.git', 'hooks', 'post-commit'));
    // the exact path the hook's second arm names, relative to the repo root
    const dist = path.join(repo.dir, HOOK_DIST_FALLBACK);
    fs.mkdirSync(path.dirname(dist), { recursive: true });
    fs.writeFileSync(dist, '// build artifact\n');

    const savedPath = process.env.PATH;
    process.env.PATH = pathWithout(await tmpdir('warpline-health-nowl2-'));
    try {
      const r = await health(repo.dir);
      expect(r.hook.arm).toBe('dist');
      expect(r.hook.resolved).toContain(HOOK_DIST_FALLBACK);
      expect(r.unsound).toEqual([]); // reachable — but only here
      expect(r.warnings.join('\n')).toContain('DIST FALLBACK');
    } finally {
      process.env.PATH = savedPath;
    }
  }, 180_000);
});

/* ───────────────────────────── 4. seal liveness ────────────────────────────── */

describe('#warpline-health — seal liveness', () => {
  it('reports EXACTLY the number of commits made since the last seal', async () => {
    const repo = await Repo.create('warpline-health-behind-');
    await repo.write('src/tight.ts', TIGHT('1'));
    await repo.commitAll('base');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'genesis' });
    const sealedAt = await repo.git('rev-parse', 'HEAD');

    for (const n of [2, 3, 4]) {
      await repo.write('src/tight.ts', TIGHT(String(n)));
      await repo.commitAll(`commit ${n}`);
    }

    const r = await health(repo.dir);
    expect(r.seal.lastGitCommit).toBe(sealedAt);
    expect(r.seal.commitsBehindHead).toBe(3); // ground truth: the fixture made 3
    expect(r.seal.behindUnknown).toBeNull();
    expect(r.warnings.join('\n')).toContain('3 git commit(s) behind HEAD');
  }, 180_000);
});

/* ──────────────────── 5. the counterfactual census: 3 buckets ──────────────── */

describe('#warpline-health — the adjudication census', () => {
  it('separates MEASURED, explicitly-UNAVAILABLE and PREDATES-THE-FIELD', async () => {
    const repo = await Repo.create('warpline-health-census-');
    await repo.write('src/tight.ts', TIGHT('1'));
    await repo.commitAll('base');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'base', intent: 'genesis' });

    // (a) MEASURED — a real ref on both sides, so git actually decided.
    await repo.git('checkout', '-q', '-b', 'sideA');
    await repo.write('src/tight.ts', TIGHT('9'));
    await repo.commitAll('sideA');
    await repo.git('checkout', '-q', 'base');
    await shadowAdmit(repo.dir, { cwd: repo.dir, agentId: 'a', ref: 'sideA' });

    // (b) UNAVAILABLE — a WORKTREE proposal has no commit to merge.
    await repo.write('src/tight.ts', TIGHT('5'));
    await shadowAdmit(repo.dir, { cwd: repo.dir, agentId: 'a', ref: 'WORKTREE' });

    // (c) PREDATES THE FIELD — a legacy row, which no code produces any more.
    //     Only a hand-written row can reach this state, and it MUST NOT be
    //     counted as "git said nothing" (audit C-9's exact mistake).
    const legacy = {
      schemaVersion: 'shadowVerdict:v1',
      ts: new Date().toISOString(),
      ref: 'base',
      agentId: 'legacy',
      status: 'FAST_ADMIT',
      confidence: null,
      knots: [],
      agentChanged: [],
      otherChanged: [],
      coverage: null,
      wouldSeal: true,
      proposedStateId: 'state:v0:legacy',
      durationMs: 1,
    } as unknown as ShadowVerdictRow;
    appendShadowVerdict(repo.dir, legacy);

    const r = await health(repo.dir);
    const cf = r.adjudication.counterfactual;
    expect(r.adjudication.verdicts).toBe(3);
    expect(cf.measured).toBe(1);
    expect(cf.unavailable['worktree-ref']).toBe(1);
    expect(cf.predatesField).toBe(1);
    // the three buckets partition the stream — nothing is silently dropped
    expect(cf.measured + cf.predatesField + Object.values(cf.unavailable).reduce((a, b) => a + (b ?? 0), 0)).toBe(3);
    expect(cf.cells.agreeClean).toBe(1);
    expect(r.warnings.join('\n')).toContain('ZERO contested verdicts');
  }, 180_000);
});

/* ─────────────────────────────── 6. disk ───────────────────────────────────── */

describe('#warpline-health — disk is reported PER STRAND', () => {
  it('mbPerStrand is strictly below the total, and null on an empty fabric', async () => {
    const empty = await Repo.create('warpline-health-disk-empty-');
    const e = await health(empty.dir);
    expect(e.fabric.strands).toBe(0);
    expect(e.disk.mbPerStrand).toBeNull(); // never a 0-division, never a "0 MB" lie

    const repo = await Repo.create('warpline-health-disk-');
    await repo.write('src/tight.ts', TIGHT('1'));
    // Ballast, so the MB figures are far from the 2-decimal rounding floor: a
    // few-KB fixture makes "total" and "per strand" BOTH round to ~0.00 and the
    // discriminator below would pass for the wrong reason. It must be
    // INCOMPRESSIBLE — the object store deflates, and 512 KB of 'x' lands as
    // ~500 bytes, which is how the first draft of this fixture failed.
    await repo.write('assets/ballast.txt', randomBytes(1_500_000).toString('base64'));
    await repo.commitAll('base');
    for (const n of [2, 3, 4]) {
      await repo.write('src/tight.ts', TIGHT(String(n)));
      await repo.commitAll(`c${n}`);
      await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: `seal ${n}` });
    }
    const r = await health(repo.dir);
    const strands = r.fabric.strands;
    expect(strands).toBeGreaterThanOrEqual(3);
    expect(r.disk.bytes).toBeGreaterThan(1_048_576); // the figures are in real MB territory
    expect(r.disk.files).toBeGreaterThan(0);
    // THE discriminator against "shipped the total and labelled it per-strand":
    // the per-strand number must be a FACTOR OF `strands` smaller than the total,
    // not merely different from it.
    const totalMb = r.disk.bytes / 1_048_576;
    expect(r.disk.mbPerStrand!).toBeLessThan(totalMb / (strands - 0.5));
    expect(r.disk.mbPerStrand!).toBeGreaterThan(0);
    expect(r.disk.largest.length).toBeGreaterThan(0);
  }, 180_000);
});

/* ─────────────────── 7. a torn ledger is reported, not thrown ──────────────── */

describe('#warpline-health — survives what it diagnoses', () => {
  it('a torn tail line (C-13) is REPORTED as unsound and exits 2, without throwing', async () => {
    const repo = await Repo.create('warpline-health-torn-');
    await repo.write('src/tight.ts', TIGHT('1'));
    await repo.commitAll('base');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'base', intent: 'genesis' });
    fs.appendFileSync(path.join(warplineDirOf(repo.dir), 'fabric.jsonl'), '{"schemaVersion":2,"pick', 'utf8');

    const r = await health(repo.dir); // must not throw — `readFabric` would have
    expect(r.fabric.malformedLines).toBe(1);
    expect(r.unsound.join('\n')).toContain('malformed ledger line');
    expect(healthExitCode(r)).toBe(2);
  }, 180_000);
});

/* ───────────────────────────── 8. green is reachable ───────────────────────── */

describe('#warpline-health — green is reachable', () => {
  it('exit 0 on a repo that is migrated, hooked, current, and MEASURING a contested verdict', async () => {
    const repo = await Repo.create('warpline-health-green-');
    await repo.write('src/wide.ts', WIDE('a + 1', 'seven'));
    await repo.commitAll('base');
    await repo.git('checkout', '-q', '-b', 'sideA');
    await repo.write('src/wide.ts', WIDE('a + 100', 'seven'));
    await repo.commitAll('sideA');
    await repo.git('checkout', '-q', 'base');
    await repo.git('checkout', '-q', '-b', 'sideB');
    await repo.write('src/wide.ts', WIDE('a + 1', 'seven * 3'));
    await repo.commitAll('sideB');
    await repo.git('checkout', '-q', 'base');

    await recordPick(repo.dir, { cwd: repo.dir, ref: 'base', intent: 'genesis' });
    forkScratch(repo.dir, 'agent');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'sideA', intent: 'advance' });
    const { row } = await shadowAdmit(repo.dir, { cwd: repo.dir, agentId: 'agent', ref: 'sideB' });
    expect(row.status).toBe('KNOT');
    expect(row.gitCounterfactual!.cell).toBe('divergeMeaningOnly');

    migrateSelvageToRefs(warplineDirOf(repo.dir));
    installHook(path.join(repo.dir, '.git', 'hooks', 'post-commit'));
    const bin = await tmpdir('warpline-health-green-bin-');
    const shim = path.join(bin, HOOK_DEFAULT_BIN);
    fs.writeFileSync(shim, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(shim, 0o755);

    const savedPath = process.env.PATH;
    process.env.PATH = pathWithout(bin);
    try {
      const r = await health(repo.dir);
      expect(r.unsound, `unsound: ${r.unsound.join(' | ')}`).toEqual([]);
      expect(r.warnings, `warnings: ${r.warnings.join(' | ')}`).toEqual([]);
      expect(healthExitCode(r)).toBe(0);
      expect(r.fabric.refsMode).toBe('refs');
      expect(r.adjudication.contested).toBe(1);
      expect(r.adjudication.counterfactual.measured).toBe(1);
      expect(r.adjudication.counterfactual.cells.divergeMeaningOnly).toBe(1);
    } finally {
      process.env.PATH = savedPath;
    }
  }, 180_000);
});
