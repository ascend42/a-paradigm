/**
 * knot-rule.test — `KnotRule` population on every KNOT/DANGLE (SP0/SP1a of
 * `refusal:v1`, TD-2026-07-21-766 / falsifier F4).
 *
 * A KNOT verdict tells a cold agent THAT two meanings collide. `rule` tells it
 * WHICH WAY they collide — and that is different work: 'retire-vs-edit' is a
 * keep-or-drop decision, 'conflicting-slot' is a merge-the-slot decision,
 * 'born-divergent' is a pick-one decision. Without it an agent must infer the
 * shape from prose, which is precisely the capability F4 says varies by provider.
 *
 * SP1a was PURE LABELLING: the five branches already existed in `predict`, and
 * the boolean `isKnot` predicate became `knotRuleOf` returning WHICH branch
 * fired (non-null ⟺ the old `true`). So every test here asserts BOTH halves:
 *   1. the rule is present and correct, and
 *   2. the VERDICT is unchanged — same knots, same dangles, same autoClean
 *      partition. A labelling change that moved a verdict would invalidate the
 *      committed 275-merge base-rate evidence.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildSymbolIndex, type AggregationResult } from '@a-company/premise-core';
import { TsLens } from '../src/lens/ts-lens.js';
import { injectCodeUnits } from '../src/lens/lift-code-units.js';
import { buildWarpState, type WarpState } from '../src/warp/warp-state.js';
import { diff, type SemDelta, type SemDeltaSet, type ContractChangeset } from '../src/sem-delta.js';
import { predict, type KnotRule } from '../src/predict.js';

/* ── delta fixtures (pure — no lens, no disk) ────────────────────────────────── */

const cs = (over: Partial<ContractChangeset> = {}): ContractChangeset => ({
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
  ...over,
});

const set = (...ds: SemDelta[]): SemDeltaSet => ({
  deltas: new Map(ds.map((d) => [d.stableKey, d])),
  renames: [],
});

const retired = (key: string, symbol: string): SemDelta => ({
  kind: 'symbol-retired',
  stableKey: key,
  symbol,
  essenceBefore: `ess:${key}:base`,
});

const born = (key: string, symbol: string, essence: string): SemDelta => ({
  kind: 'symbol-born',
  stableKey: key,
  symbol,
  essenceAfter: essence,
});

const changed = (
  key: string,
  symbol: string,
  essence: string,
  slots: string[],
  over: Partial<ContractChangeset> = {},
): SemDelta => ({
  kind: 'contract-changed',
  stableKey: key,
  symbol,
  essenceBefore: `ess:${key}:base`,
  essenceAfter: essence,
  changedSlots: slots,
  changeset: cs(over),
  localChanged: true,
});

/** Every rule, with the delta pair that fires it. */
const RULE_CASES: Array<{ rule: KnotRule; a: SemDeltaSet; b: SemDeltaSet }> = [
  {
    // one side deletes the symbol, the other edits it.
    rule: 'retire-vs-edit',
    a: set(retired('k', '#alpha')),
    b: set(changed('k', '#alpha', 'ess:k:B', ['gates'], { gatesAdded: ['^auth'] })),
  },
  {
    // same stableKey born on BOTH sides, to different essences.
    rule: 'born-divergent',
    a: set(born('k', '#alpha', 'ess:k:A')),
    b: set(born('k', '#alpha', 'ess:k:B')),
  },
  {
    // both sides retyped the symbol's KIND, to different results.
    rule: 'both-retype',
    a: set(changed('k', '#alpha', 'ess:k:A', ['kind'], { kindChanged: true })),
    b: set(changed('k', '#alpha', 'ess:k:B', ['kind'], { kindChanged: true })),
  },
  {
    // both sides wrote the SAME scalar slot to different values.
    rule: 'conflicting-slot',
    a: set(changed('k', '#alpha', 'ess:k:A', ['body'], { bodyChanged: true })),
    b: set(changed('k', '#alpha', 'ess:k:B', ['body'], { bodyChanged: true })),
  },
];

/** A retires the edge TARGET; B adds an edge into it ⇒ dangle. */
const DANGLE_CASE = {
  a: set(retired('kt', '#target')),
  b: set(changed('kf', '#from', 'ess:kf:B', ['edges'], { edgesAdded: [{ kind: 'calls', targetSymbol: '#target' }] })),
};

// ===========================================================================
// 1. Each rule fires on its own branch, and ONLY its own branch.
// ===========================================================================
describe('predict — every knot carries the rule that produced it', () => {
  for (const { rule, a, b } of RULE_CASES) {
    it(`labels ${rule}`, () => {
      const pred = predict(a, b);
      expect(pred.knots).toHaveLength(1);
      expect(pred.knots[0].rule).toBe(rule);
      // the verdict itself is unchanged: still one knot, no dangle.
      expect(pred.dangling).toHaveLength(0);
      expect(pred.autoClean).toEqual([]);
    });
  }

  it('labels dangle-retire, and dangle still WINS precedence over knot', () => {
    const pred = predict(DANGLE_CASE.a, DANGLE_CASE.b);
    expect(pred.dangling).toHaveLength(1);
    expect(pred.dangling[0].rule).toBe('dangle-retire');
    expect(pred.dangling[0].retiredBy).toBe('A');
  });

  it('labels dangle-retire symmetrically when the OTHER side retires', () => {
    const pred = predict(DANGLE_CASE.b, DANGLE_CASE.a);
    expect(pred.dangling).toHaveLength(1);
    expect(pred.dangling[0].rule).toBe('dangle-retire');
    expect(pred.dangling[0].retiredBy).toBe('B');
  });

  it('assigns each case a DISTINCT rule (the labels actually discriminate)', () => {
    const seen = RULE_CASES.map(({ a, b }) => predict(a, b).knots[0].rule);
    expect(new Set(seen).size).toBe(RULE_CASES.length);
  });
});

// ===========================================================================
// 2. The verdict did not move — labelling is additive.
// ===========================================================================
describe('predict — labelling moved no verdict', () => {
  it('still returns NO knot where the old predicate returned false', () => {
    // both sides retire the same symbol → convergent, not a contradiction.
    expect(predict(set(retired('k', '#a')), set(retired('k', '#a'))).knots).toHaveLength(0);
    // identical convergent essence → autoClean, short-circuited before the rule.
    const conv = predict(
      set(changed('k', '#a', 'ess:same', ['body'], { bodyChanged: true })),
      set(changed('k', '#a', 'ess:same', ['body'], { bodyChanged: true })),
    );
    expect(conv.knots).toHaveLength(0);
    expect(conv.autoClean).toEqual(['k']);
    // disjoint slots on the same key commute.
    const disjoint = predict(
      set(changed('k', '#a', 'ess:k:A', ['gates'], { gatesAdded: ['^x'] })),
      set(changed('k', '#a', 'ess:k:B', ['signals'], { signalsAdded: ['!y'] })),
    );
    expect(disjoint.knots).toHaveLength(0);
    expect(disjoint.autoClean).toEqual(['k']);
  });

  it('keeps autoClean ∪ knots ∪ dangling a true PARTITION of touched keys', () => {
    for (const { a, b } of [...RULE_CASES, DANGLE_CASE]) {
      const pred = predict(a, b);
      const touched = new Set([...a.deltas.keys(), ...b.deltas.keys()]);
      const covered = [
        ...pred.autoClean,
        ...pred.knots.map((k) => k.stableKey),
        ...pred.dangling.map((d) => d.fromKey),
      ];
      expect(new Set(covered).size).toBe(covered.length); // no double-count
      expect(new Set(covered)).toEqual(touched);
    }
  });
});

// ===========================================================================
// 3. THE INVARIANT — a combinatorial sweep. Every knot/dangle predict() can
//    emit is labelled; there is no reachable unlabelled branch.
// ===========================================================================
describe('predict — the universal invariant: no unlabelled knot or dangle', () => {
  const LEGAL: KnotRule[] = ['retire-vs-edit', 'born-divergent', 'both-retype', 'conflicting-slot', 'dangle-retire'];

  /** Every delta shape one side can present for a single key. */
  const shapes: Array<(key: string, tag: string) => SemDelta> = [
    (k, t) => retired(k, `#${k}`),
    (k, t) => born(k, `#${k}`, `ess:${k}:${t}`),
    (k, t) => changed(k, `#${k}`, `ess:${k}:${t}`, ['body'], { bodyChanged: true }),
    (k, t) => changed(k, `#${k}`, `ess:${k}:${t}`, ['kind'], { kindChanged: true }),
    (k, t) => changed(k, `#${k}`, `ess:${k}:${t}`, ['gates'], { gatesAdded: ['^x'] }),
    (k, t) => changed(k, `#${k}`, `ess:${k}:${t}`, ['gates'], { gatesRemoved: ['^x'] }),
    (k, t) => changed(k, `#${k}`, `ess:${k}:${t}`, ['edges'], { edgesAdded: [{ kind: 'calls', targetSymbol: '#target' }] }),
    (k, t) => changed(k, `#${k}`, `ess:${k}:${t}`, ['edges'], { edgesRemoved: [{ kind: 'calls', targetSymbol: '#target' }] }),
    (k, t) => changed(k, `#${k}`, `ess:${k}:same`, ['body'], { bodyChanged: true }), // convergent
  ];

  it('labels every emitted knot/dangle across the full shape × shape sweep', () => {
    let knots = 0;
    let dangles = 0;
    for (const mkA of shapes) {
      for (const mkB of shapes) {
        // 'k' is the shared contested key; 'kt' lets the edge cases dangle.
        const a = set(mkA('k', 'A'), retired('kt', '#target'));
        const b = set(mkB('k', 'B'));
        const pred = predict(a, b);
        for (const knot of pred.knots) {
          knots++;
          expect(knot.rule, `unlabelled knot ${knot.stableKey}`).toBeDefined();
          expect(LEGAL).toContain(knot.rule!);
          // a dangle rule must never appear on a knot.
          expect(knot.rule).not.toBe('dangle-retire');
        }
        for (const d of pred.dangling) {
          dangles++;
          expect(d.rule, `unlabelled dangle ${d.fromKey}`).toBe('dangle-retire');
        }
      }
    }
    // guard the guard: the sweep must actually have produced both classes.
    expect(knots).toBeGreaterThan(0);
    expect(dangles).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 4. REAL CORPUS — states lifted the way `absorb` lifts them, so the assertion
//    is a statement about what the engine actually sees, not about fixtures.
// ===========================================================================
async function mkFixture(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'knot-rule-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
  }
  return dir;
}

function emptyIndex() {
  const result: AggregationResult = { symbols: [], purposeFiles: [], portalFiles: [], errors: [], timestamp: 0 };
  return buildSymbolIndex(result);
}

/** Build a real WarpState from an in-memory tree (the absorb assembly). */
async function stateOfTree(ref: string, files: Record<string, string>): Promise<WarpState> {
  const dir = await mkFixture(files);
  try {
    const units = await new TsLens().lift(dir);
    const index = emptyIndex();
    injectCodeUnits(index, units);
    return buildWarpState(index, { ref, treeSha: null, rootDir: dir });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe('predict — rule population over REAL lifted states', () => {
  it('labels a real two-sided body divergence as conflicting-slot', async () => {
    const base = await stateOfTree('base', { 'src/l.ts': `function u(){ return 1; }` });
    const a = await stateOfTree('a', { 'src/l.ts': `function u(){ return 2; }` });
    const b = await stateOfTree('b', { 'src/l.ts': `function u(){ return 3; }` });

    const pred = predict(diff(base, a), diff(base, b));
    expect(pred.knots.length).toBeGreaterThan(0);
    for (const k of pred.knots) expect(k.rule).toBe('conflicting-slot');
  }, 60_000);

  it('labels a real retire-vs-edit as retire-vs-edit', async () => {
    const base = await stateOfTree('base', {
      'src/l.ts': `function t(){ return 1; }
function keep(){ return 0; }`,
    });
    // A deletes t; B edits t.
    const a = await stateOfTree('a', { 'src/l.ts': `function keep(){ return 0; }` });
    const b = await stateOfTree('b', {
      'src/l.ts': `function t(){ return 42; }
function keep(){ return 0; }`,
    });

    const pred = predict(diff(base, a), diff(base, b));
    expect(pred.knots.length).toBeGreaterThan(0);
    for (const k of pred.knots) expect(k.rule).toBe('retire-vs-edit');
  }, 60_000);

  it('labels a real dangle (edge into a retired target) as dangle-retire', async () => {
    const base = await stateOfTree('base', {
      'src/l.ts': `function t(){ return 1; }
function r(){ return 0; }`,
    });
    // A retires t; B points r at t — the broken ref git is blind to.
    const a = await stateOfTree('a', { 'src/l.ts': `function r(){ return 0; }` });
    const b = await stateOfTree('b', {
      'src/l.ts': `function t(){ return 1; }
function r(){ return t(); }`,
    });

    const pred = predict(diff(base, a), diff(base, b));
    expect(pred.dangling.length).toBeGreaterThan(0);
    for (const d of pred.dangling) expect(d.rule).toBe('dangle-retire');
  }, 60_000);

  it('every knot AND dangle from the real corpus is labelled — no exceptions', async () => {
    const base = await stateOfTree('base', {
      'src/l.ts': `function t(){ return 1; }
function u(){ return 2; }
function r(){ return 0; }`,
    });
    const a = await stateOfTree('a', {
      'src/l.ts': `function u(){ return 20; }
function r(){ return 0; }`,
    });
    const b = await stateOfTree('b', {
      'src/l.ts': `function t(){ return 1; }
function u(){ return 30; }
function r(){ return t(); }`,
    });

    const pred = predict(diff(base, a), diff(base, b));
    expect(pred.knots.length + pred.dangling.length).toBeGreaterThan(0);
    for (const k of pred.knots) expect(k.rule, `unlabelled knot ${k.stableKey}`).toBeTruthy();
    for (const d of pred.dangling) expect(d.rule).toBe('dangle-retire');
  }, 60_000);
});
