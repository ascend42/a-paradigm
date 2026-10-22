// S5.3: the Workshop cap, a closed shape checked by the kernel's mod-block gate and again by the GUI.
import { describe, expect, it } from 'vitest';
import { CAP_KEYS, CAP_LABEL_MAX, CAP_SHAPES, CAP_STATES, CLIENT_API_ID, KIT_ID, MOD_ABI_ID, checkCap, computeClientApiId, computeKitId, computeModAbiId } from '../src/index.js';

const good = { shape: 'tall', hue: 3, filled: true, state: 'working', label: 'builder' };

describe('checkCap (#gnomon-contracts, S5)', () => {
  it('accepts the five fields and returns a fresh object holding exactly them', () => {
    const r = checkCap(good);
    expect(r).toEqual({ ok: true, cap: good });
    if (r.ok) expect(r.cap).not.toBe(good);
    expect(CAP_KEYS).toEqual(['shape', 'hue', 'filled', 'state', 'label']);
    expect(CAP_SHAPES).toEqual(['tall', 'wide', 'floppy']);
    expect(CAP_STATES).toEqual(['needs', 'working', 'idle', 'knot']);
    for (const shape of CAP_SHAPES) for (const state of CAP_STATES) expect(checkCap({ ...good, shape, state }).ok).toBe(true);
  });
  it('refuses unknown keys, missing keys and anything that is not a plain object', () => {
    for (const extra of ['d', 'path', 'svg', 'style', 'fill', 'color', 'class', 'href', 'onclick', '__proto__x']) expect(checkCap({ ...good, [extra]: 'x' }), extra).toMatchObject({ ok: false, why: `cap.${extra} is not a cap field` });
    for (const k of CAP_KEYS) {
      const o: Record<string, unknown> = { ...good };
      delete o[k];
      expect(checkCap(o), k).toMatchObject({ ok: false, why: `cap.${k} is required` });
    }
    for (const v of [null, undefined, 'tall', 3, [good], new Map(), new (class X { shape = 'tall' })()]) expect(checkCap(v).ok).toBe(false);
    expect(checkCap(JSON.parse('{"shape":"tall","hue":1,"filled":true,"state":"idle","label":"x","__proto__":{"d":"M0"}}')).ok).toBe(false);
  });
  it('refuses out-of-range or wrongly typed values', () => {
    for (const hue of [-1, 6, 7, 1.5, NaN, Infinity, '2', null]) expect(checkCap({ ...good, hue }).ok, String(hue)).toBe(false);
    for (const shape of ['TALL', 'pointy', '', 0]) expect(checkCap({ ...good, shape }).ok).toBe(false);
    for (const state of ['bob', 'streaming', 'failed', 'Working']) expect(checkCap({ ...good, state }).ok).toBe(false);
    for (const filled of [1, 'true', null]) expect(checkCap({ ...good, filled }).ok).toBe(false);
    for (const label of ['', 'a'.repeat(CAP_LABEL_MAX + 1), 'two\nlines', 'a\u2028b', 7]) expect(checkCap({ ...good, label }).ok).toBe(false);
    expect(checkCap({ ...good, label: '\u{1F3A9}'.repeat(CAP_LABEL_MAX) }).ok).toBe(true); // code points, not UTF-16 units
  });
  it('moves no id: kitId, modAbiId and clientApiId are the frozen values', () => {
    // the pinned values before S5 (schemas/client-api.ids.json; the Workshop's echoed modAbiId)
    expect(computeKitId()).toBe(KIT_ID);
    expect(KIT_ID).toBe('sha256:3d3f917de8f745846f4e7216583bdb6bdef4a966aff62a152c26d730dccecf9a');
    expect(computeClientApiId()).toBe(CLIENT_API_ID);
    expect(CLIENT_API_ID).toBe('sha256:f01dc9efc9b0910466b837e203d222932f156f296b414da1b5f59481a36bd1c1');
    expect(computeModAbiId()).toBe(MOD_ABI_ID);
    expect(MOD_ABI_ID).toBe('sha256:7aaf92f46dc35fc35141557c1f89088958f220e6bf53ea31a630bb06430ba082');
  });
});
