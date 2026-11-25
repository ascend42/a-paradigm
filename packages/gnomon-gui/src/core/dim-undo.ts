/**
 * @symbol #gui-dim-undo
 *
 * Undo as ops (boards S1.3, draft point 6; Aegis B3). The board engine's own history is bypassed: an undo is the
 * INVERSE of a batch this page wrote, sent through the same path as any edit (a fresh gesture stamp, the one
 * sender, the mod's validator). PURE: no DOM, no timer; the id minter is injected.
 *
 *  - add inverts to delete; update to an update carrying the prior values (null for a key that was absent); move
 *    to the negated move;
 *  - delete inverts to an add with a NEW id, because an id is never reused, plus updates of every `from`, `to` and
 *    `parent` that pointed at the old id. Every later mention of the old id in the inverse is renamed too.
 *  - given the board as it stands now (`current`), the inverse is fitted to it: a re-added node carries no link to
 *    a node that has since gone (the validator would refuse the whole undo for it), a restored link to such a node
 *    becomes no link, and only a node whose `from`, `to` or `parent` STILL names the old id is re-pointed (a link
 *    someone re-pointed since is theirs and is left alone).
 *
 * B3 bounds, held by `planUndo`: inverses come only from this page's own CONFIRMED batches (the caller passes the
 * ops of rows the log returned, never pending ones); the inverse goes through `validateDimOps` against the board
 * as it stands and is refused WHOLE when any op fails, when it is over DIM_UNDO_LIMITS.ops ops, or when it undoes
 * more than DIM_UNDO_LIMITS.rows rows. Stated consequence: undoing a delete of an agent's mark re-adds it as the
 * person's own (a human may already edit any mark; the re-add is theirs).
 */
import { DIM_KINDS, DIM_LIMITS, foldDim, validateDimOps } from '@a-company/gnomon-contracts';
import type { DimActor, DimNode, DimOp, DimRefusal, DimState } from '@a-company/gnomon-contracts';

export const DIM_UNDO_LIMITS = Object.freeze({ ops: DIM_LIMITS.opsPerRow, rows: 4 });

const LINK_KEYS = ['from', 'to', 'parent'] as const;
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The state after one op, by the fold's own rules (a synthetic row with no seq, so the state's seq does not move). */
const step = (state: DimState, op: unknown): DimState => foldDim([{ seq: Number.NaN, kind: DIM_KINDS.op, payload: { v: 1, dim: state.dim ?? '', ops: [op] } }], undefined, state);

/**
 * The ops that undo `ops`, given the state they were applied to. An op that changed nothing (the fold skipped it)
 * has no inverse. `mint` gives a fresh node id for each re-added node. Result order: re-adds first (frames, then
 * marks, then arrows, so each may cite the one before), then the other inverses, last op first.
 */
export function invertDimOps(before: DimState, ops: readonly DimOp[], mint: () => string, current?: DimState): DimOp[] {
  return invertDimRows([{ before, ops }], mint, current);
}

/**
 * The inverse of several rows of ONE action, each inverted against the state just before THAT row (so a change
 * another hand made between two of the rows is what a later row's inverse restores, never an older value), with one
 * rename map across them all. Rows oldest first; the result is ordered as `invertDimOps` orders it.
 */
export function invertDimRows(rows: ReadonlyArray<{ before: DimState; ops: readonly DimOp[] }>, mint: () => string, current?: DimState): DimOp[] {
  const adds: Array<{ tier: number; op: DimOp }> = [];
  const rest: DimOp[][] = [];
  const renamed = new Map<string, string>();
  for (const row of rows) {
  let state = row.before.dim === null ? { ...row.before, dim: '' } : row.before;
  for (const op of row.ops) {
    const inv: DimOp[] = [];
    if (plain(op)) {
      if (op.type === 'add') {
        const id = plain(op.node) ? op.node.id : undefined;
        if (typeof id === 'string' && !state.nodes.has(id) && !state.gone.has(id)) inv.push({ type: 'delete', id });
      } else if (op.type === 'update') {
        const cur = typeof op.id === 'string' ? state.nodes.get(op.id) : undefined;
        if (cur && plain(op.patch)) {
          const patch: Record<string, unknown> = {};
          for (const k of Object.keys(op.patch)) {
            if (k === 'id' || k === 'kind' || k === '__proto__' || k === 'constructor' || k === 'prototype' || op.patch[k] === undefined) continue;
            const prior = own(cur.node, k);
            patch[k] = prior === undefined ? null : clone(prior);
          }
          if (Object.keys(patch).length > 0) inv.push({ type: 'update', id: op.id, patch });
        }
      } else if (op.type === 'move') {
        const ids = Array.isArray(op.ids) ? op.ids.filter((id): id is string => typeof id === 'string' && state.nodes.has(id)) : [];
        if (ids.length > 0 && Number.isSafeInteger(op.dx) && Number.isSafeInteger(op.dy)) inv.push({ type: 'move', ids, dx: -op.dx || 0, dy: -op.dy || 0 });
      } else if (op.type === 'delete') {
        const cur = typeof op.id === 'string' ? state.nodes.get(op.id) : undefined;
        if (cur) {
          const id = mint();
          renamed.set(op.id, id);
          const kind = own(cur.node, 'kind');
          adds.push({ tier: kind === 'frame' ? 0 : kind === 'arrow' ? 2 : 1, op: { type: 'add', node: { ...clone(cur.node), id } as unknown as DimNode } });
          // what pointed at it then, and still does now, points at the re-added node
          for (const [otherId, other] of (current ?? state).nodes) {
            if (otherId === op.id) continue;
            const patch: Record<string, unknown> = {};
            for (const k of LINK_KEYS) if (own(other.node, k) === op.id) patch[k] = id;
            if (Object.keys(patch).length > 0) inv.push({ type: 'update', id: otherId, patch });
          }
        }
      }
    }
    rest.push(inv);
    state = step(state, op);
  }
  }
  const name = (id: string): string => renamed.get(id) ?? id;
  const out: DimOp[] = [...adds.sort((a, b) => a.tier - b.tier).map((a) => a.op), ...rest.reverse().flat()];
  // an id that was deleted is gone for good: every mention of it becomes the re-added node's id
  const readded = new Set(renamed.values());
  const there = (id: string): boolean => !current || current.nodes.has(id) || readded.has(id);
  for (const op of out) {
    if (op.type === 'add') {
      const node = op.node as unknown as Record<string, unknown>;
      for (const k of LINK_KEYS) {
        if (typeof node[k] !== 'string') continue;
        node[k] = name(node[k] as string);
        if (!there(node[k] as string)) delete node[k];
      }
    } else if (op.type === 'update') {
      op.id = name(op.id);
      for (const k of LINK_KEYS) {
        if (typeof op.patch[k] !== 'string') continue;
        op.patch[k] = name(op.patch[k] as string);
        if (!there(op.patch[k] as string)) op.patch[k] = null;
      }
    } else if (op.type === 'move') op.ids = [...new Set(op.ids.map(name))];
    else if (op.type === 'delete') op.id = name(op.id);
  }
  return out;
}

export type UndoPlan =
  | { ok: true; ops: DimOp[] }
  /** `too-many-rows`, `too-many-ops`: over the B3 bounds. `invalid`: the validator refused an op (`refusal` is its first). `nothing`: the batch changed nothing. */
  | { ok: false; code: 'too-many-rows' | 'too-many-ops' | 'invalid' | 'nothing'; refusal?: DimRefusal };

/**
 * Plan the undo of confirmed rows. `rows` are the op lists of this page's own confirmed rows, oldest first, that
 * followed one another; `before` is the state just before the first of them; `current` is the board as it stands
 * (pending edits included). All or nothing: the plan is the whole inverse, validated, or a refusal.
 */
export function planUndo(o: { before: DimState; rows: ReadonlyArray<readonly DimOp[]>; current: DimState; actor: DimActor; mint: () => string; befores?: readonly DimState[] }): UndoPlan {
  if (o.rows.length > DIM_UNDO_LIMITS.rows) return { ok: false, code: 'too-many-rows' };
  // `befores`: the state just before EACH row (rows of other hands may lie between the rows of one action)
  const ops = o.befores && o.befores.length === o.rows.length ? invertDimRows(o.rows.map((r, i) => ({ before: o.befores![i]!, ops: r })), o.mint, o.current) : invertDimOps(o.before, o.rows.flat(), o.mint, o.current);
  if (ops.length === 0) return { ok: false, code: 'nothing' };
  if (ops.length > DIM_UNDO_LIMITS.ops) return { ok: false, code: 'too-many-ops' };
  const v = validateDimOps(o.current, ops, o.actor);
  if (v.secret || v.refused.length > 0 || v.ok.length !== ops.length) return { ok: false, code: 'invalid', ...(v.refused[0] ? { refusal: v.refused[0] } : {}) };
  return { ok: true, ops: v.ok };
}
