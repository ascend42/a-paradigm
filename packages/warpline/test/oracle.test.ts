/**
 * oracle.test — the Oracle on two real refs of THIS repo, plus a synthetic
 * fixture that exhibits the headline `divergeMeaningOnly` cell via the algebra.
 */

import { describe, it, expect } from 'vitest';
import { oracle, score } from '../src/oracle.js';
import { predict } from '../src/predict.js';
import type { SemDelta, SemDeltaSet } from '../src/sem-delta.js';

describe('oracle — real branches', () => {
  it('produces a valid OracleRecord with a verdict and a partitioned matrix', async () => {
    const record = await oracle('HEAD~1', 'HEAD', { noWrite: true });
    expect(record.schemaVersion).toBe(1);
    expect(['CONVERGENT', 'DIVERGENT']).toContain(record.convergence.verdict);
    expect(record.stateIds.A.startsWith('state:v0:')).toBe(true);
    expect(record.justifications.A.schemaVersion).toBe(1);

    // The confusion-matrix cells must PARTITION their universe — no symbol may
    // appear in two cells (no double-count).
    const c = record.convergence;
    const all = [
      ...c.agreeClean,
      ...c.agreeConflict,
      ...c.divergeGitOnly,
      ...c.divergeMeaningOnly,
    ];
    const unique = new Set(all);
    expect(unique.size).toBe(all.length);

    // score is |agree| / |agree ∪ diverge| in [0,1].
    expect(c.score).toBeGreaterThanOrEqual(0);
    expect(c.score).toBeLessThanOrEqual(1);
  });
});

describe('score — confusion-matrix partition (every cell positively exercised)', () => {
  // Before this, agreeConflict was never positively asserted and divergeGitOnly was
  // only ever asserted toEqual([]) — so a regression that mislabeled a real git
  // conflict as meaning-only, or folded agreeConflict into agreeClean, passed the
  // whole suite. These tests feed score() synthetic inputs that land ONE symbol in
  // each git×meaning quadrant. (T-2026-06-24-006)
  it('classifies all four quadrants, incl. agreeConflict and divergeGitOnly', () => {
    const prediction = {
      autoClean: ['kc'], // resolved to '#clean' via states below
      knots: [
        { stableKey: 'kb', symbol: '#both', conflictingSlots: ['x'] },
        { stableKey: 'km', symbol: '#meaningOnly', conflictingSlots: ['y'] },
      ],
      dangling: [],
    };
    const conflictSymbols = ['#both', '#gitOnly']; // git-conflicted symbol names
    // states only feed the autoClean stableKey → symbol-name resolution.
    const states = [{ objects: new Map([['kc', { stableKey: 'kc', symbol: '#clean' }]]) }] as any;

    const c = score(prediction, conflictSymbols, states);

    // The two previously-uncovered cells:
    expect(c.agreeConflict).toEqual(['#both']);     // meaning ∧ git
    expect(c.divergeGitOnly).toEqual(['#gitOnly']); // git ∧ ¬meaning
    // The well-covered cells, re-pinned so the partition is complete:
    expect(c.divergeMeaningOnly).toEqual(['#meaningOnly']); // meaning ∧ ¬git
    expect(c.agreeClean).toEqual(['#clean']);               // ¬meaning ∧ ¬git
    // No symbol double-counted.
    const all = [...c.agreeClean, ...c.agreeConflict, ...c.divergeGitOnly, ...c.divergeMeaningOnly];
    expect(new Set(all).size).toBe(all.length);
    // A populated DIVERGE cell ⇒ DIVERGENT.
    expect(c.verdict).toBe('DIVERGENT');
  });

  it('a git conflict that is ALSO a meaning knot is agreeConflict (agreement), NOT a divergence', () => {
    // The mislabel guard: dropping the m∧g check would misfile this symbol into
    // divergeMeaningOnly or divergeGitOnly and flip the verdict to DIVERGENT.
    const prediction = {
      autoClean: [],
      knots: [{ stableKey: 'k1', symbol: '#shared', conflictingSlots: ['gate'] }],
      dangling: [],
    };
    const c = score(prediction, ['#shared'], [] as any);
    expect(c.agreeConflict).toEqual(['#shared']);
    expect(c.divergeMeaningOnly).toEqual([]);
    expect(c.divergeGitOnly).toEqual([]);
    // git and meaning AGREE there's a conflict ⇒ the oracle is CONVERGENT.
    expect(c.verdict).toBe('CONVERGENT');
  });

  // T-2026-06-25-001 — the "lies green" guard. Before the fix, gitReality.conflicted
  // never reached score(), so a git conflict in a NON-SYMBOL file (or an unresolvable
  // merge) read CONVERGENT / score 1 — the worst failure for a divergence detector.
  it('git conflict on a NON-SYMBOL path ⇒ DIVERGENT, never green (the lies-green guard)', () => {
    const prediction = { autoClean: [], knots: [], dangling: [] };
    const c = score(prediction, [], [] as any, {
      gitConflicted: true,
      unmappedConflictPaths: ['README.md'],
      pathsEnumerated: true,
    });
    expect(c.gitConflictUnmapped).toEqual(['README.md']);
    expect(c.verdict).toBe('DIVERGENT'); // was CONVERGENT before the fix
    expect(c.score).toBeLessThan(1);
  });

  it('git conflicted but NO enumerable evidence ⇒ INDETERMINATE → DIVERGENT, not green', () => {
    const prediction = { autoClean: [], knots: [], dangling: [] };
    const c = score(prediction, [], [] as any, {
      gitConflicted: true,
      unmappedConflictPaths: [],
      pathsEnumerated: false,
    });
    expect(c.verdict).toBe('DIVERGENT');
    expect(c.score).toBeLessThan(1);
  });

  it('no git conflict (gitReality omitted) ⇒ unchanged: CONVERGENT when meaning is clean', () => {
    const prediction = { autoClean: [], knots: [], dangling: [] };
    const c = score(prediction, [], [] as any);
    expect(c.verdict).toBe('CONVERGENT');
    expect(c.gitConflictUnmapped).toEqual([]);
  });
});

describe('predict — the algebra (synthetic fixtures)', () => {
  function changed(key: string, symbol: string, essAfter: string, slots: string[], cs: Partial<SemDelta['changeset']>): SemDelta {
    return {
      kind: 'contract-changed',
      stableKey: key,
      symbol,
      essenceBefore: 'essence:v0:before',
      essenceAfter: essAfter,
      changedSlots: slots,
      changeset: {
        gatesAdded: [],
        gatesRemoved: [],
        signalsAdded: [],
        signalsRemoved: [],
        aspectsAdded: [],
        aspectsRemoved: [],
        statesAdded: [],
        statesRemoved: [],
        componentTypeChanged: false,
        kindChanged: false,
        edgesAdded: [],
        edgesRemoved: [],
        stepsChanged: false,
        bodyChanged: false,
        ...cs,
      },
    };
  }
  function setOf(deltas: SemDelta[]): SemDeltaSet {
    return { deltas: new Map(deltas.map((d) => [d.stableKey, d])), renames: [] };
  }

  it('disjoint slots on the same key COMMUTE → autoClean (A adds gate, B adds signal)', () => {
    const a = setOf([changed('k', '#x', 'essence:v0:A', ['gates'], { gatesAdded: ['^new'] })]);
    const b = setOf([changed('k', '#x', 'essence:v0:B', ['signals'], { signalsAdded: ['!new'] })]);
    const p = predict(a, b);
    expect(p.knots.length).toBe(0);
    expect(p.dangling.length).toBe(0);
    expect(p.autoClean).toContain('k');
  });

  it('same slot, opposite members → KNOT', () => {
    const a = setOf([changed('k', '#x', 'essence:v0:A', ['gates'], { gatesAdded: ['^g'] })]);
    const b = setOf([changed('k', '#x', 'essence:v0:B', ['gates'], { gatesRemoved: ['^g'] })]);
    const p = predict(a, b);
    expect(p.knots.length).toBe(1);
    expect(p.knots[0].symbol).toBe('#x');
  });

  it('identical convergent change both sides → autoClean (not a knot)', () => {
    const a = setOf([changed('k', '#x', 'essence:v0:SAME', ['gates'], { gatesAdded: ['^g'] })]);
    const b = setOf([changed('k', '#x', 'essence:v0:SAME', ['gates'], { gatesAdded: ['^g'] })]);
    const p = predict(a, b);
    expect(p.knots.length).toBe(0);
    expect(p.autoClean).toContain('k');
  });

  it('edge-add to a target the other side retired → DANGLE (and dangle wins over knot)', () => {
    const retire: SemDelta = {
      kind: 'symbol-retired',
      stableKey: 'tgt',
      symbol: '#gone',
      essenceBefore: 'essence:v0:gone',
    };
    const a = setOf([retire]);
    const b = setOf([
      changed('ref', '#consumer', 'essence:v0:B', ['edges'], {
        edgesAdded: [{ kind: 'uses', targetSymbol: '#gone' }],
      }),
    ]);
    const p = predict(a, b);
    expect(p.dangling.length).toBe(1);
    expect(p.dangling[0].danglingTargetSymbol).toBe('#gone');
    expect(p.dangling[0].fromSymbol).toBe('#consumer');
  });

  it('divergeMeaningOnly: a knot that git would merge clean (the headline cell)', () => {
    // Build a knot prediction, hand the scorer an empty git-conflict set → the
    // knot lands in divergeMeaningOnly.
    const a = setOf([changed('k', '#x', 'essence:v0:A', ['componentType'], { componentTypeChanged: true })]);
    const b = setOf([changed('k', '#x', 'essence:v0:B', ['componentType'], { componentTypeChanged: true })]);
    const p = predict(a, b);
    expect(p.knots.length).toBe(1);
    // Simulate the scoring contract: knot symbol with NO git conflict.
    const meaningConflict = new Set(p.knots.map((k) => k.symbol));
    const gitConflict = new Set<string>();
    const divergeMeaningOnly = [...meaningConflict].filter((s) => !gitConflict.has(s));
    expect(divergeMeaningOnly).toContain('#x');
  });
});
