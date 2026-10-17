/**
 * G-SEC-01 — the kernel's package.json declares no runtime dependencies
 * (spec §15.1 row 8, §18; research 29 §1). There is no `dependencies` key at
 * all; gnomon-contracts is a devDependency and tsup bundles it. Optional, peer
 * and bundled dependencies would also reach the kernel process at runtime, so
 * they are refused too.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from './helpers.js';

const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;

describe('G-SEC-01 kernel has zero runtime deps', () => {
  it('has no "dependencies" key', () => {
    expect(Object.hasOwn(pkg, 'dependencies')).toBe(false);
  });

  it.each(['optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies'])(
    'has no "%s" key',
    (key) => {
      expect(Object.hasOwn(pkg, key)).toBe(false);
    },
  );

  it('takes gnomon-contracts as a devDependency only', () => {
    const dev = pkg.devDependencies as Record<string, string>;
    expect(dev['@a-company/gnomon-contracts']).toBeDefined();
  });

  it('is private and requires Node >= 24', () => {
    expect(pkg.private).toBe(true);
    expect((pkg.engines as Record<string, string>).node).toBe('>=24.0.0');
  });
});
