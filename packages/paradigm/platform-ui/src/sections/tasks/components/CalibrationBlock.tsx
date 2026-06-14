import React from 'react';
import type { TaskEstimate } from '../store/tasksStore';
import { tokenBandToPoints } from '../utils/storyPoints';

// CalibrationBlock — THE MOAT, made visible.
//
// Renders on every card as the largest non-title element. It shows the learned
// story-point estimate prominently, and visually distinguishes a band the team
// has actually learned (source:'learned', n>=8) from a cold-start guess
// (source:'prior'). Learned = full opacity + green accent. Prior = ~60% opacity,
// muted, italic — intentional, not broken.

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

export function CalibrationBlock({ estimate }: { estimate: TaskEstimate }) {
  const points = tokenBandToPoints(estimate);
  const learned = estimate.source === 'learned';

  return (
    <div className={`task-calibration ${learned ? 'learned' : 'prior'}`}>
      <div className="task-calibration__points">{points}</div>
      <div className="task-calibration__meta">
        {learned ? (
          <span className="task-calibration__badge">
            {'◆'} LEARNED <span className="task-calibration__n">n{estimate.n}</span>
          </span>
        ) : (
          <span className="task-calibration__prior-label">~prior~</span>
        )}
        <span className="task-calibration__band">{formatBand(estimate.min, estimate.max)}</span>
      </div>
    </div>
  );
}
