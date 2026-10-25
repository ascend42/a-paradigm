/**
 * What @a-company/paradigm makes users install (8.0.3).
 *
 * tsup bundles every @a-company package into paradigm's dist (noExternal), so listing a bundled one as a runtime
 * dependency only installs a stale npm copy nobody loads. 8.0.2 did that with "*" and pulled zod 3 back into every
 * user's `npm audit`. A runtime @a-company dependency is allowed only when it is genuinely loaded from node_modules:
 * @a-company/gnomon (the bin/gnomon.js shim) and the packages tsup keeps external (warpline). Those, and the chain
 * they load, must use real ranges, never "*", so a stale published version can't satisfy them.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PKG = path.resolve(__dirname, '..');
const PACKAGES = path.resolve(PKG, '..');
const read = (p: string): Record<string, any> => JSON.parse(fs.readFileSync(p, 'utf8'));
const companyDeps = (j: Record<string, any>): Record<string, string> =>
  Object.fromEntries(
    ['dependencies', 'optionalDependencies', 'peerDependencies']
      .flatMap((s) => Object.entries((j[s] ?? {}) as Record<string, string>))
      .filter(([n]) => n.startsWith('@a-company/')),
  );

/** The @a-company packages tsup keeps external in any entry (loaded from node_modules at runtime). */
function tsupExternals(): Set<string> {
  const src = fs.readFileSync(path.join(PKG, 'tsup.config.ts'), 'utf8');
  return new Set([...src.matchAll(/'(@a-company\/[a-z0-9-]+)'/g)].map((m) => m[1]));
}

describe('paradigm runtime dependencies', () => {
  it('lists only @a-company packages it really loads from node_modules', () => {
    const allowed = new Set(['@a-company/gnomon', ...tsupExternals()]);
    const deps = companyDeps(read(path.join(PKG, 'package.json')));
    expect(Object.keys(deps).filter((n) => !allowed.has(n))).toEqual([]);
  });

  it('never uses "*" for a runtime @a-company dependency, here or in the chain warpline loads', () => {
    const manifests = ['paradigm', 'warpline', 'premise/core', 'purpose/core', 'portal/core'].map((p) => path.join(PACKAGES, p, 'package.json'));
    const stars = manifests.flatMap((m) => Object.entries(companyDeps(read(m))).filter(([, v]) => v === '*' || v === 'latest').map(([n]) => `${path.relative(PACKAGES, m)}: ${n}`));
    expect(stars).toEqual([]);
  });
});
