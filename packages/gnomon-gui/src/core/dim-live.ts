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
 *
 * RULES.
 *  - One send is in flight per dimension. Edits made meanwhile queue, and queued edits coalesce into one batch of
 *    at most DIM_LIMITS.opsPerRow ops (an undo is never merged with anything).
 *  - A batch is CONFIRMED when the row with the acked seq arrives, in either order (a row that arrives before its
 *    ack is remembered by seq; a row that carries exactly the in-flight ops under my stamp confirms at once).
 *  - A refusal, or DIM_LIVE_TIMEOUT_MS with no ack and no row, DROPS the batch. Later pending batches are then
 *    validated again against the new view and lose the ops that no longer hold. The drop yields ONE notice naming
 *    the field and the code: a mark never vanishes without a line saying why.
 *  - Link down: nothing is sent and a new edit is refused with a notice (there is no offline queue in S1.3);
 *    what was pending rolls back at the timeout.
 *  - Undo (B3): only this page's own confirmed rows are kept for undo, at most DIM_LIVE_LIMITS.undo of them; the
 *    inverse is planned by core/dim-undo.ts (validated, refused whole over its bounds) and sent like any edit, on
 *    its own fresh gesture stamp.
 *
 * BOUNDS: at most DIM_LIVE_LIMITS.pending batches wait (a further edit is refused with a notice), DIM_LIVE_LIMITS.seen
 * early rows and DIM_LIVE_LIMITS.undo undo entries are remembered.
 */
import { DIM_KINDS, DIM_LIMITS, canonicalJson, foldDim, isPlainObject, validateDimOps } from '@a-company/gnomon-contracts';
import type { DimActor, DimOp, DimRow, DimState } from '@a-company/gnomon-contracts';
import { planUndo } from './dim-undo.js';
import type { Gesture } from './gesture.js';

/** How long a batch may wait for its ack and row before it is dropped. */
export const DIM_LIVE_TIMEOUT_MS = 8000;
export const DIM_LIVE_LIMITS = Object.freeze({ pending: 16, seen: 256, undo: 64 });

/** One line for the person. `field` is a DIM_FIELDS name; `code` is a validator code or one of the live codes below. */
export interface DimNotice {
  /**
   * A `DimRefusalCode`, or: `timeout` (no answer in time), `link-down`, `busy` (too many edits waiting),
   * `not-sent`, `gesture-refused`, `read-only`, `no-answer`, `refused` (the sender's codes, core/mod-command.ts),
   * `undo-nothing`, `undo-too-many-ops`, `undo-too-many-rows`, `undo-invalid`.
   */
  code: string;
  field: string;
  /** the sender's or the kernel's short word, when there is one */
  why: string | null;
  /** how many ops were not kept (the dropped batch and what fell with it) */
  lost: number;
}

/** What an event did. `changed`: `view()` or `status()` answers differently now, so the caller renders. */
export interface DimLiveResult {
  changed: boolean;
  notice: DimNotice | null;
}

/** How a send settled. `seq` is the row the mod appended (absent when it appended none); `refused` are its refusals. */
export type DimAck =
  | { ok: true; seq: number | null; refused: ReadonlyArray<{ field: string; code: string }> }
  | { ok: false; code: string; why?: string | null; field?: string };

export interface DimLiveBatch {
  id: number;
  ops: DimOp[];
  gesture: Gesture | null;
}

export interface DimLiveDeps {
  dim: string;
  /** who the page is: pending marks are drawn as this hand */
  me: DimActor & { cls: 'human' };
  /** the confirmed state at the head, or after the row at `seq` (core/dim-store.ts stateAt) */
  stateAt(seq?: number): DimState;
  /** start sending a batch; the caller reports how it settled with `ack(batch.id, …)`. Must not call back synchronously. */
  send(batch: DimLiveBatch): void;
  now(): number;
  /** a fresh node id (a ULID), for a node an undo re-adds */
  mint(): string;
}

export interface DimLiveStatus {
  /** `saved`: nothing pending. `saving`: something is pending and the link is up. `not-saved`: pending or refused while the link is down. */
  keep: 'saved' | 'saving' | 'not-saved';
  link: 'up' | 'down';
  pending: number;
  inFlight: boolean;
  canUndo: boolean;
}

interface Pending extends DimLiveBatch {
  /** when it was queued */
  at: number;
  sentAt: number | null;
  ackSeq: number | null;
  ackAt: number | null;
  undo: boolean;
  /** `canonicalJson(ops)`, for matching the row that carries them */
  key: string;
}

const NONE: DimLiveResult = Object.freeze({ changed: false, notice: null });

/** Read the relay's result for a `dim.op` into an ack. Tolerant: the result may be the mod's object or wrap it in `result`. */
export function dimAckOf(result: unknown): DimAck {
  const r = isPlainObject(result) && isPlainObject(result.result) && result.seq === undefined ? result.result : result;
  if (!isPlainObject(r)) return { ok: false, code: 'refused', why: null };
  const refused = (Array.isArray(r.refused) ? r.refused : []).filter(isPlainObject).map((x) => ({ field: typeof x.field === 'string' ? x.field : 'unknown', code: typeof x.code === 'string' ? x.code : 'refused' }));
  if (typeof r.refused === 'string') return { ok: false, code: 'refused', why: /^[a-z][a-z0-9-]{0,31}$/.test(r.refused) ? r.refused : null };
  return { ok: true, seq: Number.isSafeInteger(r.seq) ? (r.seq as number) : null, refused };
}

export class DimLive {
  readonly #d: DimLiveDeps;
  #flight: Pending | null = null;
  #queue: Pending[] = [];
  #nextId = 1;
  #linkUp = true;
  /** rows that arrived while a send had no ack yet (by reference: the store holds them too) */
  #seen: DimRow[] = [];
  /** this page's own confirmed rows, oldest first */
  #undo: Array<{ seq: number; ops: DimOp[] }> = [];

  constructor(deps: DimLiveDeps) {
    this.#d = deps;
  }

  /** The confirmed state plus `batches` folded as my rows. A synthetic row has no seq, so the state's seq stays the confirmed one. */
  #fold(batches: readonly Pending[]): DimState {
    const confirmed = this.#d.stateAt();
    if (batches.length === 0) return confirmed;
    const relayedFor = { principal: this.#d.me.principal, surface: 'gui' };
    return foldDim(batches.map((b) => ({ seq: Number.NaN, kind: DIM_KINDS.op, payload: { v: 1, dim: this.#d.dim, ops: b.ops, relayedFor } })), undefined, confirmed);
  }

  #pending(): Pending[] {
    return this.#flight ? [this.#flight, ...this.#queue] : this.#queue;
  }

  /** What the board draws now. Read-only. */
  view(): DimState {
    return this.#fold(this.#pending());
  }

  status(): DimLiveStatus {
    const pending = this.#pending().length;
    return { keep: pending === 0 ? 'saved' : this.#linkUp ? 'saving' : 'not-saved', link: this.#linkUp ? 'up' : 'down', pending, inFlight: this.#flight !== null, canUndo: this.#undo.length > 0 };
  }

  #pump(): void {
    if (this.#flight || !this.#linkUp) return;
    const next = this.#queue.shift();
    if (!next) return;
    next.sentAt = this.#d.now();
    this.#flight = next;
    this.#seen = [];
    this.#d.send({ id: next.id, ops: next.ops, gesture: next.gesture });
  }

  #enqueue(ops: DimOp[], gesture: Gesture | null, undo: boolean): boolean {
    const now = this.#d.now();
    let rest = ops;
    const last = this.#queue[this.#queue.length - 1];
    if (!undo && last && !last.undo && last.ops.length < DIM_LIMITS.opsPerRow) {
      // top up the batch that is still waiting
      const room = DIM_LIMITS.opsPerRow - last.ops.length;
      last.ops = [...last.ops, ...rest.slice(0, room)];
      last.key = canonicalJson(last.ops);
      // the newest stamp has the most life and uses left
      last.gesture = gesture;
      rest = rest.slice(room);
    }
    for (let i = 0; i < rest.length; i += DIM_LIMITS.opsPerRow) {
      if (this.#pending().length >= DIM_LIVE_LIMITS.pending) return false;
      const chunk = rest.slice(i, i + DIM_LIMITS.opsPerRow);
      this.#queue.push({ id: this.#nextId++, ops: chunk, gesture, at: now, sentAt: null, ackSeq: null, ackAt: null, undo, key: canonicalJson(chunk) });
    }
    return true;
  }

  /**
   * A person's edit. The ops are validated against the view; the ones that pass become pending (and are sent when
   * no send is in flight). Refused ops are named in the notice. `gesture` is the trusted event the edit came from:
   * the sender refuses a batch without one.
   */
  local(ops: readonly DimOp[], gesture: Gesture | null): DimLiveResult {
    return this.#local(ops, gesture, false);
  }

  #local(ops: readonly DimOp[], gesture: Gesture | null, undo: boolean): DimLiveResult {
    if (ops.length === 0) return NONE;
    if (!this.#linkUp) return { changed: false, notice: { code: 'link-down', field: 'ops', why: null, lost: ops.length } };
    let ok: DimOp[] = [];
    let notice: DimNotice | null = null;
    let state = this.view();
    // the validator takes one row's worth at a time
    for (let i = 0; i < ops.length; i += DIM_LIMITS.opsPerRow) {
      const v = validateDimOps(state, ops.slice(i, i + DIM_LIMITS.opsPerRow), this.#d.me);
      const first = v.refused[0];
      if (first && !notice) notice = { code: first.code, field: first.field, why: first.rule ?? null, lost: 0 };
      if (v.secret) {
        ok = [];
        break;
      }
      ok.push(...v.ok);
      if (i + DIM_LIMITS.opsPerRow < ops.length) state = foldDim([{ seq: Number.NaN, kind: DIM_KINDS.op, payload: { v: 1, dim: this.#d.dim, ops: v.ok } }], undefined, state);
    }
    if (notice) notice.lost = ops.length - ok.length;
    if (ok.length === 0) return { changed: false, notice };
    const before = this.#queue.map((b) => ({ b, ops: b.ops, key: b.key, gesture: b.gesture }));
    const count = this.#queue.length;
    if (!this.#enqueue(ok, gesture, undo)) {
      // all or nothing: put the queue back as it was
      this.#queue.length = count;
      for (const s of before) Object.assign(s.b, { ops: s.ops, key: s.key, gesture: s.gesture });
      return { changed: false, notice: { code: 'busy', field: 'ops', why: null, lost: ops.length } };
    }
    this.#pump();
    return { changed: true, notice };
  }

  /**
   * Undo this page's last confirmed row, on a fresh gesture. Refused whole (with a notice, and the entry kept)
   * when the inverse does not validate or is over the bounds of core/dim-undo.ts.
   */
  undo(gesture: Gesture | null): DimLiveResult {
    const entry = this.#undo[this.#undo.length - 1];
    const fail = (code: string, field = 'ops', why: string | null = null): DimLiveResult => ({ changed: false, notice: { code, field, why, lost: 0 } });
    if (!entry) return fail('undo-nothing');
    if (!this.#linkUp) return fail('link-down');
    const plan = planUndo({ before: this.#d.stateAt(entry.seq - 1), rows: [entry.ops], current: this.view(), actor: this.#d.me, mint: this.#d.mint });
    if (!plan.ok) {
      // an entry that can never be undone is not offered again
      if (plan.code === 'nothing' || plan.code === 'too-many-ops') this.#undo.pop();
      return plan.code === 'invalid' ? fail('undo-invalid', plan.refusal?.field ?? 'ops', plan.refusal?.code ?? null) : fail(`undo-${plan.code}`);
    }
    const r = this.#local(plan.ops, gesture, true);
    if (r.changed) this.#undo.pop();
    return r;
  }

  /** Drop a pending batch, then make every later one hold against the new view. One notice for all of it. */
  #drop(batch: Pending, cause: { code: string; field: string; why: string | null }): DimLiveResult {
    let lost = batch.ops.length;
    if (this.#flight === batch) this.#flight = null;
    else this.#queue = this.#queue.filter((b) => b !== batch);
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
    return { changed: true, notice: { ...cause, lost } };
  }

  #confirm(batch: Pending, row: DimRow): void {
    this.#flight = null;
    const ops = isPlainObject(row.payload) && Array.isArray(row.payload.ops) ? (row.payload.ops as DimOp[]) : null;
    if (!batch.undo && ops) {
      this.#undo.push({ seq: row.seq, ops });
      if (this.#undo.length > DIM_LIVE_LIMITS.undo) this.#undo.shift();
    }
    this.#pump();
  }

  /** The send of batch `id` settled. An ack for a batch that is no longer in flight (dropped, or confirmed by its row) is ignored. */
  ack(id: number, outcome: DimAck): DimLiveResult {
    const f = this.#flight;
    if (!f || f.id !== id) return NONE;
    if (!outcome.ok) return this.#drop(f, { code: outcome.code, field: outcome.field ?? 'ops', why: outcome.why ?? null });
    const first = outcome.refused[0];
    if (outcome.seq === null) return this.#drop(f, { code: first?.code ?? 'refused', field: first?.field ?? 'ops', why: null });
    f.ackSeq = outcome.seq;
    f.ackAt = this.#d.now();
    // the mod kept some ops and refused others: say so now; the row will carry only what it kept
    const notice: DimNotice | null = first ? { code: first.code, field: first.field, why: null, lost: outcome.refused.length } : null;
    const early = this.#seen.find((r) => r.seq === outcome.seq);
    if (early) {
      // the row came first
      this.#confirm(f, early);
      return { changed: true, notice };
    }
    return { changed: notice !== null, notice };
  }

  /** A row of this dimension arrived (the store has folded it already). Rows of other dimensions are ignored. */
  row(row: DimRow): DimLiveResult {
    const p = row && isPlainObject(row.payload) ? row.payload : null;
    if (!p || p.dim !== this.#d.dim) return NONE;
    const f = this.#flight;
    if (f) {
      if (f.ackSeq !== null) {
        if (row.seq === f.ackSeq) this.#confirm(f, row);
      } else if (row.kind === DIM_KINDS.op && this.#mine(p) && Array.isArray(p.ops) && canonicalJson(p.ops) === f.key) {
        this.#confirm(f, row);
      } else {
        this.#seen.push(row);
        if (this.#seen.length > DIM_LIVE_LIMITS.seen) this.#seen.shift();
      }
    }
    return { changed: true, notice: null };
  }

  #mine(payload: Record<string, unknown>): boolean {
    const r = payload.relayedFor;
    return isPlainObject(r) && r.principal === this.#d.me.principal && r.surface === 'gui' && r.agent === undefined;
  }

  /**
   * The caller's tick. Drops the in-flight batch when it has waited DIM_LIVE_TIMEOUT_MS since it was sent with no
   * ack and no row (or since its ack with no row), and, while the link is down, every batch that has waited that
   * long since it was queued. At most one notice per call.
   */
  timeout(): DimLiveResult {
    const now = this.#d.now();
    const f = this.#flight;
    if (f && now - (f.ackAt ?? f.sentAt ?? f.at) >= DIM_LIVE_TIMEOUT_MS) return this.#drop(f, { code: this.#linkUp ? 'timeout' : 'link-down', field: 'ops', why: f.ackAt !== null ? 'no-row' : 'no-ack' });
    if (!this.#linkUp) {
      const stale = this.#queue.find((b) => now - b.at >= DIM_LIVE_TIMEOUT_MS);
      if (stale) {
        // with the link down nothing behind it can be sent either: they fall together, under one notice
        const lost = this.#queue.reduce((n, b) => n + b.ops.length, 0);
        this.#queue = [];
        return { changed: true, notice: { code: 'link-down', field: 'ops', why: null, lost } };
      }
    }
    return NONE;
  }

  /** The kernel link went down or came back. Coming back sends what is still queued. */
  link(up: boolean): DimLiveResult {
    if (this.#linkUp === up) return NONE;
    this.#linkUp = up;
    if (up) this.#pump();
    return { changed: true, notice: null };
  }

  /** When `timeout()` next has something to do, or null: the caller sets its one timer from this. */
  nextDeadline(): number | null {
    const f = this.#flight;
    const times = [f ? (f.ackAt ?? f.sentAt ?? f.at) + DIM_LIVE_TIMEOUT_MS : null, ...(this.#linkUp ? [] : this.#queue.map((b) => b.at + DIM_LIVE_TIMEOUT_MS))].filter((t): t is number => t !== null);
    return times.length > 0 ? Math.min(...times) : null;
  }
}
