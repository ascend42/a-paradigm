/**
 * The author seal (design component author-seal `derivation`; boards S1.1 pass B): the function is pure and its
 * ten test vectors are the design's, including the two hex cuts (quill, lux) that the first twelve names never hit.
 */
import { describe, expect, it } from 'vitest';
import { fnv1a32, SEAL_CUTS, SEAL_POLYGONS, sealBeadPoint, sealLetterBaseline, sealOf, sealVector } from '../src/core/board-seal.js';

/** design-system.yaml components.author-seal.derivation.test_vectors, verbatim */
const VECTORS: Record<string, string> = {
  arky: '9eec954e · square · bead 5 · A',
  luna: '05033d87 · tab · bead 5 · L',
  kit: '6cf7bb37 · diamond · bead 3 · K',
  mika: '867d2e5b · square · bead 6 · M',
  aegis: '560edd4c · diamond · bead 5 · A',
  loid: 'f5f3eb61 · round · bead 3 · L',
  jinx: 'b622116a · tab · bead 1 · J',
  judge: 'aae2e5a4 · tab · bead 5 · J',
  quill: 'f4468af6 · hex · bead 2 · Q',
  lux: '44920086 · hex · bead 0 · L',
};

describe('#gui-board author seal', () => {
  it.each(Object.entries(VECTORS))('%s → %s', (id, vector) => {
    expect(sealVector(sealOf(id))).toBe(vector);
  });

  it('FNV-1a 32-bit over UTF-8 bytes (offset 0x811C9DC5, prime 0x01000193)', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('é')).toBe(fnv1a32('é')); // two UTF-8 bytes, not one UTF-16 unit
    expect(fnv1a32('é')).not.toBe(fnv1a32('e'));
  });

  it('cut is h mod 5 and bead is (h >>> 8) mod 8, whatever the id looks like', () => {
    expect([...SEAL_CUTS]).toEqual(['round', 'square', 'diamond', 'hex', 'tab']);
    for (const id of ['p:abcdefgh/arky', '', '9', 'ARKY', 'a'.repeat(300)]) {
      const s = sealOf(id);
      expect(s.cut).toBe(SEAL_CUTS[s.hash % 5]);
      expect(s.bead).toBe((s.hash >>> 8) % 8);
    }
  });

  it('the letter is the first [a-z0-9] of the name part, upper-cased; the id alone decides cut and bead', () => {
    expect(sealOf('p:abcdefgh/kit', 'Kit').letter).toBe('K');
    expect(sealOf('x', '  — 7 of nine').letter).toBe('7');
    expect(sealOf('x', '…').letter).toBe('');
    expect(sealOf('same-id', 'Arky').cut).toBe(sealOf('same-id', 'Zed').cut);
    expect(sealOf('same-id', 'Arky').bead).toBe(sealOf('same-id', 'Zed').bead);
  });

  it('jinx and judge share a cut and a letter and are parted by the bead', () => {
    const [a, b] = [sealOf('jinx'), sealOf('judge')];
    expect([a.cut, a.letter]).toEqual([b.cut, b.letter]);
    expect(a.bead).not.toBe(b.bead);
  });

  it('the cut geometry is the design\'s (an 18 box, centre 9,9; the diamond and the hex are 21 across)', () => {
    expect(SEAL_POLYGONS.square.map((p) => p.join(',')).join(' ')).toBe('1.75,1.75 16.25,1.75 16.25,16.25 1.75,16.25');
    expect(SEAL_POLYGONS.tab.map((p) => p.join(',')).join(' ')).toBe('1.75,1.75 16.25,1.75 16.25,11.5 9,17.5 1.75,11.5');
    expect(SEAL_POLYGONS.diamond.map((p) => p.join(',')).join(' ')).toBe('9,-1.5 19.5,9 9,19.5 -1.5,9');
    expect(SEAL_POLYGONS.hex.map((p) => p.join(',')).join(' ')).toBe('4,1.75 14,1.75 19.5,9 14,16.25 4,16.25 -1.5,9');
    expect([sealLetterBaseline('tab'), sealLetterBaseline('square'), sealLetterBaseline('hex')]).toEqual([12, 12.75, 12.75]);
  });

  it('the bead sits where the ray at bead × 45° (0 up, clockwise) meets the cut', () => {
    // the two beads the specimen draws: arky (square, bead 5) and kit (diamond, bead 3)
    expect(sealBeadPoint('square', 5)).toEqual({ x: 1.75, y: 16.25 });
    expect(sealBeadPoint('diamond', 3)).toEqual({ x: 14.25, y: 14.25 });
    expect(sealBeadPoint('round', 0)).toEqual({ x: 9, y: 1.25 });
    expect(sealBeadPoint('round', 2)).toEqual({ x: 16.75, y: 9 });
    expect(sealBeadPoint('hex', 0)).toEqual({ x: 9, y: 1.75 }); // lux
    expect(sealBeadPoint('hex', 2)).toEqual({ x: 19.5, y: 9 }); // quill: on the right point
    expect(sealBeadPoint('tab', 4)).toEqual({ x: 9, y: 17.5 }); // the pointed foot
    for (const cut of SEAL_CUTS) for (let b = 0; b < 8; b++) expect(Number.isFinite(sealBeadPoint(cut, b).x), `${cut} ${b}`).toBe(true);
  });
});
