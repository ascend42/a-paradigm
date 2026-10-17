/**
 * G-WIN-05 (skeleton) — a test marked platform-specific must have a sibling or
 * an explicit `n/a` row with a reason (spec §16 rule). The registry is empty
 * at PR-0; the checker is exercised against synthetic inputs so it is proven
 * to fail before the first platform-specific test lands.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT, rel, walk } from './helpers.js';
import { PLATFORM_REGISTRY, type Platform, type PlatformRow } from './platform-registry.js';

const MARKER = /^\s*\/\/\s*@gnomon-platform:\s*([a-z0-9, ]+)$/m;
// A comparison against process.platform, or a skipIf/runIf gated on it.
const BRANCHES_ON_PLATFORM = /process\.platform\s*[!=]==?|(?:skipIf|runIf)\s*\([^)]*process\.platform/;
const PLATFORMS: Platform[] = ['darwin', 'win32', 'linux'];

export interface ScannedTest {
  file: string;
  marked: Platform[] | null;
  branchesOnPlatform: boolean;
}

export function scanTestSource(file: string, source: string): ScannedTest {
  const m = source.match(MARKER);
  return {
    file,
    marked: m ? (m[1]!.split(',').map((s) => s.trim()).filter(Boolean) as Platform[]) : null,
    branchesOnPlatform: BRANCHES_ON_PLATFORM.test(source),
  };
}

export function checkRegistry(
  scanned: ScannedTest[],
  registry: PlatformRow[],
  fileExists: (relPath: string) => boolean,
): string[] {
  const problems: string[] = [];
  const byTest = new Map(registry.map((r) => [r.test, r]));

  for (const t of scanned) {
    if (t.branchesOnPlatform && !t.marked) {
      problems.push(`${t.file}: branches on process.platform but has no @gnomon-platform marker`);
    }
    if (t.marked) {
      for (const p of t.marked) {
        if (!PLATFORMS.includes(p)) problems.push(`${t.file}: unknown platform "${p}" in marker`);
      }
      if (!byTest.has(t.file)) problems.push(`${t.file}: marked platform-specific but has no registry row`);
    }
  }

  for (const row of registry) {
    if (!fileExists(row.test)) problems.push(`registry row ${row.test}: test file does not exist`);
    if (row.platforms.length === 0) problems.push(`registry row ${row.test}: no platforms`);
    const hasSibling = typeof row.sibling === 'string' && row.sibling.length > 0;
    const hasNa = typeof row.na === 'string' && row.na.trim().length > 0;
    if (!hasSibling && !hasNa) problems.push(`registry row ${row.test}: needs a sibling or an n/a reason`);
    if (hasSibling && !fileExists(row.sibling!)) {
      problems.push(`registry row ${row.test}: sibling ${row.sibling} does not exist`);
    }
  }
  return problems;
}

describe('G-WIN-05 checker (self-test)', () => {
  const exists = (f: string) => ['test/a.darwin.test.ts', 'test/a.win32.test.ts'].includes(f);

  it('accepts a marked test with an existing sibling', () => {
    const scanned = [scanTestSource('test/a.darwin.test.ts', "// @gnomon-platform: darwin\nit.runIf(process.platform === 'darwin')")];
    const registry: PlatformRow[] = [
      { test: 'test/a.darwin.test.ts', platforms: ['darwin'], sibling: 'test/a.win32.test.ts' },
    ];
    expect(checkRegistry(scanned, registry, exists)).toEqual([]);
  });

  it('accepts an n/a row with a reason', () => {
    const scanned = [scanTestSource('test/a.darwin.test.ts', '// @gnomon-platform: darwin')];
    const registry: PlatformRow[] = [
      { test: 'test/a.darwin.test.ts', platforms: ['darwin'], na: 'MLX is Mac-only and optional (spec §16)' },
    ];
    expect(checkRegistry(scanned, registry, exists)).toEqual([]);
  });

  it('rejects an unmarked test that branches on process.platform', () => {
    const scanned = [scanTestSource('test/x.test.ts', "if (process.platform === 'win32') {}")];
    expect(checkRegistry(scanned, [], exists)).toHaveLength(1);
  });

  it('does not flag process.platform used as a value', () => {
    const scanned = [scanTestSource('test/x.test.ts', 'const f = `r.${process.platform}.json`;')];
    expect(checkRegistry(scanned, [], exists)).toEqual([]);
  });

  it('rejects a marked test with no registry row', () => {
    const scanned = [scanTestSource('test/a.darwin.test.ts', '// @gnomon-platform: darwin')];
    expect(checkRegistry(scanned, [], exists)[0]).toMatch(/no registry row/);
  });

  it('rejects a row with neither sibling nor reason, and a blank reason', () => {
    const scanned = [scanTestSource('test/a.darwin.test.ts', '// @gnomon-platform: darwin')];
    expect(checkRegistry(scanned, [{ test: 'test/a.darwin.test.ts', platforms: ['darwin'] }], exists)).toHaveLength(1);
    expect(
      checkRegistry(scanned, [{ test: 'test/a.darwin.test.ts', platforms: ['darwin'], na: '  ' }], exists),
    ).toHaveLength(1);
  });

  it('rejects a missing sibling and an unknown platform', () => {
    const scanned = [scanTestSource('test/a.darwin.test.ts', '// @gnomon-platform: darwin, beos')];
    const registry: PlatformRow[] = [
      { test: 'test/a.darwin.test.ts', platforms: ['darwin'], sibling: 'test/gone.test.ts' },
    ];
    const problems = checkRegistry(scanned, registry, exists);
    expect(problems.some((p) => p.includes('unknown platform "beos"'))).toBe(true);
    expect(problems.some((p) => p.includes('does not exist'))).toBe(true);
  });
});

describe('G-WIN-05 registry over test/**', () => {
  it('every platform-specific test has a sibling or an n/a reason', () => {
    const self = path.join(PKG_ROOT, 'test', 'platform-registry.test.ts');
    const scanned = walk(path.join(PKG_ROOT, 'test'), (f) => f.endsWith('.test.ts') && f !== self).map((f) =>
      scanTestSource(rel(f), readFileSync(f, 'utf8')),
    );
    const problems = checkRegistry(scanned, PLATFORM_REGISTRY, (f) => existsSync(path.join(PKG_ROOT, f)));
    expect(problems).toEqual([]);
  });
});
