#!/usr/bin/env node
/**
 * @symbol #gnomon-npm-packaging
 *
 * Keep the published Gnomon packages in lockstep (T-2026-10-21-030, TD-2026-10-21-758; 8.0 M3). The source of truth is
 * packages/gnomon/package.json `version`; this script makes everything else follow it, exactly (no ranges):
 *   - packages/gnomon-darwin-arm64/package.json `version` (Apple silicon only in 8.0, TD-2026-10-22-310);
 *   - packages/gnomon/package.json `optionalDependencies` for the platform package (and nothing else);
 *   - packages/paradigm/package.json `dependencies["@a-company/gnomon"]`;
 *   - packages/paradigm-mcp/package.json `dependencies["@a-company/gnomon"]` (8.0.2: it drifted, the 8.0.1 bump fixed it by hand).
 * It never bumps paradigm's own version (the 8.0.0 release bump is M5).
 *
 *   node scripts/sync-gnomon-versions.mjs          rewrite what drifted, print each change
 *   node scripts/sync-gnomon-versions.mjs --check  print the drift and exit 1 if any (CI; the gnomon suite's
 *                                                  packages/gnomon/test/version-lockstep.test.ts asserts none)
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Apple silicon only in 8.0 (TD-2026-10-22-310); x64 is not published.
export const ARCHES = Object.freeze(['arm64']);
export const platformPackageName = (arch) => `@a-company/gnomon-darwin-${arch}`;

const files = (root) => ({
  gnomon: path.join(root, 'packages', 'gnomon', 'package.json'),
  paradigm: path.join(root, 'packages', 'paradigm', 'package.json'),
  paradigmMcp: path.join(root, 'packages', 'paradigm-mcp', 'package.json'),
  platforms: Object.fromEntries(ARCHES.map((a) => [a, path.join(root, 'packages', `gnomon-darwin-${a}`, 'package.json')])),
});
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));

/**
 * Every lockstep violation under `root`: [{ file, field, have, want }] (want undefined = must not be there). Empty means
 * in step.
 */
export function gnomonVersionDrift(root = REPO) {
  const f = files(root);
  const want = read(f.gnomon).version;
  if (typeof want !== 'string' || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(want)) throw new Error(`${f.gnomon}: no exact semver version`);
  const drift = [];
  const gnomon = read(f.gnomon);
  for (const a of ARCHES) {
    const p = read(f.platforms[a]);
    if (p.name !== platformPackageName(a)) drift.push({ file: f.platforms[a], field: 'name', have: p.name, want: platformPackageName(a) });
    if (p.version !== want) drift.push({ file: f.platforms[a], field: 'version', have: p.version, want });
    const opt = gnomon.optionalDependencies?.[platformPackageName(a)];
    if (opt !== want) drift.push({ file: f.gnomon, field: `optionalDependencies.${platformPackageName(a)}`, have: opt, want });
  }
  // A platform package that is not shipped (x64 in 8.0) must not be named either: npm would try to fetch it.
  for (const [name, have] of Object.entries(gnomon.optionalDependencies ?? {})) {
    if (name.startsWith('@a-company/gnomon-darwin-') && !ARCHES.some((a) => platformPackageName(a) === name)) {
      drift.push({ file: f.gnomon, field: `optionalDependencies.${name}`, have, want: undefined });
    }
  }
  for (const file of [f.paradigm, f.paradigmMcp]) {
    const dep = read(file).dependencies?.['@a-company/gnomon'];
    if (dep !== want) drift.push({ file, field: 'dependencies.@a-company/gnomon', have: dep, want });
  }
  return drift;
}

/** Rewrite every drifted field to the gnomon version; returns the drift it fixed. Key order is preserved. */
export function syncGnomonVersions(root = REPO) {
  const drift = gnomonVersionDrift(root);
  const byFile = new Map();
  for (const d of drift) {
    if (!byFile.has(d.file)) byFile.set(d.file, read(d.file));
    const j = byFile.get(d.file);
    const [head, ...rest] = d.field.split('.');
    if (d.want === undefined) delete j[head]?.[rest.join('.')]; // an unshipped platform package: drop it
    else if (rest.length === 0) j[head] = d.want;
    else {
      j[head] ??= {};
      j[head][rest.join('.')] = d.want;
    }
  }
  for (const [file, j] of byFile) writeFileSync(file, `${JSON.stringify(j, null, 2)}\n`);
  return drift;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const check = process.argv.includes('--check');
  try {
    const drift = check ? gnomonVersionDrift() : syncGnomonVersions();
    for (const d of drift) process.stdout.write(`${check ? 'drift' : 'fixed'}  ${path.relative(REPO, d.file)}  ${d.field}: ${d.have ?? '(missing)'} -> ${d.want ?? '(removed)'}\n`);
    if (drift.length === 0) process.stdout.write('gnomon versions are in lockstep\n');
    if (check && drift.length) process.exitCode = 1;
  } catch (e) {
    process.stderr.write(`sync-gnomon-versions: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}
