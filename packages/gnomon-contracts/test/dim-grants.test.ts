/**
 * #contract-dim-shape, S1.4 P0: the two auxiliary kinds and the ONE write-grant fold (Aegis S1.4 M4, M9, F1).
 * The effective grant of an hsid is its last HONOURED grant row, else the default (first attached on, later
 * attached off). A grant row is honoured only when its host-written `relayedFor` has `surface: 'gui'` and no agent.
 * Review of S1.4 P0 (Aegis N6): an unknown `v` fails closed, a redelivered older row changes nothing, and nothing
 * is folded for a `dim` that is not a dimension id.
 */
import { describe, expect, it } from 'vitest';
import {
  DIM_AUX_KINDS, DIM_HASH_VECTOR_HASH, DIM_HASH_VECTOR_ROWS, DIM_KINDS,
  dimGrantDefault, dimHash, dimMayDraw, emptyDimGrants, foldDim, foldDimGrants, type DimRow,
} from '../src/dim.js';
import { CLIENT_API_DESCRIPTOR } from '../src/client-api.js';

const DIM = 'dim:01JVA1D0000000000000000001';
const OTHER = 'dim:01JVA1D0000000000000000002';
const [A, B, C] = ['hsid-a', 'hsid-b', 'hsid-c'];
const gui = { principal: 'p:t/human', connId: 'conn:01JVA1D0000000000000000009', surface: 'gui' };
const state = foldDim([
  { seq: 1, kind: DIM_KINDS.start, payload: { v: 1, dim: DIM, title: 'T', attached: [A], opened: 'command', relayedFor: gui } },
  { seq: 2, kind: DIM_KINDS.attach, payload: { v: 1, dim: DIM, hsid: B, relayedFor: gui } },
]);
let seq = 10;
/** no `relayedFor` key at all */
const NONE = Symbol('unstamped');
const grant = (hsid: unknown, write: unknown, relayedFor: unknown = gui, extra: Record<string, unknown> = {}): DimRow => ({
  seq: seq++,
  kind: DIM_AUX_KINDS.grant,
  payload: { v: 1, dim: DIM, hsid, write, ...(relayedFor === NONE ? {} : { relayedFor }), ...extra },
});
const may = (rows: DimRow[], hsid: string): boolean => dimMayDraw(state, foldDimGrants(rows, DIM), hsid);

describe('DIM_AUX_KINDS', () => {
  it('the two names are fixed, frozen, and outside DIM_KINDS and the client API descriptor', () => {
    expect(DIM_AUX_KINDS).toEqual({ grant: 'modns.gnomon.dimension.grant', drawRefused: 'modns.gnomon.dimension.draw.refused' });
    expect(Object.isFrozen(DIM_AUX_KINDS)).toBe(true);
    for (const k of Object.values(DIM_AUX_KINDS)) expect(Object.values(DIM_KINDS) as string[]).not.toContain(k);
    const descriptor = JSON.stringify(CLIENT_API_DESCRIPTOR);
    for (const k of Object.values(DIM_AUX_KINDS)) expect(descriptor.includes(k)).toBe(false);
    for (const word of ['draw.refused', 'dimension.grant', 'freeStringsPerNode', 'stringsPerBatch']) expect(descriptor.includes(word)).toBe(false);
  });

  it('the published fold ignores both kinds: state, hash and counters do not move', () => {
    const base = foldDim(DIM_HASH_VECTOR_ROWS);
    const vdim = 'dim:01JD1MVECT0R00000000000001';
    const withAux = foldDim([
      ...DIM_HASH_VECTOR_ROWS,
      { seq: 8, kind: DIM_AUX_KINDS.grant, payload: { v: 1, dim: vdim, hsid: 'hsid-vector', write: false, relayedFor: gui } },
      { seq: 9, kind: DIM_AUX_KINDS.drawRefused, payload: { v: 1, dim: vdim, n: 2, by: { 'text|secret': 2 } } },
    ]);
    expect(dimHash(withAux)).toBe(DIM_HASH_VECTOR_HASH);
    expect({ seq: withAux.seq, ops: withAux.ops, unapplied: withAux.unapplied, attached: withAux.attached }).toEqual({ seq: base.seq, ops: base.ops, unapplied: base.unapplied, attached: base.attached });
  });
});

describe('the write-grant fold', () => {
  it('the default: the first attached session may draw, a later one may not, an unattached one never', () => {
    expect([dimGrantDefault(state, A), dimGrantDefault(state, B), dimGrantDefault(state, C)]).toEqual([true, false, false]);
    expect(dimGrantDefault(foldDim([]), A)).toBe(false);
    const none = emptyDimGrants();
    expect([dimMayDraw(state, none, A), dimMayDraw(state, none, B), dimMayDraw(state, none, C), dimMayDraw(state, none, '')]).toEqual([true, false, false, false]);
  });

  it('the last honoured row for an hsid wins over the default, in log order', () => {
    expect(may([grant(B, true)], B)).toBe(true);
    expect(may([grant(A, false)], A)).toBe(false);
    expect(may([grant(B, true), grant(B, false)], B)).toBe(false);
    expect(may([grant(B, false), grant(B, true)], B)).toBe(true);
    expect(may([grant(A, false), grant(A, true), grant(A, false)], A)).toBe(false);
    // one session's rows never move another's
    expect(may([grant(B, true)], A)).toBe(true);
    expect(may([grant(A, false)], B)).toBe(false);
  });

  it('a grant row is honoured only with a host stamp of surface gui and no agent', () => {
    const stamps: Array<[string, unknown]> = [
      ['bridge', { principal: 'p:t/session', surface: 'bridge', agent: 'claude', hsid: B, turn: 'turn:b/1' }],
      ['voice', { principal: 'p:t/session', surface: 'voice', agent: 'claude', hsid: B, turn: 'turn:b/1' }],
      ['cli', { principal: 'p:t/human', surface: 'cli' }],
      ['unstamped', NONE],
      ['a null stamp', null],
      ['gui with an agent', { principal: 'p:t/session', surface: 'gui', agent: 'claude' }],
      ['gui with an empty agent', { principal: 'p:t/human', surface: 'gui', agent: '' }],
      ['gui with no principal', { surface: 'gui' }],
      ['bridge with no agent', { principal: 'p:t/session', surface: 'bridge' }],
      ['an unknown surface', { principal: 'p:t/human', surface: 'desk' }],
      ['not an object', 'gui'],
    ];
    for (const [name, relayedFor] of stamps) {
      // it cannot grant
      expect(may([grant(B, true, relayedFor)], B), `${name}: grants`).toBe(false);
      // it cannot revoke, and it cannot undo a person's revoke or grant
      expect(may([grant(A, false, relayedFor)], A), `${name}: revokes`).toBe(true);
      expect(may([grant(B, true), grant(B, false, relayedFor)], B), `${name}: undoes a grant`).toBe(true);
      expect(may([grant(A, false), grant(A, true, relayedFor)], A), `${name}: undoes a revoke`).toBe(false);
      expect(foldDimGrants([grant(B, true, relayedFor)], DIM).size, `${name}: leaves no entry`).toBe(0);
    }
    // the stamp is the payload's OWN host-written key: one reached through a prototype, or beside the payload, is not it
    const proto = { v: 1, dim: DIM, hsid: B, write: true };
    Object.setPrototypeOf(proto, { relayedFor: gui });
    expect(may([{ seq: 1, kind: DIM_AUX_KINDS.grant, payload: proto }], B)).toBe(false);
    expect(may([{ ...grant(B, true, NONE), relayedFor: gui } as DimRow], B)).toBe(false);
  });

  it('a malformed, foreign or other-kind row changes nothing, and the fold never throws', () => {
    const noise: DimRow[] = [
      grant(B, 'true'), grant(B, 1), grant(B, null), grant('', true), grant(7, true), grant(undefined, true),
      { ...grant(B, true), payload: { v: 1, dim: OTHER, hsid: B, write: true, relayedFor: gui } },
      { ...grant(B, true), kind: DIM_KINDS.attach },
      { ...grant(B, true), kind: DIM_AUX_KINDS.drawRefused },
      { ...grant(B, true), kind: 'modns.acme.dimension.grant' },
      { seq: 1, kind: DIM_AUX_KINDS.grant, payload: null },
      { seq: 1, kind: DIM_AUX_KINDS.grant, payload: [] },
      null as unknown as DimRow,
      undefined as unknown as DimRow,
      { seq: 1, kind: DIM_AUX_KINDS.grant, get payload(): unknown { throw new Error('boom'); } } as DimRow,
    ];
    expect(() => foldDimGrants(noise, DIM)).not.toThrow();
    expect(foldDimGrants(noise, DIM).size).toBe(0);
    expect(may(noise, B)).toBe(false);
    // a row with no integer seq has no place in the order: skipped
    for (const bad of [undefined, null, '7', 1.5, NaN]) expect(may([{ ...grant(B, true), seq: bad as unknown as number }], B), String(bad)).toBe(false);
  });

  it('an honoured row of a version this file does not read folds as write false, whatever it says', () => {
    const versioned = (hsid: string, v: unknown, write: unknown, relayedFor: unknown = gui): DimRow => ({ seq: seq++, kind: DIM_AUX_KINDS.grant, payload: { ...(v === NONE ? {} : { v }), dim: DIM, hsid, write, later: 'x', relayedFor } });
    for (const v of [2, 3, 0, -1, 1.5, '1', null, NONE]) {
      const name = `v ${String(v)}`;
      // it does not grant, and it revokes: the default-on session and a session a person granted both lose the pen
      expect(may([versioned(B, v, true)], B), `${name}: grants`).toBe(false);
      expect(may([versioned(A, v, true)], A), `${name}: revokes the default`).toBe(false);
      expect(may([grant(B, true), versioned(B, v, true)], B), `${name}: revokes a grant`).toBe(false);
      expect(foldDimGrants([versioned(B, v, true)], DIM).get(B)?.write, name).toBe(false);
      // a v1 row after it is read again
      expect(may([versioned(B, v, true), grant(B, true)], B), `${name}: then v1`).toBe(true);
    }
    // only from an honoured stamp: an unknown version from a tool surface still changes nothing
    expect(may([versioned(A, 2, false, { principal: 'p:t/session', surface: 'bridge', agent: 'claude' })], A)).toBe(true);
    expect(may([versioned(A, 2, false, NONE)], A)).toBe(true);
    // v1 itself is read as written
    expect(may([versioned(B, 1, true)], B)).toBe(true);
  });

  it('nothing is folded unless dim is a dimension id; a copy of from is returned', () => {
    const from = foldDimGrants([grant(B, true)], DIM);
    for (const bad of ['', 'not-a-dim', 'dim:nope', `${DIM} `, '__proto__', undefined, null, 7]) {
      const rows: DimRow[] = [{ seq: 99, kind: DIM_AUX_KINDS.grant, payload: { v: 1, dim: bad, hsid: A, write: false, relayedFor: gui } }];
      const out = foldDimGrants(rows, bad as string, from);
      expect(out, String(bad)).not.toBe(from);
      expect([...out], String(bad)).toEqual([...from]);
      expect(foldDimGrants(rows, bad as string).size, String(bad)).toBe(0);
    }
  });

  it('a row at or below the seq already folded for its hsid changes nothing (a redelivered older row)', () => {
    const at = (n: number, hsid: string, write: boolean): DimRow => ({ seq: n, kind: DIM_AUX_KINDS.grant, payload: { v: 1, dim: DIM, hsid, write, relayedFor: gui } });
    // revoke at 5, grant at 9, row 5 again: still granted
    expect(may([at(5, B, false), at(9, B, true), at(5, B, false)], B)).toBe(true);
    // and the other way: grant at 5, revoke at 9, the old grant again: still revoked
    expect(may([at(5, A, true), at(9, A, false), at(5, A, true)], A)).toBe(false);
    // across a continued fold, and for a row at the very same seq
    const first = foldDimGrants([at(5, A, true), at(9, A, false)], DIM);
    expect(first.get(A)).toEqual({ write: false, seq: 9 });
    expect(dimMayDraw(state, foldDimGrants([at(5, A, true), at(8, A, true), at(9, A, true)], DIM, first), A)).toBe(false);
    expect(dimMayDraw(state, foldDimGrants([at(10, A, true)], DIM, first), A)).toBe(true);
    // the mark is per hsid: an older row for another session still lands
    expect(dimMayDraw(state, foldDimGrants([at(3, B, true)], DIM, first), B)).toBe(true);
    // a whole page read twice folds to the same map
    const page = [at(5, B, false), at(6, A, false), at(9, B, true)];
    expect([...foldDimGrants(page, DIM, foldDimGrants(page, DIM))]).toEqual([...foldDimGrants(page, DIM)]);
  });

  it('a grant row for a session that is not attached never lets it draw', () => {
    expect(may([grant(C, true)], C)).toBe(false);
    // once a person attaches it, the row stands
    const attached = foldDim([{ seq: 3, kind: DIM_KINDS.attach, payload: { v: 1, dim: DIM, hsid: C, relayedFor: gui } }], undefined, state);
    expect(dimMayDraw(attached, foldDimGrants([grant(C, true)], DIM), C)).toBe(true);
    expect(dimMayDraw(attached, emptyDimGrants(), C)).toBe(false);
  });

  it('pure and chunked: the input map is not changed, and folding in two parts equals folding once', () => {
    const rows = [grant(B, true), grant(A, false), grant(B, false, { principal: 'p:t/session', surface: 'bridge', agent: 'claude' }), grant(A, true)];
    const first = foldDimGrants(rows.slice(0, 2), DIM);
    const snapshot = [...first];
    const both = foldDimGrants(rows.slice(2), DIM, first);
    expect([...first]).toEqual(snapshot);
    const flat = (g: ReadonlyMap<string, { write: boolean }>): Array<[string, boolean]> => [...g].map(([h, e]): [string, boolean] => [h, e.write]).sort();
    expect([...both].sort()).toEqual([...foldDimGrants(rows, DIM)].sort());
    expect(flat(both)).toEqual([[A, true], [B, true]]);
  });
});
