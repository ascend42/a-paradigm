/**
 * @symbol #gui
 *
 * #gui virtualized transcript geometry (spec §11.1 "virtualized transcript
 * (only visible rows mount; row heights cached per width)", `G-GUI-01`).
 * PURE: a Fenwick tree of row heights gives O(log n) offset-of-row and
 * row-at-offset, so a 200k-row session costs the same per scroll or
 * keystroke as a 20-row one. Heights are cached per WIDTH: a resize to a
 * width never measured falls back to the estimate, a width seen before
 * restores its measurements (deepseek-harness's long-session lesson).
 */

export class HeightIndex {
  #n = 0;
  #tree: Float64Array = new Float64Array(1);
  #h: Float64Array = new Float64Array(0);
  readonly estimate: number;

  constructor(estimate = 22) {
    this.estimate = estimate;
  }

  get length(): number {
    return this.#n;
  }

  /** Append `count` rows at the estimated height. Amortized O(log n) each. */
  push(count = 1): void {
    const need = this.#n + count;
    if (need + 1 > this.#tree.length) this.#grow(Math.max(need + 1, this.#tree.length * 2));
    for (let i = 0; i < count; i++) {
      const idx = this.#n++;
      this.#h[idx] = this.estimate;
      this.#add(idx, this.estimate);
    }
  }

  #grow(size: number): void {
    const h = new Float64Array(size);
    h.set(this.#h.subarray(0, this.#n));
    this.#h = h;
    // rebuild the tree in O(n)
    const t = new Float64Array(size + 1);
    for (let i = 1; i <= this.#n; i++) {
      t[i] += h[i - 1]!;
      const j = i + (i & -i);
      if (j <= size) t[j] += t[i]!;
    }
    this.#tree = t;
  }

  #add(idx: number, delta: number): void {
    for (let i = idx + 1; i < this.#tree.length; i += i & -i) this.#tree[i] += delta;
  }

  height(idx: number): number {
    return this.#h[idx] ?? this.estimate;
  }

  /** Record a measured height. */
  set(idx: number, h: number): void {
    if (idx < 0 || idx >= this.#n || !(h >= 0)) return;
    const d = h - this.#h[idx]!;
    if (d === 0) return;
    this.#h[idx] = h;
    this.#add(idx, d);
  }

  /** Sum of heights of rows [0, idx). */
  offsetOf(idx: number): number {
    let s = 0;
    for (let i = Math.min(idx, this.#n); i > 0; i -= i & -i) s += this.#tree[i]!;
    return s;
  }

  total(): number {
    return this.offsetOf(this.#n);
  }

  /** The row containing pixel `y` (clamped). */
  indexAt(y: number): number {
    if (this.#n === 0) return 0;
    if (y <= 0) return 0;
    let pos = 0;
    let rem = y;
    let step = 1;
    while (step * 2 < this.#tree.length) step *= 2;
    for (; step > 0; step >>= 1) {
      const nxt = pos + step;
      if (nxt <= this.#n && nxt < this.#tree.length && this.#tree[nxt]! <= rem) {
        pos = nxt;
        rem -= this.#tree[nxt]!;
      }
    }
    return Math.min(pos, this.#n - 1);
  }

  /** Measured heights (for the per-width cache). */
  snapshot(): Float64Array {
    return this.#h.slice(0, this.#n);
  }

  static from(heights: Float64Array, estimate: number): HeightIndex {
    const x = new HeightIndex(estimate);
    x.push(heights.length);
    for (let i = 0; i < heights.length; i++) x.set(i, heights[i]!);
    return x;
  }
}

/** Visible rows [start, end) for a viewport, with overscan. */
export function visibleRange(idx: HeightIndex, scrollTop: number, viewport: number, overscan = 8): { start: number; end: number } {
  if (idx.length === 0) return { start: 0, end: 0 };
  const start = Math.max(0, idx.indexAt(scrollTop) - overscan);
  const end = Math.min(idx.length, idx.indexAt(scrollTop + viewport) + 1 + overscan);
  return { start, end };
}

/** Per-width height caches: the index for `width`, built from its own measurements or the estimate. */
export class WidthCache {
  readonly #by = new Map<number, Float64Array>();
  constructor(readonly estimate = 22, readonly maxWidths = 4) {}

  save(width: number, idx: HeightIndex): void {
    this.#by.delete(width);
    this.#by.set(width, idx.snapshot());
    while (this.#by.size > this.maxWidths) this.#by.delete(this.#by.keys().next().value!);
  }

  restore(width: number, rows: number): HeightIndex {
    const saved = this.#by.get(width);
    const idx = saved ? HeightIndex.from(saved.subarray(0, Math.min(saved.length, rows)), this.estimate) : new HeightIndex(this.estimate);
    if (idx.length < rows) idx.push(rows - idx.length);
    return idx;
  }
}
