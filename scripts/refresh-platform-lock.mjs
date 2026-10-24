#!/usr/bin/env node
/**
 * @symbol #publish-gnomon
 *
 * After the Gnomon platform package is published, repair package-lock.json (8.0.2 found this).
 *
 * The version bump lands before the platform package (@a-company/gnomon-darwin-<arch>) is on npm, so npm records
 * gnomon's optionalDependency as a versionless placeholder (`{ "optional": true }`). Once the version IS published,
 * every `npm ci` and `npm install` crashes on that entry with "Invalid Version:" (npm compares against the empty
 * version), and npm cannot repair it itself. This drops only those placeholders and lets npm re-resolve them
 * (`npm install --package-lock-only --ignore-scripts`), so npm still writes the real entry (version, resolved,
 * integrity, os/cpu). Commit the result to main.
 *
 *   node scripts/refresh-platform-lock.mjs        repair, print what changed
 *   node scripts/refresh-platform-lock.mjs --check exit 1 if the lock still holds a placeholder for a platform package
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO } from './release.mjs';

const PLATFORM = /(^|\/)node_modules\/@a-company\/gnomon-darwin-[^/]+$/;

/** Lock keys that are versionless platform-package placeholders. Pure. */
export function platformPlaceholders(lock) {
  return Object.entries(lock.packages ?? {})
    .filter(([key, entry]) => PLATFORM.test(key) && entry && typeof entry === 'object' && !entry.version)
    .map(([key]) => key);
}

export function refreshPlatformLock(root = REPO) {
  const file = path.join(root, 'package-lock.json');
  const lock = JSON.parse(readFileSync(file, 'utf8'));
  const dropped = platformPlaceholders(lock);
  if (dropped.length === 0) return { dropped };
  for (const key of dropped) delete lock.packages[key];
  writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if ((r.status ?? 1) !== 0) throw new Error(`npm install --package-lock-only failed (exit ${r.status ?? r.signal})`);
  const left = platformPlaceholders(JSON.parse(readFileSync(file, 'utf8')));
  if (left.length) throw new Error(`still versionless after npm re-resolved: ${left.join(', ')} (is that version on npm?)`);
  return { dropped };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv.includes('--check')) {
      const left = platformPlaceholders(JSON.parse(readFileSync(path.join(REPO, 'package-lock.json'), 'utf8')));
      process.stdout.write(left.length ? `refresh-platform-lock: placeholder(s): ${left.join(', ')}\n` : 'refresh-platform-lock: no placeholders\n');
      process.exitCode = left.length ? 1 : 0;
    } else {
      const { dropped } = refreshPlatformLock();
      process.stdout.write(dropped.length ? `refresh-platform-lock: re-resolved ${dropped.join(', ')}; commit package-lock.json to main\n` : 'refresh-platform-lock: nothing to do\n');
    }
  } catch (e) {
    process.stderr.write(`refresh-platform-lock: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}
