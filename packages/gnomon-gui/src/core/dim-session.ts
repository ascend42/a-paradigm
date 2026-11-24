/**
 * @symbol #gui-dim-session
 *
 * The LIVE loop of the open dimensions as one unit (boards S1.3 pass P4a; draft point 6). `DimSessions` is the one
 * place sessions are made; a `DimSession` is ONE open dimension. Together they tie what already exists:
 *
 *   the followed log ─ apply(rows) ─▶ DimStore ─▶ DimLive.row ─▶ handle.render(live.view())
 *   handle.onEdit / leaf.onOps ─▶ DimLive.local(ops, gestureOf(cause, Date.now())) ─▶ the shared limiter
 *     ─▶ sendModCommand(client, stamp, 'gnomon.dimension', 'dim.op', {dim, ops, focus: {hsid}}) ─▶ DimLive.ack
 *   handle.onUndoKey ─▶ DimLive.undo(stamp)          one timer from DimLive.nextDeadline() ─▶ DimLive.timeout()
 *
 * No DOM is touched here but through the board handle and the leaf it is handed. NOT imported by ui/app.ts in this
 * pass (test/board-isolation.test.ts): mounting it in the app is the next pass.
 *
 * RULES.
 *  - ONE SENDER. Every command goes through `sendModCommand` with the `GnomonClient` object itself and no `now`
 *    argument. A stamp is minted here, at send time, from the listener's own event and `Date.now()`.
 *  - NO STAMP, NO CHANGE. An edit whose cause gives no stamp (null, untrusted, a key held down) is put back
 *    (`render(view())`) and said in a notice. A stamp that is expired or used up when its turn comes is refused by
 *    the sender: the batch is dropped, the board re-rendered, ONE notice raised. Nothing is ever retried: `spent`
 *    and `replayed` mean a new gesture from the person.
 *  - OPEN ONCE. `dim.open` is sent once, when the session opens (it appends a start row every time). A session
 *    rebuilt after a reconnect is RESUMED: no command is sent; the store resumes from its cursor and the fold is
 *    checked against the hash the mod last answered (`status().verified`). `dim.attach` is sent before `dim.open`,
 *    on the same stamp, when the store shows the session is not attached to a known dimension.
 *  - ONE LIMITER. The host lets a mod append `DIM_SEND_LIMITS.hostPerSecond` rows a second, whatever dimension
 *    they are for. Every command of every session takes a slot from one `DimSendLimiter`.
 *  - LINK DOWN. `linkDown()`: nothing is sent, a new edit is refused with a notice, pending batches roll back at
 *    the timeout, the leaf forgets its copy. There is no offline queue. `connect()` with the new connection then
 *    DESTROYS every session and builds it again (a new `DimLive`, so no undo entry outlives its connection; the
 *    leaf and its copy register are destroyed with the old session).
 *  - `reset()` (the log was replaced, `cursor-epoch`): the `DimStore` is reset and every session destroyed.
 *  - One session per dimension. A dimension switch is `destroy()` of one and `open()` of another.
 */
import { DIM_MOD_ID, dimHash, isPlainObject } from '@a-company/gnomon-contracts';
import type { DimActor, DimOp, DimState } from '@a-company/gnomon-contracts';
import type { BoardHandle } from './board.js';
import type { GnomonClient } from './client.js';
import { DIM_COMMAND_REFUSALS, DimLive, dimAckOf, type DimAck, type DimLiveBatch, type DimLiveResult, type DimLiveStatus, type DimNotice } from './dim-live.js';
import type { DimStore } from './dim-store.js';
import { gestureOf, type Gesture } from './gesture.js';
import { modCommandFailure, sendModCommand } from './mod-command.js';
import { rowOf } from './store.js';

/**
 * `hostPerSecond` is the host's own limit (kernel modhost/bridge.ts MOD_APPEND_ROWS_PER_SEC). The page stays under
 * it: at most `perWindow` commands in any `windowMs`, and never two closer than `gapMs`.
 */
export const DIM_SEND_LIMITS = Object.freeze({ hostPerSecond: 20, perWindow: 15, windowMs: 1000, gapMs: 50 });

/** One limiter for every command to the dimension mod. PURE: the clock is the caller's. */
export class DimSendLimiter {
  /** when each of the last `perWindow` sends goes (or went), rising */
  #slots: number[] = [];

  /** Take the next slot: the time at or after `now` when one more command may go. The slot is taken. */
  reserve(now: number): number {
    const L = DIM_SEND_LIMITS;
    let at = now;
    const last = this.#slots[this.#slots.length - 1];
    if (last !== undefined) at = Math.max(at, last + L.gapMs);
    if (this.#slots.length >= L.perWindow) at = Math.max(at, this.#slots[this.#slots.length - L.perWindow]! + L.windowMs);
    this.#slots.push(at);
    if (this.#slots.length > L.perWindow) this.#slots.shift();
    return at;
  }
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A new node id (a ULID): the time, then 80 bits from `crypto.getRandomValues`. */
export function mintDimNodeId(): string {
  let t = Date.now();
  let head = '';
  for (let i = 0; i < 10; i++) {
    head = B32[t % 32] + head;
    t = Math.floor(t / 32);
  }
  let tail = '';
  for (const b of globalThis.crypto.getRandomValues(new Uint8Array(16))) tail += B32[b % 32];
  return head + tail;
}

/** The connection the sessions send on. `client` is the `GnomonClient` object itself (the stamp is numbered per client object). */
export interface DimLink {
  client: Pick<GnomonClient, 'call'>;
  /** `Session.principal` of core/client.ts */
  principal: string;
  /** `Session.connId` of core/client.ts: another tab of the same principal cannot confirm this page's batch */
  connId: string;
}

export interface DimSessionsDeps {
  store: DimStore;
  /** default `Date.now`: the clock of the live loop, the limiter and the timers (never of a gesture stamp) */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  /** a fresh node id; default `mintDimNodeId` */
  mint?: () => string;
  limiter?: DimSendLimiter;
}

export type DimSessionPhase = 'opening' | 'open' | 'closing' | 'closed' | 'failed';
export type DimSessionEnd = 'fold' | 'switch' | 'reset' | 'link' | 'gone';

/** What the keep line, the head and the Dimensions list read. Data only: the leaf owns the words. */
export interface DimSessionStatus extends DimLiveStatus {
  dim: string;
  hsid: string;
  phase: DimSessionPhase;
  /** the dimension's title as the fold holds it ('' until its start row has arrived) */
  title: string;
  /** the confirmed fold's seq */
  seq: number;
  /** earlier rows of this dimension were evicted from the store: the board is not the whole dimension */
  partial: boolean;
  /** rows the store could not keep at all (`DimStore.stats().dropped`): above 0 the leaf shows a line */
  dropped: number;
  /** the fold at the mod's last answered seq hashes as the mod said: true, false, or null while not yet comparable */
  verified: boolean | null;
}

/**
 * A notice with what it was about. `code`, `field`, `why` and `lost` are data for the leaf's table of plain words;
 * they are never shown as they are. Session codes besides DimLive's: `open-failed`, `close-failed`, `hash-mismatch`,
 * `redo-unavailable`, `not-open`.
 */
export interface DimSessionNotice extends DimNotice {
  about: 'edit' | 'undo' | 'open' | 'close' | 'link' | 'check';
}

export interface DimSessionChange {
  status: DimSessionStatus;
  notice: DimSessionNotice | null;
}

/** What the session needs of the leaf it is handed (ui/board-leaf.ts `BoardLeaf` has both). */
export interface DimSessionLeaf {
  destroy(): void;
  /** forget the copy register (the link went down) */
  forget?(): void;
}

/** The options a leaf is mounted with so that it is this session's leaf (spread into `mountBoardLeaf`'s options). */
export interface DimLeafWiring {
  view: () => DimState | null;
  onOps: (ops: DimOp[], cause: Event | null) => void;
  mint: () => string;
  onReady: (handle: BoardHandle) => void;
}

export type DimSessionsEvent = { type: 'opened'; session: DimSession } | { type: 'destroyed'; session: DimSession; why: DimSessionEnd } | { type: 'rebuilt'; from: DimSession; session: DimSession };

interface Internals {
  deps: Required<Pick<DimSessionsDeps, 'now' | 'setTimer' | 'clearTimer' | 'mint'>> & { store: DimStore; limiter: DimSendLimiter };
  link(): DimLink | null;
  verifiedAt(dim: string): { seq: number; hash: string } | null;
  setVerified(dim: string, v: { seq: number; hash: string }): void;
  gone(s: DimSession, why: DimSessionEnd): void;
}

/** The mod's own answer out of the relay's result (`{result: <answer>}` on the wire; the bare answer from a stand-in). */
export function modAnswerOf(result: unknown): unknown {
  if (isPlainObject(result) && typeof result.ok !== 'boolean' && isPlainObject(result.result)) return result.result;
  return result;
}

const refusalCodeOf = (answer: unknown): string => (isPlainObject(answer) && answer.ok === false && typeof answer.code === 'string' && DIM_COMMAND_REFUSALS.includes(answer.code) ? answer.code : 'refused');

export class DimSession {
  readonly dim: string;
  readonly hsid: string;
  readonly #x: Internals;
  readonly #live: DimLive;
  readonly #me: DimActor & { cls: 'human' };
  #phase: DimSessionPhase;
  #handle: BoardHandle | null = null;
  #leaf: DimSessionLeaf | null = null;
  #offs: Array<() => void> = [];
  #timer: unknown = null;
  #dead = false;
  #verified: boolean | null = null;
  #listeners = new Set<(c: DimSessionChange) => void>();
  #last: DimSessionNotice | null = null;
  /** resolves true once `dim.open` answered ok (at once for a resumed session), false when it failed */
  #opened: Promise<boolean>;

  /** @internal made by `DimSessions.open` / `resume` only */
  constructor(x: Internals, o: { dim: string; hsid: string; link: DimLink | null }, start: { resume: true } | { resume: false; gesture: Gesture | null; args: Record<string, unknown>; attach: boolean }) {
    this.#x = x;
    this.dim = o.dim;
    this.hsid = o.hsid;
    this.#me = { cls: 'human', principal: o.link?.principal ?? '' };
    x.deps.store.pin(o.dim);
    this.#live = new DimLive({
      dim: o.dim,
      me: this.#me,
      connId: o.link?.connId ?? null,
      stateAt: (seq) => x.deps.store.stateAt(o.dim, seq),
      send: (batch) => this.#sendBatch(batch),
      now: x.deps.now,
      mint: x.deps.mint,
    });
    if (!o.link) this.#live.link(false);
    if (start.resume) {
      this.#phase = 'open';
      this.#opened = Promise.resolve(true);
      this.#check();
    } else {
      this.#phase = 'opening';
      this.#opened = this.#open(start.gesture, start.args, start.attach);
    }
  }

  /** One command through the one sender, in its turn at the shared limiter. Never retried. */
  #command(g: Gesture | null, commandId: string, args: Record<string, unknown>): Promise<unknown> {
    const d = this.#x.deps;
    const now = d.now();
    const at = d.limiter.reserve(now);
    return new Promise<unknown>((resolve, reject) => {
      const go = (): void => {
        const link = this.#x.link();
        if (this.#dead || !link) return reject(new LinkDown());
        sendModCommand(link.client, g, DIM_MOD_ID, commandId, { ...args, dim: this.dim, focus: { hsid: this.hsid } }).then((r) => resolve(modAnswerOf(r)), reject);
      };
      if (at <= now) void Promise.resolve().then(go);
      else d.setTimer(go, at - now);
    });
  }

  #failure(err: unknown): { code: string; why: string | null } {
    return err instanceof LinkDown ? { code: 'link-down', why: null } : modCommandFailure(err);
  }

  async #open(g: Gesture | null, args: Record<string, unknown>, attach: boolean): Promise<boolean> {
    const fail = (code: string, why: string | null): boolean => {
      if (this.#dead) return false;
      this.#phase = 'failed';
      this.#emit({ about: 'open', code, field: 'dim', why, lost: 0 });
      return false;
    };
    if (!g) return fail('not-sent', 'gesture-missing');
    try {
      if (attach) {
        const a = await this.#command(g, 'dim.attach', {});
        if (!isPlainObject(a) || a.ok !== true) return fail('open-failed', refusalCodeOf(a));
      }
      const r = await this.#command(g, 'dim.open', args);
      if (this.#dead) return false;
      if (!isPlainObject(r) || r.ok !== true) return fail('open-failed', refusalCodeOf(r));
      if (Number.isSafeInteger(r.seq) && typeof r.hash === 'string') this.#x.setVerified(this.dim, { seq: r.seq as number, hash: r.hash });
      this.#phase = 'open';
      this.#check();
      this.#emit(null);
      return true;
    } catch (err) {
      const f = this.#failure(err);
      return fail(f.code, f.why);
    }
  }

  /** Compare the fold at the mod's last answered seq with the hash it gave, once the store has that row. */
  #check(): void {
    const v = this.#x.verifiedAt(this.dim);
    const store = this.#x.deps.store;
    if (!v || this.#verified === false || store.stateAt(this.dim).seq < v.seq) return;
    const same = dimHash(store.stateAt(this.dim, v.seq)) === v.hash;
    this.#verified = same;
    if (!same) this.#emit({ about: 'check', code: 'hash-mismatch', field: 'dim', why: null, lost: 0 });
  }

  #sendBatch(batch: DimLiveBatch): void {
    const settle = (ack: DimAck): void => {
      if (!this.#dead) this.#after(this.#live.ack(batch.id, ack), 'edit');
    };
    void this.#opened
      .then((ok) => {
        if (!ok) return settle({ ok: false, code: 'not-open', why: null });
        return this.#command(batch.gesture, 'dim.op', { ops: batch.ops }).then((r) => settle(dimAckOf(r)));
      })
      .catch((err: unknown) => {
        const f = this.#failure(err);
        settle({ ok: false, code: f.code, why: f.why });
      });
  }

  #arm(): void {
    const d = this.#x.deps;
    if (this.#timer !== null) d.clearTimer(this.#timer);
    this.#timer = null;
    if (this.#dead) return;
    const at = this.#live.nextDeadline();
    if (at === null) return;
    this.#timer = d.setTimer(() => {
      this.#timer = null;
      if (!this.#dead) this.#after(this.#live.timeout(), 'edit');
    }, Math.max(0, at - d.now()));
  }

  #render(): void {
    const h = this.#handle;
    if (h && h.isAlive()) h.render(this.#live.view());
  }

  #after(r: DimLiveResult, about: DimSessionNotice['about']): void {
    if (this.#dead) return;
    if (r.changed || r.resync) this.#render();
    if (r.changed || r.resync || r.notice) this.#emit(r.notice ? { ...r.notice, about } : null);
    this.#arm();
  }

  #emit(notice: DimSessionNotice | null): void {
    if (notice) this.#last = notice;
    const change: DimSessionChange = { status: this.status(), notice };
    for (const fn of [...this.#listeners]) fn(change);
  }

  /** Be told when `status()` or `view()` answers differently, with the notice that came with it (at most one). */
  onChange(fn: (c: DimSessionChange) => void): () => void {
    this.#listeners.add(fn);
    return () => void this.#listeners.delete(fn);
  }

  /** The newest notice, as data. */
  lastNotice(): DimSessionNotice | null {
    return this.#last;
  }

  /** What the board draws: the confirmed fold plus what is pending. The same state the handle is rendered from. */
  view(): DimState {
    return this.#live.view();
  }

  /** `dimHash` of the confirmed fold, for the reconnect comparison. */
  hash(): string {
    return dimHash(this.#x.deps.store.stateAt(this.dim));
  }

  status(): DimSessionStatus {
    const store = this.#x.deps.store;
    const head = store.stateAt(this.dim);
    return { ...this.#live.status(), dim: this.dim, hsid: this.hsid, phase: this.#phase, title: head.title, seq: head.seq, partial: store.list().find((l) => l.dim === this.dim)?.partial ?? false, dropped: store.stats().dropped, verified: this.#verified };
  }

  get alive(): boolean {
    return !this.#dead;
  }

  /** Resolves when `dim.open` has settled: true when the dimension is open. */
  opened(): Promise<boolean> {
    return this.#opened;
  }

  /** The options that make a leaf this session's (spread them into `mountBoardLeaf`'s). */
  leafOptions(): DimLeafWiring {
    return { view: () => (this.#dead ? null : this.#live.view()), onOps: (ops, cause) => this.edit(ops, cause), mint: this.#x.deps.mint, onReady: (handle) => this.attachHandle(handle) };
  }

  /** The leaf this session destroys when it goes (and whose copy it forgets when the link drops). */
  bindLeaf(leaf: DimSessionLeaf): void {
    if (this.#dead) return leaf.destroy();
    this.#leaf = leaf;
  }

  /** The board handle of this session's leaf: its edits and its undo key come here, and it is rendered from `view()`. One handle. */
  attachHandle(handle: BoardHandle): void {
    for (const off of this.#offs.splice(0)) off();
    this.#handle = handle;
    if (this.#dead) return;
    this.#offs.push(
      handle.onEdit((ops, cause) => this.edit(ops, cause)),
      handle.onUndoKey((event, redo) => (redo ? this.#emit({ about: 'undo', code: 'redo-unavailable', field: 'ops', why: null, lost: 0 }) : this.undo(event))),
    );
    this.#render();
  }

  /**
   * Ops a person made (the handle's `onEdit`, the leaf's `onOps`), with the trusted event that ended the gesture.
   * The stamp is minted HERE, now. With no stamp nothing is kept: the board is put back and a notice says so.
   */
  edit(ops: readonly DimOp[], cause: Event | null): void {
    if (this.#dead || ops.length === 0) return;
    const g = cause ? gestureOf(cause, Date.now()) : null;
    this.#after(this.#live.local(ops, g), 'edit');
  }

  /** Cmd/Ctrl+Z in the board, with its own keydown. */
  undo(event: Event | null): void {
    if (this.#dead) return;
    const g = event ? gestureOf(event, Date.now()) : null;
    this.#after(this.#live.undo(g), 'undo');
  }

  /** @internal rows of this dimension the store has just kept */
  rows(rows: readonly { seq: number; kind: string; payload: unknown }[]): void {
    if (this.#dead) return;
    let changed = false;
    let resync = false;
    for (const row of rows) {
      const r = this.#live.row(row);
      changed ||= r.changed;
      resync ||= r.resync;
    }
    this.#check();
    this.#after({ changed, resync, notice: null }, 'edit');
  }

  /** @internal the link went down */
  linkDown(): void {
    if (this.#dead) return;
    this.#leaf?.forget?.();
    const r = this.#live.link(false);
    this.#after(r, 'link');
    if (r.changed) this.#emit({ about: 'link', code: 'link-down', field: 'ops', why: null, lost: 0 });
  }

  /** Resolves when nothing of mine is pending (or the session has gone). */
  #idle(): Promise<void> {
    if (this.#dead || this.#live.status().pending === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const off = this.onChange(() => {
        if (!this.#dead && this.#live.status().pending > 0) return;
        off();
        resolve();
      });
    });
  }

  /**
   * Fold the leaf: `dim.close`, on the stamp of the press that asked (Esc, the head's key), after what is pending
   * has settled. True when the dimension closed and the session is destroyed; false (with a notice) when it stays.
   */
  async fold(cause: Event | null): Promise<boolean> {
    if (this.#dead || this.#phase === 'closing') return false;
    const g = cause ? gestureOf(cause, Date.now()) : null;
    const stay = (code: string, why: string | null): boolean => {
      if (!this.#dead) {
        if (this.#phase === 'closing') this.#phase = 'open';
        this.#emit({ about: 'close', code, field: 'dim', why, lost: 0 });
      }
      return false;
    };
    if (!g) return stay('not-sent', 'gesture-missing');
    if (!(await this.#opened)) return this.destroy('fold'), true;
    this.#phase = 'closing';
    this.#emit(null);
    await this.#idle();
    if (this.#dead) return false;
    try {
      const r = await this.#command(g, 'dim.close', {});
      if (this.#dead) return false;
      if (!isPlainObject(r) || r.ok !== true) return stay('close-failed', refusalCodeOf(r));
      if (Number.isSafeInteger(r.seq) && typeof r.hash === 'string') this.#x.setVerified(this.dim, { seq: r.seq as number, hash: r.hash });
      this.#phase = 'closed';
      this.destroy('fold');
      return true;
    } catch (err) {
      const f = this.#failure(err);
      return stay(f.code, f.why);
    }
  }

  /** Stop: the timer, the handle's listeners, the leaf (and so its copy register), the pin. Pending batches are abandoned. */
  destroy(why: DimSessionEnd = 'switch'): void {
    if (this.#dead) return;
    this.#dead = true;
    if (this.#phase !== 'closed' && this.#phase !== 'failed') this.#phase = 'closed';
    if (this.#timer !== null) this.#x.deps.clearTimer(this.#timer);
    this.#timer = null;
    for (const off of this.#offs.splice(0)) off();
    this.#handle = null;
    const leaf = this.#leaf;
    this.#leaf = null;
    leaf?.destroy();
    this.#x.deps.store.unpin(this.dim);
    this.#x.gone(this, why);
    this.#emit(null);
    this.#listeners.clear();
  }
}

class LinkDown extends Error {}

export class DimSessions {
  readonly #deps: Internals['deps'];
  readonly #sessions = new Map<string, DimSession>();
  readonly #verified = new Map<string, { seq: number; hash: string }>();
  readonly #listeners = new Set<(e: DimSessionsEvent) => void>();
  #link: DimLink | null = null;
  readonly #x: Internals;

  constructor(deps: DimSessionsDeps) {
    this.#deps = {
      store: deps.store,
      now: deps.now ?? (() => Date.now()),
      setTimer: deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>)),
      mint: deps.mint ?? mintDimNodeId,
      limiter: deps.limiter ?? new DimSendLimiter(),
    };
    this.#x = {
      deps: this.#deps,
      link: () => this.#link,
      verifiedAt: (dim) => this.#verified.get(dim) ?? null,
      setVerified: (dim, v) => void this.#verified.set(dim, v),
      gone: (s, why) => {
        if (this.#sessions.get(s.dim) === s) this.#sessions.delete(s.dim);
        this.#tell({ type: 'destroyed', session: s, why });
      },
    };
  }

  #tell(e: DimSessionsEvent): void {
    for (const fn of [...this.#listeners]) fn(e);
  }

  onEvent(fn: (e: DimSessionsEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => void this.#listeners.delete(fn);
  }

  get store(): DimStore {
    return this.#deps.store;
  }

  /**
   * The connection is up: `link.client` is the new `GnomonClient`. Every session that was open is DESTROYED and
   * built again as a resumed one (no command is sent); the new sessions are returned, and told as `rebuilt`.
   */
  connect(link: DimLink): DimSession[] {
    this.#link = link;
    const out: DimSession[] = [];
    for (const old of [...this.#sessions.values()]) {
      const { dim, hsid } = old;
      old.destroy('link');
      const session = this.resume({ dim, hsid });
      out.push(session);
      this.#tell({ type: 'rebuilt', from: old, session });
    }
    return out;
  }

  /** The connection closed. Sessions stay, link-down, until `connect` rebuilds them. */
  linkDown(): void {
    if (!this.#link) return;
    this.#link = null;
    for (const s of [...this.#sessions.values()]) s.linkDown();
  }

  get linked(): boolean {
    return this.#link !== null;
  }

  /**
   * The rows the page follows (the same ones `GuiStore.apply` takes: wire rows `{seq, view, event}` or flat ones).
   * They are folded into the `DimStore`, and each open session is told of its dimension's new rows.
   */
  apply(rows: readonly unknown[]): void {
    const flat: unknown[] = [];
    for (const w of rows) {
      const r = rowOf(w);
      if (r) flat.push(r);
    }
    const fresh = this.#deps.store.apply(flat);
    for (const [dim, added] of fresh) this.#sessions.get(dim)?.rows(added);
  }

  /** The log was replaced (`cursor-epoch`; call it wherever the GUI store resets): forget every row and destroy every session. */
  reset(): void {
    for (const s of [...this.#sessions.values()]) s.destroy('reset');
    this.#verified.clear();
    this.#deps.store.reset();
  }

  get(dim: string): DimSession | null {
    return this.#sessions.get(dim) ?? null;
  }

  list(): DimSession[] {
    return [...this.#sessions.values()];
  }

  /**
   * Open a dimension for a session, on the trusted event that asked for it: `dim.open` is sent ONCE (after
   * `dim.attach`, on the same stamp, when the store shows this session is not attached to a dimension it holds).
   * A dimension that is already open answers its session and sends nothing.
   */
  open(o: { dim: string; hsid: string; opened: 'command' | 'menu' | 'offer'; title?: string; titleFrom?: 'session' | 'user' }, cause: Event | null): DimSession {
    const have = this.#sessions.get(o.dim);
    if (have) return have;
    const store = this.#deps.store;
    const attach = store.has(o.dim) && !store.stateAt(o.dim).attached.includes(o.hsid);
    const args: Record<string, unknown> = { opened: o.opened, ...(o.title !== undefined ? { title: o.title } : {}), ...(o.titleFrom !== undefined ? { titleFrom: o.titleFrom } : {}) };
    const g = cause ? gestureOf(cause, Date.now()) : null;
    return this.#add(new DimSession(this.#x, { dim: o.dim, hsid: o.hsid, link: this.#link }, { resume: false, gesture: g, args, attach }));
  }

  /** A session for a dimension that is already open in the log (after a reconnect): nothing is sent. */
  resume(o: { dim: string; hsid: string }): DimSession {
    const have = this.#sessions.get(o.dim);
    if (have) return have;
    return this.#add(new DimSession(this.#x, { dim: o.dim, hsid: o.hsid, link: this.#link }, { resume: true }));
  }

  #add(s: DimSession): DimSession {
    this.#sessions.set(s.dim, s);
    this.#tell({ type: 'opened', session: s });
    return s;
  }

  /** Destroy every session (the page is going). */
  destroy(): void {
    for (const s of [...this.#sessions.values()]) s.destroy('gone');
  }
}
