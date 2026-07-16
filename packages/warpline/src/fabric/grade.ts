/**
 * #grade — the calibration grader (Loid's moat). A #strand's calibratedConfidence
 * is SEEDED at admit from the gate rule; this grades it against REAL OUTCOME, the
 * one thing a git-backed history structurally can't carry. Mirrors the classroom
 * certify→outcome loop (survive / overturn):
 *
 *   A strand's AUTHORED symbols = delta.born ∪ delta.contractChanged.
 *   - OVERTURNED: a later strand RETIRED one of them, OR a #resolve named one in
 *     its resolves.contended (this pick caused a collision a human had to settle)
 *     → lower confidence (the meaning didn't hold).
 *   - SURVIVED: none overturned AND ≥ window later strands exist (they held) →
 *     raise confidence.
 *   - PENDING: not enough later history yet → leave at the seed.
 *
 * THE MOAT EXPERIMENT: bucket graded strands by their seed PRIOR class (linked /
 * independent / fast-admit / pick) and report survival rate — the falsifiable
 * question "does the linked/independent gate-rule prior predict survival?".
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { warplineDirOf, readFabric, rewriteFabric, appendGradeEvent } from './fabric.js';
import { withFabricLock } from './lock.js';
import { findAnchor } from './anchor.js';
import type { Strand } from './strand.js';
import type { AdmitDecision } from './admit.js';

const PICK_PRIOR = 0.7; // a single-writer pick has no gate-rule seed
const DEFAULT_WINDOW = 2; // later strands required before "survived"

/**
 * P3 Lane A2 escalation constants — STARTING GUESSES, calibration-pending
 * (TD-2026-07-16-426, the organic arm: these move only when the graded outcome
 * corpus says so — do NOT hand-tune). A symbol participates in escalation only
 * once it has K_MIN_GRADED graded (survived|overturned) outcomes; an
 * independent-CLEAN admit touching a symbol whose survival is below
 * SURVIVAL_FLOOR is HELD (see admit.ts; forge-spec §1d permissions→scrutiny).
 */
export const K_MIN_GRADED = 3;
export const SURVIVAL_FLOOR = 0.5;

export type GradeOutcome = 'survived' | 'overturned' | 'pending' | 'baseline';
export type PriorClass = 'linked' | 'independent' | 'fast-admit' | 'pick';

export interface StrandGrade {
  pickId: string;
  seq: number;
  stateId: string;
  outcome: GradeOutcome;
  /** authoredBy.agentId of the graded strand — the WHO key (null when unattributed). */
  agentId: string | null;
  /** the authored symbol set the outcome was judged over (born ∪ contractChanged, sorted). */
  authoredSymbols: string[];
  authoredCount: number;
  overturnedSymbols: string[];
  confidenceBefore: number | null;
  confidenceAfter: number | null;
  priorClass: PriorClass;
  reason: string;
}

export interface MoatBucket {
  survived: number;
  overturned: number;
  pending: number;
}

export interface GradeReport {
  grades: StrandGrade[];
  /** survival outcomes bucketed by the seed prior class — the moat-thesis signal. */
  moat: Record<PriorClass, MoatBucket>;
  /** survival bucketed by authoredBy.agentId (P3 Lane A2 — unattributed strands are skipped). */
  byAgent: Record<string, MoatBucket>;
  /** survival bucketed by authored SYMBOL, per-symbol outcome (P3 Lane A2; see symbolOutcomeOf). */
  bySymbol: Record<string, MoatBucket>;
}

/**
 * The PER-SYMBOL outcome of a graded strand (P3 Lane A2). A strand's outcome is
 * strand-level ("overturned" = ANY authored symbol overturned), so a symbol on an
 * overturned strand that was NOT itself overturned has an UNKNOWN survival window —
 * it is not graded (null), never counted as survived. Conservative by design.
 */
function symbolOutcomeOf(
  g: { outcome: GradeOutcome; overturnedSymbols?: string[] },
  symbol: string,
): GradeOutcome | null {
  if (g.outcome === 'baseline') return null;
  if ((g.overturnedSymbols ?? []).includes(symbol)) return 'overturned';
  if (g.outcome === 'survived') return 'survived';
  if (g.outcome === 'pending') return 'pending';
  return null; // overturned strand, non-overturned symbol — window unknown
}

/** Infer the gate-rule prior class from a strand's seed confidence value. */
function priorClassOf(seed: number | null): PriorClass {
  if (seed === null) return 'pick';
  if (seed >= 0.85) return 'linked'; // CLEAN linked → 0.9
  if (seed >= 0.75) return 'fast-admit'; // FAST_ADMIT → 0.8
  return 'independent'; // CLEAN independent → 0.6
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Compute the grade for every strand in the fabric (pure — no writes). */
export function gradeFabric(root: string, opts: { window?: number } = {}): GradeReport {
  const window = opts.window ?? DEFAULT_WINDOW;
  const fabric = readFabric(warplineDirOf(root));
  const grades: StrandGrade[] = [];

  for (let i = 0; i < fabric.length; i++) {
    const s = fabric[i];
    const authored = Array.from(new Set([...s.delta.born, ...s.delta.contractChanged]));
    const base: Omit<StrandGrade, 'outcome' | 'confidenceAfter' | 'reason'> = {
      pickId: s.pickId,
      seq: s.seq ?? i, // v3 strands are position-free — report the arrival index
      stateId: s.stateId,
      agentId: s.authoredBy?.agentId ?? null,
      authoredSymbols: [...authored].sort(),
      authoredCount: authored.length,
      overturnedSymbols: [],
      confidenceBefore: s.calibratedConfidence ?? null,
      priorClass: priorClassOf(s.calibratedConfidence ?? null),
    };

    // Genesis / empty-delta strands aren't calibrated decisions. (v3 genesis =
    // parents: [] — there is no stored seq on a v3 strand.)
    const isGenesis = s.schemaVersion >= 3 ? (s.parents ?? []).length === 0 : s.seq === 0;
    if (isGenesis || authored.length === 0) {
      grades.push({ ...base, outcome: 'baseline', confidenceAfter: s.calibratedConfidence ?? null, reason: 'baseline / no authored symbols' });
      continue;
    }

    const later = fabric.slice(i + 1);
    const overturned = new Set<string>();
    for (const l of later) {
      for (const sym of l.delta.retired) if (authored.includes(sym)) overturned.add(sym);
      for (const sym of l.resolves?.contended ?? []) if (authored.includes(sym)) overturned.add(sym);
    }
    const overturnedSymbols = Array.from(overturned).sort();
    const seed = s.calibratedConfidence ?? PICK_PRIOR;

    let outcome: GradeOutcome;
    let after: number;
    let reason: string;
    if (overturnedSymbols.length > 0) {
      outcome = 'overturned';
      const frac = overturnedSymbols.length / authored.length;
      after = round2(Math.max(0.1, seed * (1 - 0.5 * frac)));
      reason = `${overturnedSymbols.length}/${authored.length} authored symbol(s) later retired or contended`;
    } else if (later.length >= window) {
      outcome = 'survived';
      after = round2(Math.min(0.97, seed + 0.1));
      reason = `all ${authored.length} authored symbol(s) held across ${later.length} later strand(s)`;
    } else {
      outcome = 'pending';
      after = round2(seed);
      reason = `only ${later.length} later strand(s) — survival window (${window}) not met`;
    }
    grades.push({ ...base, outcome, overturnedSymbols, confidenceAfter: after, reason });
  }

  const empty = (): MoatBucket => ({ survived: 0, overturned: 0, pending: 0 });
  const moat: Record<PriorClass, MoatBucket> = { linked: empty(), independent: empty(), 'fast-admit': empty(), pick: empty() };
  // P3 Lane A2 — the same outcomes keyed by WHO (agentId) and by WHAT (symbol),
  // both additive dimensions. These land in the grades sidecar rows via
  // applyGrades (the StrandGrade now carries agentId + authoredSymbols), which is
  // what the escalation consumer below reads (v3-sidecar-bound, TD-2026-07-16-277 §9.3).
  const byAgent: Record<string, MoatBucket> = {};
  const bySymbol: Record<string, MoatBucket> = {};
  for (const g of grades) {
    if (g.outcome === 'baseline') continue;
    moat[g.priorClass][g.outcome]++;
    if (g.agentId) {
      (byAgent[g.agentId] ??= empty())[g.outcome as Exclude<GradeOutcome, 'baseline'>]++;
    }
    for (const sym of g.authoredSymbols) {
      const o = symbolOutcomeOf(g, sym);
      if (o && o !== 'baseline') (bySymbol[sym] ??= empty())[o]++;
    }
  }
  return { grades, moat, byAgent, bySymbol };
}

/**
 * Persist a grade run: update each strand's calibratedConfidence in the ledger
 * (the pickId is unchanged — confidence is excluded from it) and append the
 * trajectory to .warpline/grades.jsonl. Runs under #fabric-lock so it can't race
 * a concurrent seal. `now` is injectable for determinism.
 */
export async function applyGrades(root: string, report: GradeReport, now: string): Promise<void> {
  const wdir = warplineDirOf(root);
  await withFabricLock(root, () => {
    const fabric = readFabric(wdir);
    // FREEZE (spec §7): once the fabric is attested, a v1 strand's calibratedConfidence
    // is FROZEN at its attested value — rewriteFabric would refuse the mutation. Skip
    // v1 strands in the LEDGER rewrite; their grade EVENTS still land in grades.jsonl
    // below (the trajectory lives in the sidecar, the frozen byte does not move).
    const frozen = findAnchor(fabric) !== undefined;
    const byPick = new Map(report.grades.map((g) => [g.pickId, g]));
    const updated: Strand[] = fabric.map((s) => {
      if (frozen && s.schemaVersion < 2) return s; // v1 confidence frozen by the anchor
      // v3 strands carry NO calibratedConfidence AT ALL (v3-identity §7 — zero
      // mutable fields); their grade trajectory lives ONLY in grades.jsonl below.
      if (s.schemaVersion >= 3) return s;
      const g = byPick.get(s.pickId);
      return g && g.confidenceAfter !== (s.calibratedConfidence ?? null)
        ? { ...s, calibratedConfidence: g.confidenceAfter }
        : s;
    });
    rewriteFabric(wdir, updated);
    for (const g of report.grades) {
      if (g.outcome === 'baseline') continue;
      appendGradeEvent(wdir, { at: now, ...g });
    }
  });
}

/* ── the sidecar CONSUMER (P3 Lane A2 — the calibration loop's first consumer) ───
 *
 * Everything below reads the grades SIDECAR (.warpline/grades.jsonl — the
 * authoritative trust stream, v3-identity §7 / G5) and feeds exactly ONE
 * consumer: admit's trust-floor escalation (admit.ts; forge-spec §1d — the
 * permission model IS the scrutiny policy). The escalation decision is a PURE
 * function of (decision, sidecar snapshot): no clock, no disk, no randomness.
 */

/** One grades.jsonl row: `{ at, ...StrandGrade }`. Pre-A2 rows lack the keyed fields. */
export interface GradeSidecarRow {
  at: string;
  pickId: string;
  outcome: GradeOutcome;
  agentId?: string | null;
  authoredSymbols?: string[];
  overturnedSymbols?: string[];
}

export function gradesPathOf(root: string): string {
  return path.join(warplineDirOf(root), 'grades.jsonl');
}

/** All recorded grade rows, file order (unreadable rows skipped, never fatal). */
export function readGradeSidecar(root: string): GradeSidecarRow[] {
  const file = gradesPathOf(root);
  if (!fs.existsSync(file)) return [];
  const out: GradeSidecarRow[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as GradeSidecarRow;
      if (typeof row?.pickId === 'string' && typeof row?.outcome === 'string') out.push(row);
    } catch {
      /* skip */
    }
  }
  return out;
}

/** A symbol's graded survival, folded from the sidecar. */
export interface SymbolSurvival {
  survived: number;
  overturned: number;
  /** graded = survived + overturned (pending/ungradeable rows never count). */
  graded: number;
  /** survived / graded — meaningless below K_MIN_GRADED (the consumer checks). */
  survival: number;
}

/**
 * Fold the sidecar into per-symbol survival. The sidecar is a TRAJECTORY (every
 * grade run appends), so the LATEST row per pickId wins — a pick's outcome can
 * move pending→survived/overturned across runs and must not double-count.
 * Rows without authoredSymbols (pre-A2) carry no symbol key and are skipped.
 * Pure over its input.
 */
export function symbolSurvivalIndex(rows: GradeSidecarRow[]): Map<string, SymbolSurvival> {
  const latest = new Map<string, GradeSidecarRow>();
  for (const row of rows) latest.set(row.pickId, row); // file order — last wins
  const index = new Map<string, SymbolSurvival>();
  for (const row of latest.values()) {
    for (const sym of row.authoredSymbols ?? []) {
      const o = symbolOutcomeOf(row, sym);
      if (o !== 'survived' && o !== 'overturned') continue; // only GRADED outcomes count
      const e = index.get(sym) ?? { survived: 0, overturned: 0, graded: 0, survival: 0 };
      e[o]++;
      e.graded = e.survived + e.overturned;
      e.survival = e.survived / e.graded;
      index.set(sym, e);
    }
  }
  return index;
}

/** The escalation verdict admit surfaces on a HELD result (constants echoed for the report). */
export interface GradeEscalation {
  /** the touched symbol with the WORST qualifying graded survival. */
  symbol: string;
  survival: number;
  /** graded outcome count for that symbol (n). */
  graded: number;
  floor: number;
  kMin: number;
}

/**
 * THE ONE CONSUMER RULE (P3 Lane A2; forge-spec §1d): an admit whose verdict is
 * CLEAN with confidence 'independent' — the autoClean class the false-AUTOFOLD
 * gate proved blind — touching a symbol whose graded survival is below
 * SURVIVAL_FLOOR (min across touched symbols, counted only when that symbol has
 * ≥ K_MIN_GRADED graded outcomes) escalates to HELD. Everything else — LINKED
 * clean, KNOT/DANGLE, FAST_ADMIT, symbols without enough grades, an empty
 * sidecar — returns null: behavior exactly as before this rule existed.
 * PURE function of (decision, sidecar-derived index).
 */
export function evaluateEscalation(
  decision: Pick<AdmitDecision, 'status' | 'confidence' | 'agentChanged'>,
  index: Map<string, SymbolSurvival>,
): GradeEscalation | null {
  if (decision.status !== 'CLEAN' || decision.confidence !== 'independent') return null;
  let worst: { symbol: string; e: SymbolSurvival } | null = null;
  for (const symbol of decision.agentChanged) {
    const e = index.get(symbol);
    if (!e || e.graded < K_MIN_GRADED) continue; // not enough evidence — no verdict on this symbol
    if (!worst || e.survival < worst.e.survival) worst = { symbol, e };
  }
  if (!worst || worst.e.survival >= SURVIVAL_FLOOR) return null;
  return {
    symbol: worst.symbol,
    survival: worst.e.survival,
    graded: worst.e.graded,
    floor: SURVIVAL_FLOOR,
    kMin: K_MIN_GRADED,
  };
}

/* ── the escalation-override stream (.warpline/grades-escalations.jsonl — G5) ─── */

/** One accepted-risk override row: a HELD escalation the caller explicitly sealed through. */
export interface GradeEscalationRow extends GradeEscalation {
  agentId: string;
  /** the sealed strand the override admitted (null when the admit still did not seal). */
  pickId: string | null;
  acceptedRisk: true;
  ts: string;
}

export function escalationsPathOf(root: string): string {
  return path.join(warplineDirOf(root), 'grades-escalations.jsonl');
}

/** Append one override row (never written unless --accept-risk actually overrode a HELD). */
export function recordGradeEscalation(root: string, row: GradeEscalationRow): void {
  const p = escalationsPathOf(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(row) + '\n', 'utf8');
}

/** All recorded override rows (unreadable rows skipped, never fatal). */
export function listGradeEscalations(root: string): GradeEscalationRow[] {
  const file = escalationsPathOf(root);
  if (!fs.existsSync(file)) return [];
  const out: GradeEscalationRow[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as GradeEscalationRow);
    } catch {
      /* skip */
    }
  }
  return out;
}
