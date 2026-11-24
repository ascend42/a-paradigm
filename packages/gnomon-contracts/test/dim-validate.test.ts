/**
 * G-DDL-11: the strict write validator. Closed keys per kind, integer and range refusals, relations, agent
 * ownership, the ref allowlist (C3) and the secret check (C4). Odd characters are written as \u escapes.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DIM_CORE_KINDS, DIM_FIELDS, DIM_KINDS, DIM_LIMITS, DIM_NODE_KEYS, DIM_NODE_REQUIRED, DIM_REF_PATTERN, DIM_REF_SCHEMES, DIM_REFUSAL_CODES, DIM_REFUSAL_FIXES,
  dimHash, dimTextForScan, emptyDimState, foldDim, validateDimOps, validateDimRef, type DimActor, type DimRow, type DimState,
} from '../src/dim.js';
import { validateRefV1 } from '../src/ref.js';
import { CONTENT_SWATCH_NAMES } from '../src/content-palette.js';

const DIM = 'dim:01JVA1D0000000000000000001';
const id = (n: number): string => `01JVA1D00000000000000000${String(n).padStart(2, '0')}`;
const human: DimActor = { cls: 'human', principal: 'p:t/human' };
const agent: DimActor = { cls: 'agent', principal: 'p:t/session', agent: 'kit' };
const other: DimActor = { cls: 'agent', principal: 'p:t/session', agent: 'arky' };
const stamp = (a: DimActor): Record<string, unknown> => (a.cls === 'agent' ? { principal: a.principal, surface: 'bridge', agent: a.agent } : { principal: a.principal, surface: 'gui' });
const base: DimRow[] = [
  { seq: 1, kind: DIM_KINDS.start, payload: { v: 1, dim: DIM, title: 'T', attached: ['h1'], opened: 'command', relayedFor: stamp(human) } },
  { seq: 2, kind: DIM_KINDS.op, payload: { v: 1, dim: DIM, relayedFor: stamp(human), ops: [
    { type: 'add', node: { id: id(1), kind: 'frame', x: 0, y: 0, z: 'A', w: 500, h: 500 } },
    { type: 'add', node: { id: id(2), kind: 'rect', x: 10, y: 10, z: 'B', w: 50, h: 50 } },
  ] } },
  { seq: 3, kind: DIM_KINDS.op, payload: { v: 1, dim: DIM, relayedFor: stamp(agent), ops: [
    { type: 'add', node: { id: id(3), kind: 'text', x: 20, y: 20, z: 'C', text: 'mine' } },
    { type: 'add', node: { id: id(4), kind: 'arrow', x: 0, y: 0, z: 'D', points: [0, 0, 5, 5] } },
  ] } },
];
const state: DimState = foldDim(base);
const rect = (n: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id: id(n), kind: 'rect', x: 0, y: 0, z: 'M', w: 10, h: 10, ...extra });
const codes = (ops: unknown, actor: DimActor = human, s: DimState = state): string[] => validateDimOps(s, ops, actor).refused.map((r) => `${r.code}@${r.field}`);
const add = (node: unknown): unknown[] => [{ type: 'add', node }];

describe('G-DDL-11: closed writes', () => {
  it('a minimal add of every core kind passes, and the result folds', () => {
    const nodes: Record<string, unknown>[] = [
      { id: id(10), kind: 'stroke', x: 0, y: 0, z: 'E', points: [0, 0] },
      rect(11, { fill: 'lemon', color: 'graphite', label: '', parent: id(1), rot: 3599, weight: 3, refs: ['sym:#gui'] }),
      { ...rect(12), kind: 'ellipse', fill: 'paper' },
      { ...rect(13), kind: 'diamond', fill: 'custom:#1e90ff' },
      { id: id(14), kind: 'arrow', x: 0, y: 0, z: 'F', points: [0, 0, 1, 1], head: 'both', from: id(2), to: id(11), rel: 'leads-to', label: 'x' },
      { id: id(15), kind: 'text', x: 0, y: 0, z: 'G', text: 't', size: 4, w: 100, color: 'custom:#1E90FF' },
      { id: id(16), kind: 'frame', x: -1_000_000_000, y: 1_000_000_000, z: 'H', w: 1, h: 1_000_000_000, title: 'F' },
    ];
    expect(nodes.map((n) => n.kind)).toEqual([...DIM_CORE_KINDS]);
    const res = validateDimOps(state, nodes.map((node) => ({ type: 'add', node })), human);
    expect(res.refused).toEqual([]);
    expect(res.ok).toHaveLength(7);
    const next = foldDim([{ seq: 4, kind: DIM_KINDS.op, payload: { v: 1, dim: DIM, ops: res.ok, relayedFor: stamp(human) } }], undefined, state);
    expect(next.nodes.size).toBe(11);
    expect(next.unapplied).toBe(0);
    expect(dimHash(next)).not.toBe(dimHash(state));
  });

  it('closed keys: every key outside the kind\'s list is refused, including by and relayedFor', () => {
    for (const kind of DIM_CORE_KINDS) {
      const all = new Set(Object.values(DIM_NODE_KEYS).flat());
      for (const k of all) {
        if (DIM_NODE_KEYS[kind].includes(k)) continue;
        const res = codes(add({ id: id(20), kind, x: 0, y: 0, z: 'M', [k]: 1 }));
        expect(res).toContain(`field-unknown@${k}`);
      }
    }
    expect(codes(add(rect(20, { by: { cls: 'human' } })))).toEqual(['field-unknown@unknown']);
    expect(codes(add(rect(20, { relayedFor: { principal: 'p:evil/x' } })))).toEqual(['field-unknown@unknown']);
    expect(codes(add(rect(20, { link: 'x', customData: {} })))).toEqual(['field-unknown@unknown', 'field-unknown@unknown']);
    expect(codes([{ type: 'add', node: rect(20), actor: 'me' }])).toEqual(['field-unknown@unknown']);
    expect(codes([{ type: 'update', id: id(2), patch: { text: 'no' } }])).toEqual(['field-unknown@text']);
    expect(codes([{ type: 'update', id: id(2), patch: { id: id(9) } }])).toEqual(['field-unknown@id']);
    expect(codes([{ type: 'update', id: id(2), patch: { kind: 'text' } }])).toEqual(['field-unknown@kind']);
    expect(codes([{ type: 'delete', id: id(2), cascade: true }])).toEqual(['field-unknown@unknown']);
  });

  it('required fields, types and ranges', () => {
    for (const kind of DIM_CORE_KINDS) {
      const res = codes(add({ kind }));
      expect(res).toEqual(DIM_NODE_REQUIRED[kind].filter((k) => k !== 'kind').map((k) => `field-missing@${k}`));
    }
    expect(codes(add({ id: id(20) }))).toEqual(['field-missing@kind']);
    expect(codes([{ type: 'add' }])).toEqual(['field-missing@node']);
    const bad: Array<[Record<string, unknown>, string]> = [
      [{ x: 1.5 }, 'field-type@x'], [{ y: '1' }, 'field-type@y'], [{ x: 1_000_000_001 }, 'field-range@x'], [{ y: -1_000_000_001 }, 'field-range@y'],
      [{ x: Number.MAX_SAFE_INTEGER + 2 }, 'field-type@x'], [{ w: 0 }, 'field-range@w'], [{ h: -1 }, 'field-range@h'], [{ w: 1_000_000_001 }, 'field-range@w'],
      [{ rot: 3600 }, 'field-range@rot'], [{ rot: -1 }, 'field-range@rot'], [{ rot: 0.5 }, 'field-type@rot'], [{ weight: 4 }, 'field-range@weight'], [{ weight: 0 }, 'field-range@weight'],
      [{ label: 'x'.repeat(201) }, 'field-range@label'], [{ label: 5 }, 'field-type@label'], [{ label: null }, 'field-type@label'],
      [{ z: '' }, 'z-bad@z'], [{ z: 'A0' }, 'z-bad@z'], [{ z: 'a b' }, 'z-bad@z'], [{ z: 'z'.repeat(65) }, 'z-bad@z'], [{ z: 5 }, 'z-bad@z'],
      [{ id: 'short' }, 'id-bad@id'], [{ id: id(2) }, 'id-exists@id'], [{ id: 'I'.repeat(26) }, 'id-bad@id'],
    ];
    for (const [extra, want] of bad) expect(codes(add(rect(20, extra)))).toEqual([want]);
    const text = (extra: Record<string, unknown>): unknown[] => add({ id: id(20), kind: 'text', x: 0, y: 0, z: 'M', text: 't', ...extra });
    expect(codes(text({ text: '' }))).toEqual(['field-range@text']);
    expect(codes(text({ text: 'x'.repeat(4001) }))).toEqual(['field-range@text']);
    expect(codes(text({ size: 5 }))).toEqual(['field-range@size']);
    const stroke = (points: unknown): unknown[] => add({ id: id(20), kind: 'stroke', x: 0, y: 0, z: 'M', points });
    expect(codes(stroke([]))).toEqual(['field-range@points']);
    expect(codes(stroke([1, 2, 3]))).toEqual(['field-range@points']);
    expect(codes(stroke([1, 2.5]))).toEqual(['field-type@points']);
    expect(codes(stroke([1, 2_000_000_000]))).toEqual(['field-range@points']);
    expect(codes(stroke(new Array(4098).fill(0)))).toEqual(['field-range@points']);
    expect(codes(stroke('0,0'))).toEqual(['field-type@points']);
    expect(codes(add({ id: id(20), kind: 'arrow', x: 0, y: 0, z: 'M', points: [0, 0] }))).toEqual(['field-range@points']);
    expect(codes(add({ id: id(20), kind: 'arrow', x: 0, y: 0, z: 'M', points: [0, 0, 1, 1], head: 'start' }))).toEqual(['field-range@head']);
    expect(codes(add({ id: id(20), kind: 'arrow', x: 0, y: 0, z: 'M', points: [0, 0, 1, 1], rel: 'Leads To' }))).toEqual(['field-range@rel']);
    expect(codes(add({ id: id(20), kind: 'frame', x: 0, y: 0, z: 'M', w: 1, h: 1, title: 'x'.repeat(121) }))).toEqual(['field-range@title']);
  });

  it('ops, op types and the 64-op limit', () => {
    expect(codes('nope')).toEqual(['field-type@ops']);
    expect(codes([null])).toEqual(['field-type@op']);
    expect(codes([{ type: 'lock', ids: [id(2)] }, { type: 'unlock', ids: [id(2)] }, { type: 'clear', scope: 'all' }])).toEqual(['op-not-available@type', 'op-not-available@type', 'op-not-available@type']);
    expect(codes([{ type: 'explode' }, { type: 5 }, {}])).toEqual(['op-unknown@type', 'op-unknown@type', 'op-unknown@type']);
    const many = (n: number): unknown[] => Array.from({ length: n }, (_, i) => ({ type: 'add', node: rect(30 + i) }));
    expect(validateDimOps(state, many(64), human).ok).toHaveLength(64);
    const over = validateDimOps(state, many(65), human);
    expect(over.ok).toEqual([]);
    expect(over.refused.map((r) => [r.index, r.code])).toEqual([[-1, 'too-many-ops']]);
    expect(DIM_LIMITS.opsPerRow).toBe(64);
  });

  it('update, move and delete', () => {
    expect(codes([{ type: 'update', id: id(2), patch: { label: 'ok', fill: null, x: 5 } }])).toEqual([]);
    expect(codes([{ type: 'update', id: id(2), patch: { w: null } }])).toEqual(['field-missing@w']);
    expect(codes([{ type: 'update', id: id(2), patch: {} }])).toEqual(['field-missing@patch']);
    expect(codes([{ type: 'update', id: id(2) }])).toEqual(['field-missing@patch']);
    expect(codes([{ type: 'update', id: id(2), patch: [] }])).toEqual(['field-type@patch']);
    expect(codes([{ type: 'update', id: id(9), patch: { x: 1 } }])).toEqual(['id-missing@id']);
    expect(codes([{ type: 'update', id: 'x', patch: { x: 1 } }])).toEqual(['id-bad@id']);
    expect(codes([{ type: 'move', ids: [id(2), id(3)], dx: 5, dy: -5 }])).toEqual([]);
    expect(codes([{ type: 'move', ids: [], dx: 0, dy: 0 }])).toEqual(['field-range@ids']);
    expect(codes([{ type: 'move', ids: [id(2), id(2)], dx: 0, dy: 0 }])).toEqual(['field-range@ids']);
    expect(codes([{ type: 'move', ids: Array.from({ length: 65 }, (_, i) => id(i)), dx: 0, dy: 0 }])).toEqual(['field-range@ids']);
    expect(codes([{ type: 'move', ids: [id(2)], dx: 0.5, dy: 0 }])).toEqual(['field-type@dx']);
    expect(codes([{ type: 'move', ids: [id(2)], dx: 0 }])).toEqual(['field-missing@dy']);
    expect(codes([{ type: 'move', ids: [id(2)], dx: 1_000_000_000, dy: 0 }])).toEqual(['field-range@ids']);
    expect(codes([{ type: 'move', ids: [id(9)], dx: 1, dy: 1 }])).toEqual(['id-missing@ids']);
    expect(codes([{ type: 'delete', id: id(9) }])).toEqual(['id-missing@id']);
    expect(codes([{ type: 'delete', id: id(2) }, { type: 'add', node: rect(2) }])).toEqual(['id-exists@id']);
  });

  it('relations: from, to and parent name live nodes; parent is a frame; a frame has no parent', () => {
    const arrow = (extra: Record<string, unknown>): unknown[] => add({ id: id(20), kind: 'arrow', x: 0, y: 0, z: 'M', points: [0, 0, 1, 1], ...extra });
    expect(codes(arrow({ from: id(2), to: id(3) }))).toEqual([]);
    expect(codes(arrow({ from: id(9) }))).toEqual(['link-missing@from']);
    expect(codes(arrow({ to: id(20) }))).toEqual(['link-missing@to']);
    expect(codes(arrow({ to: 'nope' }))).toEqual(['id-bad@to']);
    expect(codes(add(rect(20, { parent: id(1) })))).toEqual([]);
    expect(codes(add(rect(20, { parent: id(2) })))).toEqual(['parent-bad@parent']);
    expect(codes(add(rect(20, { parent: id(9) })))).toEqual(['parent-bad@parent']);
    expect(codes(add({ id: id(20), kind: 'frame', x: 0, y: 0, z: 'M', w: 1, h: 1, parent: id(1) }))).toEqual(['parent-bad@parent']);
    expect(codes([{ type: 'update', id: id(1), patch: { parent: id(1) } }])).toEqual(['parent-bad@parent']);
    // a later op may cite an id an earlier op in the same batch added; a deleted one is gone at once
    expect(codes([{ type: 'add', node: rect(20) }, ...arrow({ id: id(21), from: id(20) })])).toEqual([]);
    expect(codes([...arrow({ id: id(21), from: id(20) }), { type: 'add', node: rect(20) }])).toEqual(['link-missing@from']);
    expect(codes([{ type: 'delete', id: id(2) }, ...arrow({ from: id(2) })])).toEqual(['link-missing@from']);
    // a refused op does not enter the running state
    const res = validateDimOps(state, [{ type: 'add', node: rect(20, { w: 0 }) }, ...arrow({ id: id(21), from: id(20) })], human);
    expect(res.ok).toEqual([]);
    expect(res.refused.map((r) => [r.index, r.code])).toEqual([[0, 'field-range'], [1, 'link-missing']]);
  });

  it('ownership: an agent edits only its own marks; a human edits anything', () => {
    expect(codes([{ type: 'update', id: id(3), patch: { text: 'again' } }, { type: 'move', ids: [id(4)], dx: 1, dy: 1 }, { type: 'delete', id: id(3) }], agent)).toEqual([]);
    expect(codes([{ type: 'update', id: id(2), patch: { label: 'x' } }], agent)).toEqual(['not-owner@id']);
    expect(codes([{ type: 'move', ids: [id(3), id(2)], dx: 1, dy: 1 }], agent)).toEqual(['not-owner@ids']);
    expect(codes([{ type: 'delete', id: id(1) }], agent)).toEqual(['not-owner@id']);
    expect(codes([{ type: 'delete', id: id(3) }], other)).toEqual(['not-owner@id']);
    expect(codes([{ type: 'delete', id: id(3) }], { ...agent, principal: 'p:t/elsewhere' })).toEqual(['not-owner@id']);
    expect(codes([{ type: 'delete', id: id(3) }], { cls: 'agent', principal: 'p:t/session' })).toEqual(['not-owner@id']);
    expect(codes([{ type: 'delete', id: id(3) }], { cls: 'robot', principal: 'p:t/session', agent: 'kit' } as unknown as DimActor)).toEqual(['not-owner@id']);
    expect(codes([{ type: 'delete', id: id(3) }, { type: 'update', id: id(4), patch: { label: 'h' } }], human)).toEqual([]);
    // an agent may add, then edit what it just added, in one batch
    expect(codes([{ type: 'add', node: rect(20) }, { type: 'update', id: id(20), patch: { label: 'x' } }], agent)).toEqual([]);
    // nobody owns an unvouched mark but a human
    const s = foldDim([{ seq: 4, kind: DIM_KINDS.op, payload: { v: 1, dim: DIM, ops: [{ type: 'add', node: rect(20) }] } }], undefined, state);
    expect(s.nodes.get(id(20))!.by.cls).toBe('unknown');
    expect(codes([{ type: 'delete', id: id(20) }], agent, s)).toEqual(['not-owner@id']);
    expect(codes([{ type: 'delete', id: id(20) }], human, s)).toEqual([]);
  });

  it('colour: a failing colour is refused, never stored, and the refusal may name a swatch', () => {
    expect(codes(add(rect(20, { color: 'lemon' })))).toEqual(['colour-bad@color']);
    expect(codes(add(rect(20, { fill: 'ink' })))).toEqual(['colour-bad@fill']);
    expect(codes(add(rect(20, { color: '#ff0000' })))).toEqual(['colour-bad@color']);
    expect(codes(add(rect(20, { color: 'custom:#f00' })))).toEqual(['colour-bad@color']);
    expect(codes(add(rect(20, { fill: 'custom:#16150F' })))).toEqual(['colour-bad@fill']);
    expect(codes(add(rect(20, { color: 'custom:#16150F' })))).toEqual([]);
    const res = validateDimOps(state, add(rect(20, { color: 'custom:#B4382A', fill: 'custom:#5b4fd6' })), human);
    expect(res.ok).toEqual([]);
    expect(res.refused.map((r) => [r.field, r.code, r.swatch])).toEqual([['color', 'colour-bad', 'raspberry'], ['fill', 'colour-bad', 'cobalt']]);
    for (const r of res.refused) expect(CONTENT_SWATCH_NAMES).toContain(r.swatch);
    expect(validateDimOps(state, add(rect(20, { fill: 'custom:#2A2925' })), human).refused[0]!.swatch).toBeUndefined();
  });

  it('fix is a fixed sentence per code and never echoes input; every code and field is from the closed lists', () => {
    const marker = 'ZQXJ-marker-9731';
    const hostile: unknown[] = [
      { type: marker }, { type: 'add', node: { ...rect(20), [marker]: marker } }, { type: 'add', node: { ...rect(21), kind: marker } }, { type: 'add', node: rect(22, { color: marker, fill: `custom:${marker}`, label: 5, refs: [marker, `${marker}:x`], z: marker, parent: marker }) },
      { type: 'update', id: marker, patch: {} }, { type: 'update', id: id(2), patch: { [marker]: 1 } }, { type: 'move', ids: [marker], dx: 1, dy: 1 }, { type: 'delete', id: marker, [marker]: 1 }, { [marker]: marker },
    ];
    const res = validateDimOps(state, hostile, agent);
    expect(res.refused.length).toBeGreaterThan(10);
    expect(JSON.stringify(res).includes(marker)).toBe(false);
    for (const r of res.refused) {
      expect(DIM_REFUSAL_CODES).toContain(r.code);
      expect(DIM_FIELDS).toContain(r.field);
      expect(r.fix).toBe(DIM_REFUSAL_FIXES[r.code]);
    }
    expect(Object.keys(DIM_REFUSAL_FIXES).sort()).toEqual([...DIM_REFUSAL_CODES].sort());
    expect(new Set(Object.values(DIM_REFUSAL_FIXES)).size).toBe(DIM_REFUSAL_CODES.length);
  });

  it('validation does not change the input state or the input ops', () => {
    const before = dimHash(state);
    const ops = [{ type: 'add', node: rect(20) }, { type: 'delete', id: id(2) }];
    const snap = JSON.stringify(ops);
    const res = validateDimOps(state, ops, human);
    expect(dimHash(state)).toBe(before);
    expect(state.nodes.has(id(2))).toBe(true);
    expect(JSON.stringify(ops)).toBe(snap);
    expect(res.ok).toEqual(ops);
    expect(res.ok[0]).not.toBe(ops[0]);
  });
});

describe('C3: refs', () => {
  const refs = (list: unknown): string[] => codes(add(rect(20, { refs: list })));

  it('accepts one of each allowlisted scheme, and each is also a strict ref:v1', () => {
    const good = ['sym:#gui', 'sym:$dimension-session', 'spec:gnomon/12.7', 'td:TD-2026-11-24-500', 'l:L-2026-11-24-ascend-073653-001', 't:T-12', 'n:some-neuron', 's:01ABC', 'wl:fabric/row.7@42', 'knot:k-1', 'dim:01JVA1D0000000000000000001@12'];
    expect(new Set(good.map((r) => r.split(':')[0]))).toEqual(new Set(DIM_REF_SCHEMES));
    for (const r of good) {
      expect(validateDimRef(r)).toBeNull();
      expect(validateRefV1(r)).toEqual([]);
    }
    expect(refs(good.slice(0, 8))).toEqual([]);
  });

  it('refuses every scheme outside the list, malformed ids, long refs, a ninth ref and a duplicate', () => {
    const cases: Array<[unknown, string]> = [
      ['card:01JVA1D0000000000000000001', 'ref-scheme'], ['permit:v1:abc', 'ref-scheme'], ['gkey:abc', 'ref-scheme'], ['hsid:abc', 'ref-scheme'], ['doodle:abc', 'ref-scheme'],
      ['ev:01JVA1D0000000000000000001', 'ref-scheme'], ['peer:log:x/sym:#a', 'ref-scheme'], ['turn:h/1', 'ref-scheme'], ['http://example.invalid/x', 'ref-scheme'], ['javascript:alert(1)', 'ref-scheme'],
      [`sym:${'a'.repeat(125)}`, 'ref-too-long'], ['sym:a b', 'ref-bad'], ['sym:a//b', 'ref-bad'], ['sym:../x', 'ref-bad'], ['sym:a/../b', 'ref-bad'], ['#foo', 'ref-bad'], ['TD-2026-11-24-500', 'ref-bad'],
      ['sym:', 'ref-bad'], ['sym:.hidden', 'ref-bad'], ['sym:a@', 'ref-bad'], ['sym:a@b@c', 'ref-bad'], ['sym:a?b=c', 'ref-bad'], ['sym:a%2Fb', 'ref-bad'], ['sym:a\u200bb', 'ref-bad'], ['SYM:a', 'ref-bad'], [7, 'ref-bad'], [null, 'ref-bad'], ['', 'ref-bad'],
    ];
    for (const [r, want] of cases) {
      expect(validateDimRef(r)).toBe(want);
      expect(refs([r])).toEqual([`${want}@refs`]);
    }
    expect(validateDimRef(`sym:${'a'.repeat(124)}`)).toBeNull();
    expect(refs(Array.from({ length: 9 }, (_, i) => `sym:a${i}`))).toEqual(['ref-count@refs']);
    expect(refs(['sym:a', 'sym:a'])).toEqual(['ref-count@refs']);
    expect(refs('sym:a')).toEqual(['field-type@refs']);
    expect(DIM_REF_PATTERN.source.startsWith(`^(${DIM_REF_SCHEMES.join('|')}):`)).toBe(true);
  });

  it('a ref holding a secret pattern is refused as a secret', () => {
    const res = validateDimOps(state, add(rect(20, { refs: ['sym:AKIAABCDEFGHIJKLMNOP'] })), human);
    expect(res.secret).toBe(true);
    expect(res.ok).toEqual([]);
    expect(res.refused.map((r) => [r.code, r.field, r.rule])).toEqual([['secret', 'refs', 'aws-access-key']]);
  });
});

describe('C4: the secret check', () => {
  // assembled at run time so no credential-shaped literal sits in the repo
  const KEY = ['sk', 'ant', 'api03', 'Zq8'.repeat(8)].join('-');
  const AWS = `AKIA${'Q7RX'.repeat(4)}`;
  const text = (t: string, n = 20): unknown => ({ type: 'add', node: { id: id(n), kind: 'text', x: 0, y: 0, z: 'M', text: t } });
  const expectSecret = (ops: unknown[], s: DimState = state, rule?: string): void => {
    const res = validateDimOps(s, ops, human);
    expect(res.secret).toBe(true);
    expect(res.ok).toEqual([]);
    expect(res.refused.length).toBeGreaterThan(0);
    for (const r of res.refused) expect(r.code).toBe('secret');
    if (rule) expect(res.refused.map((r) => r.rule)).toContain(rule);
    const out = JSON.stringify(res);
    for (const part of [KEY, AWS, KEY.slice(0, 16), KEY.slice(-12), 'Q7RXQ7RX']) expect(out.includes(part)).toBe(false);
  };

  it('a key in text, in a label, and in a nested array', () => {
    expectSecret([text(`note ${KEY} end`)], state, 'anthropic-key');
    expectSecret(add(rect(20, { label: `use ${AWS}` })), state, 'aws-access-key');
    expectSecret(add(rect(20, { refs: ['sym:ok', `sym:${AWS}`] })));
    expectSecret(add(rect(20, { carried: [[{ deep: [`x ${KEY}`] }]] })));
    expectSecret([{ type: 'update', id: id(2), patch: { label: 'password = hunter2hunter2' } }], state, 'generic-secret');
    expectSecret([{ type: 'move', ids: [id(2)], dx: 0, dy: 0, note: KEY }]);
  });

  it('the batch is all-or-nothing', () => {
    const res = validateDimOps(state, [{ type: 'add', node: rect(20) }, text(KEY, 21), { type: 'add', node: rect(22, { w: 0 }) }], human);
    expect(res).toMatchObject({ ok: [], secret: true });
    expect(new Set(res.refused.map((r) => `${r.index}:${r.code}:${r.field}`))).toEqual(new Set(['1:secret:text']));
  });

  it('zero-width characters, bidi marks, a soft hyphen and a newline inside the key', () => {
    const cut = (sep: string): string => `${KEY.slice(0, 9)}${sep}${KEY.slice(9, 20)}${sep}${KEY.slice(20)}`;
    for (const sep of ['\u200b', '\u200d', '\u200c', '\u2060', '\ufeff', '\u00ad', '\u202e', '\u2028', '\u2029', '\n', '\r\n', '\t', '\u0000', '\u{e0041}']) {
      expect(cut(sep)).not.toBe(KEY);
      expect(dimTextForScan(cut(sep))).toBe(KEY);
      expectSecret([text(cut(sep))], state, 'anthropic-key');
    }
  });

  it('fullwidth forms (NFKC)', () => {
    const wide = [...KEY].map((c) => (c >= '!' && c <= '~' ? String.fromCodePoint(c.codePointAt(0)! + 0xfee0) : c)).join('');
    expect(wide).not.toBe(KEY);
    expect(wide.startsWith('\uff53\uff4b\uff0d')).toBe(true);
    expectSecret([text(wide)], state, 'anthropic-key');
    expectSecret([text(`\uff21\uff2b\uff29\uff21${AWS.slice(4)}`)], state, 'aws-access-key');
  });

  it('split over two updates, in one batch and across two rows', () => {
    const a = KEY.slice(0, 14).toLowerCase();
    const full = `${a}${KEY.slice(14)}`;
    expect(/^[a-z][a-z0-9-]{0,31}$/.test(a)).toBe(true);
    const first = { type: 'update', id: id(4), patch: { rel: a } };
    const second = { type: 'update', id: id(4), patch: { label: KEY.slice(14) } };
    expect(validateDimOps(state, [first], human)).toMatchObject({ secret: false, refused: [] });
    expect(validateDimOps(state, [second], human)).toMatchObject({ secret: false, refused: [] });
    const res = validateDimOps(state, [first, second], human);
    expect(res).toMatchObject({ ok: [], secret: true });
    expect(res.refused.map((r) => [r.index, r.code, r.field])).toContainEqual([1, 'secret', 'unknown']);
    expect(JSON.stringify(res).includes(full.slice(8, 24))).toBe(false);
    // the first half is already stored by an earlier row; the second arrives later
    const stored = foldDim([{ seq: 4, kind: DIM_KINDS.op, payload: { v: 1, dim: DIM, ops: [first], relayedFor: stamp(human) } }], undefined, state);
    expect(validateDimOps(stored, [second], human)).toMatchObject({ ok: [], secret: true });
    // either order of the two halves is found: every ordered pair of the node's strings is read
    expect(validateDimOps(state, [{ type: 'update', id: id(4), patch: { label: `${a}` } }, { type: 'update', id: id(4), patch: { rel: KEY.slice(14).toLowerCase() } }], human).secret).toBe(true);
    // stated residual: halves that never sit next to each other (a scheme prefix between them) are not found
    expect(validateDimOps(state, [{ type: 'update', id: id(4), patch: { label: AWS.slice(0, 10) } }, { type: 'update', id: id(4), patch: { refs: [`sym:${AWS.slice(10)}`] } }], human).secret).toBe(false);
  });

  it('split over two fields of one node', () => {
    const a = KEY.slice(0, 14).toLowerCase();
    const arrow = { id: id(20), kind: 'arrow', x: 0, y: 0, z: 'M', points: [0, 0, 1, 1], rel: a, label: KEY.slice(14) };
    expectSecret(add(arrow));
    // a carried node of a later version with text and label: an add that tries it is refused as a secret first
    expectSecret(add({ id: id(22), kind: 'rect', x: 0, y: 0, z: 'M', w: 1, h: 1, label: KEY.slice(0, 12), text: KEY.slice(12) }));
    // split with zero-width characters on top
    expectSecret(add({ ...arrow, id: id(23), label: `\u200b${KEY.slice(14, 20)}\u200d${KEY.slice(20)}` }));
  });

  it('a node that already matches by itself (an old or later-version row) does not block a clean edit of it', () => {
    const carried = foldDim([{ seq: 4, kind: DIM_KINDS.op, payload: { v: 2, dim: DIM, relayedFor: stamp(human), ops: [{ type: 'add', node: { id: id(30), kind: 'arrow', x: 0, y: 0, z: 'M', points: [0, 0, 1, 1], rel: KEY.slice(0, 14).toLowerCase(), label: KEY.slice(14) } }] } }], undefined, state);
    expect(carried.nodes.has(id(30))).toBe(true);
    expect(validateDimOps(carried, [{ type: 'move', ids: [id(30)], dx: 1, dy: 1 }], human)).toMatchObject({ secret: false, refused: [] });
    expect(validateDimOps(carried, [{ type: 'update', id: id(30), patch: { head: 'both' } }], human)).toMatchObject({ secret: false, refused: [] });
    expect(validateDimOps(carried, [{ type: 'delete', id: id(30) }], human)).toMatchObject({ secret: false, refused: [] });
    expect(validateDimOps(carried, [{ type: 'add', node: rect(30) }], human)).toMatchObject({ secret: false, refused: [{ code: 'id-exists' }] });
    // but writing a NEW credential onto it is still refused
    expect(validateDimOps(carried, [{ type: 'update', id: id(30), patch: { label: `x ${AWS}` } }], human).secret).toBe(true);
  });

  it('J3: a move re-reads no node; scan work for a 64-op move batch over 64 text nodes is linear in the ops', () => {
    const texts = Array.from({ length: 64 }, (_, i) => ({ type: 'add', node: { id: id(30 + i), kind: 'arrow', x: 0, y: 0, z: 'M', points: [0, 0, 1, 1], rel: 'leads-to', label: `note ${i}`, refs: ['sym:a', 'sym:b', 'sym:c'] } }));
    const board = foldDim([{ seq: 4, kind: DIM_KINDS.op, payload: { v: 1, dim: DIM, ops: texts, relayedFor: stamp(human) } }], undefined, state);
    expect(board.nodes.size).toBe(state.nodes.size + 64);
    const all = texts.map((t) => t.node.id);
    let scans = 0;
    const moves = Array.from({ length: 64 }, () => ({ type: 'move', ids: all, dx: 1, dy: 1 }));
    const res = validateDimOps(board, moves, human, { scan: () => (scans++, []) });
    expect(res.refused).toEqual([]);
    expect(res.ok).toHaveLength(64);
    // each move op is read once for its own strings (its type and 64 ids); the moved nodes are never re-read
    expect(scans).toBe(64 * 65);
    // an update still reads the node it touches (joined and pairwise), and a move after it does not
    scans = 0;
    validateDimOps(board, [{ type: 'update', id: all[0], patch: { label: 'x' } }], human, { scan: () => (scans++, []) });
    const forUpdate = scans;
    expect(forUpdate).toBeGreaterThan(2);
    scans = 0;
    validateDimOps(board, [{ type: 'move', ids: [all[0]], dx: 1, dy: 1 }], human, { scan: () => (scans++, []) });
    expect(scans).toBe(2);
  });

  it('an injected scanner sees normalised text, and ordinary text passes', () => {
    const seen: string[] = [];
    const res = validateDimOps(state, [text('caf\u00e9 \uff21\u200bB')], human, { scan: (t) => (seen.push(t), []) });
    expect(res.secret).toBe(false);
    expect(seen).toContain('caf\u00e9 AB');
    expect(validateDimOps(state, [text('Ship the board on Friday; ask Luna about the token colours.')], human)).toMatchObject({ secret: false, refused: [] });
    const flagged = validateDimOps(state, [text('anything')], human, { scan: () => ['custom-rule'] });
    expect(flagged.secret).toBe(true);
    expect(new Set(flagged.refused.map((r) => r.rule))).toEqual(new Set(['custom-rule']));
  });
});

describe('A13: import isolation', () => {
  it('dim.ts imports only ./internal.js, ./content-palette.js and ./secret-rules.js, and they import nothing else', () => {
    const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const importsOf = (file: string): string[] => {
      const text = fs.readFileSync(path.join(src, file), 'utf8');
      return [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/g), ...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g), ...text.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]!.split(path.sep).join('/'));
    };
    expect(importsOf('dim.ts').sort()).toEqual(['./content-palette.js', './internal.js', './secret-rules.js']);
    expect(importsOf('content-palette.ts')).toEqual(['./internal.js']);
    expect(importsOf('secret-rules.ts')).toEqual(['./internal.js']);
    expect(importsOf('internal.ts')).toEqual([]);
    for (const f of ['dim.ts', 'content-palette.ts', 'secret-rules.ts', 'internal.ts']) {
      const text = fs.readFileSync(path.join(src, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(/['"]node:|\bdocument\.|\bwindow\.|\bprocess\.|\bconsole\./.test(text)).toBe(false);
    }
  });
});
