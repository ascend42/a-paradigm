/**
 * Team Funnel Telemetry
 *
 * The invocation funnel for agent-team orchestration: INVOKE → EXECUTE →
 * CAPTURE → LEARN. This module owns the INVOKE stage's telemetry — the events
 * that make the team-invocation rate (and the gate classifiers' false-positive
 * rate) measurable, per the Pillar 0 strategy (invocation reliability).
 *
 * Event sources (all append to .paradigm/events/team-funnel.jsonl):
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

import * as fs from 'fs';
import * as path from 'path';

const TEAM_FUNNEL_FILE = '.paradigm/events/team-funnel.jsonl';

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
    const filePath = path.join(rootDir, TEAM_FUNNEL_FILE);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const entry: TeamFunnelEvent = { timestamp: new Date().toISOString(), ...event };
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // Non-fatal — telemetry is advisory.
  }
}

/**
 * Read funnel events, optionally limited to the last `sinceDays` days.
 */
export function readTeamFunnelEvents(rootDir: string, sinceDays?: number): TeamFunnelEvent[] {
  try {
    const filePath = path.join(rootDir, TEAM_FUNNEL_FILE);
    if (!fs.existsSync(filePath)) return [];

    const cutoff = sinceDays !== undefined
      ? Date.now() - sinceDays * 24 * 60 * 60 * 1000
      : undefined;

    return fs.readFileSync(filePath, 'utf8')
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line) as TeamFunnelEvent; }
        catch { return null; }
      })
      .filter((e): e is TeamFunnelEvent => {
        if (e === null || !e.type) return false;
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
