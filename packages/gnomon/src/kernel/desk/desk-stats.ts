/**
 * @symbol #desk-stats
 *
 * The Desk's per-mod offer counts (TD-2026-10-20-812, A6): the PURE fold `gnomon desk stats` prints, and the
 * kernel's live tally of it (DeskTally) that status.mods.installed[].desk carries to the GUI's Mods panel, so the
 * two read the same numbers from the same rows. Moved here from cli/desk-cli.ts (which re-exports it) so the kernel
 * can use it without importing the CLI.
 *
 * DeskTally: seeded once from the kernel log (the DESK_STAT_KINDS rows, human projection), then fed every committed
 * row of those kinds (onCommit). The rows kept are tiny (kind, payload, principal, seq, session) and bounded
 * (DESK_TALLY_MAX_ROWS, oldest dropped); the fold reruns only when a row arrived since the last read. Unlike the CLI
 * it does not re-verify the chain: the running kernel's own log is the one it appends and verifies at open.
 */
export interface DeskModStats {
  shown: number;
  open: number;
  notNow: number;
  stopHere: number;
  kept: number;
  /** offer.suppressed rows naming this mod */
  suppressed: number;
  /** …by reason (OFFER_SUPPRESS_REASONS) */
  suppressedBy: Record<string, number>;
  /** re-review M-3: offers retired before any decision (offer.retired; not counted in shown) */
  retired: number;
}

/** offer.suppressed rows that name no mod (no-block, malformed), per reason and per session. */
export interface DeskUnnamedStats {
  byReason: Record<string, number>;
  /** hsid → reason → count */
  bySession: Record<string, Record<string, number>>;
}

const bump = (m: Record<string, number>, k: string): void => void (m[k] = (m[k] ?? 0) + 1);

/** A verified offer.* (or session.open) row: its kind, payload and the principal that wrote it (the envelope's). */
export interface DeskRow {
  kind: string;
  payload: unknown;
  principal?: string;
  /** the row's seq (session.open: the session epoch, re-review M-3) */
  seq?: number;
  /** the envelope's session */
  session?: string;
}
/** The kinds the stats read: the offer rows and session.open (the epoch of a suppression's turn id). */
export const DESK_STAT_KINDS: readonly string[] = Object.freeze(['offer.shown', 'offer.decided', 'offer.kept', 'offer.suppressed', 'offer.retired', 'session.open']);
/** review C2: with a kernel principal, only the kernel's offer.shown / suppressed / retired and session.open rows count. */
const KERNEL_ONLY = new Set(['offer.shown', 'offer.suppressed', 'offer.retired', 'session.open']);
const foreign = (r: DeskRow, kernel: string | undefined): boolean => kernel !== undefined && KERNEL_ONLY.has(r.kind) && r.principal !== kernel;
const payloadOf = (r: DeskRow): Record<string, unknown> => (r.payload !== null && typeof r.payload === 'object' ? (r.payload as Record<string, unknown>) : {});

/**
 * Re-review M-3: the kernel's offer.suppressed rows to count, in log order: one per (hsid, session epoch, turn). The
 * epoch is the seq of the latest session.open of that hsid (turn ids restart at /1 after a resume, review C3); a
 * continuation that re-evaluates a turn writes a second row for the same turn, which is not counted again.
 */
function* countedSuppressions(rows: Iterable<DeskRow>, kernel: string | undefined): Generator<Record<string, unknown>> {
  const epoch = new Map<string, number>();
  const seen = new Set<string>();
  let opens = 0;
  for (const r of rows) {
    if (foreign(r, kernel)) continue;
    const p = payloadOf(r);
    if (r.kind === 'session.open') {
      const h = typeof p.hsid === 'string' ? p.hsid : r.session;
      opens++;
      if (typeof h === 'string') epoch.set(h, r.seq ?? -opens);
      continue;
    }
    if (r.kind !== 'offer.suppressed' || typeof p.hsid !== 'string' || typeof p.turn !== 'string') continue;
    const key = `${p.hsid}|${epoch.get(p.hsid) ?? 0}|${p.turn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    yield p;
  }
}

/** offer.suppressed rows (in log order) that name no mod, folded per reason and per session. */
export function foldDeskUnnamed(rows: Iterable<DeskRow>, opts: { kernelPrincipal?: string } = {}): DeskUnnamedStats {
  const out: DeskUnnamedStats = { byReason: {}, bySession: {} };
  for (const p of countedSuppressions(rows, opts.kernelPrincipal)) {
    if (typeof p.name === 'string' || typeof p.why !== 'string' || typeof p.hsid !== 'string') continue;
    bump(out.byReason, p.why);
    bump((out.bySession[p.hsid] ??= {}), p.why);
  }
  return out;
}

/** Fold offer rows (in log order) into per-mod counts. Decisions and kept rows count once per offer. */
export function foldDeskStats(rows: Iterable<DeskRow>, opts: { kernelPrincipal?: string } = {}): Record<string, DeskModStats> {
  const byOffer = new Map<string, { mod: string; decided: boolean; kept: boolean; retired: boolean }>();
  const out: Record<string, DeskModStats> = {};
  const of = (mod: string): DeskModStats => (out[mod] ??= { shown: 0, open: 0, notNow: 0, stopHere: 0, kept: 0, suppressed: 0, suppressedBy: {}, retired: 0 });
  const list = [...rows];
  // re-review M-3: one per (hsid, epoch, turn); the unnamed ones fold in foldDeskUnnamed
  for (const p of countedSuppressions(list, opts.kernelPrincipal)) {
    if (typeof p.name === 'string' && typeof p.why === 'string') {
      const s = of(p.name);
      s.suppressed++;
      bump(s.suppressedBy, p.why);
    }
  }
  for (const r of list) {
    if (foreign(r, opts.kernelPrincipal)) continue;
    // review C3: keyed by offerId (a ULID) and mod, never by turn id (turn ids restart at /1 after a resume)
    const p = payloadOf(r);
    const id = typeof p.offerId === 'string' ? p.offerId : null;
    if (!id) continue;
    if (r.kind === 'offer.shown' && typeof p.mod === 'string' && !byOffer.has(id)) {
      byOffer.set(id, { mod: p.mod, decided: false, kept: false, retired: false });
      of(p.mod).shown++;
    } else if (r.kind === 'offer.retired') {
      // re-review M-3: a continuation retired it before any decision: it never stood, so it is not "shown"
      const o = byOffer.get(id);
      if (!o || o.decided || o.retired) continue;
      o.retired = true;
      const s = of(o.mod);
      s.shown--;
      s.retired++;
    } else if (r.kind === 'offer.decided') {
      const o = byOffer.get(id);
      if (!o || o.decided || o.retired) continue;
      o.decided = true;
      const s = of(o.mod);
      if (p.decision === 'open') s.open++;
      else if (p.decision === 'not-now') s.notNow++;
      else if (p.decision === 'stop-here') s.stopHere++;
    } else if (r.kind === 'offer.kept') {
      const o = byOffer.get(id);
      if (!o || o.kept) continue;
      o.kept = true;
      of(o.mod).kept++;
    }
  }
  return out;
}

/** DeskTally's row bound (offer rows are a few per turn; the oldest go first past it). */
export const DESK_TALLY_MAX_ROWS = 200_000;

/** The kernel log as DeskTally reads it (a KernelLog). */
export interface DeskTallyLog {
  read(opts: { reader: { class: 'human' }; kinds?: readonly string[] }): Iterable<{ seq: number; view: string; event?: unknown }>;
  onCommit(listener: (e: { seq: number; kind: string; principal?: string; session?: string; payload?: unknown }) => void): () => void;
}

/** The compact per-mod numbers status.mods.installed[].desk carries (the same fold as `gnomon desk stats`). */
export interface DeskTallyView {
  shown: number;
  suppressed: number;
  kept: number;
  open: number;
  notNow: number;
  stopHere: number;
}

/** The kernel's live `gnomon desk stats`: seeded from the log once, then fed by onCommit. */
export class DeskTally {
  readonly #rows: DeskRow[] = [];
  readonly #kernelPrincipal: string;
  #dirty = true;
  #folded: Record<string, DeskModStats> = {};
  #off: (() => void) | null = null;

  constructor(o: { log: DeskTallyLog; kernelPrincipal: string }) {
    this.#kernelPrincipal = o.kernelPrincipal;
    // subscribe first, then seed: a row committed during the seed is deduplicated by seq below
    const live: DeskRow[] = [];
    let seeding = true;
    this.#off = o.log.onCommit((e) => {
      if (!DESK_STAT_KINDS.includes(e.kind)) return;
      const r: DeskRow = { kind: e.kind, payload: e.payload, seq: e.seq, ...(e.principal ? { principal: e.principal } : {}), ...(e.session ? { session: e.session } : {}) };
      if (seeding) live.push(r);
      else this.#push(r);
    });
    let last = 0;
    try {
      for (const v of o.log.read({ reader: { class: 'human' }, kinds: DESK_STAT_KINDS })) {
        if (v.view !== 'full' || !v.event || typeof v.event !== 'object') continue;
        const e = v.event as { kind?: unknown; payload?: unknown; principal?: unknown; session?: unknown };
        if (typeof e.kind !== 'string') continue;
        this.#push({ kind: e.kind, payload: e.payload, seq: v.seq, ...(typeof e.principal === 'string' ? { principal: e.principal } : {}), ...(typeof e.session === 'string' ? { session: e.session } : {}) });
        last = v.seq;
      }
    } finally {
      seeding = false;
      for (const r of live) if ((r.seq ?? 0) > last) this.#push(r);
    }
  }

  #push(r: DeskRow): void {
    if (this.#rows.length >= DESK_TALLY_MAX_ROWS) this.#rows.shift();
    this.#rows.push(r);
    this.#dirty = true;
  }

  /** Per-mod counts, folded exactly as `gnomon desk stats` folds them. */
  stats(): Record<string, DeskModStats> {
    if (this.#dirty) {
      this.#folded = foldDeskStats(this.#rows, { kernelPrincipal: this.#kernelPrincipal });
      this.#dirty = false;
    }
    return this.#folded;
  }

  /** One mod's compact view (zeros when it never offered). */
  of(mod: string): DeskTallyView {
    const s = this.stats()[mod];
    return { shown: s?.shown ?? 0, suppressed: s?.suppressed ?? 0, kept: s?.kept ?? 0, open: s?.open ?? 0, notNow: s?.notNow ?? 0, stopHere: s?.stopHere ?? 0 };
  }

  close(): void {
    this.#off?.();
    this.#off = null;
  }
}

