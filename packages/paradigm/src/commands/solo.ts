/**
 * paradigm solo — declare a deliberate solo (no-team) session.
 *
 * Part of the team-invocation funnel (Pillar 0): bypassing orchestration is
 * allowed, but it must be a legible recorded choice, not silent drift. A solo
 * declaration satisfies the orchestration gates (prompt-gate, edit-gate, and
 * the stop hook's orchestration-required check) for the current session, and
 * appends a structured `solo-declared` event to the team-funnel telemetry.
 *
 * Reasons are ENUMERATED, not free-form — "enums give distributions, strings
 * give vibes" (Loid). The optional note is free text for clustering.
 */

import * as fs from 'fs';
import * as path from 'path';
import { out, success, error, dim } from '../utils/cli-output.js';
import { appendTeamFunnelEvent, SOLO_REASONS, SoloReason } from '../core/team-funnel.js';

export function soloDeclare(reason: string, noteParts: string[] = []): void {
  const rootDir = process.cwd();

  if (!fs.existsSync(path.join(rootDir, '.paradigm'))) {
    error('Not a Paradigm project (no .paradigm/ directory).');
    process.exitCode = 1;
    return;
  }

  if (!SOLO_REASONS.includes(reason as SoloReason)) {
    error(`Invalid reason: "${reason}"`);
    out(`Valid reasons: ${SOLO_REASONS.join(' | ')}`);
    dim('  trivial       — one-liner / mechanical change, team adds no value');
    dim('  hotfix        — urgent fix where team latency is unacceptable');
    dim('  user-directed — the user explicitly asked for solo work');
    dim('  exploratory   — research/spike, no production code intended');
    process.exitCode = 1;
    return;
  }

  const note = noteParts.join(' ').trim() || undefined;

  // Session marker — read by the prompt-gate, edit-gate, and stop-hook Check 13.
  // Cleared by the stop hook on session pass.
  const marker = path.join(rootDir, '.paradigm', '.solo-declared');
  fs.writeFileSync(
    marker,
    JSON.stringify({ timestamp: new Date().toISOString(), reason, ...(note ? { note } : {}) }) + '\n',
    'utf8',
  );

  // Durable telemetry — Loid calibrates the gates from the reason distribution.
  appendTeamFunnelEvent(rootDir, {
    type: 'solo-declared',
    source: 'cli',
    reason: reason as SoloReason,
    ...(note ? { note } : {}),
  });

  success(`Solo session declared (${reason}${note ? `: ${note}` : ''}).`);
  dim('Orchestration gates are satisfied for this work window (expires after ~4h; PARADIGM_GATE_TTL_HOURS to adjust).');
  dim('Recorded to team-funnel telemetry.');
}
