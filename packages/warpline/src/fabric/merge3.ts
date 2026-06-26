/**
 * #merge3 — a token-level 3-way merge. The materialization primitive behind
 * Phase-C v2: it produces the MERGED bytes for two concurrent edits that commute
 * in meaning but that git's LINE-level merge conflicts on.
 *
 * Why token-level: git merges whole lines, so two edits to DIFFERENT symbols on
 * the SAME physical line conflict. Tokenizing into word/whitespace/punct runs and
 * merging at that granularity resolves them — the edits touch different tokens.
 *
 * SAFETY: this NEVER silently resolves a true overlap. When both sides change the
 * SAME token-region to different values, it records a conflict; the caller MUST
 * check `conflicts > 0` and refuse to use `merged` (Warpline surfaces it as a
 * KNOT the meaning layer missed, rather than corrupting bytes — the VCS cardinal
 * sin). It is a pure function: no I/O.
 */

/** Split text into [word] | [whitespace] | [single punctuation] runs. join === text. */
export function tokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9_]+|\s+|[^A-Za-z0-9_\s]/g) ?? [];
}

const eq = (x: string[], y: string[]): boolean => x.length === y.length && x.every((v, i) => v === y[i]);

/** LCS alignment of a and b → matched (ai, bi) index pairs, strictly increasing. */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:] and b[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

export interface Merge3Result {
  merged: string[];
  /** number of regions BOTH sides changed in OVERLAPPING base ranges — if > 0, `merged` is unsafe. */
  conflicts: number;
}

/** A change hunk: base[baseLo, baseHi) was replaced by `repl` in a variant. */
interface Hunk {
  baseLo: number;
  baseHi: number;
  repl: string[];
}

/** The change hunks of base → variant, derived from the LCS alignment. */
function hunks(base: string[], variant: string[]): Hunk[] {
  const pairs = lcsPairs(base, variant);
  const result: Hunk[] = [];
  let pb = -1;
  let pv = -1;
  for (const [cb, cv] of [...pairs, [base.length, variant.length] as [number, number]]) {
    const baseLo = pb + 1;
    const baseHi = cb;
    const repl = variant.slice(pv + 1, cv);
    if (baseHi > baseLo || repl.length > 0) result.push({ baseLo, baseHi, repl });
    pb = cb;
    pv = cv;
  }
  return result;
}

/** Do two hunks touch overlapping base ranges? (Two inserts at the same point overlap.) */
function conflicts2(a: Hunk, b: Hunk): boolean {
  if (a.baseLo === a.baseHi && b.baseLo === b.baseHi) return a.baseLo === b.baseLo; // same-point inserts
  return a.baseLo < b.baseHi && b.baseLo < a.baseHi; // half-open range overlap
}

/**
 * 3-way merge of token arrays via hunk-based diff3. A base range changed by only
 * ONE side takes that side; a range BOTH sides changed in OVERLAPPING base
 * coordinates is a CONFLICT (counted; `merged` then unsafe). Disjoint changes —
 * even within one line, or a deletion next to an edit — compose cleanly.
 */
export function merge3(base: string[], ours: string[], theirs: string[]): Merge3Result {
  if (eq(ours, base)) return { merged: theirs.slice(), conflicts: 0 };
  if (eq(theirs, base)) return { merged: ours.slice(), conflicts: 0 };
  if (eq(ours, theirs)) return { merged: ours.slice(), conflicts: 0 };

  const ha = hunks(base, ours);
  const hb = hunks(base, theirs);
  const merged: string[] = [];
  let conflicts = 0;
  let cursor = 0; // next base index to emit
  let ia = 0;
  let ib = 0;
  const emitBase = (to: number) => {
    for (let i = cursor; i < to; i++) merged.push(base[i]);
    cursor = Math.max(cursor, to);
  };

  while (ia < ha.length || ib < hb.length) {
    const a = ia < ha.length ? ha[ia] : null;
    const b = ib < hb.length ? hb[ib] : null;

    if (a && b && conflicts2(a, b)) {
      // Overlapping changes → conflict. Absorb the transitive overlap chain.
      let lo = Math.min(a.baseLo, b.baseLo);
      let hi = Math.max(a.baseHi, b.baseHi);
      ia++;
      ib++;
      let grew = true;
      while (grew) {
        grew = false;
        while (ia < ha.length && ha[ia].baseLo < hi) {
          hi = Math.max(hi, ha[ia].baseHi);
          lo = Math.min(lo, ha[ia].baseLo);
          ia++;
          grew = true;
        }
        while (ib < hb.length && hb[ib].baseLo < hi) {
          hi = Math.max(hi, hb[ib].baseHi);
          lo = Math.min(lo, hb[ib].baseLo);
          ib++;
          grew = true;
        }
      }
      emitBase(lo);
      conflicts++;
      // `merged` is unsafe past here anyway; emit the OURS view of the window.
      merged.push(...base.slice(cursor, lo)); // (cursor already at lo)
      cursor = hi;
    } else if (b === null || (a !== null && a.baseLo <= b.baseLo)) {
      // apply ours hunk a
      emitBase(a!.baseLo);
      merged.push(...a!.repl);
      cursor = Math.max(cursor, a!.baseHi);
      ia++;
    } else {
      // apply theirs hunk b
      emitBase(b!.baseLo);
      merged.push(...b!.repl);
      cursor = Math.max(cursor, b!.baseHi);
      ib++;
    }
  }
  emitBase(base.length);
  return { merged, conflicts };
}

/** Text convenience: 3-way merge of strings. `conflicts > 0` ⇒ `text` is unsafe. */
export function mergeText(
  base: string,
  ours: string,
  theirs: string,
): { text: string; conflicts: number } {
  const r = merge3(tokenize(base), tokenize(ours), tokenize(theirs));
  return { text: r.merged.join(''), conflicts: r.conflicts };
}
