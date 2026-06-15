// storyPoints — maps a learned/prior token band to a Fibonacci story point.
//
// The band {min,max} is in raw tokens. We take the midpoint and bucket it
// through token thresholds into the classic Fibonacci scale used for story
// points. As the team accumulates actuals (estimate.source === 'learned'),
// these thresholds will be tuned to real distributions — they are deliberately
// a tunable const so a future calibration pass can re-fit them.

export interface TokenBand {
  min: number;
  max: number;
}

/**
 * Token-midpoint thresholds → Fibonacci story points.
 * Each entry: midpoint strictly below `maxTokens` maps to `points`.
 * TUNABLE: these are seed values; they'll be re-fit against real actuals later.
 */
export const POINT_THRESHOLDS: Array<{ maxTokens: number; points: number }> = [
  { maxTokens: 3_000, points: 1 },
  { maxTokens: 6_000, points: 2 },
  { maxTokens: 12_000, points: 3 },
  { maxTokens: 25_000, points: 5 },
  { maxTokens: 50_000, points: 8 },
  { maxTokens: 90_000, points: 13 },
];

/** Story point assigned when the midpoint exceeds the largest threshold. */
export const MAX_POINTS = 21;

/**
 * Map a token band to a Fibonacci story point (1/2/3/5/8/13/21).
 * Pure: same input always yields the same point.
 */
export function tokenBandToPoints(band: TokenBand | undefined | null): number {
  // Defensive: a task fetched from a route that doesn't attach an estimate
  // would otherwise crash here (band.min on undefined). Return 0 = "no estimate".
  if (!band || typeof band.min !== 'number' || typeof band.max !== 'number') return 0;
  const midpoint = (band.min + band.max) / 2;
  for (const { maxTokens, points } of POINT_THRESHOLDS) {
    if (midpoint < maxTokens) return points;
  }
  return MAX_POINTS;
}
