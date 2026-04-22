/**
 * near-match — tiny Levenshtein-based suggestion helper for compliance errors.
 *
 * v5.38.0: invoked by `portal-compliance.ts` when a gate appears in code but
 * is not declared in portal.yaml (and vice versa). Produces a "did you mean"
 * hint to close the diagnosis gap that Bug 1 (the `^`-prefix lenient parser)
 * still leaves for typos.
 *
 * Security notes:
 *   - Gate names in compliance reports are fine — the user already sees
 *     portal.yaml locally. Suggestions render gate names because that's the
 *     point.
 *   - Gate names in error MESSAGES / LOGS are NOT fine — this module's
 *     output is only surfaced via `formatComplianceReport` and the
 *     compliance-check JSON envelope (both local user-facing surfaces,
 *     already redacted against telemetry in v5.37.12).
 */

/**
 * Compute Levenshtein distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Use two-row optimization to keep space O(min(a,b))
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,      // insertion
        prev[j] + 1,           // deletion
        prev[j - 1] + cost,    // substitution
      );
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[b.length];
}

export interface NearMatch {
  /** The candidate name found to be a close match. */
  didYouMean: string;
  /** Levenshtein distance to the query. */
  distance: number;
}

/**
 * Find the single closest candidate for `query` among `candidates`,
 * applying the v5.38.0 threshold: distance ≤ 2 OR distance / longer ≤ 0.3.
 *
 * Returns undefined if no candidate passes the threshold.
 */
export function findNearMatch(query: string, candidates: readonly string[]): NearMatch | undefined {
  if (!query || candidates.length === 0) return undefined;

  let best: NearMatch | undefined;
  for (const candidate of candidates) {
    if (candidate === query) continue; // exact match isn't a near-match
    const d = levenshtein(query, candidate);
    const longer = Math.max(query.length, candidate.length);
    if (longer === 0) continue;
    const ratio = d / longer;
    const passes = d <= 2 || ratio <= 0.3;
    if (!passes) continue;
    if (!best || d < best.distance) {
      best = { didYouMean: candidate, distance: d };
    }
  }
  return best;
}

export interface ComplianceSuggestion {
  /** The gate that is undeclared (or declared-but-not-used). */
  gate: string;
  /** The near-match candidate, if any. */
  didYouMean: string;
  /** Levenshtein distance. */
  distance: number;
}

/**
 * Given a set of undeclared gates (used in code but not in portal.yaml),
 * suggest the closest declared gate for each. Only emits one suggestion per
 * undeclared gate; skips gates with no close match.
 */
export function suggestForUndeclared(
  undeclared: readonly string[],
  declared: readonly string[],
): ComplianceSuggestion[] {
  const out: ComplianceSuggestion[] = [];
  for (const gate of undeclared) {
    const match = findNearMatch(gate, declared);
    if (match) {
      out.push({ gate, didYouMean: match.didYouMean, distance: match.distance });
    }
  }
  return out;
}

/**
 * Reverse direction: for each gate declared-but-not-used, suggest the closest
 * used-but-not-declared gate (candidate typo on the declaration side).
 */
export function suggestForUnused(
  declaredButUnused: readonly string[],
  usedButUndeclared: readonly string[],
): ComplianceSuggestion[] {
  const out: ComplianceSuggestion[] = [];
  for (const gate of declaredButUnused) {
    const match = findNearMatch(gate, usedButUndeclared);
    if (match) {
      out.push({ gate, didYouMean: match.didYouMean, distance: match.distance });
    }
  }
  return out;
}
