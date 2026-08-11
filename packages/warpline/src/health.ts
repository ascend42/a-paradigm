/**
 * #warpline-health — the READER that makes everything else visible.
 *
 * WHY THIS IS A VERB AND NOT A PARAGRAPH IN `status`. The founder's stated worry
 * about the first real project is not that it breaks — it is that it *runs fine
 * and produces no measurement*. Nothing on any surface said so. Every fact below
 * was already on disk and simply had no reader:
 *
 *   - 43 shadow verdicts, 0 of them ever compared against git (#git-counterfactual
 *     now records the comparison; this counts it, including the rows that
 *     PREDATE the field, which is a third state and not a zero)
 *   - the auto-seal hook resolves `warpline` on PATH or falls back to a monorepo
 *     dist path — and `warpline` is NOT on PATH in this repo, so the whole
 *     ledger depends on an arm nobody has ever checked. `hook status` reports
 *     that the BLOCK is installed. Installed and reachable are different facts.
 *   - the last strand names the git commit it sealed at, so "commits behind
 *     HEAD" is a subtraction over data already present — no new writes, no new
 *     bookkeeping
 *   - `.warpline/` is ~1.1 GB. A total is abstract; MB PER STRAND is a number a
 *     team can multiply by its own commit rate.
 *
 * SEPARATE FROM `status` DELIBERATELY. `status` has a contract — it is the
 * MEANING DIFF of the working tree against HEAD, traced as `cli:status`, and
 * documented as distinct from the daemon's cycle-position `status`. Overloading
 * it would blur two audiences. A new CLI-only command is also free against the
 * FG-3 descriptor freeze: `descriptorsId` hashes VERB_DESCRIPTORS +
 * NEXT_LEGAL_VERBS + the derived tool-name map, none of which a CLI-only verb
 * touches (pinned by test/descriptors-frozen.test.ts, whose literal is unchanged).
 *
 * IT WRITES NOTHING. Not a trace row, not a state cache, not a lock — audit C-13
 * was discovered on a full disk, and a diagnostic that writes is a diagnostic you
 * cannot run exactly when you need it. So: no `traceCli` wrapper, no `WarpStore`
 * (its disk cache writes), tolerant `scanFabric` rather than the throwing
 * `readFabric`, and read-only git only.
 *
 * EXIT CODES: 0 green · 1 warnings (the fabric is sound but something is not
 * being measured or not reaching) · 2 the fabric is UNSOUND (verify failed, the
 * ledger is torn, or a tip points at nothing).
 *
 * Library code: no console output — the CLI prints.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { warplineDirOf, readSelvage, scanFabric } from './fabric/fabric.js';
import { listRefs, readRef } from './fabric/refs.js';
import { verifyFabric, type FabricVerifyReport } from './fabric/verify.js';
import { hookStatus, hookRemedy, type HookState } from './fabric/hook.js';
import { readShadowVerdicts, type ShadowVerdictRow } from './fabric/shadow.js';
import { listKnotPayloads } from './fabric/knot-payload.js';
import type { CounterfactualUnavailable, ConvergenceCell } from './fabric/counterfactual.js';
import type { AdmitBaseSource, AdmitStatus } from './fabric/admit.js';
import { gitPath, repoRoot, revListCount } from './git/git-exec.js';
import { ROOT_ENV, explicitRootOf, type RootArm } from './root.js';

export const HEALTH_SCHEMA = 'health:v1' as const;

/**
 * THE COVERAGE FLOOR for the git counterfactual, in percent (finding B3).
 *
 * WHAT THIS REPLACED, AND WHY IT HAD TO GO. The guard was `measured === 0`: it
 * fired at EXACTLY zero and nowhere else, so the single most important number in
 * the programme could be silenced forever by one measured row — and on the live
 * fabric it already had been. An alarm with a one-row escape hatch is not an
 * alarm on a metric, it is an alarm on a boolean.
 *
 * THE DENOMINATOR IS `measurable`, NOT `verdicts`. Rows that PREDATE the
 * counterfactual field can never be measured by any amount of future work, so
 * including them makes the ratio a function of frozen history rather than of
 * current behaviour: with 43 legacy rows on this fabric, 387 new measurements
 * would be needed to clear a 90% bar that today's pipeline already satisfies
 * perfectly. A warning that correct behaviour cannot clear is one operators
 * learn to ignore — which is how `=== 0` came to be trusted. Coverage and VOLUME
 * are two different deficiencies; collapsing them into one number is the C-9
 * mistake wearing a percent sign.
 *
 * WHY 90 AND NOT 100. The counterfactual is asked automatically on every admit,
 * so near-total coverage is the expected steady state and unavailability is
 * never sampling noise — each `unavailable` row names a structural reason. Two
 * of those reasons are workflow-legitimate and permanent for a team that uses
 * them (`worktree-ref`: admitting uncommitted work; `no-two-refs`), and a 100%
 * floor would warn such a team on every run, forever. Two are FAULTS that must
 * not be able to hide (`git-error`, and `timeout` — a 20 s bound riding the
 * post-commit hook). 90 tolerates the first pair at a realistic rate while
 * keeping fewer than one adjudication in ten unexplained.
 *
 * WHAT A FOUNDER SEES:
 *   50%  WARNING — half the adjudications never got a git answer; the headline
 *        claim's denominator is half the size the verdict count suggests.
 *   89%  WARNING — deliberately on the far side of the line. 89 and 90 must fall
 *        on opposite sides or the threshold is decoration, and the boundary is
 *        what the test pins (the ends alone would not have caught `=== 0`).
 *   90%  silent on the ratio — and the census line still prints
 *        `90 of 100 MEASURED (90.0% coverage)`, so the number is never hidden,
 *        only un-alarmed.
 */
export const COUNTERFACTUAL_COVERAGE_MIN_PCT = 90;

/* ────────────────────────── the hook reachability law ──────────────────────── */

/**
 * The hook's own resolution, replicated so health can answer "which arm wins,
 * or none?" — the check that catches the SILENT failure mode, where the block is
 * installed, `$WARPLINE_BIN` resolves to nothing, and `|| true` swallows it.
 *
 * These three constants are the hook's, not ours, and the binding is asserted
 * against the hook's RESOLUTION LINES — the operand of `command -v`, the shell
 * variable that operand names, its `${VAR:-default}` expansion, and the operand
 * of the dist-path `[ -f … ]` test — not against the block as a whole
 * (test/warpline-health.test.ts §2).
 *
 * THE WEAKER VERSION OF THIS TEST WAS VACUOUS AND SHIPPED. It asserted only that
 * the three strings appeared SOMEWHERE in the generated text. `warpline` occurs
 * on eight lines of the block, `WARPLINE_BIN` on five, and the dist path on
 * three — including prose comments and the operator-advice `echo` — so renaming
 * BOTH the binary and the env var, and separately DELETING the entire dist
 * fallback arm, each left the test green. A containment check over a file that
 * documents itself in prose is a check on the prose.
 */
export const HOOK_BIN_ENV = 'WARPLINE_BIN';
export const HOOK_DEFAULT_BIN = 'warpline';
export const HOOK_DIST_FALLBACK = 'packages/warpline/dist/cli.js';

/**
 * WHICH arm of the hook's resolution wins.
 *   'env-bin'  $WARPLINE_BIN is set and resolves
 *   'path'     the bare name `warpline` is on PATH (the intended arm)
 *   'dist'     the monorepo build fallback — works HERE and nowhere else
 *   'none'     nothing resolves: the hook runs, fails, and says nothing
 */
export type HookArm = 'env-bin' | 'path' | 'dist' | 'none';

/** POSIX `command -v` for a program name or path, without spawning a shell. */
function commandV(bin: string): string | null {
  const executable = (p: string): boolean => {
    try {
      return fs.statSync(p).isFile() && (fs.accessSync(p, fs.constants.X_OK), true);
    } catch {
      return false;
    }
  };
  if (bin.includes('/')) return executable(path.resolve(bin)) ? path.resolve(bin) : null;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, bin);
    if (executable(candidate)) return candidate;
  }
  return null;
}

export interface HookHealth {
  /** the post-commit hook path (git-dir-correct), or null when git could not answer. */
  hookPath: string | null;
  /** whether the warpline auto-seal BLOCK is present (hookStatus's answer). */
  state: HookState | 'unknown';
  /** the binary name the hook would use ($WARPLINE_BIN, else `warpline`). */
  bin: string;
  /** WHICH resolution arm wins — the fact `hook status` cannot report. */
  arm: HookArm;
  /** what the winning arm resolves to, or null when nothing does. */
  resolved: string | null;
}

/**
 * The BINARY-RESOLUTION half of hookHealth, on its own.
 *
 * Split out for `hook install` (finding C2), which needs exactly this fact at
 * install time and must not pay for `verifyFabric`. Deliberately does NOT read
 * the hook file: whether the block is installed and whether a binary resolves
 * are independent questions, and conflating them is what let "installed" stand
 * in for "reaching" in the first place.
 */
export function hookResolution(root: string): Pick<HookHealth, 'bin' | 'arm' | 'resolved'> {
  const envBin = process.env[HOOK_BIN_ENV];
  const bin = envBin && envBin.trim() !== '' ? envBin.trim() : HOOK_DEFAULT_BIN;
  const onPath = commandV(bin);
  if (onPath) return { bin, arm: envBin ? 'env-bin' : 'path', resolved: onPath };
  const dist = path.join(root, HOOK_DIST_FALLBACK);
  if (fs.existsSync(dist)) return { bin, arm: 'dist', resolved: `node ${dist}` };
  return { bin, arm: 'none', resolved: null };
}

function hookHealth(root: string, hookPath: string | null): HookHealth {
  const state = hookPath ? hookStatus(hookPath).state : ('unknown' as const);
  return { hookPath, state, ...hookResolution(root) };
}

/* ──────────────────────────────── the report ───────────────────────────────── */

export interface FabricHealth {
  path: string;
  /** strands that PARSED, by schema epoch. */
  strands: number;
  byVersion: { v1: number; v2: number; v3: number };
  /** physical lines that did not parse (audit C-13's torn tail) — 0 is the healthy answer. */
  malformedLines: number;
  /** 'refs' once refs/heads exists (V3.2), 'legacy' on the stateId selvage, 'empty' before genesis. */
  refsMode: 'refs' | 'legacy' | 'empty';
  /** the legacy stateId tip. */
  selvage: string | null;
  /** refs/heads/<name> → pickId. */
  refs: Record<string, string>;
  /** tips no ref names — legal, reported (never a failure). */
  abandonedHeads: string[];
  /** `fabric verify`, run in-process. `ran:false` ⇒ it THREW, which is itself unsound. */
  verify: { ran: boolean; ok: boolean; checked: number; failures: number; detail: string[] };
  /** the C-6 anti-truncation witness, straight off the verify report. */
  stakeJournal: FabricVerifyReport['stakeJournal'] | null;
}

export interface SealHealth {
  /** ISO timestamp of the newest strand, or null. */
  lastSealedAt: string | null;
  /** the git commit the newest strand sealed at (provenance.gitCommit). */
  lastGitCommit: string | null;
  /** `git rev-list --count <lastGitCommit>..HEAD`. */
  commitsBehindHead: number | null;
  /** WHY the count is null, when it is — never an unexplained hole. */
  behindUnknown: 'no-strand' | 'strand-has-no-commit' | 'git-unreachable' | null;
}

export interface AdjudicationHealth {
  /** total shadow verdict rows. */
  verdicts: number;
  byStatus: Partial<Record<AdmitStatus, number>>;
  /** where each verdict's BASE came from (audit C-9); 'predates-field' is its own bucket. */
  baseFrom: Partial<Record<AdmitBaseSource | 'predates-field', number>>;
  /**
   * THE PRIMARY METRIC. Three states, never two: `measured` (git actually
   * decided), `unavailable` (asked, could not — keyed by reason), and
   * `predatesField` (the row was written before the counterfactual existed).
   * Collapsing the third into the first two is exactly the C-9 mistake.
   */
  counterfactual: {
    measured: number;
    predatesField: number;
    unavailable: Partial<Record<CounterfactualUnavailable, number>>;
    cells: Partial<Record<ConvergenceCell, number>>;
    /**
     * Verdicts that COULD have been measured: `verdicts − predatesField`, which
     * is identically `measured + Σunavailable`. The denominator of the coverage
     * ratio — see COUNTERFACTUAL_COVERAGE_MIN_PCT for why the third bucket is
     * excluded rather than counted as a miss.
     */
    measurable: number;
    /** `measured / measurable` as a percent (1 dp), or null when nothing is measurable. */
    coveragePct: number | null;
  };
  /**
   * TOTAL contested verdicts — `contestedShadow + contestedRecorded`. Zero means
   * this project has never produced the thing the product adjudicates, which no
   * other surface says.
   *
   * THIS COUNTER WAS BLIND FOR THE ENTIRE NATIVE ERA. It summed shadow rows
   * only, so every KNOT the NATIVE path produced — the path agents actually use
   * — was invisible: `native.ts` writes no shadow row, it persists a payload
   * under `.warpline/knots/`. A fresh repo driven through fork → propose →
   * admit to a real KNOT still reported "ZERO contested verdicts". An
   * instrument that reads one of the two writers reports the FAVOURABLE answer
   * about its own emptiness — the symmetry rule the merge-tree exit-1
   * conflation already taught us once.
   */
  contested: number;
  /** Contested rows OBSERVED by the shadow gate (`--shadow`; seals nothing). */
  contestedShadow: number;
  /**
   * Contested verdicts RECORDED in the ledger — distinct payloads under
   * `.warpline/knots/`, written by the native and git-era seal paths
   * (`native.ts:753`, `admit.ts:1047`). Disjoint from `contestedShadow` by
   * construction: a shadow run deliberately persists no payload.
   */
  contestedRecorded: number;
}

export interface DiskHealth {
  bytes: number;
  files: number;
  /** the number a team can multiply by its own commit rate. */
  mbPerStrand: number | null;
  /** the biggest top-level entries under .warpline/, largest first. */
  largest: Array<{ name: string; bytes: number }>;
}

/* ─────────────────────────── root provenance ───────────────────────────── */

/**
 * WHICH fabric this invocation is pointed at, and WHY.
 *
 * `report.root` has always carried the path. The path is not the fact that
 * matters: "--root took" and "it fell through to the git root, which happens to
 * be correct today" print identically, and only the second is D-7 in miniature.
 * The arm is the difference.
 */
export interface RootHealth {
  /** the arm of the precedence chain that decided it (#warpline-root). */
  arm: RootArm;
  /** true for the two EXPLICIT arms — the operator said which fabric. */
  explicit: boolean;
  /** `git -C <root> rev-parse --show-toplevel`, or null when git could not answer. */
  gitToplevel: string | null;
  /** an ENCLOSING directory that also carries a `.warpline/`, or null. */
  nestedUnder: string | null;
}

/**
 * Re-derive which arm won, from the same inputs `resolveRootVerbose` reads.
 *
 * Derived rather than threaded through `health(root)` so that every caller —
 * CLI, MCP skin, tests — gets the field without a signature change; the two
 * explicit arms are process state (`explicitRootOf()`, `$WARPLINE_ROOT`) and so
 * are read back exactly, not guessed.
 */
function rootArmNow(): RootArm {
  if (explicitRootOf() !== null) return 'flag';
  const fromEnv = process.env[ROOT_ENV];
  if (fromEnv !== undefined && fromEnv.trim() !== '') return 'env';
  return 'git'; // corrected to 'cwd' below when git cannot answer
}

/**
 * The nearest ANCESTOR directory carrying its own `.warpline/`, or null.
 *
 * A fabric nested inside another fabric's tree is the concrete form of the
 * hazard `root.ts` names in its header: a scratch fabric created under the live
 * checkout, after which an unqualified command resolves to whichever one git
 * answers with. Pure `existsSync` up the chain — no reads, nothing written.
 */
function nestedUnderOf(root: string): string | null {
  let dir = path.dirname(path.resolve(root));
  for (;;) {
    if (fs.existsSync(path.join(dir, '.warpline'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export interface HealthReport {
  schemaVersion: typeof HEALTH_SCHEMA;
  root: string;
  /** WHY this root — the arm, and the two ways it can be quietly wrong. */
  rootResolution: RootHealth;
  fabric: FabricHealth;
  seal: SealHealth;
  hook: HookHealth;
  adjudication: AdjudicationHealth;
  disk: DiskHealth;
  /** exit 1 — sound, but something is unmeasured or unreachable. */
  warnings: string[];
  /** exit 2 — the fabric cannot be trusted as it stands. */
  unsound: string[];
}

/* ─────────────────────────────── collectors ────────────────────────────────── */

function diskOf(wdir: string): DiskHealth {
  let bytes = 0;
  let files = 0;
  const perTop = new Map<string, number>();
  const walk = (dir: string, top: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, top || e.name);
      } else if (e.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch {
          continue;
        }
        bytes += size;
        files++;
        const key = top || e.name;
        perTop.set(key, (perTop.get(key) ?? 0) + size);
      }
    }
  };
  walk(wdir, '');
  const largest = [...perTop.entries()]
    .map(([name, b]) => ({ name, bytes: b }))
    .sort((x, y) => y.bytes - x.bytes)
    .slice(0, 5);
  return { bytes, files, mbPerStrand: null, largest };
}

function adjudicationOf(rows: ShadowVerdictRow[], recordedKnots: number): AdjudicationHealth {
  const byStatus: Partial<Record<AdmitStatus, number>> = {};
  const baseFrom: Partial<Record<AdmitBaseSource | 'predates-field', number>> = {};
  const unavailable: Partial<Record<CounterfactualUnavailable, number>> = {};
  const cells: Partial<Record<ConvergenceCell, number>> = {};
  let measured = 0;
  let predatesField = 0;
  let contestedShadow = 0;

  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const bf = r.baseFrom ?? 'predates-field';
    baseFrom[bf] = (baseFrom[bf] ?? 0) + 1;
    if (r.status === 'KNOT' || r.status === 'DANGLE') contestedShadow++;
    const cf = r.gitCounterfactual;
    if (!cf) {
      predatesField++;
    } else if (cf.unavailable === null) {
      measured++;
      if (cf.cell) cells[cf.cell] = (cells[cf.cell] ?? 0) + 1;
    } else {
      unavailable[cf.unavailable] = (unavailable[cf.unavailable] ?? 0) + 1;
    }
  }
  const measurable = rows.length - predatesField;
  const coveragePct = measurable > 0 ? Number(((measured / measurable) * 100).toFixed(1)) : null;
  return {
    verdicts: rows.length,
    byStatus,
    baseFrom,
    counterfactual: { measured, predatesField, unavailable, cells, measurable, coveragePct },
    contested: contestedShadow + recordedKnots,
    contestedShadow,
    contestedRecorded: recordedKnots,
  };
}

/**
 * Read every health fact. Pure reads: `fs` (no writes, no mkdir), the tolerant
 * `scanFabric`, and two read-only git invocations.
 */
export async function health(root: string): Promise<HealthReport> {
  const wdir = warplineDirOf(root);
  const warnings: string[] = [];
  const unsound: string[] = [];

  /* ── root provenance ── */
  // Read-only git, and only from the RESOLVED root (not process.cwd()): the
  // question is "is the fabric I am about to report on the toplevel of its own
  // repository?", which is a fact about `root`, not about where I was invoked.
  const gitToplevel = await repoRoot({ cwd: root }).catch(() => null);
  const derivedArm = rootArmNow();
  const rootResolution: RootHealth = {
    // The 'git' arm is only real if git can actually answer; otherwise
    // `resolveRoot` took the cwd fallback and so did we.
    arm: derivedArm === 'git' && gitToplevel === null ? 'cwd' : derivedArm,
    explicit: derivedArm === 'flag' || derivedArm === 'env',
    gitToplevel,
    nestedUnder: nestedUnderOf(root),
  };

  // WARNING 1 — the SILENT fallback. With no override the root is `repoRoot()`
  // BY CONSTRUCTION, so "not the git toplevel and not overridden" reduces
  // exactly to "git could not answer and we used process.cwd()". That is the
  // only unexplained arm in the chain and it is the one that can point at a
  // directory nobody chose, so it is the one worth a line.
  if (rootResolution.arm === 'cwd') {
    warnings.push(
      `root resolved by FALLING BACK to the working directory — \`--root\` was not given, $${ROOT_ENV} is not set, ` +
        `and git could not name a toplevel for ${root}. Nothing chose this fabric; it is wherever the shell happened to be. ` +
        `Pass \`--root <dir>\` to say which fabric you mean.`,
    );
  }

  // WARNING 2 — a fabric INSIDE another fabric. Rare, cheap to detect, and the
  // exact accident root.ts's header is about (a scratch fabric under the live
  // checkout, after which an unqualified command targets whichever one git
  // answers with). Worth warning even when the current resolution is correct:
  // the hazard is the NEXT invocation, which may not pass --root.
  if (rootResolution.nestedUnder) {
    warnings.push(
      `this root's .warpline/ is NESTED inside another fabric at ${rootResolution.nestedUnder} — ` +
        `two fabrics are stacked on one path, and a command run without \`--root\` here targets whichever ` +
        `one git names first. Move the inner fabric out, or always pass \`--root\`.`,
    );
  }
  // DELIBERATELY NOT WARNED: an explicit root that merely differs from the git
  // toplevel, and the mere USE of $WARPLINE_ROOT. Both are the tool working as
  // designed — an operator who names a fabric gets that fabric — and warning on
  // the intended path is how a diagnostic teaches people to ignore it. The ARM
  // LINE already makes an inherited $WARPLINE_ROOT visible, which is the actual
  // need; a warning on top of it would be noise, not information.

  /* ── fabric ── */
  let scan: ReturnType<typeof scanFabric>;
  try {
    scan = scanFabric(wdir);
  } catch (err) {
    scan = { path: path.join(wdir, 'fabric.jsonl'), raw: Buffer.alloc(0), strands: [], strandOffsets: [], malformed: [], lastGoodEnd: 0, lines: 0 };
    unsound.push(`fabric ledger unreadable: ${(err as Error).message}`);
  }
  const byVersion = { v1: 0, v2: 0, v3: 0 };
  for (const s of scan.strands) {
    if (s.schemaVersion >= 3) byVersion.v3++;
    else if (s.schemaVersion === 2) byVersion.v2++;
    else byVersion.v1++;
  }
  if (scan.malformed.length > 0) {
    unsound.push(
      `${scan.malformed.length} malformed ledger line(s) — first at ${scan.path}:${scan.malformed[0].line} ` +
        `(audit C-13; \`warpline fabric repair\` reports the plan and writes nothing without --confirm)`,
    );
  }

  let selvage: string | null = null;
  try {
    selvage = readSelvage(wdir);
  } catch (err) {
    unsound.push(`selvage pointer unreadable: ${(err as Error).message}`);
  }
  let named = new Map<string, string>();
  try {
    named = listRefs(wdir);
  } catch (err) {
    unsound.push(`refs unreadable: ${(err as Error).message}`);
  }
  const refsMode: FabricHealth['refsMode'] =
    named.size > 0 ? 'refs' : scan.strands.length === 0 && selvage === null ? 'empty' : 'legacy';
  if (refsMode === 'legacy' && scan.strands.length > 0) {
    warnings.push(
      'legacy selvage mode — refs/heads/selvage does not exist, so the per-ref CAS is DISENGAGED ' +
        '(audit C-1: the only remaining guard is the stateId CAS, which is blind to a byte-custody seal). ' +
        'Run `warpline refs migrate`.',
    );
  }
  // A tip that names nothing is corruption, not a preference.
  const refSelvage = refsMode === 'refs' ? readRef(wdir, 'selvage') : null;
  if (refSelvage && !scan.strands.some((s) => s.pickId === refSelvage)) {
    unsound.push(`refs/heads/selvage names ${refSelvage} but no strand in the ledger carries that pickId`);
  }
  if (selvage && scan.strands.length > 0 && !scan.strands.some((s) => s.stateId === selvage)) {
    unsound.push(`selvage names ${selvage} but no strand in the ledger carries that state`);
  }

  let verify: FabricHealth['verify'] = { ran: false, ok: false, checked: 0, failures: 0, detail: [] };
  let stakeJournal: FabricVerifyReport['stakeJournal'] | null = null;
  let abandonedHeads: string[] = [];
  try {
    // ONCE — verify walks the whole object store (~1s on a 70-strand fabric);
    // reading it twice would double the cost of a diagnostic for no new fact.
    const report = verifyFabric(root);
    stakeJournal = report.stakeJournal;
    abandonedHeads = report.abandonedHeads;
    verify = {
      ran: true,
      ok: report.failures.length === 0,
      checked: report.checked,
      failures: report.failures.length,
      detail: report.failures.slice(0, 5).map((f) => `seq ${f.seq} ${f.kind}: ${f.detail}`),
    };
    if (report.failures.length > 0) {
      unsound.push(`fabric verify: ${report.failures.length} failure(s) — ${verify.detail[0]}`);
    }
    if (report.abandonedHeads.length > 0) {
      warnings.push(
        `${report.abandonedHeads.length} abandoned head(s) — sealed work no ref names ` +
          `(recover with \`warpline refs set <name> <pickId>\`)`,
      );
    }
  } catch (err) {
    unsound.push(`fabric verify could not run: ${(err as Error).message}`);
  }

  const fabric: FabricHealth = {
    path: scan.path,
    strands: scan.strands.length,
    byVersion,
    malformedLines: scan.malformed.length,
    refsMode,
    selvage,
    refs: Object.fromEntries(named),
    abandonedHeads,
    verify,
    stakeJournal,
  };

  /* ── seal liveness ── */
  const last = scan.strands.length > 0 ? scan.strands[scan.strands.length - 1] : undefined;
  const lastGitCommit = last?.provenance?.gitCommit ?? null;
  let commitsBehindHead: number | null = null;
  let behindUnknown: SealHealth['behindUnknown'] = null;
  if (!last) behindUnknown = 'no-strand';
  else if (!lastGitCommit) behindUnknown = 'strand-has-no-commit';
  else {
    commitsBehindHead = await revListCount(lastGitCommit, 'HEAD', { cwd: root });
    if (commitsBehindHead === null) behindUnknown = 'git-unreachable';
  }
  const seal: SealHealth = {
    lastSealedAt: last?.recordedAt ?? null,
    lastGitCommit,
    commitsBehindHead,
    behindUnknown,
  };
  if (commitsBehindHead !== null && commitsBehindHead > 0) {
    warnings.push(
      `the fabric is ${commitsBehindHead} git commit(s) behind HEAD — the last strand sealed at ` +
        `${lastGitCommit!.slice(0, 12)}. Either the auto-seal hook is not reaching a binary, or it is not installed.`,
    );
  }

  /* ── hook reachability ── */
  const hookPath = await gitPath('hooks/post-commit', { cwd: root }).catch(() => null);
  const hook = hookHealth(root, hookPath);
  // TOTAL over the state space, ON PURPOSE. An earlier draft of this chain
  // ended `else if (state !== 'installed' && state !== 'unknown')`, whose second
  // conjunct was dead residue from before the 'unknown' branch existed — and a
  // dead condition inside the one check whose whole job is catching a SILENT
  // failure is the same defect class as the failure. Written as a switch over
  // `state` with the arm handled inside, every combination is visibly accounted
  // for and an unhandled one cannot be introduced quietly.
  switch (hook.state) {
    case 'unknown':
      // git could not answer where the hook lives. Found by the health tests:
      // this state previously reported `unknown` and then said NOTHING at all.
      warnings.push(
        'the auto-seal hook state is UNKNOWN — git could not resolve .git/hooks/post-commit ' +
          '(not a repo, or `git` is not reachable from this environment).',
      );
      break;
    case 'installed':
      if (hook.arm === 'none') {
        unsound.push(
          `the auto-seal hook is INSTALLED but resolves to nothing: neither \`${hook.bin}\` on PATH nor ` +
            `${HOOK_DIST_FALLBACK} exists. Every commit runs it, it fails, and \`|| true\` hides that — ` +
            `the ledger silently stops growing. FIX: ${hookRemedy(root)}`,
        );
      } else if (hook.arm === 'dist') {
        warnings.push(
          `the auto-seal hook resolves via the MONOREPO DIST FALLBACK (${HOOK_DIST_FALLBACK}), not \`${hook.bin}\` ` +
            `on PATH. That arm works only inside this checkout and only while dist/ is built — a stale or ` +
            `deleted dist makes every seal a silent no-op. FIX: ${hookRemedy(root)}`,
        );
      }
      // 'path' / 'env-bin' — installed AND reachable. The only silent case here
      // is the good one, so nothing is said.
      break;
    case 'absent':
    case 'other-hook-no-warpline':
      warnings.push(
        `the auto-seal hook is not installed (\`warpline hook install\`) — the ledger only grows when ` +
          `you run \`warpline pick\` by hand, so it will drift behind HEAD silently.`,
      );
      break;
  }

  /* ── adjudication ── */
  // Both writers, never one. `listKnotPayloads` is the SAME reader `warpline
  // knot` uses, so the two surfaces cannot drift apart about what exists.
  const adjudication = adjudicationOf(readShadowVerdicts(root), listKnotPayloads(root).length);
  const cf = adjudication.counterfactual;
  // TOTAL over the three states of the denominator, like the hook switch above:
  // nothing measurable at all / measurable but under the floor / at or above it.
  // The predecessor tested `measured === 0`, which is the ratio's ZERO END and
  // nothing else — one measured row disarmed it permanently (finding B3).
  if (adjudication.verdicts > 0 && cf.measurable === 0) {
    warnings.push(
      `all ${adjudication.verdicts} verdict(s) PREDATE the counterfactual field — not one adjudication on ` +
        `this project has ever been measured against git, so the headline claim ("meaning caught what bytes ` +
        `missed") has NO denominator here. These rows are unmeasurable by construction; only NEW adjudications ` +
        `can build one.`,
    );
  } else if (cf.measurable > 0 && cf.measured * 100 < cf.measurable * COUNTERFACTUAL_COVERAGE_MIN_PCT) {
    // Integer cross-multiplication, not `coveragePct < 90`: the reported pct is
    // rounded for humans, and a threshold compared against a rounded value is a
    // threshold at an unknown place. 89.96% must warn.
    warnings.push(
      `git-counterfactual coverage is ${cf.coveragePct}% — ${cf.measured} of ${cf.measurable} MEASURABLE verdict(s) ` +
        `were actually measured against git (floor ${COUNTERFACTUAL_COVERAGE_MIN_PCT}%)` +
        (Object.keys(cf.unavailable).length
          ? `; unmeasured: ${Object.entries(cf.unavailable)
              .map(([k, v]) => `${k} ${v}`)
              .join(', ')}`
          : '') +
        (cf.predatesField ? ` (${cf.predatesField} further row(s) predate the field and are excluded)` : '') +
        ` — the headline claim ("meaning caught what bytes missed") is being computed over a denominator that ` +
        `is quietly smaller than the verdict count.`,
    );
  }
  if (adjudication.contested === 0) {
    warnings.push(
      `this project has produced ZERO contested verdicts (no KNOT, no DANGLE)` +
        (adjudication.baseFrom['selvage'] || adjudication.baseFrom['predates-field']
          ? ` — and ${(adjudication.baseFrom['selvage'] ?? 0) + (adjudication.baseFrom['predates-field'] ?? 0)} verdict(s) had no agent base, ` +
            `so FAST_ADMIT was structurally forced and contention was UNREACHABLE (audit C-9), not merely absent.`
          : '.'),
    );
  }

  /* ── disk ── */
  const disk = diskOf(wdir);
  disk.mbPerStrand = fabric.strands > 0 ? Number((disk.bytes / fabric.strands / 1_048_576).toFixed(2)) : null;

  return { schemaVersion: HEALTH_SCHEMA, root, rootResolution, fabric, seal, hook, adjudication, disk, warnings, unsound };
}

/** 0 green · 1 warnings · 2 the fabric is unsound. */
export function healthExitCode(report: HealthReport): 0 | 1 | 2 {
  if (report.unsound.length > 0) return 2;
  if (report.warnings.length > 0) return 1;
  return 0;
}
