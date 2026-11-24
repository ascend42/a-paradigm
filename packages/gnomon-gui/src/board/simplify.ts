/**
 * @symbol #gui-board
 *
 * Long strokes (boards S1.3 pass P3b). The dimension mod refuses a row whole when a stroke has more than
 * `DIM_LIMITS.points` values or the row is over 16 KiB, so a long scribble would be lost. Before a freehand stroke
 * is sent, the handle fits it into STROKE_BUDGET (half of each limit) with the Ramer-Douglas-Peucker rule: a point
 * is dropped only when it lies within the tolerance of the line that replaces it. The tolerance starts at
 * STROKE_TOLERANCE.start and grows only until the stroke fits, so a stroke that already fits is not touched and a
 * long one loses as little as it can. PURE: no DOM, no engine import. test/board-simplify.test.ts holds it.
 */

/** The budget a sent stroke fits: points (two values each) and the bytes of its `points` array as JSON. */
export const STROKE_BUDGET = Object.freeze({ points: 1024, bytes: 8192 });
/** The first tolerance tried, in board units, and how fast it grows when the stroke still does not fit. */
export const STROKE_TOLERANCE = Object.freeze({ start: 0.5, grow: 1.5 });

export type StrokePoint = readonly [number, number];

/** The bytes of a point list as the flat JSON array a row carries. */
export const strokeBytes = (points: readonly StrokePoint[]): number => {
  let n = 1; // the two brackets, less the comma the last value does not have
  for (const [x, y] of points) n += String(x).length + String(y).length + 2;
  return Math.max(2, n);
};
export const strokeFits = (points: readonly StrokePoint[]): boolean => points.length <= STROKE_BUDGET.points && strokeBytes(points) <= STROKE_BUDGET.bytes;

/** The distance from p to the segment a-b. */
export function segmentDistance(p: StrokePoint, a: StrokePoint, b: StrokePoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ramer-Douglas-Peucker with an explicit stack (a long stroke must not overflow the call stack). The ends stay. */
export function rdp(points: readonly StrokePoint[], tolerance: number): StrokePoint[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop() as [number, number];
    let far = -1;
    let worst = tolerance;
    for (let i = lo + 1; i < hi; i++) {
      const d = segmentDistance(points[i]!, points[lo]!, points[hi]!);
      if (d > worst) {
        worst = d;
        far = i;
      }
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push([lo, far], [far, hi]);
  }
  return points.filter((_, i) => keep[i] === 1);
}

/**
 * A stroke that fits STROKE_BUDGET. `tolerance` is 0 when nothing was dropped; otherwise every dropped point lies
 * within it of the stroke that is kept. Coordinates are rounded to whole board units first (what a row stores).
 */
export function fitStroke(points: readonly StrokePoint[]): { points: StrokePoint[]; tolerance: number } {
  const whole: StrokePoint[] = points.map(([x, y]) => [Math.round(x), Math.round(y)] as const);
  if (strokeFits(whole)) return { points: whole, tolerance: 0 };
  let tolerance: number = STROKE_TOLERANCE.start;
  for (;;) {
    const out = rdp(whole, tolerance);
    if (strokeFits(out) || out.length <= 2) return { points: out, tolerance };
    tolerance *= STROKE_TOLERANCE.grow;
  }
}
