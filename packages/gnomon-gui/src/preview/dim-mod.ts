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
import type { DimRow, DimState } from '@a-company/gnomon-contracts';
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
  /** DEV: the next `dim.op` is answered with this refusal code instead (a test shows the roll back) */
  refuseNext: string | null = null;
  /** DEV: `dim.op` commands are held, unanswered, while true */
  silent = false;

  /** Rows already in the log (the fixture's): the mod's fold of them. */
  seed(rows: readonly DimRow[], repo = PREVIEW_DIM_REPO): void {
    const by = new Map<string, DimRow[]>();
    for (const r of rows) {
      const dim = (r.payload as { dim?: string }).dim;
      if (typeof dim === 'string') by.set(dim, [...(by.get(dim) ?? []), r]);
    }
    for (const [dim, list] of by) this.#dims.set(dim, { repo, state: S.foldDim(list) });
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
      return { ok: true, created: true, dim: a.dim, title: t.title, firstSeq: seq, seq, hash: S.dimHash(entry.state) };
    }
    if (!entry) return M.refusal('dim-unknown');
    if (entry.repo !== a.repo) return M.refusal('repo-mismatch');
    const e = entry;
    const state = e.state;
    const attached = state.attached.includes(a.hsid);
    const write = (kind: string, payload: Record<string, unknown>): number | Answer => {
      if (M.rowProblem(payload, stamp)) return M.refusal('row-too-large');
      const seq = append(kind, payload);
      e.state = M.landed(e.state, kind, payload, stamp, seq);
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
      return typeof seq === 'number' ? { ok: true, created: false, dim: a.dim, title: e.state.title, seq, hash: S.dimHash(e.state) } : seq;
    }
    if (commandId === 'dim.close') {
      if (state.ended) return { ok: true, already: true, dim: a.dim, seq: state.seq, ops: state.ops, nodes: state.nodes.size, hash: S.dimHash(state) };
      const payload = M.endPayload(state);
      const seq = write(S.DIM_KINDS.end, payload);
      return typeof seq === 'number' ? { ok: true, already: false, dim: a.dim, seq, ops: payload.ops, nodes: payload.nodes, hash: S.dimHash(e.state) } : seq;
    }
    if (state.ended) return M.refusal('dim-ended');
    if (this.refuseNext) {
      const code = this.refuseNext;
      this.refuseNext = null;
      return M.refusal(code, code === 'ops-refused' ? { refused: [{ index: 0, field: 'id', code: 'id-missing' }] } : undefined);
    }
    const v = M.apply(state, a.ops, actor, { stamp });
    if (v.tooLarge) return M.refusal('row-too-large');
    if (v.secret) return M.refusal('secret', { refused: v.refused });
    if (v.ok.length === 0) return M.refusal('ops-refused', { refused: v.refused });
    const seq = write(S.DIM_KINDS.op, M.opPayload(a.dim, v.ok));
    if (typeof seq !== 'number') return seq;
    return { ok: true, dim: a.dim, seq, applied: v.ok.length, refused: v.refused };
  }
}
