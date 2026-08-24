/**
 * rank.test — PARITY for #rank (SP1b of `refusal:v1`).
 *
 * `partitionKnots` lived in cli.ts and was the only consumer of the
 * direct-vs-ripple rule (T-2026-07-03-002). SP1b moved the rule into the engine
 * so #refusal ranks its contested set identically. The risk of that move is
 * SILENT BEHAVIOUR DRIFT: the ranking decides which knots a human sees named and
 * which collapse to a count, and the committed 275-merge base-rate evidence was
 * gathered under the old partition. So the test is not "rankVerdicts works" — it
 * is "rankVerdicts is INDISTINGUISHABLE from the code it replaced".
 *
 * The oracle below is the pre-SP1b cli.ts implementation, verbatim.
 */

import { describe, it, expect } from 'vitest';
import { rankVerdicts, rankOf } from '../src/fabric/rank.js';
import type { Knot, Dangle } from '../src/predict.js';

/** The implementation cli.ts carried before SP1b, VERBATIM — the parity oracle. */
function partitionKnotsLegacy(knots: Knot[]): { direct: Knot[]; ripple: Knot[] } {
  const direct: Knot[] = [];
  const ripple: Knot[] = [];
  for (const k of knots) (k.direct ?? true ? direct : ripple).push(k);
  return { direct, ripple };
}

const knot = (stableKey: string, direct: boolean | undefined): Knot => ({
  stableKey,
  symbol: `#${stableKey}`,
  conflictingSlots: ['body'],
  ...(direct === undefined ? {} : { direct }),
});

/** Every arrangement of the three possible `direct` states, at several lengths. */
function corpus(): Knot[][] {
  const flags: Array<boolean | undefined> = [true, false, undefined];
  const sets: Knot[][] = [[]];
  // all 1-, 2- and 3-element flag sequences
  for (const a of flags) {
    sets.push([knot('a', a)]);
    for (const b of flags) {
      sets.push([knot('a', a), knot('b', b)]);
      for (const c of flags) sets.push([knot('a', a), knot('b', b), knot('c', c)]);
    }
  }
  // an avalanche: 2 direct buried under 40 ripple, both orderings
  const many = Array.from({ length: 40 }, (_, i) => knot(`r${i}`, false));
  sets.push([...many, knot('d0', true), knot('d1', undefined)]);
  sets.push([knot('d0', true), ...many, knot('d1', undefined)]);
  return sets;
}

describe('rankVerdicts — parity with the pre-SP1b cli.ts partitionKnots', () => {
  it('produces the identical partition for every corpus input', () => {
    for (const knots of corpus()) {
      const got = rankVerdicts(knots);
      const want = partitionKnotsLegacy(knots);
      expect(got.direct.map((k) => k.stableKey)).toEqual(want.direct.map((k) => k.stableKey));
      expect(got.ripple.map((k) => k.stableKey)).toEqual(want.ripple.map((k) => k.stableKey));
    }
  });

  it('returns the SAME OBJECTS, not copies (the CLI reads k.symbol off them)', () => {
    const input = [knot('a', true), knot('b', false)];
    const { direct, ripple } = rankVerdicts(input);
    expect(direct[0]).toBe(input[0]);
    expect(ripple[0]).toBe(input[1]);
  });

  it('preserves input order within each bucket', () => {
    const input = [knot('z', true), knot('a', true), knot('m', false), knot('b', false)];
    const { direct, ripple } = rankVerdicts(input);
    expect(direct.map((k) => k.stableKey)).toEqual(['z', 'a']);
    expect(ripple.map((k) => k.stableKey)).toEqual(['m', 'b']);
  });

  it('partitions — every input lands in exactly one bucket, none invented', () => {
    for (const knots of corpus()) {
      const { direct, ripple } = rankVerdicts(knots);
      expect(direct.length + ripple.length).toBe(knots.length);
      expect(new Set([...direct, ...ripple]).size).toBe(knots.length);
    }
  });

  it('does not mutate its input', () => {
    const input = [knot('a', true), knot('b', false)];
    const before = JSON.stringify(input);
    rankVerdicts(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('rankOf — the shared rule', () => {
  it('reads an ABSENT flag as direct: unknown is surfaced, never collapsed', () => {
    // Silently bucketing an unlabelled knot as ripple would let a consumer hide
    // a genuinely contested unit behind a count line.
    expect(rankOf({ direct: undefined })).toBe('direct');
    expect(rankOf({})).toBe('direct');
  });

  it('maps true → direct and false → ripple', () => {
    expect(rankOf({ direct: true })).toBe('direct');
    expect(rankOf({ direct: false })).toBe('ripple');
  });

  it('applies to dangles with the same rule as knots (uniform consumer contract)', () => {
    const d: Dangle = {
      fromKey: 'k',
      fromSymbol: '#s',
      edgeKind: 'calls',
      danglingTargetSymbol: '#gone',
      retiredBy: 'A',
      direct: false,
    };
    expect(rankOf(d)).toBe('ripple');
  });

  it('agrees with rankVerdicts for every knot in the corpus', () => {
    for (const knots of corpus()) {
      const { direct, ripple } = rankVerdicts(knots);
      for (const k of direct) expect(rankOf(k)).toBe('direct');
      for (const k of ripple) expect(rankOf(k)).toBe('ripple');
    }
  });
});
