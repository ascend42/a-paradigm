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
    expect(MOD_ABI_ID).toBe('sha256:7aaf92f46dc35fc35141557c1f89088958f220e6bf53ea31a630bb06430ba082');
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
