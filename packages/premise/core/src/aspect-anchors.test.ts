/**
 * Tests for aspect-anchors.ts — the shared aspect-anchor existence check.
 *
 * Covers the three behaviors that the previously-triplicated copies got wrong
 * (or right, in pm.ts's case):
 *   (a) purpose-dir path resolution — an anchor that exists relative to the
 *       owning .purpose directory is NOT reported missing (the Defect-1 guard
 *       against root-only resolution false positives);
 *   (b) per-aspect dedup — a single missing anchor matched by several touched
 *       symbols is reported exactly once, while distinct anchors each report;
 *   (c) no-anchors — a matched aspect with empty anchors reports exactly once.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildSymbolIndex } from './symbol-index.js';
import type { SymbolEntry, AggregationResult, SymbolIndex } from './types.js';
import { checkAspectAnchors } from './aspect-anchors.js';

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

function indexWith(aspects: SymbolEntry[]): SymbolIndex {
  const agg = { symbols: aspects, timestamp: 0 } as unknown as AggregationResult;
  return buildSymbolIndex(agg);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-anchors-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('checkAspectAnchors', () => {
  it('does not report an anchor that resolves relative to the .purpose dir (Defect-1 guard)', () => {
    // The aspect's .purpose lives at tmpDir/pkg/.purpose; the anchor resolves
    // relative to that directory (tmpDir/pkg/present.ts). Root-only resolution
    // would falsely flag it missing.
    fs.mkdirSync(path.join(tmpDir, 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pkg', 'present.ts'), '// exists\n');

    const index = indexWith([
      aspectEntry({
        symbol: '~present-aspect',
        appliesTo: ['#a'],
        anchors: [{ path: 'present.ts', raw: 'present.ts' }],
      }),
    ]);

    const issues = checkAspectAnchors(index, ['#a'], tmpDir);
    expect(issues).toHaveLength(0);
  });

  it('does not report a parent-relative anchor that exists relative to the .purpose dir', () => {
    // tmpDir/pkg/.purpose with anchor `../shared.ts` → tmpDir/shared.ts exists.
    fs.mkdirSync(path.join(tmpDir, 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'shared.ts'), '// exists\n');

    const index = indexWith([
      aspectEntry({
        symbol: '~cross-dir-aspect',
        appliesTo: ['#a'],
        anchors: [{ path: '../shared.ts', raw: '../shared.ts' }],
      }),
    ]);

    const issues = checkAspectAnchors(index, ['#a'], tmpDir);
    expect(issues).toHaveLength(0);
  });

  it('reports a missing anchor once even when the aspect applies to several touched symbols', () => {
    const index = indexWith([
      aspectEntry({
        symbol: '~shared-aspect',
        appliesTo: ['#a', '#b'],
        anchors: [{ path: 'missing.ts', raw: 'missing.ts' }],
      }),
    ]);

    const issues = checkAspectAnchors(index, ['#a', '#b'], tmpDir);
    const missing = issues.filter((i) => i.kind === 'missing-file');
    expect(missing).toHaveLength(1);
    expect(missing[0].aspectSymbol).toBe('~shared-aspect');
    expect(missing[0].anchorRaw).toBe('missing.ts');
  });

  it('reports each distinct missing anchor of the same aspect', () => {
    const index = indexWith([
      aspectEntry({
        symbol: '~multi-anchor',
        appliesTo: ['#a'],
        anchors: [
          { path: 'gone-1.ts', raw: 'gone-1.ts' },
          { path: 'gone-2.ts', raw: 'gone-2.ts' },
        ],
      }),
    ]);

    const issues = checkAspectAnchors(index, ['#a'], tmpDir);
    const missing = issues.filter((i) => i.kind === 'missing-file');
    expect(missing).toHaveLength(2);
    expect(missing.map((i) => i.anchorRaw).sort()).toEqual(['gone-1.ts', 'gone-2.ts']);
  });

  it('reports a matched aspect with no anchors exactly once', () => {
    const index = indexWith([
      aspectEntry({
        symbol: '~no-anchors',
        appliesTo: ['#a', '#b'],
        anchors: [],
      }),
    ]);

    const issues = checkAspectAnchors(index, ['#a', '#b'], tmpDir);
    const noAnchors = issues.filter((i) => i.kind === 'no-anchors');
    expect(noAnchors).toHaveLength(1);
    expect(noAnchors[0].aspectSymbol).toBe('~no-anchors');
    expect(noAnchors[0].anchorRaw).toBeNull();
  });

  it('dedups missing-file findings across multiple aspects in one index', () => {
    // Two aspects, each with one distinct missing anchor → exactly 2 issues,
    // one per aspect. Guards against the helper being called per-aspect with a
    // call-local dedup set (which would still be correct here) AND against a
    // shared loop emitting cross-aspect duplicates.
    const index = indexWith([
      aspectEntry({
        symbol: '~aspect-one',
        appliesTo: ['#a'],
        anchors: [{ path: 'one-missing.ts', raw: 'one-missing.ts' }],
      }),
      aspectEntry({
        symbol: '~aspect-two',
        appliesTo: ['#a'],
        anchors: [{ path: 'two-missing.ts', raw: 'two-missing.ts' }],
      }),
    ]);

    const issues = checkAspectAnchors(index, ['#a'], tmpDir);
    const missing = issues.filter((i) => i.kind === 'missing-file');
    expect(missing).toHaveLength(2);
    expect(missing.map((i) => i.aspectSymbol).sort()).toEqual(['~aspect-one', '~aspect-two']);
  });
});
