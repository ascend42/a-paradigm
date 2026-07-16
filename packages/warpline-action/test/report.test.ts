/**
 * report.test — the diff-of-verdicts core: OracleRecord → GuardReport.
 * Threshold stratum, ripple folding, paths filter, fail-on-flag semantics.
 */

import { describe, it, expect } from 'vitest';
import {
  buildReport,
  codeFileOf,
  globToRegExp,
  DEFAULT_THRESHOLD,
  SCOPE_LINE,
} from '../src/report.js';
import { makeRecord, knot, dangle } from './fixtures.js';

const SYM_A = '#code:src/types.ts::ZodRecord';
const SYM_B = '#code:src/types.ts::ZodRecord.create';

describe('buildReport — verdicts', () => {
  it('clean: no flags, git clean', () => {
    const r = buildReport(makeRecord());
    expect(r.verdict).toBe('clean');
    expect(r.knotSize).toBe(0);
    expect(r.flags).toEqual([]);
    expect(r.shouldFail).toBe(false);
    expect(r.scopeLine).toBe(SCOPE_LINE);
  });

  it('flagged: in-stratum direct knots are listed with touch points; ripple folds', () => {
    const record = makeRecord({
      knots: [knot(SYM_A, { conflictingSlots: ['body'] }), knot(SYM_B)],
      directContested: [SYM_A, SYM_B],
      rippleOnly: ['#code:src/types.ts::ZodType', '#code:src/types.ts::ZodString'],
      touchedA: [SYM_A],
      touchedB: [SYM_A, SYM_B],
    });
    const r = buildReport(record);
    expect(r.verdict).toBe('flagged');
    expect(r.knotSize).toBe(2);
    expect(r.rippleCount).toBe(2);
    expect(r.flagCount).toBe(4);
    expect(r.flags.map((f) => f.symbol)).toEqual([SYM_A, SYM_B]);
    // ripple symbols are NEVER listed
    expect(r.flags.some((f) => f.symbol.includes('ZodType'))).toBe(false);
    // both branches' touch points
    expect(r.flags[0].touchedBy).toEqual({ A: true, B: true });
    expect(r.flags[1].touchedBy).toEqual({ A: false, B: true });
    // knot detail carried through
    expect(r.flags[0].kind).toBe('knot');
    expect(r.flags[0].conflictingSlots).toEqual(['body']);
    expect(r.flags[0].file).toBe('src/types.ts');
  });

  it('dangling flags carry the dangle detail', () => {
    const record = makeRecord({
      dangling: [dangle(SYM_A, { edgeKind: 'imports', retiredBy: 'B' })],
      directContested: [SYM_A],
    });
    const r = buildReport(record);
    expect(r.verdict).toBe('flagged');
    expect(r.flags[0].kind).toBe('dangling');
    expect(r.flags[0].dangling).toEqual({
      edgeKind: 'imports',
      targetSymbol: '#code:src/gone.ts::removed',
      retiredBy: 'B',
    });
  });

  it('ripple-only: flags exist but zero direct-contested — nothing listed', () => {
    const r = buildReport(makeRecord({ rippleOnly: ['#code:src/a.ts::x', '#code:src/a.ts::y'] }));
    expect(r.verdict).toBe('ripple-only');
    expect(r.flags).toEqual([]);
    expect(r.rippleCount).toBe(2);
    expect(r.shouldFail).toBe(false);
  });

  it('avalanche: knotSize above threshold suppresses the listing entirely', () => {
    const syms = Array.from({ length: 7 }, (_, i) => `#code:src/big.ts::sym${i}`);
    const record = makeRecord({
      knots: syms.map((s) => knot(s)),
      directContested: syms,
    });
    const r = buildReport(record); // default threshold 6
    expect(r.verdict).toBe('avalanche');
    expect(r.knotSize).toBe(7);
    expect(r.flags).toEqual([]);
    // avalanche never fails, even when enforcing — 0%-validated stratum
    expect(buildReport(record, { failOnFlag: true }).shouldFail).toBe(false);
  });

  it('threshold is configurable and judges the RAW knot size', () => {
    const syms = ['#code:a.ts::x', '#code:b.ts::y', '#code:c.ts::z'];
    const record = makeRecord({ knots: syms.map((s) => knot(s)), directContested: syms });
    expect(buildReport(record, { threshold: 3 }).verdict).toBe('flagged');
    expect(buildReport(record, { threshold: 2 }).verdict).toBe('avalanche');
    expect(buildReport(record, { threshold: 0 }).verdict).toBe('avalanche');
  });

  it('git-conflict wins over everything: GitHub already blocks those PRs', () => {
    const record = makeRecord({
      knots: [knot(SYM_A)],
      directContested: [SYM_A],
      gitConflicted: true,
      conflictPaths: ['src/types.ts'],
    });
    const r = buildReport(record, { failOnFlag: true });
    expect(r.verdict).toBe('git-conflict');
    expect(r.flags).toEqual([]);
    expect(r.shouldFail).toBe(false);
    expect(r.gitReality.conflictPaths).toEqual(['src/types.ts']);
  });
});

describe('buildReport — paths filter', () => {
  const record = () =>
    makeRecord({
      knots: [knot('#code:src/core/a.ts::x'), knot('#code:src/web/b.ts::y'), knot('#oracle')],
      directContested: ['#code:src/core/a.ts::x', '#code:src/web/b.ts::y', '#oracle'],
    });

  it('lists only flags whose file matches; counts the rest as filtered out', () => {
    const r = buildReport(record(), { paths: ['src/core/**'] });
    // '#oracle' has no parseable file → surfaced, never silently dropped
    expect(r.flags.map((f) => f.symbol)).toEqual(['#code:src/core/a.ts::x', '#oracle']);
    expect(r.filteredOutCount).toBe(1);
  });

  it('shouldFail requires a flag that SURVIVES the filter', () => {
    const only = makeRecord({
      knots: [knot('#code:src/web/b.ts::y')],
      directContested: ['#code:src/web/b.ts::y'],
    });
    const r = buildReport(only, { paths: ['src/core/**'], failOnFlag: true });
    expect(r.verdict).toBe('flagged'); // the stratum is raw — filter narrows listing only
    expect(r.flags).toEqual([]);
    expect(r.shouldFail).toBe(false);
  });
});

describe('buildReport — fail-on-flag', () => {
  it('is advisory by default: flagged verdict, shouldFail false', () => {
    const record = makeRecord({ knots: [knot(SYM_A)], directContested: [SYM_A] });
    const r = buildReport(record);
    expect(r.verdict).toBe('flagged');
    expect(r.failOnFlag).toBe(false);
    expect(r.shouldFail).toBe(false);
  });

  it('fails only in-stratum flags when enforcing', () => {
    const record = makeRecord({ knots: [knot(SYM_A)], directContested: [SYM_A] });
    expect(buildReport(record, { failOnFlag: true }).shouldFail).toBe(true);
    expect(buildReport(makeRecord(), { failOnFlag: true }).shouldFail).toBe(false);
  });
});

describe('helpers', () => {
  it('codeFileOf parses #code: symbols and rejects the rest', () => {
    expect(codeFileOf('#code:src/types.ts::ZodRecord')).toBe('src/types.ts');
    expect(codeFileOf('#code:packages/x/src/a.tsx::C.render')).toBe('packages/x/src/a.tsx');
    expect(codeFileOf('#oracle')).toBeUndefined();
    expect(codeFileOf('#code:no-separator')).toBeUndefined();
  });

  it('globToRegExp: ** crosses directories, * and ? do not', () => {
    expect(globToRegExp('src/**').test('src/a/b/c.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
    expect(globToRegExp('src/?.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/?.ts').test('src/ab.ts')).toBe(false);
    expect(globToRegExp('packages/*/src/**/*.ts').test('packages/x/src/deep/f.ts')).toBe(true);
    expect(globToRegExp('a+b.ts').test('a+b.ts')).toBe(true); // regex chars escaped
  });

  it('normalizes a bad threshold to the default', () => {
    const record = makeRecord({ knots: [knot(SYM_A)], directContested: [SYM_A] });
    expect(buildReport(record, { threshold: Number.NaN }).threshold).toBe(DEFAULT_THRESHOLD);
    expect(buildReport(record, { threshold: -3 }).threshold).toBe(0);
  });
});
