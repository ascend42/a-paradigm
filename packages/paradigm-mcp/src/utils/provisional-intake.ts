/**
 * Provisional-candidate intake — floor-trust session miner (T-2026-06-13-004).
 *
 * The learning loop must be able to LEARN FROM FAILURE, but a session-mined or
 * external correction can never be trusted enough to write straight into a
 * notebook (or CLAUDE.md). So this miner converts already-recorded failure
 * signals into FLOOR-TRUST provisional candidates — journal entries stamped
 * `provenance: { source: 'external', trust: 'external' }` with a NON-promotable
 * trigger (`failure_analysis`). They sit in the study-hall/journal staging tier
 * where the gated Classroom (`/paradigm:class`) adjudicates them; they are
 * invisible to `autoPromoteJournalEntries` (which only promotes
 * `pattern_discovered`/`human_feedback`), so the gate is preserved.
 *
 * Sources mined (small by design — the value is the gate-preserving PLUMBING,
 * not NLP):
 *   1. Overrides  (.paradigm/events/overrides.jsonl) — an archetype's soft-block
 *      was overridden, i.e. its judgment was rejected. A failure signal.
 *   2. Dismissed / revised user verdicts (durable verdicts.jsonl) — the human
 *      told an agent it was wrong.
 *
 * Idempotency: every staged source is recorded in a mined-ledger
 * (.paradigm/events/provisional-mined.jsonl) keyed by a stable source id, so
 * re-running the miner on each completion never double-stages.
 *
 * Scoped learning (S1): the mined-ledger lives in the USER home (it tracks this
 * person's staging); overrides are read as the union of their homes.
 */

import { log } from './mcp-logger.js';
import { appendLearningRows, readLearningRows } from './learning-stores.js';
import { recordJournalEntry } from './journal-loader.js';
import { readPendingVerdicts } from './session-work-log.js';

interface OverrideRow {
  timestamp?: string;
  remediation_id?: string;
  claimant?: string;
  mechanism?: string;
}

interface MinedLedgerRow {
  sourceId: string;
  stagedAt: string;
}

/** Read the set of already-mined source ids (union of homes). Never throws. */
function readMinedIds(rootDir: string): Set<string> {
  return new Set(
    readLearningRows<MinedLedgerRow>('provisional-mined', rootDir)
      .map(r => r.sourceId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
}

/** Append a mined-ledger row in its resolved home. Non-fatal. */
function markMined(rootDir: string, sourceId: string): void {
  try {
    const row: MinedLedgerRow = { sourceId, stagedAt: new Date().toISOString() };
    appendLearningRows('provisional-mined', rootDir, [row]);
  } catch (err) {
    log.component('#provisional-intake').warn('failed to record mined source', {
      sourceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function readOverrides(rootDir: string): OverrideRow[] {
  return readLearningRows<OverrideRow>('overrides', rootDir);
}

/**
 * Stage ONE floor-trust provisional candidate. Returns true if written.
 * The trigger is deliberately `failure_analysis` (non-promotable) and the
 * provenance floor is `external` so nothing auto-promotes it — the Classroom
 * gate decides.
 */
function stageCandidate(
  agentId: string,
  insight: string,
  minedFrom: 'override' | 'verdict',
  projectName: string,
): boolean {
  try {
    recordJournalEntry(agentId, {
      trigger: 'failure_analysis',
      insight,
      // Floor confidence: a session-mined correction is unproven until the gate.
      confidence_before: 0.5,
      confidence_after: 0.5,
      project: projectName,
      transferable: false,
      tags: ['provisional-candidate', 'floor-trust', `mined-from:${minedFrom}`],
      provenance: { source: 'external', trust: 'external' },
    });
    return true;
  } catch {
    return false;
  }
}

export interface ProvisionalIntakeResult {
  staged: number;
  byAgent: Record<string, number>;
}

/**
 * Mine already-recorded failure signals into floor-trust provisional candidates.
 * Best-effort and idempotent. Runs at the session-boundary postflight pass.
 *
 * @param projectName project label for the staged journal entries.
 * @param fallbackClaimant agent to attribute a signal that names no agent.
 */
export function mineProvisionalCandidates(
  rootDir: string,
  projectName: string,
  fallbackClaimant = 'orchestrator',
): ProvisionalIntakeResult {
  const result: ProvisionalIntakeResult = { staged: 0, byAgent: {} };
  const mined = readMinedIds(rootDir);

  const bump = (agent: string) => {
    result.staged++;
    result.byAgent[agent] = (result.byAgent[agent] ?? 0) + 1;
  };

  // ── Source 1: overrides ──
  const overrides = readOverrides(rootDir);
  for (let i = 0; i < overrides.length; i++) {
    const ov = overrides[i];
    const sourceId = `override:${ov.remediation_id ?? `idx${i}`}:${ov.timestamp ?? ''}`;
    if (mined.has(sourceId)) continue;
    const agent = ov.claimant && ov.claimant !== 'unknown' ? ov.claimant : fallbackClaimant;
    const insight =
      `Soft-block ${ov.remediation_id ?? '(unknown)'} raised by ${agent} was OVERRIDDEN ` +
      `(${ov.mechanism ?? 'override'}). Provisional lesson: this block fired where the user ` +
      `chose to proceed — re-examine its predicate before re-blocking the same scope.`;
    if (stageCandidate(agent, insight, 'override', projectName)) {
      markMined(rootDir, sourceId);
      bump(agent);
    }
  }

  // ── Source 2: dismissed / revised durable verdicts ──
  // Read-only against the verdicts store — we do NOT consume them (postflight's
  // own journaling still owns consumption); the mined-ledger prevents re-staging.
  const verdicts = readPendingVerdicts(rootDir).filter(
    v => v.agent && (v.verdict === 'dismissed' || v.verdict === 'revised'),
  );
  for (const v of verdicts) {
    const sourceId = `verdict:${v.nominationId ?? `${v.agent}:${v.timestamp}`}`;
    if (mined.has(sourceId)) continue;
    const agent = v.agent!;
    const verb = v.verdict === 'dismissed' ? 'dismissed' : 'revised';
    const insight =
      `User ${verb} ${agent}'s contribution${v.reason ? `: ${v.reason}` : ''}. ` +
      `Provisional lesson mined at floor trust — the Classroom gate decides whether it certifies.`;
    if (stageCandidate(agent, insight, 'verdict', projectName)) {
      markMined(rootDir, sourceId);
      bump(agent);
    }
  }

  if (result.staged > 0) {
    log.component('#provisional-intake').info('Staged floor-trust provisional candidates', {
      staged: result.staged,
      byAgent: result.byAgent,
    });
  }

  return result;
}
