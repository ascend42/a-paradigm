/**
 * render.test — GuardReport → job summary + log lines, including the WORDING
 * DISCIPLINE (TD-2026-07-16-810): scope line on every render, ripple always
 * folded, avalanche never listed, no unscoped/banned claims in emitted copy.
 */

import { describe, it, expect } from 'vitest';
import { buildReport, SCOPE_LINE } from '../src/report.js';
import { renderLog, renderSummary } from '../src/render.js';
import { makeRecord, knot } from './fixtures.js';

const SYM = '#code:src/types.ts::ZodRecord';

const flagged = () =>
  buildReport(
    makeRecord({
      knots: [knot(SYM)],
      directContested: [SYM],
      rippleOnly: ['#code:src/types.ts::ZodType'],
      touchedA: [SYM],
      touchedB: [SYM],
    }),
  );

describe('renderSummary', () => {
  it('always carries the honest scope line — clean AND flagged', () => {
    expect(renderSummary(buildReport(makeRecord()))).toContain(SCOPE_LINE);
    expect(renderSummary(flagged())).toContain(SCOPE_LINE);
  });

  it('flagged: table lists the contested symbol with BOTH branches touch points', () => {
    const md = renderSummary(flagged());
    expect(md).toContain('FLAGGED — 1 direct-contested symbol(s)');
    expect(md).toContain(`\`${SYM}\``);
    expect(md).toContain('`src/types.ts`');
    expect(md).toContain('| base×base-branch | base×head |');
    // ripple folded to a count, symbol name absent
    expect(md).toContain('Ripple (folded): 1 symbol(s)');
    expect(md).not.toContain('ZodType');
    // both branch rows present
    expect(md).toContain('| base | `main` |');
    expect(md).toContain('| head | `feature/x` |');
  });

  it('advisory runs say so in the headline', () => {
    expect(renderSummary(flagged())).toContain('(advisory — this check never blocks)');
  });

  it('avalanche: counts only, zero symbol names', () => {
    const syms = Array.from({ length: 8 }, (_, i) => `#code:src/big.ts::sym${i}`);
    const md = renderSummary(
      buildReport(makeRecord({ knots: syms.map((s) => knot(s)), directContested: syms })),
    );
    expect(md).toContain('AVALANCHE — 8 direct-contested symbols');
    for (const s of syms) expect(md).not.toContain(s);
  });

  it('git-conflict: defers to git, lists nothing', () => {
    const md = renderSummary(
      buildReport(makeRecord({ gitConflicted: true, conflictPaths: ['a.ts', 'b.ts'] })),
    );
    expect(md).toContain('GIT CONFLICT');
    expect(md).toContain('2 conflicted path(s)');
  });

  it('notes direct flags hidden by the paths filter', () => {
    const md = renderSummary(
      buildReport(makeRecord({ knots: [knot(SYM)], directContested: [SYM] }), {
        paths: ['docs/**'],
      }),
    );
    expect(md).toContain('1 direct-contested symbol(s) fall outside the configured `paths` filter');
  });

  it('WORDING LAW: emitted copy never carries banned or unscoped claims', () => {
    const reports = [
      buildReport(makeRecord()),
      flagged(),
      buildReport(makeRecord({ gitConflicted: true })),
    ];
    const banned = [
      /provenance/i,
      /accountab/i,
      /calibration/i,
      /moat/i,
      /what reviewers can.?t/i,
      /what tsc can.?t/i,
      /detects what/i,
      /guarantee/i,
    ];
    for (const r of reports) {
      const all = renderSummary(r) + '\n' + renderLog(r).join('\n');
      for (const re of banned) expect(all).not.toMatch(re);
    }
  });
});

describe('renderLog', () => {
  it('is terse: header, verdict, per-flag line, scope line', () => {
    const lines = renderLog(flagged());
    expect(lines[0]).toContain('Warpline Guard');
    expect(lines.some((l) => l.includes('verdict: FLAGGED'))).toBe(true);
    expect(lines.some((l) => l.includes(SYM) && l.includes('base:touched') && l.includes('head:touched'))).toBe(true);
    expect(lines[lines.length - 1]).toContain('Scope: TypeScript only');
  });
});
