/**
 * Tests for paradigm_pm_postflight stale-aspect deduplication.
 *
 * Regression coverage for v6.6.3 (not-chat field report): the aspect-anchor
 * check is nested inside `for (pattern of appliesTo) → for (symbol of
 * symbolsTouched)`, so an aspect that applies to multiple touched symbols had
 * its anchor existence re-checked — and a missing anchor re-reported — once per
 * matching symbol. An anchor's existence is independent of which symbol
 * matched, so each (aspect, anchor) finding must appear at most once.
 *
 * (The path-resolution false-positive that prompted the report was already
 * fixed in v6.6.2 via resolveAnchorPath; this covers the leftover duplication.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildSymbolIndex } from '@a-company/premise-core';
import type { SymbolEntry, AggregationResult } from '@a-company/premise-core';
import { runPostflightCheck } from '../src/tools/pm.js';
import type { ProjectContext } from '../src/utils/index-loader.js';

let tmpDir: string;

function aspectEntry(opts: {
  symbol: string;
  appliesTo: string[];
  anchors: Array<{ path: string; raw: string }>;
}): SymbolEntry {
  return {
    id: opts.symbol,
    symbol: opts.symbol,
    type: 'aspect',
    source: 'purpose',
    filePath: path.join(tmpDir, 'pkg', '.purpose'),
    data: {},
    references: [],
    referencedBy: [],
    appliesTo: opts.appliesTo,
    anchors: opts.anchors.map((a) => ({ path: a.path, raw: a.raw, lines: [1, 2] })),
  } as SymbolEntry;
}

function ctxWith(aspects: SymbolEntry[]): ProjectContext {
  const agg = { symbols: aspects, timestamp: 0 } as unknown as AggregationResult;
  const index = buildSymbolIndex(agg);
  return { rootDir: tmpDir, index, aggregation: agg, gateConfig: null } as unknown as ProjectContext;
}

function staleAnchorViolations(result: { violations: Array<{ type: string; message: string }> }) {
  return result.violations.filter((v) => v.type === 'stale-aspect' && v.message.includes('points to missing file'));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-postflight-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('pm_postflight — stale-aspect dedup', () => {
  it('reports a missing anchor once even when the aspect applies to several touched symbols', () => {
    // Aspect applies to BOTH #a and #b; both are touched. Pre-fix this emitted
    // two identical "points to missing file" warnings for the single anchor.
    const ctx = ctxWith([
      aspectEntry({
        symbol: '~shared-aspect',
        appliesTo: ['#a', '#b'],
        anchors: [{ path: 'missing.ts', raw: 'missing.ts' }],
      }),
    ]);

    const result = runPostflightCheck([], ['#a', '#b'], ctx);
    const stale = staleAnchorViolations(result);

    expect(stale).toHaveLength(1);
    expect(stale[0].message).toContain('~shared-aspect');
    expect(stale[0].message).toContain('missing.ts');
  });

  it('still reports each distinct missing anchor of the same aspect', () => {
    const ctx = ctxWith([
      aspectEntry({
        symbol: '~multi-anchor',
        appliesTo: ['#a'],
        anchors: [
          { path: 'gone-1.ts', raw: 'gone-1.ts' },
          { path: 'gone-2.ts', raw: 'gone-2.ts' },
        ],
      }),
    ]);

    const result = runPostflightCheck([], ['#a'], ctx);
    const stale = staleAnchorViolations(result);

    expect(stale).toHaveLength(2);
    expect(stale.map((v) => v.message).join(' ')).toContain('gone-1.ts');
    expect(stale.map((v) => v.message).join(' ')).toContain('gone-2.ts');
  });

  it('does not report an anchor that resolves relative to the .purpose dir (no false positive)', () => {
    // anchor resolves relative to the owning .purpose directory (tmpDir/pkg).
    fs.mkdirSync(path.join(tmpDir, 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pkg', 'present.ts'), '// exists\n');

    const ctx = ctxWith([
      aspectEntry({
        symbol: '~present-aspect',
        appliesTo: ['#a'],
        anchors: [{ path: 'present.ts', raw: 'present.ts' }],
      }),
    ]);

    const result = runPostflightCheck([], ['#a'], ctx);
    expect(staleAnchorViolations(result)).toHaveLength(0);
  });
});
