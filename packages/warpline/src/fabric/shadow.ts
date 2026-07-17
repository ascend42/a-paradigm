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
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { admit, type AdmitOptions, type AdmitStatus, type AdmitConfidence, type AdmitResult } from './admit.js';
import type { CoverageCounts } from '../honesty.js';

export const SHADOW_VERDICT_SCHEMA = 'shadowVerdict:v1' as const;

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
  /** contested symbols (knots + dangles) — [] on a clean verdict. */
  knots: string[];
  agentChanged: string[];
  otherChanged: string[];
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

/**
 * Run the full admission pipeline in OBSERVE-ONLY mode and append the verdict
 * row. The fabric/selvage/objects/sidecars are byte-identical before and after
 * (the shadow invariant — pinned by test/shadow-admit.test.ts).
 */
export async function shadowAdmit(
  root: string,
  opts: Omit<AdmitOptions, 'shadow'>,
): Promise<ShadowAdmitResult> {
  const t0 = Date.now();
  const result = await admit(root, { ...opts, shadow: true });
  const d = result.decision;
  const wouldSeal =
    d.status === 'FAST_ADMIT' ||
    (d.status === 'CLEAN' && result.merged !== undefined && result.merged.conflicts.length === 0);
  const row: ShadowVerdictRow = {
    schemaVersion: SHADOW_VERDICT_SCHEMA,
    ts: new Date().toISOString(),
    ref: opts.ref,
    agentId: opts.agentId,
    status: d.status,
    confidence: d.confidence,
    knots: Array.from(
      new Set([...d.knots.map((k) => k.symbol), ...d.dangling.map((x) => x.fromSymbol)]),
    ).sort(),
    agentChanged: d.agentChanged,
    otherChanged: d.otherChanged,
    coverage: result.coverage?.counts ?? null,
    wouldSeal,
    proposedStateId: result.proposedStateId,
    durationMs: Date.now() - t0,
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
  };
  appendShadowVerdict(root, row);
  return { result, row };
}
