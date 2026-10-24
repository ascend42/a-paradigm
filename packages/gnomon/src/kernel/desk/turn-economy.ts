/**
 * @symbol #turn-economy
 *
 * The `turn.economy` fold (orchestration design §12, Phase 0 item 1): what a turn cost in model calls, how much it
 * explored before it first edited, how big the context was when it started, how much of the input came from the
 * cache, and what the subagents spent by model. A derived, read-only VIEW: it writes no log kind and changes no
 * contract. Shaped like #desk-stats: the PURE fold (foldTurnEconomy) `gnomon economy stats` prints, and the kernel's
 * live tally of it (EconomyTally) seeded from the log on first read, then fed by onCommit.
 *
 * Inputs (all human-projection rows, kernel-written):
 *   turn.event   one per driver stream line: payload.line is the whole line, unless it was stored by hash only
 *                (over EVENT_LINE_CAP, or a control_request: payload.lineHash + payload.bytes, no line). A hash-only
 *                line is COUNTED as truncated and never parsed, so it can never be miscounted as a call or a tool.
 *                A line the redactor rewrote (payload.lineKept) is a hook or synthetic line: not read.
 *   turn.sent    the turn ids in send order (the queue a result closes).
 *   turn.result  closes the oldest outstanding turn, or through payload.turn (a queued message Claude Code folded
 *                into the running turn closes with the same result, num_turns 2: ONE row, foldedTurns 2); carries
 *                payload.split for the cache-read share.
 *   session.open the epoch. Turn ids restart at /1 after a resume, so rows are keyed (hsid, epoch = the seq of the
 *                latest session.open of that hsid, turn), exactly as #desk-stats keys a suppression.
 *
 * A row carries NUMBERS AND IDS ONLY: no text field, no tool input, no model output. Tool NAMES are counted, never kept.
 */

export interface EconomyRow {
  kind: string;
  payload: unknown;
  principal?: string;
  seq?: number;
  session?: string;
}

/** The kinds the fold reads. */
export const ECONOMY_KINDS: readonly string[] = Object.freeze(['turn.event', 'turn.sent', 'turn.result', 'session.open']);

/** Upper edges (exclusive) of the per-call context buckets; the last bucket is open-ended. */
export const CTX_BUCKET_EDGES: readonly number[] = Object.freeze([20_000, 50_000, 100_000, 140_000, 200_000]);
/** The context past which "median context per call after 140k" is measured. */
export const CTX_LONG = 140_000;
/** A stored stream line is capped at 64 KiB (supervisor EVENT_LINE_CAP); a longer one is never parsed. */
const LINE_CAP = 64 * 1024;
const MODEL_RE = /^[\w.:-]{1,64}$/;
const safeModel = (v: unknown): string => (typeof v === 'string' && MODEL_RE.test(v) ? v : 'unknown');
/** A Bash command that runs rg / grep as a command word (the command text itself is never kept). */
const SEARCH_CMD = /(?:^|[|;&(]\s*|\bxargs\s+)(?:rg|grep|egrep|fgrep)(?:\s|$)/;

/** One turn (or the run of queued turns one result closed). */
export interface TurnEconomyRow {
  hsid: string;
  /** the session.open epoch (its seq; negative = ordinal when the row had no seq) the turn id belongs to */
  epoch: number;
  /** the LATEST turn the result closes */
  turn: string;
  /** turns this result closed (2 = a queued message was folded into the running turn) */
  foldedTurns: number;
  /** distinct main-chain assistant message ids */
  modelCalls: number;
  /** main-chain tool_use names counted until the first Edit / Write / NotebookEdit (a Bash rg / grep counts as grep) */
  preEditExplore: { read: number; grep: number; glob: number };
  /** true when a main-chain edit tool ran in the turn */
  edited: boolean;
  /**
   * The main chain's context (in + cacheRead + cacheWrite) when the turn started: the end of the previous turn of
   * this epoch ('prev'), else the first call's context ('firstCall': the first turn of an epoch, a resume included).
   * Null only when the turn made no main-chain call. A compaction can leave 'prev' stale-high.
   */
  ctxAtStart: number | null;
  ctxAtStartSource: 'prev' | 'firstCall' | null;
  /** the largest per-call main-chain context in the turn (null with no call) */
  ctxMax: number | null;
  /** main-chain calls with context > CTX_LONG */
  callsOver140k: number;
  /** per-call context histogram: counts per bucket of CTX_BUCKET_EDGES (length edges + 1, the last is open-ended) */
  ctxHistogram: number[];
  /** the main chain's message.model (sanitised; the last seen), null with no call */
  conductorModel: string | null;
  /** split.cacheRead / (in + cacheRead + cacheWrite) from turn.result; null without a split or with no input */
  cacheReadShare: number | null;
  /** tokens (in + out + cacheRead + cacheWrite, once per message id) of messages with a parent_tool_use_id, by sanitised message.model */
  subagentTokensByModel: Record<string, number>;
  /** …uncached: in + out only */
  subagentUncachedByModel: Record<string, number>;
  /** stream lines seen for this turn; truncatedLines = hashOnly + unparsed (over the cap, or JSON that did not parse) */
  lines: number;
  truncatedLines: number;
  /** lines stored by hash only */
  hashOnly: number;
  /** assistant lines among the truncated: modelCalls / ctx / explore may be understated */
  truncatedAssistant: number;
  /** true when the row should stay out of per-call medians: an assistant line was truncated, or queued turns were folded */
  excludeFromMedians: boolean;
}

export interface EconomyCoverage {
  /** turn.event lines seen across the folded turns */
  lines: number;
  /** …not read: stored by hash only, over the cap, or unparseable */
  truncated: number;
  /** …of those, assistant lines (the ones that could have been a call or a tool_use) */
  truncatedAssistant: number;
  /** turn.result rows that closed no known turn, plus turns that ended with no result (an interrupt, a drain); no row is made */
  unpaired: number;
  /** assistant lines that arrived with no outstanding turn (a late background subagent): dropped, not folded into the next turn */
  unpairedLines: number;
  /** (lines - truncated) / lines, null with no lines */
  share: number | null;
}

export interface TurnEconomy {
  rows: TurnEconomyRow[];
  coverage: EconomyCoverage;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

interface Acc {
  ctxAtStart: number | null;
  /** message id -> context of that call (the usage repeats on every block of one message; the last wins) */
  calls: Map<string, number>;
  anon: number[];
  toolIds: Set<string>;
  explore: { read: number; grep: number; glob: number };
  edited: boolean;
  lastCtx: number | null;
  firstCtx: number | null;
  model: string | null;
  sub: Map<string, { model: string; tokens: number; uncached: number }>;
  lines: number;
  hashOnly: number;
  unparsed: number;
  truncatedAssistant: number;
}

interface State {
  epoch: number;
  queue: string[];
  lastCtx: number | null;
  acc: Acc;
}

const newAcc = (ctxAtStart: number | null): Acc => ({ ctxAtStart, calls: new Map(), anon: [], toolIds: new Set(), explore: { read: 0, grep: 0, glob: 0 }, edited: false, lastCtx: null, firstCtx: null, model: null, sub: new Map(), lines: 0, hashOnly: 0, unparsed: 0, truncatedAssistant: 0 });
const active = (a: Acc): boolean => a.calls.size > 0 || a.anon.length > 0 || a.sub.size > 0;
const rec = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const nat = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** The incremental fold: push rows in log order; a turn.result yields the finished row. */
export class EconomyFold {
  readonly #state = new Map<string, State>();
  #opens = 0;
  readonly #cov = { lines: 0, truncated: 0, truncatedAssistant: 0, unpaired: 0, unpairedLines: 0 };
  readonly #kernel: string | undefined;

  constructor(opts: { kernelPrincipal?: string } = {}) {
    this.#kernel = opts.kernelPrincipal;
  }

  coverage(): EconomyCoverage {
    const c = this.#cov;
    return { ...c, share: c.lines === 0 ? null : (c.lines - c.truncated) / c.lines };
  }

  #of(hsid: string): State {
    let s = this.#state.get(hsid);
    if (!s) this.#state.set(hsid, (s = { epoch: 0, queue: [], lastCtx: null, acc: newAcc(null) }));
    return s;
  }

  push(r: EconomyRow): TurnEconomyRow | null {
    if (!ECONOMY_KINDS.includes(r.kind)) return null;
    if (this.#kernel !== undefined && r.principal !== this.#kernel) return null;
    const p = rec(r.payload) ?? {};
    const hsid = typeof p.hsid === 'string' ? p.hsid : r.session;
    if (typeof hsid !== 'string') return null;
    if (r.kind === 'session.open') {
      // a resume restarts the turn ids and forgets the context: a fresh state under a new epoch
      this.#opens++;
      const old = this.#state.get(hsid);
      if (old && active(old.acc)) this.#cov.unpaired++; // the old epoch's last turn never got a result (a drain, a crash)
      this.#state.set(hsid, { epoch: r.seq ?? -this.#opens, queue: [], lastCtx: null, acc: newAcc(null) });
      return null;
    }
    const s = this.#of(hsid);
    if (r.kind === 'turn.sent') {
      if (typeof p.turn === 'string') s.queue.push(p.turn);
      return null;
    }
    if (r.kind === 'turn.event') {
      this.#line(s, p);
      return null;
    }
    return this.#result(hsid, s, p);
  }

  #line(s: State, p: Record<string, unknown>): void {
    if (rec(p.lineKept) !== null) return; // a rewritten hook / synthetic line: not a model line, not truncation
    const a = s.acc;
    const assistant = p.type === 'assistant';
    if (assistant && s.queue.length === 0) {
      // no outstanding turn: a late background subagent line. Dropped, so it cannot pollute the next turn.
      this.#cov.unpairedLines++;
      return;
    }
    a.lines++;
    this.#cov.lines++;
    const skip = (why: 'hashOnly' | 'unparsed'): void => {
      a[why]++;
      this.#cov.truncated++;
      if (assistant) {
        a.truncatedAssistant++;
        this.#cov.truncatedAssistant++;
      }
    };
    if (typeof p.line !== 'string') return skip('hashOnly'); // stored by hash (over the cap, or a control_request)
    if (p.line.length > LINE_CAP) return skip('unparsed'); // never parse past the cap
    let o: Record<string, unknown> | null;
    try {
      o = rec(JSON.parse(p.line));
    } catch {
      return skip('unparsed');
    }
    if (!o || o.type !== 'assistant') return;
    const m = rec(o.message);
    if (!m) return;
    const id = typeof m.id === 'string' ? m.id : null;
    const u = rec(m.usage);
    const input = nat(u?.input_tokens);
    const output = nat(u?.output_tokens);
    const cacheRead = nat(u?.cache_read_input_tokens);
    const cacheWrite = nat(u?.cache_creation_input_tokens);
    const model = safeModel(m.model);
    const parent = typeof o.parent_tool_use_id === 'string' && o.parent_tool_use_id.length > 0;
    if (parent) {
      // subagent: the usage repeats on every content block of one message, so once per id (the largest wins)
      const tokens = input + output + cacheRead + cacheWrite;
      const key = id ?? `anon:${a.sub.size}`;
      const prev = a.sub.get(key);
      if (!prev || tokens > prev.tokens) a.sub.set(key, { model, tokens, uncached: input + output });
      return;
    }
    a.model = model;
    if (u) {
      const ctx = input + cacheRead + cacheWrite;
      a.lastCtx = ctx;
      a.firstCtx ??= ctx;
      if (id !== null) a.calls.set(id, ctx);
      else a.anon.push(ctx);
    } else if (id !== null && !a.calls.has(id)) {
      a.calls.set(id, -1); // a call with no usage: counted, no context
    }
    const content = Array.isArray(m.content) ? (m.content as unknown[]) : [];
    for (const c of content) {
      const b = rec(c);
      if (!b || b.type !== 'tool_use' || typeof b.name !== 'string') continue;
      if (typeof b.id === 'string') {
        if (a.toolIds.has(b.id)) continue;
        a.toolIds.add(b.id);
      }
      if (a.edited) continue;
      if (EDIT_TOOLS.has(b.name)) a.edited = true;
      else if (b.name === 'Read') a.explore.read++;
      else if (b.name === 'Grep') a.explore.grep++;
      else if (b.name === 'Glob') a.explore.glob++;
      else if (b.name === 'Bash') {
        // an rg / grep command word counts as a search; the command text is tested and dropped, never kept
        const cmd = rec(b.input)?.command;
        if (typeof cmd === 'string' && SEARCH_CMD.test(cmd.length > 4096 ? cmd.slice(0, 4096) : cmd)) a.explore.grep++;
      }
    }
  }

  #result(hsid: string, s: State, p: Record<string, unknown>): TurnEconomyRow | null {
    let turn: string | undefined;
    let folded = 1;
    if (typeof p.turn === 'string') {
      turn = p.turn;
      const i = s.queue.indexOf(turn);
      if (i >= 0) {
        folded = i + 1;
        s.queue.splice(0, i + 1);
      }
    } else {
      turn = s.queue.shift();
    }
    const a = s.acc;
    s.acc = newAcc(a.lastCtx ?? s.lastCtx);
    if (a.lastCtx !== null) s.lastCtx = a.lastCtx;
    if (turn === undefined) {
      this.#cov.unpaired++;
      return null;
    }
    const sp = rec(p.split);
    const inT = nat(sp?.in);
    const cr = nat(sp?.cacheRead);
    const denom = inT + cr + nat(sp?.cacheWrite);
    const sub = new Map<string, number>();
    const unc = new Map<string, number>();
    for (const v of a.sub.values()) {
      sub.set(v.model, (sub.get(v.model) ?? 0) + v.tokens);
      unc.set(v.model, (unc.get(v.model) ?? 0) + v.uncached);
    }
    const ctxs = [...a.calls.values(), ...a.anon].filter((c) => c >= 0);
    const hist = new Array<number>(CTX_BUCKET_EDGES.length + 1).fill(0);
    for (const c of ctxs) hist[CTX_BUCKET_EDGES.findIndex((e) => c < e) < 0 ? CTX_BUCKET_EDGES.length : CTX_BUCKET_EDGES.findIndex((e) => c < e)]!++;
    const prev = a.ctxAtStart;
    const start = prev ?? a.firstCtx;
    return {
      hsid,
      epoch: s.epoch,
      turn,
      foldedTurns: folded,
      modelCalls: a.calls.size + a.anon.length,
      preEditExplore: { ...a.explore },
      edited: a.edited,
      ctxAtStart: start,
      ctxAtStartSource: prev !== null ? 'prev' : a.firstCtx !== null ? 'firstCall' : null,
      ctxMax: ctxs.length ? Math.max(...ctxs) : null,
      callsOver140k: ctxs.filter((c) => c > CTX_LONG).length,
      ctxHistogram: hist,
      conductorModel: a.model,
      cacheReadShare: sp && denom > 0 ? cr / denom : null,
      subagentTokensByModel: Object.fromEntries(sub),
      subagentUncachedByModel: Object.fromEntries(unc),
      lines: a.lines,
      truncatedLines: a.hashOnly + a.unparsed,
      hashOnly: a.hashOnly,
      truncatedAssistant: a.truncatedAssistant,
      excludeFromMedians: a.truncatedAssistant > 0 || folded > 1,
    };
  }
}

/** Fold rows (in log order) into per-turn economy rows and the coverage of the lines they read. */
export function foldTurnEconomy(rows: Iterable<EconomyRow>, opts: { kernelPrincipal?: string } = {}): TurnEconomy {
  const f = new EconomyFold(opts);
  const out: TurnEconomyRow[] = [];
  for (const r of rows) {
    const t = f.push(r);
    if (t) out.push(t);
  }
  return { rows: out, coverage: f.coverage() };
}

/** EconomyTally's row bound (one small row per turn; the oldest go first past it). */
export const ECONOMY_TALLY_MAX_ROWS = 50_000;

const ECONOMY_TALLY_TRIM = 1024;

/** The kernel log as EconomyTally reads it (a KernelLog). */
export interface EconomyTallyLog {
  read(opts: { reader: { class: 'human' }; kinds?: readonly string[] }): Iterable<{ seq: number; view: string; event?: unknown }>;
  onCommit(listener: (e: { seq: number; kind: string; principal?: string; session?: string; payload?: unknown }) => void): () => void;
}

/**
 * The kernel's live `gnomon economy stats`. Seeded from the log on the FIRST read (turn.event is every stream line, so
 * the boot never pays for it), then fed every committed row. Only the finished rows (bounded) and the open turns'
 * small accumulators are kept, never the lines.
 */
export class EconomyTally {
  readonly #log: EconomyTallyLog;
  readonly #fold: EconomyFold;
  readonly #rows: TurnEconomyRow[] = [];
  #seeded = false;
  #last = 0;
  #off: (() => void) | null = null;

  constructor(o: { log: EconomyTallyLog; kernelPrincipal: string }) {
    this.#log = o.log;
    this.#fold = new EconomyFold({ kernelPrincipal: o.kernelPrincipal });
    this.#off = o.log.onCommit((e) => {
      // before the first read nothing is kept: the seed reads those rows from the log
      if (!this.#seeded || e.seq <= this.#last || !ECONOMY_KINDS.includes(e.kind)) return;
      this.#last = e.seq;
      this.#feed({ kind: e.kind, payload: e.payload, seq: e.seq, ...(e.principal ? { principal: e.principal } : {}), ...(e.session ? { session: e.session } : {}) });
    });
  }

  #feed(r: EconomyRow): void {
    const t = this.#fold.push(r);
    if (!t) return;
    this.#rows.push(t);
    // batched trim: a splice per ECONOMY_TALLY_TRIM rows, not a shift per row
    if (this.#rows.length > ECONOMY_TALLY_MAX_ROWS + ECONOMY_TALLY_TRIM) this.#rows.splice(0, this.#rows.length - ECONOMY_TALLY_MAX_ROWS);
  }

  #seed(): void {
    if (this.#seeded) return;
    // synchronous: no commit can interleave with the read, and later commits are deduplicated by seq
    for (const v of this.#log.read({ reader: { class: 'human' }, kinds: ECONOMY_KINDS })) {
      if (v.view !== 'full' || !v.event || typeof v.event !== 'object') continue; // never a row the redactor hashed
      const e = v.event as { kind?: unknown; payload?: unknown; principal?: unknown; session?: unknown };
      if (typeof e.kind !== 'string') continue;
      this.#last = Math.max(this.#last, v.seq);
      this.#feed({ kind: e.kind, payload: e.payload, seq: v.seq, ...(typeof e.principal === 'string' ? { principal: e.principal } : {}), ...(typeof e.session === 'string' ? { session: e.session } : {}) });
    }
    this.#seeded = true;
  }

  /** The finished turns (oldest first) and the coverage of the lines read. */
  stats(): TurnEconomy {
    this.#seed();
    return { rows: this.#rows.slice(-ECONOMY_TALLY_MAX_ROWS), coverage: this.#fold.coverage() };
  }

  close(): void {
    this.#off?.();
    this.#off = null;
  }
}
