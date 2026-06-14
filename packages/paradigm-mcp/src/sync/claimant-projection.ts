/**
 * Claimant projection (#sync-provider) — Loid's rule, Phase 2a
 * (TD-2026-06-13-768). OUTBOUND ONLY, one-way.
 *
 * Maps a Paradigm `Claimant` to a provider-agnostic intent: should the external
 * item be assigned to a person, and what marker labels should it carry?
 *
 * The policy is provider-AGNOSTIC; a provider (GitHub) is the ENCODER that turns
 * this into `--assignee` / `--label` flags. The cardinal rule: an archetype or
 * peer task must NEVER be falsely assigned to a human — it goes up unassigned,
 * carrying a typed marker label so a human can see who owns it on our side.
 *
 *   - kind: 'human'     → assignee = ref (the human identity), no marker label.
 *   - kind: 'archetype' → assignee = none, labels += 'paradigm:agent/<ref>'.
 *   - kind: 'peer'      → assignee = none, labels += 'paradigm:peer/<ref>'.
 */

import type { Claimant } from '../utils/task-loader.js';

export interface ClaimantProjection {
  /** A human identity to assign on the external item; omitted for agent/peer. */
  assignee?: string;
  /** Marker labels that encode a non-human claimant. */
  labels: string[];
}

/** Project a claimant into assignee + marker-label intent. Pure. */
export function projectClaimant(claimant?: Claimant): ClaimantProjection {
  if (!claimant) return { labels: [] };
  switch (claimant.kind) {
    case 'human':
      return { assignee: claimant.ref, labels: [] };
    case 'archetype':
      return { labels: [`paradigm:agent/${claimant.ref}`] };
    case 'peer':
      return { labels: [`paradigm:peer/${claimant.ref}`] };
    default:
      // Unknown kind → fail safe: unassigned, no marker (never false-assign).
      return { labels: [] };
  }
}
