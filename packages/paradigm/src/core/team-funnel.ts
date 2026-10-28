/**
 * Team Funnel Telemetry
 *
 * The invocation funnel for agent-team orchestration: INVOKE → EXECUTE →
 * CAPTURE → LEARN. This module owns the INVOKE stage's telemetry — the events
 * that make the team-invocation rate (and the gate classifiers' false-positive
 * rate) measurable, per the Pillar 0 strategy (invocation reliability).
 *
 * Event sources (all append to team-funnel.jsonl in the machine home, scoped
 * learning S2; hooks resolve it with `paradigm internal learn-path`):
 *  - `eligible`       — prompt-gate hook classified an incoming task as
 *                       orchestration-eligible (fires every match → FP rate)
 *  - `edit-advisory`  — team-gate hook saw a source edit in an unresolved session
 *  - `orchestrated`   — paradigm_orchestrate_inline actually ran
 *  - `solo-declared`  — `paradigm solo <reason>` made bypass a legible choice
 *  - `bypass`         — stop hook found magnitude ≥ threshold with neither
 *                       orchestration nor a solo declaration (recorded even at
 *                       warn severity — telemetry survives the escape hatch)
 *
 * Shell hooks append JSONL directly (house pattern); this module is the typed
 * reader/summarizer plus the writer for CLI/MCP callers. Loid calibrates the
 * gates from this data — advisory tiers graduate to guards only on evidence.
 */

// Relative-path import into bundled paradigm-mcp source (same pattern as core/task-bridge.ts).
import { appendLearningRows, readLearningRows } from '../../../paradigm-mcp/src/utils/learning-stores.js';

export type SoloReason = 'trivial' | 'hotfix' | 'user-directed' | 'exploratory';

export const SOLO_REASONS: SoloReason[] = ['trivial', 'hotfix', 'user-directed', 'exploratory'];

export interface TeamFunnelEvent {
  timestamp: string;
  type: 'eligible' | 'edit-advisory' | 'orchestrated' | 'solo-declared' | 'bypass';
  source?: string;
  /** eligible: which classifier keyword matched */
  matched?: string;
  /** edit-advisory: basename of the file about to be edited */
  file?: string;
  /** solo-declared: the structured reason enum */
  reason?: SoloReason;
  /** solo-declared: optional free-text note (Loid clusters these) */
  note?: string;
  /** bypass: the stop hook's magnitude score */
  magnitude?: number;
  /** bypass: human-readable magnitude breakdown */
  reasons?: string;
  /** bypass: severity the check ran at (warn | block) */
  severity?: string;
  /** orchestrated: which orchestrate mode ran */
  mode?: string;
}

export interface TeamFunnelSummary {
  /** Window the summary covers, in days */
  windowDays: number;
  eligible: number;
  orchestrated: number;
  soloDeclared: number;
  bypasses: number;
  /** orchestrated / (orchestrated + soloDeclared + bypasses) — how often an
   *  engaged-or-resolved session actually used the team */
  invocationRate: number | null;
  /** (orchestrated + soloDeclared) / (orchestrated + soloDeclared + bypasses)
   *  — how often the gate was resolved legibly (team OR declared solo) vs
   *  silently bypassed */
  legibleRate: number | null;
  soloByReason: Record<string, number>;
}

/**
 * Append a funnel event. Non-fatal — telemetry must never break the caller.
 */
export function appendTeamFunnelEvent(
  rootDir: string,
  event: Omit<TeamFunnelEvent, 'timestamp'>,
): void {
  try {
    const entry: TeamFunnelEvent = { timestamp: new Date().toISOString(), ...event };
    appendLearningRows('team-funnel', rootDir, [entry]);
  } catch {
    // Non-fatal — telemetry is advisory.
  }
}

/**
 * Read funnel events, optionally limited to the last `sinceDays` days: the
 * machine home plus the frozen legacy repo log.
 */
export function readTeamFunnelEvents(rootDir: string, sinceDays?: number): TeamFunnelEvent[] {
  try {
    const cutoff = sinceDays !== undefined
      ? Date.now() - sinceDays * 24 * 60 * 60 * 1000
      : undefined;
    return readLearningRows<TeamFunnelEvent>('team-funnel', rootDir)
      .filter((e) => {
        if (!e.type) return false;
        if (cutoff === undefined) return true;
        const t = Date.parse(e.timestamp);
        return !Number.isNaN(t) && t >= cutoff;
      });
  } catch {
    return [];
  }
}

/**
 * Summarize the funnel — the metrics Loid calibrates the gates from.
 */
export function summarizeTeamFunnel(rootDir: string, windowDays = 30): TeamFunnelSummary {
  const events = readTeamFunnelEvents(rootDir, windowDays);

  const eligible = events.filter(e => e.type === 'eligible').length;
  const orchestrated = events.filter(e => e.type === 'orchestrated').length;
  const soloDeclared = events.filter(e => e.type === 'solo-declared').length;
  const bypasses = events.filter(e => e.type === 'bypass').length;

  const resolved = orchestrated + soloDeclared + bypasses;

  const soloByReason: Record<string, number> = {};
  for (const e of events) {
    if (e.type === 'solo-declared' && e.reason) {
      soloByReason[e.reason] = (soloByReason[e.reason] || 0) + 1;
    }
  }

  return {
    windowDays,
    eligible,
    orchestrated,
    soloDeclared,
    bypasses,
    invocationRate: resolved > 0 ? orchestrated / resolved : null,
    legibleRate: resolved > 0 ? (orchestrated + soloDeclared) / resolved : null,
    soloByReason,
  };
}
