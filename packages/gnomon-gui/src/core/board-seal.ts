/**
 * @symbol #gui-board
 *
 * The author seal (design component author-seal, `derivation`): a small stamp worked out from the host-stamped
 * author id every time it is drawn. Never stored, never chosen. PURE: no DOM.
 *
 *   h    = FNV-1a 32-bit over the id's UTF-8 bytes (offset 0x811C9DC5, prime 0x01000193)
 *   cut  = h mod 5            → round, square, diamond, hex, tab
 *   bead = (h >>> 8) mod 8    → a dot on the rim where the ray from the centre at bead × 45° (0 is up, clockwise)
 *                               meets the cut
 *   letter = the first [a-z0-9] of the name part, upper-cased
 *
 * The seal is a recognition aid (5 cuts by 8 beads is 40 shapes): the name beside it is the authority.
 */
export const SEAL_CUTS = ['round', 'square', 'diamond', 'hex', 'tab'] as const;
export type SealCut = (typeof SEAL_CUTS)[number];

export interface Seal {
  /** the FNV-1a hash, unsigned */
  hash: number;
  cut: SealCut;
  /** 0 to 7 */
  bead: number;
  /** one upper-case letter or digit, or '' when the name has none */
  letter: string;
}

export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The seal of an author id. `name` is the id's name part (the text shown beside the seal); it only gives the letter. */
export function sealOf(id: string, name: string = id): Seal {
  const hash = fnv1a32(id);
  return { hash, cut: SEAL_CUTS[hash % 5]!, bead: (hash >>> 8) % 8, letter: (/[a-z0-9]/.exec(name.toLowerCase())?.[0] ?? '').toUpperCase() };
}

/** The seal's box is 18 with its centre at 9,9; the drawn viewBox is -2 -2 22 22 (the diamond and hex overhang). */
export const SEAL_CENTRE = 9;
export const SEAL_ROUND_RADIUS = 7.75;
export const SEAL_BEAD_RADIUS = 1.75;
export const SEAL_VIEWBOX = '-2 -2 22 22';
/** design `cut_geometry`, verbatim */
export const SEAL_POLYGONS: Readonly<Record<Exclude<SealCut, 'round'>, ReadonlyArray<readonly [number, number]>>> = {
  square: [[1.75, 1.75], [16.25, 1.75], [16.25, 16.25], [1.75, 16.25]],
  tab: [[1.75, 1.75], [16.25, 1.75], [16.25, 11.5], [9, 17.5], [1.75, 11.5]],
  diamond: [[9, -1.5], [19.5, 9], [9, 19.5], [-1.5, 9]],
  hex: [[4, 1.75], [14, 1.75], [19.5, 9], [14, 16.25], [4, 16.25], [-1.5, 9]],
};
/** The letter's baseline: 12.75, and 12 in the tab (its foot is pointed). */
export const sealLetterBaseline = (cut: SealCut): number => (cut === 'tab' ? 12 : 12.75);

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Where the bead sits: the point of the cut's rim on the ray from the centre at bead × 45° (0 is up, clockwise). */
export function sealBeadPoint(cut: SealCut, bead: number): { x: number; y: number } {
  const a = ((bead % 8) * Math.PI) / 4;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  if (cut === 'round') return { x: round2(SEAL_CENTRE + SEAL_ROUND_RADIUS * dx), y: round2(SEAL_CENTRE + SEAL_ROUND_RADIUS * dy) };
  const pts = SEAL_POLYGONS[cut];
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    const ex = x2 - x1;
    const ey = y2 - y1;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((x1 - SEAL_CENTRE) * ey - (y1 - SEAL_CENTRE) * ex) / den;
    const u = ((x1 - SEAL_CENTRE) * dy - (y1 - SEAL_CENTRE) * dx) / den;
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
  }
  return { x: round2(SEAL_CENTRE + best * dx), y: round2(SEAL_CENTRE + best * dy) };
}

/** `9eec954e · square · bead 5 · A`: the form the design's test vectors are written in. */
export const sealVector = (s: Seal): string => `${s.hash.toString(16).padStart(8, '0')} · ${s.cut} · bead ${s.bead} · ${s.letter}`;
