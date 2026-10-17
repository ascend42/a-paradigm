/**
 * G-WIN-05 — a test marked platform-specific must have a sibling or an
 * explicit `n/a` row with a reason (spec §16 rule). The checker is exercised
 * against synthetic inputs so it is proven to fail, then over test/**.
 *
 * Both directions: a marked (or platform-branching) file needs a row, and a
 * row needs a file whose marker lists exactly the row's platforms. Since
 * T-2026-10-17-011 the marker is enforced by vitest.config.ts (a file whose
 * marker omits the running platform is excluded); the last test proves, for
 * every platform, that the excluded set is exactly the registry rows that do
 * not list it — so every exclusion on Windows has a row with a reason.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT, rel, walk } from './helpers.js';
import {
  excludedTestFiles,
  parsePlatformMarker,
  PLATFORM_REGISTRY,
  PLATFORMS,
  type Platform,
  type PlatformRow,
} from './platform-registry.js';

// Branching on the host OS: a comparison against process.platform or
// os.platform() (either side), a switch or `.includes(…)` on it, a
// skipIf/runIf gated on it, or destructuring `platform` out of process / os.
const PLATFORM_EXPR = String.raw`(?:process\.platform|\b(?:os|node_os)\.platform\(\))`;
const BRANCHES_ON_PLATFORM = new RegExp(
  [
    String.raw`${PLATFORM_EXPR}\s*[!=]==?`,
    String.raw`[!=]==?\s*${PLATFORM_EXPR}`,
    String.raw`switch\s*\(\s*${PLATFORM_EXPR}\s*\)`,
    String.raw`\.includes\(\s*${PLATFORM_EXPR}\s*\)`,
    String.raw`(?:skipIf|runIf)\s*\([^)]*${PLATFORM_EXPR}`,
    String.raw`\{[^}]*\bplatform\b[^}]*\}\s*=\s*(?:process|os)\b`,
  ].join('|'),
);

export interface ScannedTest {
  file: string;
  marked: Platform[] | null;
  branchesOnPlatform: boolean;
}

export function scanTestSource(file: string, source: string): ScannedTest {
  return {
    file,
    marked: parsePlatformMarker(source) as Platform[] | null,
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
  const scannedByFile = new Map(scanned.map((t) => [t.file, t]));

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
    const t = scannedByFile.get(row.test);
    if (t && !t.marked) problems.push(`registry row ${row.test}: file has no @gnomon-platform marker`);
    if (t?.marked && [...t.marked].sort().join(',') !== [...row.platforms].sort().join(',')) {
      problems.push(`registry row ${row.test}: platforms [${row.platforms.join(', ')}] differ from the file marker [${t.marked.join(', ')}]`);
    }
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

  it.each([
    ["os.platform() === 'darwin'"],
    ["if ('win32' === process.platform) {}"],
    ['switch (process.platform) {}'],
    ['switch (os.platform()) {}'],
    ["['darwin', 'linux'].includes(process.platform)"],
    ['const { platform } = process;'],
    ['const { arch, platform: p } = process;'],
    ["it.skipIf(os.platform() !== 'linux')"],
  ])('rejects an unmarked test that branches via %s', (src) => {
    expect(checkRegistry([scanTestSource('test/x.test.ts', src)], [], () => true)).toHaveLength(1);
  });

  it('does not flag process.platform used as a value', () => {
    const scanned = [
      scanTestSource('test/x.test.ts', 'const f = `r.${process.platform}.json`;'),
      scanTestSource('test/y.test.ts', 'excludedTestFiles(root, process.platform); const p = os.platform();'),
    ];
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

  it('rejects a row whose file is unmarked, or whose platforms differ from the marker', () => {
    const unmarked = [scanTestSource('test/a.darwin.test.ts', 'it("x", () => {})')];
    const row: PlatformRow[] = [{ test: 'test/a.darwin.test.ts', platforms: ['darwin'], na: 'reason' }];
    expect(checkRegistry(unmarked, row, exists)[0]).toMatch(/no @gnomon-platform marker/);
    const wider = [scanTestSource('test/a.darwin.test.ts', '// @gnomon-platform: darwin, linux')];
    expect(checkRegistry(wider, row, exists)[0]).toMatch(/differ from the file marker/);
  });

  it('parses a CRLF marker line (Windows checkouts)', () => {
    expect(parsePlatformMarker('// @gnomon-platform: darwin, linux\r\nimport x;')).toEqual(['darwin', 'linux']);
    expect(parsePlatformMarker('const s = "// @gnomon-platform: darwin";')).toBeNull();
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

describe('G-WIN-05 marker enforcement (vitest.config.ts exclude)', () => {
  it.each(PLATFORMS)('on %s, the excluded test files are exactly the registry rows that do not list it', (p) => {
    const expected = PLATFORM_REGISTRY.filter((r) => !r.platforms.includes(p))
      .map((r) => r.test)
      .sort();
    expect(excludedTestFiles(PKG_ROOT, p)).toEqual(expected);
  });

  it('this run excludes nothing that lists the running platform, and runs this file everywhere', () => {
    const excluded = excludedTestFiles(PKG_ROOT, process.platform);
    expect(excluded).not.toContain('test/platform-registry.test.ts');
    for (const f of excluded) expect(parsePlatformMarker(readFileSync(path.join(PKG_ROOT, f), 'utf8'))).not.toContain(process.platform);
  });
});
