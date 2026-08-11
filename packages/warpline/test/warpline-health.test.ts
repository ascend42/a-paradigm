/**
 * warpline-health.test — the read-only diagnostic (#warpline-health).
 *
 * What is pinned, and why each pin can actually fail:
 *
 *  1. IT WRITES NOTHING. `.warpline/` is hashed file-by-file before and after.
 *     Audit C-13 was found on a full disk, where a diagnostic that writes is a
 *     diagnostic you cannot run — so this is the load-bearing property, not a
 *     nicety, and it is checked by digest rather than by inspection.
 *  2. THE HOOK REPLICATION IS BOUND TO THE HOOK'S RESOLUTION OPERANDS. health
 *     cannot import the hook's shell block (it is a private function), so it
 *     replicates three literals. THE PREDECESSOR OF THIS TEST WAS VACUOUS AND WAS
 *     CAUGHT (finding A2): it asserted the literals appeared SOMEWHERE in the
 *     generated text, and survived both renaming the binary AND deleting the
 *     entire dist-fallback arm, because the block names all three in its own
 *     comments and in the advice `echo`. It now parses the block's EXECUTABLE
 *     lines and asserts against what `command -v` and `[ -f … ]` actually test.
 *  3. THE ARMS ARE EXERCISED AGAINST REALITY, not asserted. A repo with no
 *     `warpline` on PATH and no dist resolves to 'none' AND is reported UNSOUND;
 *     put a real executable on PATH and the same repo resolves to 'path'.
 *  3b. THE ALARM SAYS WHAT TO TYPE (finding C2). `warpline` missing from PATH is
 *     a SETUP state, and outside this monorepo there is no dist fallback at all,
 *     so it is the likeliest way a first real project seals nothing. The remedy
 *     is DERIVED FROM DISK and pinned against disk facts, not against a sentence.
 *  3c. A NEW PROJECT IS NOT BORN C-1-EXPOSED (finding B5). The first health run
 *     after genesis must report refs mode, not ask for `refs migrate`.
 *  4. SEAL LIVENESS IS GROUND-TRUTHED. The fixture makes exactly three commits
 *     after the last seal and the report must say three.
 *  5. THE COUNTERFACTUAL CENSUS HAS THREE BUCKETS. measured / explicitly-
 *     unavailable / predates-the-field. Collapsing the third into a zero is the
 *     C-9 mistake this project already made once, one field over.
 *  5b. THE COVERAGE RATIO HAS A FLOOR, AND THE BOUNDARY IS WHAT IS TESTED
 *     (finding B3). The predecessor guard fired only at `measured === 0`, so one
 *     row silenced the primary metric forever — and 0%/100% cases would not have
 *     caught that, since both agree with the broken predicate. The cases straddle
 *     90%, and one of them rounds TO 90 while sitting below it.
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
import { installHook, hookRemedy, hookInstallAdvice } from '../src/fabric/hook.js';
import { migrateSelvageToRefs } from '../src/fabric/refs.js';
import { warplineDirOf } from '../src/fabric/fabric.js';
import {
  health,
  healthExitCode,
  HOOK_BIN_ENV,
  HOOK_DEFAULT_BIN,
  HOOK_DIST_FALLBACK,
  COUNTERFACTUAL_COVERAGE_MIN_PCT,
  type HealthReport,
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

/**
 * The generated hook block's EXECUTABLE lines: trimmed, blanks dropped, `#`
 * comments dropped, and `echo`-led lines dropped.
 *
 * The last two exclusions are the whole point (finding A2). The block documents
 * itself in prose and prints a paragraph of operator advice that NAMES the binary,
 * the env var and the dist path — so any assertion evaluated over the raw text is
 * satisfiable by the documentation alone. Only lines that the shell would actually
 * evaluate as resolution logic survive this filter.
 */
function shellLines(raw: string[]): string[] {
  return raw.map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#') && !l.startsWith('echo'));
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
  /**
   * WHY THIS PARSES INSTEAD OF SEARCHING (finding A2).
   *
   * The predecessor asserted that health's three literals appeared SOMEWHERE in
   * the text `installHook` writes, and an independent verifier proved it vacuous
   * with two mutations of hook.ts that it survived GREEN:
   *
   *   (i)  default bin `warpline` → `wl` AND env var `WARPLINE_BIN` → `WL_BIN`
   *   (ii) the ENTIRE dist-fallback arm deleted
   *
   * `warpline` occurs on eight lines of the generated block, `WARPLINE_BIN` on
   * five and the dist path on three — in prose comments and in the operator-advice
   * `echo`. So containment was satisfied by the block's DOCUMENTATION of itself,
   * not by the block. The ordering guard failed the same way: `indexOf` over the
   * whole text found the surviving copy inside the advice string, so it held even
   * with the arm it was ordering against gone.
   *
   * The fix asserts against the RESOLUTION OPERANDS — the shell variable the block
   * assigns and defaults, the operand `command -v` actually tests, the operand the
   * dist `[ -f … ]` actually tests, and the `node <dist>` value the winning
   * fallback assigns (which is verbatim what health reports as `resolved`). Each
   * must occur EXACTLY ONCE among the block's EXECUTABLE lines, so deleting an arm
   * fails on a count of zero instead of passing on a leftover mention.
   */
  it("health's three constants are bound to the hook's RESOLUTION OPERANDS, not to its prose", async () => {
    const dir = await tmpdir('warpline-health-hooktext-');
    const hookPath = path.join(dir, 'post-commit');
    installHook(hookPath);
    const lines = shellLines(fs.readFileSync(hookPath, 'utf8').split('\n'));

    // 1. THE DEFAULTING ASSIGNMENT — `WARPLINE_BIN="${WARPLINE_BIN:-warpline}"`.
    //    Both names health replicates are operands here: the variable the block
    //    resolves through, and the bare name it falls back to.
    const DEFAULTING = /^([A-Za-z_]\w*)="\$\{([A-Za-z_]\w*):-([^}]*)\}"$/;
    const defaulting = lines.filter((l) => DEFAULTING.test(l));
    expect(defaulting, `expected exactly one \${VAR:-default} assignment, got ${JSON.stringify(defaulting)}`).toHaveLength(1);
    const [, assignedVar, defaultedFrom, defaultName] = DEFAULTING.exec(defaulting[0])!;
    expect(assignedVar).toBe(HOOK_BIN_ENV);
    expect(defaultedFrom).toBe(HOOK_BIN_ENV);
    expect(defaultName).toBe(HOOK_DEFAULT_BIN);

    // 2. THE PATH PROBE — the operand of `command -v` must be the variable health
    //    reads, or health is probing a name the hook never resolves through.
    const probes = lines.filter((l) => l.includes('command -v'));
    expect(probes, `expected exactly one \`command -v\` probe, got ${JSON.stringify(probes)}`).toHaveLength(1);
    const probeOperand = /command -v\s+"?\$\{?([A-Za-z_]\w*)\}?"?/.exec(probes[0]);
    expect(probeOperand, `unparseable \`command -v\` operand in: ${probes[0]}`).not.toBeNull();
    expect(probeOperand![1]).toBe(HOOK_BIN_ENV);

    // 3. THE DIST EXISTENCE TEST, by the operand of `[ -f … ]`. The block contains
    //    a SECOND file test (the hook log), so this is a filter over operands and
    //    not a search for the string: deleting the fallback arm makes it ZERO.
    const fileTests = lines.flatMap((l, i) =>
      [...l.matchAll(/\[\s+-f\s+"([^"]+)"\s+\]/g)].map((m) => ({ line: i, operand: m[1] })),
    );
    const distTests = fileTests.filter((t) => t.operand.endsWith(`/${HOOK_DIST_FALLBACK}`));
    expect(
      distTests,
      `no \`[ -f … ]\` operand ends with ${HOOK_DIST_FALLBACK}; the block's file tests were ${JSON.stringify(fileTests)}`,
    ).toHaveLength(1);

    // 4. WHAT THE FALLBACK ARM ASSIGNS is verbatim what health reports as
    //    `resolved` for arm 'dist' (`node ${root}/${HOOK_DIST_FALLBACK}`).
    const DIST_ASSIGN = /^([A-Za-z_]\w*)="node \$([A-Za-z_]\w*)\/(.+)"$/;
    const distAssign = lines.filter((l) => DIST_ASSIGN.test(l));
    expect(distAssign, `expected exactly one \`node <dist>\` assignment, got ${JSON.stringify(distAssign)}`).toHaveLength(1);
    const [, distVar, , distRelPath] = DIST_ASSIGN.exec(distAssign[0])!;
    expect(distVar).toBe(HOOK_BIN_ENV);
    expect(distRelPath).toBe(HOOK_DIST_FALLBACK);

    // 5. ORDERING, over EXECUTABLE LINE INDICES — PATH probe first, dist second.
    //    The predecessor compared `indexOf` over the raw text, which is why it
    //    survived deleting the very arm it claimed to be ordering against.
    expect(lines.indexOf(probes[0])).toBeLessThan(distTests[0].line);
  });

  /**
   * THE CONTROL FOR THE TEST ABOVE, kept as its OWN test on purpose.
   *
   * The first draft put these three lines at the TOP of the operand test, and
   * under the rename mutation the test failed HERE — on the control — and never
   * reached a single operand assertion. A control that pre-empts the assertion it
   * is a control for teaches nothing about whether the assertion works, which is
   * the same shape of mistake as the vacuity it was added to guard against.
   *
   * What it pins: the PREMISE of the rewrite. Each literal genuinely occurs on
   * several RAW lines of the generated block — in prose and in the advice `echo` —
   * so `toContain` could not have failed, and the executable-line view is strictly
   * smaller than the raw one, i.e. the filter really removes something.
   */
  it('CONTROL: the three literals occur on MANY raw lines — which is why containment was not a test', async () => {
    const dir = await tmpdir('warpline-health-hookprose-');
    const hookPath = path.join(dir, 'post-commit');
    installHook(hookPath);
    const raw = fs.readFileSync(hookPath, 'utf8').split('\n');

    expect(raw.filter((l) => l.includes(HOOK_DEFAULT_BIN)).length).toBeGreaterThan(1);
    expect(raw.filter((l) => l.includes(HOOK_BIN_ENV)).length).toBeGreaterThan(1);
    expect(raw.filter((l) => l.includes(HOOK_DIST_FALLBACK)).length).toBeGreaterThan(1);
    expect(shellLines(raw).length).toBeLessThan(raw.length);
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

/* ────── 3c. a new project does not start C-1-exposed (finding B5, seen from health) ── */

/**
 * THE FOUNDER-VISIBLE SYMPTOM the finding was reported as: `pick --intent genesis`
 * on a fresh repo, then `health`, and the very first run said "legacy selvage mode
 * — per-ref CAS DISENGAGED (audit C-1). Run `warpline refs migrate`." The fix is
 * in seal.ts and pinned there; this is the reader's half — the assertion that the
 * SURFACE a new operator actually looks at agrees.
 */
describe('#warpline-health — a brand-new project is not born in legacy mode (finding B5)', () => {
  it('the first health run after genesis reports refs mode and does NOT ask for a migration', async () => {
    const repo = await Repo.create('warpline-health-genesis-refs-');
    await repo.write('src/tight.ts', TIGHT('1'));
    await repo.commitAll('base');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'base', intent: 'genesis' });

    const r = await health(repo.dir);
    expect(r.fabric.refsMode).toBe('refs');
    expect(Object.keys(r.fabric.refs)).toContain('selvage');
    expect(r.warnings.join('\n')).not.toContain('legacy selvage mode');
    expect(r.warnings.join('\n')).not.toContain('refs migrate');
    expect(r.unsound, `unsound: ${r.unsound.join(' | ')}`).toEqual([]);
  }, 180_000);
});

/* ─────────── 3b. the REMEDY: the diagnostic says what to type (C2) ─────────── */

/**
 * `warpline` not being on PATH is a SETUP state, not a code state, and outside
 * this monorepo there is no dist fallback at all — so it is the likeliest single
 * way a first real project runs fine and seals nothing. Making that AUDIBLE was
 * item 1; these pin that it is also ACTIONABLE.
 *
 * The remedy is asserted against DISK FACTS — does the directory it tells you to
 * `cd` into exist, does it change when the layout changes — not against a
 * hardcoded expected string, which would only pin that someone wrote a sentence.
 */
describe('#warpline-health — the hook remedy is DERIVED FROM DISK (finding C2)', () => {
  const plantPackage = (root: string, name: string): string => {
    const dir = path.join(root, 'packages', 'warpline');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name }), 'utf8');
    return dir;
  };

  it('in a warpline SOURCE checkout it names the real package directory and a local build+link', async () => {
    const root = await tmpdir('warpline-remedy-src-');
    const pkgDir = plantPackage(root, '@a-company/warpline');
    const remedy = hookRemedy(root);

    const cd = /^\(cd (.+?) && npm run build && npm link\)/.exec(remedy);
    expect(cd, `remedy was not the local build+link form: ${remedy}`).not.toBeNull();
    expect(cd![1]).toBe(pkgDir);
    // COPY-PASTEABLE means the path it hands you is a directory that EXISTS.
    expect(fs.existsSync(cd![1])).toBe(true);
  });

  it('outside one it does NOT invent a local build — it names the global install and the env escape hatch', async () => {
    const root = await tmpdir('warpline-remedy-nosrc-');
    const remedy = hookRemedy(root);
    expect(remedy).not.toContain('npm run build');
    expect(remedy).toContain('npm i -g @a-company/warpline');
    expect(remedy).toContain(HOOK_BIN_ENV);
  });

  /**
   * THE DISCRIMINATOR between "a directory called packages/warpline exists" and
   * "the warpline package is there". Telling an operator to run `npm run build`
   * inside somebody else's package is worse than saying nothing, so the detection
   * reads package.json's NAME. A directory-existence check would pass this test's
   * fixture and emit a command that fails.
   */
  it('CONTROL: a packages/warpline that is NOT the warpline package gets the generic remedy', async () => {
    const root = await tmpdir('warpline-remedy-impostor-');
    plantPackage(root, 'some-other-package');
    const remedy = hookRemedy(root);
    expect(remedy).not.toContain('npm run build');
    expect(remedy).toContain('npm i -g @a-company/warpline');
  });

  /** CONTROL: the two layouts must not produce the SAME string, or nothing is derived. */
  it('CONTROL: the remedy actually differs between the two layouts', async () => {
    const src = await tmpdir('warpline-remedy-cmp-src-');
    plantPackage(src, '@a-company/warpline');
    const bare = await tmpdir('warpline-remedy-cmp-bare-');
    expect(hookRemedy(src)).not.toBe(hookRemedy(bare));
  });

  it("the arm-'none' UNSOUND line carries that remedy verbatim — the alarm says what to type", async () => {
    const repo = await Repo.create('warpline-remedy-health-');
    await repo.write('src/tight.ts', TIGHT('1'));
    await repo.commitAll('base');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'base', intent: 'genesis' });
    installHook(path.join(repo.dir, '.git', 'hooks', 'post-commit'));

    const savedPath = process.env.PATH;
    process.env.PATH = pathWithout(await tmpdir('warpline-remedy-nowl-'));
    try {
      const r = await health(repo.dir);
      expect(r.hook.arm).toBe('none');
      // Binds the message to the remedy FUNCTION (whose content the tests above
      // pin against disk). What this catches is health emitting the alarm with no
      // remedy at all — the state the finding described.
      expect(r.unsound.join('\n')).toContain(`FIX: ${hookRemedy(repo.dir)}`);
    } finally {
      process.env.PATH = savedPath;
    }
  }, 180_000);

  /**
   * `hook install` WARNS LOUDLY AND DOES NOT REFUSE — the C2 design call, pinned
   * as behaviour rather than left in a comment. The advice text is a pure function
   * so this needs no CLI subprocess (and therefore no dist rebuild).
   */
  it('hook install ADVISES on an unresolvable binary and stays SILENT when it resolves', async () => {
    const root = await tmpdir('warpline-remedy-advice-');
    const none = hookInstallAdvice(root, { bin: HOOK_DEFAULT_BIN, arm: 'none', resolved: null });
    expect(none).not.toBeNull();
    expect(none!).toContain('WILL NOT REACH A BINARY');
    expect(none!).toContain(`FIX: ${hookRemedy(root)}`);
    expect(none!).toContain('warpline health'); // the re-askable, scriptable gate
    expect(none!).not.toMatch(/refus/i); // it advises; it does not refuse

    const dist = hookInstallAdvice(root, { bin: HOOK_DEFAULT_BIN, arm: 'dist', resolved: 'node /x/dist/cli.js' });
    expect(dist!).toContain('DIST FALLBACK');

    // THE OTHER HALF OF THE CALL: a hook that DOES resolve must say nothing, or
    // the advice becomes noise on every install and stops being read.
    expect(hookInstallAdvice(root, { bin: HOOK_DEFAULT_BIN, arm: 'path', resolved: '/usr/local/bin/warpline' })).toBeNull();
    expect(hookInstallAdvice(root, { bin: 'wl', arm: 'env-bin', resolved: '/opt/wl' })).toBeNull();
  });
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

/* ───────────── 5b. the counterfactual COVERAGE RATIO and its floor ─────────── */

/**
 * Rows shaped just enough for `adjudicationOf`. The census reads three fields —
 * status, baseFrom and gitCounterfactual — so these are hand-written rather than
 * produced by 100 real admissions: the property under test is the ARITHMETIC of
 * the ratio and the placement of its threshold, and driving it through a hundred
 * git merges would test git.
 */
const MEASURED_CF = {
  unavailable: null,
  ours: 'a'.repeat(40),
  theirs: 'b'.repeat(40),
  gitConflicted: false,
  cell: 'agreeClean',
  conflictPaths: [],
  conflictPathsTotal: 0,
  durationMs: 1,
};
const UNAVAILABLE_CF = {
  unavailable: 'worktree-ref',
  ours: null,
  theirs: null,
  gitConflicted: null,
  cell: null,
  conflictPaths: [],
  conflictPathsTotal: 0,
  durationMs: 0,
};

/** Append `measured` + `unavailable` + `predates` shadow rows to a bare root. */
function seedVerdicts(
  root: string,
  spec: { measured?: number; unavailable?: number; predates?: number },
): void {
  let n = 0;
  const push = (cf: unknown | null): void => {
    appendShadowVerdict(root, {
      schemaVersion: 'shadowVerdict:v1',
      ts: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
      ref: 'base',
      agentId: 'a',
      status: 'FAST_ADMIT',
      baseFrom: 'scratch',
      confidence: null,
      knots: [],
      agentChanged: [],
      otherChanged: [],
      coverage: null,
      wouldSeal: true,
      proposedStateId: `state:v0:${String(n++).padStart(4, '0')}`,
      durationMs: 1,
      // A row that PREDATES the field carries no key at all — the third state.
      ...(cf === null ? {} : { gitCounterfactual: cf }),
    } as unknown as ShadowVerdictRow);
  };
  for (let i = 0; i < (spec.measured ?? 0); i++) push(MEASURED_CF);
  for (let i = 0; i < (spec.unavailable ?? 0); i++) push(UNAVAILABLE_CF);
  for (let i = 0; i < (spec.predates ?? 0); i++) push(null);
}

const coverageWarning = (r: HealthReport): string | undefined =>
  r.warnings.find((w) => w.startsWith('git-counterfactual coverage is'));
const allPredateWarning = (r: HealthReport): string | undefined =>
  r.warnings.find((w) => w.includes('PREDATE the counterfactual field'));

/**
 * WHAT THIS REPLACES. The guard was `verdicts > 0 && measured === 0`: it fired at
 * the ZERO END and nowhere else, so a single measured row silenced the primary
 * metric permanently — and on the live fabric it already had. A test written
 * against 0% and 100% would not have caught that either; both ends agree with the
 * broken predicate. So the cases below straddle the FLOOR, and one of them
 * (269/299) is chosen because it ROUNDS to the floor while sitting below it.
 *
 * These fixtures are bare temp roots with no git and no fabric: the ratio is a
 * function of the shadow stream alone, and the report's other warnings (unknown
 * hook, zero contested) are irrelevant to it, so each assertion selects the
 * coverage warning by name rather than reading `warnings` as a whole.
 */
describe('#warpline-health — the counterfactual COVERAGE RATIO (finding B3)', () => {
  it(`the floor is ${COUNTERFACTUAL_COVERAGE_MIN_PCT}% — the cases below are written against that number`, () => {
    expect(COUNTERFACTUAL_COVERAGE_MIN_PCT).toBe(90);
  });

  const CASES: Array<{ what: string; measured: number; unavailable: number; pct: number; warns: boolean }> = [
    { what: '0% — nothing measured at all', measured: 0, unavailable: 100, pct: 0, warns: true },
    { what: '1% — ONE measured row must NOT disarm the alarm (the exact B3 defect)', measured: 1, unavailable: 99, pct: 1, warns: true },
    { what: '50% — half the adjudications never got a git answer', measured: 50, unavailable: 50, pct: 50, warns: true },
    { what: '89% — one point BELOW the floor', measured: 89, unavailable: 11, pct: 89, warns: true },
    { what: '90% — exactly AT the floor', measured: 90, unavailable: 10, pct: 90, warns: false },
    { what: '91% — above the floor', measured: 91, unavailable: 9, pct: 91, warns: false },
  ];

  for (const c of CASES) {
    it(`${c.what} ⇒ ${c.warns ? 'WARNS' : 'silent'}`, async () => {
      const root = await tmpdir('warpline-health-cov-');
      seedVerdicts(root, { measured: c.measured, unavailable: c.unavailable });
      const r = await health(root);
      const cf = r.adjudication.counterfactual;

      expect(cf.measured).toBe(c.measured);
      expect(cf.measurable).toBe(c.measured + c.unavailable);
      expect(cf.coveragePct).toBe(c.pct);
      if (c.warns) {
        expect(coverageWarning(r), `expected a coverage warning at ${c.pct}%`).toBeDefined();
        expect(coverageWarning(r)).toContain(`${c.measured} of ${cf.measurable} MEASURABLE`);
      } else {
        expect(coverageWarning(r), `expected NO coverage warning at ${c.pct}%`).toBeUndefined();
      }
    }, 60_000);
  }

  /**
   * THE DISCRIMINATOR AGAINST COMPARING THE ROUNDED PERCENT. 269/299 is 89.9665%,
   * which `toFixed(1)` renders as "90.0" — so a guard written as
   * `coveragePct < MIN_PCT` reads 90 < 90 and stays SILENT while a tenth of the
   * denominator is unaccounted for. The shipped guard cross-multiplies integers
   * (26900 < 26910) and warns. A threshold compared against a display value is a
   * threshold at an unknown place.
   */
  it('warns just BELOW the floor even when the displayed percent rounds UP to it', async () => {
    const root = await tmpdir('warpline-health-cov-round-');
    seedVerdicts(root, { measured: 269, unavailable: 30 });
    const r = await health(root);
    expect(r.adjudication.counterfactual.coveragePct).toBe(90); // what a human reads
    expect(coverageWarning(r), 'a rounded-to-90.0 coverage of 89.97% must still warn').toBeDefined();
  }, 60_000);

  /**
   * THE DISCRIMINATOR ON THE DENOMINATOR. One measured row and a hundred rows that
   * predate the field is 100% coverage, not 1%: those hundred can never be
   * measured by any future work, so counting them as misses would make the warning
   * unclearable — and an unclearable warning is how `=== 0` came to be trusted.
   * Were `verdicts` the denominator this fixture would read 0.99% and warn.
   */
  it('rows that PREDATE the field are excluded from the denominator, not counted as misses', async () => {
    const root = await tmpdir('warpline-health-cov-predate-');
    seedVerdicts(root, { measured: 1, predates: 100 });
    const r = await health(root);
    const cf = r.adjudication.counterfactual;
    expect(r.adjudication.verdicts).toBe(101); // the denominator that would be WRONG
    expect(cf.measurable).toBe(1);
    expect(cf.coveragePct).toBe(100);
    expect(coverageWarning(r)).toBeUndefined();
    expect(allPredateWarning(r)).toBeUndefined();
  }, 60_000);

  /**
   * The third state of the denominator itself. Every row predates the field, so
   * there is no ratio to take — and "no ratio" must not be silence: it is the
   * strongest form of the finding, and it is what the live fabric looked like
   * before its first two measurable admissions.
   */
  it('when EVERY row predates the field there is no ratio — and that is its own warning', async () => {
    const root = await tmpdir('warpline-health-cov-allpredate-');
    seedVerdicts(root, { predates: 43 });
    const r = await health(root);
    const cf = r.adjudication.counterfactual;
    expect(cf.measurable).toBe(0);
    expect(cf.coveragePct).toBeNull();
    expect(coverageWarning(r)).toBeUndefined(); // no denominator ⇒ no ratio claim
    expect(allPredateWarning(r), 'an empty denominator must be LOUDER than a low ratio, not quieter').toContain(
      'all 43 verdict(s) PREDATE',
    );
  }, 60_000);

  /** CONTROL: no verdicts at all is not a coverage finding — nothing has been claimed yet. */
  it('CONTROL: a project with zero verdicts says nothing about coverage', async () => {
    const root = await tmpdir('warpline-health-cov-none-');
    const r = await health(root);
    expect(r.adjudication.verdicts).toBe(0);
    expect(r.adjudication.counterfactual.coveragePct).toBeNull();
    expect(coverageWarning(r)).toBeUndefined();
    expect(allPredateWarning(r)).toBeUndefined();
  }, 60_000);
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
