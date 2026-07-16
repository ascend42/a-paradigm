/**
 * cfg-lens.test — the structured-data lens (P3 Lane A, GAP-1): JSON/YAML
 * key-trees lift to deterministic cfg units; everything the lens cannot
 * honestly model falls CLOSED to the byte tier with a VISIBLE marker.
 *
 * Also carries the DETERMINISM REGRESSION PIN: a pure-TS fixture's stateId,
 * captured on the pre-cfg-lens baseline (387-green), must NOT move — the cfg
 * lens adds units only where json/yaml exists.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CfgLens, CFG_ESSENCE_TAG } from '../src/lens/cfg-lens.js';
import { isDerivedArtifact } from '../src/lens/derived-artifacts.js';
import type { CodeUnit } from '../src/lens/code-lens.js';

/** Write relPath → contents into a fresh temp dir; return its abs path. */
async function mkFixture(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cfg-lens-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
  }
  return dir;
}

async function lift(files: Record<string, string>): Promise<CodeUnit[]> {
  const dir = await mkFixture(files);
  try {
    return await new CfgLens().lift(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const bySymbol = (units: CodeUnit[]) => new Map(units.map((u) => [u.symbol, u]));

const PKG = `{
  "name": "fix",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.0.0",
    "zod": "3.22.0"
  },
  "scripts": {
    "build": "tsc"
  }
}
`;

describe('cfg-lens — granularity (cfg-v1)', () => {
  it('package.json lifts a file root + one unit per dep / script / scalar key', async () => {
    const units = await lift({ 'package.json': PKG });
    const syms = units.map((u) => u.symbol).sort();
    expect(syms).toEqual([
      '#cfg:package.json::/',
      '#cfg:package.json::/dependencies/react',
      '#cfg:package.json::/dependencies/zod',
      '#cfg:package.json::/name',
      '#cfg:package.json::/scripts/build',
      '#cfg:package.json::/version',
    ]);
    const map = bySymbol(units);
    // every unit carries the cfg essence namespace + the code-unit shape
    for (const u of units) {
      expect(u.essenceTag).toBe(CFG_ESSENCE_TAG);
      expect(u.componentType).toBe('code-unit');
      expect(u.filePath).toBe('package.json');
    }
    // the root is a marker; key units are REAL meaning (no marker, no reducedFidelity)
    expect(map.get('#cfg:package.json::/')!.cfgMarker).toBe('file');
    expect(map.get('#cfg:package.json::/dependencies/react')!.cfgMarker).toBeUndefined();
    expect(map.get('#cfg:package.json::/dependencies/react')!.reducedFidelity).toBeUndefined();
  });

  it('a dep version is RAW-LEXEME meaning: value change moves the body; a sibling dep does not', async () => {
    const a = bySymbol(await lift({ 'package.json': PKG }));
    const bumped = bySymbol(
      await lift({ 'package.json': PKG.replace('"^18.0.0"', '"^19.0.0"') }),
    );
    const otherDep = bySymbol(
      await lift({ 'package.json': PKG.replace('"zod": "3.22.0"', '"zod": "3.23.0"') }),
    );
    const react = '#cfg:package.json::/dependencies/react';
    expect(bumped.get(react)!.codeEssence).not.toBe(a.get(react)!.codeEssence);
    expect(otherDep.get(react)!.codeEssence).toBe(a.get(react)!.codeEssence); // disjoint keys commute
  });

  it('raw scalar lexemes: 1.0 ≠ 1 ≠ "1" (as-written is meaning)', async () => {
    const n10 = bySymbol(await lift({ 'a.json': '{"v": 1.0}' }));
    const n1 = bySymbol(await lift({ 'a.json': '{"v": 1}' }));
    const s1 = bySymbol(await lift({ 'a.json': '{"v": "1"}' }));
    const k = '#cfg:a.json::/v';
    expect(n10.get(k)!.codeEssence).not.toBe(n1.get(k)!.codeEssence);
    expect(s1.get(k)!.codeEssence).not.toBe(n1.get(k)!.codeEssence);
  });

  it('map key ORDER is not meaning: a pure reorder is the empty delta', async () => {
    const a = await lift({ 'a.json': '{"x": {"p": 1, "q": 2}, "y": "z"}' });
    const b = await lift({ 'a.json': '{"y": "z", "x": {"q": 2, "p": 1}}' });
    const bodies = (units: CodeUnit[]) => units.map((u) => `${u.symbol} ${u.codeEssence}`).sort();
    expect(bodies(a)).toEqual(bodies(b));
  });

  it('deep nesting hashes as one leaf under the depth-2 unit', async () => {
    const units = bySymbol(
      await lift({ 'package.json': '{"exports": {".": {"import": "./a.js", "types": "./a.d.ts"}}}' }),
    );
    const u = units.get('#cfg:package.json::/exports/.')!;
    expect(u).toBeDefined();
    expect(u.cfgMarker).toBeUndefined();
    expect(u.codeEssence).toContain('./a.d.ts');
  });

  it('an empty-map key lifts as its own (empty-value) unit — parsed-empty, never silent', async () => {
    const units = bySymbol(await lift({ 'a.json': '{"dependencies": {}}' }));
    expect(units.get('#cfg:a.json::/dependencies')).toBeDefined();
    expect(units.get('#cfg:a.json::/dependencies')!.cfgMarker).toBeUndefined();
  });

  it('JSON-pointer escaping: keys containing / and ~', async () => {
    const units = await lift({ 'a.json': '{"scripts": {"a/b": "x", "c~d": "y"}}' });
    const syms = units.map((u) => u.symbol);
    expect(syms).toContain('#cfg:a.json::/scripts/a~1b');
    expect(syms).toContain('#cfg:a.json::/scripts/c~0d');
  });
});

describe('cfg-lens — sequences defer to the byte tier (visible marker)', () => {
  it('an array-valued key is a content-INDEPENDENT seq marker (edits never knot)', async () => {
    const a = bySymbol(await lift({ 'a.json': '{"files": ["one"]}' }));
    const b = bySymbol(await lift({ 'a.json': '{"files": ["two", "three"]}' }));
    const k = '#cfg:a.json::/files';
    expect(a.get(k)!.cfgMarker).toBe('seq');
    expect(a.get(k)!.reducedFidelity).toBe(true);
    // content-independent: divergent array edits do NOT move the essence — the
    // byte tier governs; the meaning layer never claims (or knots) them.
    expect(a.get(k)!.codeEssence).toBe(b.get(k)!.codeEssence);
  });

  it('a subtree containing a sequence anywhere defers (CI-workflow shape)', async () => {
    const yml = `name: ci
jobs:
  build:
    steps:
      - run: echo hi
env:
  FOO: "1"
`;
    const units = bySymbol(await lift({ '.github/workflows/ci.yml': yml }));
    const p = (k: string) => `#cfg:.github/workflows/ci.yml::${k}`;
    expect(units.get(p('/jobs/build'))!.cfgMarker).toBe('seq'); // steps array inside
    expect(units.get(p('/name'))!.cfgMarker).toBeUndefined(); // scalar = real meaning
    expect(units.get(p('/env/FOO'))!.cfgMarker).toBeUndefined();
  });
});

describe('cfg-lens — fail-closed to the byte tier (visible, never silent-empty)', () => {
  const expectUnliftable = (units: CodeUnit[], rel: string) => {
    expect(units).toHaveLength(1);
    expect(units[0].symbol).toBe(`#cfg:${rel}::/`);
    expect(units[0].cfgMarker).toBe('unliftable');
    expect(units[0].reducedFidelity).toBe(true);
  };

  it('unparseable JSON → single visible marker', async () => {
    expectUnliftable(await lift({ 'a.json': '{"a": ' }), 'a.json');
  });

  it('duplicate JSON keys → marker (JSON.parse would silently keep the last)', async () => {
    const units = await lift({ 'a.json': '{"a": 1, "a": 2}' });
    expectUnliftable(units, 'a.json');
    expect(units[0].codeEssence).toContain('duplicate-key');
  });

  it('JSONC comforts are accepted (tsconfig reality): comments + trailing commas', async () => {
    const units = bySymbol(
      await lift({
        'tsconfig.json': `{
  // line comment
  "compilerOptions": {
    "strict": true, /* block comment */
    "target": "esnext",
  },
}
`,
      }),
    );
    expect(units.get('#cfg:tsconfig.json::/compilerOptions/strict')!.codeEssence).toContain('true');
    expect(units.get('#cfg:tsconfig.json::/compilerOptions/target')).toBeDefined();
  });

  it('YAML anchors/aliases → marker (outside the plain core schema)', async () => {
    expectUnliftable(await lift({ 'a.yml': 'a: &x 1\nb: *x\n' }), 'a.yml');
  });

  it('YAML explicit tags → marker', async () => {
    expectUnliftable(await lift({ 'a.yml': 'a: !!binary "aGk="\n' }), 'a.yml');
  });

  it('YAML merge keys (<<) → marker', async () => {
    expectUnliftable(await lift({ 'a.yml': 'base: &b\n  x: 1\nchild:\n  <<: *b\n' }), 'a.yml');
  });

  it('multi-document YAML → marker', async () => {
    expectUnliftable(await lift({ 'a.yml': 'a: 1\n---\nb: 2\n' }), 'a.yml');
  });

  it('non-map root (JSON array / YAML scalar) → marker', async () => {
    expectUnliftable(await lift({ 'a.json': '[1, 2, 3]' }), 'a.json');
    expectUnliftable(await lift({ 'b.yml': 'just a scalar\n' }), 'b.yml');
  });

  it('duplicate YAML keys → marker', async () => {
    expectUnliftable(await lift({ 'a.yml': 'a: 1\na: 2\n' }), 'a.yml');
  });
});

describe('cfg-lens — lockfiles are DERIVED (never lifted)', () => {
  it('package-lock.json / yarn.lock / pnpm-lock.yaml produce NO units', async () => {
    const units = await lift({
      'package.json': '{"name": "x"}',
      'package-lock.json': '{"lockfileVersion": 3}',
      'yarn.lock': '# yarn lockfile v1\n',
      'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n',
    });
    expect(units.every((u) => u.filePath === 'package.json')).toBe(true);
  });

  it('isDerivedArtifact matches basenames at any depth, and only those', () => {
    expect(isDerivedArtifact('package-lock.json')).toBe(true);
    expect(isDerivedArtifact('packages/web/package-lock.json')).toBe(true);
    expect(isDerivedArtifact('bun.lockb')).toBe(true);
    expect(isDerivedArtifact('Cargo.lock')).toBe(true);
    expect(isDerivedArtifact('package.json')).toBe(false);
    expect(isDerivedArtifact('config.lock')).toBe(false); // no glob swallowing
  });
});

describe('cfg-lens — determinism', () => {
  it('lifting the same tree twice is byte-identical (symbols + bodies)', async () => {
    const files = { 'package.json': PKG, 'a.yml': 'x: 1\ny:\n  z: "2"\n' };
    const dir = await mkFixture(files);
    try {
      const lens = new CfgLens();
      const a = await lens.lift(dir);
      const b = await lens.lift(dir);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('a pure-TS tree lifts ZERO cfg units', async () => {
    const units = await lift({ 'src/a.ts': 'export const one = () => 1;\n' });
    expect(units).toEqual([]);
  });
});
