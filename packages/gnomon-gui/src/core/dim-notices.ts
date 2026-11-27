/**
 * @symbol #gui-dim-notices
 *
 * The standing notices of one open board (S1.4 E3; design board-leaf.turn_strip.notice, undo-key; Aegis G2, G6,
 * N1 to N3, U2, S3; the orchestrator's ruling that agent-on-agent sets stand too while a person has the board open).
 * PURE: no DOM, no timer, no socket; the clock is passed in.
 *
 * WHAT RAISES ONE. An agent turn that changed or removed marks of ANOTHER hand, or undid a person's change, raises
 * one notice when it ends (`ended`). Everything is counted FROM ROWS, through the contracts' readers only:
 *  - the set is `dimChangeSetOf(row)` of kind `turn` (an agent's stamp with `turn:<hsid>/<n>`);
 *  - a node it touched is another hand's when its ORIGINAL hand (`restoredFrom.by ?? by`, in the state just before
 *    the row) is not the row's hand; `changed` (update, move) and `removed` (delete) are counted apart, by node (G2);
 *  - N3: the undid lead comes ONLY from `dimUndoMarkOf(row).of` naming a person's set this page has SEEN as one
 *    (`dimActOf` of a row it followed): 'undid your change' when that act undid nothing, 'put back what you undid'
 *    when that act was itself a person's undo. Never from any row's words.
 *
 * WHAT THE MOD HOLDS. The mod pins such sets (memory only, model.mjs offerPin) and offers no read of its pins: the
 * page cannot learn which sets stand pinned, so the list here is the page's own, mirrored on the mod's rule (cap 8
 * per dimension, both kinds together; over the cap the oldest notice that is not a PERSON's goes first, else the
 * oldest: model.mjs Probe F1). A press on a notice the mod no longer holds is answered `undo-expired` or
 * `not-pinned`, and the line says so.
 *
 * THE SLOT. Newest first, FROZEN while the strip is hovered, focused or its menu is open (U2): a notice arriving
 * then never takes the slot; the slot changes only by a press, the end of a redo window, or the freeze ending.
 * A notice leaves by a press only (undo then its redo window, dismiss), or by being pushed out by a ninth (S3: no
 * `dim.seen` for that). The slot's notice after an undo stays in its six-second redo window (paused while held).
 */
import { dimActOf, dimChangeSetOf, dimUndoMarkOf, isPlainObject } from '@a-company/gnomon-contracts';
import type { DimBy, DimOp, DimRow, DimState } from '@a-company/gnomon-contracts';

/** Standing notices per dimension (the mod's UNDO_PINS). */
export const DIM_NOTICE_CAP = 8;
/** The redo window after an undo is answered (undo-key.state-notes.done). */
export const DIM_REDO_WINDOW_MS = 6000;
/** Agent sets whose rows are tallied at once (the mod's UNDO_SETS); person acts remembered for N3. */
export const DIM_NOTICE_MEMORY = Object.freeze({ sets: 32, acts: 256, ids: 64 });

export interface DimNoticeOf {
  hsid: string;
  turn: string;
}

export interface DimStandingNotice {
  /** `turn:<hsid>/<n>`: the set, as the mod names it */
  key: string;
  of: DimNoticeOf;
  /** the agent's label as the host stamped it (boardAgentName makes it a name), or null */
  agent: string | null;
  /** another of the person's marks changed / removed (counted apart, by node) */
  changed: number;
  removed: number;
  /** of OTHER hands' marks (agents', or another person's): said on the face only when none were the person's */
  otherChanged: number;
  otherRemoved: number;
  /** labels of the other agents whose marks it touched (for '<Name> changed 2 of Mika's marks') */
  others: string[];
  /** N3: it undid a person's change, or put back what a person undid */
  lead: 'undid' | 'put-back' | null;
  /** it touched a person's marks or undid a person's change (the mod's "personal" pin) */
  personal: boolean;
  /** the clock time it was raised at (hh:mm on the face) */
  at: number;
  /** the seq of its last row: the press's `base` */
  base: number;
  /** its rows so far: a press drawn from fewer rows sends nothing (the set changed) */
  rev: number;
  /** marks it added, changed, wrote into or removed (the trace), newest DIM_NOTICE_MEMORY.ids */
  ids: string[];
  /** ids it removed of the person's (cut-outs) */
  removedIds: string[];
  /** their last boxes, scene units, where the fold had one (a cut-out is drawn there) */
  removedBoxes: Array<{ node: string; x: number; y: number; width: number; height: number }>;
  /** 'standing', or 'done' in its redo window after an undo */
  state: 'standing' | 'done';
  /** done: the redo window's time left, and since when it runs (null while held) */
  left?: number;
  runningSince?: number | null;
}

interface Tally {
  key: string;
  of: DimNoticeOf;
  agent: string | null;
  mine: { changed: Set<string>; removed: Set<string> };
  other: { changed: Set<string>; removed: Set<string> };
  others: Set<string>;
  lead: 'undid' | 'put-back' | null;
  base: number;
  rev: number;
  ids: string[];
  boxes: Map<string, { x: number; y: number; width: number; height: number }>;
}

const handSame = (a: DimBy | undefined, b: DimBy): boolean => !!a && a.cls === b.cls && a.principal === b.principal && (a as { agent?: string }).agent === (b as { agent?: string }).agent;

/** The hand a row was stamped with, the fold's way (an agent stamp carries `agent`). */
function rowHand(p: Record<string, unknown>): DimBy | null {
  const r = isPlainObject(p.relayedFor) ? p.relayedFor : null;
  if (!r || typeof r.principal !== 'string') return null;
  if (typeof r.agent === 'string') return { cls: 'agent', principal: r.principal, agent: r.agent } as DimBy;
  return { cls: 'human', principal: r.principal } as DimBy;
}

/** True when a row needs the state just before it to be tallied: an agent turn's row that changes or removes marks. */
export function dimNoticeNeedsState(row: DimRow): boolean {
  const p = isPlainObject(row.payload) ? row.payload : null;
  if (!p || !Array.isArray(p.ops) || !p.ops.some((o) => isPlainObject(o) && o.type !== 'add')) return false;
  return dimChangeSetOf(row)?.kind === 'turn';
}

export class DimNotices {
  readonly #me: string;
  readonly #tallies = new Map<string, Tally>();
  /** person acts seen: key `principal\0act` → whether that act was itself an undo (its marker named a set) */
  readonly #acts = new Map<string, { wasUndo: boolean }>();
  /** turn → the act of this person's undo of it (U3: redo's target) */
  readonly #undoActs = new Map<string, string>();
  /** standing notices, OLDEST first */
  #list: DimStandingNotice[] = [];
  #slot: string | null = null;
  #frozen = false;

  constructor(o: { me: string }) {
    this.#me = o.me;
  }

  /**
   * One op row of this board, with the state just before it. Tallies an agent turn's touches; remembers a person's
   * act. Rows of a set that already raised its notice still count (the turn ran on): the notice's counts follow.
   */
  row(row: DimRow, before: DimState | null): void {
    const p = isPlainObject(row.payload) ? row.payload : null;
    if (!p || !Array.isArray(p.ops)) return;
    const act = dimActOf(row);
    const mark = Object.prototype.hasOwnProperty.call(p, 'undo') ? dimUndoMarkOf(row) : null;
    if (act) {
      // U3: the person's own undo of a turn is what that notice's redo names
      if (mark && mark.of.kind === 'turn' && act.principal === this.#me) {
        this.#undoActs.set(mark.of.turn, act.act);
        while (this.#undoActs.size > DIM_NOTICE_MEMORY.sets) this.#undoActs.delete(this.#undoActs.keys().next().value as string);
      }
      const k = `${act.principal}\u0000${act.act}`;
      if (!this.#acts.has(k)) this.#acts.set(k, { wasUndo: mark !== null });
      while (this.#acts.size > DIM_NOTICE_MEMORY.acts) this.#acts.delete(this.#acts.keys().next().value as string);
      return;
    }
    const cs = dimChangeSetOf(row);
    if (!cs || cs.kind !== 'turn') return;
    const hand = rowHand(p);
    if (!hand) return;
    let t = this.#tallies.get(cs.turn);
    if (!t) {
      const r = p.relayedFor as Record<string, unknown>;
      t = { key: cs.turn, of: { hsid: cs.hsid, turn: cs.turn }, agent: typeof r.agent === 'string' ? r.agent : null, mine: { changed: new Set(), removed: new Set() }, other: { changed: new Set(), removed: new Set() }, others: new Set(), lead: null, base: row.seq, rev: 0, ids: [], boxes: new Map() };
      this.#tallies.set(cs.turn, t);
      while (this.#tallies.size > DIM_NOTICE_MEMORY.sets) this.#tallies.delete(this.#tallies.keys().next().value as string);
    }
    t.base = row.seq;
    t.rev += 1;
    // N3: the lead only from a marker whose `of` is a person's set this page saw
    if (mark && mark.of.kind === 'act') {
      const seen = this.#acts.get(`${mark.of.principal}\u0000${mark.of.act}`);
      if (seen) t.lead = seen.wasUndo ? 'put-back' : t.lead === 'put-back' ? 'put-back' : 'undid';
    }
    const note = (id: string): void => {
      t!.ids = [...t!.ids.filter((x) => x !== id), id].slice(-DIM_NOTICE_MEMORY.ids);
    };
    for (const raw of p.ops as unknown[]) {
      if (!isPlainObject(raw)) continue;
      const op = raw as unknown as DimOp;
      if (op.type === 'add') {
        if (isPlainObject(op.node) && typeof op.node.id === 'string') note(op.node.id);
        continue;
      }
      const ids = op.type === 'move' ? op.ids : op.type === 'update' || op.type === 'delete' ? [op.id] : [];
      for (const id of ids) {
        if (typeof id !== 'string') continue;
        const n = before?.nodes.get(id);
        if (!n) continue;
        note(id);
        const original = n.restoredFrom?.by ?? n.by;
        if (handSame(original, hand)) continue;
        const person = original.cls === 'human' && original.principal === this.#me;
        const bucket = person ? t.mine : t.other;
        if (op.type === 'delete') {
          bucket.changed.delete(id);
          bucket.removed.add(id);
          const nd = n.node as { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
          if (person && [nd.x, nd.y, nd.w, nd.h].every((v) => typeof v === 'number' && Number.isFinite(v))) t.boxes.set(id, { x: nd.x as number, y: nd.y as number, width: nd.w as number, height: nd.h as number });
        } else if (!bucket.removed.has(id)) bucket.changed.add(id);
        if (!person) {
          const label = (original as { agent?: unknown }).agent;
          t.others.add(typeof label === 'string' ? label : '');
        }
      }
    }
    // a notice already standing for this set follows its rows
    const n = this.#list.find((x) => x.key === t!.key);
    if (n) Object.assign(n, this.#face(t));
  }

  #face(t: Tally): Pick<DimStandingNotice, 'changed' | 'removed' | 'otherChanged' | 'otherRemoved' | 'others' | 'lead' | 'personal' | 'base' | 'rev' | 'ids' | 'removedIds' | 'removedBoxes'> {
    return {
      changed: t.mine.changed.size,
      removed: t.mine.removed.size,
      otherChanged: t.other.changed.size,
      otherRemoved: t.other.removed.size,
      others: [...t.others],
      lead: t.lead,
      personal: t.lead !== null || t.mine.changed.size + t.mine.removed.size > 0,
      base: t.base,
      rev: t.rev,
      ids: [...t.ids],
      removedIds: [...t.mine.removed],
      removedBoxes: [...t.mine.removed].flatMap((id) => (t.boxes.has(id) ? [{ node: id, ...t.boxes.get(id)! }] : [])),
    };
  }

  /**
   * The turn `turn` ended (its `turn.result` row). Raises its notice when it touched another hand's marks or undid a
   * person's change. Returns the notice raised and the one a ninth pushed out (said once, N2; never a `dim.seen`).
   */
  ended(turn: string, now: number): { raised: DimStandingNotice | null; pushedOut: DimStandingNotice | null } {
    const t = this.#tallies.get(turn);
    if (!t || this.#list.some((x) => x.key === turn)) return { raised: null, pushedOut: null };
    const face = this.#face(t);
    if (face.lead === null && face.changed + face.removed + face.otherChanged + face.otherRemoved === 0) return { raised: null, pushedOut: null };
    const n: DimStandingNotice = { key: t.key, of: t.of, agent: t.agent, at: now, state: 'standing', ...face };
    this.#list.push(n);
    let pushedOut: DimStandingNotice | null = null;
    if (this.#list.length > DIM_NOTICE_CAP) {
      // the mod's rule (Probe F1): the oldest that is not a person's goes first; else the oldest
      let i = this.#list.findIndex((x) => !x.personal);
      if (i < 0) i = 0;
      pushedOut = this.#list.splice(i, 1)[0]!;
      if (this.#slot === pushedOut.key) this.#slot = null;
    }
    if (!this.#frozen || this.#slot === null) this.#slot = this.#newest();
    return { raised: n, pushedOut };
  }

  #newest(): string | null {
    for (let i = this.#list.length - 1; i >= 0; i--) if (this.#list[i]!.state === 'standing' || this.#list[i]!.key === this.#slot) return this.#list[i]!.key;
    return null;
  }

  /** U2: the strip is hovered, focused or its menu open. Ending the freeze shows the newest, unless a redo window holds the slot. */
  freeze(on: boolean): void {
    this.#frozen = on;
    if (!on && this.shown()?.state !== 'done') this.#slot = this.#newest();
  }

  get frozen(): boolean {
    return this.#frozen;
  }

  /** The notice in the slot, or null (the you row shows). */
  shown(): DimStandingNotice | null {
    return this.#list.find((x) => x.key === this.#slot) ?? null;
  }

  /** Every standing notice, NEWEST first (the slot's included). */
  list(): readonly DimStandingNotice[] {
    return [...this.#list].reverse();
  }

  /** The notices behind the shown one, newest first (the +k menu's rows). */
  behind(): DimStandingNotice[] {
    return this.list().filter((x) => x.key !== this.#slot && x.state === 'standing');
  }

  get(key: string): DimStandingNotice | null {
    return this.#list.find((x) => x.key === key) ?? null;
  }

  /** A +k menu row's words were pressed: that notice takes the slot (the shown one goes back behind, still standing). */
  bring(key: string): boolean {
    const n = this.get(key);
    if (!n || n.state !== 'standing') return false;
    this.#slot = key;
    return true;
  }

  /** The undo of `key` was answered ok and whole: its redo window starts (in the slot when it was shown). */
  undone(key: string, now: number): void {
    const n = this.get(key);
    if (!n) return;
    n.state = 'done';
    n.left = DIM_REDO_WINDOW_MS;
    n.runningSince = now;
    // undone from the menu: it leaves at once (its redo window is the slot's alone)
    if (this.#slot !== key) this.remove(key);
  }

  /** The redo window is held (hovered or focused) or let go. */
  holdDone(held: boolean, now: number): void {
    const n = this.shown();
    if (!n || n.state !== 'done') return;
    if (held && n.runningSince !== null && n.runningSince !== undefined) {
      n.left = Math.max(0, (n.left ?? 0) - (now - n.runningSince));
      n.runningSince = null;
    } else if (!held && n.runningSince === null) n.runningSince = now;
  }

  /** When the shown redo window ends (clock time), or null while held or none runs. */
  doneDeadline(): number | null {
    const n = this.shown();
    return n && n.state === 'done' && typeof n.runningSince === 'number' ? n.runningSince + (n.left ?? 0) : null;
  }

  /** The clock moved: a redo window that ran out gives way. True when the slot changed. */
  tick(now: number): boolean {
    const at = this.doneDeadline();
    if (at === null || now < at) return false;
    this.remove(this.#slot!);
    return true;
  }

  /** A notice leaves (dismissed, redone, nothing left to undo, too old). The slot shows the newest standing. */
  remove(key: string): void {
    const was = this.#slot === key;
    this.#list = this.#list.filter((x) => x.key !== key);
    if (was) this.#slot = this.#newest();
  }

  /** Every notice is forgotten (the log was replaced). */
  clear(): void {
    this.#list = [];
    this.#slot = null;
    this.#tallies.clear();
    this.#acts.clear();
    this.#undoActs.clear();
  }

  /** The newest standing notice whose set touched `id` (the mark row; N1 keeps a pushed-out set's marks reachable through `held`). */
  forMark(id: string): DimStandingNotice | null {
    return this.list().find((x) => x.state === 'standing' && x.ids.includes(id)) ?? null;
  }

  /** U3: the act of this person's undo of the set `key`, from its rows, or null (not arrived yet) */
  undoActOf(key: string): string | null {
    return this.#undoActs.get(key) ?? null;
  }

  /** The tally of a set (standing or not): what a mark row names for a pushed-out set (N1). */
  held(turn: string): Pick<DimStandingNotice, 'key' | 'of' | 'agent' | 'base' | 'rev' | 'ids'> | null {
    const t = this.#tallies.get(turn);
    return t ? { key: t.key, of: t.of, agent: t.agent, base: t.base, rev: t.rev, ids: [...t.ids] } : null;
  }
}
