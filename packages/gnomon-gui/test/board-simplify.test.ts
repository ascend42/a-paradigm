/**
 * Long strokes (boards S1.3 pass P3b and review batch B2, src/board/simplify.ts): no stroke a person can draw is
 * refused for size, lost, flattened to a line or collapsed, and the cost is bounded by COUNTING distance
 * computations, never by a clock.
 */
import { describe, expect, it } from 'vitest';
import { DIM_LIMITS } from '@a-company/gnomon-contracts';
import { cleanStroke, fitStroke, rdp, segmentDistance, STROKE_BUDGET, STROKE_THIN_TOLERANCE, STROKE_TOLERANCE_CEILING, STROKE_WINDOW, strokeBytes, strokeFits, type StrokePoint, type StrokeWork } from '../src/board/simplify.js';

/** Loops that drift across a wide board, with a hand's jitter (seeded, so the test is fixed). */
function scribble(n: number, at = -4000): StrokePoint[] {
  let seed = 42;
  const rand = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: n }, (_, i) => {
    const t = i / 40;
    return [Math.round(at + i * 0.9 + 180 * Math.cos(t) + rand() * 2), Math.round(at / 3 + 240 * Math.sin(t * 1.3) + 90 * Math.sin(t / 7) + rand() * 2)] as const;
  });
}
/** A zigzag of `corners` corners, 60 units tall: nothing can be dropped from it within the ceiling. */
const zigzag = (corners: number, at = 0): StrokePoint[] => Array.from({ length: corners }, (_, i) => [at + i * 7, at + (i % 2) * 60] as const);
/** The furthest any point of `all` lies from the strokes that were kept (each stroke a polyline). */
function deviation(all: readonly StrokePoint[], strokes: readonly StrokePoint[][]): number {
  const kept = strokes.flatMap((s, n) => (n === 0 ? s : s.slice(1)));
  const index = new Map(all.map((p, i) => [`${p[0]},${p[1]},${i}`, i]));
  void index;
  // kept is a subsequence of all: walk both
  let k = 0;
  let worst = 0;
  for (const p of all) {
    while (k < kept.length - 2 && p[0] === kept[k + 1]![0] && p[1] === kept[k + 1]![1]) k++;
    let best = Infinity;
    for (let j = Math.max(0, k - 1); j < Math.min(kept.length - 1, k + 2); j++) best = Math.min(best, segmentDistance(p, kept[j]!, kept[j + 1]!));
    worst = Math.max(worst, best);
  }
  return worst;
}
const fitsAll = (strokes: readonly StrokePoint[][]): void => {
  for (const s of strokes) {
    expect(strokeFits(s)).toBe(true);
    expect(s.length * 2).toBeLessThanOrEqual(DIM_LIMITS.points);
    expect(JSON.stringify(s.flat()).length).toBe(strokeBytes(s));
    expect(s.length).toBeGreaterThanOrEqual(2);
  }
  // each piece starts where the one before it ended: the scribble is one line on the board
  for (let i = 1; i < strokes.length; i++) expect(strokes[i]![0]).toEqual(strokes[i - 1]!.at(-1));
};

describe('fitStroke', () => {
  it('the budget is under each limit the mod refuses at, with room for the row around the points', () => {
    expect(STROKE_BUDGET.points * 2).toBeLessThanOrEqual(DIM_LIMITS.points);
    expect(STROKE_BUDGET.points).toBeGreaterThanOrEqual(1900);
    expect(STROKE_BUDGET.bytes).toBeLessThanOrEqual(16 * 1024 - 4 * 1024);
    expect(STROKE_TOLERANCE_CEILING).toBe(4);
  });
  it('a stroke that fits is only rounded: no point is dropped', () => {
    const pts: StrokePoint[] = Array.from({ length: 300 }, (_, i) => [i * 1.4, Math.sin(i / 9) * 40] as const);
    const out = fitStroke(pts);
    expect(out.tolerance).toBe(0);
    expect(out.strokes).toEqual([cleanStroke(pts)]);
  });
  it('a 10,000-point scribble is ONE stroke at the smallest tolerance that fits: it uses the budget, it does not overshoot', () => {
    const pts = scribble(10_000);
    const work: StrokeWork = { distances: 0 };
    const out = fitStroke(pts, { work });
    expect(out.strokes).toHaveLength(1);
    fitsAll(out.strokes);
    const kept = out.strokes[0]!;
    expect(kept[0]).toEqual(pts[0]);
    expect(kept.at(-1)).toEqual(pts.at(-1));
    expect(out.tolerance).toBeGreaterThan(0);
    expect(out.tolerance).toBeLessThanOrEqual(STROKE_TOLERANCE_CEILING);
    expect(deviation(cleanStroke(pts), out.strokes)).toBeLessThanOrEqual(out.tolerance + 1e-9);
    // right at the budget, whichever of the two binds (here the bytes; the first version kept 504 of 1,024 allowed)
    expect(Math.max(kept.length / STROKE_BUDGET.points, strokeBytes(kept) / STROKE_BUDGET.bytes)).toBeGreaterThan(0.98);
    expect(work.distances).toBeLessThanOrEqual((pts.length * STROKE_WINDOW) / 2);
  });
  it.each([[1500, 1], [3000, 2], [20_000, 15]])('a zigzag of %i corners is never flattened: it fits as it is or is split into %i strokes, every corner kept', (corners, pieces) => {
    const pts = zigzag(corners);
    const work: StrokeWork = { distances: 0 };
    const out = fitStroke(pts, { work });
    expect(out.strokes).toHaveLength(pieces);
    fitsAll(out.strokes);
    // every corner is still there
    expect(out.strokes.reduce((n, s) => n + s.length, 0) - (out.strokes.length - 1)).toBe(corners);
    expect(deviation(pts, out.strokes)).toBe(0);
    expect(out.tolerance).toBeLessThanOrEqual(STROKE_TOLERANCE_CEILING);
    // the work bound, by counting (20,000 corners took 42 s before)
    expect(work.distances).toBeLessThanOrEqual((corners * STROKE_WINDOW) / 2);
  });
  it('100,000 points of loops: fitted, within the ceiling, in bounded work', () => {
    const pts = scribble(100_000);
    const work: StrokeWork = { distances: 0 };
    const out = fitStroke(pts, { work });
    fitsAll(out.strokes);
    expect(out.tolerance).toBeLessThanOrEqual(STROKE_TOLERANCE_CEILING);
    expect(deviation(cleanStroke(pts), out.strokes)).toBeLessThanOrEqual(STROKE_TOLERANCE_CEILING + 1e-9);
    expect(work.distances).toBeLessThanOrEqual((pts.length * STROKE_WINDOW) / 2);
    expect(out.strokes.length).toBeLessThan(20);
  });
  it('coordinates near -9e8 are held to the byte budget, not only the point count', () => {
    const pts = scribble(3000, -900_000_000);
    expect(strokeFits(cleanStroke(pts))).toBe(false);
    const out = fitStroke(pts);
    fitsAll(out.strokes);
    for (const s of out.strokes) expect(strokeBytes(s)).toBeLessThanOrEqual(STROKE_BUDGET.bytes);
    expect(deviation(cleanStroke(pts), out.strokes)).toBeLessThanOrEqual(STROKE_TOLERANCE_CEILING + 1e-9);
  });
  it('points that are not finite are dropped first: an Infinity is not kept and a NaN first point collapses nothing', () => {
    const good = scribble(3000);
    const bad = [[NaN, 0] as const, ...good.slice(0, 1500), [Infinity, 5] as const, [3, -Infinity] as const, ...good.slice(1500)];
    const out = fitStroke(bad);
    fitsAll(out.strokes);
    for (const s of out.strokes) for (const p of s) expect(Number.isFinite(p[0]) && Number.isFinite(p[1])).toBe(true);
    expect(out.strokes.reduce((n, s) => n + s.length, 0)).toBeGreaterThan(1000); // it was 2
    expect(out.strokes[0]![0]).toEqual(good[0]);
    expect(fitStroke([[NaN, NaN], [Infinity, 0]]).strokes).toEqual([[]]);
  });
  it('a point equal to the one before it is dropped (a drawn stroke carried its last point twice)', () => {
    expect(cleanStroke([[0, 0], [0.2, 0.1], [5, 5], [5, 5], [5.4, 5.3]])).toEqual([[0, 0], [5, 5]]);
  });
  it('thin: a stroke drawn above 100% zoom loses its whole-unit steps at tolerance 0.5 even though it fits', () => {
    // 681 samples of a slow curve at 400%: about four samples per board unit, rounded to whole units
    const pts: StrokePoint[] = Array.from({ length: 681 }, (_, i) => [i / 4, 40 * Math.sin(i / 110)] as const);
    const plain = fitStroke(pts);
    expect(plain.tolerance).toBe(0);
    const thin = fitStroke(pts, { thin: true });
    expect(thin.tolerance).toBe(STROKE_THIN_TOLERANCE);
    expect(thin.strokes).toHaveLength(1);
    expect(thin.strokes[0]!.length).toBeLessThan(plain.strokes[0]!.length / 2);
    expect(deviation(cleanStroke(pts), thin.strokes)).toBeLessThanOrEqual(STROKE_THIN_TOLERANCE + 1e-9);
  });
  it('rdp keeps the ends and never loops on a stroke nothing can shorten', () => {
    expect(rdp([[0, 0], [1, 1]], 1)).toEqual([[0, 0], [1, 1]]);
    expect(rdp([[0, 0]], 1)).toEqual([[0, 0]]);
    expect(rdp([[0, 0], [5, 0.2], [10, 0]], 0.5)).toEqual([[0, 0], [10, 0]]);
    expect(fitStroke([[0, 0], [1, 1]]).strokes).toEqual([[[0, 0], [1, 1]]]);
  });
});
