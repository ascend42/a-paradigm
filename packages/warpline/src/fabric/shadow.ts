/**
 * #shadow-gate — R1 of the native-first dogfood ladder (loid-loops.md §1;
 * roadmap-native-first.md "START IMMEDIATELY"). `admit --shadow` runs the FULL
 * decision pipeline — claim gate (when a claim is given), verdict, trust-floor
 * escalation check, coverage labels, knot-payload build — and then does NOTHING
 * to the fabric: never seals, never moves the selvage, never writes fabric/
 * objects/sidecars. The ONLY write is one JSONL row appended to
 * `.warpline/shadow/verdicts.jsonl` — the organic evidence clock (organic K3
 * telemetry, F1a latency, would-have-held counts) at zero friction risk.
 *
 * The decision FUNCTION is untouched (admitDecision + the claim/trust gates run
 * verbatim); `shadow` is a routing flag in #admit that swaps every write for a
 * return. Wire-in points:
 *   - CLI: `warpline admit <agent> --shadow [--ref R] [--claim C]`
 *   - #pick (the auto-seal #hook path): when `.warpline/config.json` sets
 *     `shadowGate: true` (#warpline-config), every pick also records the shadow
 *     verdict of the sealed state vs the pre-seal selvage (fail-safe: a shadow
 *     failure never blocks a seal).
 *
 * ROW STABILITY (G1): `shadowVerdict:v1` — additive evolution only; consumers
 * (the weekly K3 aggregate, F1 friction reports) key on named fields, never
 * position.
 *
 * ROW BOUNDS (R1 hygiene, T-2026-07-17-007): a WORKTREE verdict on a real
 * monorepo can list thousands of changed symbols; unbounded rows would bloat
 * the live telemetry file. The symbol arrays (`knots`, `agentChanged`,
 * `otherChanged`) are therefore capped at SHADOW_ROW_CAP entries each (sorted —
 * a deterministic top-N), with ADDITIVE total-count fields (`knotsTotal`,
 * `agentChangedTotal`, `otherChangedTotal`) carrying the true sizes. Verdicts
 * under the cap keep full symbol fidelity; the schema stays v1 (additive only).
 * The counterfactual's `conflictPaths` is bounded by the SAME constant.
 *
 * THE GIT COUNTERFACTUAL (#git-counterfactual, additive): every row now also
 * records what `git merge-tree` would have decided about the same two sides.
 * The product claim is "meaning caught what bytes missed" and until this field
 * existed nothing on any stream measured it — #oracle computed the confusion
 * matrix but is an offline manual verb whose ledger has zero readers, and this
 * gate, the only thing that fires on real work, never called git at all. It is
 * measured HERE and not in a later pass because it is the one fact that cannot
 * be reconstructed: which two commits a verdict adjudicated stops being
 * recoverable the moment the selvage moves.
 *
 * THE WRITE BOUNDARY, RESTATED PRECISELY. The shadow invariant is unchanged and
 * still exact for everything it ever covered: `.warpline/` is byte-identical
 * except the one verdict row, and HEAD/index/worktree are untouched. The
 * counterfactual does, however, run `git merge-tree --write-tree`, which parks
 * a few unreferenced (gc-able) tree objects in `.git/objects` — read-only with
 * respect to every pointer, not literally write-free. Said out loud rather than
 * left for someone to discover on a full disk.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { admit, type AdmitOptions, type AdmitStatus, type AdmitConfidence, type AdmitResult, type AdmitBaseSource } from './admit.js';
import { gitCounterfactual, type GitCounterfactual } from './counterfactual.js';
import type { CoverageCounts } from '../honesty.js';

export const SHADOW_VERDICT_SCHEMA = 'shadowVerdict:v1' as const;

/** Max entries per symbol array in a row (T-2026-07-17-007) — totals stay exact. */
export const SHADOW_ROW_CAP = 50;

/** One observe-only admission verdict — the R1 telemetry row (G1-versioned). */
export interface ShadowVerdictRow {
  schemaVersion: typeof SHADOW_VERDICT_SCHEMA;
  /** ISO timestamp the row was recorded. */
  ts: string;
  /** the proposed side: a git ref, or WORKTREE (the ref/worktree id). */
  ref: string;
  agentId: string;
  status: AdmitStatus;
  /** the CLEAN gate-rule confidence (linked | independent), else null. */
  confidence: AdmitConfidence | null;
  /** contested symbols (knots + dangles) — [] on a clean verdict. CAPPED at
   * SHADOW_ROW_CAP entries (sorted top-N); `knotsTotal` carries the true count. */
  knots: string[];
  /** capped like `knots`; `agentChangedTotal` / `otherChangedTotal` are exact. */
  agentChanged: string[];
  otherChanged: string[];
  /** exact sizes of the (possibly capped) arrays above — additive fields (G1);
   * absent on rows recorded before T-2026-07-17-007 (then array.length is exact). */
  knotsTotal?: number;
  agentChangedTotal?: number;
  otherChangedTotal?: number;
  /** honesty-label aggregate for a materializable CLEAN (null when not computed). */
  coverage: CoverageCounts | null;
  /** would the REAL gate have sealed this admission? (FAST_ADMIT, or a conflict-free CLEAN plan). */
  wouldSeal: boolean;
  proposedStateId: string;
  /** wall-clock of the full shadow pipeline (F1a latency, measured from R1 on). */
  durationMs: number;
  /** the trust-floor escalation, when one fired (HELD would-be-interruption). */
  escalation?: { symbol: string; survival: number; graded: number; floor: number };
  /** the claim judgment, when the shadow admit carried a claim. */
  claimReport?: { claimId: string; breach: boolean; excess: string[]; missing: string[] };
  /** content address of the (built, NOT persisted) knot payload — pipeline proof, not a pointer. */
  knotPayloadId?: string;
  /** R2 (additive): 'real' when this verdict was ENFORCED on an agent-attributed
   * pick (gate.agentWrites 'real'); absent = observe-only (R1 rows unchanged). */
  gate?: 'real';
  /** R2 (additive): true when a would-not-seal verdict was explicitly sealed
   * through via `pick --accept-risk` (never silent — the hold is on the row). */
  overridden?: boolean;
  /**
   * C-9 (additive): WHERE the verdict's base came from — see AdmitBaseSource.
   * `'selvage'` means the gate had NO agent base and FAST_ADMIT was structurally
   * forced, which is a different fact from "nothing contended" and used to be
   * indistinguishable from it on this stream. Carried verbatim from the value
   * `admit` actually decided with (never re-read here — a second reader of the
   * scratch ref would report what the row's own authority did not use).
   * Absent on rows recorded before this field existed.
   */
  baseFrom?: AdmitBaseSource;
  /**
   * THE GIT COUNTERFACTUAL (additive) — what `git merge-tree` would have
   * decided about the SAME two sides, measured at verdict time. See
   * #git-counterfactual for why this cannot be reconstructed afterwards and why
   * its `unavailable` field is a required enum rather than an absence.
   *
   * OPTIONAL ON THE TYPE, MANDATORY ON A NEW ROW. Every row minted from here on
   * carries it; the rows already on this stream predate it and simply lack it
   * (G1 additive evolution). A reader must therefore distinguish THREE states,
   * not two — measured, explicitly-unavailable, and predates-the-field — which
   * is exactly the distinction `baseFrom` above exists to preserve, and
   * `warpline health` reports all three separately for that reason.
   */
  gitCounterfactual?: GitCounterfactual;
}

export function shadowDirOf(root: string): string {
  return path.join(root, '.warpline', 'shadow');
}

export function shadowVerdictsPathOf(root: string): string {
  return path.join(shadowDirOf(root), 'verdicts.jsonl');
}

/** Append one shadow row (the only write the shadow gate ever performs). */
export function appendShadowVerdict(root: string, row: ShadowVerdictRow): void {
  fs.mkdirSync(shadowDirOf(root), { recursive: true });
  fs.appendFileSync(shadowVerdictsPathOf(root), JSON.stringify(row) + '\n', 'utf8');
}

/** All recorded shadow rows (unreadable lines skipped — telemetry, never fatal). */
export function readShadowVerdicts(root: string): ShadowVerdictRow[] {
  const p = shadowVerdictsPathOf(root);
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return [];
  }
  const out: ShadowVerdictRow[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as ShadowVerdictRow);
    } catch {
      /* skip — telemetry stream, never fatal */
    }
  }
  return out;
}

export interface ShadowAdmitResult {
  result: AdmitResult;
  row: ShadowVerdictRow;
}

/** R2 metadata riding the row when #pick ENFORCES the verdict (gate 'real'). */
export interface ShadowGateMeta {
  /** the verdict is enforced, not observe-only (recorded as row.gate). */
  gate: 'real';
  /** caller-declared override intent: when the verdict would NOT seal, the
   * caller seals anyway and the row records overridden:true. */
  acceptRisk?: boolean;
}

/**
 * Run the full admission pipeline in OBSERVE-ONLY mode and append the verdict
 * row. The fabric/selvage/objects/sidecars are byte-identical before and after
 * (the shadow invariant — pinned by test/shadow-admit.test.ts).
 *
 * R2: `meta` (optional) marks the row as an ENFORCED verdict (#pick gate
 * 'real'). shadowAdmit itself STILL never writes the fabric — enforcement
 * (refuse-to-seal) is the CALLER's move, keyed off row.wouldSeal; the meta only
 * makes the enforcement + any override durable on the telemetry row.
 */
export async function shadowAdmit(
  root: string,
  opts: Omit<AdmitOptions, 'shadow'>,
  meta?: ShadowGateMeta,
): Promise<ShadowAdmitResult> {
  const t0 = Date.now();
  const result = await admit(root, { ...opts, shadow: true });
  const d = result.decision;
  const wouldSeal =
    d.status === 'FAST_ADMIT' ||
    (d.status === 'CLEAN' && result.merged !== undefined && result.merged.conflicts.length === 0);
  // Bounded symbol arrays (T-2026-07-17-007): sort (deterministic top-N), cap,
  // and carry the exact totals as additive fields. Under the cap = full fidelity.
  const knots = Array.from(
    new Set([...d.knots.map((k) => k.symbol), ...d.dangling.map((x) => x.fromSymbol)]),
  ).sort();
  const agentChanged = [...d.agentChanged].sort();
  const otherChanged = [...d.otherChanged].sort();
  // F1a latency keeps its ORIGINAL meaning — the DECISION pipeline — and is
  // stopped before the counterfactual runs. Folding a new git call into an
  // existing metric would silently redefine the series it belongs to; the
  // counterfactual's own cost is reported on its own field instead, where it is
  // separable and comparable.
  const decisionMs = Date.now() - t0;
  // THE GIT COUNTERFACTUAL (#git-counterfactual). Measured HERE because it
  // cannot be measured later: the pair of commits this verdict adjudicated is
  // knowable now and unrecoverable once the selvage advances. The sides come
  // from `result.gitSides` — the values `admit` resolved under its own lock —
  // never from a re-read here, for the reason `baseFrom` documents above.
  // `meaningContested` is oracle's own predicate (knots ∪ dangles non-empty),
  // not a status-string test, so the two instruments cannot drift apart.
  const gitCf = await gitCounterfactual({
    cwd: opts.cwd ?? root,
    ref: opts.ref,
    ours: result.gitSides?.ours ?? null,
    theirs: result.gitSides?.theirs ?? null,
    meaningContested: d.knots.length > 0 || d.dangling.length > 0,
    cap: SHADOW_ROW_CAP,
  });
  const row: ShadowVerdictRow = {
    schemaVersion: SHADOW_VERDICT_SCHEMA,
    ts: new Date().toISOString(),
    ref: opts.ref,
    agentId: opts.agentId,
    status: d.status,
    confidence: d.confidence,
    knots: knots.slice(0, SHADOW_ROW_CAP),
    agentChanged: agentChanged.slice(0, SHADOW_ROW_CAP),
    otherChanged: otherChanged.slice(0, SHADOW_ROW_CAP),
    knotsTotal: knots.length,
    agentChangedTotal: agentChanged.length,
    otherChangedTotal: otherChanged.length,
    coverage: result.coverage?.counts ?? null,
    wouldSeal,
    proposedStateId: result.proposedStateId,
    durationMs: decisionMs,
    gitCounterfactual: gitCf,
    ...(result.escalation
      ? {
          escalation: {
            symbol: result.escalation.symbol,
            survival: result.escalation.survival,
            graded: result.escalation.graded,
            floor: result.escalation.floor,
          },
        }
      : {}),
    ...(result.claim
      ? {
          claimReport: {
            claimId: result.claim.claimId,
            breach: result.claim.breach,
            excess: result.claim.excess,
            missing: result.claim.missing,
          },
        }
      : {}),
    ...(result.knotPayloadId ? { knotPayloadId: result.knotPayloadId } : {}),
    ...(result.baseFrom ? { baseFrom: result.baseFrom } : {}),
    ...(meta ? { gate: meta.gate } : {}),
    ...(meta?.acceptRisk && !wouldSeal ? { overridden: true } : {}),
  };
  appendShadowVerdict(root, row);
  return { result, row };
}
