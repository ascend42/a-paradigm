/**
 * @symbol #gui-preview
 *
 * DEV ONLY: the dimension mod as the preview's fake kernel answers it (boards S1.3 pass P4a). The checks, the row
 * and the fold are the mod's REAL logic: `packages/gnomon-mods/dimension/model.mjs` (pure, and with it the mod's
 * own built copy of `dim-shape:v1`) is bundled into the PREVIEW app.js only, never into the served bundle
 * (test/preview.test.ts). What is restated here, and so a STAND-IN, is the short command flow of the mod's
 * `index.mjs` (which is a process on stdin and stdout and cannot be imported): open, attach, op, close, in that
 * file's order, with no keyframes, no state store and no cold read. The host around it (the gesture check, the
 * stamp, `hsid` and `repo`) is the fake kernel's.
 */
import { DIM_KINDS, dimAttrDigest, dimChangeSetOf, dimMayDraw, emptyDimGrants, foldDim, planDimUndo } from '@a-company/gnomon-contracts';
import type { DimChangeSet, DimOp, DimRow, DimState } from '@a-company/gnomon-contracts';
import { mintDimNodeId } from '../core/dim-session.js';
// @ts-ignore the mod's own plain .mjs (no types): bundled into the preview only
import * as model from '../../../gnomon-mods/dimension/model.mjs';
// @ts-ignore the mod's built copy of the contract
import * as shape from '../../../gnomon-mods/dimension/dim-shape.mjs';

type Answer = Record<string, unknown>;
interface Model {
  actorOf(r: unknown): { cls: 'human'; principal: string } | null;
  stampOf(r: unknown): Record<string, string>;
  readArgs(commandId: string, args: unknown): { code?: string; args?: { dim: string; hsid: string; repo: string; opened?: string; title?: unknown; fromSession?: boolean; ops?: unknown } };
  refusal(code: string, extra?: Record<string, unknown>): Answer;
  titleFor(title: unknown, fromSession: boolean | undefined): { title?: string; problem?: string };
  rowProblem(payload: unknown, stamp: unknown): string | null;
  rowBytes(payload: unknown, stamp: unknown): number | null;
  CALL_ROWS: number;
  CALL_BYTES: number;
  apply(state: DimState, ops: unknown, actor: unknown, opts: { stamp: unknown }): { ok: unknown[]; refused: unknown[]; secret: boolean; tooLarge: boolean };
  landed(state: DimState, kind: string, payload: unknown, stamp: unknown, seq: number): DimState;
  startPayload(dim: string, hsid: string, opened: unknown, title?: string): Record<string, unknown>;
  attachPayload(dim: string, hsid: string): Record<string, unknown>;
  endPayload(state: DimState): Record<string, unknown>;
  opPayload(dim: string, ok: unknown[]): Record<string, unknown>;
  ATTACH_CAP: number;
}
const M = model as unknown as Model;
const S = shape as unknown as { DIM_KINDS: { start: string; attach: string; op: string; end: string }; dimHash(s: DimState): string; emptyDimState(dim: string): DimState; foldDim(rows: readonly DimRow[]): DimState };

export const PREVIEW_DIM_REPO = 'repo:0123456789abcdef';

export class PreviewDimMod {
  readonly #dims = new Map<string, { repo: string; state: DimState }>();
  /** S1.4 E3 stand-in of the mod's undo history: each dimension's op rows with the state just before each (newest 512) */
  readonly #hist = new Map<string, Array<{ row: DimRow; before: DimState }>>();
  #note(dim: string, row: DimRow, before: DimState): void {
    const list = this.#hist.get(dim) ?? [];
    list.push({ row, before });
    if (list.length > 512) list.shift();
    this.#hist.set(dim, list);
  }
  /** DEV: an agent's row written as the bridge would (the fixture's agents); folded here and noted for undo */
  landedElsewhere(row: DimRow): void {
    const dim = (row.payload as { dim?: string }).dim;
    const e = typeof dim === 'string' ? this.#dims.get(dim) : undefined;
    if (!e || row.kind !== DIM_KINDS.op) return;
    const before = e.state;
    e.state = foldDim([row], undefined, before);
    this.#note(dim!, row, before);
  }
  /** DEV: the next `dim.op` is answered with this refusal code instead (a test shows the roll back) */
  refuseNext: string | null = null;
  /** DEV: `dim.op` commands are held, unanswered, while true */
  silent = false;
  /**
   * DEV (boards S1.3 P4b-3): while true the fake kernel keeps each `dim.op` waiting (fake-kernel.ts) until
   * `release()` runs them in the order they came: a mark that is drawn and NOT YET STORED, for as long as a test needs.
   */
  holding = false;
  readonly waiting: Array<() => void> = [];
  release(): number {
    this.holding = false;
    const n = this.waiting.length;
    for (const run of this.waiting.splice(0)) run();
    return n;
  }
  /**
   * DEV (boards S1.3 P4b-3): the next `dim.open` that succeeds answers a hash that is NOT its fold's, once: the page
   * must then hold the board still (out of date). This is the stand-in mod lying; the page's own check is untouched,
   * and nothing of this file is in the served bundle (test/board-app.test.ts holds that).
   */
  wrongHashNext = false;

  /** Rows already in the log (the fixture's): the mod's fold of them. */
  seed(rows: readonly DimRow[], repo = PREVIEW_DIM_REPO): void {
    const by = new Map<string, DimRow[]>();
    for (const r of rows) {
      const dim = (r.payload as { dim?: string }).dim;
      if (typeof dim === 'string') by.set(dim, [...(by.get(dim) ?? []), r]);
    }
    for (const [dim, list] of by) {
      let st: DimState | undefined;
      for (const r of list) {
        const before: DimState = st ?? S.emptyDimState(dim);
        st = foldDim([r], undefined, st);
        if (r.kind === DIM_KINDS.op) this.#note(dim, r, before);
      }
      this.#dims.set(dim, { repo, state: S.foldDim(list) });
    }
  }

  hash(dim: string): string | null {
    const e = this.#dims.get(dim);
    return e ? S.dimHash(e.state) : null;
  }

  /**
   * One command, as index.mjs runs it. `append` writes the row to the log with the host's stamp and answers its
   * seq. `args` are what the host composed (the gesture stripped, `hsid` and `repo` set by the host).
   */
  run(commandId: string, args: Record<string, unknown>, relayedFor: Record<string, unknown>, append: (kind: string, payload: Record<string, unknown>) => number): Answer {
    const r = this.#run(commandId, args, relayedFor, append);
    if (this.wrongHashNext && commandId === 'dim.open' && r.ok === true && typeof r.hash === 'string') {
      this.wrongHashNext = false;
      return { ...r, hash: `sha256:${'0'.repeat(64)}` };
    }
    return r;
  }

  #run(commandId: string, args: Record<string, unknown>, relayedFor: Record<string, unknown>, append: (kind: string, payload: Record<string, unknown>) => number): Answer {
    const actor = M.actorOf(relayedFor);
    if (!actor) return M.refusal('not-human-gui');
    const read = M.readArgs(commandId, args);
    if (!read.args) return M.refusal(read.code ?? 'args-bad');
    const a = read.args;
    const stamp = M.stampOf(relayedFor);
    let entry = this.#dims.get(a.dim);
    if (commandId === 'dim.open' && !entry) {
      const t = M.titleFor(a.title, a.fromSession);
      if (t.problem) return M.refusal(t.problem);
      const payload = M.startPayload(a.dim, a.hsid, a.opened, t.title);
      if (M.rowProblem(payload, stamp)) return M.refusal('row-too-large');
      const seq = append(S.DIM_KINDS.start, payload);
      entry = { repo: a.repo, state: M.landed(S.emptyDimState(a.dim), S.DIM_KINDS.start, payload, stamp, seq) };
      this.#dims.set(a.dim, entry);
      return { ok: true, created: true, dim: a.dim, title: t.title, firstSeq: seq, seq, hash: S.dimHash(entry.state), ...this.#answerOf(entry.state) };
    }
    if (!entry) return M.refusal('dim-unknown');
    if (entry.repo !== a.repo) return M.refusal('repo-mismatch');
    const e = entry;
    const state = e.state;
    const attached = state.attached.includes(a.hsid);
    const write = (kind: string, payload: Record<string, unknown>): number | Answer => {
      if (M.rowProblem(payload, stamp)) return M.refusal('row-too-large');
      const seq = append(kind, payload);
      const before = e.state;
      e.state = M.landed(e.state, kind, payload, stamp, seq);
      if (kind === S.DIM_KINDS.op) this.#note(a.dim, { seq, kind, payload: { ...payload, relayedFor: stamp } }, before);
      return seq;
    };
    if (commandId === 'dim.attach') {
      if (attached) return { ok: true, already: true, dim: a.dim, seq: state.seq };
      if (state.attached.length >= M.ATTACH_CAP) return M.refusal('attach-cap');
      const seq = write(S.DIM_KINDS.attach, M.attachPayload(a.dim, a.hsid));
      return typeof seq === 'number' ? { ok: true, already: false, dim: a.dim, seq } : seq;
    }
    if (!attached) return M.refusal('not-attached');
    if (commandId === 'dim.open') {
      const seq = write(S.DIM_KINDS.start, M.startPayload(a.dim, a.hsid, a.opened));
      return typeof seq === 'number' ? { ok: true, created: false, dim: a.dim, title: e.state.title, seq, hash: S.dimHash(e.state), ...this.#answerOf(e.state) } : seq;
    }
    if (commandId === 'dim.close') {
      if (state.ended) return { ok: true, already: true, dim: a.dim, seq: state.seq, ops: state.ops, nodes: state.nodes.size, hash: S.dimHash(state) };
      const payload = M.endPayload(state);
      const seq = write(S.DIM_KINDS.end, payload);
      return typeof seq === 'number' ? { ok: true, already: false, dim: a.dim, seq, ops: payload.ops, nodes: payload.nodes, hash: S.dimHash(e.state) } : seq;
    }
    // S1.4 E3 stand-in of index.mjs dim.check: the hash point, no write (this stand-in keeps no pins: [])
    if (commandId === 'dim.check') return { ok: true, dim: a.dim, seq: state.seq, hash: S.dimHash(state), ...this.#answerOf(state) };
    if (state.ended) return M.refusal('dim-ended');
    // S1.4 E3 stand-in: no pins are kept here, so a dismiss always releases
    if (commandId === 'dim.seen') return { ok: true, dim: a.dim, released: true };
    if (commandId === 'dim.undo') return this.#undo(a as never, e, write, actor, stamp);
    if (this.refuseNext) {
      const code = this.refuseNext;
      this.refuseNext = null;
      return M.refusal(code, code === 'ops-refused' ? { refused: [{ index: 0, field: 'id', code: 'id-missing' }] } : undefined);
    }
    const v = M.apply(state, a.ops, actor, { stamp });
    if (v.tooLarge) return M.refusal('row-too-large');
    if (v.secret) return M.refusal('secret', { refused: v.refused });
    if (v.ok.length === 0) return M.refusal('ops-refused', { refused: v.refused });
    const act = (a as { act?: string }).act;
    const seq = write(S.DIM_KINDS.op, { ...M.opPayload(a.dim, v.ok), ...(act ? { act } : {}) });
    if (typeof seq !== 'number') return seq;
    return { ok: true, dim: a.dim, seq, applied: v.ok.length, refused: v.refused };
  }

  /** what index.mjs answers beside the hash: the attribution digest, the grant map (no grant rows here: the shared default) and the pins */
  #answerOf(state: DimState): Record<string, unknown> {
    return { attr: dimAttrDigest(state), grants: state.attached.map((hsid) => ({ hsid, write: dimMayDraw(state, emptyDimGrants(), hsid) })), pins: [] };
  }

  /**
   * STAND-IN of index.mjs `dim.undo` (S1.4 E1): the set's rows from the noted history, `planDimUndo` as the person,
   * packed into rows each carrying a fresh act and the `undo` marker with its `restored` entries (G5). No pins, no
   * continuation memory, no keyframes: a set not in the history is `undo-expired`.
   */
  #undo(a: { dim: string; of: DimChangeSet; ids?: string[] }, e: { state: DimState }, write: (kind: string, payload: Record<string, unknown>) => number | Answer, actor: { cls: 'human'; principal: string }, stamp: Record<string, string>): Answer {
    const hist = this.#hist.get(a.dim) ?? [];
    const same = (cs: DimChangeSet | null): boolean => !!cs && cs.kind === a.of.kind && (cs.kind === 'act' ? cs.principal === (a.of as { principal: string }).principal && cs.act === (a.of as { act: string }).act : cs.turn === (a.of as { turn: string }).turn);
    const mine = hist.filter((h) => same(dimChangeSetOf(h.row)));
    if (mine.length === 0) return M.refusal('undo-expired');
    const first = mine[0]!.row.seq;
    const plan = planDimUndo({
      rows: mine.map((h) => ({ before: h.before, ops: (h.row.payload as { ops: unknown[] }).ops, seq: h.row.seq })),
      after: hist.filter((h) => h.row.seq > first && !mine.includes(h)).map((h) => h.row),
      current: e.state,
      actor,
      mint: mintDimNodeId,
      of: a.of,
      undoer: { cls: 'human', principal: actor.principal } as never,
      ...(a.ids ? { ids: a.ids } : {}),
    });
    if (plan.ops.length === 0) return M.refusal('undo-nothing', { skipped: plan.skipped });
    const act = mintDimNodeId();
    const of = a.of.kind === 'act' ? { principal: a.of.principal, act: a.of.act } : { hsid: a.of.hsid, turn: a.of.turn };
    const payloadOf = (ops: DimOp[]): Record<string, unknown> => {
      const adds = new Set(ops.flatMap((o) => (o.type === 'add' ? [(o.node as { id: string }).id] : [])));
      const restored = plan.restored.filter((r) => adds.has(r[0]));
      return { ...M.opPayload(a.dim, ops), act, undo: { of, ...(a.ids ? { ids: a.ids } : {}), ...(restored.length ? { restored } : {}) } };
    };
    // as index.mjs undoCore packs: op by op, each row measured WITH its marker, at most CALL_ROWS rows inside
    // CALL_BYTES; what does not fit is left for the next press (`more`). An op that fits no row alone is refused.
    const rows: DimOp[][] = [];
    let cur: DimOp[] = [];
    let used = 0;
    let curBytes = 0;
    let i = 0;
    let unfit = 0;
    while (i < plan.ops.length) {
      const op = plan.ops[i]!;
      const b = M.rowBytes(payloadOf([...cur, op]), stamp);
      if (b !== null && used + b <= M.CALL_BYTES) {
        cur.push(op);
        curBytes = b;
        i++;
        continue;
      }
      if (cur.length === 0) {
        unfit++;
        i++;
        continue;
      }
      if (rows.length + 1 >= M.CALL_ROWS) break;
      rows.push(cur);
      used += curBytes;
      cur = [];
      curBytes = 0;
    }
    if (cur.length > 0) rows.push(cur);
    if (rows.length === 0) return M.refusal(unfit > 0 ? 'undo-nothing' : 'row-too-large');
    for (const ops of rows) {
      const seq = write(S.DIM_KINDS.op, payloadOf(ops));
      if (typeof seq !== 'number') return seq;
    }
    const more = plan.more || i < plan.ops.length;
    void stamp;
    return { ok: true, dim: a.dim, seq: e.state.seq, hash: S.dimHash(e.state), applied: rows.flat().length, skipped: { ...plan.skipped, refused: plan.skipped.refused + unfit }, ...(more ? { more: true } : {}) };
  }
}
