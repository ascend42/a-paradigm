/**
 * Shared structured rejection envelope for v6.0 lore-type hard-removals.
 *
 * Both `paradigm_lore_record` and the deprecated `paradigm_assessment_record`
 * must reject `type:'decision'` payloads with the same machine-actionable
 * envelope so downstream agents can auto-retry against the canonical
 * `paradigm_decision_record` tool without human intervention.
 *
 * Returned (not thrown) so MCP callers receive a deterministic payload.
 * Mirrors the shape used in Jinx's premortem mitigation #2 for v6.0
 * hard-removals. See docs/private/plans/v6.0-decisions-locked.md (D3).
 */

export interface RejectionEnvelope {
  code: string;
  message: string;
  successor_tool?: string;
  doc?: string;
  removed_in?: string;
}

/** Wrap a RejectionEnvelope in the MCP tool-handler return shape. */
export function rejectionErr(env: RejectionEnvelope): { handled: boolean; text: string } {
  return {
    handled: true,
    text: JSON.stringify({ error: env }, null, 2),
  };
}

/**
 * Canonical envelope for `type:'decision'` rejection. Both lore and
 * assessment record-paths return this exact payload so the structured
 * `code`, `successor_tool`, `removed_in`, and `doc` fields are stable
 * across call sites. The body of the message is deliberately verbose so
 * an LLM agent reading the response cold knows WHAT happened, WHAT to
 * do next, and WHAT will happen if it follows the guidance.
 */
export const DECISION_REMOVED_ENVELOPE: RejectionEnvelope = {
  code: 'lore_type_decision_removed',
  message:
    "lore type 'decision' was removed in v6.0. " +
    'Use paradigm_decision_record instead. ' +
    'The decision will be stored in .paradigm/decisions/ and a companion ' +
    "lore insight entry (type:'insight' with references.decision_id) will be " +
    'written automatically so the timeline stays complete. ' +
    'For narrative-only references, use ' +
    "paradigm_lore_record({type:'insight', references:{decision_id}}).",
  successor_tool: 'paradigm_decision_record',
  doc: 'docs/private/plans/v6.0-decisions-locked.md',
  removed_in: '6.0.0',
};
