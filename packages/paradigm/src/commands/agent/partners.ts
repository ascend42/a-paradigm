/**
 * Partners — pure helpers for the v6.0.3 partners primitive.
 *
 * No I/O. Functions take agent shapes and installed-set, return derived data.
 *
 * Status semantics:
 *   - reciprocal:    A→B and B→A; both installed locally
 *   - pending:       A→B, B installed locally, but B does not list A back (one-way; legal)
 *   - not-installed: A→B, B not installed locally (regardless of reciprocity)
 */

import type { PartnerRef } from '../team/types.js';

export interface AgentWithPartners {
  name: string;
  partners?: PartnerRef[];
}

export type PartnerStatus = 'reciprocal' | 'pending' | 'not-installed';

export interface ReciprocityResult {
  id: string;
  pendingPartners: string[];
}

export function validateReciprocity(agents: AgentWithPartners[]): ReciprocityResult[] {
  const partnerMap = new Map<string, Set<string>>();
  for (const a of agents) {
    partnerMap.set(a.name, new Set((a.partners ?? []).map(p => p.id)));
  }

  const results: ReciprocityResult[] = [];
  for (const a of agents) {
    const declared = partnerMap.get(a.name) ?? new Set();
    const pending: string[] = [];
    for (const partnerId of declared) {
      const reverse = partnerMap.get(partnerId);
      if (reverse && !reverse.has(a.name)) {
        pending.push(partnerId);
      }
    }
    if (pending.length > 0) {
      results.push({ id: a.name, pendingPartners: pending });
    }
  }
  return results;
}

export function findMissingPartners(
  agent: AgentWithPartners,
  installed: Set<string>
): string[] {
  return (agent.partners ?? [])
    .map(p => p.id)
    .filter(id => !installed.has(id));
}

export function pairLabel(a: string, b: string): string {
  return [a, b].sort().join('-');
}

export function pairNotebookPath(a: string, b: string): string {
  return `_pairs/${pairLabel(a, b)}/`;
}

export function getPartnerStatus(
  agent: AgentWithPartners,
  partnerId: string,
  allAgents: AgentWithPartners[],
  installed: Set<string>
): PartnerStatus {
  if (!installed.has(partnerId)) return 'not-installed';
  const partner = allAgents.find(a => a.name === partnerId);
  const reverse = new Set((partner?.partners ?? []).map(p => p.id));
  return reverse.has(agent.name) ? 'reciprocal' : 'pending';
}
