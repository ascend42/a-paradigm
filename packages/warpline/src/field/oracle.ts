/**
 * #field-oracle — the §4 CLEAN-seal oracle AUTOMATION (expo-field-test-protocol.md
 * §4, LOCKED; field-test-readiness-2026-08-23.md §B7 increment 1).
 *
 * After a seal, the falsifier-(A) question is: did the merge produce a broken
 * state NEITHER side was broken in? This module walks the fabric for auditable
 * seals, restores their native trees into scratch dirs (git-absent restore is
 * real), runs the project's OWN declared green-gate on the PARENTS FIRST
 * (ESTABLISHING POWER — a check red on either parent alone proves nothing and
 * is excluded), then on the merged tree, and appends one hash-chained row per
 * audited seal to `.warpline/field/expo-field-oracle.jsonl`.
 *
 * DECLARED, NEVER HARDCODED: the check set comes from
 * `.warpline/field/greengate.json` — an absent config records every outcome
 * 'absent' and the row says so (THE DEFAULT IS NOT A PASS, §4). The check
 * EXECUTION is an injected `CheckRunner`, so unit tests never actually run
 * tsc/expo; the CLI injects the real execFile runner.
 *
 * `coveredClass` comes from the §8 path classifier (#field-blind-class) over the
 * seal's changed paths: a seal that touched ONLY blind classes is recorded
 * `blind-untested` and can never read as evidence for (A) surviving.
 *
 * LEDGER-FILE PAIRING (reviewer follow-on, 2026-08-23): the run keeps TWO
 * hash-chained ledgers with deliberately similar protocol names. THIS module owns
 * the ORACLE ledger, `.warpline/field/expo-field-oracle.jsonl` (one row per
 * audited seal, §4 RECORDING). The JUDGE custody ledger keeps the protocol's own
 * name `expo-field-audit.jsonl` (§3 LEDGER CUSTODY) and lives under
 * `.warpline/field/judge/` — written by #judge/ledger via src/field/judge-run.ts.
 * They chain independently; only the judge ledger gets the §3 A13 git witness.
 *
 * STANDALONE from src/daemon by construction. Library code: no console output.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { canonicalSerialize } from '../warp/canonical.js';
import { canonicalSafe, type Strand } from '../fabric/strand.js';
import { warplineDirOf, readFabric } from '../fabric/fabric.js';
import { diffTrees } from '../fabric/graph.js';
import { restoreTree } from '../warp/snapshot.js';
import { appendDurableSync } from '../warp/durable.js';
import { ObjectStore } from '../warp/object-store.js';
import { coveredClassOf, type BlindPathFinding } from './blind-class.js';

export const FIELD_ORACLE_ROW_SCHEMA = 'fieldOracleRow:v1' as const;

/* ── the declared green-gate (config, never hardcoded) ───────────────────────── */

/** One declared check: a name + the exact command to run in the restored tree. */
export interface CheckSpec {
  name: string;
  cmd: string;
  args: string[];
}

/** The injected executor — unit tests fake it; the CLI injects execFile. */
export type CheckRunner = (spec: CheckSpec, cwd: string) => Promise<{ status: 'pass' | 'fail'; output: string }>;

/** `.warpline/field/greengate.json` — the project's OWN declared gate (§4 step 2–3). */
export interface GreenGateConfig {
  checks: CheckSpec[];
  /** the frozen behavioral oracle: a script + its PRE-DECLARED assertions (§4 step 3). */
  behavioral?: { script: string; assertions: string[] };
}

export function greenGatePathOf(root: string): string {
  return path.join(root, '.warpline', 'field', 'greengate.json');
}

/**
 * Load the declared green-gate config, or null when ABSENT (ENOENT). A config
 * that exists but does not parse/validate THROWS — a corrupt declared gate must
 * not silently degrade to "absent" (that would flatter the run).
 */
export function readGreenGate(root: string, explicitPath?: string): GreenGateConfig | null {
  const p = explicitPath ?? greenGatePathOf(root);
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Only the DEFAULT path's absence means "no declared gate". An EXPLICITLY
      // named path that does not exist is an operator typo — throwing beats a
      // whole run silently recorded "absent" (reviewer finding, 2026-08-23).
      if (explicitPath !== undefined) {
        throw new Error(`warpline: field greengate not found at explicitly given path ${p}`);
      }
      return null;
    }
    throw new Error(`warpline: field greengate unreadable at ${p}: ${(err as Error).message}`);
  }
  const parsed = JSON.parse(raw) as GreenGateConfig;
  if (!Array.isArray(parsed.checks)) {
    throw new Error(`warpline: field greengate at ${p} — "checks" must be an array of {name, cmd, args}`);
  }
  for (const c of parsed.checks) {
    if (!c || typeof c.name !== 'string' || typeof c.cmd !== 'string' || !Array.isArray(c.args)) {
      throw new Error(`warpline: field greengate at ${p} — malformed check ${JSON.stringify(c)} (need {name, cmd, args[]})`);
    }
  }
  if (parsed.behavioral !== undefined) {
    if (typeof parsed.behavioral.script !== 'string' || !Array.isArray(parsed.behavioral.assertions)) {
      throw new Error(`warpline: field greengate at ${p} — "behavioral" must be {script, assertions[]}`);
    }
  }
  return parsed;
}

/* ── audit-target discovery (walk the fabric, invent nothing) ────────────────── */

/** One auditable seal, read off the fabric. Unrecorded fields are null, never guessed. */
export interface AuditTarget {
  /** the strand's identity — its pickId (a strand IS a pick; §4 asks both names). */
  strandId: string;
  pickId: string;
  /** v1/v2 ledger seq; null on a v3 strand (v3 carries no ledger position). */
  seq: number | null;
  /** merge-recipe strands read CLEAN (a materialized merge); single-parent seals FAST_ADMIT. */
  verdict: 'CLEAN' | 'FAST_ADMIT';
  /** strands record no admit verdict — this label is DERIVED (merge → CLEAN, else
   * FAST_ADMIT), never read from the strand (reviewer finding, 2026-08-23). */
  verdictDerived: true;
  /** present only on a REAL merge (two parents + result) — the MergeRecipe trees. */
  recipe: { baseTreeId: string | null; oursTreeId: string; theirsTreeId: string; resultTreeId: string } | null;
  /** contributing agent ids (parent strands' authorship; own author when unresolvable). */
  agents: (string | null)[];
  parentStateIds: (string | null)[];
  /** the sealed tree the oracle audits (binding, falling back to recipe.result). */
  mergedTreeId: string | null;
  /** treeIds of the parent strands' bindings (power runs), null where unbound/unknown. */
  parentTreeIds: (string | null)[];
}

/** The DAG/chain parents of a strand, epoch-aware (v3 parents[]; v2 chain links). */
function parentPickIdsOf(s: Strand): string[] {
  if (s.parents !== undefined) return s.parents;
  const out: string[] = [];
  if (s.parentPickId) out.push(s.parentPickId);
  if (s.mergeParentPickId) out.push(s.mergeParentPickId);
  return out;
}

/**
 * Walk the whole fabric for auditable seals: strands carrying a MergeRecipe (a
 * real merge: two parents + result) AND single-parent CLEAN/FAST_ADMIT seals.
 * Every field is READ off the strand (or its parents); a field the strand does
 * not record is null — the oracle audits what happened, it never invents.
 */
export function discoverAuditTargets(root: string): AuditTarget[] {
  const fabric = readFabric(warplineDirOf(root));
  const byPick = new Map<string, Strand>(fabric.map((s) => [s.pickId, s]));
  const out: AuditTarget[] = [];
  for (const s of fabric) {
    const parentIds = parentPickIdsOf(s);
    const parents = parentIds.map((id) => byPick.get(id) ?? null);
    const parentStateIds = parents.map((p, i) =>
      p ? p.stateId : i === 0 ? (s.parentStateId ?? null) : null,
    );
    const parentTreeIds = parents.map((p) => p?.binding?.treeId ?? null);
    const parentAgents = parents.map((p) => p?.authoredBy?.agentId ?? null);
    const agents = parents.length > 0 ? parentAgents : [s.authoredBy?.agentId ?? null];
    if (s.merge) {
      out.push({
        strandId: s.pickId,
        pickId: s.pickId,
        seq: s.seq ?? null,
        verdict: 'CLEAN',
        verdictDerived: true,
        recipe: {
          baseTreeId: s.merge.base ?? null,
          oursTreeId: s.merge.ours,
          theirsTreeId: s.merge.theirs,
          resultTreeId: s.merge.result,
        },
        agents,
        parentStateIds: parentStateIds.length ? parentStateIds : [s.parentStateId ?? null],
        mergedTreeId: s.binding?.treeId ?? s.merge.result ?? null,
        parentTreeIds,
      });
    } else {
      out.push({
        strandId: s.pickId,
        pickId: s.pickId,
        seq: s.seq ?? null,
        verdict: 'FAST_ADMIT',
        verdictDerived: true,
        recipe: null,
        agents,
        parentStateIds,
        mergedTreeId: s.binding?.treeId ?? null,
        parentTreeIds,
      });
    }
  }
  return out;
}

/* ── the audit itself (ESTABLISHING POWER → merged-tree run → recording) ─────── */

/**
 * One check's recorded outcome. Extends the judge-types OracleOutcome vocabulary
 * with the §4 power exclusion: 'excluded-parent-red' = the check was RED on a
 * parent alone, so its result on the merge proves nothing (§4 ESTABLISHING POWER).
 */
export type FieldCheckOutcome = 'pass' | 'fail' | 'absent' | 'excluded-parent-red';

/** The §4 RECORDING row body (hash-chain fields added at append time). */
export interface OracleRowBody {
  schemaVersion: typeof FIELD_ORACLE_ROW_SCHEMA;
  ts: string;
  strandId: string;
  pickId: string;
  seq: number | null;
  /** 'merge' = power rule applied; 'single-parent' = power rule not applicable. */
  mode: 'merge' | 'single-parent';
  agents: (string | null)[];
  parentStateIds: (string | null)[];
  mergedTreeId: string | null;
  /** was a declared gate present at audit time? (§4: an absent gate is SAID, not passed). */
  greengate: 'declared' | 'absent';
  oracle: {
    checks: Record<string, FieldCheckOutcome>;
    /** frozen behavioral assertions (per-assertion outcome), when configured. */
    behavioral?: Record<string, FieldCheckOutcome>;
  };
  /** the seal's changed paths (union of both sides' changes vs base; null = underivable). */
  changedPaths: string[] | null;
  /**
   * §4 PLANTED POSITIVE CONTROL — true only on a row the operator harness appended
   * for the planted known-broken seed. NEVER set by `auditOne` (a real audit cannot
   * know it is rating a plant); set at append time by the seeding procedure, sealed
   * into the hash chain, and EXCLUDED from every real denominator (audit-sample
   * selection, §7A bounds, admissions). Additive: absent = not planted.
   */
  planted?: boolean;
  coveredClass: boolean;
  /** every blind changed path + its §8 reason. */
  blind: BlindPathFinding[];
  /** §4 objective: some check/assertion GREEN on both parents AND RED on the merge. */
  objectiveRegression: boolean;
  source: 'oracle-flagged' | 'clean-sweep';
  verdict: 'true-clean' | 'candidate-false-clean' | 'blind-untested';
  /** honest degradations (missing trees, absent config, …) — never silently dropped. */
  notes: string[];
}

/** A sealed ledger row: body + chain. rowHash = schema:sha256(canonical(body)+prev). */
export interface OracleRow extends OracleRowBody {
  prevRowHash: string | null;
  rowHash: string;
}

export interface AuditOneOptions {
  store: ObjectStore;
  runner: CheckRunner;
  /** the declared gate, or null (absent config → every outcome 'absent'). */
  checks: GreenGateConfig | null;
  /** scratch parent dir for restores (default: a fresh os.tmpdir() mkdtemp). */
  scratchBase?: string;
  /** clock injection for deterministic tests (default: new Date().toISOString()). */
  now?: () => string;
}

const safeSegment = (id: string): string => id.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-48);

async function runOn(runner: CheckRunner, spec: CheckSpec, cwd: string): Promise<'pass' | 'fail'> {
  const r = await runner(spec, cwd);
  return r.status;
}

/**
 * Audit ONE target (§4 steps 1–3): restore the result tree — and, when a recipe
 * is present, ours+theirs — into scratch dirs; run every declared check on the
 * PARENTS FIRST (a check red on either parent alone → 'excluded-parent-red' for
 * this target); else run it on the merged tree. objectiveRegression = any check
 * green on BOTH parents and red on the merge. Single-parent seals skip the power
 * rule (mode:'single-parent', checks run on the result only, objectiveRegression
 * always false — there is no merge to regress).
 */
export async function auditOne(target: AuditTarget, opts: AuditOneOptions): Promise<OracleRowBody> {
  const { store, runner, checks } = opts;
  const now = opts.now ?? ((): string => new Date().toISOString());
  const notes: string[] = [];
  const mode: 'merge' | 'single-parent' = target.recipe ? 'merge' : 'single-parent';

  // Changed paths: a merge's change set is the union of each side's changes vs the
  // base (added ∪ removed ∪ modified per side); a single-parent seal's is its diff
  // vs its (bound) parent tree. Underivable ⇒ null (coveredClass then false).
  let changedPaths: string[] | null = null;
  try {
    if (target.recipe && target.recipe.baseTreeId) {
      const set = new Set<string>();
      for (const sideTree of [target.recipe.oursTreeId, target.recipe.theirsTreeId]) {
        const d = diffTrees(store, target.recipe.baseTreeId, sideTree);
        for (const p of [...d.added, ...d.removed, ...d.modified]) set.add(p);
      }
      changedPaths = [...set].sort();
    } else if (!target.recipe && target.mergedTreeId && target.parentTreeIds[0]) {
      const d = diffTrees(store, target.parentTreeIds[0], target.mergedTreeId);
      changedPaths = [...d.added, ...d.removed, ...d.modified].sort();
    } else {
      notes.push('changed paths underivable (missing base/parent tree) — coveredClass recorded false, not guessed');
    }
  } catch (err) {
    changedPaths = null;
    notes.push(`changed paths underivable (${(err as Error).message}) — coveredClass recorded false, not guessed`);
  }
  const covered = coveredClassOf(changedPaths);

  const checkOutcomes: Record<string, FieldCheckOutcome> = {};
  const behavioralOutcomes: Record<string, FieldCheckOutcome> = {};
  let objectiveRegression = false;

  const resultTreeId = target.mergedTreeId ?? target.recipe?.resultTreeId ?? null;

  if (checks === null) {
    // Absent config: EVERY outcome is 'absent' and the row says so (§4 — the
    // default is not a pass). With no declared names, one honest sentinel row.
    checkOutcomes['greengate'] = 'absent';
    notes.push('no .warpline/field/greengate.json — every check recorded absent; this seal is untested, not passed');
  } else if (resultTreeId === null) {
    for (const c of checks.checks) checkOutcomes[c.name] = 'absent';
    for (const a of checks.behavioral?.assertions ?? []) behavioralOutcomes[a] = 'absent';
    notes.push('no restorable result tree (strand unbound) — every check recorded absent');
  } else {
    const scratchBase = opts.scratchBase ?? fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-field-oracle-'));
    const scratch = path.join(scratchBase, safeSegment(target.pickId));
    try {
      const mergedDir = path.join(scratch, 'merged');
      restoreTree(store, resultTreeId, mergedDir);

      let oursDir: string | null = null;
      let theirsDir: string | null = null;
      if (target.recipe) {
        oursDir = path.join(scratch, 'ours');
        theirsDir = path.join(scratch, 'theirs');
        restoreTree(store, target.recipe.oursTreeId, oursDir);
        restoreTree(store, target.recipe.theirsTreeId, theirsDir);
      }

      // Every unit — a declared check, or one frozen behavioral assertion run as
      // `script <assertion>` through the SAME injected runner — follows the same
      // §4 power discipline: parents first, merged tree only when both are green.
      const units: Array<{ spec: CheckSpec; sink: Record<string, FieldCheckOutcome>; key: string }> = [
        ...checks.checks.map((c) => ({ spec: c, sink: checkOutcomes, key: c.name })),
        ...(checks.behavioral?.assertions ?? []).map((assertion) => ({
          spec: { name: `behavioral:${assertion}`, cmd: checks.behavioral!.script, args: [assertion] },
          sink: behavioralOutcomes,
          key: assertion,
        })),
      ];

      for (const unit of units) {
        if (target.recipe && oursDir && theirsDir) {
          // ESTABLISHING POWER: both parents run BEFORE the merge is judged.
          const onOurs = await runOn(runner, unit.spec, oursDir);
          const onTheirs = await runOn(runner, unit.spec, theirsDir);
          if (onOurs === 'fail' || onTheirs === 'fail') {
            unit.sink[unit.key] = 'excluded-parent-red'; // proves nothing about the merge
            continue;
          }
          const onMerged = await runOn(runner, unit.spec, mergedDir);
          unit.sink[unit.key] = onMerged;
          if (onMerged === 'fail') objectiveRegression = true; // green-both-parents ∧ red-on-merge
        } else {
          // single-parent: no merge to regress — the power rule is not applicable.
          unit.sink[unit.key] = await runOn(runner, unit.spec, mergedDir);
        }
      }
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }

  // Did ANY unit actually pass/fail on the merged/result tree? Without one, the
  // seal is untested and may not read 'true-clean'.
  const merged = [...Object.values(checkOutcomes), ...Object.values(behavioralOutcomes)];
  const anyTested = merged.some((o) => o === 'pass' || o === 'fail');

  const verdict: OracleRowBody['verdict'] = objectiveRegression
    ? 'candidate-false-clean'
    : !covered.coveredClass || !anyTested
      ? 'blind-untested'
      : 'true-clean';

  return {
    schemaVersion: FIELD_ORACLE_ROW_SCHEMA,
    ts: now(),
    strandId: target.strandId,
    pickId: target.pickId,
    seq: target.seq,
    mode,
    agents: target.agents,
    parentStateIds: target.parentStateIds,
    mergedTreeId: resultTreeId,
    greengate: checks === null ? 'absent' : 'declared',
    oracle: {
      checks: checkOutcomes,
      ...(Object.keys(behavioralOutcomes).length > 0 ? { behavioral: behavioralOutcomes } : {}),
    },
    changedPaths,
    coveredClass: covered.coveredClass,
    blind: covered.blind,
    objectiveRegression,
    source: objectiveRegression ? 'oracle-flagged' : 'clean-sweep',
    verdict,
    notes,
  };
}

/* ── the hash-chained ledger (.warpline/field/expo-field-oracle.jsonl) ───────── */

export function fieldOracleLedgerPathOf(root: string): string {
  return path.join(root, '.warpline', 'field', 'expo-field-oracle.jsonl');
}

/** rowHash = 'fieldOracleRow:v1:' + sha256(canonical(body) + (prevRowHash ?? '')). */
export function oracleRowHashOf(body: OracleRowBody, prevRowHash: string | null): string {
  const canon = canonicalSerialize(canonicalSafe(body as unknown));
  return (
    FIELD_ORACLE_ROW_SCHEMA + ':' + createHash('sha256').update(canon + (prevRowHash ?? ''), 'utf8').digest('hex')
  );
}

/** Every sealed ledger row, file order. [] when the ledger has never been written. */
export function readAuditLedger(root: string): OracleRow[] {
  const p = fieldOracleLedgerPathOf(root);
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`warpline: field oracle ledger unreadable at ${p}: ${(err as Error).message}`);
  }
  const out: OracleRow[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    out.push(JSON.parse(line) as OracleRow); // fail closed on a torn/corrupt line
  }
  return out;
}

/**
 * Per-ledger-path HEAD cache (reviewer follow-on, 2026-08-23): `appendAuditRow`
 * used to re-read the WHOLE ledger to find the tail on every append — O(n²)
 * across a run. The first append through this process still LOADS AND VERIFIES
 * the full on-disk chain (verify-on-load is kept: nothing is appended onto a
 * broken chain); every later append chains onto the cached head. The cache is
 * process-local — an external write to the file between appends in the SAME
 * process is not re-detected until the next process (the ledger is single-writer
 * by run procedure, and `verifyAuditLedger` still catches it after the fact).
 */
const ledgerHeadCache = new Map<string, string | null>();

/** Append one audited row, chained onto the current tail. Returns the sealed row. */
export function appendAuditRow(root: string, body: OracleRowBody): OracleRow {
  const p = fieldOracleLedgerPathOf(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let prevRowHash: string | null;
  if (ledgerHeadCache.has(p)) {
    prevRowHash = ledgerHeadCache.get(p)!;
  } else {
    // First append through this process: load + VERIFY the whole chain once.
    const rows = readAuditLedger(root);
    const v = verifyOracleRowChain(rows);
    if (!v.ok) {
      throw new Error(
        `warpline: field oracle ledger ${p} fails verification at row ${v.firstBadIndex}: ${v.detail ?? '(no detail)'} — refusing to append onto a broken chain`,
      );
    }
    prevRowHash = rows.length ? rows[rows.length - 1].rowHash : null;
  }
  const row: OracleRow = { ...body, prevRowHash, rowHash: oracleRowHashOf(body, prevRowHash) };
  appendDurableSync(p, JSON.stringify(row) + '\n');
  ledgerHeadCache.set(p, row.rowHash);
  return row;
}

export interface AuditLedgerVerifyResult {
  ok: boolean;
  rows: number;
  firstBadIndex: number | null;
  detail?: string;
}

/** Walk an in-memory row sequence: recompute every rowHash + check every link. */
export function verifyOracleRowChain(rows: readonly OracleRow[]): AuditLedgerVerifyResult {
  for (let i = 0; i < rows.length; i++) {
    const { rowHash, prevRowHash, ...body } = rows[i];
    const expectedPrev = i === 0 ? null : rows[i - 1].rowHash;
    if ((prevRowHash ?? null) !== expectedPrev) {
      return { ok: false, rows: rows.length, firstBadIndex: i, detail: `row ${i}: prevRowHash ${prevRowHash ?? '(null)'} != preceding rowHash ${expectedPrev ?? '(null)'} (chain break)` };
    }
    const recomputed = oracleRowHashOf(body as OracleRowBody, prevRowHash);
    if (recomputed !== rowHash) {
      return { ok: false, rows: rows.length, firstBadIndex: i, detail: `row ${i}: recomputed ${recomputed} != stored ${rowHash} (tampered row body)` };
    }
  }
  return { ok: true, rows: rows.length, firstBadIndex: null };
}

/** Walk the on-disk chain: recompute every rowHash + check every prevRowHash link. */
export function verifyAuditLedger(root: string): AuditLedgerVerifyResult {
  return verifyOracleRowChain(readAuditLedger(root));
}

/* ── the run orchestration (discover → audit → append; idempotent) ───────────── */

export interface FieldOracleRunOptions {
  runner: CheckRunner;
  /** only targets with seq > since are audited (v3 strands carry no seq and always qualify). */
  since?: number;
  /** explicit greengate.json path (default: .warpline/field/greengate.json). */
  greengatePath?: string;
  scratchBase?: string;
  now?: () => string;
}

export interface FieldOracleRunResult {
  audited: OracleRow[];
  skipped: number;
  greengate: 'declared' | 'absent';
}

/**
 * The whole §4 pass: discover targets, drop the ones ALREADY in the ledger
 * (idempotent by strandId), audit each, append each row. Pure orchestration over
 * the pieces above — the CLI adds only argv parsing + printing.
 */
export async function runFieldOracle(root: string, opts: FieldOracleRunOptions): Promise<FieldOracleRunResult> {
  const config = readGreenGate(root, opts.greengatePath);
  const already = new Set(readAuditLedger(root).map((r) => r.strandId));
  const store = new ObjectStore(root);
  let skipped = 0;
  const targets = discoverAuditTargets(root).filter((t) => {
    if (already.has(t.strandId)) {
      skipped++;
      return false;
    }
    if (opts.since !== undefined && t.seq !== null && t.seq <= opts.since) return false;
    return true;
  });
  const audited: OracleRow[] = [];
  for (const t of targets) {
    const body = await auditOne(t, {
      store,
      runner: opts.runner,
      checks: config,
      scratchBase: opts.scratchBase,
      now: opts.now,
    });
    audited.push(appendAuditRow(root, body));
  }
  return { audited, skipped, greengate: config === null ? 'absent' : 'declared' };
}
