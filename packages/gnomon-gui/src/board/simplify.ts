/**
 * @symbol #gui-board
 *
 * Long strokes (boards S1.3 pass P3b; review batch B2). The dimension mod refuses a row whole when a stroke has
 * more than `DIM_LIMITS.points` values (2,048 points) or the row is over 16 KiB, so a long scribble would be lost.
 * Before a new freehand stroke is sent the handle fits it into STROKE_BUDGET:
 *
 *  1. points that are not finite numbers are dropped, coordinates are rounded to whole board units (what a row
 *     stores) and a point equal to the one before it is dropped;
 *  2. a stroke that fits is left as it is (unless `thin` asks for the half-unit pass, see below);
 *  3. otherwise each point gets the tolerance at which the Ramer-Douglas-Peucker rule would drop it, and the
 *     SMALLEST tolerance that makes the stroke fit is used (no growth steps, so no overshoot);
 *  4. the tolerance never passes STROKE_TOLERANCE_CEILING (4 board units). A stroke that does not fit at the
 *     ceiling is SPLIT into several strokes that share their end points: a scribble is never lost, flattened to a
 *     line or collapsed.
 *
 * COST is bounded by counting: the rule runs on windows of STROKE_WINDOW points whose ends are always kept, so the
 * distance computations are at most `points * STROKE_WINDOW / 2` whatever the shape (a zigzag is the worst case).
 * `thin`: a stroke drawn above 100% zoom has several pointer samples per board unit, and whole-unit rounding
 * leaves them as visible steps; the half-unit pass (tolerance 0.5) removes the steps and nothing a unit grid can
 * show. PURE: no DOM, no engine import. test/board-simplify.test.ts holds it.
 */

/** What one sent stroke fits: points (two values each) and the bytes of its `points` array as JSON. */
export const STROKE_BUDGET = Object.freeze({ points: 1900, bytes: 12 * 1024 });
/** No dropped point lies further than this from the stroke that is kept, in board units. */
export const STROKE_TOLERANCE_CEILING = 4;
/** The tolerance of the half-unit pass for a stroke drawn above 100% zoom. */
export const STROKE_THIN_TOLERANCE = 0.5;
/** The rule runs on windows of this many points (their ends are kept), which bounds its cost. */
export const STROKE_WINDOW = 1024;

export type StrokePoint = readonly [number, number];
/** Counts distance computations, for the work bound in tests. */
export interface StrokeWork { distances: number }

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

/** Finite points only, in whole units, with no point equal to the one before it. */
export function cleanStroke(points: readonly StrokePoint[]): StrokePoint[] {
  const out: StrokePoint[] = [];
  for (const p of points) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const q = [Math.round(p[0]), Math.round(p[1])] as const;
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  return out;
}

/**
 * For each point, the tolerance above which the Ramer-Douglas-Peucker rule drops it (Infinity for a point that is
 * always kept: the ends of the stroke and of each window). Keeping the points whose value is above t is exactly
 * the rule's result at tolerance t. Explicit stack: a long stroke must not overflow the call stack.
 */
export function strokeSignificance(points: readonly StrokePoint[], work: StrokeWork = { distances: 0 }): Float64Array {
  const sig = new Float64Array(points.length);
  if (points.length === 0) return sig;
  const stack: Array<[number, number, number]> = [];
  for (let lo = 0; lo < points.length - 1; lo += STROKE_WINDOW - 1) {
    const hi = Math.min(points.length - 1, lo + STROKE_WINDOW - 1);
    sig[lo] = Infinity;
    sig[hi] = Infinity;
    stack.push([lo, hi, Infinity]);
  }
  sig[0] = Infinity;
  sig[points.length - 1] = Infinity;
  while (stack.length > 0) {
    const [lo, hi, cap] = stack.pop() as [number, number, number];
    if (hi - lo < 2) continue;
    let far = lo + 1;
    let worst = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = segmentDistance(points[i]!, points[lo]!, points[hi]!);
      if (d > worst) {
        worst = d;
        far = i;
      }
    }
    work.distances += hi - lo - 1;
    // a point is never worth more than the split that exposed it: the kept set at t is then the rule's own
    const mine = Math.min(worst, cap);
    sig[far] = mine;
    stack.push([lo, far, mine], [far, hi, mine]);
  }
  return sig;
}

/** Ramer-Douglas-Peucker at one tolerance (the ends stay). */
export function rdp(points: readonly StrokePoint[], tolerance: number, work?: StrokeWork): StrokePoint[] {
  if (points.length <= 2) return [...points];
  const sig = strokeSignificance(points, work);
  return points.filter((_, i) => (sig[i] as number) > tolerance);
}

export interface FittedStroke {
  /** one stroke, or several that share their end points when one cannot fit within the ceiling */
  strokes: StrokePoint[][];
  /** 0 when no point was dropped for size; otherwise every dropped point lies within it of the stroke that is kept */
  tolerance: number;
}

/** Fit a stroke to STROKE_BUDGET. See the file comment for the rule. `thin`: also run the half-unit pass. */
export function fitStroke(points: readonly StrokePoint[], opts: { thin?: boolean; work?: StrokeWork } = {}): FittedStroke {
  const whole = cleanStroke(points);
  const floor = opts.thin ? STROKE_THIN_TOLERANCE : 0;
  if (whole.length <= 2 || (floor === 0 && strokeFits(whole))) return { strokes: [whole], tolerance: 0 };
  const sig = strokeSignificance(whole, opts.work);
  const keep = (t: number): StrokePoint[] => whole.filter((_, i) => (sig[i] as number) > t);
  // the candidate tolerances are the points' own values: the smallest one that fits is exact, never an overshoot
  const levels = [...new Set([floor, ...Array.from(sig).filter((v) => v > floor && v <= STROKE_TOLERANCE_CEILING)])].sort((a, b) => a - b);
  let lo = 0;
  let hi = levels.length - 1;
  if (strokeFits(keep(levels[hi] as number))) {
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (strokeFits(keep(levels[mid] as number))) hi = mid;
      else lo = mid + 1;
    }
    const t = levels[lo] as number;
    return { strokes: [keep(t)], tolerance: t };
  }
  // it does not fit at the ceiling: several strokes, each within the budget, each starting where the last one ended
  const t = levels[levels.length - 1] as number;
  const kept = keep(t);
  const strokes: StrokePoint[][] = [];
  let piece: StrokePoint[] = [];
  let bytes = 1;
  for (const p of kept) {
    const b = String(p[0]).length + String(p[1]).length + 2;
    if (piece.length >= 2 && (piece.length + 1 > STROKE_BUDGET.points || bytes + b > STROKE_BUDGET.bytes)) {
      strokes.push(piece);
      const joint = piece[piece.length - 1] as StrokePoint;
      piece = [joint];
      bytes = 1 + String(joint[0]).length + String(joint[1]).length + 2;
    }
    piece.push(p);
    bytes += b;
  }
  if (piece.length >= 2 || strokes.length === 0) strokes.push(piece);
  return { strokes, tolerance: t };
}
