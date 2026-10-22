#!/usr/bin/env node
/**
 * @symbol #release-publish
 *
 * `npm run release` (CI: .github/workflows/release.yml, changesets/action `publish:`). Runs `changeset publish`, but
 * only after a preflight proves that changesets will never try to publish a MANUAL-ONLY package.
 *
 * Why: `changeset publish` publishes every non-private workspace package whose local version is not on npm.
 * @a-company/gnomon is public (paradigm depends on it, exact version) but can only be published from the founder's Mac
 * through `npm run publish:gnomon` (scripts/publish-gnomon.mjs: signed, notarized zips and a release-built dist, gated
 * by scripts/gate-gnomon-publish.mjs). Its platform packages are not workspaces, so changesets never sees them.
 * So the preflight requires every manual-only package, at the version this checkout carries, to ALREADY be on npm:
 *   - then changesets skips gnomon ("already published"), and never runs its prepublishOnly gate on a CI dev dist;
 *   - and paradigm, whose exact dependency on @a-company/gnomon would otherwise not resolve for users, can never be
 *     published before gnomon and its platform packages are (the release ORDER).
 * Anything missing, or a registry answer other than found / 404, fails the release before anything is published.
 *
 *   node scripts/release.mjs              preflight, then changeset publish (exit code is changesets')
 *   node scripts/release.mjs --check      preflight only
 *
 * Node >= 24 (release.yml runs Node 24 on ubuntu); node: built-ins only.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Apple silicon only in 8.0 (TD-2026-10-22-310); x64 is not published.
export const ARCHES = Object.freeze(['arm64']);

const readPkg = (root, dir) => JSON.parse(readFileSync(path.join(root, 'packages', dir, 'package.json'), 'utf8'));

/**
 * The packages only the founder publishes, in publish ORDER (platform packages first: gnomon's optionalDependencies
 * name them; then gnomon: paradigm's dependency names it). [{ name, version, dir }]
 */
export function manualOnlyPackages(root = REPO) {
  const dirs = [...ARCHES.map((a) => `gnomon-darwin-${a}`), 'gnomon'];
  return dirs.map((dir) => {
    const pj = readPkg(root, dir);
    return { name: pj.name, version: pj.version, dir: path.join('packages', dir) };
  });
}

const npmBin = () => (process.platform === 'win32' ? 'npm.cmd' : 'npm');

/**
 * Is `name@version` on the registry? true / false; throws on any answer that is neither (network, auth, registry
 * error), so callers fail closed.
 */
export function npmHasVersion(name, version) {
  const r = spawnSync(npmBin(), ['view', `${name}@${version}`, 'version', '--json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const out = String(r.stdout ?? '').trim();
  if (r.status === 0) {
    if (out === '') return false;
    const v = JSON.parse(out);
    return Array.isArray(v) ? v.includes(version) : v === version;
  }
  const text = `${out}\n${String(r.stderr ?? '')}`;
  if (/\bE404\b/.test(text)) return false;
  throw new Error(`npm view ${name}@${version} failed (exit ${r.status ?? r.signal}): ${text.trim().split('\n').slice(-3).join(' | ')}`);
}

/** Every reason the CI release must not run (empty = changesets will skip all manual-only packages). */
export function releasePreflightProblems({ root = REPO, hasVersion = npmHasVersion } = {}) {
  const problems = [];
  for (const p of manualOnlyPackages(root)) {
    let found;
    try {
      found = hasVersion(p.name, p.version);
    } catch (e) {
      problems.push(`${p.name}@${p.version}: cannot confirm it is on npm (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }
    if (!found) problems.push(`${p.name}@${p.version} is not on npm`);
  }
  return problems;
}

/**
 * The release: preflight, then `changeset publish`. `run(cmd, args)` returns an exit code (injected in tests).
 * Returns the process exit code.
 */
export function runRelease({ root = REPO, hasVersion = npmHasVersion, run, checkOnly = false, write = (s) => process.stderr.write(s) } = {}) {
  const problems = releasePreflightProblems({ root, hasVersion });
  if (problems.length) {
    write(
      'release: refused, nothing published.\n' +
        problems.map((p) => `  - ${p}\n`).join('') +
        'Gnomon and its platform packages are published only from the founder\'s Mac, BEFORE paradigm (paradigm depends on\n' +
        'the exact @a-company/gnomon version). Run `npm run publish:gnomon` there (it gates, then publishes the platform\n' +
        'packages, then gnomon), then re-run this release.\n',
    );
    return 1;
  }
  write('release: preflight ok (gnomon and its platform packages are on npm; changesets will skip them)\n');
  if (checkOnly) return 0;
  return run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['changeset', 'publish']);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { cwd: REPO, stdio: 'inherit', shell: process.platform === 'win32' });
    return r.status ?? 1;
  };
  process.exitCode = runRelease({ run, checkOnly: process.argv.includes('--check') });
}
