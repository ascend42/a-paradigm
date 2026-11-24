/**
 * The ONE dimension clientApiId move (S1.2): what it publishes, what it leaves alone, and the version pins.
 * kitId and modAbiId do not move here (their literals are also held in cap.test.ts and mod-abi.test.ts).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_API_DESCRIPTOR, CLIENT_API_ID, CONTENT_RESERVED_COLOURS, CONTENT_SWATCH_NAMES, CONTENT_SWATCHES, CONTRACT_SCHEMAS, DIM_CORE_KINDS, DIM_HASH_VECTOR_HASH, DIM_HASH_VECTOR_ROWS, DIM_ID_PATTERN,
  DROPPED_REF_SCHEMES, FIRST_PARTY_DISPLAY_NAMES, FIRST_PARTY_MOD_NAMES, ID_PATTERNS, ID_PREFIXES, KIT_ID, MOD_ABI_ID, OFFER_REACHES, PACKAGE_REF_SCHEMES, REF_V1_JSON_PATTERN,
  computeClientApiId, computeKitId, computeModAbiId, dimHash, foldDim, isKnownKind, isModId, validateOfferSpecV1,
} from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = (...p: string[]): any => JSON.parse(fs.readFileSync(path.join(here, '..', ...p), 'utf8'));
const copy = (): any => JSON.parse(JSON.stringify(CLIENT_API_DESCRIPTOR));

describe('the dimension clientApiId move', () => {
  it('pins: clientApiId moved once; kitId and modAbiId did not move', () => {
    expect(CLIENT_API_ID).toBe('sha256:0d6b5f1a43af00225dff0478b85f872e326ee33deae162bddc7bc8e6c4304ee1');
    expect(KIT_ID).toBe('sha256:3d3f917de8f745846f4e7216583bdb6bdef4a966aff62a152c26d730dccecf9a');
    expect(MOD_ABI_ID).toBe('sha256:cc5625dac7fdbc8a987ed0295991e553710137ec65c5f20623daab1d035dc49a');
    expect(computeKitId()).toBe(KIT_ID);
    expect(computeModAbiId()).toBe(MOD_ABI_ID);
    // parsed, never bytes
    expect(readJson('schemas', 'client-api.ids.json')).toEqual({ kitId: KIT_ID, clientApiId: CLIENT_API_ID });
  });

  it('the descriptor carries the shape and the fold vector, and the vector is true', () => {
    const d = (CLIENT_API_DESCRIPTOR as any).dimension;
    expect(Object.keys(d)).toEqual(['shape', 'palette']);
    expect(d.shape.schemaVersion).toBe('dim-shape:v1');
    expect(d.shape.modId).toBe('gnomon.dimension');
    expect(d.shape.coreKinds).toEqual([...DIM_CORE_KINDS]);
    expect(d.shape.surfaces).toEqual(['gui', 'cli', 'bridge', 'voice']);
    expect(d.shape.byClasses).toEqual(['human', 'agent', 'unknown']);
    expect(d.shape.hashVector.hash).toBe(DIM_HASH_VECTOR_HASH);
    expect(dimHash(foldDim(JSON.parse(JSON.stringify(d.shape.hashVector.rows))))).toBe(d.shape.hashVector.hash);
    expect(d.shape.hashVector.rows).toEqual(JSON.parse(JSON.stringify(DIM_HASH_VECTOR_ROWS)));
    expect(isKnownKind(d.shape.kinds.op)).toBe(true);
    expect(isModId(d.shape.modId)).toBe(true);
  });

  it('a changed vocabulary moves clientApiId', () => {
    const more = copy();
    more.dimension.shape.coreKinds.push('hexagon');
    expect(computeClientApiId(more)).not.toBe(CLIENT_API_ID);
    const vec = copy();
    vec.dimension.shape.hashVector.hash = `sha256:${'0'.repeat(64)}`;
    expect(computeClientApiId(vec)).not.toBe(CLIENT_API_ID);
    const name = copy();
    name.dimension.palette.swatches.push('amber');
    expect(computeClientApiId(name)).not.toBe(CLIENT_API_ID);
    expect(computeClientApiId(copy())).toBe(CLIENT_API_ID);
  });

  it('the palette is in the descriptor as protocol only: names and the custom pattern, never a colour value', () => {
    const p = (CLIENT_API_DESCRIPTOR as any).dimension.palette;
    expect(p).toEqual({ schemaVersion: 'content-palette:v1', swatches: [...CONTENT_SWATCH_NAMES], customPattern: '^custom:#[0-9A-Fa-f]{6}$' });
    const text = JSON.stringify((CLIENT_API_DESCRIPTOR as any).dimension).toUpperCase();
    const values = [...CONTENT_SWATCHES.flatMap((s) => [...Object.values(s.day), ...Object.values(s.night)]), ...Object.values(CONTENT_RESERVED_COLOURS.day), ...Object.values(CONTENT_RESERVED_COLOURS.night)];
    expect(values.length).toBeGreaterThan(40);
    for (const v of values) expect(text.includes(v.toUpperCase())).toBe(false);
    for (const k of ['MINDISTANCE', 'RESERVED', 'LFROM', 'CMAX', 'NIGHT']) expect(text.includes(k)).toBe(false);
  });

  it('reserved first-party names: the seven of the dimension mod and its mediums', () => {
    const seven = ['dimension', 'dimensions', 'dim', 'dims', 'board', 'boards', 'doodle'];
    for (const n of seven) {
      expect(FIRST_PARTY_MOD_NAMES).toContain(n);
      expect(FIRST_PARTY_DISPLAY_NAMES).toContain(n);
      expect((CLIENT_API_DESCRIPTOR as any).desk.modId.firstPartyDisplayNames).toContain(n);
    }
    expect(FIRST_PARTY_MOD_NAMES).toEqual(['workshop', 'ledger', 'paradigm-context', 'neurons', 'constellation', ...seven]);
    // the grammar itself still admits them: the refusal for a non-gnomon publisher is the manifest loader's
    expect(isModId('gnomon.dimension')).toBe(true);
    expect(isModId('acme.dimmer')).toBe(true);
  });

  it('ref schemes: dim is registered, doodle is dropped, and the generated pattern follows', () => {
    expect(PACKAGE_REF_SCHEMES).toEqual(['spec', 'sym', 'wl', 'n', 's', 'td', 'l', 't', 'knot', 'dim']);
    expect(DROPPED_REF_SCHEMES).toEqual(['voice', 'doodle']);
    expect(REF_V1_JSON_PATTERN.includes('|dim)')).toBe(true);
    expect(REF_V1_JSON_PATTERN.includes('doodle')).toBe(false);
    expect(JSON.stringify(CONTRACT_SCHEMAS).includes('doodle')).toBe(false);
  });

  it('ids and kinds: dim replaces ds; paradigm.dimension.exported replaces paradigm.doodle.exported', () => {
    expect(ID_PREFIXES.dim).toBe('dim:');
    expect('ds' in ID_PREFIXES).toBe(false);
    expect(ID_PATTERNS.dim.source).toBe(DIM_ID_PATTERN.source);
    expect(ID_PATTERNS.dim.test('dim:01JVA1D0000000000000000001')).toBe(true);
    expect(isKnownKind('paradigm.dimension.exported')).toBe(true);
    expect(isKnownKind('paradigm.doodle.exported')).toBe(false);
  });

  it("reach: 'canvas' is published (the manifest loader keeps it inert until boards raised by offer ship)", () => {
    expect(OFFER_REACHES).toEqual(['mcp', 'canvas']);
    const spec = { kind: 'map', phase: 'diverge', title: 'Map it', summary: 's', contextIn: [], resultOut: 'r', reach: 'canvas', handoffTool: 'open', related: [], restraint: 'r' };
    expect(validateOfferSpecV1(spec)).toEqual([]);
    expect(validateOfferSpecV1({ ...spec, reach: 'http' }).length).toBeGreaterThan(0);
    expect(readJson('schemas', 'offer-spec.v1.schema.json').properties.reach.enum).toEqual(['mcp', 'canvas']);
  });

  it('version pins: contracts 1.1.0 and the exact dependency pins on it', () => {
    expect(readJson('package.json').version).toBe('1.1.0');
    for (const pkg of ['gnomon', 'gnomon-gui', 'gnomon-mod-sdk', 'gnomon-voice']) {
      const p = readJson('..', pkg, 'package.json');
      const pin = { ...p.dependencies, ...p.devDependencies }['@a-company/gnomon-contracts'];
      expect([pkg, pin]).toEqual([pkg, '1.1.0']);
    }
  });
});

describe('the modAbiId move (S1.2 C1, C2): relayedFor per method', () => {
  it('pins: modAbiId moved once; kitId and clientApiId did not move', async () => {
    const m = await import('../src/index.js');
    expect(m.MOD_ABI_ID).toBe('sha256:cc5625dac7fdbc8a987ed0295991e553710137ec65c5f20623daab1d035dc49a');
    expect(m.KIT_ID).toBe('sha256:3d3f917de8f745846f4e7216583bdb6bdef4a966aff62a152c26d730dccecf9a');
    expect(m.CLIENT_API_ID).toBe('sha256:0d6b5f1a43af00225dff0478b85f872e326ee33deae162bddc7bc8e6c4304ee1');
    // modAbiId is not an input of clientApiId, and the relays are untouched
    const d = JSON.parse(JSON.stringify(m.MOD_ABI_DESCRIPTOR));
    d.relayedFor.fields['tool.call'].push('nickname');
    expect(m.computeModAbiId(d)).not.toBe(m.MOD_ABI_ID);
    expect(m.computeClientApiId()).toBe(m.CLIENT_API_ID);
  });

  it('the dimension contract and the mod ABI agree: surfaces, fields and the append key', async () => {
    const m = await import('../src/index.js');
    const surfaces = [...m.RELAYED_FOR_SURFACES['command.run'], ...m.RELAYED_FOR_SURFACES['tool.call']];
    expect(surfaces).toEqual([...m.DIM_SURFACES]);
    // DimRowRelayedFor's keys (dim.ts) are exactly the union of the per-method fields
    const row: Required<import('../src/dim.js').DimRowRelayedFor> = { principal: 'p', connId: 'c', surface: 'gui', agent: 'a', hsid: 'h', turn: 't' };
    const union = new Set<string>(Object.values(m.RELAYED_FOR_FIELDS).flat());
    expect(new Set(Object.keys(row))).toEqual(union);
    expect(m.RELAYED_FOR_APPEND_KEY).toBe('relayedFor');
    expect(m.MOD_ABI_DESCRIPTOR.relayedFor.appendKey).toBe('relayedFor');
    expect(m.MOD_ABI_DESCRIPTOR.relayedFor.identity).toEqual({ fields: ['hsid', 'turn'], onlyFor: ['first-party', 'log.read'] });
    expect(m.MOD_ABI_RPCS.find((r) => r.method === 'tool.call')!.params).toEqual(['name', 'input', 'cancelToken', 'callId', 'relayedFor']);
    expect(m.MOD_ABI_RPCS.length).toBeLessThanOrEqual(m.MOD_ABI_MAX_RPCS);
  });

  it('pickRelayedFor keeps only the method fields, drops identity unless entitled, and never invents a value', async () => {
    const { pickRelayedFor, RELAYED_FOR_VALUE_MAX } = await import('../src/index.js');
    const all = { principal: 'p:n/x', connId: 'conn:1', surface: 'gui', agent: 'kit', hsid: 'hsid-1', turn: 'turn:hsid-1/2', principalClass: 'human', extra: 'x' };
    expect(pickRelayedFor('view.render', all, true)).toEqual({ principal: 'p:n/x', connId: 'conn:1' });
    expect(pickRelayedFor('command.run', all, true)).toEqual({ principal: 'p:n/x', connId: 'conn:1', surface: 'gui' });
    expect(pickRelayedFor('command.run', { ...all, surface: 'cli' }, false)).toEqual({ principal: 'p:n/x', connId: 'conn:1', surface: 'cli' });
    // a surface the method may not carry is dropped, not coerced
    expect(pickRelayedFor('command.run', { ...all, surface: 'bridge' }, false)).toEqual({ principal: 'p:n/x', connId: 'conn:1' });
    expect(pickRelayedFor('tool.call', all, true)).toEqual({ principal: 'p:n/x', agent: 'kit', hsid: 'hsid-1', turn: 'turn:hsid-1/2' });
    const tool = { ...all, surface: 'bridge' };
    expect(pickRelayedFor('tool.call', tool, true)).toEqual({ principal: 'p:n/x', surface: 'bridge', agent: 'kit', hsid: 'hsid-1', turn: 'turn:hsid-1/2' });
    expect(pickRelayedFor('tool.call', tool, false)).toEqual({ principal: 'p:n/x', surface: 'bridge', agent: 'kit' });
    expect(pickRelayedFor('tool.call', { ...tool, surface: 'voice' }, false).surface).toBe('voice');
    // non-strings, empty strings, over-long values, inherited keys and a missing source
    const proto = Object.create({ principal: 'p:inherited/x' }) as Record<string, unknown>;
    proto.surface = 'bridge';
    expect(pickRelayedFor('tool.call', proto, true)).toEqual({ surface: 'bridge' });
    expect(pickRelayedFor('tool.call', { principal: 7, surface: 'bridge', agent: '', hsid: null, turn: 'x'.repeat(RELAYED_FOR_VALUE_MAX + 1) }, true)).toEqual({ surface: 'bridge' });
    expect(pickRelayedFor('tool.call', { principal: 'x'.repeat(RELAYED_FOR_VALUE_MAX), surface: 'bridge' }, true).principal).toHaveLength(RELAYED_FOR_VALUE_MAX);
    for (const none of [null, undefined, 'p:x' as unknown as Record<string, unknown>]) expect(pickRelayedFor('command.run', none, true)).toEqual({});
    const out = pickRelayedFor('command.run', all, false);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.isFrozen(all)).toBe(false);
  });

  it('a row stamped by pickRelayedFor folds as the right hand; a stamp missing principal or surface folds as unknown', async () => {
    const m = await import('../src/index.js');
    const fold = (relayedFor: Record<string, string>): string => {
      const s = m.foldDim([
        { seq: 1, kind: m.DIM_KINDS.start, payload: { v: 1, dim: 'dim:01JVA1D0000000000000000001', title: 't', attached: ['h'], opened: 'command' } },
        { seq: 2, kind: m.DIM_KINDS.op, payload: { v: 1, dim: 'dim:01JVA1D0000000000000000001', ops: [{ type: 'add', node: { id: '01JVA1D0000000000000000002', kind: 'rect', x: 0, y: 0, z: 'V', w: 1, h: 1 } }], relayedFor } },
      ]);
      return s.nodes.get('01JVA1D0000000000000000002')!.by.cls;
    };
    const raw = { principal: 'p:n/x', connId: 'conn:1', surface: 'gui', agent: 'kit', hsid: 'h', turn: 't' };
    expect(fold(m.pickRelayedFor('command.run', raw, false))).toBe('human');
    expect(fold(m.pickRelayedFor('tool.call', { ...raw, surface: 'bridge' }, false))).toBe('agent');
    expect(fold(m.pickRelayedFor('tool.call', { ...raw, surface: 'voice' }, true))).toBe('agent');
    expect(fold(m.pickRelayedFor('command.run', { ...raw, surface: 'telepathy' }, false))).toBe('unknown');
    expect(fold(m.pickRelayedFor('command.run', { connId: 'conn:1', surface: 'gui' }, false))).toBe('unknown');
    // view.render never carries a surface, so it can never vouch for a written row
    expect(fold(m.pickRelayedFor('view.render', raw, true))).toBe('unknown');
    // a tool stamp without the host-known agent label vouches for nobody: never an agent row, never a human one
    expect(fold(m.pickRelayedFor('tool.call', { principal: 'p:n/x', surface: 'bridge' }, false))).toBe('unknown');
    expect(fold({ principal: 'p:n/x', surface: 'voice' })).toBe('unknown');
    // an agent label on a client surface is still drawn as an agent (the cautious reading)
    expect(fold({ principal: 'p:n/x', surface: 'gui', agent: 'kit' })).toBe('agent');
  });
});
