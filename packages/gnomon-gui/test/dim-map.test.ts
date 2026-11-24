/**
 * #gui-dim-map (boards S1.3, draft point 5; C4; Aegis A6): the state ↔ engine element map, in Node, with no engine.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DIM_HASH_VECTOR_ROWS, DIM_KINDS, dimFallbackLabel, dimZCompare, emptyDimState, foldDim, validateDimOps } from '@a-company/gnomon-contracts';
import type { DimOp, DimRow, DimState } from '@a-company/gnomon-contracts';
import { DIM_ENGINE_KEYS, dimIsSticky, dimLabelId, dimToElements, elementsToOps } from '../src/board/dim-map.js';
import type { DimMapIds, EngineElement } from '../src/board/dim-map.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIM = 'dim:01JD1MVECT0R00000000000001';
const HUMAN = { principal: 'p:me/human', surface: 'gui' };
const AGENT = { principal: 'p:me/session', surface: 'bridge', agent: 'kit', hsid: 'hsid-1' };
const ULID = (n: number): string => `01JD1MAP${String(n).padStart(18, '0')}`;
const ME = { cls: 'human' as const, principal: 'p:me/human' };

/** A two-way id table like the handle's: engine ids are `e<n>`, new node ids are minted in order. */
function idTable(seed: Record<string, string> = {}): DimMapIds & { minted: string[] } {
  const toNode = new Map<string, string>();
  const toEngine = new Map<string, string>();
  const minted: string[] = [];
  let n = 900;
  for (const [node, engine] of Object.entries(seed)) {
    toNode.set(engine, node);
    toEngine.set(node, engine);
  }
  return {
    minted,
    nodeOf(engineId) {
      let id = toNode.get(engineId);
      if (id === undefined) {
        id = ULID(n++);
        minted.push(id);
        toNode.set(engineId, id);
        toEngine.set(id, engineId);
      }
      return id;
    },
    engineOf(nodeId) {
      let id = toEngine.get(nodeId);
      if (id === undefined) {
        id = `e-${nodeId}`;
        toEngine.set(nodeId, id);
        toNode.set(id, nodeId);
      }
      return id;
    },
  };
}

const start: DimRow = { seq: 1, kind: DIM_KINDS.start, payload: { v: 1, dim: DIM, title: 'Map', attached: ['hsid-1'], opened: 'command', relayedFor: HUMAN } };
const opRow = (seq: number, ops: unknown[], relayedFor: unknown = HUMAN): DimRow => ({ seq, kind: DIM_KINDS.op, payload: { v: 1, dim: DIM, ops, ...(relayedFor ? { relayedFor } : {}) } });
const add = (node: Record<string, unknown>): unknown => ({ type: 'add', node });
const fold = (...rows: DimRow[]): DimState => foldDim([start, ...rows]);

/** Every core kind, in canonical form (defaults left out, points starting at the origin). */
const CORE_NODES: Array<Record<string, unknown>> = [
  { id: ULID(1), kind: 'frame', x: 0, y: 0, z: 'V', w: 640, h: 480, title: 'Plan' },
  { id: ULID(2), kind: 'rect', x: 40, y: 40, z: 'W', w: 200, h: 120, fill: 'lemon', label: 'One', parent: ULID(1) },
  { id: ULID(3), kind: 'ellipse', x: 300, y: 40, z: 'X', w: 80, h: 60, color: 'cobalt', weight: 2 },
  { id: ULID(4), kind: 'diamond', x: 300, y: 200, z: 'Y', w: 90, h: 90, rot: 450 },
  { id: ULID(5), kind: 'text', x: 40, y: 300, z: 'Z', text: 'Two words' },
  { id: ULID(6), kind: 'stroke', x: 500, y: 300, z: 'a', points: [0, 0, 3, 4, -6, 9], weight: 3 },
  { id: ULID(7), kind: 'arrow', x: 240, y: 100, z: 'b', points: [0, 0, 60, -20], from: ULID(2), to: ULID(3), head: 'both', label: 'leads' },
];

const stripIds = (nodes: Iterable<Record<string, unknown>>, rename: (id: string) => string): unknown[] =>
  [...nodes]
    .sort((a, b) => dimZCompare(a as { z: unknown; id: string }, b as { z: unknown; id: string }))
    .map((n) => {
      // order keys are derived from the neighbours, so the ORDER is compared, not the keys
      const { z: _z, ...out }: Record<string, unknown> = { ...n };
      for (const k of ['id', 'from', 'to', 'parent']) if (typeof out[k] === 'string') out[k] = rename(out[k] as string);
      return out;
    });

describe('#gui-dim-map forward: dimToElements', () => {
  const state = fold(opRow(2, CORE_NODES.map(add)));

  it('emits every core kind in dimZCompare order, a label straight after its mark', () => {
    const els = dimToElements(state, 'day', idTable());
    expect(els.map((e) => e.type)).toEqual(['frame', 'rectangle', 'text', 'ellipse', 'diamond', 'text', 'freedraw', 'arrow', 'text']);
    expect(els[2]).toMatchObject({ id: dimLabelId(els[1]!.id), containerId: els[1]!.id, text: 'One' });
    expect(els[8]).toMatchObject({ containerId: els[7]!.id, text: 'leads' });
  });

  it('builds each element from the closed key list and nothing else', () => {
    for (const el of dimToElements(state, 'night', idTable())) {
      expect(Object.keys(el).filter((k) => !DIM_ENGINE_KEYS.includes(k))).toEqual([]);
      expect(Object.keys(el.customData ?? {})).toEqual(['gnomon']);
      expect(Object.keys(el.customData!.gnomon).sort()).toEqual(['fill', 'line']);
    }
  });

  it('maps parent to frameId, from/to to bindings (listed on both ends), rot to radians and head to arrowheads', () => {
    const ids = idTable();
    const els = new Map(dimToElements(state, 'day', ids).map((e) => [e.id, e]));
    const rect = els.get(ids.engineOf(ULID(2)))!;
    const arrow = els.get(ids.engineOf(ULID(7)))!;
    expect(rect.frameId).toBe(ids.engineOf(ULID(1)));
    expect(arrow.startBinding).toEqual({ elementId: rect.id, focus: 0, gap: 0 });
    expect(arrow.endBinding?.elementId).toBe(ids.engineOf(ULID(3)));
    expect(rect.boundElements).toEqual([{ type: 'text', id: dimLabelId(rect.id) }, { type: 'arrow', id: arrow.id }]);
    expect(arrow.startArrowhead).toBe('arrow');
    expect(els.get(ids.engineOf(ULID(4)))!.angle).toBeCloseTo(Math.PI / 4, 10);
    expect(els.get(ids.engineOf(ULID(3)))!.strokeWidth).toBe(4);
    expect(els.get(ids.engineOf(ULID(1)))!.name).toBe('Plan');
  });

  it('draws a human mark solid and an agent or unknown mark dashed', () => {
    const s = fold(
      opRow(2, [add({ id: ULID(1), kind: 'rect', x: 0, y: 0, z: 'V', w: 10, h: 10 })]),
      opRow(3, [add({ id: ULID(2), kind: 'rect', x: 0, y: 0, z: 'W', w: 10, h: 10 })], AGENT),
      opRow(4, [add({ id: ULID(3), kind: 'rect', x: 0, y: 0, z: 'X', w: 10, h: 10 })], null),
    );
    expect(dimToElements(s, 'day', idTable()).map((e) => e.strokeStyle)).toEqual(['solid', 'dashed', 'dashed']);
  });

  it('a sticky is a filled, labelled rect; an agent sticky is still dashed (A6: paint only)', () => {
    const sticky = { id: ULID(1), kind: 'rect', x: 0, y: 0, z: 'V', w: 120, h: 80, fill: 'lemon', label: '' };
    expect(dimIsSticky(sticky)).toBe(true);
    expect(dimIsSticky({ ...sticky, fill: 'custom:#aabbcc' })).toBe(false);
    expect(dimIsSticky({ ...sticky, fill: 'not-a-swatch' })).toBe(false);
    expect(dimIsSticky({ ...sticky, kind: 'ellipse' })).toBe(false);
    const { label: _label, ...bare } = sticky;
    expect(dimIsSticky(bare)).toBe(false);
    // a label key read through a prototype is not a label key
    expect(dimIsSticky(Object.create({ label: 'x' }, { kind: { value: 'rect', enumerable: true }, fill: { value: 'lemon', enumerable: true } }))).toBe(false);
    const s = fold(opRow(2, [add({ ...sticky, label: 'note' })], AGENT));
    const [el] = dimToElements(s, 'day', idTable());
    expect(dimIsSticky(s.nodes.get(ULID(1))!.node)).toBe(true);
    expect(el!.strokeStyle).toBe('dashed');
    expect(el!.customData!.gnomon.fill).toBe('lemon');
  });

  it('an unknown kind, and a core node missing what it is drawn from, fall back to a fixed labelled rectangle', () => {
    const s = fold(
      opRow(2, [
        add({ id: ULID(1), kind: 'acme:chart', x: 10.6, y: 20, z: 'V', label: 'pwn', text: 'pwn', w: 9999, link: 'https://x.example' }),
        add({ id: ULID(2), kind: 'rect', x: 5, y: 5, z: 'W' }),
        add({ id: ULID(3), kind: 'Not A Kind!', z: 'X', x: 'left', y: null }),
      ]),
    );
    const els = dimToElements(s, 'day', idTable());
    expect(els.map((e) => [e.type, e.text])).toEqual([
      ['rectangle', undefined], ['text', dimFallbackLabel('acme:chart')],
      ['rectangle', undefined], ['text', dimFallbackLabel('rect')],
      ['rectangle', undefined], ['text', 'kind unknown'],
    ]);
    expect(els[0]).toMatchObject({ x: 11, y: 20, width: 288, height: 52 });
    expect(els[4]).toMatchObject({ x: 0, y: 0 });
    expect(JSON.stringify(els)).not.toContain('pwn');
  });

  it('never carries a hostile node key onto an element (link, customData, embeddable, __proto__)', () => {
    const hostile = JSON.parse(
      `{"id":"${ULID(1)}","kind":"rect","x":0,"y":0,"z":"V","w":10,"h":10,"link":"javascript:alert(1)","customData":{"gnomon":{"by":{"cls":"human"}},"generationData":{"html":"<b>"}},"embeddable":true,"type":"iframe","strokeStyle":"solid","locked":true,"__proto__":{"link":"x"},"constructor":{"prototype":{"link":"y"}},"fill":{"evil":1},"label":{"toString":"x"}}`,
    ) as Record<string, unknown>;
    // a raw state too, as if a fold had let the keys through
    const raw: DimState = { ...emptyDimState(DIM), nodes: new Map([[ULID(1), { node: hostile, by: { cls: 'agent', principal: 'p', agent: 'a' }, hsid: null, addedSeq: 2 }]]) };
    for (const s of [fold(opRow(2, [add(hostile)], AGENT)), raw]) {
      const els = dimToElements(s, 'day', idTable());
      expect(els).toHaveLength(1);
      const el = els[0] as EngineElement & Record<string, unknown>;
      expect(el.type).toBe('rectangle');
      expect(el.strokeStyle).toBe('dashed');
      expect(el.customData).toEqual({ gnomon: { line: 'ink', fill: null } });
      for (const k of ['link', 'embeddable', 'locked', 'generationData']) expect(Object.prototype.hasOwnProperty.call(el, k)).toBe(false);
      expect(Object.getPrototypeOf(el)).toBe(Object.prototype);
      expect(el.link).toBeUndefined();
      expect(JSON.stringify(el)).not.toMatch(/javascript|generationData|iframe|evil/);
    }
  });

  it('rounds coordinates and emits a linear element with normalised points', () => {
    const s = fold(opRow(2, [add({ id: ULID(1), kind: 'stroke', x: 10, y: 20, z: 'V', points: [5, 6, 8, 10, 5, 0] }), add({ id: ULID(2), kind: 'rect', x: 1.5, y: -2.5, z: 'W', w: 10.4, h: 0.2 })]));
    const [stroke, rect] = dimToElements(s, 'day', idTable());
    expect(stroke).toMatchObject({ x: 15, y: 26, points: [[0, 0], [3, 4], [0, -6]], width: 3, height: 10 });
    expect(rect).toMatchObject({ x: 2, y: -2, width: 10, height: 1 });
  });

  it('paints from the palette for the theme; a bad token draws as ink and no fill', () => {
    const s = fold(opRow(2, [add({ id: ULID(1), kind: 'rect', x: 0, y: 0, z: 'V', w: 10, h: 10, color: 'cobalt', fill: 'lemon' }), add({ id: ULID(2), kind: 'rect', x: 0, y: 0, z: 'W', w: 10, h: 10, color: 'url(x)', fill: '#fff' })]));
    const day = dimToElements(s, 'day', idTable());
    const night = dimToElements(s, 'night', idTable());
    expect(day[0]!.strokeColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(day[0]!.strokeColor).not.toBe(night[0]!.strokeColor);
    expect(day[1]!.customData).toEqual({ gnomon: { line: 'ink', fill: null } });
    expect(day[1]!.backgroundColor).toBe('transparent');
  });
});

describe('#gui-dim-map reverse: elementsToOps', () => {
  it('golden round trip: state → elements → ops against an empty state reproduces the nodes, in the same order, up to ids and order keys', () => {
    const state = fold(opRow(2, CORE_NODES.map(add)));
    const els = dimToElements(state, 'day', idTable());
    const ids = idTable();
    const ops = elementsToOps(emptyDimState(DIM), els, ids, { line: 'ink', fill: null });
    expect(ops.every((o) => o.type === 'add')).toBe(true);
    const v = validateDimOps(foldDim([start]), ops, ME);
    expect(v.refused).toEqual([]);
    const back = foldDim([start, opRow(2, v.ok)]);
    // engine ids are `e-<old node id>`; the new table minted a node id for each
    const oldOf = new Map([...back.nodes.keys()].map((id) => [id, ids.engineOf(id).slice(2)]));
    expect(stripIds([...back.nodes.values()].map((n) => n.node), (id) => oldOf.get(id) ?? id)).toEqual(stripIds(CORE_NODES, (id) => id));
  });

  it('the published hash vector state survives a render with no op', () => {
    const state = foldDim(DIM_HASH_VECTOR_ROWS);
    const ids = idTable();
    expect(elementsToOps(state, dimToElements(state, 'night', ids), ids, { line: 'cobalt', fill: 'lemon' })).toEqual([]);
    expect(ids.minted).toEqual([]);
  });

  it('a state the fold carried in a non-canonical form causes no op until something changes', () => {
    const state = fold(opRow(2, [add({ id: ULID(1), kind: 'stroke', x: 10, y: 20, z: 'V', points: [5, 6, 8, 10], weight: 1, color: 'ink', refs: ['sym:#x'] }), add({ id: ULID(2), kind: 'arrow', x: 0, y: 0, z: 'W', points: [0, 0, 5, 5], head: 'end', rel: 'leads-to' }), add({ id: ULID(3), kind: 'text', x: 0, y: 0, z: 'X', text: 't', size: 3, w: 80 })]));
    const ids = idTable();
    const els = dimToElements(state, 'day', ids);
    expect(elementsToOps(state, els, ids, { line: 'ink', fill: null })).toEqual([]);
    // reshaping the stroke restates x and y with the points, and leaves refs alone
    const moved = els.map((e) => (e.type === 'freedraw' ? { ...e, points: [[0, 0], [9, 9]] } : e));
    expect(elementsToOps(state, moved, ids, { line: 'ink', fill: null })).toEqual([{ type: 'update', id: ULID(1), patch: { points: [0, 0, 9, 9], x: 15, y: 26 } }]);
  });

  it('a drag of several marks is one move; a different delta is another', () => {
    const state = fold(opRow(2, CORE_NODES.map(add)));
    const ids = idTable();
    const els = dimToElements(state, 'day', ids).map((e) => (e.type === 'ellipse' || e.type === 'diamond' ? { ...e, x: e.x + 12.4, y: e.y - 7 } : e.type === 'freedraw' ? { ...e, x: e.x + 1 } : e));
    expect(elementsToOps(state, els, ids, { line: 'ink', fill: null })).toEqual([
      { type: 'move', ids: [ULID(3), ULID(4)], dx: 12, dy: -7 },
      { type: 'move', ids: [ULID(6)], dx: 1, dy: 0 },
    ]);
  });

  it('diffs add, update (null for a removed field) and delete, and the result passes the validator', () => {
    const state = fold(opRow(2, CORE_NODES.map(add)));
    const ids = idTable();
    const els: Array<Record<string, unknown>> = dimToElements(state, 'day', ids)
      .filter((e) => e.id !== ids.engineOf(ULID(6)))
      .filter((e) => e.id !== dimLabelId(ids.engineOf(ULID(2))))
      .map((e) => (e.id === ids.engineOf(ULID(3)) ? { ...e, width: 99.6, customData: { gnomon: { line: 'ink', fill: 'sky' } } } : e.id === ids.engineOf(ULID(7)) ? { ...e, endBinding: null, startArrowhead: null } : e));
    els.push({ id: 'new-1', type: 'rectangle', x: 1.2, y: 2.7, width: 30, height: 40, angle: 0, strokeWidth: 2, frameId: ids.engineOf(ULID(1)) });
    els.push({ id: 'new-arrow', type: 'arrow', x: 0, y: 0, width: 5, height: 5, points: [[0, 0], [5, 5]], endArrowhead: 'arrow', startBinding: { elementId: 'new-1' }, endBinding: { elementId: 'nowhere' } });
    els.push({ id: 'gone', type: 'rectangle', x: 0, y: 0, width: 5, height: 5, isDeleted: true });
    els.push({ id: 'img', type: 'image', x: 0, y: 0, width: 5, height: 5, link: 'https://x.example' });
    els.push({ id: 'empty', type: 'text', x: 0, y: 0, text: '' });
    const ops = elementsToOps(state, els as never, ids, { line: 'cobalt', fill: 'lemon' });
    const [n1, n2] = ids.minted;
    expect(ops).toEqual([
      { type: 'add', node: { id: n1, kind: 'rect', x: 1, y: 3, color: 'cobalt', fill: 'lemon', w: 30, h: 40, parent: ULID(1), z: expect.any(String) } },
      { type: 'add', node: { id: n2, kind: 'arrow', x: 0, y: 0, color: 'cobalt', points: [0, 0, 5, 5], from: n1, z: expect.any(String) } },
      // an emptied sticky keeps its label key
      { type: 'update', id: ULID(2), patch: { label: '' } },
      { type: 'update', id: ULID(3), patch: { w: 100, color: null, fill: 'sky' } },
      { type: 'update', id: ULID(7), patch: { to: null, head: null } },
      { type: 'delete', id: ULID(6) },
    ]);
    expect(ids.minted).toHaveLength(2);
    const v = validateDimOps(state, ops, ME);
    expect(v.refused).toEqual([]);
    expect(v.ok).toHaveLength(ops.length);
  });

  it('z: a new mark is placed between its neighbours, and one mark sent to the back is the only one re-keyed', () => {
    const state = fold(opRow(2, CORE_NODES.map(add)));
    const ids = idTable();
    const els = dimToElements(state, 'day', ids);
    const text = els.find((e) => e.id === ids.engineOf(ULID(5)))!;
    const back = [text, ...els.filter((e) => e !== text)];
    expect(elementsToOps(state, back, ids, { line: 'ink', fill: null })).toEqual([{ type: 'update', id: ULID(5), patch: { z: expect.any(String) } }]);
    const [{ patch }] = elementsToOps(state, back, ids, { line: 'ink', fill: null }) as Array<{ patch: { z: string } }>;
    expect(patch.z < 'V').toBe(true);
    const mid = [...els.slice(0, 4), { id: 'new-2', type: 'ellipse', x: 0, y: 0, width: 5, height: 5 }, ...els.slice(4)];
    const [addOp] = elementsToOps(state, mid as never, ids, { line: 'ink', fill: null }) as Array<{ type: string; node: { z: string } }>;
    expect(addOp!.type).toBe('add');
    expect(addOp!.node.z > 'X' && addOp!.node.z < 'Y').toBe(true);
  });

  it('never edits a fallback mark, never re-adds a deleted id, and gives a Sticky-tool rect its label key', () => {
    const state = fold(opRow(2, [add({ id: ULID(1), kind: 'acme:chart', x: 0, y: 0, z: 'V' }), add({ id: ULID(2), kind: 'rect', x: 0, y: 0, z: 'W', w: 5, h: 5 }), { type: 'delete', id: ULID(2) }]));
    const ids = idTable({ [ULID(2)]: 'ghost' });
    const els: Array<Record<string, unknown>> = dimToElements(state, 'day', ids).map((e) => ({ ...e, x: e.x + 50, width: 400 }));
    els.push({ id: 'ghost', type: 'rectangle', x: 0, y: 0, width: 5, height: 5 });
    expect(elementsToOps(state, els as never, ids, { line: 'ink', fill: null })).toEqual([]);
    // the fallback mark removed in the engine is not deleted either: the validator would refuse it (kind-not-core)
    expect(elementsToOps(state, [], ids, { line: 'ink', fill: null })).toEqual([]);
    const drawn = [{ id: 'st', type: 'rectangle', x: 0, y: 0, width: 120, height: 80 }];
    const [op] = elementsToOps(emptyDimState(DIM), drawn as never, idTable(), { line: 'ink', fill: 'lemon', sticky: true }) as Array<{ node: Record<string, unknown> }>;
    expect(dimIsSticky(op!.node)).toBe(true);
  });

  it('no element key but the read list reaches an op (a pasted link or customData is dropped)', () => {
    const el = { id: 'x', type: 'rectangle', x: 0, y: 0, width: 5, height: 5, link: 'https://x.example', locked: true, customData: { gnomon: { line: 'cobalt', fill: 'lemon', by: { cls: 'human' }, kind: 'stub' }, other: 1 }, roughness: 2 };
    const ops = elementsToOps(emptyDimState(DIM), [el] as never, idTable(), { line: 'ink', fill: null }) as DimOp[];
    expect(ops).toEqual([{ type: 'add', node: { id: ULID(900), kind: 'rect', x: 0, y: 0, color: 'cobalt', fill: 'lemon', w: 5, h: 5, z: 'V' } }]);
  });
});

describe('#gui-dim-map source rules', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'board', 'dim-map.ts'), 'utf8');
  it('imports no engine, no React and no DOM-mounted module, and logs nothing', () => {
    const specs = [...src.matchAll(/\bfrom\s+'([^']+)'/g)].map((m) => m[1]);
    expect(specs.sort()).toEqual(['../core/board.js', './normal.js', '@a-company/gnomon-contracts', '@a-company/gnomon-contracts']);
    expect(src).not.toMatch(/console\.|document\.|window\./);
  });
});
