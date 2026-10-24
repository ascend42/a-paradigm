/**
 * @symbol #mod-host
 *
 * Row folding for attacker-triggerable #mod-host rows (Aegis R2-1/R2-2, M1.11
 * slice 2 round 3) — the same pattern as the daemon's socket.hello /
 * socket.auth.fail folding: the first `perWindow` rows of a window are
 * written individually, the rest are COUNTED by key and written as ONE
 * coalesced row when the window ends (timer), when the next window opens,
 * and on flush (stop / stopAll).
 *
 * Bounded by construction: at most FOLD_MAX_KEYS keys are kept with their
 * counts; hits on any other key are summed into `other<Field>`; distinct
 * keys are counted exactly up to FOLD_DISTINCT_CAP and then reported as
 * capped. Keys are clipped to FOLD_KEY_MAX chars. So a coalesced row has a
 * fixed size bound whatever a mod sends (rotating names, verbs, …).
 */

export const FOLD_MAX_KEYS = 16;
export const FOLD_DISTINCT_CAP = 1024;
export const FOLD_KEY_MAX = 96;

export interface RowFoldOptions {
  perWindow: number;
  windowMs: number;
  now: () => number;
  /** writes one row (individual or coalesced) */
  write: (payload: Record<string, unknown>) => void;
  /** fields every coalesced row carries (e.g. {name, code}) */
  base: Record<string, unknown>;
  /** the coalesced row's map field, e.g. `byName`; the overflow field is `other<Field>` */
  field: string;
}

export class RowFold {
  readonly #o: RowFoldOptions;
  #windowStart = -Infinity;
  #individual = 0;
  #count = 0;
  #other = 0;
  readonly #by = new Map<string, number>();
  readonly #distinct = new Set<string>();
  #distinctCapped = false;
  #timer: NodeJS.Timeout | undefined;

  constructor(o: RowFoldOptions) {
    this.#o = o;
  }

  /** One occurrence of `key`; `row` is written as-is while the window still has individual room. */
  hit(key: string, row: Record<string, unknown>): void {
    const now = this.#o.now();
    if (now - this.#windowStart >= this.#o.windowMs) {
      this.flush();
      this.#windowStart = now;
      this.#individual = 0;
    }
    if (this.#individual < this.#o.perWindow) {
      this.#individual++;
      this.#o.write(row);
      return;
    }
    const k = key.slice(0, FOLD_KEY_MAX);
    this.#count++;
    if (this.#by.has(k) || this.#by.size < FOLD_MAX_KEYS) this.#by.set(k, (this.#by.get(k) ?? 0) + 1);
    else this.#other++;
    if (!this.#distinct.has(k)) {
      if (this.#distinct.size < FOLD_DISTINCT_CAP) this.#distinct.add(k);
      else this.#distinctCapped = true;
    }
    if (!this.#timer) {
      this.#timer = setTimeout(() => this.flush(), this.#o.windowMs);
      this.#timer.unref();
    }
  }

  /** Write the coalesced row for what has been folded so far (nothing when nothing was folded). */
  flush(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#count === 0) return;
    const f = this.#o.field;
    const other = `other${f.charAt(2).toUpperCase()}${f.slice(3)}`; // byName → otherName(s) shape: byName → otherName
    this.#o.write({
      ...this.#o.base,
      coalesced: true,
      count: this.#count,
      [f]: Object.fromEntries(this.#by),
      [`${other}s`]: this.#other,
      distinct: this.#distinct.size,
      ...(this.#distinctCapped ? { distinctCapped: true } : {}),
    });
    this.#count = 0;
    this.#other = 0;
    this.#by.clear();
    this.#distinct.clear();
    this.#distinctCapped = false;
  }

  close(): void {
    this.flush();
  }
}
