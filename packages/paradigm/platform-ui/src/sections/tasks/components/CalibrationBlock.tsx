import React from 'react';
import type { TaskEstimate, TaskClaimant } from '../store/tasksStore';
import { tokenBandToPoints } from '../utils/storyPoints';
import { claimantArchetype } from '../utils/board';

// CalibrationBlock — THE MOAT, made visible.
//
// Renders on every card as a high-prominence non-title element. SIZE tracks
// CONFIDENCE:
//   - source:'learned' (n>=8): the big (32px) green story-point IS the loudest
//     element — a band the team has actually learned earns the shout.
//   - source:'prior': a cold-start guess. The '~prior~' label LEADS, the number
//     is shrunk + recessed. A guess should not shout.
//
// It also surfaces WHICH calibration cell produced the estimate
// (claimant-archetype × taskType, e.g. "builder×feature") so a user can map the
// card's number back to the calibration grid.

function formatTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    // Keep one decimal only when it adds signal (e.g. 5.5k), else 5k.
    return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return String(n);
}

function formatBand(min: number, max: number): string {
  return `${formatTokens(min)}–${formatTokens(max)}`; // en-dash
}

// "builder×feature" — the calibration cell this estimate came from. Needs both
// a resolvable archetype claimant and a taskType; otherwise we render nothing.
function cellCaption(claimant: TaskClaimant | undefined, taskType: string | undefined): string | null {
  if (!taskType) return null;
  if (!claimant || claimant.kind !== 'archetype') return null;
  return `${claimantArchetype(claimant.ref)}×${taskType.toLowerCase()}`;
}

export function CalibrationBlock({
  estimate,
  claimant,
  taskType,
}: {
  estimate: TaskEstimate;
  claimant?: TaskClaimant;
  taskType?: string;
}) {
  const points = tokenBandToPoints(estimate);
  const learned = estimate.source === 'learned';
  const caption = cellCaption(claimant, taskType);

  return (
    <div className={`task-calibration ${learned ? 'learned' : 'prior'}`}>
      {learned ? (
        <>
          <div className="task-calibration__points">{points}</div>
          <div className="task-calibration__meta">
            <span className="task-calibration__badge">
              {'◆'} LEARNED <span className="task-calibration__n">n{estimate.n}</span>
            </span>
            <span className="task-calibration__band">{formatBand(estimate.min, estimate.max)}</span>
            {caption && <span className="task-calibration__cell">{caption}</span>}
          </div>
        </>
      ) : (
        // Prior: label LEADS, number recessed/secondary.
        <div className="task-calibration__meta task-calibration__meta--prior">
          <span className="task-calibration__prior-label">~prior~</span>
          <span className="task-calibration__prior-row">
            <span className="task-calibration__points task-calibration__points--prior">{points}</span>
            <span className="task-calibration__band">{formatBand(estimate.min, estimate.max)}</span>
          </span>
          {caption && <span className="task-calibration__cell">{caption}</span>}
        </div>
      )}
    </div>
  );
}
