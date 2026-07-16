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

import { warplineDirOf, readFabric, rewriteFabric, appendGradeEvent } from './fabric.js';
import { withFabricLock } from './lock.js';
import { findAnchor } from './anchor.js';
import type { Strand } from './strand.js';

const PICK_PRIOR = 0.7; // a single-writer pick has no gate-rule seed
const DEFAULT_WINDOW = 2; // later strands required before "survived"

export type GradeOutcome = 'survived' | 'overturned' | 'pending' | 'baseline';
export type PriorClass = 'linked' | 'independent' | 'fast-admit' | 'pick';

export interface StrandGrade {
  pickId: string;
  seq: number;
  stateId: string;
  outcome: GradeOutcome;
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
  for (const g of grades) {
    if (g.outcome === 'baseline') continue;
    moat[g.priorClass][g.outcome]++;
  }
  return { grades, moat };
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
