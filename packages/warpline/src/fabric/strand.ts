/**
 * #strand — a Strand: one PICK sealed into the Warpline fabric (this project's
 * OWN native meaning-history, not git).
 *
 * Two distinct identities, deliberately separated:
 *   - stateId  = the REPRODUCIBLE content-address of the meaning this strand
 *                lands on (from #warp-state; provable-zero on a no-op edit).
 *   - pickId   = the EVENT identity of the recording — includes actor + time +
 *                intent, so two identical edits by different actors are
 *                different picks. This is where attribution/provenance lives
 *                (the substrate of the calibration corpus).
 *
 * `calibratedConfidence` is RESERVED (null until graded) — the one field a
 * git-backed history can't carry, and the seed of the non-portable moat: an
 * actor's graded belief at write time, later scored against outcome.
 *
 * Library code: no console output.
 */

import { createHash } from 'node:crypto';
import { canonicalSerialize, type CanonicalValue } from '../warp/canonical.js';

/** A compact summary of the meaning change this strand introduced vs its parent. */
export interface StrandDelta {
  born: string[]; // sorted symbol names born in this strand
  retired: string[]; // sorted symbol names retired
  contractChanged: string[]; // sorted symbol names whose contract/essence moved
  renamedNoop: number; // count of pure renames/moves (the EMPTY delta)
}

/**
 * The record a KNOT-council resolution carries on its strand: WHO resolved a
 * genuine meaning conflict, WHY, what was contended, and how. This is what git
 * can't keep — a merge commit records the bytes, not the reasoning. Warpline's
 * history is accountability-native.
 */
export interface KnotResolution {
  decidedBy: string; // the human (or agent) who made the call
  reason: string; // why it was resolved this way
  base: string | null; // the scratch base the resolution re-based from
  against: string; // the selvage stateId the proposal conflicted with
  contended: string[]; // the symbols that were in conflict (knots + dangles)
  resolvedSymbols: string[]; // symbols the resolution changed vs the selvage
}

export interface Strand {
  schemaVersion: 1;
  seq: number; // monotonic history index (0 = genesis)
  pickId: string; // event content-address — pick:v0:<sha256(canonical body)>
  stateId: string; // the WarpState this strand lands on (the new selvage)
  parentStateId: string | null; // previous selvage (null at genesis)
  actor: string; // who recorded it — agent/operator identity (attribution)
  intent: string; // human-readable reason
  recordedAt: string; // ISO timestamp (event provenance)
  objectCount: number; // size of the lifted meaning graph (headline for genesis)
  delta: StrandDelta;
  /** RESERVED — graded belief in this pick (the moat signal). null until graded. */
  calibratedConfidence: number | null;
  provenance: {
    ref: string; // WORKTREE or the git ref the snapshot was lifted from
    treeSha: string | null; // git tree provenance, if any (coexistence, not identity)
    gitCommit: string | null; // git HEAD at record time — the coexistence anchor
  };
  /** present only on a KNOT-council resolution strand (omitted on normal picks). */
  resolves?: KnotResolution;
  /**
   * true only on a strand sealed by a materialized CLEAN merge (#admit). Its
   * provenance.gitCommit is ONE parent and does NOT contain the merged bytes, so a
   * later merge must NOT re-base its base/theirs off this strand's commit — admit
   * fails closed instead (H1; durable merged-tree byte-anchoring is native-store work).
   */
  merged?: boolean;
}

/** The strand minus its own content-address (what `pickId` is computed over). */
export type StrandBody = Omit<Strand, 'pickId'>;

/**
 * Null-normalize a value for hashing: the canonical serializer rejects null
 * (it demands "normalize to empty first"), but a strand body carries meaningful
 * nulls (genesis parent, ungraded confidence, no git tree). Map null/undefined →
 * "" for the ADDRESS only; the stored strand JSON keeps the real nulls. "" is
 * never a real stateId/confidence, so this introduces no collision.
 */
function canonicalSafe(v: unknown): CanonicalValue {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(canonicalSafe);
  if (typeof v === 'object') {
    const out: Record<string, CanonicalValue> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = canonicalSafe(val);
    return out;
  }
  return v as CanonicalValue;
}

/**
 * pickId = pick:v0:sha256(canonical(identity)) — the EVENT identity. It EXCLUDES
 * calibratedConfidence: that field is graded LATER (survive/overturn) and must be
 * mutable without changing the strand's content-address. Everything else (stateId,
 * actor, time, intent, delta, provenance, resolves) is the immutable event.
 */
export function computePickId(body: StrandBody): string {
  const { calibratedConfidence: _graded, ...identity } = body;
  const canon = canonicalSerialize(canonicalSafe(identity));
  return 'pick:v0:' + createHash('sha256').update(canon, 'utf8').digest('hex');
}
