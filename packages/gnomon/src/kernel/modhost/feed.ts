/**
 * @symbol #mod-host
 * @symbol #workshop-mod
 *
 * The `event{event:v1}` filtered feed (spec §12.3 "grant-bound kinds",
 * §11.6, G-WSP-01; M1.11 slice 3). A running mod whose manifest requires the
 * `log.read` capability (checked granted at load by #manifest-loader) gets a
 * PROJECTION of a fixed set of kernel kinds: only the kernel fields the
 * Workshop's caps derive from, never a text, a path, a tool input or a
 * digest. Anything not listed is not forwarded.
 *
 *   session.open      {hsid, backend: claude|local, project: 0..7}  (project = a hue
 *                     index the HOST derives from sha256(cwd); the path never leaves)
 *   session.exited    {hsid}
 *   turn.partial      {hsid}      (streaming: the bob)
 *   turn.result       {hsid}
 *   approval.request  {cardId, kind, hsid?}
 *   approval.decide   {cardId}
 *   approval.expire   {cardId}
 *   warpline.knot     {hsid?}     (violet)
 *   mod.paused        {name, reason}   (Aegis C2: a pause is visible in the Workshop)
 *   mod.health        {name, ok}       (a successful start clears it)
 *
 * Projection v2 (#ledger-mod, the context and budget meter): NUMBERS ONLY, and only
 * to a mod granted `log.read:usage` (FEED_USAGE_CAPABILITY; Aegis M1).
 * Every number is clamped to a finite non-negative safe integer; no string
 * leaves except an id (ID) or a closed enum / enum-shaped token (DIMENSION).
 *   turn.usage        {hsid, tokens}                                   (a per-message delta, as charged)
 *   turn.result       {hsid, tokens, tokensIn?, tokensOut?, cacheRead?, cacheWrite?, costMicros?}
 *                     (tokens = the result's uncharged delta; the split = the turn's own totals from the
 *                     stream's result.usage, Claude only; costMicros = round(cost USD × 1e6))
 *   session.compacted {hsid, tokensBefore, tokensAfter}
 *   budget.usage      {hsid?, dimension: tokens, n, usdMicros}         (a recorded turn's usage)
 *                     {hsid?, dimension: tokens|usd, n, of, over: true} (the informational over-permit row)
 *   budget.ladder     {dimension, scope, rung}                         (rung = percent of the daily cap)
 *   budget.pause / budget.resume / budget.breaker.open / budget.breaker.close  {dimension}
 *   permit.deny       {dimension}                                      (the refusal's dimension, e.g. api-billing-path)
 */
import { isModId, projectHue } from '@a-company/gnomon-contracts';

export const FEED_KINDS: readonly string[] = Object.freeze([
  'session.open',
  'session.exited',
  'turn.partial',
  'turn.result',
  'approval.request',
  'approval.decide',
  'approval.expire',
  'warpline.knot',
  'mod.paused',
  'mod.health',
  // projection v2 (#ledger-mod): numbers only
  'turn.usage',
  'session.compacted',
  'budget.usage',
  'budget.ladder',
  'budget.pause',
  'budget.resume',
  'budget.breaker.open',
  'budget.breaker.close',
  'permit.deny',
]);
/** The capability that grants the feed. */
export const FEED_CAPABILITY = 'log.read';
/**
 * Aegis M1 (#ledger-mod): the NARROWER capability that grants the projection v2 usage rows and fields (the
 * USAGE kinds below, and turn.result's tokens / split / cost). The install card names it (it is a manifest
 * capability); a local-tier mod may not combine it with egress (#manifest-loader). log.read alone gets v1 only.
 */
export const FEED_USAGE_CAPABILITY = 'log.read:usage';
export const FEED_USAGE_KINDS: readonly string[] = Object.freeze(['turn.usage', 'session.compacted', 'budget.usage', 'budget.ladder', 'budget.pause', 'budget.resume', 'budget.breaker.open', 'budget.breaker.close', 'permit.deny']);

/** Which projection a mod's granted capabilities reach (none ⇒ no feed). */
export function feedAccessOf(capabilities: readonly string[] | undefined): { base: boolean; usage: boolean } {
  const caps = capabilities ?? [];
  return { base: caps.includes(FEED_CAPABILITY), usage: caps.includes(FEED_USAGE_CAPABILITY) };
}

/** Whether a mod with this access receives an event of this kind. */
export function feedReaches(access: { base: boolean; usage: boolean }, kind: string): boolean {
  if (FEED_USAGE_KINDS.includes(kind)) return access.usage;
  if (kind === 'turn.result') return access.base || access.usage;
  return access.base;
}
export const FEED_HUES = 6; // S5.6: the six pigments (gnomon-contracts PROJECT_HUES)

const ID = /^[A-Za-z0-9:._-]{1,128}$/;
const KIND = /^[a-z][a-z0-9-]{0,31}$/;
/** S0b: a mod id <publisher>.<name>. */
const MOD = { test: (s: string): boolean => isModId(s) };
const REASON = /^[a-z][a-z0-9-]{0,31}$/;
/** A chain timestamp (ISO 8601 UTC). */
export const FEED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const AT = FEED_AT;
const id = (v: unknown): string | undefined => (typeof v === 'string' && ID.test(v) ? v : undefined);
/** An enum-shaped token (a budget dimension or a refusal reason). */
export const FEED_DIMENSION = /^[a-z][a-z0-9-]{0,31}$/;
/** The closed ladder scopes (fuse.ts ladder keys). */
export const FEED_SCOPES: readonly string[] = Object.freeze(['user', 'repo', 'loop', 'session', 'subscription-window', 'model', 'backend']);
const dimension = (v: unknown, d = 'unknown'): string => (typeof v === 'string' && FEED_DIMENSION.test(v) ? v : d);
/** A finite non-negative safe integer (anything else is 0). */
export function feedCount(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  return Math.min(Math.floor(v), Number.MAX_SAFE_INTEGER);
}
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const has = (o: Record<string, unknown>, k: string): boolean => typeof o[k] === 'number' && Number.isFinite(o[k] as number);

export interface FeedEvent {
  kind: string;
  seq: number | null;
  at: string | null;
  payload: Record<string, unknown>;
}

/** The projection of one kernel event, or null when it is not a feed kind. */
export function projectFeedEvent(e: { kind?: unknown; seq?: unknown; at?: unknown; payload?: unknown }, opts: { usage?: boolean } = {}): FeedEvent | null {
  if (typeof e?.kind !== 'string' || !FEED_KINDS.includes(e.kind)) return null;
  // Aegis M1: without log.read:usage, no usage kind and no usage field
  const usage = opts.usage === true;
  if (!usage && FEED_USAGE_KINDS.includes(e.kind)) return null;
  const p = (e.payload && typeof e.payload === 'object' ? e.payload : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const hsid = id(p.hsid);
  switch (e.kind) {
    case 'session.open': {
      if (!hsid) return null;
      out.hsid = hsid;
      out.backend = p.backend === 'local' ? 'local' : 'claude';
      out.project = typeof p.cwd === 'string' ? projectHue(p.cwd) : 0; // S2.1: the one hue function the GUI rail uses too (0..5, within 0..FEED_HUES-1)
      break;
    }
    case 'session.exited':
    case 'turn.partial':
      if (!hsid) return null;
      out.hsid = hsid;
      break;
    case 'turn.usage':
    case 'turn.result': {
      if (!hsid) return null;
      out.hsid = hsid;
      if (!usage) break; // v1 turn.result: {hsid} only
      out.tokens = feedCount(obj(p.usage).tokens);
      if (e.kind === 'turn.result') {
        const split = obj(p.split);
        for (const [from, to] of [['in', 'tokensIn'], ['out', 'tokensOut'], ['cacheRead', 'cacheRead'], ['cacheWrite', 'cacheWrite']] as const) if (has(split, from)) out[to] = feedCount(split[from]);
        if (has(p, 'cost')) out.costMicros = feedCount(Math.round((p.cost as number) * 1e6));
      }
      break;
    }
    case 'session.compacted':
      if (!hsid) return null;
      out.hsid = hsid;
      out.tokensBefore = feedCount(p.tokensBefore);
      out.tokensAfter = feedCount(p.tokensAfter);
      break;
    case 'budget.usage': {
      if (p.malformed === true) return null;
      if (hsid) out.hsid = hsid;
      if (p.overPermit === true) {
        const used = obj(p.used);
        const lim = obj(p.limits);
        const usdOver = feedCount(lim.usd) > 0 && (used.usd as number) > (lim.usd as number);
        const tokOver = !usdOver || (used.tokens as number) > (lim.tokens as number);
        out.dimension = tokOver ? 'tokens' : 'usd';
        out.n = tokOver ? feedCount(used.tokens) : feedCount(Math.round((used.usd as number) * 1e6));
        out.of = tokOver ? feedCount(lim.tokens) : feedCount(Math.round((lim.usd as number) * 1e6));
        out.over = true;
      } else {
        out.dimension = 'tokens';
        out.n = feedCount(p.tokens);
        out.usdMicros = feedCount(Math.round((typeof p.usd === 'number' ? p.usd : 0) * 1e6));
      }
      break;
    }
    case 'budget.ladder': {
      const scope = p.scope === 'subscriptionWindow' ? 'subscription-window' : p.scope;
      if (typeof scope !== 'string' || !FEED_SCOPES.includes(scope)) return null;
      out.dimension = dimension(p.dimension);
      out.scope = scope;
      out.rung = Math.min(feedCount(Math.round((typeof p.rung === 'number' ? p.rung : 0) * 100)), 1000);
      break;
    }
    case 'budget.pause':
    case 'budget.resume':
    case 'budget.breaker.open':
    case 'budget.breaker.close':
      out.dimension = dimension(p.dimension);
      break;
    case 'permit.deny':
      // fuse.ts writes the refusal's reason as `why` (the thrown refusal names it `dimension`)
      out.dimension = dimension(p.dimension, dimension(p.why));
      break;
    case 'warpline.knot':
      if (hsid) out.hsid = hsid;
      break;
    case 'approval.request': {
      const card = (p.card && typeof p.card === 'object' ? p.card : {}) as Record<string, unknown>;
      const cardId = id(card.cardId);
      if (!cardId) return null;
      out.cardId = cardId;
      out.kind = typeof card.kind === 'string' && KIND.test(card.kind) ? card.kind : 'card';
      const h = id(card.hsid);
      if (h) out.hsid = h;
      break;
    }
    case 'mod.paused':
    case 'mod.health': {
      if (typeof p.name !== 'string' || !MOD.test(p.name)) return null;
      out.name = p.name;
      if (e.kind === 'mod.paused') out.reason = typeof p.reason === 'string' && REASON.test(p.reason) ? p.reason : 'paused';
      else out.ok = p.ok === true;
      break;
    }
    case 'approval.decide':
    case 'approval.expire': {
      const cardId = id(p.cardId);
      if (!cardId) return null;
      out.cardId = cardId;
      break;
    }
  }
  return { kind: e.kind, seq: typeof e.seq === 'number' && Number.isSafeInteger(e.seq) && e.seq >= 0 ? e.seq : null, at: typeof e.at === 'string' && AT.test(e.at) ? e.at : null, payload: out };
}

/**
 * The start-of-feed backlog (founder report 2026-10-23: the Workshop said "working 0 of 0 · no sessions" beside the
 * status line's "1 live" while a Claude session was open). The feed is live-only, so a mod that STARTS after a session
 * opened (an install, a restart after a crash or a repin, `gnomon mod start`, or a kernel boot whose resumed sessions
 * opened before the start scan) never learned of it. FeedBacklog folds released kernel rows of THIS boot (from the
 * daemon.start row on, the boundary the GUI's live count uses too) into the minimal raw rows that rebuild the state in
 * force: each live session's session.open, its warpline.knot, and its open turn.partial (still streaming); each card
 * still pending; each mod still paused. The host projects them like any feed row (projectFeedEvent), so the backlog
 * carries nothing the live feed would not.
 *
 * Aegis M (2026-10-23): the daemon keeps ONE fold, fed incrementally as rows are released (flushFeed), so a prime costs
 * O(state) and reads nothing from disk. Only when the bounded feed queue dropped rows is the fold marked stale; the next
 * snapshot then re-folds from this boot's daemon.start seq (resync, a bounded fromSeq read) — never from seq 1.
 * Aegis L: with `requireBoot`, nothing is folded or primed until this boot's daemon.start row is released, so the
 * previous boot's sessions are never replayed.
 */
export const FEED_BACKLOG_KINDS: readonly string[] = Object.freeze([
  'daemon.start',
  'session.open',
  'session.exited',
  'session.orphaned',
  'session.refused',
  'turn.partial',
  'turn.result',
  'warpline.knot',
  'approval.request',
  'approval.decide',
  'approval.expire',
  'mod.paused',
  'mod.health',
]);
const BACKLOG_KIND_SET = new Set(FEED_BACKLOG_KINDS);
/** Bounds of the backlog (the Workshop's own: MAX_SESSIONS, MAX_CARDS, MAX_PAUSED; oldest forgotten first). */
export const FEED_BACKLOG_LIMITS = Object.freeze({ sessions: 256, cards: 256, paused: 64 });

export type FeedSourceRow = { kind?: unknown; seq?: unknown; at?: unknown; payload?: unknown };

const put = <V>(m: Map<string, V>, k: string, v: V, max: number): void => {
  m.delete(k); // re-insert: newest last
  if (m.size >= max) m.delete(m.keys().next().value!);
  m.set(k, v);
};
const seqOf = (r: FeedSourceRow): number | null => (typeof r.seq === 'number' && Number.isSafeInteger(r.seq) && r.seq >= 0 ? r.seq : null);

type BacklogSession = { open: FeedSourceRow; knot: FeedSourceRow | null; partial: FeedSourceRow | null };

/** The incremental fold behind feedBacklog (the daemon holds one; observe() every released row, in seq order). */
export class FeedBacklog {
  readonly #requireBoot: boolean;
  #booted: boolean;
  #bootSeq: number | null = null;
  /** the highest seq folded: a row at or below it is not folded twice (a resync, a re-delivered row) */
  #upTo = -1;
  #stale = false;
  #sessions = new Map<string, BacklogSession>();
  #cards = new Map<string, { row: FeedSourceRow; hsid: string | undefined }>();
  #paused = new Map<string, FeedSourceRow>();

  constructor(opts: { requireBoot?: boolean } = {}) {
    this.#requireBoot = opts.requireBoot === true;
    this.#booted = !this.#requireBoot;
  }

  /** The seq of this boot's daemon.start (null until it is released). */
  get bootSeq(): number | null {
    return this.#bootSeq;
  }
  /** Rows were dropped before they reached the fold: the next snapshot needs a resync. */
  get stale(): boolean {
    return this.#stale;
  }
  markStale(): void {
    this.#stale = true;
  }

  #reset(): void {
    this.#sessions = new Map();
    this.#cards = new Map();
    this.#paused = new Map();
  }

  /** Fold one released row (any kind; only FEED_BACKLOG_KINDS change the state). */
  observe(r: FeedSourceRow): void {
    if (!r || typeof r.kind !== 'string' || !BACKLOG_KIND_SET.has(r.kind)) return;
    const seq = seqOf(r);
    if (seq !== null) {
      if (seq <= this.#upTo) return;
      this.#upTo = seq;
    }
    if (r.kind === 'daemon.start') {
      // a new boot: the old kernel's sessions, cards and pauses went with it
      this.#reset();
      this.#booted = true;
      this.#bootSeq = seq;
      return;
    }
    if (!this.#booted) return; // Aegis L: before this boot's daemon.start, nothing is this boot's
    const p = obj(r.payload);
    const hsid = id(p.hsid);
    switch (r.kind) {
      case 'session.open':
        if (hsid) put(this.#sessions, hsid, { open: r, knot: null, partial: null }, FEED_BACKLOG_LIMITS.sessions);
        break;
      case 'session.exited':
      case 'session.orphaned':
      case 'session.refused':
        if (!hsid) break;
        this.#sessions.delete(hsid);
        for (const [cid, c] of this.#cards) if (c.hsid === hsid) this.#cards.delete(cid); // as the Workshop's own reducer does
        break;
      case 'turn.partial':
      case 'turn.result': {
        const s = hsid ? this.#sessions.get(hsid) : undefined;
        if (s) s.partial = r.kind === 'turn.partial' ? r : null;
        break;
      }
      case 'warpline.knot': {
        const s = hsid ? this.#sessions.get(hsid) : undefined;
        if (s) s.knot = r;
        break;
      }
      case 'approval.request': {
        const card = obj(p.card);
        const cid = id(card.cardId);
        if (cid) put(this.#cards, cid, { row: r, hsid: id(card.hsid) }, FEED_BACKLOG_LIMITS.cards);
        break;
      }
      case 'approval.decide':
      case 'approval.expire': {
        const cid = id(p.cardId);
        if (cid) this.#cards.delete(cid);
        break;
      }
      case 'mod.paused':
        if (typeof p.name === 'string' && MOD.test(p.name)) put(this.#paused, p.name, r, FEED_BACKLOG_LIMITS.paused);
        break;
      case 'mod.health':
        if (p.ok === true && typeof p.name === 'string') this.#paused.delete(p.name);
        break;
    }
  }

  /**
   * Re-fold from this boot's rows (fromSeq = bootSeq, up to `head`) after dropped rows; later rows at or below `head`
   * are then skipped by observe(). The caller reads the rows; this only folds them.
   */
  resync(rows: Iterable<FeedSourceRow>, head: number): void {
    this.#reset();
    this.#booted = !this.#requireBoot;
    this.#upTo = -1;
    for (const r of rows) {
      const seq = seqOf(r);
      if (seq !== null && seq > head) break;
      this.observe(r);
    }
    this.#upTo = Math.max(this.#upTo, head);
    this.#stale = false;
  }

  /** The raw rows a starting mod replays, in fold order (sessions with their knot and open partial, cards, pauses). */
  snapshot(): FeedSourceRow[] {
    if (!this.#booted) return [];
    const out: FeedSourceRow[] = [];
    for (const s of this.#sessions.values()) {
      out.push(s.open);
      if (s.knot) out.push(s.knot);
      if (s.partial) out.push(s.partial);
    }
    for (const c of this.#cards.values()) out.push(c.row);
    out.push(...this.#paused.values());
    return out;
  }
}

/** Fold rows (seq order) into the raw rows a starting mod replays (a one-shot FeedBacklog; no boot required). */
export function feedBacklog(rows: Iterable<FeedSourceRow>): FeedSourceRow[] {
  const b = new FeedBacklog();
  for (const r of rows) b.observe(r);
  return b.snapshot();
}
