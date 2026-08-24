/**
 * #justification — the Justification (v0). Why a branch's change-set is what it
 * is, computed from the SemDelta + the symbol graph.
 *
 * Schema (v0):
 *   { schemaVersion, actor (git author of branch tip), intent (tip subject),
 *     base:{ref,stateId}, branch:{ref,stateId}, semanticDelta: SemDelta[],
 *     computedRipple:{ touchedSymbols, blastRadius (union getReferencesTo over
 *     changed), danglingRefs }, signature: "unsigned:"+sha256(canonical) }
 *
 * Real signing is deferred; the schema reserves the field.
 *
 * Library code: no console output.
 */

import { createHash } from 'node:crypto';
import { getReferencesTo, type SymbolIndex } from '@a-company/premise-core';
import { canonicalSerialize, type CanonicalValue } from './warp/canonical.js';
import type { SemDelta, SemDeltaSet } from './sem-delta.js';
import type { WarpState } from './warp/warp-state.js';
import { commitAuthor, commitSubject, type GitOptions } from './git/git-exec.js';

export interface Justification {
  schemaVersion: 1;
  actor: string;
  intent: string;
  base: { ref: string; stateId: string };
  branch: { ref: string; stateId: string };
  semanticDelta: SemDelta[];
  computedRipple: {
    touchedSymbols: string[];
    blastRadius: string[]; // union of getReferencesTo over changed symbols
    danglingRefs: string[];
  };
  /**
   * P2.3 (forge-spec §3b, ADDITIVE — G1): a POINTER to the author's pre-declared
   * claim:v1 (.warpline/claims/<claimId>.json), when the change was proposed
   * under one. The claim itself (and its grading — the breach/excess/missing
   * evaluation stream) lives in the G5 sidecar, never inline here; strand/pickId
   * identity is untouched (the pickId preimage is founder-signed). Absent ⇒ the
   * justification is byte-identical to the pre-claim schema.
   */
  claimId?: string;
  signature: string;
}

export interface JustifyOptions extends GitOptions {
  /** the branch's live index, for blast-radius computation */
  branchIndex: SymbolIndex;
  /** P2.3 — the claimId this change was proposed under (additive pointer, §3b). */
  claimId?: string;
}

/**
 * Synthesize a Justification for base→branch.
 * `actor`/`intent` come from git log of the branch tip (skipped for WORKTREE).
 */
export async function justify(
  base: WarpState,
  branch: WarpState,
  delta: SemDeltaSet,
  opts: JustifyOptions,
): Promise<Justification> {
  const cwd = opts.cwd ?? process.cwd();
  const isWorktree = branch.ref === 'WORKTREE';

  const actor = isWorktree ? 'WORKTREE' : await commitAuthor(branch.ref, { cwd }).catch(() => 'unknown');
  const intent = isWorktree ? 'uncommitted worktree state' : await commitSubject(branch.ref, { cwd }).catch(() => '');

  const semanticDelta = Array.from(delta.deltas.values());
  const touchedSymbols = Array.from(new Set(semanticDelta.map((d) => d.symbol))).sort();

  // Blast radius: who references each changed symbol (in the branch index).
  const blast = new Set<string>();
  for (const sym of touchedSymbols) {
    for (const ref of getReferencesTo(opts.branchIndex, sym)) {
      blast.add(ref.symbol);
    }
  }
  const blastRadius = Array.from(blast).sort();

  // Dangling refs: edges added pointing at retired targets (within THIS branch's
  // own delta — symbol-retired keys whose name is referenced by an added edge).
  const retiredNames = new Set(
    semanticDelta.filter((d) => d.kind === 'symbol-retired').map((d) => d.symbol),
  );
  const danglingRefs = new Set<string>();
  for (const d of semanticDelta) {
    for (const e of d.changeset?.edgesAdded ?? []) {
      if (retiredNames.has(e.targetSymbol)) danglingRefs.add(e.targetSymbol);
    }
  }

  const body: Omit<Justification, 'signature'> = {
    schemaVersion: 1,
    actor,
    intent,
    base: { ref: base.ref, stateId: base.stateId },
    branch: { ref: branch.ref, stateId: branch.stateId },
    semanticDelta,
    computedRipple: {
      touchedSymbols,
      blastRadius,
      danglingRefs: Array.from(danglingRefs).sort(),
    },
    ...(opts.claimId ? { claimId: opts.claimId } : {}),
  };

  const signature = 'unsigned:' + sha256(canonicalSerialize(body as unknown as CanonicalValue));
  return { ...body, signature };
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
