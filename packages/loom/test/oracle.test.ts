/**
 * oracle.test — the Oracle on two real refs of THIS repo, plus a synthetic
 * fixture that exhibits the headline `divergeMeaningOnly` cell via the algebra.
 */

import { describe, it, expect } from 'vitest';
import { oracle } from '../src/oracle.js';
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
