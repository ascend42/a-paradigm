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
 * Projection v2 (#ledger-mod, the context and budget meter): NUMBERS ONLY.
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
import { createHash } from 'node:crypto';

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
export const FEED_HUES = 8;

const ID = /^[A-Za-z0-9:._-]{1,128}$/;
const KIND = /^[a-z][a-z0-9-]{0,31}$/;
const MOD = /^[a-z][a-z0-9-]{0,63}$/;
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
export function projectFeedEvent(e: { kind?: unknown; seq?: unknown; at?: unknown; payload?: unknown }): FeedEvent | null {
  if (typeof e?.kind !== 'string' || !FEED_KINDS.includes(e.kind)) return null;
  const p = (e.payload && typeof e.payload === 'object' ? e.payload : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const hsid = id(p.hsid);
  switch (e.kind) {
    case 'session.open': {
      if (!hsid) return null;
      out.hsid = hsid;
      out.backend = p.backend === 'local' ? 'local' : 'claude';
      out.project = typeof p.cwd === 'string' ? createHash('sha256').update(p.cwd, 'utf8').digest()[0]! % FEED_HUES : 0;
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
