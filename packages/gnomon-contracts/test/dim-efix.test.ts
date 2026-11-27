/**
 * #contract-dim-shape, S1.4 E-fix (T-2026-11-27-006; Aegis I-1 after P5): the person's own honoured full undo puts
 * back `otherBy` and `wordsBy` (the undo marker's `prior` entries, written by the planner for the marks it undoes
 * whole), and a redo of that undo brings the sign back. Attribution stays outside the hash.
 */
import { describe, expect, it } from 'vitest';
import {
  DIM_HASH_VECTOR_HASH, DIM_HASH_VECTOR_ROWS, DIM_KINDS, DIM_UNDO_MARK_LIMITS, dimAttrDigest, dimChangeSetOf, dimHash, dimUndoMarkOf, dimUndoPriorOf, foldDim, planDimUndo,
  type DimActor, type DimBy, type DimChangeSet, type DimRow, type DimState,
} from '../src/dim.js';

const DIM = 'dim:01JVA1D0000000000000000001';
const id = (n: number): string => `01JVA1D00000000000000000${String(n).padStart(2, '0')}`;
const ACTS = (n: number): string => `01JVA1DACT00000000000000${String(n).padStart(2, '0')}`;
const HUMAN = 'p:t/human';
const human: DimActor = { cls: 'human', principal: HUMAN };
const claude: DimActor = { cls: 'agent', principal: 'p:t/session', agent: 'claude' };
const kit: DimActor = { cls: 'agent', principal: 'p:t/session', agent: 'kit' };
const handOf = (a: DimActor): DimBy => (a.cls === 'agent' ? { cls: 'agent', principal: a.principal, agent: a.agent } : { cls: 'human', principal: a.principal });

let seq = 0;
let acts = 0;
const start = (): DimRow => ({ seq: (seq = 1), kind: DIM_KINDS.start, payload: { v: 1, dim: DIM, title: 'T', attached: ['h1', 'h2'], opened: 'command', relayedFor: { principal: HUMAN, surface: 'gui', connId: 'c1' } } });
/** A person's row on the Gnomon window, with its own act. */
const person = (ops: unknown[], extra: Record<string, unknown> = {}): DimRow => ({ seq: ++seq, kind: DIM_KINDS.op, payload: { v: 1, dim: DIM, ops, act: ACTS(++acts), relayedFor: { principal: HUMAN, surface: 'gui', connId: 'c1' }, ...extra } });
/** An agent's row of turn `n` of session `hsid`. */
const agent = (a: DimActor, n: number, ops: unknown[], extra: Record<string, unknown> = {}, hsid = a === kit ? 'h2' : 'h1'): DimRow => ({
  seq: ++seq,
  kind: DIM_KINDS.op,
  payload: { v: 1, dim: DIM, ops, relayedFor: { principal: a.principal, surface: 'bridge', agent: (a as { agent: string }).agent, hsid, turn: `turn:${hsid}/${n}` }, ...extra },
});
const rect = (n: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id: id(n), kind: 'rect', x: 0, y: 0, z: 'M', w: 10, h: 10, ...extra });
let minted = 60;
const mint = (): string => id(minted++);

const same = (a: DimChangeSet | null, b: DimChangeSet): boolean => JSON.stringify(a) === JSON.stringify(b);
/**
 * Undo the change-set `of` as the mod does: plan against the rows, then land ONE row stamped as `undoer`, carrying
 * the marker with `restored` and (E-fix) `prior` from `dimUndoPriorOf`. `prior: false` writes no prior entries.
 */
function undo(log: DimRow[], of: DimChangeSet, undoer: DimActor, o: { ids?: string[]; prior?: boolean; n?: number } = {}): { row: DimRow; plan: ReturnType<typeof planDimUndo> } {
  const set = log.filter((r) => same(dimChangeSetOf(r), of));
  const first = set[0]!.seq;
  const plan = planDimUndo({
    rows: set.map((r) => ({ before: foldDim(log.filter((x) => x.seq < r.seq)), ops: (r.payload as { ops: unknown[] }).ops, seq: r.seq })),
    after: log.filter((r) => r.kind === DIM_KINDS.op && r.seq > first && !set.includes(r)),
    current: foldDim(log),
    actor: undoer,
    undoer: handOf(undoer),
    mint,
    of,
    ...(o.ids ? { ids: o.ids } : {}),
  });
  const ofKey = of.kind === 'act' ? { principal: of.principal, act: of.act } : { hsid: of.hsid, turn: of.turn };
  const prior = o.prior === false ? [] : dimUndoPriorOf(plan.prior, plan.ops);
  const marker = { of: ofKey, ...(o.ids ? { ids: o.ids } : {}), ...(plan.restored.length ? { restored: plan.restored } : {}), ...(prior.length ? { prior } : {}) };
  const row = undoer.cls === 'human' ? person(plan.ops, { undo: marker }) : agent(undoer, o.n ?? 9, plan.ops, { undo: marker });
  return { row, plan };
}
const turnOf = (hsid: string, n: number): DimChangeSet => ({ kind: 'turn', hsid, turn: `turn:${hsid}/${n}` });
const actOf = (r: DimRow): DimChangeSet => dimChangeSetOf(r)!;
const signs = (s: DimState, n: number): [unknown, unknown] => [s.nodes.get(id(n))!.otherBy, s.nodes.get(id(n))!.wordsBy];

/** The person's board: a labelled rect, a plain rect and a text. */
function board(): DimRow[] {
  seq = 0;
  acts = 0;
  return [start(), person([{ type: 'add', node: rect(1, { label: 'API', color: 'graphite' }) }, { type: 'add', node: rect(2) }, { type: 'add', node: { id: id(3), kind: 'text', x: 0, y: 0, z: 'N', text: 'my note' } }])];
}

describe('E-fix: the person\'s own honoured full undo clears otherBy and wordsBy (T-2026-11-27-006)', () => {
  it('a restyle then the person\'s undo of the turn: no countermark; the hash is the undone board\'s, the attr digest moves', () => {
    const log = board();
    const clean = foldDim(log);
    log.push(agent(claude, 1, [{ type: 'update', id: id(2), patch: { color: 'cobalt' } }, { type: 'move', ids: [id(3)], dx: 4, dy: 0 }]));
    expect(signs(foldDim(log), 2)).toEqual([handOf(claude), undefined]);
    const { row, plan } = undo(log, turnOf('h1', 1), human);
    expect(plan.prior).toEqual([[id(3), null, null], [id(2), null, null]]); // last op first
    log.push(row);
    const s = foldDim(log);
    expect(signs(s, 2)).toEqual([undefined, undefined]);
    expect(signs(s, 3)).toEqual([undefined, undefined]);
    expect([s.nodes.get(id(2))!.otherSeq, s.nodes.get(id(2))!.wordsSeq]).toEqual([undefined, undefined]);
    // outside the hash: the board hashes as it did before the turn; attribution is vouched for by the digest only
    expect(dimHash(s)).toBe(dimHash(clean));
    const kept = foldDim([...log.slice(0, -1), { ...row, payload: { ...(row.payload as object), undo: { of: { hsid: 'h1', turn: 'turn:h1/1' } } } }]);
    expect(dimHash(kept)).toBe(dimHash(s));
    expect(dimAttrDigest(kept)).not.toBe(dimAttrDigest(s));
    expect(signs(kept, 2)).toEqual([handOf(claude), undefined]); // no prior entry: the old rule (fails closed)
    // the published vector is untouched (no fold rule reaches its rows)
    expect(dimHash(foldDim(DIM_HASH_VECTOR_ROWS))).toBe(DIM_HASH_VECTOR_HASH);
  });

  it('a re-word then the person\'s undo: wordsBy and otherBy are both cleared (the words are the person\'s again)', () => {
    const log = board();
    log.push(agent(claude, 1, [{ type: 'update', id: id(1), patch: { color: 'cobalt' } }, { type: 'update', id: id(1), patch: { label: 'Gateway' } }]));
    expect(signs(foldDim(log), 1)).toEqual([handOf(claude), handOf(claude)]);
    log.push(undo(log, turnOf('h1', 1), human).row);
    const s = foldDim(log);
    expect([s.nodes.get(id(1))!.node.label, s.nodes.get(id(1))!.node.color]).toEqual(['API', 'graphite']);
    expect(signs(s, 1)).toEqual([undefined, undefined]);
  });

  it('a scoped undo (ids) clears only the marks it undid', () => {
    const log = board();
    log.push(agent(claude, 1, [{ type: 'update', id: id(1), patch: { label: 'Gateway' } }, { type: 'update', id: id(2), patch: { color: 'cobalt' } }]));
    log.push(undo(log, turnOf('h1', 1), human, { ids: [id(2)] }).row);
    const s = foldDim(log);
    expect(signs(s, 2)).toEqual([undefined, undefined]);
    expect(signs(s, 1)).toEqual([handOf(claude), handOf(claude)]);
  });

  it('skipped.changed and partial: a mark another hand changed since keeps its signs; only the marks undone whole clear', () => {
    const log = board();
    log.push(agent(claude, 1, [{ type: 'update', id: id(1), patch: { label: 'Gateway', color: 'cobalt' } }, { type: 'update', id: id(2), patch: { color: 'cobalt' } }, { type: 'update', id: id(3), patch: { text: 'claude note' } }]));
    // Kit changes id(1)'s colour (id(1) is then partial) and moves id(2) (left whole: changed since); id(3) is untouched
    log.push(agent(kit, 1, [{ type: 'update', id: id(1), patch: { color: 'lemon' } }, { type: 'update', id: id(2), patch: { color: 'lemon' } }]));
    const { row, plan } = undo(log, turnOf('h1', 1), human);
    expect(plan.skipped).toMatchObject({ changed: 1, partial: 1 });
    expect(plan.prior).toEqual([[id(3), null, null]]);
    log.push(row);
    const s = foldDim(log);
    expect(s.nodes.get(id(1))!.node.label).toBe('API'); // the words came back, but Kit's change stands
    expect(signs(s, 1)).toEqual([handOf(kit), handOf(claude)]); // fails closed: the words sign is kept (over-warns)
    expect(signs(s, 2)).toEqual([handOf(kit), undefined]);
    expect(signs(s, 3)).toEqual([undefined, undefined]);
  });

  it('two turns of one session on one mark: undoing the newer turn puts back the older turn\'s signs, never the person\'s', () => {
    const log = board();
    log.push(agent(claude, 1, [{ type: 'update', id: id(1), patch: { label: 'Gateway' } }]));
    log.push(agent(claude, 2, [{ type: 'update', id: id(1), patch: { label: 'Edge' } }]));
    log.push(undo(log, turnOf('h1', 2), human).row);
    const s = foldDim(log);
    expect(s.nodes.get(id(1))!.node.label).toBe('Gateway'); // Claude's words of turn 1
    expect(signs(s, 1)).toEqual([handOf(claude), handOf(claude)]);
  });

  it('the person\'s undo of their own change to an agent\'s mark clears the person\'s countermark there', () => {
    const log = board();
    log.push(agent(claude, 1, [{ type: 'add', node: rect(5, { label: 'claude box' }) }]));
    const mine = person([{ type: 'update', id: id(5), patch: { label: 'my box' } }]);
    log.push(mine);
    expect(signs(foldDim(log), 5)).toEqual([handOf(human), handOf(human)]);
    log.push(undo(log, actOf(mine), human).row);
    expect(signs(foldDim(log), 5)).toEqual([undefined, undefined]);
  });

  it('an agent\'s own undo of its own turn is a change by that agent: prior entries on an agent\'s row are ignored', () => {
    const log = board();
    log.push(agent(claude, 1, [{ type: 'update', id: id(1), patch: { label: 'Gateway' } }]));
    const { row, plan } = undo(log, turnOf('h1', 1), claude, { n: 2 });
    expect(plan.prior).toEqual([[id(1), null, null]]);
    expect(dimUndoMarkOf(row)!.prior).toEqual([{ id: id(1) }]); // honoured by the reader ...
    log.push(row);
    const s = foldDim(log);
    expect(s.nodes.get(id(1))!.node.label).toBe('API');
    expect(signs(s, 1)).toEqual([handOf(claude), handOf(claude)]); // ... but not by the fold: Claude's ring shows
    // the ruling's test: agent A undoes agent B's change to a person's mark, and A's ring shows
    const l2 = board();
    l2.push(agent(kit, 1, [{ type: 'update', id: id(2), patch: { color: 'cobalt' } }]));
    l2.push(undo(l2, turnOf('h2', 1), claude, { n: 1 }).row);
    expect(signs(foldDim(l2), 2)).toEqual([handOf(claude), undefined]);
  });

  it('the redo: an agent\'s undo of the person\'s undo brings the sign back; the person\'s undo of that turn clears it again; the person\'s own redo brings it back too', () => {
    const log = board();
    log.push(agent(claude, 1, [{ type: 'update', id: id(1), patch: { color: 'cobalt' } }, { type: 'update', id: id(1), patch: { label: 'Gateway' } }]));
    const u1 = undo(log, turnOf('h1', 1), human).row;
    log.push(u1);
    expect(signs(foldDim(log), 1)).toEqual([undefined, undefined]);
    // the agent undoes the person's undo (a redo of its own turn): its change again, so its signs again
    log.push(undo(log, actOf(u1), claude, { n: 3 }).row);
    let s = foldDim(log);
    expect(s.nodes.get(id(1))!.node.label).toBe('Gateway');
    expect(signs(s, 1)).toEqual([handOf(claude), handOf(claude)]);
    // the person's redo of their undo: undo of the agent's turn 3 puts the person's content back, signs cleared
    log.push(undo(log, turnOf('h1', 3), human).row);
    s = foldDim(log);
    expect(s.nodes.get(id(1))!.node.label).toBe('API');
    expect(signs(s, 1)).toEqual([undefined, undefined]);

    // the person's OWN redo (the notice's redo names the person's undo set, U3): Claude's content is back, with Claude's signs
    const l2 = board();
    l2.push(agent(claude, 1, [{ type: 'update', id: id(1), patch: { label: 'Gateway' } }]));
    const v1 = undo(l2, turnOf('h1', 1), human).row;
    l2.push(v1);
    const { row: v2, plan } = undo(l2, actOf(v1), human);
    expect(plan.prior).toEqual([[id(1), handOf(claude), handOf(claude)]]);
    l2.push(v2);
    const t = foldDim(l2);
    expect(t.nodes.get(id(1))!.node.label).toBe('Gateway');
    expect(signs(t, 1)).toEqual([handOf(claude), handOf(claude)]);
  });

  it('defence in depth: a prior entry the fold cannot check never clears (another hand\'s newest change, a row that wrote no words, another person\'s set)', () => {
    const log = board();
    log.push(agent(claude, 1, [{ type: 'update', id: id(1), patch: { label: 'Gateway' } }]));
    log.push(agent(kit, 1, [{ type: 'update', id: id(1), patch: { color: 'lemon' } }]));
    const forged = (ops: unknown[], of: Record<string, unknown>): DimRow => person(ops, { undo: { of, prior: [[id(1), null, null]] } });
    // Kit's change is the newest: an undo of Claude's turn claiming the mark whole clears nothing
    let s = foldDim([...log, forged([{ type: 'update', id: id(1), patch: { label: 'API' } }], { hsid: 'h1', turn: 'turn:h1/1' })]);
    expect(signs(s, 1)).toEqual([handOf(kit), handOf(claude)]);
    // Kit's turn undone by a row that wrote no words: otherBy clears, Claude's words sign stays
    s = foldDim([...log, forged([{ type: 'update', id: id(1), patch: { color: null } }], { hsid: 'h2', turn: 'turn:h2/1' })]);
    expect(signs(s, 1)).toEqual([undefined, handOf(claude)]);
    // another person's set: not the person's own undo
    s = foldDim([...log, forged([{ type: 'update', id: id(1), patch: { color: null } }], { principal: 'p:t/other', act: ACTS(40) })]);
    expect(signs(s, 1)).toEqual([handOf(kit), handOf(claude)]);
    // ... even where the newest change is this person's own: only their OWN act (or an agent's turn) is theirs to settle
    const l2 = board();
    l2.push(agent(claude, 1, [{ type: 'add', node: rect(5) }]));
    l2.push(person([{ type: 'update', id: id(5), patch: { color: 'cobalt' } }]));
    const other = person([{ type: 'update', id: id(5), patch: { color: null } }], { undo: { of: { principal: 'p:t/other', act: ACTS(40) }, prior: [[id(5), null, null]] } });
    expect(signs(foldDim([...l2, other]), 5)).toEqual([handOf(human), undefined]);
    // a cli row's marker is not honoured at all
    const cli = { ...forged([{ type: 'update', id: id(1), patch: { color: null } }], { hsid: 'h2', turn: 'turn:h2/1' }) };
    (cli.payload as Record<string, unknown>).relayedFor = { principal: HUMAN, surface: 'cli' };
    expect(signs(foldDim([...log, cli]), 1)).toEqual([handOf(kit), handOf(claude)]);
  });

  it('dimUndoMarkOf honours prior entries only for an update or move of the same row, three items, within the cap', () => {
    const ofTurn = { hsid: 'h1', turn: 'turn:h1/1' };
    const at = (prior: unknown, ops: unknown[] = [{ type: 'update', id: id(1), patch: { x: 1 } }, { type: 'move', ids: [id(2)], dx: 1, dy: 0 }]): DimRow => person(ops, { undo: { of: ofTurn, prior } });
    expect(dimUndoMarkOf(at([[id(1), null, handOf(claude)], [id(2), handOf(kit), null]]))!.prior).toEqual([{ id: id(1), wordsBy: handOf(claude) }, { id: id(2), otherBy: handOf(kit) }]);
    // not named by an update or move of the row, a repeat, a short or long entry, a bad id
    expect(dimUndoMarkOf(at([[id(3), null, null], [id(1), null, null], [id(1), handOf(kit), null], [id(2), null], [id(2), null, null, null], ['x', null, null], 'x']))!.prior).toEqual([{ id: id(1) }]);
    expect(dimUndoMarkOf(at([[id(1), null, null]], [{ type: 'add', node: rect(1) }]))!.prior).toEqual([]);
    // a forged hand reads as the unknown hand, never human
    expect(dimUndoMarkOf(at([[id(1), { cls: 'human', principal: 'p:t/human‮' }, null]]))!.prior[0]!.otherBy).toEqual({ cls: 'unknown', principal: 'unknown' });
    expect(dimUndoMarkOf(at('x'))).toBeNull();
    expect(dimUndoMarkOf(at(Array.from({ length: DIM_UNDO_MARK_LIMITS.prior + 1 }, () => [id(1), null, null])))).toBeNull();
  });
});
