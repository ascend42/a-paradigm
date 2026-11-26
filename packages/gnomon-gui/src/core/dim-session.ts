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
 * No DOM is touched here but through the board handle and the leaf it is handed. Since pass P4b-1 ui/app.ts makes
 * the page's one `DimSessions` and the dock (ui/board-dock.ts) mounts each session's leaf.
 *
 * RULES.
 *  - ONE SENDER. Every command goes through `sendModCommand` with the `GnomonClient` object itself and no `now`
 *    argument. A stamp is minted here from the listener's own event and `Date.now()`, when the EDIT is reported
 *    (the end of the gesture), not when its command leaves: the command may then wait its turn, and a stamp that
 *    has grown too old by then is refused by the sender.
 *  - NO STAMP, NO CHANGE. An edit whose cause gives no stamp (null, untrusted, a key held down) is put back
 *    (`render(view())`) and said in a notice. A stamp that is expired or used up when its turn comes is refused by
 *    the sender: the batch is dropped, the board re-rendered, ONE notice raised. Nothing is ever retried: `spent`
 *    and `replayed` mean a new gesture from the person.
 *  - OPEN ONCE. `dim.open` is sent once, when the session opens (it appends a start row every time). A session
 *    rebuilt after a reconnect is RESUMED: no command is sent; the store resumes from its cursor and the fold is
 *    checked against the hash the mod last answered (`status().verified`). `dim.attach` is sent before `dim.open`,
 *    on the same stamp, when the store shows the session is not attached to a known dimension.
 *  - ONE STAMP AT A TIME. A stamp's number may not go backwards on a connection (core/gesture.ts), so while one
 *    stamp still has commands to come (the rows of a multi-row action, `dim.attach` then `dim.open`), no command
 *    on another stamp is sent by any session: it waits its turn at the gate.
 *  - ONE LIMITER. The host lets a mod append `DIM_SEND_LIMITS.hostPerSecond` rows a second, whatever dimension
 *    they are for. Every command of every session takes a slot from one `DimSendLimiter`.
 *  - LINK DOWN. `linkDown()`: nothing is sent, a new edit is refused with a notice, pending batches roll back at
 *    the timeout, the leaf forgets its copy. There is no offline queue. `connect()` with the new connection then
 *    DESTROYS every session and builds it again (a new `DimLive`, so no undo entry outlives its connection; the
 *    leaf and its copy register are destroyed with the old session).
 *  - `reset()` (the log was replaced, `cursor-epoch`): the `DimStore` is reset and every session destroyed.
 *  - One session per dimension. A dimension switch is `destroy()` of one and `open()` of another.
 */
import { DIM_MOD_ID, dimHash, dimMayDraw, isPlainObject } from '@a-company/gnomon-contracts';
import type { DimActor, DimOp, DimState } from '@a-company/gnomon-contracts';
import type { BoardHandle, BoardView } from './board.js';
import type { GnomonClient } from './client.js';
import { DIM_COMMAND_REFUSALS, DIM_LIVE_TIMEOUT_MS, DimLive, dimAckOf, type DimAck, type DimLiveBatch, type DimLiveResult, type DimLiveStatus, type DimNotice } from './dim-live.js';
import { parseTurnRef, type DimStore, type DimTurnMarks } from './dim-store.js';
import { gestureOf, type Gesture } from './gesture.js';
import { modCommandFailure, sendModCommand } from './mod-command.js';
import { wireRowOf } from './store.js';

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

  /** when each of the last `perWindow` commands REALLY left, rising */
  #sent: number[] = [];

  /**
   * The command whose slot has come is about to leave, at `now` on the clock: 0 when it may (it is then counted as
   * sent), else how long it must still wait. Slots are a schedule; timers fire late and then together, so the
   * limit is held HERE, against the times commands really left, whatever the number of open dimensions.
   */
  ready(now: number): number {
    const L = DIM_SEND_LIMITS;
    const last = this.#sent[this.#sent.length - 1];
    let wait = 0;
    if (last !== undefined && now - last < L.gapMs && now >= last) wait = L.gapMs - (now - last);
    if (this.#sent.length >= L.perWindow) {
      const oldest = this.#sent[this.#sent.length - L.perWindow]!;
      if (now - oldest < L.windowMs && now >= oldest) wait = Math.max(wait, L.windowMs - (now - oldest));
    }
    if (wait > 0) return wait;
    this.#sent.push(now);
    if (this.#sent.length > L.perWindow) this.#sent.shift();
    return 0;
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
  /**
   * S1.4 P4b: is this hsid a LIVE session now (running or idle, not ended)? A grant targets the focus hsid the host
   * joins to a live session, so a session that is not live can be neither granted nor revoked: its draw key is
   * disabled. Default: every session is live.
   */
  live?: (hsid: string) => boolean;
}

/** S1.4 P4b: a pending grant shows its working look only after this long (design draw-grant state-notes.pending). */
export const DIM_GRANT_QUIET_MS = 300;
/** An agent label the page shows (the bridge's own pattern, MOD_BRIDGE_LIMITS.agentLabel; aegis N-7). */
export const DIM_AGENT_LABEL = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * One attached session's draw key, as data (design components.draw-grant). `write` is what the BOARD last confirmed
 * (the mod's answer, or the rows through the shared grant fold), never what was asked for. `state`:
 *  - `live`: the key takes a press;
 *  - `pending`: a change of this key is in flight (the words stay the confirmed ones);
 *  - `busy`: another key's change is in flight (every key takes the disabled look past DIM_GRANT_QUIET_MS);
 *  - `down`: held still by the link or a mismatch (both states take the disabled look);
 *  - `unknown`: the grant map has not arrived yet (opening): disabled, the words are the default's;
 *  - `idle`: the session is not live, so it can be neither granted nor revoked: disabled;
 *  - `unsure`: this page's change was never answered (aegis I-3): disabled until a grant row or an answer arrives.
 */
export interface DimGrantKey {
  hsid: string;
  write: boolean;
  state: 'live' | 'pending' | 'busy' | 'down' | 'unknown' | 'idle' | 'unsure';
  /** when the pending change left (for the 300 ms quiet), or null */
  since: number | null;
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
  /**
   * The fold at `checkedSeq` hashes as the mod said there: true or false; null is UNCHECKED (the mod has answered
   * no hash this page could compare yet). Rows after `checkedSeq` are never vouched for: the mod's `dim.op` answer
   * carries no hash, so only `dim.open` and `dim.close` give a point to compare at.
   */
  verified: boolean | null;
  /** the seq the fold was last compared at, or null */
  checkedSeq: number | null;
  /** true after a `hash-mismatch`: every edit is refused and said until the log is read again (`reset()`) */
  readOnly: boolean;
  /** S1.4 P4b: the attribution digest the mod answered at its last hash point, and where; recorded only (E3 compares it) */
  attr: { seq: number; attr: string } | null;
  /** S1.4 P4b: an agent turn ended with rows here and its hash point has not been asked for yet */
  checkDue: boolean;
}

/**
 * A notice with what it was about. `code`, `field`, `why` and `lost` are data for the leaf's table of plain words;
 * they are never shown as they are. Session codes besides DimLive's: `open-failed`, `close-failed`, `hash-mismatch`,
 * `redo-unavailable`, `not-open`.
 */
export interface DimSessionNotice extends DimNotice {
  about: 'edit' | 'undo' | 'open' | 'close' | 'link' | 'check' | 'grant' | 'hand';
  /**
   * S1.4 P4b. `grant` codes: `grant-on` / `grant-off` (a change the board confirmed; said once), `grant-default`
   * (the first attached session's grant confirmed by the open answer, Aegis D1), `grant-refused` (the board did
   * not take it). `hand` codes: `arrived` (an agent turn ended with rows on this board: `marks`), `gone` (a mark in
   * the person's hand was removed by another hand: `agent` is its label, null for a person or the unknown hand).
   */
  hsid?: string;
  write?: boolean;
  agent?: string | null;
  /** the remover's session, when it was an agent */
  byHsid?: string | null;
  marks?: DimTurnMarks;
  change?: 'moving' | 'changing';
  /** `gone`: who removed it (aegis I-7): an agent, the person on another of their pages, another person, or unknown */
  who?: 'agent' | 'self' | 'person' | 'unknown';
}

export interface DimSessionChange {
  status: DimSessionStatus;
  notice: DimSessionNotice | null;
}

/** What the session needs of the leaf it is handed (ui/board-leaf.ts `BoardLeaf` has both). */
export interface DimSessionLeaf {
  destroy(): void;
  /** forget the copy register (the link went down) */
  forget(): void;
  /** hold the board still and say why, or let it go (null): the link is down, or the fold is out of date */
  setInert?(why: 'link-down' | 'out-of-date' | null): void;
  /** words held in an open text by a board too short to draw on (the leaf's own hold), or nothing */
  holdsWords?(): boolean;
  typed?(): string | null;
}

/** The options a leaf is mounted with so that it is this session's leaf (spread into `mountBoardLeaf`'s options). */
export interface DimLeafWiring {
  view: () => DimState | null;
  onOps: (ops: DimOp[], cause: Event | null) => void;
  mint: () => string;
  onReady: (handle: BoardHandle) => void;
}

/** `lost`: pending ops thrown away with the session (never silent: the caller says so). */
export type DimSessionsEvent = { type: 'opened'; session: DimSession } | { type: 'destroyed'; session: DimSession; why: DimSessionEnd; lost: number } | { type: 'rebuilt'; from: DimSession; session: DimSession; lost: number };
/** How long a dimension switch waits for pending batches before it leaves them. */
export const DIM_SWITCH_WAIT_MS = 2000;

interface Internals {
  deps: Required<Pick<DimSessionsDeps, 'now' | 'setTimer' | 'clearTimer' | 'mint' | 'live'>> & { store: DimStore; limiter: DimSendLimiter };
  link(): DimLink | null;
  verifiedAt(dim: string): { seq: number; hash: string } | null;
  setVerified(dim: string, v: { seq: number; hash: string }): void;
  gone(s: DimSession, why: DimSessionEnd): void;
  gate: StampGate;
}

/** Lets one stamp finish its commands before another stamp is first sent on the connection. */
class StampGate {
  #holder: Gesture | null = null;
  #waiters: Array<() => void> = [];

  /**
   * Resolves when no OTHER stamp holds the gate, and takes it for `g` in the same step as the check, so two stamps
   * cannot both pass. It is let go by `release(g)`: when the LAST command of the stamp has been handed to the
   * sender (never merely when it entered), or when the stamp will send no more.
   */
  enter(g: Gesture | null): Promise<void> {
    if (this.#holder !== null && this.#holder !== g) return new Promise<void>((resolve) => void this.#waiters.push(resolve)).then(() => this.enter(g));
    if (g) this.#holder = g;
    return Promise.resolve();
  }

  release(g: Gesture | null): void {
    if (g === null || this.#holder !== g) return;
    this.#holder = null;
    for (const fn of this.#waiters.splice(0)) fn();
  }
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
  /** the stamp this session holds the gate for, and what for (an edit's rows, or attach then open) */
  #held: Gesture | null = null;
  #heldFor: 'edit' | 'command' = 'command';
  /** `dim.open` was accepted (or the session was resumed from one that had been) */
  #openOk = false;
  /** the fold did not hash as the mod said: nothing more is sent from this board until a reset */
  #readOnly = false;
  #checkedSeq: number | null = null;
  #heldWords: string | null = null;
  readonly #partial: boolean;
  #verified: boolean | null = null;
  #lost = 0;
  /** ops of batches that were pending when the link went down and have fallen since (said once, when the link is back) */
  #downLost = 0;
  #lastView: Pick<BoardView, 'scrollX' | 'scrollY' | 'zoom'> | null = null;
  /** @internal where the board of the session this one replaces was looking */
  startView: Pick<BoardView, 'scrollX' | 'scrollY' | 'zoom'> | null = null;
  #listeners = new Set<(c: DimSessionChange) => void>();
  #last: DimSessionNotice | null = null;
  /** resolves true once `dim.open` answered ok (at once for a resumed session), false when it failed */
  #opened: Promise<boolean>;
  /**
   * S1.4 P4b (Aegis M9): the grant map the MOD last answered (`dim.open`, `dim.grant`) and the highest row seq the
   * store had then; the rows win once the store holds a later row. Null until an answer.
   */
  #grantAnswer: { seq: number; rowsAt: number; map: Map<string, boolean> } | null = null;
  /** aegis I-3: the session whose change this page never saw answered; its key waits for a row or an answer */
  #unsure: string | null = null;
  /** what each key last SHOWED as confirmed: a flip that comes from rows (another page) is spoken (aegis I-3) */
  readonly #shown = new Map<string, boolean>();
  /** the grant map has arrived on this connection (the open answer; for a resumed session, the backlog read before it) */
  #grantsReady = false;
  /** the one grant change in flight, or null: a press while it is in flight is DROPPED */
  #grantFlight: { hsid: string; target: boolean; since: number; id: number } | null = null;
  #grantFlights = 0;
  #grantTimer: unknown = null;
  /** the attr digest the mod answered at its last hash point (recorded only: an attr-only mismatch is E3's line) */
  #attr: { seq: number; attr: string } | null = null;
  /** an agent turn ended with rows on this board: the next trusted press of the person carries `dim.check` */
  #checkDue = false;
  /** dim.select: the one in flight, and the latest wanted after it (latest wins) */
  #selectFlying = false;
  #selectNext: { ids: string[]; g: Gesture } | null = null;
  #selectSent: string | null = '[]';
  /** recent DELETES by another hand: node id → who (agent label and session, or null for a person / unknown) */
  readonly #removedBy = new Map<string, { who: 'agent' | 'self' | 'person' | 'unknown'; agent: string | null; hsid: string | null }>();

  /** @internal made by `DimSessions.open` / `resume` only */
  constructor(x: Internals, o: { dim: string; hsid: string; link: DimLink | null; backlog?: boolean }, start: { resume: true } | { resume: false; gesture: Gesture | null; args: Record<string, unknown>; attach: boolean }) {
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
      leaves: true,
    });
    if (!o.link) this.#live.link(false);
    this.#partial = x.deps.store.list().find((l) => l.dim === o.dim)?.partial ?? false;
    if (start.resume) {
      this.#phase = 'open';
      this.#openOk = true;
      this.#opened = Promise.resolve(true);
      // a resumed session is built once the backlog is read (ui/app.ts connect): the grant rows written while the
      // link was down, by another connection too, are in the store now, so the map has arrived (Aegis ruling 3)
      this.#grantsReady = o.link !== null && o.backlog !== false;
      this.#noteShown();
      this.#check();
    } else {
      this.#phase = 'opening';
      this.#opened = this.#open(start.gesture, start.args, start.attach);
    }
  }

  /**
   * One command through the one sender, in its turn at the stamp gate and the shared limiter. Never retried.
   * `more`: another command follows on this stamp, so the gate is held for it until that one goes.
   */
  async #command(g: Gesture | null, commandId: string, args: Record<string, unknown>, more = false, batch: number | null = null, focus: string = this.hsid): Promise<unknown> {
    const d = this.#x.deps;
    // a batch dropped while it waited (the timeout, a refusal before it) is never sent
    const stale = (): boolean => batch !== null && !this.#live.flying(batch);
    // a stamp I held the gate for and that is not this one will send no more: it must not keep anyone waiting
    if (this.#held && this.#held !== g && this.#heldFor === 'edit') this.#release(this.#held);
    if (stale()) throw new Stale();
    await this.#x.gate.enter(g);
    if (g) {
      this.#held = g;
      this.#heldFor = batch === null ? 'command' : 'edit';
    }
    if (this.#dead || stale()) {
      this.#release(g);
      throw this.#dead ? new LinkDown() : new Stale();
    }
    const now = d.now();
    const at = d.limiter.reserve(now);
    return new Promise<unknown>((resolve, reject) => {
      const go = (): void => {
        // the limit is held against the times commands really left: a late timer waits again, it never bunches
        if (!this.#dead && this.#x.link() && !stale()) {
          const wait = d.limiter.ready(d.now());
          if (wait > 0) return void d.setTimer(go, wait);
        }
        try {
          const link = this.#x.link();
          if (this.#dead || !link) return reject(new LinkDown());
          if (stale()) return reject(new Stale());
          // the answer is waited for from the moment the command leaves
          if (batch !== null) {
            this.#live.left(batch);
            this.#arm();
          }
          sendModCommand(link.client, g, DIM_MOD_ID, commandId, { ...args, dim: this.dim, focus: { hsid: focus } }).then((r) => resolve(modAnswerOf(r)), reject);
        } finally {
          // the gate goes when the stamp's LAST command has been handed to the sender (its number is taken there)
          if (!more) this.#release(g);
        }
      };
      if (at <= now) void Promise.resolve().then(go);
      else d.setTimer(go, at - now);
    });
  }

  /** Let the next stamp through (the action on `g` has sent its last command, or will send no more). */
  #release(g: Gesture | null): void {
    this.#x.gate.release(g);
    if (this.#held === g) this.#held = null;
  }

  #failure(err: unknown): { code: string; why: string | null } {
    if (err instanceof Stale) return { code: 'not-sent', why: 'dropped' };
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
        const a = await this.#command(g, 'dim.attach', {}, true);
        if (!isPlainObject(a) || a.ok !== true) return this.#release(g), fail('open-failed', refusalCodeOf(a));
      }
      const r = await this.#command(g, 'dim.open', args);
      if (this.#dead) return false;
      if (!isPlainObject(r) || r.ok !== true) return fail('open-failed', refusalCodeOf(r));
      if (Number.isSafeInteger(r.seq) && typeof r.hash === 'string') this.#x.setVerified(this.dim, { seq: r.seq as number, hash: r.hash });
      this.#hashPoint(r);
      const before = this.#grantsReady;
      this.#takeGrants(r);
      this.#phase = 'open';
      this.#openOk = true;
      // Aegis D1: a session that holds the grant by default is told so ONCE, after the board confirmed it (never
      // sent with the attach: attaching sends no grant)
      this.#noteShown();
      // (aegis N-9: said only when this open made the dimension, the first attach; never on a reopen)
      if (!before && r.created === true && this.#grantsReady && this.#effectiveWrite(this.hsid)) this.#emit({ about: 'grant', code: 'grant-default', field: 'write', why: null, lost: 0, hsid: this.hsid, write: true });
      this.#check();
      this.#emit(null);
      return true;
    } catch (err) {
      this.#release(g);
      const f = this.#failure(err);
      return fail(f.code, f.why);
    }
  }

  /** Compare the fold at the mod's last answered seq with the hash it gave, once the store has that row. */
  #check(): void {
    const v = this.#x.verifiedAt(this.dim);
    const store = this.#x.deps.store;
    // checked already at this seq (the whole fold is not hashed again for every row), or already known wrong
    if (!v || this.#verified === false || this.#checkedSeq === v.seq || store.stateAt(this.dim).seq < v.seq) return;
    const same = dimHash(store.stateAt(this.dim, v.seq)) === v.hash;
    this.#verified = same;
    this.#checkedSeq = v.seq;
    if (same) return;
    // the page's fold is not the mod's: the board is READ-ONLY from here until the log is read again (reset)
    this.#readOnly = true;
    this.#leaf?.setInert?.('out-of-date');
    this.#emit({ about: 'check', code: 'hash-mismatch', field: 'dim', why: null, lost: 0 });
  }

  #sendBatch(batch: DimLiveBatch): void {
    const settle = (ack: DimAck): void => {
      // a row that failed takes the rest of its action with it: nothing more comes on that stamp
      if (!ack.ok) this.#release(batch.gesture);
      if (!this.#dead) this.#after(this.#live.ack(batch.id, ack), 'edit', true);
    };
    void this.#opened
      .then((ok) => {
        if (!ok) return settle({ ok: false, code: 'not-open', why: null });
        return this.#command(batch.gesture, 'dim.op', { ops: batch.ops }, batch.more, batch.id).then((r) => {
          // the person's own answer is a hash point too (S1.4 P4b: `hash` on the dim.op ok answer); it vouches for
          // every row up to its seq, an agent's included
          if (isPlainObject(r) && r.ok === true && Number.isSafeInteger(r.seq) && typeof r.hash === 'string') {
            this.#x.setVerified(this.dim, { seq: r.seq as number, hash: r.hash });
            this.#hashPoint(r);
          }
          settle(dimAckOf(r));
          this.#check();
        });
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
      if (!this.#dead) this.#after(this.#live.timeout(), 'edit', true);
    }, Math.max(0, at - d.now()));
  }

  #render(): void {
    const h = this.#handle;
    if (h && h.isAlive()) h.render(this.#live.view());
  }

  /** `settling`: the result is of a batch that was already pending (an answer, the timer), not of something the person just did. */
  #after(r: DimLiveResult, about: DimSessionNotice['about'], settling = false): void {
    if (this.#dead) return;
    // the link is down and the board says so for as long as it lasts: what was pending falls under THAT line, not
    // under a notice of its own. It is counted, and said once when the link is back.
    if (settling && r.notice && this.#x.link() === null) {
      this.#downLost += r.notice.lost;
      r = { ...r, notice: null };
    }
    // the stamp I hold the gate for rides no pending batch any more (its rows were dropped by the timeout, a
    // refusal, or the check of what still holds): it has no more to send, so the gate goes NOW, whatever else waits
    if (this.#held && this.#heldFor === 'edit' && !this.#live.rides(this.#held)) this.#release(this.#held);
    if (r.changed || r.resync) this.#render();
    if (r.changed || r.resync || r.notice) this.#emit(r.notice ? { ...r.notice, about } : null);
    this.#arm();
  }

  #emit(notice: DimSessionNotice | null): void {
    if (notice) this.#last = notice;
    const change: DimSessionChange = { status: this.status(), notice };
    for (const fn of [...this.#listeners]) {
      // a listener that throws is the listener's mistake: it is reported, and the loop goes on
      try {
        fn(change);
      } catch (err) {
        (globalThis as { reportError?: (e: unknown) => void }).reportError?.(err);
      }
    }
  }

  /** Be told when `status()` or `view()` answers differently, with the notice that came with it (at most one). */
  onChange(fn: (c: DimSessionChange) => void): () => void {
    this.#listeners.add(fn);
    return () => void this.#listeners.delete(fn);
  }

  /** @internal a notice raised for this session from outside it (what a reconnect lost); kept as the newest and told to listeners */
  note(notice: DimSessionNotice): void {
    if (!this.#dead) this.#emit(notice);
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
    return { ...this.#live.status(), dim: this.dim, hsid: this.hsid, phase: this.#phase, title: head.title, seq: head.seq, partial: this.#partial, dropped: store.stats().dropped, verified: this.#verified, checkedSeq: this.#checkedSeq, readOnly: this.#readOnly, attr: this.#attr, checkDue: this.#checkDue };
  }

  get alive(): boolean {
    return !this.#dead;
  }

  /** True once `dim.open` was accepted (a session that never opened is not resumed after a reconnect). */
  get openedOk(): boolean {
    return this.#openOk;
  }

  /** Words a too-short board held in an open text when the session was destroyed (read before its leaf went), or null. */
  get heldWords(): string | null {
    return this.#heldWords;
  }

  /** How many pending ops were thrown away when the session was destroyed (0 while it lives). */
  get lost(): number {
    return this.#lost;
  }

  /**
   * How many of the person's ops are NOT saved now: what is pending, plus what fell while the link was down (a
   * mark in flight at link loss is no longer pending once it has rolled back, and is still lost). After the session
   * is destroyed, `lost`.
   */
  get unsaved(): number {
    return this.#dead ? this.#lost : this.#live.pendingOps() + this.#downLost;
  }

  /** Where this session's board was looking when the session went (null: it had no board). */
  get lastView(): Pick<BoardView, 'scrollX' | 'scrollY' | 'zoom'> | null {
    return this.#lastView;
  }

  /** How many ops are pending now. */
  pendingOps(): number {
    return this.#dead ? 0 : this.#live.pendingOps();
  }

  /**
   * Leave this dimension for another (a switch): what is pending is given up to `DIM_SWITCH_WAIT_MS` to settle,
   * then the session is destroyed. Answers how many ops were NOT saved (also on the `destroyed` event), so the
   * caller says so; 0 when everything was.
   */
  async leave(): Promise<number> {
    if (this.#dead) return this.#lost;
    const d = this.#x.deps;
    await Promise.race([this.#idle(), new Promise<void>((resolve) => void d.setTimer(resolve, DIM_SWITCH_WAIT_MS))]);
    this.destroy('switch');
    return this.#lost;
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
    // a leaf handed to a session that is already held still is held still too
    if (this.#readOnly) leaf.setInert?.('out-of-date');
    else if (this.#x.link() === null) leaf.setInert?.('link-down');
  }

  /** The board handle of this session's leaf: its edits and its undo key come here, and it is rendered from `view()`. One handle. */
  attachHandle(handle: BoardHandle): void {
    for (const off of this.#offs.splice(0)) off();
    if (this.#dead) return;
    this.#handle = handle;
    // the board opens where the one it replaces was looking
    if (this.startView) {
      try {
        handle.setView(this.startView);
      } catch {
        /* the view is a convenience: the board still opens */
      }
      this.startView = null;
    }
    this.#offs.push(
      handle.onEdit((ops, cause) => this.edit(ops, cause)),
      handle.onUndoKey((event, redo) => (redo ? this.#emit({ about: 'undo', code: 'redo-unavailable', field: 'ops', why: null, lost: 0 }) : this.undo(event))),
      ...(handle.onGone ? [handle.onGone((r) => this.gone(r.id, r.change))] : []),
    );
    this.#render();
  }

  /**
   * Ops a person made (the handle's `onEdit`, the leaf's `onOps`), with the trusted event that ended the gesture.
   * The stamp is minted HERE, now. With no stamp nothing is kept: the board is put back and a notice says so.
   */
  edit(ops: readonly DimOp[], cause: Event | null): void {
    if (this.#dead || ops.length === 0) return;
    // nothing is taken from a board that is out of date, or one that is being folded (it would be sent after `dim.close`)
    const refused = this.#readOnly ? 'out-of-date' : this.#phase === 'closing' || this.#phase === 'closed' ? 'closing' : null;
    if (refused) {
      this.#render();
      return this.#emit({ about: 'edit', code: refused, field: 'ops', why: null, lost: ops.length });
    }
    const g = cause ? gestureOf(cause, Date.now()) : null;
    // an edit outranks a selection: a select waiting behind it is dropped (it would go on an older stamp)
    this.#selectNext = null;
    const r = this.#live.local(ops, g);
    this.#after(r, 'edit');
    // a REFUSED delete keeps its selection (Mika, final): the marks are put back and are still the ones in hand, so
    // the person can take fewer of them without selecting again. Selecting is never an edit.
    if (r.notice && r.resync && !this.#dead && ops.every((op) => op.type === 'delete')) {
      try {
        this.#handle?.select(ops.map((op) => (op as { id: string }).id));
      } catch {
        /* a handle that cannot select keeps the board as it was put back */
      }
    }
  }

  // ── S1.4 P4b: grants, selection, the hash point, an agent's hand ───────────

  /** An answer's grant map (`grants: [{hsid, write}]`, M9): the mod's, taken as the confirmed state at this point. */
  #takeGrants(r: Record<string, unknown>): void {
    const list = r.grants;
    if (!Array.isArray(list)) return;
    const seq = Number.isSafeInteger(r.seq) ? (r.seq as number) : 0;
    // aegis I-2: an answer older than the one held is not taken; the answer stands until a row LATER than its own
    // seq (it may arrive before its own row)
    if (this.#grantAnswer && seq < this.#grantAnswer.seq) return;
    const map = new Map<string, boolean>();
    for (const g of list) if (isPlainObject(g) && typeof g.hsid === 'string' && typeof g.write === 'boolean') map.set(g.hsid, g.write);
    this.#grantAnswer = { seq, rowsAt: Math.max(this.#x.deps.store.lastSeqOf(this.dim), seq), map };
    this.#unsure = null;
    if (this.#x.link() !== null) this.#grantsReady = true;
  }

  /** What the board last confirmed for `hsid`: the mod's answer, then any grant row later than it. */
  #effectiveWrite(hsid: string): boolean {
    const store = this.#x.deps.store;
    const a = this.#grantAnswer;
    // aegis I-2: the answer's map, with only the grant rows LATER than the answer folded over it (the answer may
    // arrive before its own row; an op row in between changes no grant)
    const row = store.grants(this.dim).get(hsid);
    if (a && a.map.has(hsid) && !(row && row.seq > a.seq)) return a.map.get(hsid)!;
    return dimMayDraw(store.stateAt(this.dim), store.grants(this.dim), hsid);
  }

  /** Record a hash point's attr digest (G7 / E1). A mismatch of attr alone is E3's line: nothing is compared here. */
  #hashPoint(r: Record<string, unknown>): void {
    if (Number.isSafeInteger(r.seq) && typeof r.attr === 'string') this.#attr = { seq: r.seq as number, attr: r.attr };
  }

  /**
   * The draw keys of the hands foot: one per ATTACHED session, in attach order (which never changes while the board
   * is open: no agent activity can move a key). Data only; the leaf owns the words.
   */
  grantKeys(): DimGrantKey[] {
    if (this.#dead) return [];
    const st = this.#x.deps.store.stateAt(this.dim);
    const down = this.#x.link() === null || this.#readOnly;
    const f = this.#grantFlight;
    return st.attached.map((hsid) => {
      const write = this.#effectiveWrite(hsid);
      const state: DimGrantKey['state'] = down ? 'down' : !this.#grantsReady || this.#phase !== 'open' ? 'unknown' : !this.#x.deps.live(hsid) ? 'idle' : f && f.hsid === hsid ? 'pending' : this.#unsure === hsid ? 'unsure' : f ? 'busy' : 'live';
      return { hsid, write, state, since: f ? f.since : null };
    });
  }

  /**
   * A press on a draw key (design draw-grant press; Aegis ruling 1). The command carries an EXPLICIT target, the
   * opposite of what the board last confirmed for that session, never a toggle. Dropped (never queued, never
   * replayed): an untrusted or held press, a press while any grant change is in flight, while the link is down or
   * the board out of date, before the grant map has arrived, for a session that is not attached or not live. True
   * when it was sent.
   */
  grant(hsid: string, cause: Event | null): boolean {
    if (this.#dead || !cause || cause.isTrusted !== true) return false;
    const key = this.grantKeys().find((k) => k.hsid === hsid);
    if (!key || key.state !== 'live') return false;
    const g = gestureOf(cause, Date.now());
    if (!g) return false;
    const target = !key.write;
    const d = this.#x.deps;
    const flight = { hsid, target, since: d.now(), id: ++this.#grantFlights };
    this.#grantFlight = flight;
    // the 300 ms quiet: the working look is drawn only once the change is slow
    if (this.#grantTimer !== null) d.clearTimer(this.#grantTimer);
    this.#grantTimer = d.setTimer(() => {
      this.#grantTimer = null;
      if (this.#dead || !this.#grantFlight) return;
      this.#emit(null);
      // a board that never answers: the key goes back to what the rows say, said once (never left pending)
      this.#grantTimer = d.setTimer(() => {
        this.#grantTimer = null;
        if (this.#dead || this.#grantFlight !== flight) return;
        // aegis I-3: not known whether it changed; the key stays disabled until a row or an answer says
        this.#grantFlight = null;
        this.#unsure = hsid;
        this.#emit({ about: 'grant', code: 'grant-unsure', field: 'write', why: 'no-answer', lost: 0, hsid, write: this.#effectiveWrite(hsid) });
      }, DIM_LIVE_TIMEOUT_MS);
    }, DIM_GRANT_QUIET_MS);
    const done = (ok: boolean, why: string | null): void => {
      if (this.#dead) return;
      // (aegis N-3: the flight's identity, not its session: a later press for the same session is another flight)
      if (this.#grantFlight !== flight) return;
      this.#grantFlight = null;
      this.#shown.set(hsid, this.#effectiveWrite(hsid));
      if (this.#grantTimer !== null) d.clearTimer(this.#grantTimer);
      this.#grantTimer = null;
      if (ok) this.#emit({ about: 'grant', code: this.#effectiveWrite(hsid) ? 'grant-on' : 'grant-off', field: 'write', why: null, lost: 0, hsid, write: this.#effectiveWrite(hsid) });
      else this.#emit({ about: 'grant', code: 'grant-refused', field: 'write', why, lost: 0, hsid, write: this.#effectiveWrite(hsid) });
    };
    this.#emit(null);
    void this.#command(g, 'dim.grant', { write: target }, false, null, hsid)
      .then((r) => {
        if (isPlainObject(r) && r.ok === true) {
          // a late answer still says what the board holds (it ends an unsure key)
          this.#takeGrants(r);
          if (this.#grantFlight !== flight && !this.#dead) {
            this.#noteShown();
            return this.#emit(null);
          }
          return done(true, null);
        }
        done(false, refusalCodeOf(r));
      })
      .catch((err: unknown) => done(false, this.#failure(err).code));
    return true;
  }

  /**
   * The selection changed on the person's own trusted event (`dim.select`): LOWEST priority, latest wins, and
   * DROPPED while an edit batch waits. Only this session's hsid is named (the host joins it): a selection is per hsid.
   */
  select(ids: readonly string[], cause: Event | null): void {
    if (this.#dead || !cause || cause.isTrusted !== true || this.#readOnly || this.#phase !== 'open' || this.#x.link() === null) return;
    const list = [...new Set(ids.filter((id) => typeof id === 'string'))].slice(0, 64);
    const key = JSON.stringify(list);
    if (key === this.#selectSent && !this.#selectFlying) return;
    const g = gestureOf(cause, Date.now());
    if (!g) return;
    this.#selectNext = { ids: list, g };
    this.#pumpSelect();
  }

  #pumpSelect(): void {
    const next = this.#selectNext;
    if (!next || this.#selectFlying || this.#dead) return;
    // an edit waits or flies: the selection is not worth its slot
    if (this.#live.status().pending > 0) return void (this.#selectNext = null);
    this.#selectNext = null;
    this.#selectFlying = true;
    const key = JSON.stringify(next.ids);
    void this.#command(next.g, 'dim.select', { ids: next.ids })
      .then((r) => {
        if (isPlainObject(r) && r.ok === true) this.#selectSent = key;
      })
      .catch(() => undefined)
      .finally(() => {
        this.#selectFlying = false;
        this.#pumpSelect();
      });
  }

  /**
   * The hash point after an agent's turn (Aegis C2.6). Every GUI mod command needs a gesture stamp, and the end of
   * an agent turn is no gesture of the person's, so `dim.check` rides on the person's NEXT trusted press or key on
   * the leaf: ONE call per due turn, never per row. Until then the check says the rows are not checked yet.
   */
  touch(cause: Event | null): void {
    if (!this.#checkDue || this.#dead || !cause || cause.isTrusted !== true || this.#readOnly || this.#phase !== 'open' || this.#x.link() === null) return;
    const g = gestureOf(cause, Date.now());
    if (!g) return;
    this.#checkDue = false;
    // aegis N-1: a refused or failed check leaves the point due, for the next press
    const again = (): void => void (!this.#dead && (this.#checkDue = true));
    void this.#command(g, 'dim.check', {})
      .then((r) => {
        if (this.#dead) return;
        if (!isPlainObject(r) || r.ok !== true || !Number.isSafeInteger(r.seq) || typeof r.hash !== 'string') return again();
        this.#x.setVerified(this.dim, { seq: r.seq as number, hash: r.hash });
        this.#hashPoint(r);
        this.#check();
        this.#emit(null);
      })
      .catch(again);
  }

  /** Remember what each key shows as confirmed now (no line: this page's own open, answer or press). */
  #noteShown(): void {
    for (const hsid of this.#x.deps.store.stateAt(this.dim).attached) this.#shown.set(hsid, this.#effectiveWrite(hsid));
  }

  /**
   * @internal grant rows of this board arrived. An unsure key is settled; a key whose confirmed state flipped by a
   * row that is not this page's own change in flight is SPOKEN once (aegis I-3: another page stopped an agent).
   */
  grantRows(): void {
    if (this.#dead) return;
    this.#unsure = null;
    if (this.#grantsReady) {
      for (const hsid of this.#x.deps.store.stateAt(this.dim).attached) {
        const now = this.#effectiveWrite(hsid);
        const was = this.#shown.get(hsid);
        this.#shown.set(hsid, now);
        if (was === undefined || was === now || this.#grantFlight?.hsid === hsid) continue;
        this.#emit({ about: 'grant', code: now ? 'grant-on' : 'grant-off', field: 'write', why: 'elsewhere', lost: 0, hsid, write: now });
      }
    }
    this.#emit(null);
  }

  /** @internal an agent turn closed (its `turn.result` row came): one arrival line, and its hash point is due */
  turnEnded(refs: readonly string[]): void {
    if (this.#dead) return;
    const store = this.#x.deps.store;
    for (const ref of refs) {
      const m = store.turnMarks(ref, this.dim);
      if (!m) continue;
      const t = parseTurnRef(ref);
      // the person's own answer since may already vouch for those rows
      const v = this.#x.verifiedAt(this.dim);
      if (!v || v.seq < m.lastSeq) this.#checkDue = true;
      // nothing landed (every op refused): nothing is said
      if (m.added + m.changed + m.removed === 0) continue;
      this.#emit({ about: 'hand', code: 'arrived', field: 'ops', why: null, lost: 0, agent: m.agent, hsid: t?.hsid ?? '', marks: { added: m.added, changed: m.changed, removed: m.removed } });
    }
  }

  /**
   * A row of this board: EVERY delete is remembered with who made it (aegis I-7): an agent (a tool surface and a
   * well-formed label), the person on another of their pages (`self`), another person, or `unknown` (no stamp). An
   * add of that id (a restore) forgets it.
   */
  #noteRemover(row: { kind: string; payload: unknown }): void {
    const p = isPlainObject(row.payload) ? row.payload : null;
    if (!p || !Array.isArray(p.ops)) return;
    const r = isPlainObject(p.relayedFor) ? p.relayedFor : null;
    const surface = r ? r.surface : undefined;
    const label = r && (surface === 'bridge' || surface === 'voice') && typeof r.agent === 'string' && DIM_AGENT_LABEL.test(r.agent) ? r.agent : null;
    const who: 'agent' | 'self' | 'person' | 'unknown' = label ? 'agent' : !r || typeof r.principal !== 'string' || r.agent !== undefined ? 'unknown' : r.principal === this.#me.principal ? 'self' : surface === 'gui' ? 'person' : 'unknown';
    const hsid = r && typeof r.hsid === 'string' ? r.hsid : null;
    for (const op of p.ops) {
      if (!isPlainObject(op)) continue;
      if (op.type === 'add' && isPlainObject(op.node) && typeof op.node.id === 'string') this.#removedBy.delete(op.node.id);
      if (op.type !== 'delete' || typeof op.id !== 'string') continue;
      this.#removedBy.delete(op.id);
      this.#removedBy.set(op.id, { who, agent: label, hsid });
      if (this.#removedBy.size > 256) this.#removedBy.delete(this.#removedBy.keys().next().value as string);
    }
  }

  /**
   * The handle's `{what: 'gone', id}`: at the drop, a mark the person held is no longer on the board (another hand
   * removed it mid-gesture). No op was made for it; the leaf says who removed it. Not a refusal.
   */
  gone(id: string, change: 'moving' | 'changing' = 'moving'): void {
    if (this.#dead) return;
    const by = this.#removedBy.get(id) ?? null;
    this.#emit({ about: 'hand', code: 'gone', field: 'ops', why: null, lost: 0, who: by ? by.who : 'unknown', agent: by ? by.agent : null, byHsid: by ? by.hsid : null, change });
  }

  /** Cmd/Ctrl+Z in the board, with its own keydown. */
  undo(event: Event | null): void {
    if (this.#dead) return;
    if (this.#readOnly || this.#phase === 'closing') return this.#emit({ about: 'undo', code: this.#readOnly ? 'out-of-date' : 'closing', field: 'ops', why: null, lost: 0 });
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
      this.#noteRemover(row);
    }
    this.#check();
    this.#after({ changed, resync, notice: null }, 'edit');
  }

  /** @internal the link went down */
  linkDown(): void {
    if (this.#dead) return;
    this.#leaf?.forget();
    // (aegis F6: a board already out of date stays out of date: it is the higher line, and read-only either way)
    if (!this.#readOnly) this.#leaf?.setInert?.('link-down');
    this.#release(this.#held);
    // Aegis ruling 3: the keys take the disabled look and stay so until the grant map arrives again; a change in
    // flight is not replayed on the next connection (that session is a new one, with no flight)
    this.#grantsReady = false;
    this.#grantFlight = null;
    this.#selectNext = null;
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
    this.#lost = this.#live.pendingOps() + this.#downLost;
    try {
      const v = this.#handle && this.#handle.isAlive() ? this.#handle.view() : null;
      if (v) this.#lastView = { scrollX: v.scrollX, scrollY: v.scrollY, zoom: v.zoom };
    } catch {
      /* a handle that cannot answer has no view to carry */
    }
    this.#release(this.#held);
    if (this.#phase !== 'closed' && this.#phase !== 'failed') this.#phase = 'closed';
    if (this.#timer !== null) this.#x.deps.clearTimer(this.#timer);
    this.#timer = null;
    if (this.#grantTimer !== null) this.#x.deps.clearTimer(this.#grantTimer);
    this.#grantTimer = null;
    for (const off of this.#offs.splice(0)) off();
    this.#handle = null;
    const leaf = this.#leaf;
    this.#leaf = null;
    // aegis F1 gap a: the words a too-short board holds are read BEFORE the leaf goes, so a kernel-driven end (a
    // reset, a session that is gone) can say them; carried on the `destroyed` event
    try {
      this.#heldWords = leaf?.holdsWords?.() ? (leaf.typed?.() ?? null) : null;
    } catch {
      this.#heldWords = null;
    }
    leaf?.destroy();
    this.#x.deps.store.unpin(this.dim);
    this.#x.gone(this, why);
    this.#emit(null);
    this.#listeners.clear();
  }
}

class LinkDown extends Error {}
/** The batch was dropped while its command waited its turn: nothing is sent. */
class Stale extends Error {}

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
      live: deps.live ?? (() => true),
    };
    this.#x = {
      deps: this.#deps,
      link: () => this.#link,
      verifiedAt: (dim) => this.#verified.get(dim) ?? null,
      setVerified: (dim, v) => void this.#verified.set(dim, v),
      gate: new StampGate(),
      gone: (s, why) => {
        if (this.#sessions.get(s.dim) === s) this.#sessions.delete(s.dim);
        // a folded dimension's vouched hash is not kept: the next open answers a new one
        if (why === 'fold') this.#verified.delete(s.dim);
        this.#tell({ type: 'destroyed', session: s, why, lost: s.lost });
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
  connect(link: DimLink, o: { backlog?: boolean } = {}): DimSession[] {
    this.#link = link;
    const out: DimSession[] = [];
    for (const old of [...this.#sessions.values()]) {
      const { dim, hsid } = old;
      // only a session whose `dim.open` was accepted is open in the log: one still opening, or failed, is not resumed
      const was = old.openedOk;
      old.destroy('link');
      if (!was) continue;
      const session = this.resume({ dim, hsid, backlog: o.backlog !== false });
      session.startView = old.lastView;
      // the link is back: said once on the new session, with what was pending and went with the old connection
      session.note({ about: 'link', code: old.lost > 0 ? 'not-saved' : 'reconnected', field: 'ops', why: null, lost: old.lost });
      out.push(session);
      this.#tell({ type: 'rebuilt', from: old, session, lost: old.lost });
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
      const r = wireRowOf(w);
      if (r) flat.push(r);
    }
    const store = this.#deps.store;
    const fresh = store.apply(flat);
    for (const [dim, added] of fresh) this.#sessions.get(dim)?.rows(added);
    // a grant row moved a board's grant map: its keys are drawn again (a pending press ends on the answer or here)
    for (const dim of store.grantsMoved()) this.#sessions.get(dim)?.grantRows();
    // an agent turn ended (S1.4 P4b): what it did on each open board is said once, and its hash point is due
    for (const r of flat) {
      if (!isPlainObject(r) || r.kind !== 'turn.result' || !isPlainObject(r.payload)) continue;
      const t = parseTurnRef(r.payload.turn);
      if (!t) continue;
      this.#lastResult.set(t.hsid, r.payload.turn as string);
      if (this.#lastResult.size > 256) this.#lastResult.delete(this.#lastResult.keys().next().value as string);
      const refs = store.turnsUpTo(t.hsid, t.n).filter((ref) => !this.#closed.has(ref));
      for (const ref of refs) {
        this.#closed.add(ref);
        if (this.#closed.size > 256) this.#closed.delete(this.#closed.values().next().value as string);
      }
      if (refs.length > 0) for (const s of this.#sessions.values()) s.turnEnded(refs);
    }
  }

  /** turn refs whose end was told already (a result row read twice never says its line twice) */
  readonly #closed = new Set<string>();
  /** hsid → the turn its latest `turn.result` row closed */
  readonly #lastResult = new Map<string, string>();

  /**
   * #gui-board-turn's tail: what the session's latest ENDED turn did on the boards, counted from rows (never from
   * the reply). Null when that turn wrote no tool row the store holds.
   */
  drewFor(hsid: string): DimTurnMarks | null {
    const ref = this.#lastResult.get(hsid);
    if (!ref) return null;
    const m = this.#deps.store.turnMarks(ref);
    return m ? { added: m.added, changed: m.changed, removed: m.removed } : null;
  }

  /** The log was replaced (`cursor-epoch`; call it wherever the GUI store resets): forget every row and destroy every session. */
  reset(): void {
    for (const s of [...this.#sessions.values()]) s.destroy('reset');
    this.#verified.clear();
    this.#closed.clear();
    this.#lastResult.clear();
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
    // a session whose open failed is replaced, never handed back
    if (have && have.status().phase === 'failed') have.destroy('gone');
    else if (have) return have;
    const store = this.#deps.store;
    const attach = store.has(o.dim) && !store.stateAt(o.dim).attached.includes(o.hsid);
    const args: Record<string, unknown> = { opened: o.opened, ...(o.title !== undefined ? { title: o.title } : {}), ...(o.titleFrom !== undefined ? { titleFrom: o.titleFrom } : {}) };
    const g = cause ? gestureOf(cause, Date.now()) : null;
    return this.#add(new DimSession(this.#x, { dim: o.dim, hsid: o.hsid, link: this.#link }, { resume: false, gesture: g, args, attach }));
  }

  /** A session for a dimension that is already open in the log (after a reconnect): nothing is sent. */
  resume(o: { dim: string; hsid: string; backlog?: boolean }): DimSession {
    const have = this.#sessions.get(o.dim);
    if (have) return have;
    // aegis I-6: a session resumed on a connection whose backlog read FAILED has no grant map: its keys stay disabled
    return this.#add(new DimSession(this.#x, { dim: o.dim, hsid: o.hsid, link: this.#link, backlog: o.backlog !== false }, { resume: true }));
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
