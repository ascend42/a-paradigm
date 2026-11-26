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
 * person's own (a human may already edit any mark; the re-add is theirs). The mod's undo of a change-set (S1.4 E1)
 * reverses this for its rows: `planDimUndo` records the original hand in the row's `restored` marker (Aegis G5).
 *
 * The inverse itself is the shared contracts algorithm (`dimInvertRows`, S1.4 E0); this file keeps the page's B3
 * bounds and its all-or-nothing validation for Cmd+Z unchanged.
 */
import { DIM_LIMITS, dimInvertRows, validateDimOps } from '@a-company/gnomon-contracts';
import type { DimActor, DimOp, DimRefusal, DimState } from '@a-company/gnomon-contracts';

export const DIM_UNDO_LIMITS = Object.freeze({ ops: DIM_LIMITS.opsPerRow, rows: 4 });

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
 * rename map across them all. Rows oldest first; the result is ordered as `invertDimOps` orders it. The algorithm is
 * the shared one in contracts (`dimInvertRows`, S1.4 E0), which `planDimUndo` builds on for the mod's undo.
 */
export function invertDimRows(rows: ReadonlyArray<{ before: DimState; ops: readonly DimOp[] }>, mint: () => string, current?: DimState): DimOp[] {
  return dimInvertRows(rows, mint, current);
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
