/**
 * @symbol #socket
 * @symbol ~ample-internal-logs
 *
 * #socket `log.read` (spec §5 verb 6, §4.9 subscription, §9.3; M1.4 slice 2).
 *
 * READER CLASS per authenticated principal (never over-share):
 *   - human → the COMMUNITY-CLIENT projection (full minus `sensitive` and
 *     `secret`; sensitive-column kinds as `{kind, hsid, at, hash}` stubs;
 *     registered sensitive FIELDS replaced by `{redacted: true}`; no row carries
 *     hash, sig or prev — redaction.ts). §9.3: a
 *     human-class connection gets the full row only on a first-party surface
 *     or a device key granted `log.read:sensitive`; neither can be proven on
 *     the socket yet (a self-declared `surface` is not proof; grants and the
 *     GUI launch token come later), so the result says `projection:
 *     'community-client'` and names what the full view needs.
 *   - mod → own `modns.<name>.*` + the kinds its grant lists (no grants exist
 *     yet ⇒ none), normal rows only, fields redacted.
 *   - agent → UNSUPPORTED{reader-unsupported, Move 2}; voice →
 *     UNSUPPORTED{reader-unsupported, Move 4} (§9.3: refuse rather than guess).
 *   - session → ENGINE{not-implemented, M1.7}: its view is "own hsid" and the
 *     principal → hsid binding arrives with the session runner.
 *   - read token: tokens do not exist on the socket yet (auth refuses
 *     `{token}`); peer: refused by the matrix before reaching here.
 *
 * PAGES: `{since?, until?, kinds?, scope?, limit?}` (`until`/`limit` are
 * optional params added under the compatible-additive rule) → `{rows, next,
 * head, caughtUp, projection, withheld}`. `since` is a seq: rows with seq >
 * since. `next` is the last SCANNED seq (resume with since = next) — stable,
 * because seqs are immutable and the log is append-only. A page holds at most
 * `limit` (≤ 1000) rows, scans at most 10 000 rows, and stops after ~2 MiB;
 * a single row over 1 MiB is replaced by `{seq, view:'oversize', kind,
 * bytes}` so a reply never crosses the 4 MiB frame cap. Filters apply to the
 * PROJECTED view: a stub carries only kind/hsid, so a repo/loop/contract
 * filter never matches (and never reveals) a stubbed row.
 *
 * SUBSCRIPTIONS (`follow: true`): the reply `{subscription, since, head,
 * projection}` is written first; then every matching row after `since` —
 * backlog then live — arrives as `event` notifications `{subscription, row}`,
 * in seq order, read lazily from the log (O(1) memory per subscriber besides
 * a cursor). Only RELEASED rows are read (KernelLog.releasedHead: a
 * critical row is unreadable until its anchors resolve; a failed one never
 * appears). Lag = min(committed seq, released head) − cursor (rows the
 * reader cannot see count too); a subscribe whose backlog (released head −
 * since) exceeds HALF of SUBSCRIPTION_BACKLOG_CAP is refused
 * BAD_REQUEST{backlog-too-large} — page with log.read until caughtUp, then
 * follow from its `next` — and when the lag passes the cap during delivery the
 * subscription is dropped, the
 * client gets a final `event{subscription, end:{reason:'dropped', lag,
 * since}}` and the kernel logs `socket.subscription.dropped{lag,
 * subscription, since}` with the connId. The pump writes only while the
 * connection's unsent bytes are under its write high-water mark and resumes
 * on 'drain', so a slow reader costs at most high-water + one frame of
 * buffer. Each live subscription holds the idle monitor ('subscriber'); a
 * subscription ends with its connection (no extra verb exists to cancel).
 */
import { isHsid, monotonicUlidFactory, RefusedError, type EventV1 } from '@a-company/gnomon-contracts';
import type { KernelLog } from '../log/kernel-log.js';
import { mayBeVisible, type LogView, type ReaderClass } from '../log/redaction.js';
import { RpcRefusal } from './rpc.js';
import type { ConnectionContext } from './server.js';
import type { ConnAuthState } from './auth.js';

export const SUBSCRIPTION_BACKLOG_CAP = 10_000;
export const PAGE_DEFAULT_ROWS = 256;
export const PAGE_MAX_ROWS = 1000;
export const PAGE_MAX_SCAN = 10_000;
export const PAGE_MAX_BYTES = 2 * 1024 * 1024;
export const ROW_MAX_BYTES = 1024 * 1024;
export const MAX_SUBSCRIPTIONS_PER_CONNECTION = 8;
export const MAX_SUBSCRIPTIONS = 256;
const MAX_KINDS = 64;
const KIND_PATTERN = /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*(\.\*)?$/;
const PUMP_ROWS_PER_TICK = 512;
const PUMP_SCAN_PER_TICK = 4096;

export type ReadLog = Pick<KernelLog, 'readPage' | 'getById' | 'head' | 'onCommit' | 'onRelease' | 'releasedHead'>;

/** A row too large for one frame: what the reader may know of it anyway. */
export interface OversizeView {
  seq: number;
  view: 'oversize';
  kind: string;
  bytes: number;
}

/** Convert a thrown contracts refusal (e.g. a LogRefusal) into the wire refusal. */
export function asRpcRefusal(err: unknown): unknown {
  if (err instanceof RefusedError && !(err instanceof RpcRefusal)) return RpcRefusal.from({ refusal: err.refusal, message: err.message });
  return err;
}

/* ── reader class policy ──────────────────────────────────────────────────── */

export interface ReaderGrant {
  reader: ReaderClass;
  projection: string;
  fullView?: { needs: string };
}

export function readerFor(s: Pick<ConnAuthState, 'principal' | 'principalKind'>): ReaderGrant {
  switch (s.principalKind) {
    case 'human':
      return {
        reader: { class: 'community-client' },
        projection: 'community-client',
        fullView: { needs: 'a first-party surface proof (GUI launch token / wrapper) or a log.read:sensitive device grant; neither exists on the socket yet' },
      };
    case 'mod': {
      const name = /^p:[^/]+\/mod-([a-z0-9][a-z0-9-]{0,63})$/.exec(s.principal ?? '')?.[1];
      if (!name) throw new RpcRefusal('FORBIDDEN', 'mod-principal-name', 'a mod principal is p:<ns>/mod-<name> (§5)');
      return { reader: { class: 'mod', name, grantedKinds: [] }, projection: 'mod' };
    }
    case 'agent':
      throw new RpcRefusal('UNSUPPORTED', 'reader-unsupported', 'the agent read projection (own subtree) needs the session tree; refused rather than guessed (§9.3)', { milestone: 'Move 2', principalClass: 'agent' });
    case 'voice':
      throw new RpcRefusal('UNSUPPORTED', 'reader-unsupported', 'the voice read projection (attached session) needs voice arms; refused rather than guessed (§9.3)', { milestone: 'Move 4', principalClass: 'voice' });
    case 'session':
      throw new RpcRefusal('ENGINE', 'not-implemented', 'the session view is its own hsid; the principal → hsid binding lands with the session runner', { milestone: 'M1.7', principalClass: 'session', access: 'own scope' });
    default:
      throw new RpcRefusal('FORBIDDEN', 'matrix', 'this principal class has no read path (§5)', { principalClass: String(s.principalKind) });
  }
}

/* ── params ───────────────────────────────────────────────────────────────── */

export interface LogReadParams {
  since: number;
  until?: number;
  limit: number;
  kinds?: (kind: string) => boolean;
  match?: (v: LogView) => boolean;
  follow: boolean;
}

const bad = (reason: string, message: string): RpcRefusal => new RpcRefusal('BAD_REQUEST', reason, message);
const seqOk = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

export function parseLogReadParams(params: unknown): LogReadParams {
  if (params === undefined || params === null) params = {};
  if (typeof params !== 'object' || Array.isArray(params)) throw bad('bad-params', 'log.read params must be an object');
  const p = params as Record<string, unknown>;
  const out: LogReadParams = { since: 0, limit: PAGE_DEFAULT_ROWS, follow: false };
  if (p.since !== undefined) {
    if (!seqOk(p.since)) throw bad('bad-since', 'since must be a non-negative integer seq (rows with seq > since)');
    out.since = p.since;
  }
  if (p.until !== undefined) {
    if (!seqOk(p.until)) throw bad('bad-until', 'until must be a non-negative integer seq');
    out.until = p.until;
  }
  if (p.limit !== undefined) {
    if (!seqOk(p.limit) || p.limit < 1 || p.limit > PAGE_MAX_ROWS) throw bad('bad-limit', `limit must be an integer in 1..${PAGE_MAX_ROWS}`);
    out.limit = p.limit;
  }
  if (p.follow !== undefined) {
    if (typeof p.follow !== 'boolean') throw bad('bad-follow', 'follow must be a boolean');
    out.follow = p.follow;
  }
  if (p.kinds !== undefined) {
    if (!Array.isArray(p.kinds) || p.kinds.length === 0 || p.kinds.length > MAX_KINDS) throw bad('bad-kinds', `kinds must be a non-empty array of at most ${MAX_KINDS} kinds`);
    const exact = new Set<string>();
    const prefixes: string[] = [];
    for (const k of p.kinds) {
      if (typeof k !== 'string' || k.length > 128 || !KIND_PATTERN.test(k)) throw bad('bad-kinds', 'each kind is a dotted kind name, optionally ending in .*');
      if (k.endsWith('.*')) prefixes.push(k.slice(0, -1));
      else exact.add(k);
    }
    out.kinds = (kind) => exact.has(kind) || prefixes.some((pre) => kind.startsWith(pre));
  }
  if (p.scope !== undefined) {
    if (p.scope === null || typeof p.scope !== 'object' || Array.isArray(p.scope)) throw bad('bad-scope', 'scope must be an object {hsid?, repo?, loop?, contract?}');
    const sc = p.scope as Record<string, unknown>;
    const want: Record<string, string> = {};
    for (const f of ['hsid', 'repo', 'loop', 'contract'] as const) {
      if (sc[f] === undefined) continue;
      if (typeof sc[f] !== 'string' || (sc[f] as string).length === 0 || (sc[f] as string).length > 256) throw bad('bad-scope', `scope.${f} must be a non-empty string`);
      want[f] = sc[f] as string;
    }
    if (want.hsid !== undefined && !isHsid(want.hsid)) throw bad('bad-scope', 'scope.hsid must be an hsid');
    if (Object.keys(want).length > 0) out.match = scopeMatcher(want);
  }
  if (out.until !== undefined && out.until < out.since) throw bad('bad-until', 'until must be >= since');
  return out;
}

/** Filters run on the PROJECTED view: a stub exposes only kind and hsid. */
function scopeMatcher(want: Record<string, string>): (v: LogView) => boolean {
  return (v) => {
    if (v.view === 'stub') {
      if (want.repo !== undefined || want.loop !== undefined || want.contract !== undefined) return false;
      return want.hsid === undefined || v.stub.hsid === want.hsid;
    }
    const e = v.event;
    if (want.hsid !== undefined && e.session !== want.hsid) return false;
    const sc = (e.scope ?? {}) as Record<string, unknown>;
    for (const f of ['repo', 'loop', 'contract'] as const) if (want[f] !== undefined && sc[f] !== want[f]) return false;
    return true;
  };
}

function sized(v: LogView): { row: LogView | OversizeView; bytes: number } {
  const bytes = Buffer.byteLength(JSON.stringify(v));
  if (bytes <= ROW_MAX_BYTES) return { row: v, bytes };
  const kind = v.view === 'stub' ? v.stub.kind : v.event.kind;
  const row: OversizeView = { seq: v.seq, view: 'oversize', kind, bytes };
  return { row, bytes: 256 };
}

/* ── one page ─────────────────────────────────────────────────────────────── */

export function readOnePage(log: ReadLog, grant: ReaderGrant, p: LogReadParams): Record<string, unknown> {
  const head = log.head().seq;
  if (p.since > head) throw bad('since-ahead', `since ${p.since} is past the head ${head}`);
  const rows: Array<LogView | OversizeView> = [];
  let total = 0;
  const page = log.readPage({
    reader: grant.reader,
    afterSeq: p.since,
    ...(p.until !== undefined ? { untilSeq: p.until } : {}),
    maxScan: PAGE_MAX_SCAN,
    ...(p.kinds ? { kinds: p.kinds } : {}),
    ...(p.match ? { match: p.match } : {}),
    visit: (v) => {
      const s = sized(v);
      rows.push(s.row);
      total += s.bytes;
      return rows.length < p.limit && total < PAGE_MAX_BYTES;
    },
  });
  return {
    rows,
    next: page.lastScanned,
    head: page.head,
    caughtUp: page.caughtUp,
    projection: grant.projection,
    ...(grant.fullView ? { fullView: grant.fullView } : {}),
    withheld: page.withheld,
  };
}

/* ── subscriptions ────────────────────────────────────────────────────────── */

interface Sub {
  id: string;
  ctx: ConnectionContext;
  reader: ReaderClass;
  kinds?: (kind: string) => boolean;
  match?: (v: LogView) => boolean;
  cursor: number;
  scheduled: boolean;
  dead: boolean;
  started: boolean;
  offDrain?: () => void;
  release?: () => void;
}

/** Lag beyond which a pump is woken even for rows the reader cannot see (so its cursor advances by scanning). */
const SCAN_NUDGE = 1024;

export interface SubscriptionHubOptions {
  log: ReadLog;
  /** Hold the idle monitor while a subscription lives (daemon: idle.hold('subscriber')). */
  holdIdle?: () => () => void;
  /** A subscription was dropped at the cap; the daemon writes socket.subscription.dropped (deferred, never inside a commit). */
  onDropped?: (connId: string, payload: { subscription: string; lag: number; since: number }) => void;
  backlogCap?: number;
  maxPerConnection?: number;
  maxTotal?: number;
}

export interface SubscriptionStats {
  active: number;
  dropped: number;
  /** Largest committed-head − cursor lag ever observed (≤ backlogCap + 1). */
  maxLag: number;
  /** Largest connection write buffer observed by a pump (bytes). */
  maxBuffered: number;
  delivered: number;
  /** Pumps woken by the commit fan-out (metadata-only decision). */
  wakes: number;
}

export class SubscriptionHub {
  readonly #o: SubscriptionHubOptions;
  readonly #subs = new Map<string, Sub>();
  readonly #ulid = monotonicUlidFactory();
  readonly #off: Array<() => void>;
  readonly #stats: SubscriptionStats = { active: 0, dropped: 0, maxLag: 0, maxBuffered: 0, delivered: 0, wakes: 0 };
  readonly cap: number;

  constructor(o: SubscriptionHubOptions) {
    this.#o = o;
    this.cap = o.backlogCap ?? SUBSCRIPTION_BACKLOG_CAP;
    this.#off = [o.log.onCommit((e) => this.#onCommit(e)), o.log.onRelease((head) => this.#onRelease(head))];
  }

  stats(): SubscriptionStats {
    return { ...this.#stats, active: this.#subs.size };
  }

  count(connId?: string): number {
    if (connId === undefined) return this.#subs.size;
    let n = 0;
    for (const s of this.#subs.values()) if (s.ctx.connId === connId) n++;
    return n;
  }

  /** Open a subscription; the pump starts after the reply is written (ctx.afterReply). */
  subscribe(ctx: ConnectionContext, grant: ReaderGrant, p: LogReadParams): Record<string, unknown> {
    const head = this.#o.log.releasedHead();
    if (p.since > head) throw bad('since-ahead', `since ${p.since} is past the released head ${head}`);
    if (p.until !== undefined) throw bad('bad-until', 'until is a page bound; a subscription has none');
    const admit = Math.floor(this.cap / 2); // headroom: a subscriber starts at most half-way to the drop line
    if (head - p.since > admit) {
      throw new RpcRefusal('BAD_REQUEST', 'backlog-too-large', `the backlog after since ${p.since} is ${head - p.since} rows (> ${admit}); page with log.read until caughtUp, then follow from its next`, {
        backlog: head - p.since,
        admit,
        backlogCap: this.cap,
      });
    }
    if (this.count(ctx.connId) >= (this.#o.maxPerConnection ?? MAX_SUBSCRIPTIONS_PER_CONNECTION)) throw bad('subscription-cap', 'too many subscriptions on this connection');
    if (this.#subs.size >= (this.#o.maxTotal ?? MAX_SUBSCRIPTIONS)) throw bad('subscription-cap', 'too many subscriptions on this kernel');
    const sub: Sub = {
      id: `sub:${this.#ulid()}`,
      ctx,
      reader: grant.reader,
      ...(p.kinds ? { kinds: p.kinds } : {}),
      ...(p.match ? { match: p.match } : {}),
      cursor: p.since,
      scheduled: false,
      dead: false,
      started: false,
    };
    this.#subs.set(sub.id, sub);
    sub.release = this.#o.holdIdle?.();
    ctx.afterReply(() => {
      sub.started = true;
      this.#pump(sub);
    });
    return { subscription: sub.id, since: p.since, head, projection: grant.projection, ...(grant.fullView ? { fullView: grant.fullView } : {}), backlogCap: this.cap };
  }

  /** The connection is gone: end its subscriptions (no drop row — nothing lagged). */
  disconnect(connId: string): void {
    for (const s of [...this.#subs.values()]) if (s.ctx.connId === connId) this.#kill(s);
  }

  close(): void {
    for (const off of this.#off) off();
    for (const s of [...this.#subs.values()]) this.#kill(s);
  }

  /**
   * Commit-path fan-out: O(1) per subscriber and NO projection, copy or hash —
   * lag = min(committed seq, releasedHead) − cursor (invisible rows count); a
   * pump is woken only if the row's metadata could reach the reader
   * (kind filter + mayBeVisible) or the lag passed SCAN_NUDGE.
   */
  #onCommit(e: EventV1): void {
    const deliverable = Math.min(e.seq, this.#o.log.releasedHead()); // rows above the released head are not the reader's lag
    for (const s of this.#subs.values()) {
      if (s.dead) continue;
      const lag = deliverable - s.cursor;
      if (lag > this.#stats.maxLag) this.#stats.maxLag = lag;
      if (lag > this.cap) {
        this.#drop(s, lag);
        continue;
      }
      if (lag > SCAN_NUDGE || ((!s.kinds || s.kinds(e.kind)) && mayBeVisible(e, s.reader))) {
        this.#stats.wakes++;
        this.#schedule(s);
      }
    }
  }

  #onRelease(head: number): void {
    for (const s of this.#subs.values()) if (!s.dead && s.cursor < head) this.#schedule(s);
  }

  #schedule(s: Sub): void {
    if (s.scheduled || s.dead || !s.started || s.offDrain) return;
    s.scheduled = true;
    setImmediate(() => {
      s.scheduled = false;
      this.#pump(s);
    });
  }

  #waitDrain(s: Sub): void {
    if (s.offDrain || s.dead) return;
    s.offDrain = s.ctx.onDrain(() => {
      s.offDrain = undefined;
      this.#schedule(s);
    });
  }

  #pump(s: Sub): void {
    if (s.dead) return;
    const hw = s.ctx.writeHighWater;
    if (s.ctx.writableLength() > hw) return this.#waitDrain(s);
    let budget = PUMP_ROWS_PER_TICK;
    let page;
    try {
      page = this.#o.log.readPage({
        reader: s.reader,
        afterSeq: s.cursor,
        maxScan: PUMP_SCAN_PER_TICK,
        ...(s.kinds ? { kinds: s.kinds } : {}),
        ...(s.match ? { match: s.match } : {}),
        visit: (v) => {
          const { row } = sized(v);
          let sent: boolean;
          try {
            sent = s.ctx.notify('event', { subscription: s.id, row });
          } catch {
            // the frame could not be encoded: end the subscription visibly, never skip a row silently
            this.#kill(s);
            s.ctx.notify('event', { subscription: s.id, end: { reason: 'internal', since: s.cursor } });
            return false;
          }
          if (!sent) {
            this.#kill(s);
            return false;
          }
          s.cursor = v.seq;
          this.#stats.delivered++;
          const buffered = s.ctx.writableLength();
          if (buffered > this.#stats.maxBuffered) this.#stats.maxBuffered = buffered;
          return --budget > 0 && buffered <= hw;
        },
      });
    } catch {
      this.#kill(s); // log closed under us: the daemon is stopping
      return;
    }
    if (s.dead) return;
    s.cursor = page.lastScanned;
    if (page.caughtUp && s.cursor >= this.#o.log.releasedHead()) return; // idle until the next commit/release
    if (s.ctx.writableLength() > hw) this.#waitDrain(s);
    else this.#schedule(s);
  }

  #drop(s: Sub, lag: number): void {
    const since = s.cursor;
    this.#kill(s);
    this.#stats.dropped++;
    try {
      s.ctx.notify('event', { subscription: s.id, end: { reason: 'dropped', lag, since } });
    } catch {
      /* a tiny frame; cannot exceed the cap */
    }
    const connId = s.ctx.connId;
    queueMicrotask(() => this.#o.onDropped?.(connId, { subscription: s.id, lag, since }));
  }

  #kill(s: Sub): void {
    if (s.dead) return;
    s.dead = true;
    this.#subs.delete(s.id);
    s.offDrain?.();
    s.offDrain = undefined;
    s.release?.();
  }
}
