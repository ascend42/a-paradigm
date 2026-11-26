/**
 * @symbol #gui-dim-live
 *
 * The live loop of one open dimension (boards S1.3, draft point 6 "write path"; Mika's open items 1 and 2; Aegis
 * B3). A PURE controller: no DOM, no socket and NO TIMER. The clock and the sender are injected, and the caller
 * tells it what happened through four events:
 *
 *   local(ops, gesture)   a person edited the board (the engine's onEdit, a paste, an undo)
 *   ack(id, outcome)      the send of batch `id` settled (the mod's answer, or a failure)
 *   row(row)              a row of this dimension arrived from the log (the store already holds it)
 *   timeout()             the caller's tick: look for batches that have waited too long
 *
 * `view()` is what the board draws: the confirmed fold plus every pending batch, folded as rows stamped as me.
 * It never applies an edit twice. The in-flight batch stops being overlaid the moment a row of mine for it has
 * arrived (even before its ack, and even when the mod kept only some of its ops). And the confirmed fold is read
 * only as far as the rows `row()` has been told about, so the caller may fold a row into the store before or
 * after it calls `row()`: between the two, `view()` still answers the state without that row.
 *
 * Every result says `changed` (the view or the status answers differently) and `resync` (the engine may hold a
 * mark that was never kept, or one that was just rolled back: the caller must render from `view()` even though
 * the view itself may not have changed).
 *
 * RULES.
 *  - An edit needs a gesture stamp. `local` and `undo` with no stamp change nothing and answer a `not-sent` notice:
 *    nothing is ever shown optimistically that the sender would refuse to send.
 *  - One send is in flight per dimension, and sends are spaced DIM_LIVE_SEND_GAP_MS apart (the mod may append 20
 *    rows a second; the caller's shared limiter holds that across dimensions). Edits made meanwhile queue, and a
 *    queued edit that fits ONE row is merged into the single-row batch still waiting before it when both fit one
 *    row together (core/dim-rows.ts; an undo and a multi-row action are never merged with anything). The NEWEST
 *    stamp rides a merged batch.
 *  - ROWS THAT FIT. One action whose ops do not fit one row (more than DIM_LIMITS.opsPerRow ops, or over the row
 *    budget of core/dim-rows.ts) becomes several rows, in order, on the SAME stamp: a GROUP. A group is at most
 *    DIM_ACTION_ROWS rows (the stamp's fan-out, and B3's rows per undo); an action that needs more, or one op that
 *    fits no row, is refused whole with a notice (`too-large`, `row-too-large`) and nothing is kept. When one row
 *    of a group is dropped, the rows of that group still waiting fall with it, under the same notice.
 *  - A batch is CONFIRMED when the row with the acked seq arrives, in either order. A row of mine (my principal,
 *    the GUI surface, and my connection when both sides name one) that arrives before the ack is taken as the
 *    in-flight batch's row: it confirms at once when it carries exactly the batch's ops, and otherwise waits for
 *    the ack while the batch is no longer overlaid. If the ack never comes, the row stands and the ops it does not
 *    carry are reported lost.
 *  - A refusal, or DIM_LIVE_TIMEOUT_MS with no ack and no row, DROPS the batch. Later pending batches are then
 *    validated again against the new view and lose the ops that no longer hold. The drop yields ONE notice naming
 *    the field and the code: a mark never vanishes without a line saying why.
 *  - Link down: nothing is sent and a new edit is refused with a notice (there is no offline queue in S1.3);
 *    what was pending rolls back at the timeout.
 *  - Undo (B3): only this page's own confirmed rows are kept for undo, at most DIM_LIVE_LIMITS.undo of them; the
 *    inverse is planned by core/dim-undo.ts (validated, refused whole over its bounds) and sent like any edit, on
 *    its own fresh gesture stamp. Undo does nothing while any batch of mine is pending (`canUndo` is false until
 *    it confirms). An entry leaves the list only when its inverse is CONFIRMED; a failed send keeps it. An entry
 *    whose inverse can never be sent is dropped with one notice, so the older ones stay reachable. ONE ACTION IS ONE
 *    UNDO STEP: the rows of a group are one entry (those of them that were kept), undone together by one inverse,
 *    which is itself packed into rows and leaves the list when its LAST row is confirmed. An entry part of whose
 *    inverse landed and part of which was dropped is forgotten (it cannot be planned again).
 *
 * BOUNDS: at most DIM_LIVE_LIMITS.pending batches wait (a further edit is refused with a notice), DIM_LIVE_LIMITS.seen
 * early rows and DIM_LIVE_LIMITS.undo undo entries are remembered.
 */
import { DIM_FIELDS, DIM_KINDS, DIM_LIMITS, DIM_REFUSAL_CODES, canonicalJson, foldDim, isPlainObject, validateDimOps } from '@a-company/gnomon-contracts';
import type { DimActor, DimOp, DimRow, DimState } from '@a-company/gnomon-contracts';
import { DIM_ACTION_ROWS, fitsOneDimRow, packDimRows } from './dim-rows.js';
import { DIM_UNDO_LIMITS, invertDimOps, planUndo } from './dim-undo.js';
import type { Gesture } from './gesture.js';

/** How long a batch may wait for its ack and row before it is dropped. */
export const DIM_LIVE_TIMEOUT_MS = 8000;
/** The least time between two sends of one dimension (the mod may append at most 20 rows a second). */
export const DIM_LIVE_SEND_GAP_MS = 50;
export const DIM_LIVE_LIMITS = Object.freeze({ pending: 16, seen: 256, undo: 64 });

/** One line for the person. `field` is a DIM_FIELDS name; `code` is a validator code or one of the live codes below. */
export interface DimNotice {
  /**
   * A `DimRefusalCode`, a DIM_COMMAND_REFUSALS code of the mod, or: `timeout` (no answer in time), `link-down`,
   * `busy` (too many edits waiting), `not-undoable` (the action's inverse would be over the undo bound; `why` is
   * `delete` for a delete of too many marks), `undo-too-large` (an entry whose inverse can never be sent), `too-large` (one action over DIM_ACTION_ROWS rows), `row-too-large` (one op
   * fits no row), `not-sent`, `gesture-refused`, `read-only`, `no-answer`, `refused` (the sender's codes,
   * core/mod-command.ts), `undo-nothing`, `undo-too-many-ops`, `undo-too-many-rows`, `undo-invalid`.
   */
  code: string;
  field: string;
  /** the sender's, the kernel's or the mod's short word, when there is one */
  why: string | null;
  /** how many ops were not kept (the dropped batch and what fell with it) */
  lost: number;
}

/** What an event did. */
export interface DimLiveResult {
  /** `view()` or `status()` answers differently now */
  changed: boolean;
  /** the engine may show something the view does not hold (a refused or rolled-back mark): render from `view()` */
  resync: boolean;
  notice: DimNotice | null;
}

/** How a send settled. `seq` is the row the mod appended (absent when it appended none); `refused` are its refusals. */
export type DimAck =
  | { ok: true; seq: number | null; refused: ReadonlyArray<{ field: string; code: string }> }
  | { ok: false; code: string; why?: string | null; field?: string };

export interface DimLiveBatch {
  id: number;
  ops: DimOp[];
  gesture: Gesture;
  /** more rows of the same action follow on this stamp: the caller lets no other stamp be sent on the connection until the last one has gone */
  more: boolean;
}

export interface DimLiveDeps {
  dim: string;
  /** who the page is: pending marks are drawn as this hand */
  me: DimActor & { cls: 'human' };
  /** this page's connection id (core/client.ts Session.connId), when known: a row of the same principal from another tab is then not taken for mine */
  connId?: string | null;
  /** the confirmed state at the head, or after the row at `seq` (core/dim-store.ts stateAt) */
  stateAt(seq?: number): DimState;
  /** start sending a batch; the caller reports how it settled with `ack(batch.id, …)`. Must not call back synchronously. */
  send(batch: DimLiveBatch): void;
  now(): number;
  /** a fresh node id (a ULID), for a node an undo re-adds */
  mint(): string;
  /**
   * true: `send` only hands the batch over, and the caller reports `left(id)` when its command really goes out
   * (it may wait its turn first). The wait for an answer is then counted from `left`, and a batch that has not
   * left yet is never dropped by the timeout while the link is up (it would be said lost and then sent).
   */
  leaves?: boolean;
}

export interface DimLiveStatus {
  /** `saved`: nothing pending. `saving`: something is pending and the link is up. `not-saved`: pending or refused while the link is down. */
  keep: 'saved' | 'saving' | 'not-saved';
  link: 'up' | 'down';
  pending: number;
  inFlight: boolean;
  /** false while anything of mine is pending */
  canUndo: boolean;
  /** when the oldest unsaved batch was queued (the injected clock), or null: the leaf shows a slow save from it */
  since: number | null;
}

interface UndoEntry {
  /** the group the rows came from (one action that became several rows), or null */
  group: number | null;
  /** this page's confirmed rows of one action, oldest first */
  rows: Array<{ seq: number; ops: DimOp[] }>;
  /** a row of this entry's inverse has landed: it can no longer be planned whole */
  partly: boolean;
}

interface Pending {
  id: number;
  ops: DimOp[];
  gesture: Gesture;
  /** when it was queued */
  at: number;
  sentAt: number | null;
  ackSeq: number | null;
  ackAt: number | null;
  /** the undo entry this batch is (a row of) the inverse of */
  undo: UndoEntry | null;
  /** the action this row is one of several rows of, or null */
  group: number | null;
  /** the last row of its group (or a batch with no group) */
  last: boolean;
  /** `canonicalJson(ops)`, for matching the row that carries them */
  key: string;
  /** a row of mine that arrived before the ack: taken as this batch's row, so the batch is no longer overlaid */
  landed: DimRow | null;
}

const NONE: DimLiveResult = Object.freeze({ changed: false, resync: false, notice: null });
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/** The dimension mod's command refusal codes (`{ok: false, code, fix}`), closed. */
export const DIM_COMMAND_REFUSALS: readonly string[] = Object.freeze([
  'not-human-gui', 'no-session', 'command-unknown', 'args-bad', 'dim-bad', 'opened-bad', 'title-missing', 'title-bad', 'title-secret', 'dim-cap',
  'dim-unknown', 'repo-mismatch', 'not-attached', 'attach-cap', 'dim-ended', 'ops-refused', 'secret', 'row-too-large', 'append-failed', 'unavailable',
]);

/** The op refusals of a reply, each held to the contract's closed lists (input is never echoed into a notice). */
function refusalsOf(v: unknown): Array<{ field: string; code: string }> {
  if (!Array.isArray(v)) return [];
  return v.filter(isPlainObject).map((x) => ({
    field: typeof x.field === 'string' && DIM_FIELDS.includes(x.field) ? x.field : 'unknown',
    code: typeof x.code === 'string' && (DIM_REFUSAL_CODES as readonly string[]).includes(x.code) ? x.code : 'refused',
  }));
}

/**
 * Read the relay's result for `dim.op` into an ack. The relay answers the mod's own object:
 *  - `{ok: true, dim, seq, applied, refused: DimRefusal[]}`: a row was appended; `refused` lists the ops it left out;
 *  - `{ok: false, code, fix}` with a code of DIM_COMMAND_REFUSALS, plus `refused` for `ops-refused` and `secret`.
 * For a refusal that names ops, the ack's `code` and `field` are the first op refusal's and `why` is the mod's
 * code. Anything else (null, another shape, an unlisted code) is `{ok: false, code: 'refused'}`.
 */
export function dimAckOf(result: unknown): DimAck {
  if (!isPlainObject(result)) return { ok: false, code: 'refused', why: null };
  if (result.ok === true && Number.isSafeInteger(result.seq) && (result.seq as number) >= 1) return { ok: true, seq: result.seq as number, refused: refusalsOf(result.refused) };
  if (result.ok === false && typeof result.code === 'string' && DIM_COMMAND_REFUSALS.includes(result.code)) {
    const first = refusalsOf(result.refused)[0];
    return first ? { ok: false, code: first.code, field: first.field, why: result.code } : { ok: false, code: result.code, why: null };
  }
  return { ok: false, code: 'refused', why: null };
}

export class DimLive {
  readonly #d: DimLiveDeps;
  #flight: Pending | null = null;
  #queue: Pending[] = [];
  #nextId = 1;
  #nextGroup = 1;
  #linkUp = true;
  #lastSentAt: number | null = null;
  /** the seq of the newest row of this dimension `row()` has been told about (or that was there at the start) */
  #known: number;
  /** rows that arrived while a send had no ack yet and were not taken for mine (by reference: the store holds them too) */
  #seen: DimRow[] = [];
  /** this page's own confirmed rows, oldest first */
  #undo: UndoEntry[] = [];

  constructor(deps: DimLiveDeps) {
    this.#d = deps;
    this.#known = deps.stateAt().seq;
  }

  /** The confirmed state as far as `row()` has been told: a row the store folded first is not in it yet. */
  #confirmed(): DimState {
    const head = this.#d.stateAt();
    return head.seq > this.#known ? this.#d.stateAt(this.#known) : head;
  }

  /** The confirmed state plus `batches` folded as my rows. A synthetic row has no seq, so the state's seq stays the confirmed one. */
  #fold(batches: readonly Pending[]): DimState {
    const confirmed = this.#confirmed();
    if (batches.length === 0) return confirmed;
    const relayedFor = { principal: this.#d.me.principal, surface: 'gui' };
    return foldDim(batches.map((b) => ({ seq: Number.NaN, kind: DIM_KINDS.op, payload: { v: 1, dim: this.#d.dim, ops: b.ops, relayedFor } })), undefined, confirmed);
  }

  #pending(): Pending[] {
    return this.#flight ? [this.#flight, ...this.#queue] : this.#queue;
  }

  /** The batches that are not in the confirmed state yet: all pending ones, but not an in-flight batch whose row has landed. */
  #overlay(): Pending[] {
    return this.#flight && !this.#flight.landed ? [this.#flight, ...this.#queue] : this.#queue;
  }

  /** True while batch `id` is the one in flight: a send that waited its turn checks this before it leaves (a batch dropped meanwhile must never go out). */
  flying(id: number): boolean {
    return this.#flight !== null && this.#flight.id === id;
  }

  /** The command of batch `id` has actually left: its wait for an answer is counted from now, not from when it was handed over. */
  left(id: number): void {
    if (this.#flight && this.#flight.id === id) this.#flight.sentAt = this.#d.now();
  }

  /** When the in-flight batch's wait began: its ack, else when it left; one that has not left yet waits from when it was queued only while the link is down. */
  #waitingSince(f: Pending): number | null {
    return f.ackAt ?? f.sentAt ?? (this.#d.leaves && this.#linkUp ? null : f.at);
  }

  /** True while a pending batch (in flight or waiting) rides this stamp. */
  rides(gesture: Gesture): boolean {
    return this.#pending().some((b) => b.gesture === gesture);
  }

  /** How many ops are pending (what is lost if the controller is thrown away now). */
  pendingOps(): number {
    return this.#pending().reduce((n, b) => n + b.ops.length, 0);
  }

  /** What the board draws now. Read-only. */
  view(): DimState {
    return this.#fold(this.#overlay());
  }

  status(): DimLiveStatus {
    const pending = this.#pending();
    return {
      keep: pending.length === 0 ? 'saved' : this.#linkUp ? 'saving' : 'not-saved',
      link: this.#linkUp ? 'up' : 'down',
      pending: pending.length,
      inFlight: this.#flight !== null,
      canUndo: this.#undo.length > 0 && pending.length === 0,
      since: pending.length > 0 ? Math.min(...pending.map((b) => b.at)) : null,
    };
  }

  #pump(): void {
    if (this.#flight || !this.#linkUp || this.#queue.length === 0) return;
    const now = this.#d.now();
    if (this.#lastSentAt !== null && now - this.#lastSentAt < DIM_LIVE_SEND_GAP_MS && now >= this.#lastSentAt) return;
    const next = this.#queue.shift()!;
    next.sentAt = this.#d.leaves ? null : now;
    this.#lastSentAt = now;
    this.#flight = next;
    this.#seen = [];
    this.#d.send({ id: next.id, ops: next.ops, gesture: next.gesture, more: !next.last });
  }

  /** Why these ops, applied to `base`, could not be undone within the undo bound; null when they can. */
  #notUndoable(base: DimState, ops: readonly DimOp[]): 'too-many-ops' | 'too-many-rows' | null {
    let n = 0;
    // (ids for the count only: a re-added node's id is as long as any other)
    const inverse = invertDimOps(base, ops, () => `0000000000000000000${String(n++).padStart(7, '0')}`, base);
    if (inverse.length > DIM_UNDO_LIMITS.ops) return 'too-many-ops';
    const rows = packDimRows(inverse);
    return rows === null || rows.length > DIM_ACTION_ROWS ? 'too-many-rows' : null;
  }

  /** Queue the rows of ONE action (already packed). All or nothing: false when they do not all fit the pending bound. */
  #enqueue(rows: DimOp[][], gesture: Gesture, undo: UndoEntry | null): boolean {
    const now = this.#d.now();
    const last = this.#queue[this.#queue.length - 1];
    if (rows.length === 1 && !undo && last && !last.undo && last.group === null) {
      // one row's worth joins the single-row batch still waiting, when both fit one row together
      const merged = [...last.ops, ...rows[0]!];
      // (the merged batch is one undo entry: it must stay undoable as one)
      if (merged.length <= DIM_LIMITS.opsPerRow && fitsOneDimRow(merged) && !this.#notUndoable(this.#fold(this.#overlay().filter((b) => b !== last)), merged)) {
        last.ops = merged;
        last.key = canonicalJson(merged);
        // the NEWEST stamp rides the batch: it has the most life and uses left, and stamps are sent in rising order
        last.gesture = gesture;
        return true;
      }
    }
    if (this.#pending().length + rows.length > DIM_LIVE_LIMITS.pending) return false;
    const group = rows.length > 1 ? this.#nextGroup++ : null;
    rows.forEach((ops, i) => {
      this.#queue.push({ id: this.#nextId++, ops, gesture, at: now, sentAt: null, ackSeq: null, ackAt: null, undo, group, last: i === rows.length - 1, key: canonicalJson(ops), landed: null });
    });
    return true;
  }

  /**
   * A person's edit. The ops are validated against the view; the ones that pass become pending (and are sent when
   * no send is in flight). Refused ops are named in the notice, with `resync`. `gesture` is the trusted event the
   * edit came from: with none, nothing is kept and the notice is `not-sent`.
   */
  local(ops: readonly DimOp[], gesture: Gesture | null): DimLiveResult {
    return this.#local(ops, gesture, null);
  }

  #local(ops: readonly DimOp[], gesture: Gesture | null, undo: UndoEntry | null): DimLiveResult {
    if (ops.length === 0) return NONE;
    const refuse = (code: string, why: string | null = null): DimLiveResult => ({ changed: false, resync: true, notice: { code, field: 'ops', why, lost: ops.length } });
    if (!gesture) return refuse('not-sent', 'gesture-missing');
    if (!this.#linkUp) return refuse('link-down');
    let ok: DimOp[] = [];
    let notice: DimNotice | null = null;
    let state = this.view();
    // the validator takes one row's worth at a time
    for (let i = 0; i < ops.length; i += DIM_LIMITS.opsPerRow) {
      const v = validateDimOps(state, ops.slice(i, i + DIM_LIMITS.opsPerRow), this.#d.me);
      const first = v.refused[0];
      // a contrast refusal's reason travels as a closed word (`pair-line`, `faint-fill:night`), never as input
      if (first && !notice) notice = { code: first.code, field: first.field, why: first.rule ?? (first.contrast ? `${first.contrast.why}${first.contrast.night ? ':night' : ''}` : null), lost: 0 };
      if (v.secret) {
        ok = [];
        break;
      }
      ok.push(...v.ok);
      if (i + DIM_LIMITS.opsPerRow < ops.length) state = foldDim([{ seq: Number.NaN, kind: DIM_KINDS.op, payload: { v: 1, dim: this.#d.dim, ops: v.ok } }], undefined, state);
    }
    if (notice) notice.lost = ops.length - ok.length;
    if (ok.length === 0) return { changed: false, resync: true, notice };
    // rows that fit: one action is one row, or a group of at most DIM_ACTION_ROWS rows, or nothing at all
    const rows = packDimRows(ok);
    if (rows === null) return refuse('row-too-large');
    if (rows.length > DIM_ACTION_ROWS) return refuse('too-large');
    // EVERY ACTION THAT IS SENT CAN BE UNDONE (Aegis B3 stands: 64 inverse ops, 4 rows). One whose inverse would be
    // over the undo bound is refused here, whole, before anything is shown as kept
    if (!undo) {
      const why = this.#notUndoable(this.view(), ok);
      if (why) return refuse('not-undoable', ok.every((op) => op.type === 'delete') ? 'delete' : why);
    }
    if (!this.#enqueue(rows, gesture, undo)) return refuse('busy');
    this.#pump();
    return { changed: true, resync: notice !== null, notice };
  }

  /**
   * Undo this page's last confirmed row, on a fresh gesture. Does nothing while a batch of mine is pending. The
   * entry stays in the list until its inverse is confirmed. An entry whose inverse can never be sent (it changed
   * nothing, is over the bounds of core/dim-undo.ts, or no longer validates against the board) is dropped with one
   * notice, so the next press reaches the entry before it.
   */
  undo(gesture: Gesture | null): DimLiveResult {
    const fail = (code: string, field = 'ops', why: string | null = null, changed = false): DimLiveResult => ({ changed, resync: false, notice: { code, field, why, lost: 0 } });
    if (!gesture) return fail('not-sent', 'ops', 'gesture-missing');
    if (this.#pending().length > 0) return NONE;
    const entry = this.#undo[this.#undo.length - 1];
    if (!entry) return fail('undo-nothing');
    if (!this.#linkUp) return fail('link-down');
    // each row is inverted against the state just before THAT row: what another hand changed between two rows of
    // the action is what comes back, never an older value
    const plan = planUndo({ before: this.#d.stateAt(entry.rows[0]!.seq - 1), befores: entry.rows.map((r) => this.#d.stateAt(r.seq - 1)), rows: entry.rows.map((r) => r.ops), current: this.view(), actor: this.#d.me, mint: this.#d.mint });
    if (!plan.ok) {
      this.#undo.pop();
      return plan.code === 'invalid' ? fail('undo-invalid', plan.refusal?.field ?? 'ops', plan.refusal?.code ?? null, true) : fail(`undo-${plan.code}`, 'ops', null, true);
    }
    // an inverse that can never be sent (it fits no row, or needs more rows than one stamp carries) must not wedge
    // the list: the entry goes, with one notice, and the older ones stay reachable
    const rows = packDimRows(plan.ops);
    if (rows === null || rows.length > DIM_ACTION_ROWS) {
      this.#undo.pop();
      return fail('undo-too-large', 'ops', null, true);
    }
    return this.#local(plan.ops, gesture, entry);
  }

  /** Drop a pending batch, then make every later one hold against the new view. One notice for all of it. */
  #drop(batch: Pending, cause: { code: string; field: string; why: string | null }): DimLiveResult {
    let lost = batch.ops.length;
    if (this.#flight === batch) this.#flight = null;
    else this.#queue = this.#queue.filter((b) => b !== batch);
    if (batch.group !== null) {
      // the rest of the same action falls with it (and is never sent on that stamp)
      for (const b of this.#queue) if (b.group === batch.group) lost += b.ops.length;
      this.#queue = this.#queue.filter((b) => b.group !== batch.group);
    }
    // an inverse part of which landed cannot be planned again: the entry goes
    if (batch.undo?.partly) this.#undo = this.#undo.filter((e) => e !== batch.undo);
    const kept: Pending[] = [];
    for (const b of this.#queue) {
      const v = validateDimOps(this.#fold(kept), b.ops, this.#d.me);
      lost += b.ops.length - v.ok.length;
      if (v.ok.length === 0) continue;
      if (v.ok.length !== b.ops.length) {
        b.ops = v.ok;
        b.key = canonicalJson(v.ok);
      }
      kept.push(b);
    }
    this.#queue = kept;
    this.#pump();
    return { changed: true, resync: true, notice: { ...cause, lost } };
  }

  /** The batch is in the log. `ops` are what the row carries (null when the row itself was not kept: then nothing is offered for undo). */
  #confirm(batch: Pending, seq: number, ops: DimOp[] | null): void {
    this.#flight = null;
    if (batch.undo) {
      // the entry leaves the list when the LAST row of its inverse is in the log
      if (batch.last) this.#undo = this.#undo.filter((e) => e !== batch.undo);
      else batch.undo.partly = true;
    } else if (ops) {
      const top = this.#undo[this.#undo.length - 1];
      // the rows of one action are ONE entry
      if (batch.group !== null && top && top.group === batch.group) top.rows.push({ seq, ops });
      else {
        this.#undo.push({ group: batch.group, rows: [{ seq, ops }], partly: false });
        if (this.#undo.length > DIM_LIVE_LIMITS.undo) this.#undo.shift();
      }
    }
    this.#pump();
  }

  static #opsOf(row: DimRow): DimOp[] | null {
    return isPlainObject(row.payload) && Array.isArray(row.payload.ops) ? (row.payload.ops as DimOp[]) : null;
  }

  /** How many of the batch's ops the row does not carry. */
  static #lostIn(batch: Pending, row: DimRow): number {
    const kept = new Set((DimLive.#opsOf(row) ?? []).map((op) => canonicalJson(op)));
    return batch.ops.filter((op) => !kept.has(canonicalJson(op))).length;
  }

  /** The send of batch `id` settled. An ack for a batch that is no longer in flight (dropped, or confirmed by its row) is ignored. */
  ack(id: number, outcome: DimAck): DimLiveResult {
    const f = this.#flight;
    if (!f || f.id !== id) return NONE;
    if (!outcome.ok) {
      // sent, never answered, and a row of mine is there: the write happened; the row stands
      if (f.landed && (outcome.code === 'no-answer' || outcome.code === 'link-down')) return this.#settleFromRow(f, f.landed);
      f.landed = null;
      return this.#drop(f, { code: outcome.code, field: outcome.field ?? 'ops', why: outcome.why ?? null });
    }
    const first = outcome.refused[0];
    if (outcome.seq === null) {
      f.landed = null;
      return this.#drop(f, { code: first?.code ?? 'refused', field: first?.field ?? 'ops', why: null });
    }
    // the mod kept some ops and refused others: say so now; the row carries only what it kept
    const notice: DimNotice | null = first ? { code: first.code, field: first.field, why: null, lost: outcome.refused.length } : null;
    const partial = notice !== null;
    const seq = outcome.seq;
    const landed = f.landed && f.landed.seq === seq ? f.landed : (this.#seen.find((r) => r.seq === seq) ?? null);
    if (landed) {
      this.#confirm(f, seq, DimLive.#opsOf(landed));
      return { changed: true, resync: partial, notice };
    }
    if (seq <= this.#known) {
      // the row came first and is no longer held (more rows than the buffer keeps): it is in the log all the same.
      // With nothing refused the row carries exactly the batch's ops; otherwise its ops are not known here.
      this.#confirm(f, seq, partial ? null : f.ops);
      return { changed: true, resync: partial, notice };
    }
    // a row taken for this batch's was another one's after all: overlay again and wait for the acked row
    const was = f.landed !== null;
    f.landed = null;
    f.ackSeq = seq;
    f.ackAt = this.#d.now();
    return { changed: was || partial, resync: partial, notice };
  }

  /** No ack will come, but a row of mine did: confirm from the row and report what it does not carry. */
  #settleFromRow(f: Pending, row: DimRow): DimLiveResult {
    const lost = DimLive.#lostIn(f, row);
    this.#confirm(f, row.seq, DimLive.#opsOf(row));
    return { changed: true, resync: lost > 0, notice: lost > 0 ? { code: 'ops-refused', field: 'ops', why: 'no-ack', lost } : null };
  }

  /**
   * A row of this dimension arrived. The store may have folded it already or may fold it right after: `view()`
   * reads the confirmed state only as far as the rows told here. Rows of other dimensions are ignored.
   */
  row(row: DimRow): DimLiveResult {
    const p = row && isPlainObject(row.payload) ? row.payload : null;
    if (!p || own(p, 'dim') !== this.#d.dim || !Number.isSafeInteger(row.seq)) return NONE;
    if (row.seq > this.#known) this.#known = row.seq;
    const f = this.#flight;
    if (f) {
      if (f.ackSeq !== null) {
        if (row.seq === f.ackSeq) this.#confirm(f, row.seq, DimLive.#opsOf(row));
      } else if (!f.landed && row.kind === DIM_KINDS.op && this.#mine(p)) {
        // one send is in flight, so a row of mine is that batch's row: stop overlaying it now
        const ops = own(p, 'ops');
        if (Array.isArray(ops) && canonicalJson(ops) === f.key) this.#confirm(f, row.seq, ops as DimOp[]);
        else f.landed = row;
      } else {
        this.#seen.push(row);
        if (this.#seen.length > DIM_LIVE_LIMITS.seen) this.#seen.shift();
      }
    }
    return { changed: true, resync: false, notice: null };
  }

  /** A row stamped by the host as mine: my principal on the GUI surface, no agent, and my connection when both sides name one. Own keys only. */
  #mine(payload: Record<string, unknown>): boolean {
    const r = own(payload, 'relayedFor');
    if (!isPlainObject(r) || own(r, 'principal') !== this.#d.me.principal || own(r, 'surface') !== 'gui' || own(r, 'agent') !== undefined) return false;
    const theirs = own(r, 'connId');
    const mine = this.#d.connId;
    return typeof mine !== 'string' || mine.length === 0 || typeof theirs !== 'string' || theirs === mine;
  }

  /**
   * The caller's tick. Sends a queued batch whose turn has come, drops the in-flight batch when it has waited
   * DIM_LIVE_TIMEOUT_MS since it was sent with no ack and no row (or since its ack with no row), and, while the
   * link is down, every batch that has waited that long since it was queued. At most one notice per call.
   */
  timeout(): DimLiveResult {
    const now = this.#d.now();
    const f = this.#flight;
    const since = f ? this.#waitingSince(f) : null;
    if (f && since !== null && now - since >= DIM_LIVE_TIMEOUT_MS) {
      if (f.landed && f.ackSeq === null) return this.#settleFromRow(f, f.landed);
      // no answer at all: the mod is not answering, so what waits behind would only fall one batch at a time. The
      // whole queue goes with it, under ONE notice
      const stalled = f.ackAt === null;
      let behind = 0;
      if (stalled) {
        behind = this.#queue.reduce((n, b) => n + b.ops.length, 0);
        this.#queue = [];
      }
      const r = this.#drop(f, { code: this.#linkUp ? 'timeout' : 'link-down', field: 'ops', why: f.ackAt !== null ? 'no-row' : 'no-ack' });
      if (r.notice) r.notice.lost += behind;
      return r;
    }
    if (!this.#linkUp) {
      const stale = this.#queue.find((b) => now - b.at >= DIM_LIVE_TIMEOUT_MS);
      if (stale) {
        // with the link down nothing behind it can be sent either: they fall together, under one notice
        const lost = this.#queue.reduce((n, b) => n + b.ops.length, 0);
        this.#queue = [];
        return { changed: true, resync: true, notice: { code: 'link-down', field: 'ops', why: null, lost } };
      }
    }
    const had = this.#flight;
    this.#pump();
    return this.#flight !== had ? { changed: true, resync: false, notice: null } : NONE;
  }

  /** The kernel link went down or came back. Coming back sends what is still queued. */
  link(up: boolean): DimLiveResult {
    if (this.#linkUp === up) return NONE;
    this.#linkUp = up;
    if (up) this.#pump();
    return { changed: true, resync: false, notice: null };
  }

  /** When `timeout()` next has something to do, or null: the caller sets its one timer from this. */
  nextDeadline(): number | null {
    const f = this.#flight;
    const times: number[] = [];
    const since = f ? this.#waitingSince(f) : null;
    if (f && since !== null) times.push(since + DIM_LIVE_TIMEOUT_MS);
    else if (f) {
      /* handed over, not gone yet: no deadline of its own while the link is up */
    } else if (this.#linkUp && this.#queue.length > 0 && this.#lastSentAt !== null) times.push(this.#lastSentAt + DIM_LIVE_SEND_GAP_MS);
    if (!this.#linkUp) for (const b of this.#queue) times.push(b.at + DIM_LIVE_TIMEOUT_MS);
    return times.length > 0 ? Math.min(...times) : null;
  }
}
