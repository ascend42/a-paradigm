/**
 * G-KRN-02 — the kernel import fence (spec §2.1 boundary falsifier, §18;
 * research 29 §1). Every import under src/kernel/** is `node:*`, a relative
 * path, or @a-company/gnomon-contracts. The built dist/ must contain no bare
 * import at all: contracts are bundled and every built-in carries `node:`.
 *
 * Hoisted node_modules can hide an accidental kernel import at runtime; this
 * test, not the workspace layout, is the guard.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractSpecifiers, PKG_ROOT, rel, walk } from './helpers.js';

export { extractSpecifiers };

const CONTRACTS = '@a-company/gnomon-contracts';

const isRelative = (s: string) => s.startsWith('./') || s.startsWith('../');
const isNodeBuiltin = (s: string) => s.startsWith('node:');
const isContracts = (s: string) => s === CONTRACTS || s.startsWith(`${CONTRACTS}/`);

/** Source rule: node:*, relative, or gnomon-contracts. */
export function sourceSpecifierAllowed(s: string): boolean {
  return isNodeBuiltin(s) || isRelative(s) || isContracts(s);
}

/** dist rule: contracts are bundled, so only node:* and relative survive. */
export function distSpecifierAllowed(s: string): boolean {
  return isNodeBuiltin(s) || isRelative(s);
}

describe('G-KRN-02 fence checker (self-test)', () => {
  it('extracts every import form', () => {
    const src = [
      `import fs from 'node:fs';`,
      `import { a } from "./a.js";`,
      `import type { T } from '${CONTRACTS}';`,
      `export * from '../b.js';`,
      `import 'side-effect';`,
      `const x = await import('lodash');`,
      `const y = require("fs");`,
    ].join('\n');
    expect(extractSpecifiers(src).sort()).toEqual(
      ['../b.js', './a.js', CONTRACTS, 'fs', 'lodash', 'node:fs', 'side-effect'].sort(),
    );
  });

  it.each([
    ['node:fs', true],
    ['./x.js', true],
    ['../x.js', true],
    [CONTRACTS, true],
    [`${CONTRACTS}/schemas/probeResult.v1.schema.json`, true],
    ['fs', false],
    ['@a-company/premise-core', false],
    ['@a-company/warpline', false],
    ['@a-company/gnomon-gui', false],
    ['@a-company/gnomon-contracts-evil', false],
    ['react', false],
  ])('source rule: %s -> %s', (spec, allowed) => {
    expect(sourceSpecifierAllowed(spec)).toBe(allowed);
  });

  it('dist rule rejects bare contracts (must be bundled)', () => {
    expect(distSpecifierAllowed(CONTRACTS)).toBe(false);
    expect(distSpecifierAllowed('node:path')).toBe(true);
  });
});

describe('G-KRN-02 src/kernel/** imports', () => {
  const kernelDir = path.join(PKG_ROOT, 'src', 'kernel');
  const files = walk(kernelDir, (f) => /\.(c|m)?tsx?$/.test(f) && !f.endsWith('.d.ts'));

  it('finds kernel sources to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('every kernel import is node:*, relative, or gnomon-contracts', () => {
    const violations = files.flatMap((f) =>
      extractSpecifiers(readFileSync(f, 'utf8'))
        .filter((s) => !sourceSpecifierAllowed(s))
        .map((s) => `${rel(f)}: ${s}`),
    );
    expect(violations).toEqual([]);
  });
});

describe('G-KRN-02 dist/ has no bare imports', () => {
  const distDir = path.join(PKG_ROOT, 'dist');

  it('dist/ exists (run `npm run build` first — never skip silently)', () => {
    expect(existsSync(distDir), 'dist/ missing: build before testing (npm run test:gnomon does)').toBe(true);
  });

  it('every built import/require is node:* or relative', () => {
    if (!existsSync(distDir)) return; // the test above already failed loudly
    const files = walk(distDir, (f) => /\.(c|m)?js$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap((f) =>
      extractSpecifiers(readFileSync(f, 'utf8'))
        .filter((s) => !distSpecifierAllowed(s))
        .map((s) => `${rel(f)}: ${s}`),
    );
    expect(violations).toEqual([]);
  });
});
