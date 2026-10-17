#!/usr/bin/env node
/**
 * @symbol #kernel-log
 *
 * `npm run test:perf` — the isolated G-LOG-04 perf pass (#kernel-log), zero
 * deps, cmd.exe-safe (no `VAR=1 cmd` shell syntax; T-2026-10-17-011).
 *
 * The target lives in test/kernel-log-posix.test.ts (marked darwin, linux),
 * which vitest.config.ts excludes on win32 — so ONLY on win32 is "no test
 * files" an expected outcome (--passWithNoTests). Everywhere else a missing
 * target is a loud failure, never a silent pass.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = 'test/kernel-log-posix.test.ts';
const win32 = process.platform === 'win32';

if (!win32 && !existsSync(path.join(PKG_ROOT, TARGET))) {
  process.stderr.write(`test:perf: ${TARGET} is missing — the G-LOG-04 falsifier cannot be skipped on ${process.platform}\n`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const vitestPkg = require.resolve('vitest/package.json');
const vitestBin = path.join(path.dirname(vitestPkg), require(vitestPkg).bin.vitest);
const args = [vitestBin, 'run', '--no-file-parallelism', TARGET, '-t', 'G-LOG-04'];
if (win32) args.push('--passWithNoTests');

const r = spawnSync(process.execPath, args, { cwd: PKG_ROOT, stdio: 'inherit', env: { ...process.env, GNOMON_PERF: '1' } });
if (r.error) {
  process.stderr.write(`test:perf: could not run vitest: ${r.error.message}\n`);
  process.exit(1);
}
process.exit(r.status ?? 1);
