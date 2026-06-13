/**
 * Orchestration completion marker — #orchestration-marker (v7 "Teeth", T-005).
 *
 * The Stop hook's orchestration-required gate is satisfied by the presence of
 * `.paradigm/.orchestrated` (see hooks/scripts/paradigm-common.sh). Historically
 * this marker was written on tool ENTRY of `orchestrate_inline` — for every mode
 * including `quick` — so a single lightweight ping checked the box before any
 * agent ran. That verified *invocation*, not *work*.
 *
 * The fix: the marker is written ONLY from a real completion signal (a settlement
 * whose learning chain ran end-to-end, or a debrief that recorded real agent
 * verdicts). `recordOrchestrationCompletion` is the single best-effort writer both
 * sites import. A write failure NEVER breaks the caller.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from './mcp-logger.js';

export interface OrchestrationCompletion {
  /** Count of real verdicts/contributions/settled-stages this run produced. */
  verdicts: number;
  /** Which completion signal fired the write. */
  source: 'settlement' | 'debrief';
}

/**
 * Write `.paradigm/.orchestrated` to satisfy the Stop-hook orchestration gate.
 * Best-effort: a write failure is logged and swallowed so it can never break the
 * settling/debriefing caller.
 *
 * @returns true if the marker was written, false on a (non-fatal) failure.
 */
export function recordOrchestrationCompletion(
  rootDir: string,
  completion: OrchestrationCompletion,
): boolean {
  try {
    const paradigmDir = path.join(rootDir, '.paradigm');
    fs.mkdirSync(paradigmDir, { recursive: true });
    const markerPath = path.join(paradigmDir, '.orchestrated');
    const payload = {
      timestamp: new Date().toISOString(),
      type: 'orchestrated' as const,
      verdicts: completion.verdicts,
      source: completion.source,
    };
    fs.writeFileSync(markerPath, JSON.stringify(payload), 'utf8');
    return true;
  } catch (err) {
    log.component('#orchestration-marker').warn('Failed to write orchestration completion marker', {
      source: completion.source,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
