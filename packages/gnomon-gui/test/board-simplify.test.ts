/**
 * Long strokes (boards S1.3 pass P3b, src/board/simplify.ts): no stroke a person can draw is refused for size.
 */
import { describe, expect, it } from 'vitest';
import { DIM_LIMITS } from '@a-company/gnomon-contracts';
import { fitStroke, rdp, segmentDistance, STROKE_BUDGET, strokeBytes, strokeFits, type StrokePoint } from '../src/board/simplify.js';

/** A 10,000-point scribble: loops that drift across a wide board, with a hand's jitter (seeded, so the test is fixed). */
function scribble(n: number): StrokePoint[] {
  let seed = 42;
  const rand = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: n }, (_, i) => {
    const t = i / 40;
    return [Math.round(-4000 + i * 0.9 + 180 * Math.cos(t) + rand() * 2), Math.round(-1200 + 240 * Math.sin(t * 1.3) + 90 * Math.sin(t / 7) + rand() * 2)] as const;
  });
}
/** The furthest any point of `all` lies from the polyline `kept`. */
function deviation(all: readonly StrokePoint[], kept: readonly StrokePoint[]): number {
  let worst = 0;
  let k = 0;
  for (const p of all) {
    // kept is a subsequence of all: walk to the segment that covers p
    while (k < kept.length - 2 && p[0] === kept[k + 1]![0] && p[1] === kept[k + 1]![1]) k++;
    let best = Infinity;
    for (let j = Math.max(0, k - 1); j < Math.min(kept.length - 1, k + 2); j++) best = Math.min(best, segmentDistance(p, kept[j]!, kept[j + 1]!));
    worst = Math.max(worst, best);
  }
  return worst;
}

describe('fitStroke', () => {
  it('the budget is half of each limit the mod refuses at', () => {
    expect(STROKE_BUDGET.points * 2).toBeLessThanOrEqual(DIM_LIMITS.points / 2);
    expect(STROKE_BUDGET.bytes).toBeLessThanOrEqual((16 * 1024) / 2);
  });
  it('a stroke that fits is only rounded: no point is dropped', () => {
    const pts: StrokePoint[] = Array.from({ length: 300 }, (_, i) => [i * 1.4, Math.sin(i / 9) * 40] as const);
    const out = fitStroke(pts);
    expect(out.tolerance).toBe(0);
    expect(out.points).toEqual(pts.map(([x, y]) => [Math.round(x), Math.round(y)]));
  });
  it('a 10,000-point scribble fits, keeps its ends, and no dropped point is further from it than the tolerance', () => {
    const pts = scribble(10_000);
    const out = fitStroke(pts);
    expect(strokeFits(out.points)).toBe(true);
    expect(out.points.length * 2).toBeLessThanOrEqual(DIM_LIMITS.points);
    expect(JSON.stringify(out.points.flat()).length).toBe(strokeBytes(out.points));
    expect(strokeBytes(out.points)).toBeLessThanOrEqual(STROKE_BUDGET.bytes);
    expect(out.points[0]).toEqual(pts[0]);
    expect(out.points.at(-1)).toEqual(pts.at(-1));
    expect(out.tolerance).toBeGreaterThan(0);
    expect(out.tolerance).toBeLessThanOrEqual(8); // board units, on a stroke 9,000 wide
    expect(deviation(pts, out.points)).toBeLessThanOrEqual(out.tolerance + 1e-9);
    // it is still a scribble, not a line
    expect(out.points.length).toBeGreaterThan(200);
  });
  it('the tolerance tightens only as far as needed: one step less does not fit', () => {
    const pts = scribble(10_000);
    const out = fitStroke(pts);
    expect(strokeFits(rdp(pts, out.tolerance / 1.5))).toBe(false);
  });
  it('a stroke of large coordinates is held to the byte budget, not only the point count', () => {
    const pts: StrokePoint[] = Array.from({ length: 1000 }, (_, i) => [-900_000_000 + i * 7 + (i % 2) * 3, -800_000_000 + ((i * 37) % 501)] as const);
    expect(strokeFits(pts)).toBe(false);
    const out = fitStroke(pts);
    expect(strokeBytes(out.points)).toBeLessThanOrEqual(STROKE_BUDGET.bytes);
  });
  it('never loops on a stroke nothing can shorten', () => {
    expect(fitStroke([[0, 0], [1, 1]]).points).toEqual([[0, 0], [1, 1]]);
    expect(rdp([[0, 0]], 1)).toEqual([[0, 0]]);
  });
});
