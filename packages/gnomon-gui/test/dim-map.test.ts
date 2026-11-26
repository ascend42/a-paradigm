/**
 * #gui-dim-map (boards S1.3, draft point 5; C4; Aegis A6): the state ↔ engine element map, in Node, with no engine.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DIM_HASH_VECTOR_ROWS, DIM_KINDS, DIM_LIMITS, DIM_Z_PATTERN, dimFallbackLabel, dimZCompare, emptyDimState, foldDim, validateDimOps } from '@a-company/gnomon-contracts';
import type { DimFoldNode, DimOp, DimRow, DimState } from '@a-company/gnomon-contracts';
import { DIM_AGENT_STROKE_TYPE, DIM_ENGINE_KEYS, dimHandOf, dimIsAgentStroke, dimIsFallback, dimIsSticky, dimLabelId, dimToElements, elementsToOps } from '../src/board/dim-map.js';
import type { DimMapIds, EngineElement } from '../src/board/dim-map.js';
import { BOARD_TYPES, FILLABLE, isBoardType, normalOf, offNormal } from '../src/board/normal.js';
import { fixtureRows } from '../src/preview/board-fixture.js';

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

describe('#gui-dim-map contrast_rule at paint (S1.4 P0b)', () => {
  it('a stored row whose colour now fails paints as ink or no fill, a failing pair paints its line as ink, and no op rewrites it', () => {
    // rows the validator would refuse today: stored before the rule (the fold accepts them)
    const s = fold(opRow(2, [
      add({ id: ULID(1), kind: 'text', x: 0, y: 0, z: 'V', text: 'a fair line, a faint paragraph', color: 'custom:#767676' }),
      add({ id: ULID(2), kind: 'rect', x: 0, y: 0, z: 'W', w: 10, h: 10, color: 'custom:#858585', fill: 'cobalt' }),
      add({ id: ULID(3), kind: 'rect', x: 0, y: 0, z: 'X', w: 10, h: 10, color: 'custom:#FF8800', fill: 'custom:#404040' }),
    ]));
    expect(validateDimOps(emptyDimState(), [{ type: 'add', node: { ...s.nodes.get(ULID(2))!.node } }], ME).refused.map((r) => `${r.code}@${r.field}`)).toEqual(['colour-bad@color']);
    for (const theme of ['day', 'night'] as const) {
      const ink = theme === 'day' ? '#16150F' : '#E8F4F0';
      const els = dimToElements(s, theme, idTable());
      expect(els[0]!.strokeColor).toBe(ink);
      expect([els[1]!.strokeColor, els[1]!.backgroundColor]).toEqual([ink, theme === 'day' ? '#CDDFFE' : '#2F3D56']);
      expect([els[2]!.strokeColor, els[2]!.backgroundColor]).toEqual([ink, 'transparent']);
      // the stored tokens of the pair stay on the element; the row is not rewritten
      expect(els[1]!.customData).toEqual({ gnomon: { line: 'custom:#858585', fill: 'cobalt' } });
    }
    const ids = idTable();
    expect(elementsToOps(s, dimToElements(s, 'day', ids), ids, { line: 'ink', fill: null })).toEqual([]);
    expect([...s.nodes.values()].map((n) => n.node.color)).toEqual(['custom:#767676', 'custom:#858585', 'custom:#FF8800']);
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

describe('#gui-dim-map review fixes (PR #113)', () => {
  const STYLE = { line: 'ink', fill: null };

  it('1. the dash fails closed: solid only for cls human; a missing by or an unknown class is dashed', () => {
    const node = (n: number): Record<string, unknown> => ({ id: ULID(n), kind: 'rect', x: 0, y: 0, z: 'V', w: 10, h: 10 });
    const raw = (by: unknown): DimState => ({ ...emptyDimState(DIM), nodes: new Map([[ULID(1), { node: node(1), by: by as never, hsid: null, addedSeq: 2 }]]) });
    const styleOf = (by: unknown): string => dimToElements(raw(by), 'day', idTable())[0]!.strokeStyle;
    expect(styleOf({ cls: 'human', principal: 'p' })).toBe('solid');
    for (const by of [undefined, null, {}, { cls: 'robot' }, { cls: 'Human' }, { cls: ['human'] }, { cls: 'agent' }, { cls: 'unknown' }, 'human']) expect(styleOf(by)).toBe('dashed');
  });

  it('2. a drag with a recolour or a reorder of a line whose stored points are off the origin restates x, y and points', () => {
    const state = fold(opRow(2, [add({ id: ULID(1), kind: 'stroke', x: 100, y: 100, z: 'V', points: [10, 10, 20, 20] }), add({ id: ULID(2), kind: 'rect', x: 0, y: 0, z: 'W', w: 5, h: 5 })]));
    const ids = idTable();
    const els = dimToElements(state, 'day', ids);
    expect(els[0]).toMatchObject({ x: 110, y: 110, points: [[0, 0], [10, 10]] });
    // Probe's case: drag (5, 5) and recolour
    const edited = els.map((e) => (e.type === 'freedraw' ? { ...e, x: e.x + 5, y: e.y + 5, customData: { gnomon: { line: 'cobalt', fill: null } } } : e));
    const ops = elementsToOps(state, edited, ids, STYLE);
    expect(ops).toEqual([{ type: 'update', id: ULID(1), patch: { x: 115, y: 115, color: 'cobalt', points: [0, 0, 10, 10] } }]);
    const next = foldDim([opRow(3, validateDimOps(state, ops, ME).ok)], undefined, state);
    expect(dimToElements(next, 'day', ids)[0]).toMatchObject({ x: 115, y: 115, points: [[0, 0], [10, 10]] });
    expect(elementsToOps(next, edited, ids, STYLE)).toEqual([]);
    // drag and bring to front
    const three = foldDim([opRow(3, [add({ id: ULID(3), kind: 'rect', x: 0, y: 0, z: 'X', w: 5, h: 5 })])], undefined, state);
    const all = dimToElements(three, 'day', ids);
    const front = [all[1]!, all[2]!, { ...all[0]!, x: all[0]!.x - 3 }];
    expect(elementsToOps(three, front, ids, STYLE)).toEqual([{ type: 'update', id: ULID(1), patch: { x: 107, y: 110, points: [0, 0, 10, 10], z: expect.any(String) } }]);
    // a pure drag stays one relative move
    expect(elementsToOps(state, els.map((e) => (e.type === 'freedraw' ? { ...e, x: e.x + 5 } : e)), ids, STYLE)).toEqual([{ type: 'move', ids: [ULID(1)], dx: 5, dy: 0 }]);
  });

  it('2. fuzz: any single or combined edit, saved and rendered again, leaves nothing more to save', () => {
    let seed = 0x5eed1234;
    const rnd = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const base = fold(
      opRow(2, [
        add({ id: ULID(1), kind: 'frame', x: 0, y: 0, z: 'V', w: 640, h: 480, title: 'Plan' }),
        add({ id: ULID(2), kind: 'rect', x: 40, y: 40, z: 'W', w: 200, h: 120, fill: 'lemon', label: 'One', parent: ULID(1) }),
        add({ id: ULID(3), kind: 'ellipse', x: 300, y: 40, z: 'X', w: 80, h: 60, color: 'ink', weight: 1 }),
        add({ id: ULID(4), kind: 'stroke', x: 100, y: 100, z: 'Y', points: [10, 10, 20, 20, -5, 7] }),
        add({ id: ULID(5), kind: 'arrow', x: 50, y: 60, z: 'Y', points: [-4, 9, 60, -20], from: ULID(2), to: ULID(3), head: 'end', rel: 'leads-to', label: 'go' }),
        add({ id: ULID(6), kind: 'text', x: 40, y: 300, z: 'Z', text: 'Two words', size: 2 }),
        add({ id: ULID(7), kind: 'diamond', x: 300, y: 200, z: 'Z', w: 90, h: 90, rot: 450 }),
      ]),
    );
    const colours = ['ink', 'cobalt', 'graphite', 'raspberry'];
    for (let round = 0; round < 300; round++) {
      let state = base;
      const ids = idTable();
      let scene: Array<Record<string, unknown>> = dimToElements(state, 'day', ids).map((e) => ({ ...e }));
      for (let step = 0; step < 3; step++) {
        const mains = scene.filter((e) => typeof e.containerId !== 'string');
        // one, two or three edits at once, on one mark or on several
        for (let k = 0, edits = 1 + rnd(3); k < edits && mains.length > 0; k++) {
          const el = mains[rnd(mains.length)]!;
          switch (rnd(6)) {
            case 0:
              el.x = (el.x as number) + rnd(41) - 20;
              el.y = (el.y as number) + rnd(41) - 20;
              break;
            case 1:
              el.customData = { gnomon: { line: colours[rnd(colours.length)], fill: (el.customData as { gnomon: { fill: unknown } }).gnomon.fill } };
              break;
            case 2: {
              // to the front or to the back, its label with it
              const mine = scene.filter((e) => e === el || e.containerId === el.id);
              const others = scene.filter((e) => !mine.includes(e));
              scene = rnd(2) ? [...others, ...mine] : [...mine, ...others];
              break;
            }
            case 3:
              if (Array.isArray(el.points)) el.points = [[0, 0], [rnd(50) + 1, rnd(50) - 25], [rnd(50) - 25, rnd(50) + 1]];
              else if (el.type !== 'text') el.width = (el.width as number) + 1 + rnd(9);
              break;
            case 4:
              el.strokeWidth = [2, 4, 8][rnd(3)];
              break;
            default:
              // a text never loses its words here; a deleted mark takes its label along
              if (el.type !== 'frame' && rnd(3) === 0) scene = scene.filter((e) => e !== el && e.containerId !== el.id);
          }
        }
        const live = new Set(scene.map((e) => e.id));
        for (const e of scene) for (const k of ['startBinding', 'endBinding'] as const) if (e[k] && !live.has((e[k] as { elementId: string }).elementId)) e[k] = null;
        const ops = elementsToOps(state, scene as never, ids, STYLE);
        const v = validateDimOps(state, ops, ME);
        expect(v.refused, `round ${round} step ${step}`).toEqual([]);
        state = foldDim([opRow(10 + step, v.ok)], undefined, state);
        // saved: the same scene has nothing more to say
        expect(elementsToOps(state, scene as never, ids, STYLE), `round ${round} step ${step}: second diff`).toEqual([]);
        // rendered again: every mark sits where the person left it, in the order they left it
        const again = dimToElements(state, 'day', ids);
        const where = (list: ReadonlyArray<Record<string, unknown> | EngineElement>): unknown[] => list.filter((e) => typeof e.containerId !== 'string').map((e) => [e.id, e.x, e.y, Array.isArray(e.points) ? e.points : null]);
        expect(where(again), `round ${round} step ${step}: render`).toEqual(where(scene));
        expect(elementsToOps(state, again, ids, STYLE)).toEqual([]);
      }
    }
  });

  it('3. a label of an arrow that runs left or up sits at the middle of its points', () => {
    const state = fold(opRow(2, [add({ id: ULID(1), kind: 'arrow', x: 500, y: 400, z: 'V', points: [0, 0, -200, -100], label: 'back' })]));
    const [arrow, label] = dimToElements(state, 'day', idTable());
    expect(arrow).toMatchObject({ x: 500, y: 400, width: 200, height: 100 });
    expect(label).toMatchObject({ text: 'back', x: 400, y: 350 });
    // and a shape's label at the middle of its box
    const [, l2] = dimToElements(fold(opRow(2, [add({ id: ULID(2), kind: 'rect', x: 10, y: 20, z: 'V', w: 100, h: 40, label: 'r' })])), 'day', idTable());
    expect(l2).toMatchObject({ x: 60, y: 40 });
  });

  it('4. a very long stroke does not throw; points or text over the write limits draw as the fallback box', () => {
    const pts = (n: number): number[] => Array.from({ length: n }, (_, i) => (i % 2 ? -i : i));
    const big = { ...emptyDimState(DIM), nodes: new Map([[ULID(1), { node: { id: ULID(1), kind: 'stroke', x: 0, y: 0, z: 'V', points: pts(400_000) }, by: { cls: 'human' as const, principal: 'p' }, hsid: null, addedSeq: 2 }]]) };
    const els = dimToElements(big, 'day', idTable());
    expect(els.map((e) => [e.type, e.text])).toEqual([['rectangle', undefined], ['text', dimFallbackLabel('stroke')]]);
    expect(els[0]!.points).toBeUndefined();
    const atLimit = fold(opRow(2, [add({ id: ULID(2), kind: 'stroke', x: 0, y: 0, z: 'V', points: pts(DIM_LIMITS.points) }), add({ id: ULID(3), kind: 'text', x: 0, y: 0, z: 'W', text: 'x'.repeat(DIM_LIMITS.text) })]));
    expect(dimToElements(atLimit, 'day', idTable()).map((e) => e.type)).toEqual(['freedraw', 'text']);
    const over = fold(opRow(2, [add({ id: ULID(2), kind: 'arrow', x: 0, y: 0, z: 'V', points: pts(DIM_LIMITS.points + 2) }), add({ id: ULID(3), kind: 'text', x: 0, y: 0, z: 'W', text: 'x'.repeat(DIM_LIMITS.text + 1) }), add({ id: ULID(4), kind: 'rect', x: 0, y: 0, z: 'X', w: 5, h: 5, label: 'y'.repeat(DIM_LIMITS.label + 1) })]));
    const out = dimToElements(over, 'day', idTable());
    expect(out.map((e) => [e.type, e.text])).toEqual([['rectangle', undefined], ['text', 'kind arrow'], ['rectangle', undefined], ['text', 'kind text'], ['rectangle', undefined]]);
    expect(JSON.stringify(out)).not.toMatch(/xxxx|yyyy/);
  });

  it('5. a containerId that names nothing is no container: a stored text is not deleted, a new one is stored', () => {
    const state = fold(opRow(2, [add({ id: ULID(1), kind: 'text', x: 5, y: 5, z: 'V', text: 'kept' }), add({ id: ULID(2), kind: 'rect', x: 0, y: 0, z: 'W', w: 50, h: 50 })]));
    const ids = idTable();
    const els: Array<Record<string, unknown>> = dimToElements(state, 'day', ids).map((e) => (e.type === 'text' ? { ...e, containerId: 'nowhere' } : e));
    expect(elementsToOps(state, els as never, ids, STYLE)).toEqual([]);
    els.push({ id: 'new-t', type: 'text', x: 9, y: 9, text: 'new', containerId: 'gone-container' });
    els.push({ id: 'self', type: 'text', x: 1, y: 1, text: 'self', containerId: 'self' });
    els.push({ id: 'on-text', type: 'text', x: 2, y: 2, text: 'on a text', containerId: ids.engineOf(ULID(1)) });
    els.push({ id: 'dead', type: 'rectangle', x: 0, y: 0, width: 5, height: 5, isDeleted: true });
    els.push({ id: 'on-dead', type: 'text', x: 3, y: 3, text: 'on a deleted mark', containerId: 'dead' });
    const ops = elementsToOps(state, els as never, ids, STYLE) as Array<{ type: string; node: { text: string } }>;
    expect(ops.map((o) => [o.type, o.node.text])).toEqual([['add', 'new'], ['add', 'self'], ['add', 'on a text'], ['add', 'on a deleted mark']]);
    // a real container still takes it as its label
    const bound = [...dimToElements(state, 'day', ids), { id: 'lab', type: 'text', x: 0, y: 0, text: 'label', containerId: ids.engineOf(ULID(2)) }];
    expect(elementsToOps(state, bound as never, ids, STYLE)).toEqual([{ type: 'update', id: ULID(2), patch: { label: 'label' } }]);
  });

  it('6. AGREES with normal.ts: a diamond is a board type and takes a fill, and an arrow keeps the heads its `head` says', () => {
    const state = fold(opRow(2, [add({ id: ULID(1), kind: 'diamond', x: 0, y: 0, z: 'V', w: 9, h: 9, fill: 'lemon' }), add({ id: ULID(2), kind: 'arrow', x: 0, y: 0, z: 'W', points: [0, 0, 5, 5], head: 'both' }), add({ id: ULID(3), kind: 'arrow', x: 0, y: 0, z: 'X', points: [0, 0, 5, 5], head: 'none' }), add({ id: ULID(4), kind: 'arrow', x: 0, y: 0, z: 'Y', points: [0, 0, 5, 5] })]));
    const [diamond, both, none, end] = dimToElements(state, 'day', idTable());
    // (a) the map emits a diamond and the board holds one
    expect(diamond!.type).toBe('diamond');
    expect(BOARD_TYPES.has('diamond')).toBe(true);
    // (b) the map fills a diamond and the normal form keeps the fill
    expect(FILLABLE.has('diamond')).toBe(true);
    expect(normalOf(diamond!, { line: 'ink', fill: 'lemon' }, 'day').backgroundColor).toBe(diamond!.backgroundColor);
    expect(diamond!.backgroundColor).not.toBe('transparent');
    // (c) none, end and both survive the normal form, which fixes only the SHAPE of a head
    for (const el of [both!, none!, end!]) expect(normalOf(el, null, 'day')).toMatchObject({ startArrowhead: el.startArrowhead, endArrowhead: el.endArrowhead });
    expect([both!.startArrowhead, both!.endArrowhead, none!.startArrowhead, none!.endArrowhead, end!.startArrowhead, end!.endArrowhead]).toEqual(['arrow', 'arrow', null, null, null, 'arrow']);
    // a pasted stock head becomes the open arrow, and a start head never stands alone
    expect(normalOf({ type: 'arrow', startArrowhead: 'triangle', endArrowhead: null }, null, 'day')).toMatchObject({ startArrowhead: 'arrow', endArrowhead: 'arrow' });
    expect(normalOf({ type: 'arrow', startArrowhead: null, endArrowhead: 'dot' }, null, 'day')).toMatchObject({ startArrowhead: null, endArrowhead: 'arrow' });
  });

  it('6b. the whole kind and style matrix, per hand: the normal form changes nothing the map emitted, and reading it back yields no op', () => {
    // every kind, weight, fill, head, label and rotation, once for you, once for an agent, once for the unknown hand
    const state = foldDim(fixtureRows('matrix'));
    expect(new Set([...state.nodes.values()].map((n) => n.by.cls))).toEqual(new Set(['human', 'agent', 'unknown']));
    for (const theme of ['day', 'night'] as const) {
      const ids = idTable();
      const els = dimToElements(state, theme, ids);
      // (an agent's or the unknown hand's stroke is the engine's dashed `line`, S1.4 P4a)
      expect(new Set(els.map((e) => e.type))).toEqual(new Set(['frame', 'freedraw', 'line', 'text', 'rectangle', 'ellipse', 'diamond', 'arrow']));
      const completed = els.map((el) => {
        const label = el.type === 'text' && typeof el.containerId === 'string';
        const fnode = label ? undefined : state.nodes.get(ids.nodeOf(el.id));
        const by = !fnode || fnode.by.cls === 'human' ? undefined : fnode.by.cls === 'agent' ? { cls: 'agent' as const, id: fnode.by.agent!, name: fnode.by.agent! } : { cls: 'unknown' as const };
        const stamp = { line: el.customData!.gnomon.line, fill: el.customData!.gnomon.fill, ...(fnode && dimIsFallback(fnode.node) ? { kind: 'stub' as const } : {}), ...(by ? { by } : {}), ...(dimIsAgentStroke(fnode) ? { agentStroke: true as const } : {}) };
        expect(isBoardType(el.type, stamp), el.type).toBe(true);
        expect(el.type === 'line').toBe(dimIsAgentStroke(fnode));
        // a fourth disagreement would show here: the normal form may ADD keys, never change one the map set
        expect(offNormal(el, stamp, theme), `${theme} ${el.type} ${el.id}`).toBe(false);
        return { ...el, ...normalOf(el, stamp, theme) };
      });
      expect(elementsToOps(state, completed as never, ids, STYLE)).toEqual([]);
    }
  });

  it('7. a mark placed next to equal, malformed and exhausted order keys gets a legal key and never throws', () => {
    const top = 'z'.repeat(DIM_LIMITS.z);
    const rectAt = (n: number, z: unknown): unknown => add({ id: ULID(n), kind: 'rect', x: 0, y: 0, z, w: 5, h: 5 });
    const fresh = (n: number): Record<string, unknown> => ({ id: `f${n}`, type: 'ellipse', x: 0, y: 0, width: 5, height: 5 });
    const zsOf = (ops: DimOp[]): unknown[] => ops.map((o) => (o.type === 'add' ? (o.node as { z: unknown }).z : o.type === 'update' ? o.patch.z : 'V'));
    const legal = (ops: DimOp[]): void => {
      for (const z of zsOf(ops)) {
        expect(z).toMatch(DIM_Z_PATTERN);
        expect((z as string).length).toBeLessThanOrEqual(DIM_LIMITS.z);
      }
    };
    // equal keys, a malformed string and a number: one new mark in every gap
    const state = fold(opRow(2, [rectAt(1, 'V'), rectAt(2, 'V'), rectAt(3, 'V'), rectAt(4, 'not a key!'), rectAt(5, 42)]));
    const ids = idTable();
    const els = dimToElements(state, 'day', ids);
    const scene = [fresh(0), ...els.flatMap((e, i) => [e, fresh(i + 1)])];
    const ops = elementsToOps(state, scene as never, ids, STYLE);
    expect(ops.filter((o) => o.type === 'add')).toHaveLength(6);
    legal(ops);
    const v = validateDimOps(state, ops, ME);
    expect(v.refused).toEqual([]);
    // one diff is enough: the stored order is now the order on screen
    const next = foldDim([opRow(3, v.ok)], undefined, state);
    expect(elementsToOps(next, scene as never, ids, STYLE)).toEqual([]);
    expect(dimToElements(next, 'day', ids).map((e) => e.id)).toEqual(scene.map((e) => e.id));
    // exhausted: nothing fits above the top key, so the mark reuses it (ties are ordered by id) instead of throwing
    const full = fold(opRow(2, [rectAt(1, 'V'), rectAt(2, top)]));
    const ids2 = idTable();
    const onTop = [...dimToElements(full, 'day', ids2), fresh(9)];
    const last = elementsToOps(full, onTop as never, ids2, STYLE);
    expect(zsOf(last)).toEqual([top]);
    expect(validateDimOps(full, last, ME).refused).toEqual([]);
    const between = [dimToElements(full, 'day', ids2)[0]!, fresh(8), dimToElements(full, 'day', ids2)[1]!];
    legal(elementsToOps(full, between as never, ids2, STYLE));
    const src = readFileSync(path.join(ROOT, 'src', 'board', 'dim-map.ts'), 'utf8');
    expect(src).not.toMatch(/dimZBetween/);
    expect(src).toMatch(/dimZPlace\(/);
  });
});

describe('#gui-dim-map S1.4 P4a: an agent\'s stroke is the engine\'s dashed line (Aegis, S1.4 draft question 6)', () => {
  const STYLE = { line: 'ink', fill: null };
  const state = foldDim(fixtureRows('matrix'));
  const strokes = [...state.nodes].filter(([, n]) => n.node.kind === 'stroke');
  it('the map emits `line` for a stroke whose by is not human, and freedraw for the person\'s; the node stays kind stroke', () => {
    const ids = idTable();
    const els = new Map(dimToElements(state, 'day', ids).map((e) => [e.id, e]));
    expect(strokes.length).toBeGreaterThanOrEqual(3);
    for (const [nodeId, n] of strokes) {
      const el = els.get(ids.engineOf(nodeId))!;
      expect(el.type).toBe(n.by.cls === 'human' ? 'freedraw' : DIM_AGENT_STROKE_TYPE);
      expect(el.strokeStyle).toBe(n.by.cls === 'human' ? 'solid' : 'dashed');
    }
  });
  it('a `line` whose engine id is not an agent stroke of the rendered state yields NO node: a new one, one on a person\'s stroke id, one on a rect id', () => {
    const ids = idTable();
    const els = dimToElements(state, 'day', ids);
    const human = strokes.find(([, n]) => n.by.cls === 'human')!;
    const rect = [...state.nodes].find(([, n]) => n.node.kind === 'rect')!;
    // a brand-new line (the l key, a paste, a duplicate): no add
    const fresh = { id: 'new-line', type: 'line', x: 10, y: 10, width: 50, height: 0, points: [[0, 0], [50, 0]], strokeColor: '#000', strokeWidth: 2, strokeStyle: 'dashed' };
    expect(elementsToOps(state, [...els, fresh] as never, ids, STYLE)).toEqual([]);
    // the person's stroke turned into a line: not read as a mark, so it is neither edited nor re-made (and the
    // handle removes the line, normal.ts); the map never writes an op FROM it
    const asLine = els.map((e) => (e.id === ids.engineOf(human[0]) ? { ...e, type: 'line', strokeStyle: 'dashed' } : e));
    expect(elementsToOps(state, asLine as never, ids, STYLE).filter((op) => op.type !== 'delete')).toEqual([]);
    const rectLine = els.map((e) => (e.id === ids.engineOf(rect[0]) ? { ...e, type: 'line', points: [[0, 0], [5, 5]] } : e));
    expect(elementsToOps(state, rectLine as never, ids, STYLE).filter((op) => op.type === 'add' || op.type === 'update')).toEqual([]);
  });
  it('a person\'s point edit of an agent stroke is ONE points update; the validator keeps by, so the stroke stays dashed', () => {
    const ids = idTable();
    const els = dimToElements(state, 'day', ids);
    const [nodeId, n] = strokes.find(([, q]) => q.by.cls === 'agent')!;
    const edited = els.map((e) => (e.id === ids.engineOf(nodeId) ? { ...e, points: [...e.points!, [e.points!.at(-1)![0] + 30, e.points!.at(-1)![1] + 30]] } : e));
    const ops = elementsToOps(state, edited as never, ids, STYLE);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: 'update', id: nodeId });
    expect(Object.keys((ops[0] as { patch: object }).patch).sort()).toEqual(['points', 'x', 'y']);
    const r = validateDimOps(state, ops, { cls: 'human', principal: 'p:preview/matt' } as never);
    expect(r.refused ?? []).toEqual([]);
    expect(n.by.cls).toBe('agent');
  });
  it('normalOf for a line: no head at either end, tied to nothing, transparent, the dash from by; any other line is not a board type', () => {
    const by = { cls: 'agent' as const, id: 'a', name: 'a' };
    const want = normalOf({ type: 'line', startArrowhead: 'arrow', endArrowhead: 'triangle' }, { line: 'ink', fill: 'sky', by, agentStroke: true }, 'day');
    expect(want).toMatchObject({ startArrowhead: null, endArrowhead: null, startBinding: null, endBinding: null, backgroundColor: 'transparent', strokeStyle: 'dashed', roundness: null });
    expect(isBoardType('line', { line: 'ink', fill: null, by, agentStroke: true })).toBe(true);
    for (const stamp of [null, { line: 'ink', fill: null }, { line: 'ink', fill: null, by }, { line: 'ink', fill: null, agentStroke: true as const }, { line: 'ink', fill: null, by: { cls: 'human' as const }, agentStroke: true as const }]) {
      expect(isBoardType('line', stamp), JSON.stringify(stamp)).toBe(false);
      expect(offNormal({ type: 'line' }, stamp, 'day')).toBe(true);
    }
    expect(BOARD_TYPES.has('line')).toBe(false);
  });
});

describe('#gui-dim-map the drawn hand of a mark an undo re-added (Aegis ruling on P4a: human only when BOTH hands are)', () => {
  const HUMAN = { cls: 'human' as const, principal: 'p:preview/matt' };
  const AGENT = { cls: 'agent' as const, principal: 'p:gnomon/s1', agent: 'claude' };
  const UNKNOWN = { cls: 'unknown' as const, principal: 'unknown' };
  const node = (by: unknown, rf?: unknown): DimFoldNode => ({ node: { id: 'n', kind: 'stroke', x: 0, y: 0, z: 'a', points: [0, 0, 50, 0] }, by, hsid: 'h1', addedSeq: 1, ...(rf ? { restoredFrom: { id: 'old', by: rf } } : {}) }) as unknown as DimFoldNode;
  const ids: DimMapIds = { nodeOf: (e) => e, engineOf: (n) => n };
  const drawn = (n: DimFoldNode): { type: string; style: string } => {
    const st = { ...emptyDimState(), nodes: new Map([['n', n]]) } as unknown as DimState;
    const el = dimToElements(st, 'day', ids)[0]!;
    return { type: el.type, style: el.strokeStyle };
  };
  it('by agent + restoredFrom human: dashed, an agent stroke, and the hand is the agent from by', () => {
    const n = node(AGENT, HUMAN);
    expect(drawn(n)).toEqual({ type: 'line', style: 'dashed' });
    expect(dimIsAgentStroke(n)).toBe(true);
    expect(dimHandOf(n)).toBe(AGENT);
  });
  it('by human + restoredFrom agent: dashed, in the agent\'s hand (its seal)', () => {
    const n = node(HUMAN, AGENT);
    expect(drawn(n)).toEqual({ type: 'line', style: 'dashed' });
    expect(dimIsAgentStroke(n)).toBe(true);
    expect(dimHandOf(n)).toBe(AGENT);
  });
  it('both human: solid, freehand, the person\'s', () => {
    const n = node(HUMAN, { ...HUMAN });
    expect(drawn(n)).toEqual({ type: 'freedraw', style: 'solid' });
    expect(dimIsAgentStroke(n)).toBe(false);
    expect((dimHandOf(n) as { cls: string }).cls).toBe('human');
  });
  it('an unknown hand on either side: dashed, never human', () => {
    for (const n of [node(UNKNOWN, HUMAN), node(HUMAN, UNKNOWN), node(UNKNOWN, AGENT), node(AGENT, UNKNOWN)]) {
      expect(drawn(n).style).toBe('dashed');
      expect((dimHandOf(n) as { cls: string }).cls).not.toBe('human');
    }
  });
});

describe('#gui-dim-map a restore whose hand is missing (Aegis hardening)', () => {
  it('a present restoredFrom with no hand counts as the unknown hand: never by, never human', () => {
    const n = { node: { id: 'n', kind: 'stroke', x: 0, y: 0, z: 'a', points: [0, 0, 50, 0] }, by: { cls: 'human', principal: 'p:preview/matt' }, hsid: 'h1', addedSeq: 1, restoredFrom: { id: 'old' } } as unknown as DimFoldNode;
    expect((dimHandOf(n) as { cls: string }).cls).toBe('unknown');
    expect(dimIsAgentStroke(n)).toBe(true);
  });
});

