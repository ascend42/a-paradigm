#!/usr/bin/env node
/**
 * @symbol #publish-gnomon
 *
 * `npm run publish:gnomon`: the founder's release flow, on their Mac, in the one order that installs for users.
 *   1. gate      scripts/gate-gnomon-publish.mjs (lockstep, signed + notarized + stapled zips, release-built dist
 *                pinning them). Refused = nothing published.
 *   2. platform  @a-company/gnomon-darwin-arm64 (gnomon's optionalDependencies name it; Apple silicon only in
 *                8.0, TD-2026-10-22-310: x64 is not published).
 *   3. gnomon    @a-company/gnomon (paradigm's exact dependency names it; its prepublishOnly re-runs the gate).
 *   4. verify    each of the two is visible on npm at this version.
 *   4b. lock     scripts/refresh-platform-lock.mjs: re-resolve the platform package's versionless lock placeholder now it
 *                is on npm (it breaks every npm ci otherwise); commit package-lock.json to main.
 *   5. paradigm  only with --release: `npm run release` (scripts/release.mjs: its preflight re-checks step 4, then
 *                changeset publish). Without it, CI's release job publishes paradigm once the release PR merges, and
 *                refuses until steps 2-3 are on npm.
 * A package already on npm at this version is skipped, so a run interrupted after step 2 can simply be re-run.
 *
 *   node scripts/publish-gnomon.mjs [--release] [--dry-run]
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { manualOnlyPackages, npmHasVersion, REPO } from './release.mjs';

/**
 * The ordered steps: [{ kind: 'gate' | 'publish' | 'skip' | 'verify' | 'lock' | 'release', name?, version?, cmd?, args? }].
 * Pure given `hasVersion`.
 */
export function publishPlan({ root = REPO, hasVersion = npmHasVersion, release = false } = {}) {
  const steps = [{ kind: 'gate', cmd: process.execPath, args: ['scripts/gate-gnomon-publish.mjs'] }];
  const pkgs = manualOnlyPackages(root);
  for (const p of pkgs) {
    if (hasVersion(p.name, p.version)) {
      steps.push({ kind: 'skip', name: p.name, version: p.version });
      continue;
    }
    const args = p.name === '@a-company/gnomon' ? ['publish', '--workspace=@a-company/gnomon'] : ['publish', `./${p.dir}`, '--access', 'public'];
    steps.push({ kind: 'publish', name: p.name, version: p.version, cmd: 'npm', args });
  }
  for (const p of pkgs) steps.push({ kind: 'verify', name: p.name, version: p.version });
  // Now the platform package is on npm, the lock's versionless placeholder for it would break every npm ci.
  steps.push({ kind: 'lock', cmd: process.execPath, args: ['scripts/refresh-platform-lock.mjs'] });
  if (release) steps.push({ kind: 'release', cmd: 'npm', args: ['run', 'release'] });
  return steps;
}

const say = (s) => process.stdout.write(`publish:gnomon: ${s}\n`);

function runStep(cmd, args) {
  const bin = cmd === 'npm' && process.platform === 'win32' ? 'npm.cmd' : cmd;
  return spawnSync(bin, args, { cwd: REPO, stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1;
}

/** Registry reads can lag a publish by a few seconds. */
function visibleOnNpm(name, version) {
  for (let i = 0; i < 10; i++) {
    if (npmHasVersion(name, version)) return true;
    spawnSync('sleep', ['3']);
  }
  return false;
}

function main() {
  const dry = process.argv.includes('--dry-run');
  const steps = publishPlan({ release: process.argv.includes('--release') });
  for (const s of steps) {
    if (s.kind === 'skip') {
      say(`${s.name}@${s.version} is already on npm, skipping`);
      continue;
    }
    if (s.kind === 'verify') {
      if (dry) continue;
      if (!visibleOnNpm(s.name, s.version)) {
        process.stderr.write(`publish:gnomon: ${s.name}@${s.version} is not visible on npm; do not release paradigm yet\n`);
        return 1;
      }
      say(`${s.name}@${s.version} is on npm`);
      continue;
    }
    say(`${dry ? '[dry-run] ' : ''}${s.kind}: ${s.cmd === process.execPath ? 'node' : s.cmd} ${s.args.join(' ')}`);
    if (dry && s.kind !== 'gate') continue;
    const code = runStep(s.cmd, s.args);
    if (code !== 0) {
      process.stderr.write(`publish:gnomon: ${s.kind}${s.name ? ` ${s.name}` : ''} failed (exit ${code}); stopped, nothing after it ran\n`);
      return code;
    }
  }
  if (!dry) say('commit package-lock.json to main if refresh-platform-lock changed it (git status), or the next npm ci breaks.');
  if (!steps.some((s) => s.kind === 'release')) {
    say('done. Paradigm is next: merge the release PR (CI runs `npm run release`), or re-run with --release here.');
  }
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main();
  } catch (e) {
    process.stderr.write(`publish:gnomon: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}
